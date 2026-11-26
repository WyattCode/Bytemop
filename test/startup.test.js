'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createStartupManager, windowsBackend, extractExe, filetimeHex, isDisabledHex, DEFAULT_CONFIG } = require('../startup');

const U = DEFAULT_CONFIG.approvedUser;
const M = DEFAULT_CONFIG.approvedMachine;
const RUN_U = DEFAULT_CONFIG.runSources[0].key;
const RUN_M = DEFAULT_CONFIG.runSources[1].key;
const RUN_32 = DEFAULT_CONFIG.runSources[2].key;

// In-memory stand-in for the registry + program inspection.
function fakeBackend(values = {}, programs = {}) {
  const keys = new Map();
  for (const [k, vals] of Object.entries(values)) keys.set(k, new Map(Object.entries(vals)));
  const writes = [];
  return {
    writes, keys,
    async readValues(list) {
      const out = [];
      for (const k of list) for (const [name, data] of (keys.get(k) || new Map())) out.push({ key: k, name, kind: /^[0-9a-f]+$/i.test(data) && data.length === 24 ? 'Binary' : 'String', data });
      return out;
    },
    async writeBinary(key, name, hex) { writes.push({ key, name, hex }); if (!keys.has(key)) keys.set(key, new Map()); keys.get(key).set(name, hex); },
    async inspect(paths) { return paths.map((p) => programs[p.toLowerCase()] || { path: p, exists: false }); },
  };
}

function manager(backend, extra = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-su-'));
  const env = { APPDATA: path.join(base, 'Roaming'), ProgramData: path.join(base, 'ProgramData'), SystemRoot: 'C:\\Windows' };
  fs.mkdirSync(path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), { recursive: true });
  fs.mkdirSync(path.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'), { recursive: true });
  return { base, env, mgr: createStartupManager({ backend, env, now: () => Date.UTC(2020, 0, 1), ...extra }) };
}

test('extractExe handles quotes, arguments, env vars and bare names', () => {
  const env = { SystemRoot: 'C:\\Windows' };
  assert.strictEqual(extractExe('"C:\\Program Files\\App\\a.exe" /background', env), 'C:\\Program Files\\App\\a.exe');
  assert.strictEqual(extractExe('C:\\Tools\\b.exe -silent', env), 'C:\\Tools\\b.exe');
  assert.strictEqual(extractExe('%SystemRoot%\\system32\\SecurityHealthSystray.exe', env), 'C:\\Windows\\system32\\SecurityHealthSystray.exe');
  assert.strictEqual(extractExe('C:\\Program Files\\Spaced Dir\\c.exe --x', env), 'C:\\Program Files\\Spaced Dir\\c.exe');
  assert.strictEqual(extractExe('notepad', env), 'notepad');
  assert.strictEqual(extractExe(undefined, env), null);
});

test('FILETIME encoding: Unix epoch is the well-known constant, little-endian', () => {
  assert.strictEqual(filetimeHex(0), '00803ed5deb19d01');
  assert.strictEqual(filetimeHex(Date.UTC(2020, 0, 1)).length, 16);
});

test('odd first byte means disabled', () => {
  assert.ok(isDisabledHex('030000000000000000000000'));
  assert.ok(isDisabledHex('010000000000000000000000'));
  assert.ok(!isDisabledHex('020000000000000000000000'));
  assert.ok(!isDisabledHex('060000000000000000000000'));
  assert.ok(!isDisabledHex(undefined));
});

test('list merges Run keys and startup folders, applies approved state, ignores desktop.ini', async () => {
  const backend = fakeBackend({
    [RUN_U]: { Chat: '"C:\\Apps\\chat.exe" /min', 'Cloud Sync': 'C:\\Apps\\sync.exe' },
    [RUN_M]: { Audio: 'C:\\Apps\\audio.exe' },
    [RUN_32]: { Legacy: 'C:\\Apps\\old.exe' },
    [`${U}\\Run`]: { Chat: '030000000000000000000000' },        // disabled by this user
    [`${M}\\Run`]: { Audio: '030000000000000000000000' },       // disabled machine-wide
    [`${U}\\Run32`]: { Legacy: '020000000000000000000000' },
  }, {
    'c:\\apps\\chat.exe': { path: 'C:\\Apps\\chat.exe', exists: true, status: 'Valid', signer: 'CN=Chat Inc, O=Chat', company: 'Chat Inc', product: 'Chat' },
    'c:\\apps\\sync.exe': { path: 'C:\\Apps\\sync.exe', exists: true, status: 'NotSigned', signer: '', company: '' },
  });
  const { env, mgr } = manager(backend);
  const sf = path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  fs.writeFileSync(path.join(sf, 'Notes.lnk'), 'x');
  fs.writeFileSync(path.join(sf, 'desktop.ini'), 'x');
  const list = await mgr.list();
  const by = Object.fromEntries(list.map((e) => [e.id, e]));
  assert.deepStrictEqual(Object.keys(by).sort(), ['folder-user|Notes.lnk', 'hkcu-run|Chat', 'hkcu-run|Cloud Sync', 'hklm-run32|Legacy', 'hklm-run|Audio']);
  assert.strictEqual(by['hkcu-run|Chat'].enabled, false);
  assert.strictEqual(by['hkcu-run|Chat'].signature, 'valid');
  assert.strictEqual(by['hkcu-run|Chat'].publisher, 'Chat Inc');
  assert.strictEqual(by['hkcu-run|Cloud Sync'].enabled, true, 'no approved value means enabled');
  assert.strictEqual(by['hkcu-run|Cloud Sync'].signature, 'unsigned');
  assert.strictEqual(by['hklm-run|Audio'].enabled, false, 'machine-level disable is honoured');
  assert.strictEqual(by['hklm-run|Audio'].exists, false, 'unknown program path is reported missing');
  assert.strictEqual(by['hklm-run32|Legacy'].enabled, true);
  assert.strictEqual(by['folder-user|Notes.lnk'].name, 'Notes');
  assert.strictEqual(by['folder-user|Notes.lnk'].kind, 'folder');
  assert.strictEqual(by['folder-user|Notes.lnk'].signature, null);
});

test('a per-user approved value overrides the machine-level one', async () => {
  const backend = fakeBackend({
    [RUN_M]: { Audio: 'C:\\Apps\\audio.exe' },
    [`${M}\\Run`]: { Audio: '030000000000000000000000' },
    [`${U}\\Run`]: { Audio: '020000000000000000000000' },
  });
  const { mgr } = manager(backend);
  assert.strictEqual((await mgr.list())[0].enabled, true);
});

test('setEnabled writes the 12-byte flag under the right HKCU key, and list reflects it', async () => {
  const backend = fakeBackend({
    [RUN_U]: { Chat: 'C:\\Apps\\chat.exe' }, [RUN_32]: { Legacy: 'C:\\Apps\\old.exe' },
  });
  const changes = [];
  const { env, mgr } = manager(backend, { onChange: (c) => changes.push(c) });
  fs.writeFileSync(path.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Tray.lnk'), 'x');

  assert.deepStrictEqual(await mgr.setEnabled('hkcu-run|Chat', false), { ok: true, id: 'hkcu-run|Chat', enabled: false });
  assert.deepStrictEqual(backend.writes[0], { key: `${U}\\Run`, name: 'Chat', hex: '03000000' + filetimeHex(Date.UTC(2020, 0, 1)) });
  assert.strictEqual(backend.writes[0].hex.length, 24);

  await mgr.setEnabled('hklm-run32|Legacy', false);
  assert.strictEqual(backend.writes[1].key, `${U}\\Run32`);
  await mgr.setEnabled('folder-common|Tray.lnk', false);
  assert.deepStrictEqual([backend.writes[2].key, backend.writes[2].name], [`${U}\\StartupFolder`, 'Tray.lnk'], 'folder items use the file name');

  assert.strictEqual((await mgr.list()).find((e) => e.id === 'hkcu-run|Chat').enabled, false);
  await mgr.setEnabled('hkcu-run|Chat', true);
  assert.strictEqual(backend.writes[3].hex, '020000000000000000000000');
  assert.strictEqual((await mgr.list()).find((e) => e.id === 'hkcu-run|Chat').enabled, true);
  assert.deepStrictEqual(changes.map((c) => [c.name, c.enabled]), [['Chat', false], ['Legacy', false], ['Tray', false], ['Chat', true]]);
});

test('setEnabled refuses ids that are not live entries and never writes for them', async () => {
  const backend = fakeBackend({ [RUN_U]: { Chat: 'C:\\Apps\\chat.exe' } });
  const { mgr } = manager(backend);
  for (const id of ['hkcu-run|Nope', 'nope|Chat', '..\\..\\x', '', undefined, 'hkcu-run|Chat\u0000x']) {
    assert.deepStrictEqual(await mgr.setEnabled(id, false), { ok: false, error: 'not-found' }, String(id));
  }
  assert.strictEqual(backend.writes.length, 0);
});

test('program details are inspected once per path', async () => {
  let calls = 0;
  const backend = fakeBackend({ [RUN_U]: { A: 'C:\\x\\a.exe' } }, { 'c:\\x\\a.exe': { path: 'C:\\x\\a.exe', exists: true, status: 'Valid', signer: 'CN=X', company: 'X' } });
  const orig = backend.inspect;
  backend.inspect = async (p) => { calls += p.length; return orig(p); };
  const { mgr } = manager(backend);
  await mgr.list();
  await mgr.list();
  assert.strictEqual(calls, 1);
});

// ---- the real PowerShell backend, against a throw-away registry key (never the real Run keys) ----
test('real Windows backend: read, Unicode names, toggle and restore on a temporary key', { skip: process.platform !== 'win32' || !process.env.BYTEMOP_REAL_TESTS, timeout: 120000 }, async () => {
  const id = 'BytemopTest' + Math.random().toString(36).slice(2, 8);
  const base = `HKEY_CURRENT_USER\\Software\\${id}`;
  const reg = (...args) => spawnSync('reg.exe', args, { encoding: 'utf8' });
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-real-su-'));
  const exe = process.execPath;
  try {
    assert.strictEqual(reg('add', `${base}\\Run`, '/v', '微信 helper', '/t', 'REG_SZ', '/d', `"${exe}" --x`, '/f').status, 0);
    assert.strictEqual(reg('add', `${base}\\Run`, '/v', 'Plain', '/t', 'REG_SZ', '/d', `"C:\\definitely\\not\\here.exe"`, '/f').status, 0);
    const config = {
      runSources: [{ id: 'hkcu-run', key: `${base}\\Run`, approved: 'Run', scope: 'user' }],
      folderSources: [{ id: 'folder-user', dir: folder, scope: 'user' }],
      approvedUser: `${base}\\Approved`, approvedMachine: `${base}\\ApprovedMachine`,
    };
    fs.writeFileSync(path.join(folder, 'Shortcut.lnk'), 'x');
    const mgr = createStartupManager({ backend: windowsBackend(), config });

    let list = await mgr.list();
    const zh = list.find((e) => e.name === '微信 helper');
    assert.ok(zh, 'unicode value name survives the round trip');
    assert.strictEqual(zh.exePath, exe);
    assert.strictEqual(zh.exists, true);
    assert.strictEqual(zh.enabled, true);
    const missing = list.find((e) => e.name === 'Plain');
    assert.strictEqual(missing.exists, false);
    assert.ok(list.some((e) => e.id === 'folder-user|Shortcut.lnk'));

    assert.deepStrictEqual(await mgr.setEnabled('hkcu-run|微信 helper', false), { ok: true, id: 'hkcu-run|微信 helper', enabled: false });
    list = await mgr.list();
    assert.strictEqual(list.find((e) => e.name === '微信 helper').enabled, false);
    // the raw registry value is the documented 12-byte binary with the disabled flag
    const q = reg('query', `${base}\\Approved\\Run`, '/v', '微信 helper');
    assert.match(q.stdout, /REG_BINARY\s+03000000[0-9A-Fa-f]{16}/);
    await mgr.setEnabled('hkcu-run|微信 helper', true);
    assert.strictEqual((await mgr.list()).find((e) => e.name === '微信 helper').enabled, true);

    await mgr.setEnabled('folder-user|Shortcut.lnk', false);
    assert.strictEqual((await mgr.list()).find((e) => e.id === 'folder-user|Shortcut.lnk').enabled, false);
  } finally {
    reg('delete', base, '/f');
  }
  assert.notStrictEqual(reg('query', base).status, 0, 'temporary key was removed');
});
