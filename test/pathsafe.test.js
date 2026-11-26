'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isPlainDir, canonical } = require('../pathsafe');

test('a normal folder, and one that does not exist yet under a normal folder, are plain', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-ps-'));
  assert.strictEqual(await isPlainDir(base), true);
  assert.strictEqual(await isPlainDir(path.join(base, 'not', 'yet')), true);
  assert.strictEqual(await isPlainDir(base.toUpperCase()), true, 'case does not matter');
});

test('a folder reached through a junction is not plain, even when the target folder does not exist yet', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-ps-'));
  const real = path.join(base, 'real');
  fs.mkdirSync(real);
  try { fs.symlinkSync(real, path.join(base, 'link'), 'junction'); } catch { t.skip('cannot create junctions here'); return; }
  assert.strictEqual(await isPlainDir(path.join(base, 'link')), false);
  assert.strictEqual(await isPlainDir(path.join(base, 'link', 'sub')), false);
  assert.strictEqual(await isPlainDir(real), true);
});

test('canonical returns the real path, and the input when it does not exist', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-ps-'));
  assert.strictEqual((await canonical(base)).toLowerCase(), fs.realpathSync.native(base).toLowerCase());
  assert.strictEqual(await canonical(path.join(base, 'nope')), path.join(base, 'nope'));
});
