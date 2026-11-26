'use strict';
// M7 quarantine: moves files into a managed folder so a clean can be undone.
//
// Layout:  <dir>/<runId>/meta.json      run summary (atomic writes)
//          <dir>/<runId>/journal.jsonl  one line per file, written BEFORE the move (intent log)
//          <dir>/<runId>/files/<seq>    the moved file
// A journal line only counts as "quarantined" if files/<seq> exists, so a crash between the
// intent write and the move (or after it) always reconciles correctly.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const { isPlainDir } = require('./pathsafe');
const { atomicWrite, createQueue } = require('./atomic');

const DAY_MS = 24 * 3600 * 1000;
// Run ids are made by begin(): an ISO timestamp with dashes plus hex. Anything else (e.g. '..') is not a run.
const RUN_ID_RE = /^[0-9A-Za-z][0-9A-Za-z-]*$/;

async function exists(p) {
  try { await fsp.lstat(p); return true; } catch { return false; }
}

// rename, falling back to copy+delete across volumes (EXDEV). Returns true on success.
// `forceCopy` skips the rename: the copy gets the destination folder's inherited permissions
// (rename would keep the source's ACL), which the elevated helper needs so that files taken from
// admin-only folders stay deletable by the normal user later.
async function moveFile(src, dest, mtimeMs, forceCopy = false) {
  if (!forceCopy) {
    try { await fsp.rename(src, dest); return true; }
    catch (e) {
      if (e.code !== 'EXDEV') return false;
    }
  }
  // Copy to a '.part' name first: a crash mid-copy must not leave a truncated file under the real name, where the
  // journal would count it as a good quarantined copy.
  const part = dest + '.part';
  try {
    await fsp.copyFile(src, part, fs.constants.COPYFILE_EXCL);
    if (mtimeMs) { const t = new Date(mtimeMs); await fsp.utimes(part, t, t); }
    await fsp.rename(part, dest);
    try { await fsp.unlink(src); }
    catch { await fsp.unlink(dest).catch(() => {}); return false; } // could not remove the original: undo the copy
    return true;
  } catch { await fsp.unlink(part).catch(() => {}); await fsp.unlink(dest).catch(() => {}); return false; }
}

// Move without ever replacing something that appeared at the destination in the meantime (rename replaces files on
// Windows): a hard link fails with EEXIST instead. Falls back to the plain move where links are not available.
async function moveNoClobber(src, dest, mtimeMs) {
  try {
    await fsp.link(src, dest);
  } catch (e) {
    if (e.code === 'EEXIST') return 'exists';
    return moveFile(src, dest, mtimeMs); // EXDEV, EPERM, no hard-link support: the caller already checked the name is free
  }
  try { await fsp.unlink(src); } catch { await fsp.unlink(dest).catch(() => {}); return false; }
  return true;
}

// "name.ext" -> "name (restored).ext", then "name (restored 2).ext", ...
async function freeName(dest) {
  const { dir, name, ext } = path.parse(dest);
  for (let i = 1; i < 1000; i++) {
    const cand = path.join(dir, `${name} (restored${i > 1 ? ' ' + i : ''})${ext}`);
    if (!(await exists(cand))) return cand;
  }
  throw new Error('no free file name');
}

class Quarantine {
  constructor(dir, { forceCopy = false } = {}) { this.dir = dir; this.forceCopy = forceCopy; this._metaQueue = createQueue(); }

  runDir(id) {
    if (typeof id !== 'string' || !RUN_ID_RE.test(id)) throw new Error('invalid run id');
    return path.join(this.dir, id);
  }

  async _writeMeta(id, meta) {
    const file = path.join(this.runDir(id), 'meta.json'); // (throws on a bad id)
    // One writer at a time within this process; atomicWrite's unique temp names and retries cover other processes.
    await this._metaQueue(() => atomicWrite(file, JSON.stringify(meta)));
  }

  async _readMeta(id) {
    try { return JSON.parse(await fsp.readFile(path.join(this.runDir(id), 'meta.json'), 'utf8')); } catch { return null; }
  }

  // Start a new run. `info` is stored in meta (e.g. rule ids).
  async begin(info = {}, now = Date.now()) {
    const id = new Date(now).toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
    await fsp.mkdir(path.join(this.runDir(id), 'files'), { recursive: true });
    await this._writeMeta(id, { id, createdAt: now, status: 'in-progress', count: 0, bytes: 0, ...info });
    return { id, seq: 0 };
  }

  // Quarantine one file. Returns true if it was moved.
  async moveFile(run, orig, size, ruleId, mtimeMs) {
    const seq = ++run.seq;
    const dir = this.runDir(run.id);
    await fsp.appendFile(path.join(dir, 'journal.jsonl'), JSON.stringify({ seq, orig, size, rule: ruleId, mtimeMs }) + '\n');
    return moveFile(orig, path.join(dir, 'files', String(seq)), mtimeMs, this.forceCopy);
  }

  // Journal entries whose file is actually in the quarantine.
  async entries(id) {
    let text;
    try { text = await fsp.readFile(path.join(this.runDir(id), 'journal.jsonl'), 'utf8'); } catch { return []; }
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; } // torn last line after a crash
      // The journal is a file on disk: trust nothing in it. seq must be a plain counter (it becomes a file
      // name under files/) and orig an absolute path.
      if (!e || !Number.isInteger(e.seq) || e.seq < 1 || typeof e.orig !== 'string' || !path.isAbsolute(e.orig)) continue;
      const stored = path.join(this.runDir(id), 'files', String(e.seq));
      if (await exists(stored)) out.push({ ...e, stored });
    }
    return out;
  }

  async _finalize(id, status, extra = {}) {
    const meta = (await this._readMeta(id)) || { id, createdAt: Date.now() };
    const es = await this.entries(id);
    const next = { ...meta, ...extra, status, finishedAt: Date.now(), count: es.length, bytes: es.reduce((s, e) => s + e.size, 0) };
    await this._writeMeta(id, next);
    return next;
  }

  // Mark a run complete. An empty run is removed.
  async commit(run) {
    const meta = await this._finalize(run.id, 'committed');
    if (meta.count === 0) { await this.purge(run.id); return { ...meta, removed: true }; }
    return meta;
  }

  // Reconcile runs left 'in-progress' by a crash. Their files stay restorable.
  // Runs younger than `minAgeMs` (by last activity) are skipped: they may belong to a clean that is
  // running right now in another process.
  async recover(minAgeMs = 0, now = Date.now()) {
    const out = [];
    let names = [];
    try { names = await fsp.readdir(this.dir); } catch { return out; }
    for (const id of names) {
      if (!RUN_ID_RE.test(id)) continue;
      const meta = await this._readMeta(id);
      if (!meta) {
        // Crash before meta was written: nothing recorded, so nothing to keep.
        const es = await this.entries(id);
        if (es.length === 0) {
          // A run folder with no meta may be one another process is creating right now: leave young ones alone.
          if (minAgeMs > 0) { try { if (now - (await fsp.stat(this.runDir(id))).mtimeMs < minAgeMs) continue; } catch { continue; } }
          await fsp.rm(this.runDir(id), { recursive: true, force: true });
        }
        continue;
      }
      if (meta.status !== 'in-progress') continue;
      if (minAgeMs > 0) {
        let last = meta.createdAt || 0;
        try { last = Math.max(last, (await fsp.stat(path.join(this.runDir(id), 'journal.jsonl'))).mtimeMs); } catch { /* no journal yet */ }
        if (now - last < minAgeMs) continue;
      }
      const m = await this._finalize(id, 'interrupted');
      if (m.count === 0) await this.purge(id); else out.push(m);
    }
    return out;
  }

  // All runs, newest first.
  async list() {
    const runs = [];
    let names = [];
    try { names = await fsp.readdir(this.dir); } catch { return runs; }
    for (const id of names) {
      if (!RUN_ID_RE.test(id)) continue;
      let meta = await this._readMeta(id);
      if (!meta) meta = await this._rebuildMeta(id); // a damaged meta.json must not hide files the user can still restore
      if (meta) runs.push(meta);
    }
    return runs.sort((a, b) => b.createdAt - a.createdAt);
  }

  // Rebuild a lost meta.json from the journal and what is really in files/. Elevated-ness is unknown, so it is
  // marked and treated as an ordinary run.
  async _rebuildMeta(id) {
    const es = await this.entries(id);
    if (!es.length) return null;
    let createdAt = Date.now();
    try { const st = await fsp.stat(this.runDir(id)); createdAt = st.birthtimeMs || st.mtimeMs; } catch { /* keep now */ }
    const meta = { id, createdAt, status: 'interrupted', metaRebuilt: true, rules: [], count: es.length, bytes: es.reduce((s, e) => s + e.size, 0), finishedAt: Date.now() };
    try { await this._writeMeta(id, meta); } catch { /* read-only folder: still report it */ }
    return meta;
  }

  async totalBytes() {
    return (await this.list()).reduce((s, r) => s + (r.bytes || 0), 0);
  }

  // Restore all (or the listed seqs of) a run. Existing files at the original path are never overwritten.
  // `allow(origPath)` can veto destinations (the elevated helper uses it so a tampered journal
  // cannot make it write outside the admin-only folders); vetoed entries stay quarantined.
  async restore(id, { seqs, allow } = {}) {
    const res = { restored: 0, renamed: 0, failed: 0 };
    const want = seqs ? new Set(seqs) : null;
    for (const e of await this.entries(id)) {
      if (want && !want.has(e.seq)) continue;
      if (allow && !allow(e.orig)) { res.failed += 1; continue; }
      // Elevated restores only: the destination must not go through a junction/symlink, which would
      // let a user-planted link send an administrator-level move outside the allowed folders.
      if (allow && !(await isPlainDir(path.dirname(e.orig)))) { res.failed += 1; continue; }
      try {
        await fsp.mkdir(path.dirname(e.orig), { recursive: true });
        let dest = e.orig;
        if (await exists(dest)) { dest = await freeName(dest); res.renamed += 1; }
        let r = await moveNoClobber(e.stored, dest, e.mtimeMs);
        if (r === 'exists') { // something appeared there since the check: use a free name instead
          if (dest === e.orig) res.renamed += 1;
          dest = await freeName(e.orig);
          r = await moveNoClobber(e.stored, dest, e.mtimeMs);
        }
        if (r === true) res.restored += 1;
        else { res.failed += 1; if (dest !== e.orig) res.renamed -= 1; }
      } catch { res.failed += 1; }
    }
    const meta = await this._readMeta(id);
    if (meta) {
      const m = await this._finalize(id, meta.status);
      if (m.count === 0) await this.purge(id);
    }
    return res;
  }

  // Permanently delete a run. Returns the bytes released.
  async purge(id) {
    if (typeof id !== 'string' || !RUN_ID_RE.test(id)) return 0;
    const meta = await this._readMeta(id);
    await fsp.rm(this.runDir(id), { recursive: true, force: true });
    return meta ? meta.bytes || 0 : 0;
  }

  async purgeAll() {
    let freed = 0;
    for (const r of await this.list()) freed += await this.purge(r.id);
    return freed;
  }

  // Remove runs older than the retention period. Returns [{id, bytes}].
  async purgeExpired(retentionDays, now = Date.now()) {
    const out = [];
    for (const r of await this.list()) {
      if (r.status === 'in-progress') continue;
      if (r.createdAt + retentionDays * DAY_MS <= now) out.push({ id: r.id, bytes: await this.purge(r.id) });
    }
    return out;
  }
}

module.exports = { Quarantine, DAY_MS, RUN_ID_RE };
