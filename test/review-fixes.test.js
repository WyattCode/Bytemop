'use strict';
// Regression tests for the problems found in the second review of the apps / elevated leftovers code.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const apps = require('../apps');
const { executeJob, leftoverConfirmOptions } = require('../helper');
const { runElevated } = require('../elevation');
const { createAppsService } = require('../apps-service');
const { createService } = require('../clean-service');

function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-rf-'));
  const d = (...p) => { const full = path.join(base, ...p); fs.mkdirSync(full, { recursive: true }); return full; };
  const env = {
    USERPROFILE: d('Users', 'me'), APPDATA: d('Users', 'me', 'AppData', 'Roaming'), LOCALAPPDATA: d('Users', 'me', 'AppData', 'Local'),
    ProgramData: d('ProgramData'), ProgramFiles: d('Program Files'), 'ProgramFiles(x86)': d('Program Files (x86)'), SystemRoot: d('Windows'),
  };
  const put = (p, c = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };
  return { base, env, d, put };
}

test('a short (8.3) install location is resolved before the safety, deny-list and exclusion checks', async () => {
  const s = sandbox();
  const real = s.put(path.join(s.env.ProgramFiles, 'Uninstall Information', 'a.dat'));
  const realDir = path.dirname(real);
  const canon = async (p) => (p.endsWith('UNINST~1') ? realDir : p);
  const found = await apps.findLeftovers({ name: 'Zzz Tool', installLocation: path.join(s.env.ProgramFiles, 'UNINST~1') }, { env: s.env, canon });
  assert.deepStrictEqual(found.map((f) => f.path), [realDir], 'the candidate carries the real spelling');
  assert.strictEqual(apps.machineDenied(found[0], s.env), true, 'so the helper deny-list now applies to it');
  // an exclusion written with the real spelling protects it, whichever way the install location was spelled
  const kept = await apps.findLeftovers({ name: 'Zzz Tool', installLocation: path.join(s.env.ProgramFiles, 'UNINST~1') }, { env: s.env, canon, isExcluded: (p) => p.toLowerCase().startsWith(realDir.toLowerCase()) });
  assert.deepStrictEqual(kept, []);
});

test('install folders of other installed apps are never offered, nor are folders around them', async () => {
  const s = sandbox();
  const dell = path.join(s.env.ProgramFiles, 'Dell');
  s.put(path.join(dell, 'Updater', 'u.dll'));
  s.put(path.join(dell, 'Other', 'o.dll'));
  // uninstalling 'Dell Updater' whose registry location is the vendor folder, while 'Dell Other' still lives inside it
  const around = await apps.findLeftovers({ name: 'Dell Updater', installLocation: dell }, { env: s.env, keepDirs: [path.join(dell, 'Other')] });
  assert.deepStrictEqual(around, []);
  // forged: the live folder of another app named as the install location
  const live = await apps.findLeftovers({ name: 'Zzz Tool', installLocation: path.join(dell, 'Other') }, { env: s.env, keepDirs: [path.join(dell, 'Other')] });
  assert.deepStrictEqual(live, []);
  // with nothing else installed the folder is offered as before
  assert.strictEqual((await apps.findLeftovers({ name: 'Dell Updater', installLocation: path.join(dell, 'Updater') }, { env: s.env })).length, 1);
});

test('Bytemop\'s own data folder and the user\'s folders are never claimed by name', async () => {
  const s = sandbox();
  const data = s.d('Users', 'me', 'AppData', 'Local', 'Bytemop');
  s.put(path.join(data, 'quarantine', 'x'));
  const found = await apps.findLeftovers({ name: 'Bytemop', installLocation: '' }, { env: s.env, extraProtected: [data] });
  assert.deepStrictEqual(found, []);
});

test('generic words from an install folder name do not claim unrelated folders', async () => {
  const s = sandbox();
  s.put(path.join(s.env.LOCALAPPDATA, 'client', 'c.txt'));
  const found = await apps.findLeftovers({ name: 'Foo Client 1.2.3 (x64)', installLocation: path.join(s.env.ProgramFiles, 'Foo', 'client') }, { env: s.env });
  assert.ok(!found.some((f) => f.path.endsWith(path.join('Local', 'client'))));
});

test('machine guard: common Start Menu shortcuts are judged by their own name, and regid folders are denied', () => {
  const s = sandbox();
  const sm = path.join(s.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  assert.strictEqual(apps.machineDenied({ path: path.join(sm, 'Foo App.lnk') }, s.env), false);
  assert.strictEqual(apps.machineDenied({ path: path.join(sm, 'Windows Accessories') }, s.env), true);
  assert.strictEqual(apps.machineDenied({ path: path.join(s.env.ProgramData, 'regid.1991-06.com.microsoft') }, s.env), true);
});

test('uninstall strings without a file extension (msiexec /x {guid}) are understood', () => {
  const env = { SystemRoot: 'C:\\Windows' };
  const r = apps.splitCommand('msiexec /x {12345678-1234-1234-1234-123456789ABC}', env, () => true);
  assert.strictEqual(r.exe, path.join('C:\\Windows', 'System32', 'msiexec.exe'));
  assert.strictEqual(r.args, '/x {12345678-1234-1234-1234-123456789ABC}');
  assert.strictEqual(apps.splitCommand('evil /x', env, () => false), null);
  assert.strictEqual(apps.splitCommand('winget uninstall --id x', env, (p) => !/winget/.test(p)), null);
});

function helperSandbox(extra = {}) {
  const s = sandbox();
  const trashed = [];
  const confirms = [];
  const state = { installed: [], confirm: true };
  const deps = {
    listInstalled: async () => state.installed, trashItem: async (p) => { trashed.push(p); fs.rmSync(p, { recursive: true, force: true }); },
    canTrash: async () => ({ ok: true }), isSystemOwned: async () => false,
    confirm: async (list, name) => { confirms.push({ list, name }); return state.confirm; }, ...extra,
  };
  const run = (job, over = {}) => executeJob({ type: 'leftovers', ...job }, { allRules: [], env: s.env, deps, ...over });
  return { ...s, trashed, confirms, state, run, idFor: (p) => apps.idOf('l-', p) };
}

test('the helper shows its own confirmation with the exact folders, and a "no" moves nothing', async () => {
  const s = helperSandbox();
  const a = s.put(path.join(s.env.ProgramFiles, 'Fooapp', 'a.dll'));
  s.state.confirm = false;
  const out = await s.run({ app: { name: 'Fooapp' }, ids: [s.idFor(path.dirname(a))] });
  assert.deepStrictEqual(out.failed.map((f) => f.reason), ['declined']);
  assert.deepStrictEqual(s.trashed, []);
  assert.deepStrictEqual(s.confirms[0].list.map((x) => x.path), [path.dirname(a)]);
  s.state.confirm = true;
  const ok = await s.run({ app: { name: 'Fooapp' }, ids: [s.idFor(path.dirname(a))] });
  assert.strictEqual(ok.trashed, 1);
  // folders that fail a check are not even shown for confirmation
  const b = s.put(path.join(s.env.ProgramFiles, 'Windows Defender', 'x.dll'));
  s.confirms.length = 0;
  await s.run({ app: { name: 'Windows Defender' }, ids: [s.idFor(path.dirname(b))] });
  assert.strictEqual(s.confirms.length, 0);
  const opts = leftoverConfirmOptions('zh-CN', 'Fooapp', [{ path: 'C:\\Program Files\\Fooapp' }]);
  assert.strictEqual(opts.defaultId, 0);
  assert.match(opts.detail, /C:\\Program Files\\Fooapp/);
});

test('machine roots come from Windows known folders, not from the caller\'s environment variables', async () => {
  const s = helperSandbox();
  const fakePF = s.d('Fake Program Files');
  const evil = s.put(path.join(fakePF, 'Fooapp', 'a.dll'));
  const real = s.put(path.join(s.env.ProgramFiles, 'Fooapp', 'b.dll'));
  const poisoned = { ...s.env, ProgramFiles: fakePF }; // as if a persistent environment variable pointed elsewhere
  const deps = { listInstalled: async () => [], trashItem: async (p) => { s.trashed.push(p); fs.rmSync(p, { recursive: true, force: true }); }, canTrash: async () => ({ ok: true }), isSystemOwned: async () => false, machineEnv: async () => ({ ProgramFiles: s.env.ProgramFiles, 'ProgramFiles(x86)': s.env['ProgramFiles(x86)'], ProgramData: s.env.ProgramData, SystemRoot: s.env.SystemRoot }) };
  const out = await executeJob({ type: 'leftovers', app: { name: 'Fooapp' }, ids: [apps.idOf('l-', path.dirname(evil)), apps.idOf('l-', path.dirname(real))] }, { allRules: [], env: poisoned, deps });
  assert.deepStrictEqual(s.trashed, [path.dirname(real)]);
  assert.deepStrictEqual(out.failed.map((f) => f.reason), ['not-found']);
  assert.ok(fs.existsSync(evil));
});

test('the helper never trashes the install folder of another installed app', async () => {
  const s = helperSandbox();
  const dell = path.join(s.env.ProgramFiles, 'Dell');
  s.put(path.join(dell, 'Updater', 'u.dll'));
  s.put(path.join(dell, 'Other', 'o.dll'));
  s.state.installed = [{ name: 'Dell Other', installLocation: path.join(dell, 'Other') }];
  const out = await s.run({ app: { name: 'Dell Updater', installLocation: dell }, ids: [s.idFor(dell)] });
  assert.strictEqual(out.trashed, 0);
  assert.ok(fs.existsSync(path.join(dell, 'Other', 'o.dll')));
});

test('jobs over the pipe must say whose profile they come from', async () => {
  const ENTRY = path.join(__dirname, 'fixtures', 'helper-entry.js');
  const { spawn } = require('child_process');
  const launch = ({ pipe, token }) => { const p = spawn(process.execPath, [ENTRY, '--bytemop-helper', `--pipe=${pipe}`, `--token=${token}`], { stdio: 'ignore', env: { ...process.env, BYTEMOP_TEST_ENV: '{}' } }); p.on('error', () => {}); return Promise.resolve({ ok: true }); };
  const out = await runElevated({ type: 'scan' }, { launch, connectTimeoutMs: 20000, caller: null });
  assert.strictEqual(out.status, 'failed');
  assert.match(out.error, /different-account/);
});

test('hidden registry entries still count: components are "installed", and their folders belong to them', async () => {
  const s = sandbox();
  const dataDir = s.d('data');
  const clean = createService({ dataDir, rules: [] });
  const row = (name, extra = {}) => ({ key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + name, scope: 'user', name, uninstall: '"C:\\x\\u.exe"', ...extra });
  const reg = { rows: [row('Fooapp')] };
  const svc = createAppsService({ dataDir, backend: { desktop: async () => reg.rows, store: async () => [], launch: async () => {}, removeStore: async () => {} }, service: clean, env: s.env, exists: () => true });
  const id = apps.idOf('w-', reg.rows[0].key);
  await svc.uninstall(id);
  s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'a.txt'));
  // the app vanishes from the list, but a hidden component with the same name remains
  reg.rows = [row('Fooapp', { key: 'HKLM\\x\\{guid}', systemComponent: 1 })];
  assert.strictEqual((await svc.list()).pending[0].status, 'installed');
  assert.strictEqual((await svc.leftovers(id)).error, 'still-installed');
  // gone for real; another app that lives in a folder with a matching name keeps it
  reg.rows = [row('Other App', { installLocation: path.join(s.env.LOCALAPPDATA, 'Fooapp') })];
  assert.deepStrictEqual((await svc.leftovers(id)).candidates, []);
});
