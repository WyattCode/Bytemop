'use strict';
// Path checks that look at what is really on disk, not only at how a path is spelled.
const fs = require('fs');
const path = require('path');

const realpathNative = (p) => new Promise((resolve, reject) => fs.realpath.native(p, (e, r) => (e ? reject(e) : resolve(r))));
const stripPrefix = (p) => p.replace(/^\\\\\?\\/, '');
const lower = (p) => stripPrefix(p).toLowerCase().replace(/[\\/]+$/, '');

// True when no part of `dir` (as far as it exists) is a junction or symlink: its real path is exactly
// the spelled path. Used right before an elevated move/restore, so a folder swapped for a junction after
// the file list was made cannot redirect an administrator-level operation to somewhere else.
async function isPlainDir(dir) {
  let cur = path.resolve(dir);
  for (;;) {
    try {
      return lower(await realpathNative(cur)) === lower(cur);
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') return false;
      const up = path.dirname(cur);
      if (up === cur) return false;
      cur = up; // not created yet: check the nearest folder that exists
    }
  }
}

// Long, real form of a path (resolves junctions and 8.3 short names). Falls back to the input.
async function canonical(p) {
  try { return stripPrefix(await realpathNative(p)); } catch { return p; }
}

function canonicalSync(p) {
  try { return stripPrefix(fs.realpathSync.native(p)); } catch { return p; }
}

module.exports = { isPlainDir, canonical, canonicalSync };
