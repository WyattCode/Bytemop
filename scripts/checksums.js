'use strict';
// Write SHA-256 checksums for the build outputs in dist/ to dist/SHA256SUMS.txt, so downloaders can verify them.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dist = path.join(__dirname, '..', 'dist');
const files = fs.readdirSync(dist).filter((f) => /\.(exe|zip|msi)$/i.test(f) && !/uninstaller/i.test(f)).sort();
if (!files.length) { console.error('no build outputs in dist/'); process.exit(1); }
const lines = files.map((f) => {
  const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(dist, f))).digest('hex');
  return `${h}  ${f}`;
});
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
