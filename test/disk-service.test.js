'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDiskService } = require('../disk-service');

const MB = 1024 * 1024;
function setup(spec, extra = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-dsvc-'));
  for (const [rel, content] of Object.entries(spec)) {
    const p = path.join(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  const trashed = [];
  const events = [];
  const svc = createDiskService({
    env: {}, protectedRoots: [path.join(base, 'Windows')],
    trashItem: async (p) => { trashed.push(p); fs.rmSync(p); },
    logEvent: async (e) => events.push(e), ...extra,
  });
  return { base, svc, trashed, events, p: (rel) => path.join(base, rel) };
}

test('analysis marks protected files and hides excluded ones', async () => {
  const s = setup({ 'Windows/sys.dll': Buffer.alloc(3 * MB), 'mine/big.iso': Buffer.alloc(2 * MB), 'mine/secret/x.bin': Buffer.alloc(MB) },
    { getExcluded: async () => (f) => f.includes('secret') });
  const r = await s.svc.analyze(s.base);
  const byName = Object.fromEntries(r.large.map((f) => [f.name, f]));
  assert.strictEqual(byName['sys.dll'].protected, true);
  assert.strictEqual(byName['big.iso'].protected, false);
  assert.ok(!byName['x.bin'], 'excluded file is not offered');
});

test('only files from the latest analysis can be trashed, and they go through the injected trash', async () => {
  const s = setup({ 'a/big.bin': Buffer.alloc(2 * MB) });
  await s.svc.analyze(s.base);
  fs.mkdirSync(s.p('b'));
  fs.writeFileSync(s.p('b/other.txt'), 'created after the analysis');
  const out = await s.svc.trash([s.p('a/big.bin'), s.p('b/other.txt'), 'C:\\Windows\\System32\\cmd.exe']);
  assert.strictEqual(out.trashed, 1);
  assert.strictEqual(out.bytes, 2 * MB);
  assert.deepStrictEqual(out.failed.map((f) => f.reason).sort(), ['not-listed', 'not-listed']);
  assert.ok(fs.existsSync(s.p('b/other.txt')));
  assert.deepStrictEqual(s.events, [{ type: 'trash', n: 1, bytes: 2 * MB }]);
});

test('protected and excluded files are refused even if listed', async () => {
  let excludeNow = false;
  const s = setup({ 'Windows/sys.dll': Buffer.alloc(2 * MB), 'mine/a.bin': Buffer.alloc(2 * MB) }, { getExcluded: async () => (f) => excludeNow && f.endsWith('a.bin') });
  await s.svc.analyze(s.base);
  excludeNow = true; // added after the analysis
  const out = await s.svc.trash([s.p('Windows/sys.dll'), s.p('mine/a.bin')]);
  assert.strictEqual(out.trashed, 0);
  assert.deepStrictEqual(out.failed.map((f) => f.reason).sort(), ['excluded', 'protected']);
  assert.deepStrictEqual(s.trashed, []);
});

test('a file that changed since the analysis is not trashed', async () => {
  const s = setup({ 'a.bin': Buffer.alloc(2 * MB) });
  await s.svc.analyze(s.base);
  fs.writeFileSync(s.p('a.bin'), 'now tiny');
  const out = await s.svc.trash([s.p('a.bin')]);
  assert.strictEqual(out.trashed, 0);
  assert.strictEqual(out.failed[0].reason, 'changed');
});

test('path spelling tricks do not bypass the list or the protected folders', async () => {
  const s = setup({ 'Windows/sys.dll': Buffer.alloc(2 * MB), 'mine/a.bin': Buffer.alloc(2 * MB) });
  await s.svc.analyze(s.base);
  const out = await s.svc.trash([s.p('mine/../Windows/sys.dll').toUpperCase(), s.p('mine/./a.bin')]);
  assert.strictEqual(out.trashed, 1);
  assert.strictEqual(out.failed[0].reason, 'protected');
});

test('duplicates: at least one copy of every group is always kept', async () => {
  const same = Buffer.alloc(2 * MB, 3);
  const s = setup({ 'x/a.bin': same, 'y/a.bin': same, 'z/a.bin': same });
  await s.svc.analyze(s.base);
  const d = await s.svc.duplicates();
  assert.strictEqual(d.groups.length, 1);
  const files = d.groups[0].files.map((f) => f.path);
  const all = await s.svc.trash(files);
  assert.strictEqual(all.trashed, 0);
  assert.ok(all.failed.every((f) => f.reason === 'all-copies'));
  const two = await s.svc.trash(files.slice(0, 2));
  assert.strictEqual(two.trashed, 2);
  assert.ok(fs.existsSync(files[2]));
});

test('duplicates need an analysis first; a bad folder is reported', async () => {
  const s = setup({});
  assert.deepStrictEqual(await s.svc.duplicates(), { error: 'no-analysis' });
  assert.deepStrictEqual(await s.svc.analyze(path.join(s.base, 'nope')), { error: 'not-a-folder' });
  assert.deepStrictEqual(await s.svc.analyze('relative\\path'.replace('relative', '')), { error: 'not-a-folder' });
});

test('trashing before any analysis does nothing', async () => {
  const s = setup({ 'a.bin': 'x' });
  assert.deepStrictEqual(await s.svc.trash([s.p('a.bin')]), { trashed: 0, bytes: 0, failed: [] });
});

test('keep-one-copy also holds across separate trash requests', async () => {
  const same = Buffer.alloc(2 * MB, 9);
  const s = setup({ 'x/a.bin': same, 'y/a.bin': same, 'z/a.bin': same });
  await s.svc.analyze(s.base);
  const files = (await s.svc.duplicates()).groups[0].files.map((f) => f.path);
  assert.strictEqual((await s.svc.trash([files[0], files[1]])).trashed, 2);
  const last = await s.svc.trash([files[2]]);
  assert.strictEqual(last.trashed, 0);
  assert.strictEqual(last.failed[0].reason, 'all-copies');
  assert.ok(fs.existsSync(files[2]));
});

test('the Recycle Bin check can refuse a file, and nothing is trashed then', async () => {
  const s = setup({ 'a.bin': Buffer.alloc(2 * MB) }, { canTrash: async () => ({ ok: false, reason: 'too-big' }) });
  await s.svc.analyze(s.base);
  const out = await s.svc.trash([s.p('a.bin')]);
  assert.strictEqual(out.trashed, 0);
  assert.strictEqual(out.failed[0].reason, 'too-big');
  assert.deepStrictEqual(s.trashed, []);
});

test('two overlapping analyses: the newer one wins and the older reports cancelled', async () => {
  const s = setup({ 'a/a.bin': Buffer.alloc(2 * MB), 'b/b.bin': Buffer.alloc(3 * MB) });
  const first = s.svc.analyze(s.p('a'));
  const second = s.svc.analyze(s.p('b'));
  const [r1, r2] = await Promise.all([first, second]);
  assert.strictEqual(r1.cancelled, true);
  assert.strictEqual(r2.cancelled, false);
  assert.deepStrictEqual(r2.large.map((f) => f.name), ['b.bin']);
  assert.strictEqual((await s.svc.trash([s.p('a/a.bin')])).failed[0].reason, 'not-listed', 'the old analysis is gone');
});

test('UNC and extended-length spellings of a folder are not analysed, and protected folders are matched by real path', async () => {
  const s = setup({ 'Windows/sys.dll': Buffer.alloc(2 * MB), 'mine/a.bin': Buffer.alloc(2 * MB) });
  assert.deepStrictEqual(await s.svc.analyze('\\\\?\\' + s.base), { error: 'not-a-folder' });
  assert.deepStrictEqual(await s.svc.analyze('\\\\localhost\\' + s.base.replace(':', '$')), { error: 'not-a-folder' });
  const r = await s.svc.analyze(s.base.toUpperCase());
  const sys = r.large.find((f) => f.name === 'sys.dll');
  assert.strictEqual(sys.protected, true);
});

test('duplicates: OneDrive files are not read, and the user is told how many were skipped', async () => {
  const same = Buffer.alloc(2 * MB, 7);
  const files = { 'x/a.bin': same, 'y/a.bin': same, 'OneDrive/a.bin': same, 'OneDrive/sub/b.bin': same };
  const s = setup(files, { cloudRoots: [path.join(os.tmpdir(), 'unused')] });
  await s.svc.analyze(s.base);
  assert.strictEqual((await s.svc.duplicates()).groups[0].files.length, 4); // without a cloud root they all count

  const t = setup(files);
  const cloud = path.join(t.base, 'OneDrive');
  const svc = require('../disk-service').createDiskService({ env: {}, cloudRoots: [cloud], protectedRoots: [], trashItem: async () => {} });
  await svc.analyze(t.base);
  const d = await svc.duplicates();
  assert.strictEqual(d.skippedCloud, 2);
  assert.deepStrictEqual(d.groups[0].files.map((f) => path.relative(t.base, f.path)).sort(), [path.join('x', 'a.bin'), path.join('y', 'a.bin')]);
});
