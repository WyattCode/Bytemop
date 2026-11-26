'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateRule, validatePack, loadPacks } = require('../rule-engine');

function good(over = {}) {
  return {
    id: 'chrome.cache',
    name: { 'zh-CN': 'Chrome 缓存', en: 'Chrome cache' },
    description: { 'zh-CN': '网页缓存', en: 'Web cache' },
    category: 'browser', risk: 'safe', defaultSelected: true, requiresAdmin: false,
    blockedByProcesses: ['chrome.exe'], minAgeHours: 0, action: 'files',
    targets: [{ path: '%LOCALAPPDATA%\\Google\\Chrome\\User Data\\*\\Cache', recurse: true }],
    since: '1.0.0', ...over,
  };
}
const has = (problems, text) => problems.some((p) => p.includes(text));

test('a well-formed rule is valid', () => {
  assert.deepStrictEqual(validateRule(good()), []);
});

test('id, locale text and enums are enforced', () => {
  assert.ok(has(validateRule(good({ id: 'Chrome Cache' })), 'id must'));
  assert.ok(has(validateRule(good({ name: { en: 'x' } })), 'name.zh-CN'));
  assert.ok(has(validateRule(good({ description: { 'zh-CN': '', en: 'x' } })), 'description.zh-CN'));
  assert.ok(has(validateRule(good({ description: undefined })), 'description must be an object'));
  assert.ok(has(validateRule(good({ category: 'misc' })), 'category'));
  assert.ok(has(validateRule(good({ risk: 'low' })), 'risk'));
  assert.ok(has(validateRule(good({ action: 'shred' })), 'action'));
  assert.ok(has(validateRule(good({ since: 'v1' })), 'since'));
});

test('default selection is limited to safe, non-admin rules', () => {
  assert.ok(has(validateRule(good({ risk: 'caution' })), 'selected by default'));
  assert.ok(has(validateRule(good({ requiresAdmin: true })), 'selected by default'));
  assert.deepStrictEqual(validateRule(good({ risk: 'caution', defaultSelected: false })), []);
});

test('target paths are confined to allowed roots', () => {
  const bad = (p) => validateRule(good({ targets: [{ path: p }] }));
  assert.ok(has(bad('C:\\Windows\\System32'), 'must be inside'));
  assert.ok(has(bad('C:\\'), 'must be inside'));
  assert.ok(has(bad('\\\\server\\share\\x'), 'network'));
  assert.ok(has(bad('%LOCALAPPDATA%\\..\\..\\Windows'), '".."'));
  assert.ok(has(bad('%LOCALAPPDATA%'), 'must be inside'), 'bare LOCALAPPDATA is too broad');
  assert.ok(has(bad('%LOCALAPPDATA%\\*\\Cache'), 'concrete folder'));
  assert.ok(has(bad('%USERPROFILE%\\Documents'), 'must be inside'));
  assert.deepStrictEqual(bad('%TEMP%'), [], 'temp folder itself is allowed');
  assert.deepStrictEqual(bad('%SystemRoot%\\Temp'), []);
  assert.deepStrictEqual(bad('%temp%\\sub'), [], 'roots are case-insensitive');
  assert.ok(has(validateRule(good({ targets: [] })), 'non-empty'));
});

test('blockedByProcesses and minAgeHours are checked', () => {
  assert.ok(has(validateRule(good({ blockedByProcesses: ['chrome'] })), '.exe'));
  assert.ok(has(validateRule(good({ minAgeHours: -1 })), 'minAgeHours'));
});

test('validatePack rejects bad rules individually and annotates good ones', () => {
  const v = validatePack({ pack: 'p', version: '1.2.3', rules: [good(), good({ id: 'BAD' })] });
  assert.strictEqual(v.rules.length, 1);
  assert.strictEqual(v.rules[0].pack, 'p');
  assert.strictEqual(v.rules[0].packVersion, '1.2.3');
  assert.strictEqual(v.errors.length, 1);
  assert.ok(validatePack({ rules: [] }).errors[0].problems.length >= 2);
});

test('loadPacks handles bad JSON, duplicates and a BOM', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-packs-'));
  fs.writeFileSync(path.join(dir, 'a.json'), '\uFEFF' + JSON.stringify({ pack: 'a', version: '1.0.0', rules: [good()] }));
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ pack: 'b', version: '1.0.0', rules: [good(), good({ id: 'other.rule' })] }));
  fs.writeFileSync(path.join(dir, 'c.json'), '{ not json');
  const r = loadPacks(dir);
  assert.deepStrictEqual(r.rules.map((x) => x.id).sort(), ['chrome.cache', 'other.rule']);
  assert.ok(r.errors.some((e) => e.ruleId === 'chrome.cache' && e.problems[0] === 'duplicate rule id'));
  assert.ok(r.errors.some((e) => e.pack === 'c.json' && e.problems[0].startsWith('invalid JSON')));
  assert.ok(loadPacks(path.join(dir, 'missing')).errors.length === 1);
});

test('the shipped rule packs all validate with no errors', () => {
  const r = loadPacks(path.join(__dirname, '..', 'rules'));
  assert.deepStrictEqual(r.errors, []);
  assert.ok(r.rules.length >= 9);
});
