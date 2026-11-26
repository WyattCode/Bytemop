'use strict';
// What kind of copy of Bytemop is running. A portable build unpacks itself into a fixed folder under %TEMP% on every
// start (and wipes that folder first), so a second start of the same file would delete the runtime of the first, and
// an elevated process running from a user-writable folder would be an escalation hole. The features that start the
// program again (scheduled runs, the administrator helper) are therefore only offered in installed builds.
const os = require('os');
const path = require('path');

function isPortableRun({ env = process.env, execPath = process.execPath, tmpdir = os.tmpdir() } = {}) {
  if (!env.PORTABLE_EXECUTABLE_FILE) return false;
  return String(execPath).toLowerCase().startsWith(String(tmpdir).toLowerCase() + path.sep);
}

module.exports = { isPortableRun };
