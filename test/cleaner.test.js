'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scan, clean, isSafeRoot, expandEnv, nameAllowed } = require('../cleaner');
const { backdate } = require('./backdate');

function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-test-'));
  const local = path.join(base, 'Local');
  const mk = (rel, size, ageHours = 0) => {
    const p = path.join(local, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.alloc(size, 1));
    if (ageHours) { const t = new Date(Date.now() - ageHours * 3600 * 1000); backdate(p, t); }
    return p;
  };
  return { base, local, mk, env: { LOCALAPPDATA: local, TEMP: path.join(local, 'Temp') } };
}

const rules = [
  { id: 'cache', blockedByProcesses: ['fakebrowser.exe'],
    targets: [{ path: '%LOCALAPPDATA%\\App\\User Data\\*\\Cache', recurse: true }] },
  { id: 'temp', minAgeHours: 24, targets: [{ path: '%TEMP%', recurse: true }] },
];
const byId = (arr, id) => arr.find((x) => x.id === id);

test('scan sums sizes across glob-matched profiles and honours min age', async () => {
  const s = sandbox();
  s.mk('App\\User Data\\Default\\Cache\\a', 100);
  s.mk('App\\User Data\\Profile 1\\Cache\\sub\\b', 200);
  s.mk('App\\User Data\\Default\\Bookmarks', 999); // must not be touched
  s.mk('Temp\\old.tmp', 50, 48);
  s.mk('Temp\\new.tmp', 70, 0);
  const r = await scan(rules, { env: s.env, running: new Set() });
  assert.strictEqual(byId(r, 'cache').bytes, 300);
  assert.strictEqual(byId(r, 'temp').bytes, 50);
});

test('clean deletes only matched files and leaves the rest', async () => {
  const s = sandbox();
  const keep = s.mk('App\\User Data\\Default\\Bookmarks', 10);
  s.mk('App\\User Data\\Default\\Cache\\sub\\a', 100);
  const old = s.mk('Temp\\old.tmp', 50, 48);
  const fresh = s.mk('Temp\\new.tmp', 70, 0);
  const res = await clean(rules, { env: s.env, running: new Set() });
  assert.strictEqual(byId(res, 'cache').freed, 100);
  assert.ok(fs.existsSync(keep));
  assert.ok(!fs.existsSync(old));
  assert.ok(fs.existsSync(fresh));
  assert.ok(fs.existsSync(path.join(s.local, 'App', 'User Data', 'Default', 'Cache')), 'root dir kept');
  assert.ok(!fs.existsSync(path.join(s.local, 'App', 'User Data', 'Default', 'Cache', 'sub')), 'empty subdir removed');
});

test('clean skips a rule while its process is running', async () => {
  const s = sandbox();
  const f = s.mk('App\\User Data\\Default\\Cache\\a', 100);
  const res = await clean(rules, { env: s.env, running: new Set(['fakebrowser.exe']) });
  assert.ok(byId(res, 'cache').skipped);
  assert.ok(fs.existsSync(f));
});

test('include/exclude globs filter files and keep directories that may hold kept files', async () => {
  const s = sandbox();
  const log = s.mk('Logs\\a.log', 10);
  const keepLog = s.mk('Logs\\important.log', 10);
  const other = s.mk('Logs\\data.bin', 10);
  const filtered = [{ id: 'f', targets: [{ path: '%LOCALAPPDATA%\\Logs', include: ['*.log'], exclude: ['important*'] }] }];
  const res = await clean(filtered, { env: s.env, running: new Set() });
  assert.strictEqual(res[0].deleted, 1);
  assert.ok(!fs.existsSync(log));
  assert.ok(fs.existsSync(keepLog));
  assert.ok(fs.existsSync(other));
  assert.ok(nameAllowed('A.LOG', { include: ['*.log'] }), 'globs are case-insensitive');
});

test('symlinks are not followed', async (t) => {
  const s = sandbox();
  const outside = path.join(s.base, 'outside');
  fs.mkdirSync(outside);
  const victim = path.join(outside, 'precious.txt');
  fs.writeFileSync(victim, 'x');
  const cacheDir = path.join(s.local, 'App', 'User Data', 'Default', 'Cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  try { fs.symlinkSync(outside, path.join(cacheDir, 'link'), 'junction'); }
  catch { return t.skip('cannot create junction here'); }
  await clean(rules, { env: s.env, running: new Set() });
  assert.ok(fs.existsSync(victim), 'file behind junction must survive');
});

test('unresolved env vars and shallow roots are rejected', async () => {
  assert.strictEqual(expandEnv('%NOPE%\\x', {}), null);
  assert.strictEqual(isSafeRoot('C:\\'), false);
  assert.strictEqual(isSafeRoot('C:\\Users'), false);
  assert.strictEqual(isSafeRoot('C:\\Users\\me\\AppData\\Local\\Temp'), true);
  const r = await scan([{ id: 'x', targets: [{ path: '%NOPE%\\Cache' }] }], { env: {}, running: new Set() });
  assert.strictEqual(r[0].count, 0);
});

test('if the process list cannot be read, programs are treated as running (fail closed)', async () => {
  const { scan, UNKNOWN_PROCESSES } = require('../cleaner');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-fc-'));
  fs.writeFileSync(path.join(dir, 'a.bin'), 'x');
  const rule = { id: 'r', blockedByProcesses: ['app.exe'], targets: [{ path: '%LOCALAPPDATA%\\.', recurse: true }] };
  const [m] = await scan([rule], { env: { LOCALAPPDATA: dir }, running: new Set([UNKNOWN_PROCESSES]) });
  assert.deepStrictEqual(m.blockedBy, ['app.exe']);
});

test('an admin rule does not move a file whose folder was swapped for a junction after listing', async (t) => {
  const { clean } = require('../cleaner');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-adm-'));
  const root = path.join(base, 'Temp');
  const sub = path.join(root, 'sub');
  const victimDir = path.join(base, 'Protected');
  fs.mkdirSync(sub, { recursive: true }); fs.mkdirSync(victimDir);
  fs.writeFileSync(path.join(sub, 'f.tmp'), 'x');
  fs.writeFileSync(path.join(victimDir, 'f.tmp'), 'precious');
  const rule = { id: 'adm', requiresAdmin: true, targets: [{ path: '%LOCALAPPDATA%\\Temp', recurse: true }] };
  const moved = [];
  const remover = { remove: async (it) => { moved.push(it.path); return true; } };
  const swap = { remove: async (it) => { // runs for the first file: swap the folder for a junction before the second
    moved.push(it.path);
    if (moved.length === 1) {
      fs.rmSync(sub, { recursive: true });
      try { fs.symlinkSync(victimDir, sub, 'junction'); } catch { return true; }
    }
    return true;
  } };
  fs.writeFileSync(path.join(root, 'g.tmp'), 'y');
  try { fs.symlinkSync(victimDir, path.join(base, 'probe'), 'junction'); fs.rmSync(path.join(base, 'probe'), { recursive: true }); } catch { t.skip('cannot create junctions here'); return; }
  // plain case: both files are handled
  const res = await clean([rule], { env: { LOCALAPPDATA: base }, running: new Set(), remover });
  assert.strictEqual(res[0].deleted, 2);
  // swapped case
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'f.tmp'), 'x');
  fs.writeFileSync(path.join(sub, 'f2.tmp'), 'x');
  moved.length = 0;
  const res2 = await clean([rule], { env: { LOCALAPPDATA: base }, running: new Set(), remover: swap });
  assert.ok(res2[0].failed >= 1, 'the file behind the junction was refused');
  assert.ok(moved.every((p) => !p.includes('Protected')));
  assert.strictEqual(fs.readFileSync(path.join(victimDir, 'f.tmp'), 'utf8'), 'precious');
});

test('a folder the user excluded is not removed even when it is empty', async () => {
  const { clean } = require('../cleaner');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-exd-'));
  const keepDir = path.join(base, 'Cache', 'keepme');
  const dropDir = path.join(base, 'Cache', 'dropme');
  fs.mkdirSync(keepDir, { recursive: true }); fs.mkdirSync(dropDir, { recursive: true });
  const rule = { id: 'c', targets: [{ path: '%LOCALAPPDATA%\\Cache', recurse: true }] };
  await clean([rule], { env: { LOCALAPPDATA: base }, running: new Set(), isExcluded: (p) => p.toLowerCase().endsWith('keepme') });
  assert.ok(fs.existsSync(keepDir));
  assert.ok(!fs.existsSync(dropDir));
});
