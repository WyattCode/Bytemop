'use strict';
// Regression tests for the bugs found in the third review (cleaning core, quarantine, elevation, privacy, disk).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compile } = require('../exclusions');
const { scan, clean, isForbiddenRoot } = require('../cleaner');
const { Quarantine } = require('../quarantine');
const { createService } = require('../clean-service');
const { atomicWrite } = require('../atomic');
const { quoteWinArg } = require('../winquote');
const { buildLaunchScript } = require('../elevation');
const { extractExe } = require('../startup');
const privacy = require('../privacy');
const { analyze } = require('../disk-analyzer');
const { isPortableRun } = require('../runtime');
const { backdate } = require('./backdate');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-cr-'));
const P = (value) => ({ type: 'path', value });

test('exclusion pattern "\\**\\" matches zero or more folders', () => {
  const { isExcluded } = compile([P('C:\\Users\\*\\Downloads\\**\\*.iso')]);
  assert.ok(isExcluded('C:\\Users\\me\\Downloads\\z.iso'), 'no folder in between');
  assert.ok(isExcluded('C:\\Users\\me\\Downloads\\a\\z.iso'));
  assert.ok(isExcluded('C:\\Users\\me\\Downloads\\a\\b\\c\\z.iso'));
  assert.ok(!isExcluded('C:\\Users\\me\\Downloads\\z.txt'));
  assert.ok(!isExcluded('C:\\Users\\me\\other\\z.iso'));
  assert.ok(!isExcluded('C:\\Users\\me\\Downloads2\\z.iso'), 'the folder name must match whole');
});

test('an exclusion whose %VAR% cannot be resolved is kept as written, not dropped', () => {
  const { isExcluded } = compile([P('%NO_SUCH_VAR_XYZ%\\keep')], {});
  assert.ok(isExcluded('%no_such_var_xyz%\\keep\\a.txt'));
});

// The short (8.3) spelling of a path, asked from Windows; null where 8.3 names are switched off.
function shortPathOf(p) {
  const out = require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:BM_P).ShortPath'], { env: { ...process.env, BM_P: p }, encoding: 'utf8', windowsHide: true }).trim();
  return out && out.toLowerCase() !== p.toLowerCase() && out.includes('~') ? out : null;
}

test('an exclusion typed with a short (8.3) name also protects the real folder', () => {
  const dir = tmp();
  const real = path.join(dir, 'A Long Folder Name');
  fs.mkdirSync(real);
  const short = shortPathOf(real);
  if (!short) return; // 8.3 names are off on this volume
  const { isExcluded } = compile([P(short)]);
  assert.ok(isExcluded(path.join(real, 'x.txt')), 'real spelling is covered');
  assert.ok(isExcluded(path.join(short, 'x.txt')), 'short spelling still covered');
});

test('files unpacked a moment ago are young even if their modified time is old', async () => {
  const dir = tmp();
  const root = path.join(dir, 'Users', 'me', 'AppData', 'Local', 'Temp');
  fs.mkdirSync(root, { recursive: true });
  const f = path.join(root, 'unpacked.bin');
  fs.writeFileSync(f, 'x');
  const t = new Date(Date.now() - 90 * 86400e3);
  fs.utimesSync(f, t, t); // old mtime, brand-new file
  const env = { LOCALAPPDATA: path.join(dir, 'Users', 'me', 'AppData', 'Local'), TEMP: root };
  const [r] = await scan([{ id: 'temp', minAgeHours: 24, targets: [{ path: '%TEMP%', recurse: true }] }], { env, running: new Set() });
  assert.strictEqual(r.count, 0);
});

test('a new, still empty folder is not pruned while the rule has a minimum age', async () => {
  const dir = tmp();
  const root = path.join(dir, 'Users', 'me', 'AppData', 'Local', 'Temp');
  const young = path.join(root, 'work');
  const old = path.join(root, 'olddir');
  fs.mkdirSync(young, { recursive: true });
  fs.mkdirSync(old, { recursive: true });
  const t = new Date(Date.now() - 3 * 86400e3);
  backdate(old, t);
  const env = { LOCALAPPDATA: path.join(dir, 'Users', 'me', 'AppData', 'Local'), TEMP: root };
  await clean([{ id: 'temp', minAgeHours: 24, targets: [{ path: '%TEMP%', recurse: true }] }], { env, running: new Set() });
  assert.ok(fs.existsSync(young), 'a folder an app has just made stays');
  assert.ok(!fs.existsSync(old), 'an old empty folder still goes');
});

test('a TEMP that points at the profile (or Documents) is refused as a clean target', async () => {
  const dir = tmp();
  const home = path.join(dir, 'Users', 'me');
  fs.mkdirSync(path.join(home, 'Documents'), { recursive: true });
  fs.writeFileSync(path.join(home, 'Documents', 'thesis.docx'), 'important');
  const env = { USERPROFILE: home, LOCALAPPDATA: path.join(home, 'AppData', 'Local'), SystemRoot: path.join(dir, 'Windows'), TEMP: home };
  assert.strictEqual(isForbiddenRoot(home, env), true);
  assert.strictEqual(isForbiddenRoot(path.join(home, 'Documents'), env), true);
  assert.strictEqual(isForbiddenRoot(path.dirname(home), env), true, 'the Users folder contains the profile');
  assert.strictEqual(isForbiddenRoot(path.join(home, 'AppData', 'Local', 'Temp'), env), false);
  const [r] = await scan([{ id: 'temp', targets: [{ path: '%TEMP%', recurse: true }] }], { env, running: new Set() });
  assert.strictEqual(r.count, 0);
});

test('concurrent meta writes cannot clash, and a lost meta.json is rebuilt from the journal', async () => {
  const dir = tmp();
  const q = new Quarantine(path.join(dir, 'q'));
  const src = path.join(dir, 'src.txt');
  fs.writeFileSync(src, 'hello');
  const run = await q.begin({ rules: ['r'], elevated: false });
  await q.moveFile(run, src, 5, 'r', Date.now());
  const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => q._finalize(run.id, 'committed')));
  assert.ok(results.every((r) => r.status === 'fulfilled'), 'no ENOENT from a shared temp file');
  // damage the meta: the run must still be listed and restorable
  fs.writeFileSync(path.join(q.runDir(run.id), 'meta.json'), '{ broken');
  const runs = await q.list();
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].count, 1);
  assert.strictEqual(runs[0].metaRebuilt, true);
  assert.strictEqual(await q.totalBytes(), 5);
  const res = await q.restore(run.id);
  assert.strictEqual(res.restored, 1);
  assert.strictEqual(fs.readFileSync(src, 'utf8'), 'hello');
});

test('restore never replaces a file that appeared at the original path', async () => {
  const dir = tmp();
  const q = new Quarantine(path.join(dir, 'q'));
  const src = path.join(dir, 'a.txt');
  fs.writeFileSync(src, 'original');
  const run = await q.begin({});
  await q.moveFile(run, src, 8, 'r', Date.now());
  await q.commit(run);
  fs.writeFileSync(src, 'newer file made meanwhile');
  const res = await q.restore(run.id);
  assert.strictEqual(res.restored, 1);
  assert.strictEqual(res.renamed, 1);
  assert.strictEqual(fs.readFileSync(src, 'utf8'), 'newer file made meanwhile');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'a (restored).txt'), 'utf8'), 'original');
});

test('recover leaves a just-created run folder (no meta yet) alone', async () => {
  const dir = tmp();
  const q = new Quarantine(path.join(dir, 'q'));
  fs.mkdirSync(path.join(q.dir, '2099-01-01T00-00-00-000Z-abc123', 'files'), { recursive: true });
  await q.recover(10 * 60 * 1000);
  assert.ok(fs.existsSync(path.join(q.dir, '2099-01-01T00-00-00-000Z-abc123')), 'young: another process may be writing its meta');
  await q.recover(0);
  assert.ok(!fs.existsSync(path.join(q.dir, '2099-01-01T00-00-00-000Z-abc123')), 'with no age guard an empty leftover is removed');
});

test('the quarantine limit ignores rules that are blocked and will not move anything', async () => {
  const dir = tmp();
  const home = path.join(dir, 'Users', 'me');
  const cache = path.join(home, 'AppData', 'Local', 'App', 'Cache');
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(path.join(cache, 'big.bin'), Buffer.alloc(1024 * 1024));
  const env = { USERPROFILE: home, LOCALAPPDATA: path.join(home, 'AppData', 'Local') };
  const rules = [{ id: 'cache', blockedByProcesses: ['app.exe'], targets: [{ path: '%LOCALAPPDATA%\\App\\Cache', recurse: true }] }];
  const svc = createService({ dataDir: path.join(dir, 'data'), rules, cleanerOpts: { env, running: new Set(['app.exe']) } });
  await svc.setSettings({ quarantineLimitGB: 1 });
  const q = svc.quarantine;
  const old = await q.begin({});
  await q._writeMeta(old.id, { id: old.id, createdAt: Date.now(), status: 'committed', count: 1, bytes: 1024 ** 3 - 1000 }); // 1 GB limit almost used up
  const out = await svc.clean(['cache'], { mode: 'quarantine' });
  assert.notStrictEqual(out.error, 'quarantine-limit', 'the blocked rule moves nothing, so it cannot exceed the limit');
});

test('a read error that may pass must not make settings fall back to defaults and overwrite the file', async () => {
  const dir = tmp();
  const svc = createService({ dataDir: dir, rules: [] });
  await svc.setSettings({ retentionDays: 21, theme: 'dark' });
  const file = path.join(dir, 'settings.json');
  const real = fs.readFileSync(file, 'utf8');
  // simulate a lock: make the path a directory so reading it fails with EISDIR (not ENOENT, not a syntax error)
  fs.renameSync(file, file + '.keep');
  fs.mkdirSync(file);
  assert.strictEqual((await svc.getSettings()).retentionDays, 7, 'shown as defaults');
  await assert.rejects(svc.setSettings({ language: 'en' }), /settings-unreadable/);
  await assert.rejects(svc.setSchedule({ enabled: true }), /settings-unreadable/);
  fs.rmdirSync(file);
  fs.renameSync(file + '.keep', file);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), real, 'the real settings were never overwritten');
  assert.strictEqual((await svc.setSettings({ language: 'en' })).retentionDays, 21);
});

test('atomicWrite leaves no temp file behind when the write fails', async () => {
  const dir = tmp();
  const target = path.join(dir, 'missing-dir', 'x.json'); // parent does not exist: the temp file cannot be created
  await assert.rejects(atomicWrite(target, 'x'));
  const ok = path.join(dir, 'y.json');
  await atomicWrite(ok, 'one');
  await atomicWrite(ok, 'two');
  assert.strictEqual(fs.readFileSync(ok, 'utf8'), 'two');
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
});

test('Windows argument quoting handles trailing backslashes and quotes', () => {
  assert.strictEqual(quoteWinArg('plain'), 'plain');
  assert.strictEqual(quoteWinArg('a b'), '"a b"');
  assert.strictEqual(quoteWinArg('C:\\my dir\\'), '"C:\\my dir\\\\"', 'the closing quote must not be escaped by the final backslash');
  assert.strictEqual(quoteWinArg('say "hi"'), '"say \\"hi\\""');
  assert.strictEqual(quoteWinArg('a\\"b c'), '"a\\\\\\"b c"');
  assert.strictEqual(quoteWinArg(''), '""');
});

test('a declined UAC prompt is recognised by its Win32 error code, not only by English text', () => {
  const script = buildLaunchScript({ exe: 'C:\\app\\Bytemop.exe', args: ['--x'] });
  assert.match(script, /NativeErrorCode -eq 1223/);
  assert.match(script, /canceled by the user/);
});

test('an elevation pipe ignores a "null" line instead of crashing and gives the job to one connection only', async () => {
  const net = require('net');
  const { runElevated } = require('../elevation');
  let token; let pipe;
  const launch = ({ pipe: p, token: t }) => { pipe = p; token = t; return new Promise((r) => r({ ok: true })); };
  const run = runElevated({ type: 'scan' }, { launch, connectTimeoutMs: 5000, caller: 'C:\\Users\\me' });
  await new Promise((r) => setTimeout(r, 200));
  const a = net.connect(pipe); const b = net.connect(pipe);
  const got = { a: '', b: '' };
  a.setEncoding('utf8'); b.setEncoding('utf8');
  a.on('data', (d) => { got.a += d; }); b.on('data', (d) => { got.b += d; });
  a.on('error', () => {}); b.on('error', () => {});
  a.write('null\n' + JSON.stringify({ type: 'hello', token }) + '\n');
  await new Promise((r) => setTimeout(r, 150));
  b.write(JSON.stringify({ type: 'hello', token }) + '\n'); // a second connection with a valid token
  await new Promise((r) => setTimeout(r, 150));
  assert.match(got.a, /"type":"job"/);
  assert.ok(!got.b.includes('"job"'), 'the second connection gets nothing');
  a.write(JSON.stringify({ type: 'result', result: { ok: 1 } }) + '\n');
  const out = await run;
  assert.strictEqual(out.status, 'ok');
  a.destroy(); b.destroy();
  void net;
});

test('startup command lines: an icon index after the program name does not cut the path short', () => {
  assert.strictEqual(extractExe('C:\\Program Files\\App\\app.exe,-3'), 'C:\\Program Files\\App\\app.exe');
  assert.strictEqual(extractExe('"C:\\x y\\a.exe" /s'), 'C:\\x y\\a.exe');
  assert.strictEqual(extractExe('C:\\a\\b.exe -x'), 'C:\\a\\b.exe');
});

test('keep list: a kept subdomain keeps the parent-domain login cookies, and public suffixes are not accepted', () => {
  assert.strictEqual(privacy.isKept('.google.com', ['mail.google.com']), true);
  assert.strictEqual(privacy.isKept('mail.google.com', ['mail.google.com']), true);
  assert.strictEqual(privacy.isKept('.example.org', ['mail.google.com']), false);
  assert.strictEqual(privacy.isKept('.github.io', ['foo.github.io']), false, 'github.io is shared by everyone');
  assert.strictEqual(privacy.isKept('bar.github.io', ['foo.github.io']), false);
  assert.strictEqual(privacy.siteOf('.foo.github.io'), 'foo.github.io');
  assert.strictEqual(privacy.normalizeSite('github.io'), null);
  assert.strictEqual(privacy.normalizeSite('co.uk'), null);
  assert.strictEqual(privacy.normalizeSite('https://foo.github.io/x'), 'foo.github.io');
});

test('old scan copies of browser databases are swept from the temp folder', async () => {
  const dir = tmp();
  const old = path.join(dir, 'bytemop-priv-AbC123');
  const fresh = path.join(dir, 'bytemop-priv-XyZ789');
  const other = path.join(dir, 'something-else');
  for (const d of [old, fresh, other]) { fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'History'), 'x'); }
  const past = new Date(Date.now() - 3 * 3600e3);
  fs.utimesSync(old, past, past);
  assert.strictEqual(await privacy.sweepTemp(dir), 1);
  assert.ok(!fs.existsSync(old) && fs.existsSync(fresh) && fs.existsSync(other));
});

test('disk analysis counts a hard-linked file once and reports folders that are too deep', async () => {
  const dir = tmp();
  const a = path.join(dir, 'a.bin');
  fs.writeFileSync(a, Buffer.alloc(3 * 1024 * 1024, 5));
  try { fs.linkSync(a, path.join(dir, 'b.bin')); } catch { return; } // no hard links on this volume
  const r = await analyze(dir, {});
  assert.strictEqual(r.stats.files, 1);
  assert.strictEqual(r.stats.bytes, 3 * 1024 * 1024);
  assert.strictEqual(r.candidates.length, 1, 'one file, so it can never be listed as its own duplicate');
  // 70 levels deep: the part beyond the limit is reported, not silently dropped
  let deep = path.join(dir, 'deep');
  fs.mkdirSync(deep);
  for (let i = 0; i < 68; i++) { deep = path.join(deep, 'd'); }
  try { fs.mkdirSync(deep, { recursive: true }); } catch { return; }
  const r2 = await analyze(path.join(dir, 'deep'), {});
  assert.ok(r2.stats.inaccessible >= 1);
});

test('portable builds are recognised only when really running from the temp folder', () => {
  const tmpdir = 'C:\\Users\\me\\AppData\\Local\\Temp';
  const base = { PORTABLE_EXECUTABLE_FILE: 'D:\\tools\\Bytemop-portable.exe' };
  assert.strictEqual(isPortableRun({ env: base, execPath: tmpdir + '\\abc123\\Bytemop.exe', tmpdir }), true);
  assert.strictEqual(isPortableRun({ env: base, execPath: 'C:\\Program Files\\Bytemop\\Bytemop.exe', tmpdir }), false, 'a stray variable does not make an installed build "portable"');
  assert.strictEqual(isPortableRun({ env: {}, execPath: tmpdir + '\\abc123\\Bytemop.exe', tmpdir }), false);
  assert.strictEqual(isPortableRun({ env: base, execPath: tmpdir + 'x\\Bytemop.exe', tmpdir }), false, 'a sibling folder with the same prefix is not the temp folder');
});

test('a jumped clock does not make the whole quarantine expire at startup', async () => {
  const dir = tmp();
  let t = Date.UTC(2026, 5, 1);
  const svc = createService({ dataDir: dir, rules: [], now: () => t });
  const q = svc.quarantine;
  const run = await q.begin({}, t);
  await q._writeMeta(run.id, { id: run.id, createdAt: t, status: 'committed', count: 1, bytes: 10 });
  const DAY = 24 * 3600 * 1000;
  assert.strictEqual((await svc.startup()).clockOk, true, 'first start');
  t += 2 * DAY;
  assert.strictEqual((await svc.startup()).clockOk, true, 'normal progress');
  // the clock jumps to 2099: nothing expires
  t = Date.UTC(2099, 0, 1);
  const bad = await svc.startup();
  assert.deepStrictEqual([bad.clockOk, bad.expired], [false, 0]);
  assert.strictEqual((await q.list()).length, 1);
  // the clock is repaired: still before the newest time seen? (the 2099 start was not recorded)
  t = Date.UTC(2026, 5, 4);
  assert.strictEqual((await svc.startup()).clockOk, true, 'back to a sane time, the bad start left no trace');
  // a real long absence: first start after it is cautious, the next one that agrees is accepted
  t = Date.UTC(2028, 0, 1);
  assert.strictEqual((await svc.startup()).clockOk, false);
  t += DAY;
  const second = await svc.startup();
  assert.strictEqual(second.clockOk, true);
  assert.strictEqual(second.expired, 1, 'now the old run really expires');
  // a clock set back is never trusted
  t = Date.UTC(2020, 0, 1);
  assert.strictEqual((await svc.startup()).clockOk, false);
});

test('an unreadable exclusions file can be reset: the damaged one is kept, a readable one is left alone', async () => {
  const dir = tmp();
  const svc = createService({ dataDir: dir, rules: [{ id: 'x', targets: [{ path: '%LOCALAPPDATA%\\x' }] }] });
  await svc.addExclusion({ type: 'path', value: 'C:\\keep\\me' });
  assert.deepStrictEqual(await svc.repairExclusions(), { ok: true, repaired: false }, 'readable: nothing to repair');
  assert.strictEqual((await svc.listExclusions()).length, 1);
  const file = path.join(dir, 'exclusions.json');
  fs.writeFileSync(file, '');
  await assert.rejects(svc.listExclusions(), /exclusions-unreadable/);
  await assert.rejects(svc.scan(), /exclusions-unreadable/, 'everything stops while it is broken');
  assert.deepStrictEqual(await svc.repairExclusions(), { ok: true, repaired: true });
  assert.deepStrictEqual(await svc.listExclusions(), []);
  assert.ok(fs.existsSync(file + '.bak'));
  assert.ok((await svc.history()).some((e) => e.type === 'exRepair'));
});

test('the folder Bytemop runs from is never treated as temp junk', async () => {
  const dir = tmp();
  const temp = path.join(dir, 'Users', 'me', 'AppData', 'Local', 'Temp');
  const runtime = path.join(temp, 'abc123');
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, 'LICENSES.chromium.html'), 'x');
  const junk = path.join(temp, 'junk.tmp');
  fs.writeFileSync(junk, 'y');
  backdate(path.join(runtime, 'LICENSES.chromium.html'), new Date(Date.now() - 5 * 86400e3));
  backdate(junk, new Date(Date.now() - 5 * 86400e3));
  const env = { LOCALAPPDATA: path.join(dir, 'Users', 'me', 'AppData', 'Local'), TEMP: temp };
  const rules = [{ id: 'user-temp', minAgeHours: 24, targets: [{ path: '%TEMP%', recurse: true }] }];
  const svc = createService({ dataDir: path.join(dir, 'data'), rules, cleanerOpts: { env, running: new Set() }, implicitExclusions: [runtime] });
  const [r] = await svc.scan();
  assert.strictEqual(r.count, 1, 'only junk.tmp is a candidate');
  await svc.clean(['user-temp'], { mode: 'permanent' });
  assert.ok(fs.existsSync(path.join(runtime, 'LICENSES.chromium.html')));
  assert.ok(!fs.existsSync(junk));
});

test('certificate subjects: quoted names keep their commas, unquoted ones end at the comma', () => {
  const { commonName } = require('../certname');
  assert.strictEqual(commonName('CN="NetEase (Hangzhou) Network Co., Ltd.", O=NetEase, C=CN'), 'NetEase (Hangzhou) Network Co., Ltd.');
  assert.strictEqual(commonName('CN=Contoso Ltd, O=Contoso'), 'Contoso Ltd');
  assert.strictEqual(commonName('O=NoCommonName'), '');
  assert.strictEqual(commonName(undefined), '');
});

test('Windows tools are started by full System32 path when SystemRoot is known', () => {
  const { system32, powershellExe } = require('../syspath');
  const env = { SystemRoot: 'C:\Windows' };
  assert.strictEqual(system32('schtasks.exe', env, () => true), path.join('C:\Windows', 'System32', 'schtasks.exe'));
  assert.strictEqual(powershellExe(env, () => true), path.join('C:\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  assert.strictEqual(system32('schtasks.exe', env, () => false), 'schtasks.exe', 'missing file: bare name');
  assert.strictEqual(system32('schtasks.exe', {}, () => true), 'schtasks.exe', 'no SystemRoot: bare name');
  assert.strictEqual(powershellExe({}, () => true), 'powershell.exe');
});

test('a scan-only scheduled run stays silent below the size threshold and speaks above it', async () => {
  const { runScheduled, MIN_NOTIFY_BYTES } = require('../scheduled-run');
  const mk = (bytes) => {
    const sent = [];
    const service = {
      getSettings: async () => ({ retentionDays: 7, schedule: { enabled: true, mode: 'scan', lowDiskAlert: false } }),
      scan: async () => [{ id: 'r', bytes, count: 3, blockedBy: [] }],
      logEvent: async () => {},
    };
    const rules = [{ id: 'r', risk: 'safe', defaultSelected: true, requiresAdmin: false }];
    return { sent, run: () => runScheduled({ service, rules, locale: 'en', notify: async (m) => { sent.push(m); } }) };
  };
  const small = mk(4096); const sr = await small.run();
  assert.strictEqual(sr.found, 4096);
  assert.strictEqual(small.sent.length, 0, 'a few KB is not worth a toast');
  const big = mk(MIN_NOTIFY_BYTES); await big.run();
  assert.strictEqual(big.sent.length, 1);
});
