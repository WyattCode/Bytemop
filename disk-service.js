'use strict';
// Disk analysis for the app. The renderer never names a path to delete freely: it can only ask to
// trash files that appeared in the latest analysis, and every request is re-checked here.
// Deleting means "send to the Windows Recycle Bin" (the user can put it back from there).
// No Electron imports: the trash function is injected.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { analyze, findDuplicates } = require('./disk-analyzer');
const { createQueue } = require('./atomic');
const { canonical, canonicalSync } = require('./pathsafe');

const norm = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
const isUnder = (p, root) => { const a = norm(p); const r = norm(root); return a === r || a.startsWith(r + '\\'); };

function defaultProtected(env) {
  return [env.SystemRoot, env.windir, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.ProgramData].filter(Boolean);
}

// OneDrive folders: reading a 'files on demand' placeholder downloads it, so duplicate checking (which reads
// file contents) leaves them out.
function defaultCloudRoots(env) {
  return [env.OneDrive, env.OneDriveConsumer, env.OneDriveCommercial].filter(Boolean);
}

function createDiskService({ env = process.env, cloudRoots = defaultCloudRoots(env), trashItem, logEvent = async () => {}, getExcluded = async () => () => false, protectedRoots, extraProtected = [], canTrash = async () => ({ ok: true }), isDir = async (p) => (await fsp.stat(p)).isDirectory() }) {
  // Protected folders are compared by their real, long path, so short (8.3) names and links cannot hide them.
  const cloudList = cloudRoots.flatMap((r) => [r, canonicalSync(r)]);
  const protectedList = (protectedRoots || defaultProtected(env)).concat(extraProtected).flatMap((r) => [r, canonicalSync(r)]);
  const isProtected = (p) => protectedList.some((r) => isUnder(p, r));
  let control = null;
  const trashQueue = createQueue(); // two trash requests must not interleave their checks
  let last = null; // { root, files: Map<norm path, {path,size}>, candidates, groups: [] }

  const publicFile = (f) => ({ path: f.path, name: f.name, size: f.size, mtimeMs: f.mtimeMs, protected: isProtected(f.path) });

  async function run(root, onProgress) {
    // Take over first, before any await, so overlapping calls always cancel the older one.
    if (control) control.cancelled = true;
    const mine = { cancelled: false };
    control = mine;
    if (typeof root !== 'string' || !root.trim()) return { error: 'not-a-folder' }; // path.resolve('') would mean the working directory
    root = path.resolve(root);
    let ok = false;
    // UNC and \\?\ spellings are not accepted: they are the easy way around the protected-folder checks.
    try { ok = path.isAbsolute(root) && !root.startsWith('\\\\') && (await isDir(root)); } catch { ok = false; }
    if (!ok) return { error: 'not-a-folder' };
    root = await canonical(root);
    const started = Date.now();
    const res = await analyze(root, { onProgress, control: mine });
    const excluded = await getExcluded();
    const keep = (f) => !excluded(f.path);
    const large = res.large.filter(keep);
    const candidates = res.candidates.filter(keep);
    if (!res.cancelled && control === mine) {
      last = { root, files: new Map(), candidates, groups: [] };
      for (const f of large) last.files.set(norm(f.path), f);
    }
    return {
      root, cancelled: res.cancelled || control !== mine, tree: res.tree, large: large.map(publicFile), stats: res.stats,
      candidateCount: candidates.length, ms: Date.now() - started,
    };
  }

  async function duplicates(onProgress) {
    if (!last) return { error: 'no-analysis' };
    const mineLast = last;
    if (control) control.cancelled = true;
    const mine = { cancelled: false };
    control = mine;
    const usable = mineLast.candidates.filter((f) => !cloudList.some((r) => isUnder(f.path, r)));
    const skippedCloud = mineLast.candidates.length - usable.length;
    const res = await findDuplicates(usable, { control: mine, onProgress });
    if (res.cancelled || last !== mineLast) return { cancelled: true, groups: [] }; // cancelled, or a newer analysis replaced it
    mineLast.groups = res.groups;
    for (const g of res.groups) for (const f of g.files) mineLast.files.set(norm(f.path), f); // dup members are trashable too
    return {
      cancelled: false,
      skippedCloud,
      groups: res.groups.map((g, i) => ({ id: i, size: g.size, files: g.files.map(publicFile) })),
    };
  }

  // The listed file for a path from the renderer, or null (used before revealing in Explorer).
  const known = (p) => (last && typeof p === 'string' && last.files.get(norm(p))) || null;

  // Folders and files under the analysed root may be shown in Explorer (read-only, harmless).
  const revealable = (p) => (last && typeof p === 'string' && isUnder(p, last.root) ? path.resolve(p) : null);

  function cancel() { if (control) control.cancelled = true; }

  // Move files from the latest analysis to the Recycle Bin. Returns what happened per path.
  const trash = (paths) => trashQueue(() => trashNow(paths));

  async function trashNow(paths) {
    const out = { trashed: 0, bytes: 0, failed: [] };
    if (!last || !Array.isArray(paths)) return out;
    const wanted = [...new Set(paths.filter((p) => typeof p === 'string').map(norm))];
    const excluded = await getExcluded();

    // A group of identical files must keep at least one member.
    const groupOf = new Map();
    last.groups.forEach((g, i) => g.files.forEach((f) => groupOf.set(norm(f.path), i)));
    const chosenPerGroup = new Map();
    for (const w of wanted) if (groupOf.has(w)) chosenPerGroup.set(groupOf.get(w), (chosenPerGroup.get(groupOf.get(w)) || 0) + 1);
    const fullGroups = new Set([...chosenPerGroup].filter(([i, n]) => n >= last.groups[i].files.length).map(([i]) => i));

    for (const w of wanted) {
      const f = last.files.get(w);
      const fail = (reason) => out.failed.push({ path: f ? f.path : w, reason });
      if (!f) { fail('not-listed'); continue; }
      if (isProtected(f.path)) { fail('protected'); continue; }
      if (excluded(f.path)) { fail('excluded'); continue; }
      if (groupOf.has(w) && fullGroups.has(groupOf.get(w))) { fail('all-copies'); continue; }
      try {
        const s = await fsp.lstat(f.path);
        if (!s.isFile() || s.size !== f.size || (f.mtimeMs && Math.abs(s.mtimeMs - f.mtimeMs) > 5)) { fail('changed'); continue; } // edited since it was listed
        // The Recycle Bin must really be able to take it, or Windows would delete it for good.
        const can = await canTrash(f.path, f.size);
        if (!can.ok) { fail(can.reason || 'no-recycle-bin'); continue; }
        await trashItem(f.path);
        out.trashed += 1;
        out.bytes += f.size;
        last.files.delete(w);
        // Forget it in its duplicate group too, so 'keep one copy' counts what is really left.
        if (groupOf.has(w)) { const g = last.groups[groupOf.get(w)]; g.files = g.files.filter((x) => norm(x.path) !== w); }
      } catch (e) { fail(e && e.code === 'ENOENT' ? 'gone' : 'error'); }
    }
    if (out.trashed) await logEvent({ type: 'trash', n: out.trashed, bytes: out.bytes });
    return out;
  }

  return { analyze: run, duplicates, cancel, trash, isProtected, known, revealable };
}

module.exports = { createDiskService };
