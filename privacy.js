'use strict';
// Privacy cleaning for Chromium-based browsers (Edge, Chrome, Brave): browsing history,
// download history and cookies, with a "keep these sites signed in" list.
//
// How it works, and why it is built this way:
//  - The browsers keep this data in SQLite files. We delete rows (never whole files of user data),
//    and only while the browser is closed, because a running browser holds the files open.
//  - Scanning never touches the originals: it reads a temporary copy, which is removed right after.
//  - Only these three kinds are ever touched. Passwords, bookmarks, autofill, extensions, open
//    tabs and saved downloads (the files themselves) are never read or changed.
//  - Unlike file cleaning, this cannot be undone (a backup would keep the very data the user wants
//    gone), so the UI says so before it starts.
//  - Firefox is not supported yet.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { expandEnv, runningProcesses, UNKNOWN_PROCESSES } = require('./cleaner');

const BROWSERS = [
  { id: 'edge', name: 'Microsoft Edge', dir: '%LOCALAPPDATA%\\Microsoft\\Edge\\User Data', processes: ['msedge.exe'] },
  { id: 'chrome', name: 'Google Chrome', dir: '%LOCALAPPDATA%\\Google\\Chrome\\User Data', processes: ['chrome.exe'] },
  { id: 'brave', name: 'Brave', dir: '%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\User Data', processes: ['brave.exe'] },
];
const KINDS = ['history', 'downloads', 'cookies'];

// Tables are deleted in this order (dependents first) and only if they exist, so a browser
// version that lacks or adds one of them still works. Sync bookkeeping tables are left alone.
const HISTORY_TABLES = [
  'cluster_keywords', 'cluster_visit_duplicates', 'clusters_and_visits', 'clusters',
  'journey_collection_items', 'journey_collections', 'journey_continuation_queries', 'journey_history_entries', 'journeys',
  'content_annotations', 'context_annotations', 'edge_keyword_search_terms_source', 'edge_visits', 'edge_urls',
  'visit_source', 'segment_usage', 'segments', 'keyword_search_terms', 'visited_links', 'visits', 'urls',
];
const DOWNLOAD_TABLES = ['downloads_slices', 'downloads_url_chains', 'edge_downloads', 'downloads'];
// Small files next to the history database that also reveal visited sites. The browser recreates them.
const HISTORY_FILES = ['Favicons', 'Favicons-journal', 'Visited Links', 'Top Sites', 'Top Sites-journal', 'Shortcuts', 'Shortcuts-journal', 'Network Action Predictor', 'Network Action Predictor-journal'];

const MAX_KEEP_SITES = 500;
const BATCH = 400;

// ---------- the keep list ----------

// "https://www.Example.com/path" -> "example.com". Returns null for anything that is not a host name.
function normalizeSite(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (!s || /\s/.test(s)) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^\*?\./, '').replace(/\.$/, '');
  if (s.startsWith('www.')) s = s.slice(4);
  if (!s || s.length > 253) return null;
  let host;
  try { host = new URL('http://' + s).hostname; } catch { return null; }
  if (!host || host !== host.toLowerCase()) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) return null;
  if (TWO_PART_SUFFIXES.has(host)) return null; // a public suffix ('co.uk', 'github.io') would keep every site under it
  return host;
}

// Cookie host keys look like ".example.com" (all subdomains) or "www.example.com" (one host).
// A site on the keep list covers itself and every subdomain.
// A kept 'mail.google.com' also keeps the '.google.com' cookies it logs in with (the site's parent domain), not only
// its own host and subdomains.
function isKept(hostKey, keep) {
  const host = String(hostKey).replace(/^\./, '').toLowerCase();
  for (const d of keep) if (host === d || host.endsWith('.' + d) || siteOf(d) === host) return true;
  return false;
}

// Hosting platforms where every customer has a subdomain: 'foo.github.io' is a site of its own, 'github.io' is not.
const SHARED_HOSTS = ['github.io', 'gitlab.io', 'herokuapp.com', 'blogspot.com', 'azurewebsites.net', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev',
  'web.app', 'firebaseapp.com', 'cloudfront.net', 'appspot.com', 'onrender.com', 'myshopify.com', 'wordpress.com'];
const TWO_PART_SUFFIXES = new Set([...SHARED_HOSTS, 'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'com.hk', 'com.tw',
  'com.au', 'net.au', 'org.au', 'co.jp', 'co.kr', 'co.in', 'co.nz', 'com.sg', 'com.br', 'com.mx', 'co.za', 'com.tr']);

// Good-enough "which site is this" for the suggestion list (no public-suffix database).
function siteOf(hostKey) {
  const host = String(hostKey).replace(/^\./, '').toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const last2 = labels.slice(-2).join('.');
  return TWO_PART_SUFFIXES.has(last2) ? labels.slice(-3).join('.') : last2;
}

// Scan copies of browser databases live in %TEMP%\\bytemop-priv-*. A crash or a locked delete can leave one behind;
// they hold the browsing history in plain form, so old ones are removed at start.
async function sweepTemp(tmpRoot, maxAgeMs = 60 * 60 * 1000, now = Date.now()) {
  let removed = 0;
  let names = [];
  try { names = await fsp.readdir(tmpRoot); } catch { return 0; }
  for (const n of names) {
    if (!/^bytemop-priv-[A-Za-z0-9]{6}$/.test(n)) continue;
    const dir = path.join(tmpRoot, n);
    try {
      if (now - (await fsp.stat(dir)).mtimeMs < maxAgeMs) continue;
      await fsp.rm(dir, { recursive: true, force: true });
      removed += 1;
    } catch { /* in use or already gone */ }
  }
  return removed;
}

// ---------- SQLite helpers ----------

const lockedError = (e) => /locked|busy|unable to open|being used by another/i.test(String(e && e.message)) || (e && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES'));
const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const hasColumn = (db, table, col) => db.prepare(`PRAGMA table_info("${table}")`).all().some((c) => c.name === col);
const countOf = (db, table) => db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;

// Read-only access for scanning: work on a throw-away copy so the real file is never opened.
async function withCopy(file, tmpRoot, fn) {
  const dir = await fsp.mkdtemp(path.join(tmpRoot, 'bytemop-priv-'));
  try {
    const dest = path.join(dir, path.basename(file));
    await fsp.copyFile(file, dest);
    for (const s of ['-journal', '-wal', '-shm']) { try { await fsp.copyFile(file + s, dest + s); } catch { /* not there */ } }
    const db = new DatabaseSync(dest, { enableForeignKeyConstraints: false });
    try { return fn(db); } finally { db.close(); }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const exists = async (p) => { try { await fsp.access(p); return true; } catch { return false; } };

// ---------- engine ----------

function createPrivacy({ env = process.env, tmpDir = os.tmpdir(), running, isExcluded, browsers = BROWSERS } = {}) {
  const runningSet = async () => running || (await runningProcesses());
  const openOf = (b, run) => (run.has(UNKNOWN_PROCESSES) ? [...b.processes] : b.processes.filter((p) => run.has(p.toLowerCase())));

  async function profilesOf(b) {
    const root = expandEnv(b.dir, env);
    if (!root || !(await exists(root))) return null;
    let names = [];
    try { names = await fsp.readdir(root, { withFileTypes: true }); } catch { return null; }
    const profiles = names.filter((d) => d.isDirectory() && /^(Default|Profile \d+|Guest Profile)$/.test(d.name)).map((d) => path.join(root, d.name));
    return profiles;
  }

  // The database file for a kind inside one profile, or null when it does not exist / is excluded.
  async function dbFile(profile, kind) {
    const names = kind === 'cookies' ? ['Network\\Cookies', 'Cookies'] : ['History'];
    for (const n of names) {
      const f = path.join(profile, n);
      if (await exists(f)) return isExcluded && isExcluded(f) ? { excluded: true, file: f } : { file: f };
    }
    return null;
  }

  // Counts for one profile and kind, from a copy. {unsupported}/{locked} instead of throwing.
  // History and downloads live in the same file: one copy answers both.
  async function measureHistoryPair(profile) {
    const found = await dbFile(profile, 'history');
    if (!found) return { history: { missing: true }, downloads: { missing: true } };
    if (found.excluded) return { history: { excluded: true }, downloads: { excluded: true } };
    try {
      return await withCopy(found.file, tmpDir, (db) => ({
        history: hasTable(db, 'urls') && hasTable(db, 'visits') ? { count: countOf(db, 'urls') } : { unsupported: true },
        downloads: hasTable(db, 'downloads') ? { count: countOf(db, 'downloads') } : { unsupported: true },
      }));
    } catch (e) {
      const r = lockedError(e) ? { locked: true } : { unsupported: true };
      return { history: r, downloads: r };
    }
  }

  async function measure(profile, kind, keep, cache) {
    if (kind !== 'cookies') {
      if (!cache) return (await measureHistoryPair(profile))[kind];
      if (!cache.has(profile)) cache.set(profile, measureHistoryPair(profile));
      return (await cache.get(profile))[kind];
    }
    const found = await dbFile(profile, kind);
    if (!found) return { missing: true };
    if (found.excluded) return { excluded: true };
    try {
      return await withCopy(found.file, tmpDir, (db) => {
        if (kind === 'history') return hasTable(db, 'urls') && hasTable(db, 'visits') ? { count: countOf(db, 'urls') } : { unsupported: true };
        if (kind === 'downloads') return hasTable(db, 'downloads') ? { count: countOf(db, 'downloads') } : { unsupported: true };
        if (!hasTable(db, 'cookies') || !hasColumn(db, 'cookies', 'host_key')) return { unsupported: true };
        const groups = db.prepare('SELECT host_key AS h, COUNT(*) AS c FROM cookies GROUP BY host_key').all();
        let remove = 0; let kept = 0;
        const sites = new Map();
        for (const g of groups) {
          if (isKept(g.h, keep)) kept += g.c; else remove += g.c;
          const s = siteOf(g.h);
          sites.set(s, (sites.get(s) || 0) + g.c);
        }
        return { count: remove, keep: kept, sites };
      });
    } catch (e) {
      return lockedError(e) ? { locked: true } : { unsupported: true };
    }
  }

  // One entry per installed browser with, per kind, how much would go. Reads copies only.
  async function scan({ keepSites = [] } = {}) {
    const keep = keepSites.map(normalizeSite).filter(Boolean);
    const run = await runningSet();
    const out = [];
    const cache = new Map(); // profile -> its history/downloads counts, from one copy of the file
    for (const b of browsers) {
      const profiles = await profilesOf(b);
      if (!profiles || !profiles.length) continue;
      const entry = { id: b.id, name: b.name, running: openOf(b, run), profiles: profiles.length, kinds: {} };
      for (const kind of KINDS) {
        const sum = { count: 0, keep: 0, locked: false, unsupported: false, excluded: false, found: false };
        for (const p of profiles) {
          const m = await measure(p, kind, keep, cache);
          if (m.missing) continue;
          sum.found = true;
          if (m.locked) sum.locked = true;
          else if (m.unsupported) sum.unsupported = true;
          else if (m.excluded) sum.excluded = true;
          else { sum.count += m.count; sum.keep += m.keep || 0; }
        }
        entry.kinds[kind] = sum;
      }
      out.push(entry);
    }
    return out;
  }

  // Sites that currently have cookies, biggest first, so the user can tick the ones to keep.
  async function cookieSites() {
    const run = await runningSet();
    const merged = new Map();
    let locked = false;
    for (const b of browsers) {
      const profiles = await profilesOf(b);
      if (!profiles) continue;
      for (const p of profiles) {
        const m = await measure(p, 'cookies', []);
        if (m.locked) locked = true;
        if (m.sites) for (const [s, c] of m.sites) merged.set(s, (merged.get(s) || 0) + c);
      }
    }
    const sites = [...merged].map(([site, count]) => ({ site, count })).sort((a, b) => b.count - a.count || a.site.localeCompare(b.site));
    return { sites: sites.slice(0, 200), locked, anyRunning: browsers.some((b) => openOf(b, run).length > 0) };
  }

  // Delete rows in one database inside a transaction. Returns the number of rows removed.
  function deleteRows(file, kind, keep) {
    const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
    try {
      let removed = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        if (kind === 'history' || kind === 'downloads') {
          const must = kind === 'history' ? ['urls', 'visits'] : ['downloads'];
          if (!must.every((t) => hasTable(db, t))) { db.exec('ROLLBACK'); return { unsupported: true }; }
          const main = kind === 'history' ? 'urls' : 'downloads';
          removed = countOf(db, main);
          for (const t of kind === 'history' ? HISTORY_TABLES : DOWNLOAD_TABLES) if (hasTable(db, t)) db.exec(`DELETE FROM "${t}"`);
        } else {
          if (!hasTable(db, 'cookies') || !hasColumn(db, 'cookies', 'host_key')) { db.exec('ROLLBACK'); return { unsupported: true }; }
          const hosts = db.prepare('SELECT DISTINCT host_key AS h FROM cookies').all().map((r) => r.h).filter((h) => !isKept(h, keep));
          for (let i = 0; i < hosts.length; i += BATCH) {
            const part = hosts.slice(i, i + BATCH);
            const r = db.prepare(`DELETE FROM cookies WHERE host_key IN (${part.map(() => '?').join(',')})`).run(...part);
            removed += Number(r.changes);
          }
        }
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
        throw e;
      }
      // Free the pages so the deleted text is not left behind inside the file. Best effort.
      try { db.exec('VACUUM'); } catch { /* the data is already deleted; the file just stays bigger */ }
      return { removed };
    } finally {
      db.close();
    }
  }

  // selection: [{browser:'edge', kind:'history'}, ...]. Browsers that are running are skipped whole.
  async function clean(selection, { keepSites = [] } = {}) {
    const keep = keepSites.map(normalizeSite).filter(Boolean);
    const run = await runningSet();
    const results = [];
    const byBrowser = new Map();
    for (const s of Array.isArray(selection) ? selection : []) {
      if (!s || !browsers.some((b) => b.id === s.browser) || !KINDS.includes(s.kind)) continue;
      if (!byBrowser.has(s.browser)) byBrowser.set(s.browser, new Set());
      byBrowser.get(s.browser).add(s.kind);
    }
    for (const b of browsers) {
      const kinds = byBrowser.get(b.id);
      if (!kinds) continue;
      const open = openOf(b, run);
      for (const kind of KINDS.filter((k) => kinds.has(k))) {
        const r = { id: `${b.id}:${kind}`, browser: b.id, kind, deleted: 0, failed: 0, skipped: false, reason: null };
        results.push(r);
        if (open.length) { r.skipped = true; r.reason = 'running'; continue; }
        const profiles = (await profilesOf(b)) || [];
        for (const p of profiles) {
          const found = await dbFile(p, kind);
          if (!found) continue;
          if (found.excluded) { r.skipped = true; r.reason = 'excluded'; continue; }
          try {
            const x = deleteRows(found.file, kind, keep);
            if (x.unsupported) { r.failed += 1; r.reason = r.reason || 'unsupported'; } else r.deleted += x.removed;
          } catch (e) {
            r.failed += 1;
            r.reason = lockedError(e) ? 'locked' : 'error';
          }
          if (kind === 'history') {
            for (const f of HISTORY_FILES) {
              const full = path.join(p, f);
              if (isExcluded && isExcluded(full)) continue;
              try { await fsp.unlink(full); } catch (e) { if (e.code !== 'ENOENT') { r.failed += 1; r.reason = r.reason || 'locked'; } }
            }
          }
        }
      }
    }
    const totals = results.reduce((t, r) => ({ deleted: t.deleted + r.deleted, failed: t.failed + r.failed }), { deleted: 0, failed: 0 });
    return { results, totals };
  }

  return { scan, clean, cookieSites };
}

module.exports = { createPrivacy, sweepTemp, normalizeSite, isKept, siteOf, BROWSERS, KINDS, MAX_KEEP_SITES, HISTORY_TABLES, DOWNLOAD_TABLES, HISTORY_FILES };
