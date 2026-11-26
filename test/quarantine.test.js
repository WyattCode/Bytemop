'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Quarantine, DAY_MS } = require('../quarantine');

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-q-'));
  const src = path.join(base, 'src');
  fs.mkdirSync(src);
  const file = (name, content = 'x') => { const p = path.join(src, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); return p; };
  return { base, src, file, q: new Quarantine(path.join(base, 'q')) };
}
const read = (p) => fs.readFileSync(p, 'utf8');

test('move + commit records count and bytes, original is gone', async () => {
  const s = setup();
  const a = s.file('a.txt', 'aaaa');
  const b = s.file('sub/b.txt', 'bb');
  const run = await s.q.begin({ rules: ['r1'] });
  assert.strictEqual(await s.q.moveFile(run, a, 4, 'r1', 0), true);
  assert.strictEqual(await s.q.moveFile(run, b, 2, 'r1', 0), true);
  const meta = await s.q.commit(run);
  assert.strictEqual(meta.status, 'committed');
  assert.strictEqual(meta.count, 2);
  assert.strictEqual(meta.bytes, 6);
  assert.ok(!fs.existsSync(a) && !fs.existsSync(b));
  assert.strictEqual((await s.q.list()).length, 1);
});

test('a move that fails is not recorded as quarantined', async () => {
  const s = setup();
  const run = await s.q.begin();
  assert.strictEqual(await s.q.moveFile(run, path.join(s.src, 'missing.txt'), 5, 'r', 0), false);
  const meta = await s.q.commit(run);
  assert.ok(meta.removed, 'an empty run is removed');
  assert.strictEqual((await s.q.list()).length, 0);
});

test('restore puts files back, recreating deleted folders, and removes the empty run', async () => {
  const s = setup();
  const b = s.file('sub/deep/b.txt', 'bb');
  const run = await s.q.begin();
  await s.q.moveFile(run, b, 2, 'r', 0);
  await s.q.commit(run);
  fs.rmSync(path.join(s.src, 'sub'), { recursive: true });
  const res = await s.q.restore(run.id);
  assert.deepStrictEqual(res, { restored: 1, renamed: 0, failed: 0 });
  assert.strictEqual(read(b), 'bb');
  assert.strictEqual((await s.q.list()).length, 0);
});

test('restore never overwrites: a taken path gets a (restored) name', async () => {
  const s = setup();
  const a = s.file('a.txt', 'old');
  const run = await s.q.begin();
  await s.q.moveFile(run, a, 3, 'r', 0);
  await s.q.commit(run);
  fs.writeFileSync(a, 'NEW'); // app recreated it meanwhile
  const res = await s.q.restore(run.id);
  assert.strictEqual(res.restored, 1);
  assert.strictEqual(res.renamed, 1);
  assert.strictEqual(read(a), 'NEW');
  assert.strictEqual(read(path.join(s.src, 'a (restored).txt')), 'old');
});

test('partial restore by seq keeps the rest quarantined', async () => {
  const s = setup();
  const a = s.file('a.txt', 'a');
  const b = s.file('b.txt', 'b');
  const run = await s.q.begin();
  await s.q.moveFile(run, a, 1, 'r', 0);
  await s.q.moveFile(run, b, 1, 'r', 0);
  await s.q.commit(run);
  await s.q.restore(run.id, { seqs: [2] });
  assert.ok(fs.existsSync(b) && !fs.existsSync(a));
  const [meta] = await s.q.list();
  assert.strictEqual(meta.count, 1);
});

test('crash recovery: interrupted run stays restorable; unmoved intents are ignored', async () => {
  const s = setup();
  const a = s.file('a.txt', 'aa');
  const ghost = s.file('ghost.txt', 'gg');
  const run = await s.q.begin();
  await s.q.moveFile(run, a, 2, 'r', 0);
  // Simulate a crash after the intent line was written but before the move happened.
  fs.appendFileSync(path.join(s.q.runDir(run.id), 'journal.jsonl'), JSON.stringify({ seq: 99, orig: ghost, size: 2, rule: 'r' }) + '\n');
  // ...and a torn final line.
  fs.appendFileSync(path.join(s.q.runDir(run.id), 'journal.jsonl'), '{"seq":100,"or');
  // no commit(): process "died". A fresh instance recovers.
  const q2 = new Quarantine(s.q.dir);
  const recovered = await q2.recover();
  assert.strictEqual(recovered.length, 1);
  assert.strictEqual(recovered[0].status, 'interrupted');
  assert.strictEqual(recovered[0].count, 1);
  assert.ok(fs.existsSync(ghost), 'file that was never moved is untouched');
  await q2.restore(run.id);
  assert.strictEqual(read(a), 'aa');
});

test('recover removes a run dir that has no meta and nothing in it', async () => {
  const s = setup();
  fs.mkdirSync(path.join(s.q.dir, 'orphan', 'files'), { recursive: true });
  await s.q.recover();
  assert.ok(!fs.existsSync(path.join(s.q.dir, 'orphan')));
});

test('purge, purgeAll and purgeExpired release space', async () => {
  const s = setup();
  const mkRun = async (name, content, when) => {
    const f = s.file(name, content);
    const run = await s.q.begin({}, when);
    await s.q.moveFile(run, f, content.length, 'r', 0);
    return (await s.q.commit(run)).id;
  };
  const now = Date.now();
  const oldId = await mkRun('old.txt', 'oooo', now - 10 * DAY_MS);
  const newId = await mkRun('new.txt', 'nn', now - 1 * DAY_MS);
  assert.strictEqual(await s.q.totalBytes(), 6);
  const expired = await s.q.purgeExpired(7, now);
  assert.deepStrictEqual(expired, [{ id: oldId, bytes: 4 }]);
  assert.deepStrictEqual((await s.q.list()).map((r) => r.id), [newId]);
  assert.strictEqual(await s.q.purgeAll(), 2);
  assert.strictEqual((await s.q.list()).length, 0);
});

test('recover skips runs that were active recently when a minimum age is given', async () => {
  const s = setup();
  const a = s.file('a.txt', 'aaaa');
  const run = await s.q.begin({ rules: ['r'] }, Date.now());
  await s.q.moveFile(run, a, 4, 'r', 0); // never committed: looks like a crash, but it is brand new
  assert.deepStrictEqual(await s.q.recover(10 * 60 * 1000), []);
  assert.strictEqual((await s.q.list())[0].status, 'in-progress');
  const later = Date.now() + 11 * 60 * 1000;
  const recovered = await s.q.recover(10 * 60 * 1000, later);
  assert.strictEqual(recovered.length, 1);
  assert.strictEqual((await s.q.list())[0].status, 'interrupted');
});

test('a run id that is not a plain id (path traversal) is never a run: purge and restore do nothing outside the quarantine', async () => {
  const s = setup();
  const victim = path.join(s.base, 'Documents');
  fs.mkdirSync(victim);
  fs.writeFileSync(path.join(victim, 'precious.txt'), 'keep');
  assert.strictEqual(await s.q.purge('..'), 0);
  assert.strictEqual(await s.q.purge('..\\Documents'), 0);
  assert.strictEqual(await s.q.purge(''), 0);
  assert.strictEqual(await s.q.purge(null), 0);
  assert.deepStrictEqual(await s.q.restore('..\\Documents'), { restored: 0, renamed: 0, failed: 0 });
  assert.strictEqual(fs.readFileSync(path.join(victim, 'precious.txt'), 'utf8'), 'keep');
  assert.ok(fs.existsSync(s.base));
});

test('journal lines with a hostile seq or relative path are ignored', async () => {
  const s = setup();
  const a = s.file('a.txt', 'aaaa');
  const run = await s.q.begin({ rules: ['r'] });
  await s.q.moveFile(run, a, 4, 'r', 0);
  const outside = path.join(s.base, 'outside.bin');
  fs.writeFileSync(outside, 'secret');
  const journal = path.join(s.q.runDir(run.id), 'journal.jsonl');
  fs.appendFileSync(journal, JSON.stringify({ seq: '..\\..\\outside.bin', orig: path.join(s.src, 'planted.txt') }) + '\n');
  fs.appendFileSync(journal, JSON.stringify({ seq: 1.5, orig: path.join(s.src, 'x') }) + '\n');
  fs.appendFileSync(journal, JSON.stringify({ seq: 1, orig: 'relative\\path.txt' }) + '\n');
  await s.q.commit(run);
  const r = await s.q.restore(run.id);
  assert.strictEqual(r.restored, 1);
  assert.ok(fs.existsSync(outside), 'the outside file was not moved');
  assert.ok(!fs.existsSync(path.join(s.src, 'planted.txt')));
});

test('an elevated-style restore refuses a destination reached through a junction', async (t) => {
  const s = setup();
  const target = path.join(s.base, 'allowed');
  const outside = path.join(s.base, 'outside');
  fs.mkdirSync(target); fs.mkdirSync(outside);
  const f = path.join(target, 'f.txt');
  fs.writeFileSync(f, 'data');
  const run = await s.q.begin({ rules: ['r'] });
  await s.q.moveFile(run, f, 4, 'r', 0);
  await s.q.commit(run);
  fs.rmSync(target, { recursive: true });
  try { fs.symlinkSync(outside, target, 'junction'); } catch { t.skip('cannot create junctions here'); return; }
  const r = await s.q.restore(run.id, { allow: () => true });
  assert.strictEqual(r.restored, 0);
  assert.strictEqual(r.failed, 1);
  assert.deepStrictEqual(fs.readdirSync(outside), []);
});
