'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const apps = require('../apps');

// A fake Windows profile inside a temp folder.
function fakeEnv() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-apps-'));
  const d = (...p) => { const full = path.join(base, ...p); fs.mkdirSync(full, { recursive: true }); return full; };
  const env = {
    USERPROFILE: d('Users', 'me'), APPDATA: d('Users', 'me', 'AppData', 'Roaming'), LOCALAPPDATA: d('Users', 'me', 'AppData', 'Local'),
    ProgramData: d('ProgramData'), ProgramFiles: d('Program Files'), 'ProgramFiles(x86)': d('Program Files (x86)'),
    SystemRoot: d('Windows'), SystemDrive: path.parse(base).root.replace(/\\$/, ''),
  };
  d('Users', 'me', 'AppData', 'Local', 'Programs');
  d('Users', 'me', 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const put = (p, content = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };
  return { base, env, d, put };
}

test('name matching ignores case and punctuation, drops version tails and generic names', () => {
  assert.strictEqual(apps.normalizeName('Foo-Bar 2.0!'), 'foobar20');
  assert.strictEqual(apps.normalizeName('微信 (WeChat)'), '微信wechat');
  assert.deepStrictEqual([...apps.nameVariants('7-Zip 23.01 (x64)')].sort(), ['7zip', '7zip2301', '7zip2301x64'].sort());
  assert.ok(apps.nameVariants('Foo Editor 2.1.3').has('fooeditor'));
  assert.deepStrictEqual([...apps.nameVariants('Microsoft')], []); // generic
  assert.deepStrictEqual([...apps.nameVariants('App')], []);      // too short / generic
  assert.deepStrictEqual([...apps.nameVariants('Go')], []);       // too short
  assert.ok(apps.nameVariants('微信').has('微信'));                 // two CJK characters are enough
});

test('registry rows: components, updates and entries without an uninstaller are not listed', () => {
  const row = (o) => ({ key: 'HKLM\\x\\' + (o.name || 'a'), scope: 'machine', name: 'Foo', uninstall: '"C:\\Foo\\unins.exe"', ...o });
  const out = apps.parseDesktop([
    row({ name: 'Foo', sizeKB: 2048, installDate: '20240131' }),
    row({ name: 'Hidden', systemComponent: 1 }),
    row({ name: 'Patch', parent: 'Foo' }),
    row({ name: 'Update for Foo', releaseType: 'Update' }),
    row({ name: 'Security Update for Windows (KB5012345)' }),
    row({ name: 'NoUninstaller', uninstall: '' }),
    row({ name: 'Locked', noRemove: 1 }),
    row({ name: 'Foo', key: 'HKLM\\wow\\Foo', version: '' }), // same app seen in the 32-bit view
    { key: 'k', name: '', uninstall: 'x' }, null, 'junk',
  ]);
  assert.deepStrictEqual(out.map((a) => a.name), ['Foo']);
  assert.strictEqual(out[0].size, 2048 * 1024);
  assert.strictEqual(out[0].installDate, Date.UTC(2024, 0, 31));
  assert.match(out[0].id, /^w-[0-9a-f]{16}$/);
  assert.strictEqual(apps.parseDesktop([row({ name: 'Microsoft Visual C++ 2015 Redistributable (x64)' })])[0].shared, true);
  assert.deepStrictEqual(apps.parseDesktop('nonsense'), []);
});

test('Store apps: system packages and extensions are hidden', () => {
  const out = apps.parseStore([
    { fullName: 'a', name: 'Microsoft.WindowsStore' }, { fullName: 'b', name: 'Microsoft.Windows.ShellExperienceHost' },
    { fullName: 'c', name: 'Microsoft.HEIFImageExtension' }, { fullName: 'd', name: 'Contoso.Notes', publisher: 'CN=Contoso Ltd, O=Contoso, C=US' },
  ]);
  assert.deepStrictEqual(out.map((a) => a.name), ['Notes']);
  assert.strictEqual(out[0].publisher, 'Contoso Ltd');
});

test('uninstall command is split without cmd.exe; only System32 programs may be named bare', () => {
  const env = { SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
  const yes = () => true;
  assert.deepStrictEqual(apps.splitCommand('"C:\\Program Files\\Foo\\unins000.exe" /SILENT', env, yes), { exe: 'C:\\Program Files\\Foo\\unins000.exe', args: '/SILENT' });
  assert.deepStrictEqual(apps.splitCommand('C:\\Foo Bar\\remove.exe -u --all', env, yes), { exe: 'C:\\Foo Bar\\remove.exe', args: '-u --all' });
  assert.deepStrictEqual(apps.splitCommand('%LOCALAPPDATA%\\Bar\\un.exe', env, yes), { exe: 'C:\\Users\\me\\AppData\\Local\\Bar\\un.exe', args: '' });
  // msiexec: the 'repair' switch recorded by many installers becomes 'remove'
  assert.deepStrictEqual(apps.splitCommand('MsiExec.exe /I{12345678-1234-1234-1234-123456789ABC}', env, yes),
    { exe: path.join('C:\\Windows', 'System32', 'MsiExec.exe'), args: '/X{12345678-1234-1234-1234-123456789ABC}' });
  assert.strictEqual(apps.splitCommand('winget uninstall x', env, () => false), null);
  assert.strictEqual(apps.splitCommand('evil.exe', env, () => false), null);          // not in System32
  assert.strictEqual(apps.splitCommand('sub\\evil.exe', env, yes), null);               // relative path
  assert.strictEqual(apps.splitCommand('\\\\server\\share\\un.exe', env, yes), null);   // network
  assert.strictEqual(apps.splitCommand('', env, yes), null);
  assert.strictEqual(apps.splitCommand(undefined, env, yes), null);
});

test('install locations are only trusted when they are a real program folder', () => {
  const { env } = fakeEnv();
  const ok = (p) => apps.isSafeInstallDir(p, env);
  assert.strictEqual(ok(path.join(env.ProgramFiles, 'Foo')), true);
  assert.strictEqual(ok(path.join(env.LOCALAPPDATA, 'Programs', 'Foo')), true);
  assert.strictEqual(ok(env.ProgramFiles), false);                      // the shared parent
  assert.strictEqual(ok(env.USERPROFILE), false);                       // holds the user's data
  assert.strictEqual(ok(path.dirname(env.USERPROFILE)), false);         // Users
  assert.strictEqual(ok(path.join(env.USERPROFILE, 'Documents', 'Foo')), false);
  assert.strictEqual(ok(path.join(env.USERPROFILE, 'Desktop')), false);
  assert.strictEqual(ok(env.APPDATA), false);
  assert.strictEqual(ok(path.join(env.SystemRoot, 'System32', 'Foo')), false);
  assert.strictEqual(ok(path.parse(env.ProgramFiles).root), false);
  assert.strictEqual(ok(path.join(path.parse(env.ProgramFiles).root, 'Games')), false); // one level only
  assert.strictEqual(ok('relative\\Foo'), false);
  assert.strictEqual(ok('\\\\server\\share\\a\\b'), false);
  assert.strictEqual(ok(''), false);
  assert.strictEqual(apps.isSafeInstallDir(path.join(env.ProgramFiles, 'Foo'), env, [path.join(env.ProgramFiles, 'Foo')]), false); // caller-protected
});

test('leftovers: finds same-named folders in the usual places and nothing else', async () => {
  const { env, d, put } = fakeEnv();
  put(path.join(env.APPDATA, 'Foo Editor', 'settings.json'), '1234');
  put(path.join(env.LOCALAPPDATA, 'FooEditor', 'cache', 'a.bin'), '12345678');
  put(path.join(env.ProgramData, 'Foo Editor', 'lic.dat'), '12');
  put(path.join(env.LOCALAPPDATA, 'Programs', 'foo-editor', 'foo.exe'), '123456');
  put(path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Foo Editor.lnk'), 'lnk');
  put(path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Other.lnk'), 'lnk');
  put(path.join(env.APPDATA, 'Foo Editor Pro', 'x.txt'));       // different app
  put(path.join(env.APPDATA, 'Microsoft', 'y.txt'));              // generic vendor folder
  d('Users', 'me', 'AppData', 'Roaming', 'Unrelated');

  const found = await apps.findLeftovers({ name: 'Foo Editor 2.1.3 (x64)', installLocation: '' }, { env });
  const rel = found.map((f) => path.relative(path.dirname(env.USERPROFILE), f.path)).sort();
  assert.deepStrictEqual(rel, [
    path.join('..', 'ProgramData', 'Foo Editor'),
    path.join('me', 'AppData', 'Local', 'FooEditor'),
    path.join('me', 'AppData', 'Local', 'Programs', 'foo-editor'),
    path.join('me', 'AppData', 'Roaming', 'Foo Editor'),
    path.join('me', 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Foo Editor.lnk'),
  ].sort());
  const by = (n) => found.find((f) => f.path.endsWith(n));
  assert.strictEqual(by('FooEditor').size, 8);
  assert.strictEqual(by('FooEditor').count, 1);
  assert.strictEqual(by('Foo Editor.lnk').isDir, false);
  assert.strictEqual(by('Foo Editor.lnk').kind, 'shortcut');
  // settings and shared machine data are shown but not ticked by default
  assert.strictEqual(by(path.join('Roaming', 'Foo Editor')).defaultSelected, false);
  assert.strictEqual(by(path.join('ProgramData', 'Foo Editor')).defaultSelected, false);
  assert.strictEqual(by('FooEditor').defaultSelected, true);
  assert.deepStrictEqual(found.map((f) => f.size), [...found.map((f) => f.size)].sort((a, b) => b - a)); // biggest first
});

test('leftovers: folders of other installed apps, excluded folders and links are never offered', async () => {
  const { base, env, put } = fakeEnv();
  put(path.join(env.APPDATA, 'Fooapp', 'a.txt'));
  put(path.join(env.LOCALAPPDATA, 'Fooapp', 'b.txt'));
  const other = await apps.findLeftovers({ name: 'Fooapp', installLocation: '' }, { env, others: new Set(['fooapp']) });
  assert.deepStrictEqual(other, []);

  const kept = await apps.findLeftovers({ name: 'Fooapp', installLocation: '' }, { env, isExcluded: (p) => p.startsWith(path.join(env.APPDATA, 'Fooapp')) });
  assert.deepStrictEqual(kept.map((f) => f.path), [path.join(env.LOCALAPPDATA, 'Fooapp')]);

  // a junction named like the app must not be followed or offered
  const target = path.join(base, 'precious');
  put(path.join(target, 'doc.txt'));
  fs.symlinkSync(target, path.join(env.ProgramData, 'Fooapp'), 'junction');
  const withLink = await apps.findLeftovers({ name: 'Fooapp', installLocation: '' }, { env });
  assert.ok(!withLink.some((f) => f.path.startsWith(env.ProgramData)));
});

test('leftovers: the recorded install folder is offered only when it is a safe program folder', async () => {
  const { env, put } = fakeEnv();
  const prog = path.join(env.ProgramFiles, 'Weird Vendor', 'Tool');
  put(path.join(prog, 'tool.exe'), '12345');
  const ok = await apps.findLeftovers({ name: 'Tool Suite', installLocation: prog }, { env });
  assert.deepStrictEqual(ok.map((f) => [f.path, f.kind]), [[prog, 'install']]);
  assert.strictEqual(ok[0].defaultSelected, false, 'machine-wide folders need admin rights, so they are not ticked');

  // an installer that recorded the user's profile / Documents must not make us offer it
  put(path.join(env.USERPROFILE, 'Documents', 'thesis.docx'));
  assert.deepStrictEqual(await apps.findLeftovers({ name: 'Tool Suite', installLocation: env.USERPROFILE }, { env }), []);
  assert.deepStrictEqual(await apps.findLeftovers({ name: 'Tool Suite', installLocation: path.join(env.USERPROFILE, 'Documents') }, { env }), []);
  assert.deepStrictEqual(await apps.findLeftovers({ name: 'Tool Suite', installLocation: env.ProgramFiles }, { env }), []);
});

test('measure: counts files, skips excluded ones and stops at the cap', async () => {
  const { base, put } = fakeEnv();
  for (let i = 0; i < 5; i++) put(path.join(base, 'm', 'sub', `f${i}`), 'abc');
  put(path.join(base, 'm', 'keep', 'k.txt'), 'zzzz');
  const all = await apps.measure(path.join(base, 'm'));
  assert.deepStrictEqual([all.count, all.size, all.truncated], [6, 19, false]);
  const ex = await apps.measure(path.join(base, 'm'), { isExcluded: (p) => p.includes('keep') });
  assert.deepStrictEqual([ex.count, ex.excluded], [5, 1]);
  const cap = await apps.measure(path.join(base, 'm'), { maxFiles: 3 });
  assert.strictEqual(cap.truncated, true);
});

test('Store app names are made readable, and the package name stays searchable', () => {
  assert.strictEqual(apps.friendlyStoreName('Microsoft.BingNews'), 'Bing News');
  assert.strictEqual(apps.friendlyStoreName('Microsoft.WindowsCalculator'), 'Windows Calculator');
  assert.strictEqual(apps.friendlyStoreName('AdvancedMicroDevicesInc-RSXCM'), 'Advanced Micro Devices Inc-RSXCM');
  assert.strictEqual(apps.friendlyStoreName('XYZ.HTTPClientApp'), 'HTTP Client App');
  assert.strictEqual(apps.friendlyStoreName('...'), '...');
  const [a] = apps.parseStore([{ fullName: 'f', name: 'Microsoft.BingNews', publisher: 'CN="Foo, Inc.", O=Foo' }]);
  assert.deepStrictEqual([a.name, a.packageName, a.publisher], ['Bing News', 'Microsoft.BingNews', 'Foo, Inc.']);
});
