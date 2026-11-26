'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createService, sanitizeSettings } = require('../clean-service');
const { DEFAULT_SCHEDULE } = require('../scheduler');

const rules = [
  { id: 'cache', blockedByProcesses: ['fakebrowser.exe'], targets: [{ path: '%LOCALAPPDATA%\\App\\Cache', recurse: true }] },
];

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-svc-'));
  const local = path.join(base, 'Local');
  const cacheDir = path.join(local, 'App', 'Cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = (name, content) => { const p = path.join(cacheDir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };
  let running = new Set();
  const svc = createService({
    dataDir: path.join(base, 'data'),
    rules,
    recoverMinAgeMs: 0, // tests recover immediately; the real default waits so a live clean is left alone
    cleanerOpts: { env: { LOCALAPPDATA: local }, get running() { return running; } },
  });
  return { base, file, svc, setRunning: (s) => { running = s; } };
}

test('default is quarantine: files move, can be restored, history is written', async () => {
  const s = setup();
  const a = s.file('a.bin', 'aaaa');
  const b = s.file('sub/b.bin', 'bb');
  const out = await s.svc.clean(['cache']);
  assert.strictEqual(out.mode, 'quarantine');
  assert.strictEqual(out.totals.deleted, 2);
  assert.strictEqual(out.totals.freed, 6);
  assert.ok(out.runId);
  assert.ok(!fs.existsSync(a) && !fs.existsSync(b));

  const runs = await s.svc.runs();
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].bytes, 6);
  assert.ok(runs[0].expiresAt > Date.now());

  const r = await s.svc.restore(out.runId);
  assert.strictEqual(r.restored, 2);
  assert.strictEqual(fs.readFileSync(a, 'utf8'), 'aaaa');
  assert.strictEqual(fs.readFileSync(b, 'utf8'), 'bb');

  const types = (await s.svc.history()).map((e) => e.type);
  assert.deepStrictEqual(types, ['restore', 'clean'], 'newest first');
});

test('permanent mode deletes for good and creates no quarantine run', async () => {
  const s = setup();
  const a = s.file('a.bin', 'aaaa');
  await s.svc.setSettings({ deleteMode: 'permanent' });
  const out = await s.svc.clean(['cache']);
  assert.strictEqual(out.mode, 'permanent');
  assert.strictEqual(out.runId, null);
  assert.ok(!fs.existsSync(a));
  assert.strictEqual((await s.svc.runs()).length, 0);
});

test('a rule blocked by a running process is skipped and leaves no run behind', async () => {
  const s = setup();
  const a = s.file('a.bin', 'aaaa');
  s.setRunning(new Set(['fakebrowser.exe']));
  const out = await s.svc.clean(['cache']);
  assert.ok(out.results[0].skipped);
  assert.strictEqual(out.runId, null);
  assert.ok(fs.existsSync(a));
  assert.strictEqual((await s.svc.runs()).length, 0);
});

test('quarantine size limit blocks the clean and touches nothing', async () => {
  const s = setup();
  const a = s.file('a.bin', Buffer.alloc(2 * 1024 * 1024));
  // Smallest allowed limit is 1 GB, so pre-fill the quarantine accounting through a run.
  await s.svc.setSettings({ quarantineLimitGB: 1 });
  const q = s.svc.quarantine;
  const big = await q.begin();
  const fake = path.join(s.base, 'fake.bin');
  fs.writeFileSync(fake, 'x');
  await q.moveFile(big, fake, 1, 'r', 0);
  // Lie about the size in the journal-derived meta so the run counts as ~1 GB.
  const metaPath = path.join(q.runDir(big.id), 'meta.json');
  await q.commit(big);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.bytes = 1024 ** 3 - 10;
  fs.writeFileSync(metaPath, JSON.stringify(meta));
  const out = await s.svc.clean(['cache']);
  assert.strictEqual(out.error, 'quarantine-limit');
  assert.ok(fs.existsSync(a));
});

test('startup recovers interrupted runs and expires old ones', async () => {
  const s = setup();
  const a = s.file('a.bin', 'aaaa');
  const q = s.svc.quarantine;
  const run = await q.begin({ rules: ['cache'] });
  await q.moveFile(run, a, 4, 'cache', 0); // never committed
  const res = await s.svc.startup();
  assert.strictEqual(res.recovered, 1);
  const [r] = await s.svc.runs();
  assert.strictEqual(r.status, 'interrupted');
  await s.svc.restore(r.id);
  assert.ok(fs.existsSync(a));
});

test('settings are validated and persisted', async () => {
  const s = setup();
  assert.strictEqual((await s.svc.getSettings()).deleteMode, 'quarantine');
  assert.strictEqual((await s.svc.getSettings()).language, 'auto');
  const next = await s.svc.setSettings({ deleteMode: 'permanent', retentionDays: 14, quarantineLimitGB: 2, language: 'zh-CN' });
  assert.deepStrictEqual(next, { deleteMode: 'permanent', retentionDays: 14, quarantineLimitGB: 2, language: 'zh-CN', theme: 'auto', onboarded: false, schedule: DEFAULT_SCHEDULE });
  assert.deepStrictEqual(await s.svc.getSettings(), next);
  assert.deepStrictEqual(sanitizeSettings({ deleteMode: 'shred', retentionDays: 0, quarantineLimitGB: 'x', language: 'fr' }),
    { deleteMode: 'quarantine', retentionDays: 7, quarantineLimitGB: 5, language: 'auto', theme: 'auto', onboarded: false, schedule: DEFAULT_SCHEDULE });
});

test('the generic settings call cannot change the schedule; setSchedule can, with validation', async () => {
  const s = setup();
  await s.svc.setSettings({ schedule: { enabled: true, mode: 'clean' }, language: 'en' });
  assert.strictEqual((await s.svc.getSettings()).schedule.enabled, false);
  assert.strictEqual((await s.svc.getSettings()).language, 'en');
  const sch = await s.svc.setSchedule({ enabled: true, mode: 'clean', time: '25:99', frequency: 'hourly' });
  assert.strictEqual(sch.schedule.enabled, true);
  assert.strictEqual(sch.schedule.mode, 'clean');
  assert.strictEqual(sch.schedule.time, DEFAULT_SCHEDULE.time, 'invalid time is ignored');
  assert.strictEqual(sch.schedule.frequency, DEFAULT_SCHEDULE.frequency, 'invalid frequency is ignored');
  await s.svc.setSettings({ retentionDays: 3 });
  assert.strictEqual((await s.svc.getSettings()).schedule.mode, 'clean', 'other settings keep the schedule');
});

test('settings and exclusions files with a byte-order mark are still read (hand-edited files must not reset everything)', async () => {
  const s = setup();
  const dir = path.join(s.base, 'data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), '﻿' + JSON.stringify({ deleteMode: 'permanent', retentionDays: 21, schedule: { enabled: true, mode: 'clean' } }));
  fs.writeFileSync(path.join(dir, 'exclusions.json'), '﻿' + JSON.stringify([{ id: 'a', type: 'rule', value: 'cache' }]));
  const st = await s.svc.getSettings();
  assert.strictEqual(st.deleteMode, 'permanent');
  assert.strictEqual(st.retentionDays, 21);
  assert.strictEqual(st.schedule.mode, 'clean');
  assert.strictEqual((await s.svc.listExclusions()).length, 1);
});

test('details groups the biggest items per first folder and is read-only', async () => {
  const s = setup();
  s.file('big\\a.bin', Buffer.alloc(300));
  s.file('big\\deep\\b.bin', Buffer.alloc(200));
  s.file('small\\c.bin', Buffer.alloc(10));
  s.file('loose.bin', Buffer.alloc(50));
  const d = await s.svc.details('cache');
  assert.strictEqual(d.count, 4);
  assert.strictEqual(d.bytes, 560);
  assert.deepStrictEqual(d.entries.map((e) => [e.name, e.bytes, e.isDir]), [['big', 500, true], ['loose.bin', 50, false], ['small', 10, true]]);
  assert.strictEqual(d.roots.length, 1);
  assert.strictEqual(await s.svc.details('nope'), null);
  assert.strictEqual((await s.svc.scan())[0].count, 4, 'nothing was deleted');
});

test('disk reports free and total bytes for a real drive', async () => {
  const s = setup();
  const d = await s.svc.disk();
  assert.ok(d.total > 0 && d.free >= 0 && d.free <= d.total);
  assert.strictEqual(d.used, d.total - d.free);
});

test('unknown rule ids are ignored', async () => {
  const s = setup();
  const out = await s.svc.clean(['does-not-exist', 42]);
  assert.deepStrictEqual(out.results, []);
});

test('concurrent settings and schedule changes do not overwrite each other', async () => {
  const s = setup();
  await Promise.all([
    s.svc.setSettings({ retentionDays: 30 }),
    s.svc.setSchedule({ enabled: true, mode: 'clean' }),
    s.svc.setSettings({ language: 'en' }),
  ]);
  const st = await s.svc.getSettings();
  assert.strictEqual(st.retentionDays, 30);
  assert.strictEqual(st.language, 'en');
  assert.strictEqual(st.schedule.enabled, true);
  assert.strictEqual(st.schedule.mode, 'clean');
});

test('concurrent exclusion changes are all stored, and no temp files are left behind', async () => {
  const s = setup();
  const dir = path.join(s.base, 'Local');
  const res = await Promise.all([1, 2, 3, 4, 5].map((i) => s.svc.addExclusion({ type: 'path', value: path.join(dir, 'keep' + i) })));
  assert.ok(res.every((r) => r.ok));
  assert.strictEqual((await s.svc.listExclusions()).length, 5);
  const entries = await s.svc.listExclusions();
  await Promise.all(entries.slice(0, 3).map((e) => s.svc.removeExclusion(e.id)));
  assert.strictEqual((await s.svc.listExclusions()).length, 2);
  assert.deepStrictEqual(fs.readdirSync(path.join(s.base, 'data')).filter((f) => f.endsWith('.tmp')), []);
});

test('a damaged settings file falls back to defaults but a copy is kept', async () => {
  const s = setup();
  const dir = path.join(s.base, 'data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"retentionDays": 30, "sched');
  assert.strictEqual((await s.svc.getSettings()).retentionDays, 7);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'settings.json.bak'), 'utf8'), '{"retentionDays": 30, "sched');
});

test('the history file is trimmed when it grows too large', async () => {
  const s = setup();
  await s.svc.logEvent({ type: 'x', blob: 'a'.repeat(2.2 * 1024 * 1024) });
  for (let i = 0; i < 3; i++) await s.svc.logEvent({ type: 'y', i });
  const events = await s.svc.history(5000);
  assert.ok(events.length <= 4 && events.length >= 3);
  assert.ok(fs.statSync(path.join(s.base, 'data', 'history.jsonl')).size < 1024 * 1024);
});

test('history problems never fail the operation that was already done', async () => {
  const s = setup();
  s.file('a.bin', 'aaaa');
  fs.mkdirSync(path.join(s.base, 'data'), { recursive: true });
  fs.mkdirSync(path.join(s.base, 'data', 'history.jsonl')); // a directory where the file should be: appends fail
  const out = await s.svc.clean(['cache']);
  assert.strictEqual(out.totals.deleted, 1);
  assert.ok(out.runId);
});

test('startup leaves a run that is still active alone, and recovers it once it is old', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-svc-'));
  let now = Date.now();
  const svc = createService({ dataDir: path.join(base, 'data'), rules, now: () => now, cleanerOpts: { env: { LOCALAPPDATA: path.join(base, 'L') } } });
  const f = path.join(base, 'x.bin');
  fs.writeFileSync(f, 'data');
  const run = await svc.quarantine.begin({ rules: ['cache'] }, now);
  await svc.quarantine.moveFile(run, f, 4, 'cache', 0);
  assert.strictEqual((await svc.startup()).recovered, 0, 'young in-progress run belongs to a live clean');
  now += 11 * 60 * 1000;
  assert.strictEqual((await svc.startup()).recovered, 1);
});

test('theme and the first-run flag are validated and persisted', async () => {
  const s = setup();
  const d = await s.svc.getSettings();
  assert.deepStrictEqual([d.theme, d.onboarded], ['auto', false]);
  await s.svc.setSettings({ theme: 'dark', onboarded: true });
  assert.deepStrictEqual([(await s.svc.getSettings()).theme, (await s.svc.getSettings()).onboarded], ['dark', true]);
  await s.svc.setSettings({ theme: 'neon', onboarded: 'yes' }); // invalid values are ignored
  assert.deepStrictEqual([(await s.svc.getSettings()).theme, (await s.svc.getSettings()).onboarded], ['dark', true]);
  await s.svc.setSettings({ language: 'en' }); // unrelated saves keep them
  assert.deepStrictEqual([(await s.svc.getSettings()).theme, (await s.svc.getSettings()).onboarded], ['dark', true]);
  assert.strictEqual(sanitizeSettings({ theme: 'light' }).theme, 'light');
});
