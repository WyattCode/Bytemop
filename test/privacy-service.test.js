'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createService } = require('../clean-service');
const { createPrivacyService } = require('../privacy-service');

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-privsvc-'));
  const local = path.join(base, 'Local');
  const profile = path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default');
  fs.mkdirSync(path.join(profile, 'Network'), { recursive: true });
  const cookies = path.join(profile, 'Network', 'Cookies');
  const db = new DatabaseSync(cookies);
  db.exec("CREATE TABLE cookies(host_key TEXT, name TEXT); INSERT INTO cookies VALUES('.a.com','x'),('.b.com','y'),('.b.com','z')");
  db.close();
  const env = { LOCALAPPDATA: local };
  const dataDir = path.join(base, 'data');
  const svc = createService({ dataDir, rules: [], cleanerOpts: { env } });
  const priv = createPrivacyService({ dataDir, service: svc, env, running: new Set(), tmpDir: base });
  const rows = () => { const d = new DatabaseSync(cookies, { readOnly: true }); try { return d.prepare('SELECT COUNT(*) c FROM cookies').get().c; } finally { d.close(); } };
  return { base, dataDir, svc, priv, rows, cookies };
}

test('keep list: add normalises, dedupes, persists and removes', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.priv.addSite('https://www.B.com/x'), { ok: true, site: 'b.com', duplicate: false });
  assert.deepStrictEqual(await s.priv.addSite('b.com'), { ok: true, site: 'b.com', duplicate: true });
  assert.deepStrictEqual(await s.priv.addSite('not a site'), { ok: false, error: 'invalid-site' });
  assert.deepStrictEqual(await s.priv.keepSites(), ['b.com']);
  assert.strictEqual(await s.priv.removeSite('B.com'), true);
  assert.strictEqual(await s.priv.removeSite('b.com'), false);
  assert.deepStrictEqual(await s.priv.keepSites(), []);
});

test('a keep list file with a byte-order mark or junk entries is still read safely', async () => {
  const s = setup();
  fs.mkdirSync(s.dataDir, { recursive: true });
  fs.writeFileSync(path.join(s.dataDir, 'privacy.json'), '﻿' + JSON.stringify({ keepSites: ['B.com', 'bad entry', 7, 'b.com'] }));
  assert.deepStrictEqual(await s.priv.keepSites(), ['b.com']);
});

test('a damaged keep list stops cleaning instead of meaning "keep nothing"', async () => {
  const s = setup();
  await s.priv.addSite('b.com');
  fs.writeFileSync(path.join(s.dataDir, 'privacy.json'), '{not json');
  await assert.rejects(() => s.priv.keepSites(), /keep-list-unreadable/);
  await assert.rejects(() => s.priv.addSite('c.com'), /keep-list-unreadable/, 'never overwrites a file it cannot read');
  const out = await s.priv.clean([{ browser: 'edge', kind: 'cookies' }]);
  assert.strictEqual(out.error, 'keep-list-unreadable');
  assert.strictEqual(s.rows(), 3, 'no cookies were touched');
  assert.strictEqual(fs.readFileSync(path.join(s.dataDir, 'privacy.json'), 'utf8'), '{not json');
});

test('concurrent keep-list edits are all kept', async () => {
  const s = setup();
  await Promise.all(['a.com', 'b.com', 'c.com', 'd.com', 'e.com'].map((x) => s.priv.addSite(x)));
  assert.deepStrictEqual(await s.priv.keepSites(), ['a.com', 'b.com', 'c.com', 'd.com', 'e.com']);
});

test('scan and clean use the saved keep list, and cleaning is written to history', async () => {
  const s = setup();
  await s.priv.addSite('b.com');
  const scan = await s.priv.scan();
  assert.deepStrictEqual(scan.keepSites, ['b.com']);
  assert.strictEqual(scan.browsers[0].kinds.cookies.count, 1);
  assert.strictEqual(scan.browsers[0].kinds.cookies.keep, 2);
  const out = await s.priv.clean([{ browser: 'edge', kind: 'cookies' }]);
  assert.strictEqual(out.totals.deleted, 1);
  assert.strictEqual(s.rows(), 2);
  const ev = (await s.svc.history())[0];
  assert.strictEqual(ev.type, 'privacy');
  assert.strictEqual(ev.deleted, 1);
  assert.deepStrictEqual(ev.items, [{ id: 'edge:cookies', deleted: 1 }]);
});

test('an exclusion on the cookie file added later stops privacy cleaning', async () => {
  const s = setup();
  await s.svc.addExclusion({ type: 'path', value: s.cookies });
  const out = await s.priv.clean([{ browser: 'edge', kind: 'cookies' }]);
  assert.strictEqual(out.results[0].reason, 'excluded');
  assert.strictEqual(s.rows(), 3);
});
