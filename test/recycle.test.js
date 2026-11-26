'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createCanTrash, windowsFixedDrives } = require('../recycle');

const GB = 1024 ** 3;
const statfs = async () => ({ blocks: 100, bsize: GB }); // a 100 GB drive
const fixed = async () => new Set(['C', 'D']);

test('fixed drives accept files well below the Recycle Bin limit', async () => {
  const can = createCanTrash({ fixedDrives: fixed, statfs });
  assert.deepStrictEqual(await can('C:\\Users\\me\\a.iso', 2 * GB), { ok: true });
  assert.deepStrictEqual(await can('d:\\x.bin', 1), { ok: true });
});

test('files too large for the bin are refused, because Windows would delete them permanently', async () => {
  const can = createCanTrash({ fixedDrives: fixed, statfs });
  assert.deepStrictEqual(await can('C:\\big.vhdx', 20 * GB), { ok: false, reason: 'too-big' });
});

test('removable, network and unknown drives are refused', async () => {
  const can = createCanTrash({ fixedDrives: fixed, statfs });
  assert.strictEqual((await can('E:\\usb.bin', 1)).reason, 'no-recycle-bin');
  assert.strictEqual((await can('\\\\server\\share\\a.bin', 1)).reason, 'no-recycle-bin');
});

test('if the drive list cannot be read the answer is no, and it is retried next time', async () => {
  let calls = 0;
  const can = createCanTrash({ fixedDrives: async () => { calls++; if (calls === 1) throw new Error('boom'); return new Set(['C']); }, statfs });
  assert.strictEqual((await can('C:\\a.bin', 1)).ok, false);
  assert.strictEqual((await can('C:\\a.bin', 1)).ok, true);
});

test('windowsFixedDrives turns PowerShell output into drive letters', async () => {
  const set = await windowsFixedDrives(async () => 'C\r\nd\r\n');
  assert.deepStrictEqual([...set].sort(), ['C', 'D']);
});
