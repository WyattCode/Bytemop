'use strict';
// Elevated side. Runs with administrator rights, so it trusts nothing from the caller:
//  - jobs name rules / runs, never paths;
//  - only rules marked requiresAdmin (from the rules shipped with the app) can be cleaned;
//  - the data folder comes from this process's own environment;
//  - restores may only write back inside the admin rules' own target folders, and only for runs
//    that were created by the helper (meta.elevated);
//  - leftover cleanup (machine-wide folders of an uninstalled app) is re-derived here from the app's name,
//    never from paths; ids pick among what the helper itself found, and everything goes to the Recycle Bin.
const net = require('net');
const path = require('path');
const { createService } = require('./clean-service');
const { expandEnv } = require('./cleaner');
const { loadPacks } = require('./rule-engine');
const fs = require('fs');
const apps = require('./apps');
const exclusions = require('./exclusions');
const { isPlainDir } = require('./pathsafe');

const RUN_ID_RE = /^[0-9A-Za-z-]+$/;

function dataDirFromEnv(env, fallback) {
  const base = env.LOCALAPPDATA || fallback;
  return base ? path.join(base, 'Bytemop') : null;
}

// Folders (no wildcards) that admin rules may touch, as absolute normalized paths.
function adminRoots(rules, env) {
  const roots = [];
  for (const r of rules) {
    for (const t of r.targets) {
      const p = expandEnv(t.path, env);
      if (p && !p.includes('*')) roots.push(path.resolve(p).toLowerCase());
    }
  }
  return roots;
}

function makeAllow(rules, env) {
  const roots = adminRoots(rules, env);
  return (dest) => {
    if (typeof dest !== 'string') return false;
    const d = path.resolve(dest).toLowerCase();
    return roots.some((r) => d === r || d.startsWith(r + path.sep));
  };
}

// Move the machine-wide leftovers of an uninstalled app to the Recycle Bin. The caller names the app and the
// leftover ids; the helper finds the candidates itself and refuses anything it cannot vouch for.
//   deps: { listInstalled() -> [{name, installLocation}], trashItem(path), canTrash(path,size), isSystemOwned(path),
//           machineEnv()? (real known-folder paths, not environment variables), confirm(list, name)? (the helper's own
//           dialog: the only UI that can be trusted to show what will really be removed), extraProtected? }
async function leftoversJob(job, { env, svc, deps }) {
  if (!deps) throw new Error('leftover cleanup is not available');
  const app = job.app;
  if (!app || typeof app.name !== 'string' || !app.name.trim() || app.name.length > 200) throw new Error('invalid app');
  const ids = Array.isArray(job.ids) ? [...new Set(job.ids.filter((x) => typeof x === 'string'))] : [];
  if (!ids.length) throw new Error('nothing selected');
  const name = app.name.trim();
  const installLocation = typeof app.installLocation === 'string' ? app.installLocation.slice(0, 400) : '';

  // The app must really be gone (read here, not taken on trust).
  const installed = await deps.listInstalled();
  const same = (a) => apps.normalizeName(a.name) === apps.normalizeName(name);
  if (installed.some(same)) return { error: 'still-installed' };
  const others = new Set(Array.isArray(job.others) ? job.others.filter((x) => typeof x === 'string' && x.length < 200) : []);
  for (const a of installed) {
    others.add(apps.normalizeName(a.name));
    for (const v of apps.nameVariants(a.name, a.installLocation)) others.add(v);
  }
  // Exclusions: the helper's own file (an unreadable one stops the job) plus whatever the caller saw.
  // The caller can only add protection this way: more exclusions never mean more deleted.
  const own = await svc.listExclusions();
  const extra = Array.isArray(job.exclusions) ? job.exclusions.filter((e) => e && e.type === 'path' && typeof e.value === 'string' && e.value.length < 500) : [];
  const isExcluded = exclusions.compile([...own, ...extra.map((e) => ({ type: 'path', value: e.value }))], env).isExcluded;

  // The machine-wide roots come from Windows' known folders, not from environment variables a caller could have set.
  const renv = deps.machineEnv ? { ...env, ...(await deps.machineEnv()) } : env;
  const keepDirs = installed.map((a) => a.installLocation).filter(Boolean);
  const found = (await apps.findLeftovers({ name, installLocation }, { env: renv, isExcluded, others, extraProtected: deps.extraProtected || [], keepDirs })).filter((c) => c.machine);
  const byId = new Map(found.map((c) => [c.id, c]));
  const out = { trashed: 0, bytes: 0, failed: [] };
  // Pass 1: every safety check. Pass 2: ask the user (in the helper's own dialog), then recycle.
  const eligible = [];
  for (const id of ids) {
    const c = byId.get(id);
    const fail = (reason) => out.failed.push({ id, reason });
    if (!c) { fail('not-found'); continue; }
    if (c.truncated) { fail('too-many'); continue; }
    if (c.keptByExclusion) { fail('has-excluded-files'); continue; } // a folder cannot be recycled with part of it kept
    if (apps.machineDenied(c, renv)) { fail('denied'); continue; }
    try {
      const st = fs.lstatSync(c.path);
      if (st.isSymbolicLink() || (c.isDir ? !st.isDirectory() : !st.isFile()) || !(await isPlainDir(path.dirname(c.path)))) { fail('changed'); continue; }
      if (await deps.isSystemOwned(c.path)) { fail('system-owned'); continue; }
      const can = await deps.canTrash(c.path, c.size);
      if (!can.ok) { fail(can.reason || 'no-recycle-bin'); continue; }
      eligible.push({ id, c });
    } catch (e) { fail(e && e.code === 'ENOENT' ? 'gone' : 'error'); }
  }
  if (eligible.length && deps.confirm) {
    let ok = false;
    try { ok = await deps.confirm(eligible.map(({ c }) => ({ path: c.path, size: c.size })), name); } catch { ok = false; }
    if (!ok) { for (const { id } of eligible) out.failed.push({ id, reason: 'declined' }); return out; }
  }
  for (const { id, c } of eligible) {
    try {
      // Look again right before the move: the folder may have been swapped since the checks.
      const st = fs.lstatSync(c.path);
      if (st.isSymbolicLink() || (c.isDir ? !st.isDirectory() : !st.isFile())) { out.failed.push({ id, reason: 'changed' }); continue; }
      await deps.trashItem(c.path);
      out.trashed += 1;
      out.bytes += c.size;
    } catch (e) { out.failed.push({ id, reason: e && e.code === 'ENOENT' ? 'gone' : 'error' }); }
  }
  if (out.trashed) await svc.logEvent({ type: 'leftover', name, mode: 'recycle', elevated: true, deleted: out.trashed, freed: out.bytes, failed: out.failed.length });
  return out;
}

// Execute one validated job. `allRules` is the full bundled rule list.
async function executeJob(job, { allRules, env = process.env, fallbackDir, now, deps } = {}) {
  if (!job || typeof job !== 'object') throw new Error('invalid job');
  // Same account only. When an administrator's password was typed for a standard user, this process has that
  // administrator's data folder and registry: it would neither see the user's exclusions and apps, nor put
  // quarantined files where the user can find them.
  if (job.caller !== undefined) {
    const norm = (p) => (typeof p === 'string' && p ? path.resolve(p).toLowerCase() : null);
    if (!norm(job.caller) || norm(job.caller) !== norm(env.USERPROFILE)) throw new Error('different-account');
  }
  const adminRules = allRules.filter((r) => r.requiresAdmin === true);
  const dataDir = dataDirFromEnv(env, fallbackDir);
  if (!dataDir) throw new Error('no data folder');
  const svc = createService({ dataDir, rules: adminRules, cleanerOpts: { env }, forceCopy: true, now });

  if (job.type === 'scan') {
    // Read-only: lets the UI show real sizes for rules the normal user cannot even list.
    return svc.scan();
  }

  if (job.type === 'clean') {
    const ids = Array.isArray(job.ruleIds) ? job.ruleIds.filter((x) => typeof x === 'string') : [];
    const valid = ids.filter((id) => adminRules.some((r) => r.id === id));
    if (valid.length === 0) throw new Error('no administrator rules selected');
    const mode = job.mode === 'permanent' || job.mode === 'quarantine' ? job.mode : undefined;
    return svc.clean(valid, { mode, elevated: true });
  }

  if (job.type === 'restore') {
    if (typeof job.runId !== 'string' || !RUN_ID_RE.test(job.runId)) throw new Error('invalid run id');
    const run = (await svc.runs()).find((r) => r.id === job.runId);
    if (!run) throw new Error('run not found');
    if (run.elevated !== true) throw new Error('run was not created by the administrator helper');
    return svc.restore(job.runId, { allow: makeAllow(adminRules, env) });
  }

  if (job.type === 'leftovers') return leftoversJob(job, { env, svc, deps });

  throw new Error('unknown job type');
}

// Connect to the caller's pipe, receive one job, run it, send the result, exit.
function runHelper({ pipe, token, allRules, env = process.env, fallbackDir, now, deps }) {
  return new Promise((resolve) => {
    const sock = net.connect(pipe);
    let buf = '';
    let handled = false;
    sock.setEncoding('utf8');
    sock.on('error', () => resolve(false));
    sock.on('close', () => resolve(handled));
    sock.on('connect', () => sock.write(JSON.stringify({ type: 'hello', token }) + '\n'));
    sock.on('data', async (chunk) => {
      buf += chunk;
      const i = buf.indexOf('\n');
      if (i < 0 || handled) return;
      handled = true;
      let msg;
      try { msg = JSON.parse(buf.slice(0, i)); } catch { sock.end(JSON.stringify({ type: 'error', error: 'bad message' }) + '\n'); return; }
      try {
        if (!msg.job || typeof msg.job !== 'object' || msg.job.caller === undefined) throw new Error('different-account'); // callers must say whose profile this is
        const result = await executeJob(msg.job, { allRules, env, fallbackDir, now, deps });
        sock.end(JSON.stringify({ type: 'result', result }) + '\n');
      } catch (e) {
        sock.end(JSON.stringify({ type: 'error', error: e.message }) + '\n');
      }
    });
  });
}

function parseArgs(argv) {
  const get = (name) => { const a = argv.find((x) => x.startsWith(name + '=')); return a ? a.slice(name.length + 1) : null; };
  return { pipe: get('--pipe'), token: get('--token') };
}

// Entry used by main.js (and by tests): load the shipped rules and run.
async function runHelperFromArgs(argv, { rulesDir, env = process.env, fallbackDir, now, deps } = {}) {
  const { pipe, token } = parseArgs(argv);
  if (!pipe || !token) return false;
  const loaded = loadPacks(rulesDir);
  return runHelper({ pipe, token, allRules: loaded.rules, env, fallbackDir, now, deps });
}

// Options for the helper's own confirmation dialog (shown by main.js with dialog.showMessageBox).
function leftoverConfirmOptions(locale, name, list) {
  const zh = String(locale).toLowerCase().startsWith('zh');
  const shown = list.slice(0, 12).map((x) => x.path);
  const more = list.length > 12 ? (zh ? `\n…另外 ${list.length - 12} 项` : `\n…and ${list.length - 12} more`) : '';
  return {
    type: 'warning', buttons: zh ? ['取消', '移到回收站'] : ['Cancel', 'Move to Recycle Bin'], defaultId: 0, cancelId: 0, noLink: true, title: 'Bytemop',
    message: zh ? `把“${name}”残留的 ${list.length} 个文件夹移到回收站？` : `Move ${list.length} leftover folder(s) of “${name}” to the Recycle Bin?`,
    detail: (zh ? '这个窗口由有管理员权限的程序显示，下面是它将要移动的位置：\n\n' : 'This window is shown by the administrator process. These are the locations it will move:\n\n') + shown.join('\n') + more,
  };
}

module.exports = { leftoverConfirmOptions, executeJob, runHelper, runHelperFromArgs, parseArgs, dataDirFromEnv, makeAllow };
