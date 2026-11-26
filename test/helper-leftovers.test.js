'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { executeJob } = require('../helper');
const apps = require('../apps');

function sandbox(extraDeps = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-hl-'));
  const d = (...p) => { const full = path.join(base, ...p); fs.mkdirSync(full, { recursive: true }); return full; };
  const env = {
    USERPROFILE: d('Users', 'me'), APPDATA: d('Users', 'me', 'AppData', 'Roaming'), LOCALAPPDATA: d('Users', 'me', 'AppData', 'Local'),
    ProgramData: d('ProgramData'), ProgramFiles: d('Program Files'), 'ProgramFiles(x86)': d('Program Files (x86)'), SystemRoot: d('Windows'),
  };
  const put = (p, c = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); return p; };
  const trashed = [];
  const state = { installed: [], owned: new Set(), canTrash: { ok: true } };
  const deps = {
    listInstalled: async () => state.installed,
    trashItem: async (p) => { trashed.push(p); fs.rmSync(p, { recursive: true, force: true }); },
    canTrash: async () => state.canTrash,
    isSystemOwned: async (p) => state.owned.has(p),
    ...extraDeps,
  };
  const run = (job, over = {}) => executeJob({ type: 'leftovers', ...job }, { allRules: [], env, deps, ...over });
  const idFor = (p) => apps.idOf('l-', p);
  return { base, env, d, put, trashed, state, run, idFor };
}

test('the helper finds machine-wide leftovers itself and recycles only the chosen ones', async () => {
  const s = sandbox();
  const pf = s.put(path.join(s.env.ProgramFiles, 'Fooapp', 'a.dll'), '1234');
  const pd = s.put(path.join(s.env.ProgramData, 'Fooapp', 'lic.dat'), '12');
  const out = await s.run({ app: { name: 'Fooapp 2.0' }, ids: [s.idFor(path.dirname(pf))] });
  assert.deepStrictEqual([out.trashed, out.bytes, out.failed], [1, 4, []]);
  assert.deepStrictEqual(s.trashed, [path.dirname(pf)]);
  assert.ok(fs.existsSync(pd), 'the folder that was not chosen stays');
});

test('ids that are not machine-wide candidates the helper found itself are refused', async () => {
  const s = sandbox();
  s.put(path.join(s.env.ProgramFiles, 'Fooapp', 'a.dll'));
  const user = s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'u.txt'));            // user-level: not the helper's business
  const other = s.put(path.join(s.env.ProgramFiles, 'Barapp', 'b.dll'));            // belongs to some other name
  const out = await s.run({ app: { name: 'Fooapp' }, ids: [s.idFor(path.dirname(user)), s.idFor(path.dirname(other)), 'l-0000000000000000', 'whatever'] });
  assert.strictEqual(out.trashed, 0);
  assert.deepStrictEqual(out.failed.map((f) => f.reason), ['not-found', 'not-found', 'not-found', 'not-found']);
  assert.deepStrictEqual(s.trashed, []);
  assert.ok(fs.existsSync(other) && fs.existsSync(user));
});

test('a claimed app name cannot be used to remove Windows or Microsoft folders', async () => {
  const s = sandbox();
  const wd = s.put(path.join(s.env.ProgramFiles, 'Windows Defender', 'x.dll'));
  const ms = s.put(path.join(s.env.ProgramFiles, 'Microsoft Fooapp', 'y.dll'));
  const cf = s.put(path.join(s.env.ProgramFiles, 'Common Files', 'z.dll'));
  for (const [name, p] of [['Windows Defender', wd], ['Microsoft Fooapp', ms], ['Common Files', cf]]) {
    const out = await s.run({ app: { name }, ids: [s.idFor(path.dirname(p))] });
    assert.strictEqual(out.trashed, 0, name);
  }
  assert.deepStrictEqual(s.trashed, []);
  assert.ok(fs.existsSync(wd) && fs.existsSync(ms) && fs.existsSync(cf));
  // an install location pointing inside Windows folders is refused as well
  const inside = s.put(path.join(s.env.ProgramFiles, 'Windows NT', 'Accessories', 'w.exe'));
  const out = await s.run({ app: { name: 'Accessories Pack', installLocation: path.dirname(inside) }, ids: [s.idFor(path.dirname(inside))] });
  assert.strictEqual(out.trashed, 0);
  assert.ok(fs.existsSync(inside));
});

test('folders owned by Windows, too-big folders and folders with kept files are refused with a reason', async () => {
  const s = sandbox();
  const a = s.put(path.join(s.env.ProgramFiles, 'Fooapp', 'a.dll'));
  s.state.owned.add(path.dirname(a));
  assert.deepStrictEqual((await s.run({ app: { name: 'Fooapp' }, ids: [s.idFor(path.dirname(a))] })).failed.map((f) => f.reason), ['system-owned']);

  s.state.owned.clear();
  s.state.canTrash = { ok: false, reason: 'too-big' };
  assert.deepStrictEqual((await s.run({ app: { name: 'Fooapp' }, ids: [s.idFor(path.dirname(a))] })).failed.map((f) => f.reason), ['too-big']);

  s.state.canTrash = { ok: true };
  s.put(path.join(s.env.ProgramFiles, 'Fooapp', 'keep', 'mine.txt'));
  const kept = await s.run({ app: { name: 'Fooapp' }, ids: [s.idFor(path.dirname(a))], exclusions: [{ type: 'path', value: path.join(s.env.ProgramFiles, 'Fooapp', 'keep') }] });
  assert.deepStrictEqual(kept.failed.map((f) => f.reason), ['has-excluded-files']);
  assert.deepStrictEqual(s.trashed, []);
  // an excluded folder is simply not offered
  const gone = await s.run({ app: { name: 'Fooapp' }, ids: [s.idFor(path.dirname(a))], exclusions: [{ type: 'path', value: path.dirname(a) }] });
  assert.deepStrictEqual(gone.failed.map((f) => f.reason), ['not-found']);
});

test('the helper checks for itself that the app is gone, and honours its own exclusions file', async () => {
  const s = sandbox();
  const a = s.put(path.join(s.env.ProgramFiles, 'Fooapp', 'a.dll'));
  s.state.installed = [{ name: 'Fooapp', installLocation: '' }];
  assert.deepStrictEqual(await s.run({ app: { name: 'Fooapp' }, ids: [s.idFor(path.dirname(a))] }), { error: 'still-installed' });
  s.state.installed = [];
  // names the caller saw on other installed apps protect their folders
  const kept = await s.run({ app: { name: 'Fooapp' }, ids: [s.idFor(path.dirname(a))], others: ['fooapp'] });
  assert.deepStrictEqual(kept.failed.map((f) => f.reason), ['not-found']);

  const dataDir = path.join(s.env.LOCALAPPDATA, 'Bytemop');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'exclusions.json'), '{ not json');
  await assert.rejects(s.run({ app: { name: 'Fooapp' }, ids: [s.idFor(path.dirname(a))] }), /exclusions-unreadable/);
  assert.ok(fs.existsSync(a));
});

test('bad jobs are rejected before anything is touched', async () => {
  const s = sandbox();
  s.put(path.join(s.env.ProgramFiles, 'Fooapp', 'a.dll'));
  await assert.rejects(s.run({ app: null, ids: ['x'] }), /invalid app/);
  await assert.rejects(s.run({ app: { name: '' }, ids: ['x'] }), /invalid app/);
  await assert.rejects(s.run({ app: { name: 'x'.repeat(300) }, ids: ['x'] }), /invalid app/);
  await assert.rejects(s.run({ app: { name: 'Fooapp' }, ids: [] }), /nothing selected/);
  await assert.rejects(s.run({ app: { name: 'Fooapp' }, ids: 'x' }), /nothing selected/);
  await assert.rejects(s.run({ app: { name: 'Fooapp' }, ids: ['x'] }, { deps: undefined }), /not available/);
  assert.deepStrictEqual(s.trashed, []);
});

test('machine-wide guard: deny list, ownership and roots', async () => {
  const { env } = sandbox();
  const c = (p) => ({ path: p });
  assert.strictEqual(apps.machineDenied(c(path.join(env.ProgramFiles, 'Fooapp')), env), false);
  assert.strictEqual(apps.machineDenied(c(path.join(env.ProgramFiles, 'Windows Mail')), env), true);
  assert.strictEqual(apps.machineDenied(c(path.join(env.ProgramData, 'Microsoft')), env), true);
  assert.strictEqual(apps.machineDenied(c(path.join(env.ProgramData, 'Package Cache')), env), true);
  assert.strictEqual(apps.machineDenied(c(path.join(env.ProgramFiles, 'Acme Corp', 'Tool')), env), false);
  assert.strictEqual(apps.machineDenied(c(path.join(env.ProgramFiles, 'Microsoft Office', 'x')), env), true);
  assert.strictEqual(apps.machineDenied(c(path.join(env.LOCALAPPDATA, 'Fooapp')), env), true);   // not machine-wide
  assert.strictEqual(apps.machineDenied(c(env.ProgramFiles), env), true);                          // the root itself
  assert.strictEqual(await apps.isSystemOwned('p', async () => 'NT SERVICE\\TrustedInstaller'), true);
  assert.strictEqual(await apps.isSystemOwned('p', async () => 'BUILTIN\\Administrators'), false);
  assert.strictEqual(await apps.isSystemOwned('p', async () => ''), true);
  assert.strictEqual(await apps.isSystemOwned('p', async () => { throw new Error('boom'); }), true);
});
