'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { sensitiveChanges, confirmOptions, withoutRisky } = require('../settings-guard');
const { sanitizeSettings, DEFAULT_SETTINGS } = require('../clean-service');

const cur = { ...DEFAULT_SETTINGS, retentionDays: 14 };
const next = (patch) => sanitizeSettings(patch, cur);

test('only changes that weaken protection need confirmation', () => {
  assert.deepStrictEqual(sensitiveChanges(cur, next({ deleteMode: 'permanent' })), ['permanent']);
  assert.deepStrictEqual(sensitiveChanges(cur, next({ retentionDays: 3 })), ['retention']);
  assert.deepStrictEqual(sensitiveChanges(cur, next({ deleteMode: 'permanent', retentionDays: 3 })), ['permanent', 'retention']);
  // safer or unrelated changes, and invalid values (which are ignored), pass without a prompt
  assert.deepStrictEqual(sensitiveChanges(cur, next({ retentionDays: 30 })), []);
  assert.deepStrictEqual(sensitiveChanges(cur, next({ retentionDays: 0 })), []);
  assert.deepStrictEqual(sensitiveChanges(cur, next({ language: 'en', theme: 'dark', quarantineLimitGB: 1 })), []);
  const perm = { ...cur, deleteMode: 'permanent' };
  assert.deepStrictEqual(sensitiveChanges(perm, sanitizeSettings({ deleteMode: 'permanent' }, perm)), [], 'already permanent: nothing new');
  assert.deepStrictEqual(sensitiveChanges(perm, sanitizeSettings({ deleteMode: 'quarantine' }, perm)), []);
});

test('declining keeps the risky fields and still applies the rest', () => {
  const patch = { deleteMode: 'permanent', retentionDays: 3, language: 'en' };
  const risky = sensitiveChanges(cur, next(patch));
  assert.deepStrictEqual(withoutRisky(patch, cur, risky), { deleteMode: cur.deleteMode, retentionDays: 14, language: 'en' });
  assert.deepStrictEqual(withoutRisky({ language: 'en' }, cur, []), { language: 'en' });
});

test('the dialog defaults to the safe button and describes each risk in the user language', () => {
  const zh = confirmOptions('zh-CN', ['permanent', 'retention']);
  assert.strictEqual(zh.defaultId, 0);
  assert.strictEqual(zh.cancelId, 0);
  assert.strictEqual(zh.buttons[0], '取消');
  assert.match(zh.detail, /永久删除/);
  assert.match(zh.detail, /保留天数/);
  const en = confirmOptions('fr', ['permanent']); // unknown language falls back to English
  assert.strictEqual(en.buttons[0], 'Cancel');
  assert.match(en.detail, /permanent delete/);
});
