'use strict';
// Orchestrates scan / clean / restore on top of cleaner + quarantine, and owns settings and history.
// No Electron imports: main.js only wires IPC to this.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const cleaner = require('./cleaner');
const exclusions = require('./exclusions');
const { Quarantine, DAY_MS } = require('./quarantine');
const { sanitizeSchedule, DEFAULT_SCHEDULE } = require('./scheduler');
const { atomicWrite, createQueue } = require('./atomic');

const GB = 1024 ** 3;
const DEFAULT_SETTINGS = { deleteMode: 'quarantine', retentionDays: 7, quarantineLimitGB: 5, language: 'auto', theme: 'auto', onboarded: false, schedule: DEFAULT_SCHEDULE };

function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const s = { ...base, schedule: sanitizeSchedule(input && input.schedule, base.schedule) };
  if (input && ['auto', 'zh-CN', 'en'].includes(input.language)) s.language = input.language;
  if (input && ['auto', 'light', 'dark'].includes(input.theme)) s.theme = input.theme;
  if (input && typeof input.onboarded === 'boolean') s.onboarded = input.onboarded;
  if (input && ['quarantine', 'permanent'].includes(input.deleteMode)) s.deleteMode = input.deleteMode;
  if (input && Number.isInteger(input.retentionDays) && input.retentionDays >= 1 && input.retentionDays <= 90) s.retentionDays = input.retentionDays;
  if (input && Number.isFinite(input.quarantineLimitGB) && input.quarantineLimitGB >= 1 && input.quarantineLimitGB <= 100) s.quarantineLimitGB = input.quarantineLimitGB;
  return s;
}

const HISTORY_MAX_BYTES = 2 * 1024 * 1024;
const HISTORY_KEEP_LINES = 2000;
// A run still 'in-progress' this long after its last activity is treated as crashed. Younger ones may be
// a clean running right now in another process (e.g. the scheduled task), so they are left alone.
const RECOVER_MIN_AGE_MS = 10 * 60 * 1000;

function createService({ dataDir, rules, cleanerOpts = {}, now = () => Date.now(), forceCopy = false, recoverMinAgeMs = RECOVER_MIN_AGE_MS, implicitExclusions = [] }) {
  const serial = createQueue(); // settings and exclusions are read-modify-write: never let them overlap
  const q = new Quarantine(path.join(dataDir, 'quarantine'), { forceCopy });
  const settingsFile = path.join(dataDir, 'settings.json');
  const historyFile = path.join(dataDir, 'history.jsonl');
  const exclusionsFile = path.join(dataDir, 'exclusions.json');
  const byId = new Map(rules.map((r) => [r.id, r]));

  // Files edited by hand (Notepad, PowerShell 5) often start with a byte-order mark; JSON.parse rejects it,
  // which would silently reset the user's settings. Strip it.
  const readJson = async (file) => JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^﻿/, ''));

  // {settings, transient}: 'transient' is set when the file could not be read for a reason that may pass (antivirus
  // lock, concurrent rename). Defaults are fine to *show* then, but must never be written over the real file.
  async function readSettings() {
    try { return { settings: sanitizeSettings(await readJson(settingsFile)) }; } catch (e) {
      if (e && e.code === 'ENOENT') return { settings: { ...DEFAULT_SETTINGS } };
      if (e instanceof SyntaxError) { // damaged for good: fall back to defaults, keep a copy so the values are not lost
        await fsp.copyFile(settingsFile, settingsFile + '.bak').catch(() => {});
        return { settings: { ...DEFAULT_SETTINGS } };
      }
      return { settings: { ...DEFAULT_SETTINGS }, transient: e };
    }
  }
  async function getSettings() { return (await readSettings()).settings; }
  async function readSettingsForWrite() {
    const r = await readSettings();
    if (r.transient) throw new Error('settings-unreadable');
    return r.settings;
  }

  async function writeSettings(next) {
    await fsp.mkdir(dataDir, { recursive: true });
    await atomicWrite(settingsFile, JSON.stringify(next, null, 2));
    return next;
  }

  // General settings. The schedule is deliberately not accepted here: it only changes together with
  // the Windows task (see setSchedule), so the two cannot drift apart.
  async function setSettings(patch) {
    const { schedule, ...rest } = patch || {};
    return serial(async () => writeSettings(sanitizeSettings(rest, await readSettingsForWrite())));
  }

  async function setSchedule(patch) {
    return serial(async () => {
      const cur = await readSettingsForWrite();
      return writeSettings({ ...cur, schedule: sanitizeSchedule(patch, cur.schedule) });
    });
  }

  // History is append-only JSON lines: one event per line. It is a convenience record: failing to
  // write it must never fail (or hide) the operation that already happened. The file is trimmed when big.
  async function logEvent(event) {
    try {
      await fsp.mkdir(dataDir, { recursive: true });
      await fsp.appendFile(historyFile, JSON.stringify({ ts: now(), ...event }) + '\n');
      if ((await fsp.stat(historyFile)).size > HISTORY_MAX_BYTES) {
        const lines = (await fsp.readFile(historyFile, 'utf8')).split('\n').filter(Boolean);
        const keep = [];
        let bytes = 0;
        for (let i = lines.length - 1; i >= 0 && keep.length < HISTORY_KEEP_LINES; i--) {
          bytes += lines[i].length + 1;
          if (bytes > HISTORY_MAX_BYTES / 2) break;
          keep.unshift(lines[i]);
        }
        await atomicWrite(historyFile, keep.join('\n') + (keep.length ? '\n' : ''));
      }
    } catch { /* ignore */ }
  }

  async function history(limit = 200) {
    let text;
    try { text = await fsp.readFile(historyFile, 'utf8'); } catch { return []; }
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch { /* torn line */ }
    }
    return out.slice(-limit).reverse();
  }

  function choose(ids) {
    const set = new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : []);
    return [...set].map((id) => byId.get(id)).filter(Boolean);
  }

  // ----- exclusions: stored next to the settings; read fresh on every operation so the
  // elevated helper (a separate process) always honours the latest list. -----
  // Fails closed: an exclusions file that exists but cannot be read must stop the operation, not mean
  // 'nothing is excluded' (that would clean files the user said to keep).
  async function listExclusions() {
    let arr;
    try { arr = await readJson(exclusionsFile); } catch (e) {
      if (e && e.code === 'ENOENT') return [];
      throw new Error('exclusions-unreadable');
    }
    if (!Array.isArray(arr)) throw new Error('exclusions-unreadable');
    return arr.filter((e) => e && typeof e.id === 'string' && typeof e.value === 'string' && (e.type === 'path' || e.type === 'rule'));
  }

  async function saveExclusions(list) {
    await fsp.mkdir(dataDir, { recursive: true });
    await atomicWrite(exclusionsFile, JSON.stringify(list, null, 2));
  }

  // Returns {ok:true, entry, duplicate} or {ok:false, error}.
  async function addExclusion(input) {
    const v = exclusions.validate(input, new Set(byId.keys()));
    if (!v.ok) return v;
    const res = await serial(async () => {
      const list = await listExclusions();
      const dup = list.find((e) => exclusions.sameEntry(e, v.entry));
      if (dup) return { ok: true, entry: dup, duplicate: true };
      if (list.length >= exclusions.MAX_EXCLUSIONS) return { ok: false, error: 'too-many' };
      const entry = { id: crypto.randomBytes(6).toString('hex'), ...v.entry, addedAt: now() };
      await saveExclusions([...list, entry]);
      return { ok: true, entry, duplicate: false };
    });
    if (res.ok && !res.duplicate) await logEvent({ type: 'exclude', exType: res.entry.type, value: res.entry.value });
    return res;
  }

  async function removeExclusion(id) {
    const gone = await serial(async () => {
      const list = await listExclusions();
      const found = list.find((e) => e.id === id);
      if (!found) return null;
      await saveExclusions(list.filter((e) => e.id !== id));
      return found;
    });
    if (!gone) return false;
    await logEvent({ type: 'unexclude', exType: gone.type, value: gone.value });
    return true;
  }

  // The exclusions file is unreadable and every operation stops (fail closed): let the user start over. The damaged
  // file is kept as exclusions.json.bak. Nothing happens if the file turns out to be readable after all.
  async function repairExclusions() {
    return serial(async () => {
      try { await listExclusions(); return { ok: true, repaired: false }; } catch { /* really unreadable */ }
      await fsp.copyFile(exclusionsFile, exclusionsFile + '.bak').catch(() => {});
      await saveExclusions([]);
      await logEvent({ type: 'exRepair' });
      return { ok: true, repaired: true };
    });
  }

  async function exState() {
    const list = [...(await listExclusions()), ...implicitExclusions.map((value) => ({ id: 'implicit', type: 'path', value }))];
    const c = exclusions.compile(list, cleanerOpts.env || process.env);
    return { opts: { ...cleanerOpts, isExcluded: c.isExcluded }, rules: c.rules };
  }

  // Scan everything; rules the user excluded are reported as such and not scanned.
  async function scan() {
    const ex = await exState();
    const live = rules.filter((r) => !ex.rules.has(r.id));
    const res = new Map((await cleaner.scan(live, ex.opts)).map((r) => [r.id, r]));
    return rules.map((r) => (ex.rules.has(r.id) ? { id: r.id, bytes: 0, count: 0, blockedBy: [], excluded: true } : res.get(r.id)));
  }

  async function details(id) {
    const rule = byId.get(String(id));
    if (!rule) return null;
    const ex = await exState();
    return cleaner.details(rule, ex.opts);
  }

  // Free/total bytes of the system drive for the overview page.
  async function disk() {
    const root = path.parse(process.env.SystemRoot || dataDir).root || dataDir;
    const s = await fsp.statfs(root);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { root, total, free, used: total - free };
  }

  // Clean the chosen rules. Returns {mode, runId?, results, totals} or {error, ...} when the
  // quarantine limit would be exceeded (the caller can then ask the user what to do).
  async function clean(ids, { mode, elevated = false } = {}) {
    const requested = choose(ids);
    const ex = await exState();
    const excludedResults = requested.filter((r) => ex.rules.has(r.id))
      .map((r) => ({ id: r.id, deleted: 0, freed: 0, failed: 0, skipped: true, reason: 'excluded', blockedBy: [] }));
    const chosen = requested.filter((r) => !ex.rules.has(r.id));
    if (chosen.length === 0) return { mode: null, results: excludedResults, totals: { deleted: 0, freed: 0, failed: 0 } };
    const settings = await getSettings();
    mode = mode || settings.deleteMode;

    let run = null;
    let opts = { ...ex.opts };
    if (mode === 'quarantine') {
      // Only rules that will really run: one blocked by a running browser moves nothing, so it must not count.
      const wanted = (await cleaner.scan(chosen, ex.opts)).filter((r) => r.blockedBy.length === 0).reduce((s, r) => s + r.bytes, 0);
      const used = await q.totalBytes();
      if (used + wanted > settings.quarantineLimitGB * GB) {
        return { error: 'quarantine-limit', used, wanted, limit: settings.quarantineLimitGB * GB };
      }
      run = await q.begin({ rules: chosen.map((r) => r.id), elevated }, now());
      opts.remover = { remove: (it, rule) => q.moveFile(run, it.path, it.size, rule.id, it.mtimeMs) };
    }

    const results = [...(await cleaner.clean(chosen, opts)), ...excludedResults];
    const totals = results.reduce((t, r) => ({ deleted: t.deleted + r.deleted, freed: t.freed + r.freed, failed: t.failed + r.failed }), { deleted: 0, freed: 0, failed: 0 });
    let runId = null;
    if (run) {
      const meta = await q.commit(run);
      runId = meta.removed ? null : run.id;
    }
    await logEvent({ type: 'clean', mode, runId, rules: chosen.map((r) => r.id), ...totals });
    return { mode, runId, results, totals };
  }

  async function runs() {
    const s = await getSettings();
    return (await q.list()).map((r) => ({ ...r, expiresAt: r.createdAt + s.retentionDays * DAY_MS }));
  }

  async function restore(runId, opts) {
    const res = await q.restore(runId, opts);
    await logEvent({ type: 'restore', runId, ...res });
    return res;
  }

  async function purge(runId) {
    const freed = await q.purge(runId);
    await logEvent({ type: 'purge', runId, freed });
    return freed;
  }

  async function purgeAll() {
    const freed = await q.purgeAll();
    await logEvent({ type: 'purge', runId: null, freed });
    return freed;
  }

  // Call at startup: finish interrupted runs, then drop expired ones.
  async function startup() {
    const recovered = await q.recover(recoverMinAgeMs, now());
    for (const m of recovered) await logEvent({ type: 'recover', runId: m.id, count: m.count, bytes: m.bytes });
    const s = await getSettings();
    // A clock that jumped (dead CMOS battery, a bad time sync) must not make every quarantined file "expired".
    const clockOk = await clockLooksRight(now());
    const expired = clockOk ? await q.purgeExpired(s.retentionDays, now()) : [];
    for (const e of expired) await logEvent({ type: 'expire', runId: e.id, freed: e.bytes });
    return { recovered: recovered.length, expired: expired.length, clockOk };
  }

  // Compares "now" with the newest time this app has seen. Going back more than a day, or ahead by more than a
  // year, is suspicious: expiry is skipped. A big jump ahead is accepted once a later start agrees with it (the
  // user really was away that long); a jump back is never accepted until time catches up.
  async function clockLooksRight(nowMs) {
    const file = path.join(dataDir, 'lastseen.json');
    let st = {};
    try { st = JSON.parse(await fsp.readFile(file, 'utf8')) || {}; } catch { /* first start, or unreadable */ }
    const save = (v) => atomicWrite(file, JSON.stringify(v)).catch(() => {});
    const DAY = 24 * 3600 * 1000;
    if (!Number.isFinite(st.ts)) { await save({ ts: nowMs }); return true; }
    if (nowMs < st.ts - DAY) return false;
    if (nowMs > st.ts + 366 * DAY) {
      const p = st.pending;
      if (p && Number.isFinite(p.ts) && nowMs >= p.ts && nowMs < p.ts + 366 * DAY) { await save({ ts: nowMs }); return true; }
      await save({ ts: st.ts, pending: { ts: nowMs } });
      return false;
    }
    await save({ ts: nowMs });
    return true;
  }

  return { logEvent, scan, details, disk, clean, listExclusions, repairExclusions, addExclusion, removeExclusion, runs, restore, purge, purgeAll, startup, history, getSettings, setSettings, setSchedule, quarantine: q };
}

module.exports = { createService, DEFAULT_SETTINGS, sanitizeSettings };
