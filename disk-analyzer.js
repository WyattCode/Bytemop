'use strict';
// Read-only disk analysis: where the space goes, the biggest files, and duplicate files.
// Never modifies anything and never follows symlinks/junctions. No Electron imports.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MB = 1024 * 1024;
const MAX_DEPTH = 64;

function makeLimiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active += 1;
    const { fn, res, rej } = queue.shift();
    fn().then(res, rej).finally(() => { active -= 1; next(); });
  };
  return (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); next(); });
}

// Walk `root`. Returns {tree, large, candidates, stats}:
//  - tree: folder sizes, pruned so only meaningful children are kept (the rest become `other`)
//  - large: the biggest files
//  - candidates: files big enough to be worth checking for duplicates
async function analyze(root, opts = {}) {
  const { onProgress, control = { cancelled: false }, topFiles = 300, dupMinBytes = MB, maxCandidates = 300000, concurrency = 24 } = opts;
  const limit = makeLimiter(concurrency);
  const stats = { files: 0, dirs: 0, bytes: 0, inaccessible: 0 };
  let large = [];
  const candidates = [];
  const seenLinks = new Set(); // dev:ino of hard-linked files already counted: one file with two names is one file
  let lastTick = 0;
  const tick = (current) => {
    if (!onProgress) return;
    const now = Date.now();
    if (now - lastTick < 150) return;
    lastTick = now;
    onProgress({ files: stats.files, bytes: stats.bytes, current });
  };
  const addLarge = (f) => {
    large.push(f);
    if (large.length > topFiles * 2) { large.sort((a, b) => b.size - a.size); large = large.slice(0, topFiles); }
  };

  async function walk(dir, name, depth) {
    const node = { name, path: dir, size: 0, files: 0, fileBytes: 0, children: [], other: { size: 0, dirs: 0 } };
    if (control.cancelled) return node;
    if (depth > MAX_DEPTH) { stats.inaccessible += 1; return node; } // too deep to follow: say so instead of ignoring it
    let entries;
    try { entries = await limit(() => fsp.readdir(dir, { withFileTypes: true })); } catch { stats.inaccessible += 1; return node; }
    stats.dirs += 1;
    tick(dir);

    const files = entries.filter((e) => e.isFile());
    const dirs = entries.filter((e) => e.isDirectory());
    await Promise.all(files.map((e) => limit(async () => {
      if (control.cancelled) return;
      const p = path.join(dir, e.name);
      let s;
      try { s = await fsp.lstat(p); } catch { stats.inaccessible += 1; return; }
      if (!s.isFile()) return;
      if (s.nlink > 1) {
        try {
          const b = await fsp.lstat(p, { bigint: true }); // full 64-bit file id
          const key = b.dev + ':' + b.ino;
          if (seenLinks.has(key)) return;
          seenLinks.add(key);
        } catch { /* count it */ }
      }
      node.fileBytes += s.size;
      node.files += 1;
      stats.files += 1;
      stats.bytes += s.size;
      const f = { path: p, name: e.name, size: s.size, mtimeMs: s.mtimeMs };
      addLarge(f);
      if (s.size >= dupMinBytes && candidates.length < maxCandidates) candidates.push(f);
    })));

    // lstat again so junctions (which can report as plain directories) are never followed.
    const kids = (await Promise.all(dirs.map(async (e) => {
      const p = path.join(dir, e.name);
      try { if ((await limit(() => fsp.lstat(p))).isSymbolicLink()) return null; } catch { stats.inaccessible += 1; return null; }
      return walk(p, e.name, depth + 1);
    }))).filter(Boolean);

    node.size = node.fileBytes + kids.reduce((s, k) => s + k.size, 0);
    node.files += kids.reduce((s, k) => s + k.files, 0);
    kids.sort((a, b) => b.size - a.size);
    const floor = Math.max(node.size * 0.01, MB);
    for (const k of kids) {
      if (node.children.length < 25 && k.size >= floor) node.children.push(k);
      else { node.other.size += k.size; node.other.dirs += 1; }
    }
    return node;
  }

  const tree = await walk(root, path.basename(root) || root, 0);
  large.sort((a, b) => b.size - a.size);
  return { tree, large: large.slice(0, topFiles), candidates, stats, cancelled: !!control.cancelled };
}

async function hashFile(file, { partial = false, control }) {
  const h = crypto.createHash('sha256');
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(partial ? 64 * 1024 : 1024 * 1024);
    for (;;) {
      if (control && control.cancelled) return null;
      const { bytesRead } = await fh.read(buf, 0, buf.length, null);
      if (!bytesRead) break;
      h.update(buf.subarray(0, bytesRead));
      if (partial) break;
    }
  } finally { await fh.close(); }
  return h.digest('hex');
}

// Files are duplicates only when size AND full SHA-256 match (a cheap first-64KB hash weeds out most
// same-size files first). Returns groups sorted by wasted space.
async function findDuplicates(candidates, { control = { cancelled: false }, onProgress, maxGroups = 200 } = {}) {
  const bySize = new Map();
  for (const f of candidates) { if (!bySize.has(f.size)) bySize.set(f.size, []); bySize.get(f.size).push(f); }
  const sizeGroups = [...bySize.values()].filter((g) => g.length > 1).sort((a, b) => b[0].size - a[0].size);
  const total = sizeGroups.reduce((s, g) => s + g.length, 0);
  let done = 0;
  const groups = [];
  const progress = () => { if (onProgress) onProgress({ done, total }); };

  for (const g of sizeGroups) {
    if (control.cancelled) break;
    const byPartial = new Map();
    for (const f of g) {
      try {
        const h = await hashFile(f.path, { partial: true, control });
        if (h === null) break;
        if (!byPartial.has(h)) byPartial.set(h, []);
        byPartial.get(h).push(f);
      } catch { /* vanished or unreadable */ }
      done += 1;
    }
    for (const same of byPartial.values()) {
      if (same.length < 2 || control.cancelled) continue;
      const byFull = new Map();
      for (const f of same) {
        try {
          const h = await hashFile(f.path, { control });
          if (h === null) break;
          if (!byFull.has(h)) byFull.set(h, []);
          byFull.get(h).push(f);
        } catch { /* vanished or unreadable */ }
      }
      for (const dup of byFull.values()) if (dup.length > 1) groups.push({ size: dup[0].size, files: dup });
    }
    progress();
  }
  groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
  return { groups: groups.slice(0, maxGroups), cancelled: !!control.cancelled };
}

module.exports = { analyze, findDuplicates, makeLimiter };
