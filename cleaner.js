'use strict';
// Core scan/clean logic. No Electron imports, so it can be tested in plain Node.
// Rules use the v1 schema validated by rule-engine.js.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const { isPlainDir, canonical } = require('./pathsafe');
const { system32 } = require('./syspath');

function expandEnv(str, env) {
  const lower = {};
  for (const k of Object.keys(env)) lower[k.toLowerCase()] = env[k];
  let unresolved = false;
  const out = str.replace(/%([^%]+)%/g, (m, k) => {
    const v = lower[k.toLowerCase()];
    if (v === undefined || v === '') { unresolved = true; return m; }
    return v;
  });
  return unresolved ? null : out;
}

function globToRegex(seg) {
  const esc = seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + esc + '$', 'i');
}

// Resolve a directory pattern whose path segments may contain '*'.
async function resolveDirs(pattern) {
  const parts = pattern.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return [];
  let current = [/^[A-Za-z]:$/.test(parts[0]) ? parts[0] + path.sep : parts[0]];
  for (const seg of parts.slice(1)) {
    const next = [];
    for (const base of current) {
      if (!seg.includes('*')) { next.push(path.join(base, seg)); continue; }
      let entries;
      try { entries = await fsp.readdir(base, { withFileTypes: true }); } catch { continue; }
      const re = globToRegex(seg);
      for (const e of entries) if (e.isDirectory() && re.test(e.name)) next.push(path.join(base, e.name));
    }
    current = next;
  }
  const existing = [];
  for (const d of current) {
    try { if ((await fsp.lstat(d)).isDirectory()) existing.push(d); } catch { /* missing */ }
  }
  return existing;
}

// Runtime guard: refuse roots that are too shallow to be a cache directory.
function isSafeRoot(dir) {
  const { root } = path.parse(dir);
  if (dir === root) return false;
  const depth = dir.slice(root.length).split(/[\\/]+/).filter(Boolean).length;
  return depth >= 2;
}

// A cache folder may never be (or contain) the user's profile, documents or Windows: a TEMP variable pointing at
// C:\\Users\\me must not turn "clean temp files" into "clean everything".
function isForbiddenRoot(dir, env) {
  const home = env.USERPROFILE;
  const norm = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
  const protectedDirs = [home, home && path.dirname(home), env.SystemRoot, env.windir, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData,
    env.APPDATA, env.LOCALAPPDATA, env.SystemDrive && env.SystemDrive + '\\',
    ...(home ? ['Documents', 'Desktop', 'Downloads', 'Pictures', 'Music', 'Videos'].map((n) => path.join(home, n)) : [])].filter(Boolean);
  const d = norm(dir);
  return protectedDirs.some((k) => { const kk = norm(k); return kk === d || kk.startsWith(d + '\\'); });
}

// Walk a directory without following symlinks/junctions.
async function walk(dir, recurse, files, dirs) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      let st;
      try { st = await fsp.lstat(full); } catch { continue; }
      if (st.isSymbolicLink()) continue; // junction reported as a directory
      dirs.push(full);
      if (recurse) await walk(full, recurse, files, dirs);
    } else if (e.isFile()) {
      files.push(full);
    }
  }
}

// Marker meaning 'could not read the process list'. blockers() then reports every program as running.
const UNKNOWN_PROCESSES = '*';

function runningProcesses() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(new Set());
    execFile(system32('tasklist.exe'), ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(new Set([UNKNOWN_PROCESSES])); // fail closed: treat everything as running
      const names = new Set();
      for (const line of stdout.split(/\r?\n/)) {
        const m = line.match(/^"([^"]+)"/);
        if (m) names.add(m[1].toLowerCase());
      }
      resolve(names);
    });
  });
}

// Does a file name pass the target's include/exclude globs? Exclude wins.
function nameAllowed(name, target) {
  const inc = target.include && target.include.length ? target.include : ['*'];
  const exc = target.exclude || [];
  if (exc.some((g) => globToRegex(g).test(name))) return false;
  return inc.some((g) => globToRegex(g).test(name));
}

// List files a rule is allowed to remove. Returns {roots, items:[{path,size}], dirs}.
async function listEligible(rule, ctx) {
  const env = ctx.env || process.env;
  const now = ctx.now || Date.now();
  const minAgeMs = (rule.minAgeHours || 0) * 3600 * 1000;
  const out = { items: [], dirs: [], roots: [] };
  for (const t of rule.targets) {
    const expanded = expandEnv(t.path, env);
    if (!expanded) continue;
    for (const found of await resolveDirs(expanded)) {
      // The real, long spelling: exclusions and checks compare spelled paths, so an 8.3 short TEMP must not slip past them.
      const root = await canonical(found);
      if (!isSafeRoot(root) || isForbiddenRoot(root, env)) continue;
      out.roots.push(root);
      const files = [];
      const dirs = [];
      await walk(root, t.recurse !== false, files, dirs);
      for (const f of files) {
        if (!nameAllowed(path.basename(f), t)) continue;
        if (ctx.isExcluded && ctx.isExcluded(f)) continue; // user exclusions beat every rule
        let st;
        try { st = await fsp.lstat(f); } catch { continue; }
        if (!st.isFile()) continue;
        // Age counts from the newer of modified and created: an archive unpacked a second ago keeps its old mtime.
        if (minAgeMs && now - Math.max(st.mtimeMs, st.birthtimeMs || 0) < minAgeMs) continue;
        out.items.push({ path: f, size: st.size, mtimeMs: st.mtimeMs, root });
      }
      // Directories are only pruned when the target has no filters (otherwise they may hold kept files).
      if (!(t.include && t.include.length) && !(t.exclude && t.exclude.length)) out.dirs.push(...dirs);
    }
  }
  return out;
}

function blockers(rule, running) {
  if (running.has(UNKNOWN_PROCESSES)) return [...(rule.blockedByProcesses || [])];
  return (rule.blockedByProcesses || []).filter((p) => running.has(p.toLowerCase()));
}

async function buildCtx(opts) {
  return { env: opts.env, now: opts.now, isExcluded: opts.isExcluded, running: opts.running || (await runningProcesses()) };
}

// Scan is read-only. Returns metrics keyed by rule id; callers merge display metadata.
async function scan(rules, opts = {}) {
  const ctx = await buildCtx(opts);
  const out = [];
  for (const rule of rules) {
    const r = await listEligible(rule, ctx);
    out.push({
      id: rule.id,
      bytes: r.items.reduce((s, i) => s + i.size, 0),
      count: r.items.length,
      blockedBy: blockers(rule, ctx.running),
    });
  }
  return out;
}

// Read-only breakdown of one rule for the detail drawer: where it looks and what is biggest
// (grouped by the first folder/file under each root).
async function details(rule, opts = {}) {
  const ctx = await buildCtx(opts);
  const r = await listEligible(rule, ctx);
  const groups = new Map();
  for (const it of r.items) {
    const rel = path.relative(it.root, it.path).split(path.sep);
    const key = it.root + '\u0000' + rel[0];
    const g = groups.get(key) || { name: rel[0], path: path.join(it.root, rel[0]), isDir: rel.length > 1, bytes: 0, count: 0 };
    g.bytes += it.size;
    g.count += 1;
    groups.set(key, g);
  }
  const entries = [...groups.values()].sort((a, b) => b.bytes - a.bytes);
  return {
    id: rule.id,
    roots: r.roots,
    bytes: r.items.reduce((s, i) => s + i.size, 0),
    count: r.items.length,
    blockedBy: blockers(rule, ctx.running),
    entries: entries.slice(0, 12),
    moreEntries: Math.max(0, entries.length - 12),
  };
}

// Default remover: delete the file for good.
const permanentRemover = { async remove(item) { await fsp.unlink(item.path); return true; } };

// Remove what each rule matches. `opts.remover.remove(item, rule)` decides how (default: permanent
// delete; the clean service passes a quarantine remover). Rules blocked by a running process are
// skipped untouched.
async function clean(rules, opts = {}) {
  const ctx = await buildCtx(opts);
  const remover = opts.remover || permanentRemover;
  const out = [];
  for (const rule of rules) {
    const blockedBy = blockers(rule, ctx.running);
    const res = { id: rule.id, deleted: 0, freed: 0, failed: 0, skipped: false, blockedBy };
    if (blockedBy.length) { res.skipped = true; out.push(res); continue; }
    const r = await listEligible(rule, ctx);
    for (const it of r.items) {
      try {
        // Elevated rules act with administrator rights: make sure the folder was not swapped for a junction
        // since the list was made (a link could otherwise redirect the move to a protected place).
        if (rule.requiresAdmin && !(await isPlainDir(path.dirname(it.path)))) { res.failed += 1; continue; }
        if (await remover.remove(it, rule)) { res.deleted += 1; res.freed += it.size; } else res.failed += 1;
      } catch { res.failed += 1; }
    }
    // Remove now-empty subdirectories, deepest first; target roots themselves are never in this list.
    r.dirs.sort((a, b) => b.length - a.length);
    const minAgeMs = (rule.minAgeHours || 0) * 3600 * 1000;
    const now = ctx.now || Date.now();
    for (const d of r.dirs) {
      if (ctx.isExcluded && ctx.isExcluded(d)) continue; // a folder the user excluded stays, even when empty
      if (minAgeMs) { // a folder an app created a moment ago is not 'old', even if it is empty right now
        try { const st = await fsp.lstat(d); if (now - Math.max(st.mtimeMs, st.birthtimeMs || 0) < minAgeMs) continue; } catch { continue; }
      }
      try { await fsp.rmdir(d); } catch { /* not empty or locked */ }
    }
    out.push(res);
  }
  return out;
}

module.exports = { isForbiddenRoot, scan, clean, details, expandEnv, resolveDirs, isSafeRoot, nameAllowed, runningProcesses, UNKNOWN_PROCESSES };
