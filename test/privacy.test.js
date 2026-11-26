'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { createPrivacy, normalizeSite, isKept, siteOf, HISTORY_FILES } = require('../privacy');

// A fake "Edge" user-data folder with real SQLite files shaped like the browser's.
function setup({ running = new Set(), isExcluded } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-priv-test-'));
  const local = path.join(base, 'Local');
  const profile = path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default');
  fs.mkdirSync(path.join(profile, 'Network'), { recursive: true });
  const tmpDir = path.join(base, 'tmp');
  fs.mkdirSync(tmpDir);
  const p = createPrivacy({ env: { LOCALAPPDATA: local }, tmpDir, running, isExcluded });
  return { base, profile, tmpDir, p, history: path.join(profile, 'History'), cookies: path.join(profile, 'Network', 'Cookies') };
}

function makeHistory(file, { urls = 3, downloads = 2 } = {}) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT, title TEXT);
    CREATE TABLE visits(id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER);
    CREATE TABLE visit_source(id INTEGER PRIMARY KEY, source INTEGER);
    CREATE TABLE keyword_search_terms(term TEXT, url_id INTEGER);
    CREATE TABLE segments(id INTEGER PRIMARY KEY, url_id INTEGER);
    CREATE TABLE segment_usage(id INTEGER PRIMARY KEY, segment_id INTEGER);
    CREATE TABLE content_annotations(visit_id INTEGER);
    CREATE TABLE edge_visits(id INTEGER PRIMARY KEY);
    CREATE TABLE downloads(id INTEGER PRIMARY KEY, target_path TEXT);
    CREATE TABLE downloads_url_chains(id INTEGER, url TEXT);
    CREATE TABLE meta(key TEXT, value TEXT);
    INSERT INTO meta VALUES('version','60');`);
  for (let i = 1; i <= urls; i++) {
    db.exec(`INSERT INTO urls VALUES(${i},'https://site${i}.example/','t${i}');INSERT INTO visits VALUES(${i},${i},1);INSERT INTO keyword_search_terms VALUES('secret${i}',${i});INSERT INTO edge_visits VALUES(${i});`);
  }
  for (let i = 1; i <= downloads; i++) db.exec(`INSERT INTO downloads VALUES(${i},'C:\\\\f${i}');INSERT INTO downloads_url_chains VALUES(${i},'https://d${i}.example/x');`);
  db.close();
}

function makeCookies(file, hosts) {
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE cookies(host_key TEXT, name TEXT, value BLOB); CREATE TABLE meta(key TEXT, value TEXT); INSERT INTO meta VALUES(\'version\',\'20\');');
  for (const [h, n] of hosts) for (let i = 0; i < n; i++) db.exec(`INSERT INTO cookies VALUES('${h}','c${i}',x'00')`);
  db.close();
}

const count = (file, table, where = '') => { const db = new DatabaseSync(file, { readOnly: true }); try { return db.prepare(`SELECT COUNT(*) c FROM ${table} ${where}`).get().c; } finally { db.close(); } };

test('site names are normalised to a bare host; junk is rejected', () => {
  assert.strictEqual(normalizeSite('https://www.GitHub.com/user?x=1'), 'github.com');
  assert.strictEqual(normalizeSite('*.example.co.uk'), 'example.co.uk');
  assert.strictEqual(normalizeSite('.example.com'), 'example.com');
  assert.strictEqual(normalizeSite('mail.example.com:8080/inbox'), 'mail.example.com');
  assert.strictEqual(normalizeSite('localhost'), 'localhost');
  assert.strictEqual(normalizeSite('例子.中国'), 'xn--fsqu00a.xn--fiqs8s');
  for (const bad of ['', '   ', 'a b.com', 'exa_mple.com', '-bad.com', 'http://', 42, null, 'a..b']) assert.strictEqual(normalizeSite(bad), null, String(bad));
});

test('a kept site covers itself and its subdomains, but not look-alike names', () => {
  const keep = ['example.com'];
  assert.ok(isKept('.example.com', keep));
  assert.ok(isKept('example.com', keep));
  assert.ok(isKept('www.example.com', keep));
  assert.ok(isKept('.a.b.example.com', keep));
  assert.ok(!isKept('notexample.com', keep));
  assert.ok(!isKept('example.com.evil.net', keep));
  assert.ok(!isKept('.other.com', keep));
});

test('siteOf groups hosts into sites, including two-part suffixes', () => {
  assert.strictEqual(siteOf('.mail.google.com'), 'google.com');
  assert.strictEqual(siteOf('www.bbc.co.uk'), 'bbc.co.uk');
  assert.strictEqual(siteOf('shop.taobao.com.cn'), 'taobao.com.cn');
  assert.strictEqual(siteOf('localhost'), 'localhost');
  assert.strictEqual(siteOf('192.168.1.5'), '192.168.1.5');
});

test('scan counts rows from a copy, applies the keep list, and leaves the files untouched', async () => {
  const s = setup();
  makeHistory(s.history, { urls: 3, downloads: 2 });
  makeCookies(s.cookies, [['.google.com', 4], ['.github.com', 3], ['www.github.com', 1], ['.ads.net', 5]]);
  const before = { h: fs.readFileSync(s.history), c: fs.readFileSync(s.cookies) };
  const [edge] = await s.p.scan({ keepSites: ['github.com'] });
  assert.strictEqual(edge.id, 'edge');
  assert.strictEqual(edge.kinds.history.count, 3);
  assert.strictEqual(edge.kinds.downloads.count, 2);
  assert.strictEqual(edge.kinds.cookies.count, 9, 'google + ads');
  assert.strictEqual(edge.kinds.cookies.keep, 4, 'github host and www.github');
  assert.deepStrictEqual(fs.readdirSync(s.tmpDir), [], 'temporary copies are removed');
  assert.ok(before.h.equals(fs.readFileSync(s.history)) && before.c.equals(fs.readFileSync(s.cookies)), 'originals not modified');
});

test('browsers that are not installed are not listed', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-priv-test-'));
  const p = createPrivacy({ env: { LOCALAPPDATA: base }, running: new Set() });
  assert.deepStrictEqual(await p.scan(), []);
});

test('cleaning history removes pages, visits, searches and related tables, and keeps the database valid', async () => {
  const s = setup();
  makeHistory(s.history, { urls: 3, downloads: 2 });
  fs.writeFileSync(path.join(s.profile, 'Visited Links'), 'x');
  fs.writeFileSync(path.join(s.profile, 'Top Sites'), 'x');
  fs.writeFileSync(path.join(s.profile, 'Bookmarks'), 'keep me');
  fs.writeFileSync(path.join(s.profile, 'Login Data'), 'keep me');
  const out = await s.p.clean([{ browser: 'edge', kind: 'history' }]);
  assert.strictEqual(out.results[0].deleted, 3);
  for (const t of ['urls', 'visits', 'keyword_search_terms', 'segments', 'content_annotations', 'edge_visits', 'visit_source']) assert.strictEqual(count(s.history, t), 0, t);
  assert.strictEqual(count(s.history, 'downloads'), 2, 'download history is a separate choice');
  assert.strictEqual(count(s.history, 'meta'), 1, 'schema bookkeeping is kept');
  assert.ok(!fs.existsSync(path.join(s.profile, 'Visited Links')) && !fs.existsSync(path.join(s.profile, 'Top Sites')));
  assert.strictEqual(fs.readFileSync(path.join(s.profile, 'Bookmarks'), 'utf8'), 'keep me');
  assert.strictEqual(fs.readFileSync(path.join(s.profile, 'Login Data'), 'utf8'), 'keep me');
  assert.ok(HISTORY_FILES.every((f) => !/Login|Bookmarks|Cookies/.test(f)));
});

test('cleaning downloads removes the list only', async () => {
  const s = setup();
  makeHistory(s.history, { urls: 3, downloads: 2 });
  const out = await s.p.clean([{ browser: 'edge', kind: 'downloads' }]);
  assert.strictEqual(out.results[0].deleted, 2);
  assert.strictEqual(count(s.history, 'downloads'), 0);
  assert.strictEqual(count(s.history, 'downloads_url_chains'), 0);
  assert.strictEqual(count(s.history, 'urls'), 3);
});

test('cleaning cookies keeps every cookie of the kept sites and removes the rest', async () => {
  const s = setup();
  makeCookies(s.cookies, [['.google.com', 4], ['.github.com', 3], ['api.github.com', 2], ['.ads.net', 5], ['notgithub.com', 1]]);
  const out = await s.p.clean([{ browser: 'edge', kind: 'cookies' }], { keepSites: ['github.com', 'https://www.google.com/'] });
  assert.strictEqual(out.results[0].deleted, 6);
  assert.strictEqual(out.totals.deleted, 6);
  assert.strictEqual(count(s.cookies, 'cookies'), 9);
  assert.strictEqual(count(s.cookies, 'cookies', "WHERE host_key IN ('.ads.net','notgithub.com')"), 0);
  assert.strictEqual(count(s.cookies, 'cookies', "WHERE host_key LIKE '%github.com' AND host_key != 'notgithub.com'"), 5);
});

test('with an empty keep list all cookies go; an invalid keep entry is ignored, never widening what is deleted', async () => {
  const s = setup();
  makeCookies(s.cookies, [['.a.com', 2], ['.b.com', 2]]);
  await s.p.clean([{ browser: 'edge', kind: 'cookies' }], { keepSites: ['not a site', 42] });
  assert.strictEqual(count(s.cookies, 'cookies'), 0);
});

test('a running browser is skipped as a whole and nothing changes', async () => {
  const s = setup({ running: new Set(['msedge.exe']) });
  makeHistory(s.history);
  makeCookies(s.cookies, [['.a.com', 2]]);
  const out = await s.p.clean([{ browser: 'edge', kind: 'history' }, { browser: 'edge', kind: 'cookies' }]);
  assert.ok(out.results.every((r) => r.skipped && r.reason === 'running'));
  assert.strictEqual(count(s.history, 'urls'), 3);
  assert.strictEqual(count(s.cookies, 'cookies'), 2);
  const [edge] = await s.p.scan();
  assert.deepStrictEqual(edge.running, ['msedge.exe']);
});

test('a database locked by another process is reported and left unchanged', async () => {
  const s = setup();
  makeCookies(s.cookies, [['.a.com', 2]]);
  const holder = new DatabaseSync(s.cookies);
  holder.exec('BEGIN EXCLUSIVE');
  try {
    const out = await s.p.clean([{ browser: 'edge', kind: 'cookies' }]);
    assert.strictEqual(out.results[0].failed, 1);
    assert.strictEqual(out.results[0].reason, 'locked');
    assert.strictEqual(out.results[0].deleted, 0);
  } finally { holder.exec('ROLLBACK'); holder.close(); }
  assert.strictEqual(count(s.cookies, 'cookies'), 2);
});

test('a database with an unknown layout is not touched', async () => {
  const s = setup();
  const db = new DatabaseSync(s.cookies);
  db.exec('CREATE TABLE cookies(something TEXT); INSERT INTO cookies VALUES(\'x\');');
  db.close();
  const out = await s.p.clean([{ browser: 'edge', kind: 'cookies' }]);
  assert.strictEqual(out.results[0].reason, 'unsupported');
  assert.strictEqual(count(s.cookies, 'cookies'), 1);
  const [edge] = await s.p.scan();
  assert.strictEqual(edge.kinds.cookies.unsupported, true);
});

test('user exclusions protect browser files from privacy cleaning too', async () => {
  const s = setup({ isExcluded: (f) => f.endsWith('Network\\Cookies') });
  makeCookies(s.cookies, [['.a.com', 2]]);
  const out = await s.p.clean([{ browser: 'edge', kind: 'cookies' }]);
  assert.strictEqual(out.results[0].skipped, true);
  assert.strictEqual(out.results[0].reason, 'excluded');
  assert.strictEqual(count(s.cookies, 'cookies'), 2);
});

test('unknown browsers and kinds in a request are ignored', async () => {
  const s = setup();
  makeCookies(s.cookies, [['.a.com', 2]]);
  const out = await s.p.clean([{ browser: '../evil', kind: 'cookies' }, { browser: 'edge', kind: 'passwords' }, null, 'x']);
  assert.deepStrictEqual(out.results, []);
  assert.strictEqual(count(s.cookies, 'cookies'), 2);
});

test('cookieSites lists sites by cookie count so the user can pick which to keep', async () => {
  const s = setup();
  makeCookies(s.cookies, [['.google.com', 4], ['mail.google.com', 2], ['.github.com', 3], ['.bbc.co.uk', 1]]);
  const r = await s.p.cookieSites();
  assert.deepStrictEqual(r.sites, [{ site: 'google.com', count: 6 }, { site: 'github.com', count: 3 }, { site: 'bbc.co.uk', count: 1 }]);
  assert.strictEqual(r.locked, false);
});

test('multiple profiles are all cleaned', async () => {
  const s = setup();
  const second = path.join(path.dirname(s.profile), 'Profile 1');
  fs.mkdirSync(path.join(second, 'Network'), { recursive: true });
  makeCookies(s.cookies, [['.a.com', 2]]);
  makeCookies(path.join(second, 'Network', 'Cookies'), [['.b.com', 3]]);
  const [edge] = await s.p.scan();
  assert.strictEqual(edge.profiles, 2);
  assert.strictEqual(edge.kinds.cookies.count, 5);
  await s.p.clean([{ browser: 'edge', kind: 'cookies' }]);
  assert.strictEqual(count(path.join(second, 'Network', 'Cookies'), 'cookies'), 0);
});
