'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyze, findDuplicates, makeLimiter } = require('../disk-analyzer');

const MB = 1024 * 1024;
function tree(spec) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-disk-'));
  for (const [rel, content] of Object.entries(spec)) {
    const p = path.join(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof content === 'number' ? Buffer.alloc(content, 7) : content);
  }
  return base;
}

test('folder sizes add up and the biggest folder comes first', async () => {
  const root = tree({ 'a/x.bin': 3 * MB, 'a/sub/y.bin': 2 * MB, 'b/z.bin': 1 * MB, 'top.bin': 100 });
  const r = await analyze(root);
  assert.strictEqual(r.tree.size, 6 * MB + 100);
  assert.strictEqual(r.stats.files, 4);
  assert.deepStrictEqual(r.tree.children.map((c) => c.name), ['a', 'b']);
  assert.strictEqual(r.tree.children[0].size, 5 * MB);
  assert.strictEqual(r.tree.children[0].children[0].name, 'sub');
  assert.strictEqual(r.tree.fileBytes, 100);
});

test('large files are ranked by size and limited to topFiles', async () => {
  const spec = {};
  for (let i = 1; i <= 8; i++) spec[`f${i}.bin`] = i * 1000;
  const r = await analyze(tree(spec), { topFiles: 3 });
  assert.deepStrictEqual(r.large.map((f) => f.size), [8000, 7000, 6000]);
  assert.ok(path.isAbsolute(r.large[0].path) && r.large[0].name === 'f8.bin' && r.large[0].mtimeMs > 0);
});

test('tiny folders are folded into "other" so the tree stays small', async () => {
  const spec = { 'big/a.bin': 5 * MB };
  for (let i = 0; i < 30; i++) spec[`tiny${i}/t.bin`] = 10;
  const r = await analyze(tree(spec));
  assert.deepStrictEqual(r.tree.children.map((c) => c.name), ['big']);
  assert.strictEqual(r.tree.other.dirs, 30);
  assert.strictEqual(r.tree.other.size, 300);
});

test('symlinked folders are not followed (no double counting, no loops)', async (t) => {
  const root = tree({ 'real/a.bin': 2 * MB });
  try { fs.symlinkSync(path.join(root, 'real'), path.join(root, 'link'), 'junction'); } catch { t.skip('cannot create links here'); return; }
  const r = await analyze(root);
  assert.strictEqual(r.tree.size, 2 * MB);
  assert.strictEqual(r.stats.files, 1);
});

test('a missing or unreadable folder is counted, not thrown', async () => {
  const r = await analyze(path.join(os.tmpdir(), 'bytemop-does-not-exist-' + Date.now()));
  assert.strictEqual(r.stats.inaccessible, 1);
  assert.strictEqual(r.tree.size, 0);
});

test('cancelling stops the walk early', async () => {
  const spec = {};
  for (let i = 0; i < 50; i++) spec[`d${i}/f.bin`] = 10;
  const control = { cancelled: true };
  const r = await analyze(tree(spec), { control });
  assert.strictEqual(r.cancelled, true);
  assert.strictEqual(r.stats.files, 0);
});

test('progress is reported while walking', async () => {
  const spec = {};
  for (let i = 0; i < 5; i++) spec[`d${i}/f.bin`] = 10;
  const seen = [];
  await analyze(tree(spec), { onProgress: (p) => seen.push(p) });
  assert.ok(seen.length >= 1 && typeof seen[0].current === 'string');
});

test('only files above the minimum size become duplicate candidates', async () => {
  const r = await analyze(tree({ 'a.bin': 2 * MB, 'b.bin': 100 }));
  assert.deepStrictEqual(r.candidates.map((f) => f.name), ['a.bin']);
});

test('duplicates need identical content, not just identical size', async () => {
  const same = Buffer.alloc(2 * MB, 1);
  const almost = Buffer.alloc(2 * MB, 1); almost[2 * MB - 1] = 9; // differs only at the very end
  const root = tree({ 'one/a.bin': same, 'two/a-copy.bin': same, 'three/b.bin': almost, 'four/c.bin': Buffer.alloc(3 * MB, 5), 'five/c2.bin': Buffer.alloc(3 * MB, 5), 'six/c3.bin': Buffer.alloc(3 * MB, 5) });
  const { candidates } = await analyze(root);
  const { groups } = await findDuplicates(candidates);
  assert.strictEqual(groups.length, 2);
  assert.deepStrictEqual(groups.map((g) => g.files.length), [3, 2], 'sorted by wasted space: 3 copies x 3MB first');
  const names = groups[1].files.map((f) => f.name).sort();
  assert.deepStrictEqual(names, ['a-copy.bin', 'a.bin']);
});

test('duplicate search can be cancelled', async () => {
  const buf = Buffer.alloc(2 * MB, 1);
  const { candidates } = await analyze(tree({ 'a.bin': buf, 'b.bin': buf }));
  const r = await findDuplicates(candidates, { control: { cancelled: true } });
  assert.strictEqual(r.cancelled, true);
  assert.deepStrictEqual(r.groups, []);
});

test('the limiter never runs more than n tasks at once', async () => {
  const limit = makeLimiter(3);
  let active = 0; let peak = 0;
  await Promise.all(Array.from({ length: 12 }, () => limit(async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; })));
  assert.strictEqual(peak, 3);
});
