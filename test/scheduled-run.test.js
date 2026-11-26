'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScheduled } = require('../scheduled-run');
const { createService } = require('../clean-service');
const { message, resolveLocale, formatBytes } = require('../notify-text');

const rule = (id, extra = {}) => ({
  id, risk: 'safe', defaultSelected: true, requiresAdmin: false,
  targets: [{ path: `%LOCALAPPDATA%\\${id}`, recurse: true }], ...extra,
});
const RULES = [
  rule('safe-cache'),
  rule('caution-thing', { risk: 'caution', defaultSelected: false }),
  rule('manual-safe', { defaultSelected: false }),
  rule('admin-thing', { requiresAdmin: true }),
  rule('busy-app', { blockedByProcesses: ['busyapp.exe'] }),
];

function setup({ running = new Set(), schedule = {}, settings = {}, disk } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-sr-'));
  const local = path.join(base, 'Local');
  const file = (rel, size = 100) => { const p = path.join(local, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.alloc(size, 1)); return p; };
  const svc = createService({ dataDir: path.join(base, 'data'), rules: RULES, cleanerOpts: { env: { LOCALAPPDATA: local }, running } });
  const sent = [];
  const notify = (m) => sent.push(m);
  if (disk) svc.disk = async () => disk;
  const prep = async () => { await svc.setSettings(settings); await svc.setSchedule({ enabled: true, ...schedule }); };
  return { base, local, file, svc, sent, notify, prep };
}

const run = (s, locale = 'en') => runScheduled({ service: s.svc, rules: RULES, locale, notify: s.notify, minNotifyBytes: 0 });

test('scan mode only notifies; nothing is deleted', async () => {
  const s = setup({ schedule: { mode: 'scan', lowDiskAlert: false } });
  const f = s.file('safe-cache\\a.bin', 2048);
  await s.prep();
  const r = await run(s);
  assert.strictEqual(r.found, 2048);
  assert.strictEqual(r.cleaned, null);
  assert.ok(fs.existsSync(f));
  assert.strictEqual(s.sent.length, 1);
  assert.match(s.sent[0].title, /found/i);
  assert.match(s.sent[0].body, /2\.0 KB/);
});

test('clean mode moves only safe, default, non-admin rules to quarantine and notifies', async () => {
  const s = setup({ schedule: { mode: 'clean', lowDiskAlert: false } });
  const safe = s.file('safe-cache\\a.bin', 1000);
  const caution = s.file('caution-thing\\b.bin');
  const manual = s.file('manual-safe\\c.bin');
  const admin = s.file('admin-thing\\d.bin');
  await s.prep();
  const r = await run(s);
  assert.strictEqual(r.cleaned.deleted, 1);
  assert.strictEqual(r.cleaned.freed, 1000);
  assert.ok(!fs.existsSync(safe));
  for (const f of [caution, manual, admin]) assert.ok(fs.existsSync(f), path.basename(f) + ' must be left alone');
  const runs = await s.svc.runs();
  assert.strictEqual(runs.length, 1, 'cleaned into the quarantine, restorable');
  assert.strictEqual(r.runId, runs[0].id);
  assert.strictEqual(s.sent.length, 1);
  assert.match(s.sent[0].title, /cleaned/i);
  await s.svc.restore(runs[0].id);
  assert.ok(fs.existsSync(safe));
});

test('unattended clean never deletes permanently, even if the user chose permanent delete', async () => {
  const s = setup({ settings: { deleteMode: 'permanent' }, schedule: { mode: 'clean', lowDiskAlert: false } });
  const f = s.file('safe-cache\\a.bin', 500);
  await s.prep();
  assert.strictEqual((await s.svc.getSettings()).deleteMode, 'permanent');
  const r = await run(s);
  assert.ok(!fs.existsSync(f));
  assert.strictEqual((await s.svc.runs()).length, 1, 'still went to the quarantine');
  assert.ok(r.runId);
});

test('user exclusions and running programs are respected', async () => {
  const s = setup({ running: new Set(['busyapp.exe']), schedule: { mode: 'clean', lowDiskAlert: false } });
  const kept = s.file('safe-cache\\keep\\k.bin', 300);
  const gone = s.file('safe-cache\\g.bin', 100);
  const busy = s.file('busy-app\\x.bin');
  await s.svc.addExclusion({ type: 'path', value: path.join(s.local, 'safe-cache', 'keep') });
  await s.prep();
  const r = await run(s);
  assert.strictEqual(r.cleaned.deleted, 1);
  assert.ok(fs.existsSync(kept) && fs.existsSync(busy));
  assert.ok(!fs.existsSync(gone));
});

test('an excluded rule is not cleaned or counted', async () => {
  const s = setup({ schedule: { mode: 'clean', lowDiskAlert: false } });
  const f = s.file('safe-cache\\a.bin', 100);
  await s.svc.addExclusion({ type: 'rule', value: 'safe-cache' });
  await s.prep();
  const r = await run(s);
  assert.strictEqual(r.found, 0);
  assert.ok(fs.existsSync(f));
  assert.strictEqual(s.sent.length, 0);
});

test('nothing to report means no notification, but the run is still logged', async () => {
  const s = setup({ schedule: { mode: 'scan', lowDiskAlert: false } });
  await s.prep();
  const r = await run(s);
  assert.strictEqual(s.sent.length, 0);
  assert.strictEqual(r.found, 0);
  const ev = (await s.svc.history())[0];
  assert.strictEqual(ev.type, 'scheduled');
  assert.strictEqual(ev.found, 0);
});

test('a full quarantine stops the auto-clean, touches nothing and says so', async () => {
  const s = setup({ settings: { quarantineLimitGB: 1 }, schedule: { mode: 'clean', lowDiskAlert: false } });
  const f = s.file('safe-cache\\a.bin', 100);
  await s.prep();
  const q = s.svc.quarantine;
  const big = await q.begin();
  const fake = path.join(s.base, 'fake.bin');
  fs.writeFileSync(fake, 'x');
  await q.moveFile(big, fake, 1, 'r', 0);
  await q.commit(big);
  const metaPath = path.join(q.runDir(big.id), 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  fs.writeFileSync(metaPath, JSON.stringify({ ...meta, bytes: 1024 ** 3 - 10 }));
  const r = await run(s);
  assert.strictEqual(r.error, 'quarantine-limit');
  assert.ok(fs.existsSync(f));
  assert.match(s.sent[0].title, /could not/i);
});

test('low disk space triggers its own notification; plenty of space does not', async () => {
  const GB = 1024 ** 3;
  const low = setup({ schedule: { mode: 'scan', lowDiskAlert: true, lowDiskGB: 15 }, disk: { root: 'C:\\', total: 100 * GB, free: 8 * GB, used: 92 * GB } });
  await low.prep();
  const r = await run(low);
  assert.strictEqual(r.lowDisk, true);
  assert.strictEqual(low.sent.length, 1);
  assert.match(low.sent[0].body, /C has only 8\.0 GB left \(8%\)/);

  const ok = setup({ schedule: { mode: 'scan', lowDiskAlert: true, lowDiskGB: 15 }, disk: { root: 'C:\\', total: 100 * GB, free: 50 * GB, used: 50 * GB } });
  await ok.prep();
  assert.strictEqual((await run(ok)).lowDisk, false);
  assert.strictEqual(ok.sent.length, 0);

  const off = setup({ schedule: { mode: 'scan', lowDiskAlert: false }, disk: { root: 'C:\\', total: 100 * GB, free: 1 * GB, used: 99 * GB } });
  await off.prep();
  assert.strictEqual((await run(off)).lowDisk, false);
});

test('a failing scan is recorded, not thrown, and the disk check still runs', async () => {
  const GB = 1024 ** 3;
  const s = setup({ schedule: { mode: 'scan', lowDiskAlert: true, lowDiskGB: 15 }, disk: { root: 'C:\\', total: 100 * GB, free: 1 * GB, used: 99 * GB } });
  await s.prep();
  s.svc.scan = async () => { throw new Error('disk exploded'); };
  const r = await run(s);
  assert.strictEqual(r.error, 'disk exploded');
  assert.strictEqual(r.lowDisk, true);
  assert.strictEqual((await s.svc.history())[0].error, 'disk exploded');
});

test('Chinese notifications read correctly and the language setting decides', async () => {
  const s = setup({ schedule: { mode: 'scan', lowDiskAlert: false } });
  s.file('safe-cache\\a.bin', 5 * 1024 * 1024);
  await s.prep();
  await run(s, 'zh-CN');
  assert.strictEqual(s.sent[0].title, 'Bytemop 发现可清理内容');
  assert.ok(s.sent[0].body.startsWith('5.0 MB 可以安全清理'));
  assert.strictEqual(resolveLocale('auto', 'zh-CN'), 'zh-CN');
  assert.strictEqual(resolveLocale('auto', 'en-US'), 'en');
  assert.strictEqual(resolveLocale('en', 'zh-CN'), 'en');
  assert.strictEqual(resolveLocale('zh-CN', 'en-US'), 'zh-CN');
  assert.strictEqual(formatBytes(1536), '1.5 KB');
  assert.strictEqual(message('xx', 'test').title, 'Bytemop test notification', 'unknown locale falls back to English');
});

test('a leftover task does nothing when the schedule is switched off', async () => {
  const s = setup({ schedule: { mode: 'clean', lowDiskAlert: true } });
  const f = s.file('safe-cache\\a.bin', 500);
  await s.prep();
  await s.svc.setSchedule({ enabled: false });
  const r = await run(s);
  assert.strictEqual(r.skipped, true);
  assert.ok(fs.existsSync(f));
  assert.strictEqual(s.sent.length, 0);
  assert.strictEqual((await s.svc.history()).length, 0);
});

test('byte sizes never print as 1024 of a unit', () => {
  assert.strictEqual(formatBytes(1024 * 1024 - 1), '1.0 MB');
  assert.strictEqual(formatBytes(1024 ** 3 - 100), '1.0 GB');
});
