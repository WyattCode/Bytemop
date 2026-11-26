'use strict';
// App uninstall for the UI. The renderer only ever names an app by the id from the last list and a
// leftover by the id from the last leftover scan; everything is re-read and re-checked here.
//   - desktop apps: their own uninstaller is started (we never delete a program's files ourselves)
//   - Store apps: removed for the current user through Windows
//   - leftovers: only for an app we started the uninstaller for and that is really gone from the list;
//     moved to the quarantine (undoable) or deleted, following the user's delete setting
// Leftovers in machine-wide folders (Program Files, ProgramData) need administrator rights: they go to the
// elevated helper, which finds and vouches for them itself and sends them to the Recycle Bin.
// No Electron imports; the backend, the quarantine and the helper come from outside.
const fsp = require('fs').promises;
const path = require('path');
const apps = require('./apps');
const { atomicWrite, createQueue } = require('./atomic');
const { isPlainDir } = require('./pathsafe');

const GB = 1024 ** 3;
const PENDING_MAX = 30;
const PENDING_TTL_MS = 30 * 24 * 3600 * 1000;

function createAppsService({ dataDir, backend, service, env = process.env, getExcluded = async () => () => false, extraProtected = [], now = () => Date.now(), exists, elevatedClean = null }) {
  const file = path.join(dataDir, 'apps.json');
  const serial = createQueue(); // the apps.json read-modify-write
  const cleaning = createQueue(); // one leftover clean at a time
  const launching = new Set();
  const scans = new Map(); // app id -> { at, candidates }

  const strip = ({ uninstall, key, fullName, ...pub }) => pub;

  async function readDesktop() { return apps.parseDesktop(await backend.desktop()); }
  // Everything the registry lists with a name, including components and entries the list hides: for "is it still
  // installed?" and "which folders belong to something else?" a hidden entry still counts.
  async function readAll() {
    const rows = await backend.desktop();
    const all = (Array.isArray(rows) ? rows : [])
      .filter((r) => r && typeof r.name === 'string' && r.name.trim() && typeof r.key === 'string')
      .map((r) => ({ id: apps.idOf('w-', r.key), name: r.name.trim(), installLocation: String(r.installLocation || '').trim().replace(/^"|"$/g, '') }));
    return { parsed: apps.parseDesktop(rows), all };
  }
  async function readStore() { return apps.parseStore(await backend.store()); }

  // ----- apps whose uninstaller we started -----
  async function readPending() {
    let arr;
    try { arr = JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^﻿/, '')).pending; } catch { return []; }
    if (!Array.isArray(arr)) return [];
    const t = now();
    return arr.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && t - (p.launchedAt || 0) < PENDING_TTL_MS);
  }
  async function writePending(list) {
    await fsp.mkdir(dataDir, { recursive: true });
    await atomicWrite(file, JSON.stringify({ pending: list.slice(-PENDING_MAX) }, null, 2));
  }
  const addPending = (entry) => serial(async () => {
    const list = (await readPending()).filter((p) => p.id !== entry.id);
    list.push(entry);
    await writePending(list);
  });
  const dropPending = (id) => serial(async () => {
    const list = await readPending();
    const next = list.filter((p) => p.id !== id);
    if (next.length !== list.length) await writePending(next);
    scans.delete(id);
    return next.length !== list.length;
  });

  const sameApp = (p, a) => a.id === p.id || apps.normalizeName(a.name) === apps.normalizeName(p.name);

  // ----- list -----
  // Desktop and Store apps are read independently: one failing must not hide the other.
  async function list() {
    const [d, s] = await Promise.allSettled([readAll(), readStore()]);
    const errors = [];
    if (d.status === 'rejected') errors.push({ source: 'desktop', message: String(d.reason && d.reason.message || d.reason) });
    if (s.status === 'rejected') errors.push({ source: 'store', message: String(s.reason && s.reason.message || s.reason) });
    const desktop = d.status === 'fulfilled' ? d.value.parsed : [];
    const everything = d.status === 'fulfilled' ? d.value.all : [];
    const store = s.status === 'fulfilled' ? s.value : [];
    const pending = await readPending();
    // Without the desktop list we cannot tell whether an app is gone, so nothing is reported as finished.
    const marked = pending.map((p) => ({
      id: p.id, name: p.name, publisher: p.publisher || '', version: p.version || '', launchedAt: p.launchedAt,
      status: d.status !== 'fulfilled' ? 'unknown' : everything.some((a) => sameApp(p, a)) ? 'installed' : 'gone',
    }));
    return { apps: [...desktop, ...store].map(strip), pending: marked, errors };
  }

  // ----- uninstall -----
  async function uninstall(id) {
    id = String(id);
    if (launching.has(id)) return { ok: false, error: 'busy' };
    launching.add(id);
    try {
      if (id.startsWith('s-')) {
        const app = (await readStore()).find((a) => a.id === id);
        if (!app) return { ok: false, error: 'not-found' };
        try { await backend.removeStore(app.fullName); } catch (e) { return { ok: false, error: 'failed', detail: String(e.message || e) }; }
        await service.logEvent({ type: 'uninstall', name: app.name, kind: 'store' });
        return { ok: true, removed: true, name: app.name };
      }
      if (!id.startsWith('w-')) return { ok: false, error: 'not-found' };
      const app = (await readDesktop()).find((a) => a.id === id);
      if (!app) return { ok: false, error: 'not-found' };
      const cmd = apps.splitCommand(app.uninstall, env, exists);
      if (!cmd) return { ok: false, error: 'bad-command' };
      try {
        await backend.launch({ exe: cmd.exe, args: cmd.args, cwd: path.isAbsolute(cmd.exe) ? path.dirname(cmd.exe) : '' });
      } catch (e) { return { ok: false, error: 'launch-failed', detail: String(e.message || e) }; }
      await addPending({ id: app.id, name: app.name, publisher: app.publisher, version: app.version, installLocation: app.installLocation, launchedAt: now() });
      await service.logEvent({ type: 'uninstall', name: app.name, kind: 'desktop' });
      return { ok: true, started: true, name: app.name };
    } finally { launching.delete(id); }
  }

  // ----- leftovers -----
  // Names of the other installed apps: a folder carrying one of them belongs to them, not to the removed app.
  function othersOf(installed, p) {
    const set = new Set();
    for (const a of installed) {
      if (sameApp(p, a)) continue;
      set.add(apps.normalizeName(a.name));
      for (const v of apps.nameVariants(a.name, a.installLocation)) set.add(v);
    }
    return set;
  }

  // Install folders of the other installed apps: never offered as leftovers.
  const keepDirsOf = (installed, p) => installed.filter((a) => !sameApp(p, a) && a.installLocation).map((a) => a.installLocation);

  const publicCandidate = ({ root, ...c }) => c;

  async function leftovers(id) {
    id = String(id);
    const p = (await readPending()).find((x) => x.id === id);
    if (!p) return { error: 'not-pending' };
    const installed = (await readAll()).all;
    if (installed.some((a) => sameApp(p, a))) return { error: 'still-installed' };
    const candidates = await apps.findLeftovers(p, { env, isExcluded: await getExcluded(), others: othersOf(installed, p), extraProtected, keepDirs: keepDirsOf(installed, p) });
    scans.set(id, { at: now(), candidates });
    return { candidates: candidates.map(publicCandidate) };
  }

  const isOwnCandidate = (c) => {
    // Roots are the usual data folders; an install folder is checked against the safe-folder rule.
    if (c.kind === 'install' && !c.root) return apps.isSafeInstallDir(c.path, env, extraProtected);
    return !!c.root && path.dirname(c.path).toLowerCase() === path.resolve(c.root).toLowerCase();
  };

  async function tree(dir, isExcluded) {
    const files = [];
    const dirs = [];
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      let entries;
      try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isSymbolicLink()) continue;
        if (isExcluded(full)) continue;
        let st;
        try { st = await fsp.lstat(full); } catch { continue; }
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) { dirs.push(full); stack.push(full); } else if (st.isFile()) files.push({ path: full, size: st.size, mtimeMs: st.mtimeMs });
      }
    }
    return { files, dirs };
  }

  const cleanLeftovers = (id, ids) => cleaning(() => cleanNow(String(id), ids));

  async function cleanNow(id, ids) {
    const p = (await readPending()).find((x) => x.id === id);
    const scan = scans.get(id);
    if (!p || !scan) return { error: 'rescan' };
    const isExcluded = await getExcluded(); // an unreadable exclusions file stops here, before anything else
    // The app must still be gone: a reinstall in the meantime makes its folders live data again.
    const installed = (await readAll()).all;
    if (installed.some((a) => sameApp(p, a))) return { error: 'still-installed' };
    const want = new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : []);
    const chosen = scan.candidates.filter((c) => want.has(c.id));
    if (!chosen.length) return { error: 'nothing-selected' };
    const machine = elevatedClean ? chosen.filter((c) => c.machine) : [];
    const normal = chosen.filter((c) => !machine.includes(c));

    const settings = await service.getSettings();
    const mode = settings.deleteMode;
    let run = null;
    const q = service.quarantine;
    if (mode === 'quarantine' && normal.length) {
      const wanted = normal.reduce((s, c) => s + c.size, 0);
      const used = await q.totalBytes();
      if (used + wanted > settings.quarantineLimitGB * GB) return { error: 'quarantine-limit', used, wanted, limit: settings.quarantineLimitGB * GB };
      run = await q.begin({ rules: [], app: p.name, source: 'uninstall', elevated: false }, now());
    }
    const remove = async (f) => (run ? q.moveFile(run, f.path, f.size, 'uninstall', f.mtimeMs) : fsp.unlink(f.path).then(() => true));

    const out = { ok: true, mode, runId: null, deleted: 0, freed: 0, failed: 0, refused: [] };
    for (const c of normal) {
      // Re-check each folder right before touching it: still where the scan saw it, still a plain folder/file.
      let st;
      try { st = await fsp.lstat(c.path); } catch { continue; } // already gone
      if (c.truncated || st.isSymbolicLink() || (c.isDir ? !st.isDirectory() : !st.isFile()) || !isOwnCandidate(c) || !(await isPlainDir(path.dirname(c.path))) || isExcluded(c.path)) {
        out.refused.push(c.id);
        continue;
      }
      const t = c.isDir ? await tree(c.path, isExcluded) : { files: [{ path: c.path, size: st.size, mtimeMs: st.mtimeMs }], dirs: [] };
      for (const f of t.files) {
        let ok = false;
        try { ok = await remove(f); } catch { ok = false; }
        if (ok) { out.deleted += 1; out.freed += f.size; } else out.failed += 1;
      }
      t.dirs.sort((a, b) => b.length - a.length);
      for (const d of t.dirs) { if (isExcluded(d)) continue; try { await fsp.rmdir(d); } catch { /* not empty or locked */ } }
      if (c.isDir) { try { await fsp.rmdir(c.path); } catch { /* something stayed */ } }
    }
    if (run) { const meta = await q.commit(run); out.runId = meta.removed ? null : run.id; }
    if (normal.length) await service.logEvent({ type: 'leftover', name: p.name, mode, runId: out.runId, deleted: out.deleted, freed: out.freed, failed: out.failed });

    // Machine-wide folders: one elevated job (UAC prompt). The helper is told the app and the ids, never paths.
    if (machine.length) {
      let own = [];
      try { own = (await service.listExclusions()).filter((e) => e.type === 'path'); } catch { own = []; }
      const e = await elevatedClean({ type: 'leftovers', app: { name: p.name, installLocation: p.installLocation || '' }, ids: machine.map((c) => c.id), others: [...othersOf(installed, p)], exclusions: own });
      if (e.status !== 'ok') out.admin = { status: e.status, error: e.error || '' };
      else if (e.result && e.result.error) out.admin = { status: 'refused', error: e.result.error };
      else out.admin = { status: 'ok', trashed: e.result.trashed, bytes: e.result.bytes, failed: e.result.failed };
    }

    // Look again: nothing left means the record can go.
    scans.delete(id);
    const again = await apps.findLeftovers(p, { env, isExcluded, others: othersOf(installed, p), extraProtected, keepDirs: keepDirsOf(installed, p) });
    if (again.length === 0) { await dropPending(id); out.done = true; } else scans.set(id, { at: now(), candidates: again });
    out.remaining = again.map(publicCandidate);
    return out;
  }

  const dismiss = async (id) => ({ ok: await dropPending(String(id)) });

  // A path from the renderer may be shown in Explorer only if the latest scan listed it.
  function revealable(p) {
    if (typeof p !== 'string') return null;
    const k = apps.norm(p);
    for (const s of scans.values()) for (const c of s.candidates) if (apps.norm(c.path) === k) return c.path;
    return null;
  }

  return { list, uninstall, leftovers, cleanLeftovers, dismiss, revealable };
}

module.exports = { createAppsService };
