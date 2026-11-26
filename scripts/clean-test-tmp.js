'use strict';
// The test suite makes throw-away folders named bytemop-<what>-<6 random characters> in the temp folder and does not
// delete them. This removes the ones older than 10 minutes (so a test run that is still going is left alone).
//   node scripts/clean-test-tmp.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = os.tmpdir();
const cutoff = Date.now() - 10 * 60 * 1000;
let removed = 0;
for (const name of fs.readdirSync(root)) {
  if (!/^bytemop-[a-z0-9]+-[A-Za-z0-9]{6}$/.test(name)) continue;
  const dir = path.join(root, name);
  try {
    if (fs.statSync(dir).mtimeMs > cutoff) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed += 1;
  } catch { /* in use */ }
}
console.log('removed', removed, 'old test folders from', root);
