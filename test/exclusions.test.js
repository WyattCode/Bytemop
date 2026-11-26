'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compile, validate, normalize, sameEntry } = require('../exclusions');
const { createService } = require('../clean-service');
const { executeJob } = require('../helper');
const { loadPacks } = require('../rule-engine');

const P = (value) => ({ type: 'path', value });

test('a folder exclusion protects the folder and everything inside it, but not siblings', () => {
  const { isExcluded } = compile([P('C:\\Users\\me\\Keep')]);
  assert.ok(isExcluded('C:\\Users\\me\\Keep'));
  assert.ok(isExcluded('C:\\Users\\me\\Keep\\a\\b.txt'));
  assert.ok(isExcluded('c:/users/ME/keep/a.txt'), 'case and slash style do not matter');
  assert.ok(!isExcluded('C:\\Users\\me\\KeepMe\\a.txt'), 'a longer sibling name is not covered');
  assert.ok(!isExcluded('C:\\Users\\me\\Other\\a.txt'));
});

test('a file exclusion protects exactly that file', () => {
  const { isExcluded } = compile([P('C:\\t\\a.log')]);
  assert.ok(isExcluded('C:\\t\\a.log'));
  assert.ok(!isExcluded('C:\\t\\a.log.bak'));
  assert.ok(!isExcluded('C:\\t\\b.log'));
});

test('* stays within one folder level, ** crosses folders', () => {
  const one = compile([P('C:\\Users\\*\\Downloads')]).isExcluded;
  assert.ok(one('C:\\Users\\alice\\Downloads\\x.iso'));
  assert.ok(!one('C:\\Users\\alice\\bob\\Downloads\\x.iso'));
  const deep = compile([P('C:\\data\\**\\*.iso')]).isExcluded;
  assert.ok(deep('C:\\data\\a\\b\\c\\big.iso'));
  assert.ok(!deep('C:\\data\\a\\big.txt'));
  const ext = compile([P('C:\\t\\*.tmp')]).isExcluded;
  assert.ok(ext('C:\\t\\x.tmp'));
  assert.ok(!ext('C:\\t\\sub\\x.tmp'));
});

test('regex characters in paths are literal', () => {
  const { isExcluded } = compile([P('C:\\a+b (1)\\[x]')]);
  assert.ok(isExcluded('C:\\a+b (1)\\[x]\\f'));
  assert.ok(!isExcluded('C:\\aab (1)\\[x]\\f'));
});

test('environment variables are expanded; unresolved ones are ignored', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
  const { isExcluded } = compile([P('%LOCALAPPDATA%\\MyApp'), P('%NOPE%\\x')], env);
  assert.ok(isExcluded('C:\\Users\\me\\AppData\\Local\\MyApp\\cache\\f'));
  assert.ok(!isExcluded('\\x\\f'));
});

test('rule exclusions are collected separately', () => {
  const c = compile([{ type: 'rule', value: 'chrome-cache' }, P('C:\\a')]);
  assert.deepStrictEqual([...c.rules], ['chrome-cache']);
});

test('validation: shapes, absolute paths, known rules', () => {
  const rules = new Set(['user-temp']);
  assert.deepStrictEqual(validate({ type: 'rule', value: 'user-temp' }, rules), { ok: true, entry: { type: 'rule', value: 'user-temp' } });
  assert.strictEqual(validate({ type: 'rule', value: 'nope' }, rules).error, 'unknown-rule');
  assert.strictEqual(validate({ type: 'path', value: '  ' }, rules).error, 'empty');
  assert.strictEqual(validate({ type: 'path', value: 'relative\\dir' }, rules).error, 'not-absolute');
  assert.strictEqual(validate({ type: 'path', value: '\\\\server\\share' }, rules).error, 'not-absolute');
  assert.strictEqual(validate({ type: 'path', value: 'C:\\a\\..\\b' }, rules).error, 'not-absolute');
  assert.strictEqual(validate({ type: 'path', value: 'C:\\' + 'a'.repeat(500) }, rules).error, 'too-long');
  assert.strictEqual(validate({ type: 'shell', value: 'x' }, rules).error, 'invalid-type');
  assert.strictEqual(validate(null, rules).error, 'invalid-type');
  assert.deepStrictEqual(validate({ type: 'path', value: 'C:/a/b' }, rules).entry, { type: 'path', value: 'C:\\a\\b' });
  assert.ok(validate({ type: 'path', value: '%TEMP%\\keep' }, rules).ok);
  assert.ok(sameEntry({ type: 'path', value: 'C:\\A\\' }, { type: 'path', value: 'c:/a' }));
  assert.strictEqual(normalize('C:\\A\\\\B\\'), 'c:\\a\\b');
});

// ---- integration through the service ----
const rules = [
  { id: 'cache', targets: [{ path: '%LOCALAPPDATA%\\App\\Cache', recurse: true }] },
  { id: 'other', targets: [{ path: '%LOCALAPPDATA%\\Other', recurse: true }] },
];

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-ex-'));
  const local = path.join(base, 'Local');
  const file = (rel, content) => { const p = path.join(local, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };
  const svc = createService({ dataDir: path.join(base, 'data'), rules, cleanerOpts: { env: { LOCALAPPDATA: local }, running: new Set() } });
  return { base, local, file, svc };
}

test('excluded paths survive a quarantine clean and a permanent clean; others are cleaned', async () => {
  for (const mode of ['quarantine', 'permanent']) {
    const s = setup();
    const keepDir = s.file('App\\Cache\\keep\\important.dat', 'IMPORTANT');
    const keepFile = s.file('App\\Cache\\one.bin', 'ONE');
    const gone = s.file('App\\Cache\\junk\\a.bin', 'junk');
    assert.strictEqual((await s.svc.addExclusion({ type: 'path', value: path.join(s.local, 'App', 'Cache', 'keep') })).ok, true);
    assert.strictEqual((await s.svc.addExclusion({ type: 'path', value: keepFile })).ok, true);
    const out = await s.svc.clean(['cache'], { mode });
    assert.strictEqual(out.totals.deleted, 1, mode);
    assert.ok(fs.existsSync(keepDir) && fs.existsSync(keepFile), mode);
    assert.ok(!fs.existsSync(gone), mode);
  }
});

test('scan and details do not count excluded files', async () => {
  const s = setup();
  s.file('App\\Cache\\keep\\big.dat', Buffer.alloc(1000));
  s.file('App\\Cache\\small.bin', Buffer.alloc(10));
  assert.strictEqual((await s.svc.scan()).find((r) => r.id === 'cache').bytes, 1010);
  await s.svc.addExclusion({ type: 'path', value: path.join(s.local, 'App', 'Cache', 'keep') });
  const r = (await s.svc.scan()).find((x) => x.id === 'cache');
  assert.strictEqual(r.bytes, 10);
  const d = await s.svc.details('cache');
  assert.deepStrictEqual(d.entries.map((e) => e.name), ['small.bin']);
  assert.strictEqual(d.entries[0].path, path.join(s.local, 'App', 'Cache', 'small.bin'));
});

test('an excluded rule is flagged, not scanned, and refused by clean', async () => {
  const s = setup();
  const f = s.file('App\\Cache\\a.bin', 'x');
  s.file('Other\\b.bin', 'y');
  await s.svc.addExclusion({ type: 'rule', value: 'cache' });
  const scan = await s.svc.scan();
  assert.deepStrictEqual(scan.find((r) => r.id === 'cache'), { id: 'cache', bytes: 0, count: 0, blockedBy: [], excluded: true });
  assert.strictEqual(scan.find((r) => r.id === 'other').count, 1);
  const out = await s.svc.clean(['cache', 'other']);
  assert.strictEqual(out.results.find((r) => r.id === 'cache').reason, 'excluded');
  assert.strictEqual(out.totals.deleted, 1);
  assert.ok(fs.existsSync(f));
  const only = await s.svc.clean(['cache']);
  assert.strictEqual(only.mode, null, 'nothing left to clean, so no run is started');
  assert.strictEqual(only.results[0].reason, 'excluded');
  assert.ok(fs.existsSync(f));
});

test('removing an exclusion makes the files cleanable again; list persists and dedupes', async () => {
  const s = setup();
  const f = s.file('App\\Cache\\a.bin', 'x');
  const a = await s.svc.addExclusion({ type: 'path', value: f });
  const b = await s.svc.addExclusion({ type: 'path', value: f.toUpperCase() });
  assert.strictEqual(b.duplicate, true);
  assert.strictEqual((await s.svc.listExclusions()).length, 1);
  assert.strictEqual((await s.svc.scan()).find((r) => r.id === 'cache').count, 0);
  assert.strictEqual(await s.svc.removeExclusion(a.entry.id), true);
  assert.strictEqual(await s.svc.removeExclusion('nope'), false);
  assert.strictEqual((await s.svc.scan()).find((r) => r.id === 'cache').count, 1);
  // survives a new service instance on the same folder
  await s.svc.addExclusion({ type: 'rule', value: 'other' });
  const again = createService({ dataDir: path.join(s.base, 'data'), rules, cleanerOpts: { env: { LOCALAPPDATA: s.local }, running: new Set() } });
  assert.strictEqual((await again.listExclusions()).length, 1);
});

test('invalid exclusions are rejected without touching the list; the list is capped', async () => {
  const s = setup();
  assert.strictEqual((await s.svc.addExclusion({ type: 'path', value: 'relative' })).error, 'not-absolute');
  assert.strictEqual((await s.svc.addExclusion({ type: 'rule', value: 'nope' })).error, 'unknown-rule');
  assert.strictEqual((await s.svc.listExclusions()).length, 0);
});

test('an unreadable exclusions file stops the operation (fail closed); odd entries inside a valid file are skipped', async () => {
  const s = setup();
  s.file('keep/f.txt', 'x');
  fs.mkdirSync(path.join(s.base, 'data'), { recursive: true });
  fs.writeFileSync(path.join(s.base, 'data', 'exclusions.json'), '{ not json');
  await assert.rejects(() => s.svc.listExclusions(), /exclusions-unreadable/);
  await assert.rejects(() => s.svc.clean(['cache']), /exclusions-unreadable/, 'nothing is cleaned while the keep-list is unknown');
  await assert.rejects(() => s.svc.addExclusion({ type: 'rule', value: 'cache' }), /exclusions-unreadable/, 'and the damaged file is never overwritten');
  assert.strictEqual(fs.readFileSync(path.join(s.base, 'data', 'exclusions.json'), 'utf8'), '{ not json');
  fs.writeFileSync(path.join(s.base, 'data', 'exclusions.json'), JSON.stringify([{ id: 1 }, null, { id: 'x', type: 'path', value: 5 }]));
  assert.deepStrictEqual(await s.svc.listExclusions(), []);
});

test('the elevated helper honours the same exclusions', async () => {
  const allRules = loadPacks(path.join(__dirname, '..', 'rules')).rules;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-exh-'));
  const sysRoot = path.join(base, 'Windows');
  const local = path.join(base, 'Local');
  const winTemp = path.join(sysRoot, 'Temp');
  fs.mkdirSync(path.join(winTemp, 'keep'), { recursive: true });
  const old = (p) => { fs.writeFileSync(p, 'x'); const t = new Date(Date.now() - 3 * 86400e3); require('./backdate').backdate(p, t); return p; };
  const keep = old(path.join(winTemp, 'keep', 'k.tmp'));
  const gone = old(path.join(winTemp, 'g.tmp'));
  const env = { SystemRoot: sysRoot, LOCALAPPDATA: local };
  // the unprivileged app writes the exclusion; the helper (separate process in real life) reads it
  const app = createService({ dataDir: path.join(local, 'Bytemop'), rules: allRules, cleanerOpts: { env } });
  await app.addExclusion({ type: 'path', value: path.join(winTemp, 'keep') });
  const r = await executeJob({ type: 'clean', ruleIds: ['win-temp'], mode: 'permanent' }, { allRules, env });
  assert.strictEqual(r.totals.deleted, 1);
  assert.ok(fs.existsSync(keep));
  assert.ok(!fs.existsSync(gone));
});

test('a crafted pattern with many wildcards cannot hang the matcher', () => {
  const pattern = 'C:\\' + '**a'.repeat(14) + 'b';
  const { isExcluded } = compile([P(pattern)]);
  const t = Date.now();
  assert.strictEqual(isExcluded('C:\\' + 'a'.repeat(60) + '\\x'), false);
  assert.ok(Date.now() - t < 500, 'took ' + (Date.now() - t) + ' ms');
});

test('matching semantics are unchanged by the linear matcher', () => {
  const { isExcluded } = compile([P('C:\\Users\\*\\Downloads\\**\\*.iso'), P('C:\\data\\a?b')]);
  assert.ok(isExcluded('C:\\Users\\me\\Downloads\\x\\y\\z.iso'));
  assert.ok(isExcluded('C:\\Users\\me\\Downloads\\z.iso'), '\\**\\ may match zero folders');
  assert.ok(!isExcluded('C:\\Users\\me\\other\\Downloads\\z.iso'));
  assert.ok(!isExcluded('C:\\Users\\a\\b\\Downloads\\z.iso'), '* does not cross folders');
  assert.ok(isExcluded('C:\\data\\a?b'), '? is an ordinary character, not a regex quantifier');
  assert.ok(!isExcluded('C:\\data\\b'));
});
