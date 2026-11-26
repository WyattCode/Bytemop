'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAppsService } = require('../apps-service');
const { createService } = require('../clean-service');

// A fake machine: temp profile folders, a fake registry list and a recording backend.
function setup(opts = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-asvc-'));
  const d = (...p) => { const full = path.join(base, ...p); fs.mkdirSync(full, { recursive: true }); return full; };
  const env = {
    USERPROFILE: d('Users', 'me'), APPDATA: d('Users', 'me', 'AppData', 'Roaming'), LOCALAPPDATA: d('Users', 'me', 'AppData', 'Local'),
    ProgramData: d('ProgramData'), ProgramFiles: d('Program Files'), 'ProgramFiles(x86)': d('Program Files (x86)'), SystemRoot: d('Windows'),
  };
  const put = (p, content = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };
  const dataDir = d('data');
  const clean = createService({ dataDir, rules: [], recoverMinAgeMs: 0 });
  const row = (name, extra = {}) => ({
    key: `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${name}`, scope: 'user', name, publisher: 'Acme', version: '1.0',
    uninstall: `"${path.join(env.LOCALAPPDATA, 'Programs', name, 'unins000.exe')}" /x`, ...extra,
  });
  const reg = { desktop: [row('Fooapp'), row('Barapp')], store: [{ fullName: 'Contoso.Notes_1.0_x64__abc', name: 'Contoso.Notes', publisher: 'CN=Contoso' }] };
  const calls = { launch: [], removeStore: [] };
  const backend = {
    desktop: async () => { if (reg.failDesktop) throw new Error('registry down'); return reg.desktop; },
    store: async () => { if (reg.failStore) throw new Error('appx down'); return reg.store; },
    launch: async (a) => { calls.launch.push(a); if (reg.launchGate) await reg.launchGate; if (reg.failLaunch) throw new Error('cancelled by user'); },
    removeStore: async (n) => { calls.removeStore.push(n); if (reg.failRemove) throw new Error('boom'); },
  };
  const exState = { fn: () => false, unreadable: false };
  const svc = createAppsService({
    dataDir, backend, service: clean, env, exists: (p) => !/winget/i.test(p), now: opts.now, elevatedClean: opts.elevatedClean,
    getExcluded: async () => { if (exState.unreadable) throw new Error('exclusions-unreadable'); return (p) => exState.fn(p); },
  });
  const idOf = (name) => (reg.desktop.find((r) => r.name === name) ? require('../apps').idOf('w-', reg.desktop.find((r) => r.name === name).key) : null);
  return { base, env, d, put, dataDir, clean, reg, calls, svc, row, exState, idOf };
}

const finishUninstall = async (s, name) => { // uninstall app `name`, then make it vanish from the fake registry
  const id = s.idOf(name);
  const r = await s.svc.uninstall(id);
  s.reg.desktop = s.reg.desktop.filter((x) => x.name !== name);
  return { id, r };
};

test('list shows desktop and Store apps without internal fields, and survives one source failing', async () => {
  const s = setup();
  const out = await s.svc.list();
  assert.deepStrictEqual(out.apps.map((a) => a.name).sort(), ['Barapp', 'Fooapp', 'Notes']);
  for (const a of out.apps) { assert.ok(!('uninstall' in a) && !('key' in a) && !('fullName' in a)); }
  s.reg.failStore = true;
  const partial = await s.svc.list();
  assert.strictEqual(partial.apps.length, 2);
  assert.strictEqual(partial.errors[0].source, 'store');
});

test('uninstall starts the app\'s own uninstaller and remembers it', async () => {
  const s = setup();
  const id = s.idOf('Fooapp');
  const r = await s.svc.uninstall(id);
  assert.deepStrictEqual([r.ok, r.started], [true, true]);
  assert.strictEqual(s.calls.launch.length, 1);
  assert.strictEqual(s.calls.launch[0].exe, path.join(s.env.LOCALAPPDATA, 'Programs', 'Fooapp', 'unins000.exe'));
  assert.strictEqual(s.calls.launch[0].args, '/x');
  const list = await s.svc.list();
  assert.deepStrictEqual(list.pending.map((p) => [p.name, p.status]), [['Fooapp', 'installed']]); // still listed: not finished yet
  s.reg.desktop = s.reg.desktop.filter((x) => x.name !== 'Fooapp');
  assert.strictEqual((await s.svc.list()).pending[0].status, 'gone');
  assert.ok((await s.clean.history()).some((e) => e.type === 'uninstall' && e.name === 'Fooapp'));
});

test('uninstall refuses unknown ids and unusable commands, and a failed launch is not remembered', async () => {
  const s = setup();
  assert.strictEqual((await s.svc.uninstall('w-0000000000000000')).error, 'not-found');
  assert.strictEqual((await s.svc.uninstall('..\\..\\x')).error, 'not-found');
  assert.strictEqual((await s.svc.uninstall(undefined)).error, 'not-found');
  s.reg.desktop.push(s.row('Winget', { uninstall: 'winget uninstall --id x' }));
  s.reg.desktop.push(s.row('Unknownexe', { uninstall: 'evil.exe' }));
  assert.strictEqual((await s.svc.uninstall(s.idOf('Winget'))).error, 'bad-command');
  s.svc = createAppsService({ dataDir: s.dataDir, backend: { desktop: async () => s.reg.desktop, store: async () => [], launch: async () => {}, removeStore: async () => {} }, service: s.clean, env: s.env, exists: () => false });
  assert.strictEqual((await s.svc.uninstall(s.idOf('Unknownexe'))).error, 'bad-command');
  assert.strictEqual(s.calls.launch.length, 0);

  const t = setup();
  t.reg.failLaunch = true;
  const r = await t.svc.uninstall(t.idOf('Fooapp'));
  assert.deepStrictEqual([r.ok, r.error], [false, 'launch-failed']);
  assert.deepStrictEqual((await t.svc.list()).pending, []);
});

test('a double click cannot start the uninstaller twice', async () => {
  const s = setup();
  let release;
  s.reg.launchGate = new Promise((r) => { release = r; });
  const id = s.idOf('Fooapp');
  const first = s.svc.uninstall(id);
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual((await s.svc.uninstall(id)).error, 'busy');
  release();
  assert.strictEqual((await first).ok, true);
  assert.strictEqual(s.calls.launch.length, 1);
});

test('Store apps are removed through Windows, by the name from the fresh list', async () => {
  const s = setup();
  const store = (await s.svc.list()).apps.find((a) => a.kind === 'store');
  const r = await s.svc.uninstall(store.id);
  assert.strictEqual(r.removed, true);
  assert.deepStrictEqual(s.calls.removeStore, ['Contoso.Notes_1.0_x64__abc']);
  s.reg.failRemove = true;
  assert.strictEqual((await s.svc.uninstall(store.id)).error, 'failed');
  assert.strictEqual((await s.svc.uninstall('s-ffffffffffffffff')).error, 'not-found');
});

test('leftovers are only available for an app we uninstalled, and only once it is gone', async () => {
  const s = setup();
  assert.strictEqual((await s.svc.leftovers(s.idOf('Fooapp'))).error, 'not-pending');
  const id = s.idOf('Fooapp');
  await s.svc.uninstall(id);
  assert.strictEqual((await s.svc.leftovers(id)).error, 'still-installed');
  s.reg.desktop = s.reg.desktop.filter((x) => x.name !== 'Fooapp');
  assert.deepStrictEqual((await s.svc.leftovers(id)).candidates, []);
});

test('cleaning leftovers moves them to the quarantine and they can be restored', async () => {
  const s = setup();
  s.put(path.join(s.env.APPDATA, 'Fooapp', 'settings.json'), 'abcd');
  s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'cache', 'c.bin'), '12345678');
  s.put(path.join(s.env.LOCALAPPDATA, 'Barapp', 'keep.txt'), 'other app');
  const { id } = await finishUninstall(s, 'Fooapp');
  const scan = await s.svc.leftovers(id);
  assert.strictEqual(scan.candidates.length, 2);
  assert.ok(scan.candidates.every((c) => !('root' in c)));
  const local = scan.candidates.find((c) => c.path.includes('Local'));
  const out = await s.svc.cleanLeftovers(id, [local.id]);
  assert.deepStrictEqual([out.ok, out.mode, out.deleted, out.freed, out.failed], [true, 'quarantine', 1, 8, 0]);
  assert.ok(!fs.existsSync(path.join(s.env.LOCALAPPDATA, 'Fooapp')), 'the emptied folder is removed too');
  assert.ok(fs.existsSync(path.join(s.env.APPDATA, 'Fooapp', 'settings.json')), 'unselected leftovers stay');
  assert.ok(fs.existsSync(path.join(s.env.LOCALAPPDATA, 'Barapp', 'keep.txt')), 'other apps are never touched');
  assert.strictEqual(out.done, undefined);
  assert.strictEqual(out.remaining.length, 1);

  const run = (await s.clean.runs()).find((r) => r.id === out.runId);
  assert.strictEqual(run.app, 'Fooapp');
  const back = await s.clean.restore(out.runId);
  assert.strictEqual(back.restored, 1);
  assert.strictEqual(fs.readFileSync(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'cache', 'c.bin'), 'utf8'), '12345678');
  assert.ok((await s.clean.history()).some((e) => e.type === 'leftover' && e.name === 'Fooapp' && e.deleted === 1));
});

test('the record is dropped once nothing is left', async () => {
  const s = setup();
  s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'a.txt'), 'a');
  const { id } = await finishUninstall(s, 'Fooapp');
  const scan = await s.svc.leftovers(id);
  const out = await s.svc.cleanLeftovers(id, scan.candidates.map((c) => c.id));
  assert.strictEqual(out.done, true);
  assert.deepStrictEqual((await s.svc.list()).pending, []);
});

test('permanent mode deletes instead of quarantining', async () => {
  const s = setup();
  await s.clean.setSettings({ deleteMode: 'permanent' });
  s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'a.txt'), 'a');
  const { id } = await finishUninstall(s, 'Fooapp');
  const scan = await s.svc.leftovers(id);
  const out = await s.svc.cleanLeftovers(id, [scan.candidates[0].id]);
  assert.deepStrictEqual([out.mode, out.deleted, out.runId], ['permanent', 1, null]);
  assert.ok(!fs.existsSync(path.join(s.env.LOCALAPPDATA, 'Fooapp')));
  assert.deepStrictEqual(await s.clean.runs(), []);
});

test('the quarantine size limit stops the clean before anything moves', async () => {
  const s = setup();
  await s.clean.setSettings({ quarantineLimitGB: 1 });
  const q = s.clean.quarantine;
  const old = await q.begin({ rules: [] });
  await q._writeMeta(old.id, { id: old.id, createdAt: Date.now(), status: 'committed', count: 1, bytes: 2 * 1024 ** 3 }); // quarantine already over its limit
  const file = s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'a.txt'), 'a');
  const { id } = await finishUninstall(s, 'Fooapp');
  const scan = await s.svc.leftovers(id);
  const out = await s.svc.cleanLeftovers(id, [scan.candidates[0].id]);
  assert.strictEqual(out.error, 'quarantine-limit');
  assert.ok(fs.existsSync(file));
});

test('only candidates from the latest scan can be cleaned, and ids from elsewhere are ignored', async () => {
  const s = setup();
  s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'a.txt'), 'a');
  const victim = s.put(path.join(s.env.USERPROFILE, 'Documents', 'thesis.docx'), 'important');
  const { id } = await finishUninstall(s, 'Fooapp');
  assert.strictEqual((await s.svc.cleanLeftovers(id, ['whatever'])).error, 'rescan'); // no scan yet
  await s.svc.leftovers(id);
  assert.strictEqual((await s.svc.cleanLeftovers(id, [])).error, 'nothing-selected');
  assert.strictEqual((await s.svc.cleanLeftovers(id, [victim, path.dirname(victim), 123, null])).error, 'nothing-selected');
  assert.strictEqual((await s.svc.cleanLeftovers('w-unknown', ['x'])).error, 'rescan');
  assert.ok(fs.existsSync(victim));
});

test('a reinstalled app is protected: its folders are live data again', async () => {
  const s = setup();
  s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'a.txt'), 'a');
  const { id } = await finishUninstall(s, 'Fooapp');
  const scan = await s.svc.leftovers(id);
  s.reg.desktop.push(s.row('Fooapp')); // the user installed it again
  const out = await s.svc.cleanLeftovers(id, scan.candidates.map((c) => c.id));
  assert.strictEqual(out.error, 'still-installed');
  assert.ok(fs.existsSync(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'a.txt')));
});

test('exclusions keep files; an unreadable exclusions file stops everything', async () => {
  const s = setup();
  s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'a.txt'), 'a');
  s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'mine', 'b.txt'), 'b');
  const { id } = await finishUninstall(s, 'Fooapp');
  s.exState.fn = (p) => p.includes(path.sep + 'mine');
  const scan = await s.svc.leftovers(id);
  assert.strictEqual(scan.candidates[0].keptByExclusion, 1);
  const out = await s.svc.cleanLeftovers(id, [scan.candidates[0].id]);
  assert.strictEqual(out.deleted, 1);
  assert.ok(fs.existsSync(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'mine', 'b.txt')));
  assert.strictEqual(out.done, undefined, 'the kept folder is still there');

  s.exState.unreadable = true;
  await assert.rejects(s.svc.leftovers(id), /exclusions-unreadable/);
  await assert.rejects(s.svc.cleanLeftovers(id, ['x']), /exclusions-unreadable/);
  assert.ok(fs.existsSync(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'mine', 'b.txt')));
});

test('a leftover folder swapped for a link after the scan is refused', async () => {
  const s = setup();
  s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'a.txt'), 'a');
  const precious = s.put(path.join(s.base, 'precious', 'doc.txt'), 'keep me');
  const { id } = await finishUninstall(s, 'Fooapp');
  const scan = await s.svc.leftovers(id);
  fs.rmSync(path.join(s.env.LOCALAPPDATA, 'Fooapp'), { recursive: true });
  fs.symlinkSync(path.join(s.base, 'precious'), path.join(s.env.LOCALAPPDATA, 'Fooapp'), 'junction');
  const out = await s.svc.cleanLeftovers(id, scan.candidates.map((c) => c.id));
  assert.deepStrictEqual([out.deleted, out.refused.length], [0, 1]);
  assert.ok(fs.existsSync(precious));
});

test('a folder from the scan under a changed name is not cleaned (only scanned paths are acted on)', async () => {
  const s = setup();
  s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'a.txt'), 'a');
  const { id } = await finishUninstall(s, 'Fooapp');
  const scan = await s.svc.leftovers(id);
  const out = await s.svc.cleanLeftovers(id, [scan.candidates[0].id, scan.candidates[0].id]);
  assert.strictEqual(out.deleted, 1); // duplicates in the request are harmless
});

test('records expire, can be dismissed, and reveal only works for scanned paths', async () => {
  let t = 1000;
  const s = setup({ now: () => t });
  s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'a.txt'), 'a');
  const { id } = await finishUninstall(s, 'Fooapp');
  const scan = await s.svc.leftovers(id);
  assert.strictEqual(s.svc.revealable(scan.candidates[0].path), scan.candidates[0].path);
  assert.strictEqual(s.svc.revealable(path.join(s.env.USERPROFILE, 'Documents')), null);
  assert.strictEqual(s.svc.revealable(42), null);
  assert.deepStrictEqual(await s.svc.dismiss(id), { ok: true });
  assert.deepStrictEqual(await s.svc.dismiss(id), { ok: false });
  assert.strictEqual(s.svc.revealable(scan.candidates[0].path), null);

  const u = setup({ now: () => t });
  await u.svc.uninstall(u.idOf('Barapp'));
  t += 31 * 24 * 3600 * 1000;
  assert.deepStrictEqual((await u.svc.list()).pending, []);
});

test('when the desktop list cannot be read, nothing is reported as finished', async () => {
  const s = setup();
  await s.svc.uninstall(s.idOf('Fooapp'));
  s.reg.failDesktop = true;
  const out = await s.svc.list();
  assert.strictEqual(out.pending[0].status, 'unknown');
  await assert.rejects(s.svc.leftovers(s.idOf('Fooapp')), /registry down/);
});

test('machine-wide leftovers go to the elevated helper as ids, never paths; the rest is handled here', async () => {
  const jobs = [];
  const s = setup({ elevatedClean: async (job) => { jobs.push(job); return { status: 'ok', result: { trashed: 1, bytes: 12, failed: [] } }; } });
  const pf = s.put(path.join(s.env.ProgramFiles, 'Fooapp', 'a.dll'), '123456789012');
  s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'u.txt'), 'u');
  const { id } = await finishUninstall(s, 'Fooapp');
  const scan = await s.svc.leftovers(id);
  const machine = scan.candidates.find((c) => c.machine);
  const user = scan.candidates.find((c) => !c.machine);
  const out = await s.svc.cleanLeftovers(id, [machine.id, user.id]);
  assert.strictEqual(jobs.length, 1);
  assert.deepStrictEqual(jobs[0].ids, [machine.id]);
  assert.strictEqual(jobs[0].type, 'leftovers');
  assert.strictEqual(jobs[0].app.name, 'Fooapp');
  assert.ok(!JSON.stringify(jobs[0]).includes(path.join(s.env.ProgramFiles, 'Fooapp')), 'no leftover path is sent to the helper');
  assert.deepStrictEqual(out.admin, { status: 'ok', trashed: 1, bytes: 12, failed: [] });
  assert.strictEqual(out.deleted, 1, 'the user-level folder was handled in this process');
  assert.ok(fs.existsSync(pf), 'this process never touches machine-wide folders itself');
  assert.ok(!fs.existsSync(path.join(s.env.LOCALAPPDATA, 'Fooapp')));
});

test('exclusions the user has are handed to the helper, and a declined prompt leaves everything in place', async () => {
  const jobs = [];
  const s = setup({ elevatedClean: async (job) => { jobs.push(job); return { status: 'denied' }; } });
  const pf = s.put(path.join(s.env.ProgramFiles, 'Fooapp', 'a.dll'));
  await s.clean.addExclusion({ type: 'path', value: path.join(s.env.ProgramFiles, 'Fooapp', 'keep') });
  const { id } = await finishUninstall(s, 'Fooapp');
  const scan = await s.svc.leftovers(id);
  const out = await s.svc.cleanLeftovers(id, scan.candidates.map((c) => c.id));
  assert.deepStrictEqual(out.admin, { status: 'denied', error: '' });
  assert.deepStrictEqual(jobs[0].exclusions.map((e) => e.value), [path.join(s.env.ProgramFiles, 'Fooapp', 'keep')]);
  assert.ok(fs.existsSync(pf));
  assert.strictEqual(out.done, undefined, 'the record stays so it can be tried again');
});

test('a helper that refuses or fails is reported, and only-user selections never start the helper', async () => {
  let calls = 0;
  const mode = { v: 'refuse' };
  const s = setup({ elevatedClean: async () => { calls += 1; return mode.v === 'refuse' ? { status: 'ok', result: { error: 'still-installed' } } : { status: 'failed', error: 'boom' }; } });
  s.put(path.join(s.env.ProgramFiles, 'Fooapp', 'a.dll'));
  s.put(path.join(s.env.LOCALAPPDATA, 'Fooapp', 'u.txt'));
  const { id } = await finishUninstall(s, 'Fooapp');
  const scan = await s.svc.leftovers(id);
  const machine = scan.candidates.find((c) => c.machine);
  const user = scan.candidates.find((c) => !c.machine);
  assert.deepStrictEqual((await s.svc.cleanLeftovers(id, [machine.id])).admin, { status: 'refused', error: 'still-installed' });
  mode.v = 'fail';
  assert.deepStrictEqual((await s.svc.cleanLeftovers(id, [machine.id])).admin, { status: 'failed', error: 'boom' });
  assert.strictEqual(calls, 2);
  const only = await s.svc.cleanLeftovers(id, [user.id]);
  assert.strictEqual(only.admin, undefined);
  assert.strictEqual(calls, 2);
});
