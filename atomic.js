'use strict';
// Small helpers for the JSON files the app keeps (settings, exclusions, keep list).
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');

// Write to a uniquely named temp file, then rename over the target: readers see the old or the new
// file, never a half-written one, and concurrent writers never share a temp file.
async function atomicWrite(file, text) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  // fsync before the rename: after a power cut the new name must never point at an empty or partial file.
  let fh;
  try {
    fh = await fsp.open(tmp, 'w');
    await fh.writeFile(text);
    await fh.sync();
  } catch (e) {
    if (fh) await fh.close().catch(() => {});
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  await fh.close();
  // On Windows, renaming over a file that is being renamed over (or scanned by antivirus) at that moment fails with
  // EPERM/EBUSY/EACCES for a few milliseconds: retry briefly before giving up.
  for (let attempt = 0; ; attempt++) {
    try { await fsp.rename(tmp, file); return; } catch (e) {
      const transient = e && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES');
      if (!transient || attempt >= 8) { await fsp.rm(tmp, { force: true }).catch(() => {}); throw e; }
      await new Promise((r) => setTimeout(r, 15 * (attempt + 1)));
    }
  }
}

// Runs async functions one after another, so read-modify-write cycles cannot overlap.
function createQueue() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

module.exports = { atomicWrite, createQueue };
