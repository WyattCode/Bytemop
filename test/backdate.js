'use strict';
// Make a file look old to the cleaner. The age rule counts from the newer of "modified" and "created" (an archive
// unpacked a second ago keeps its old modified time), so tests must set the creation time as well; Node cannot do
// that, PowerShell can. One call per file is slow (about 0.4 s), so batch with backdateAll when there are many.
const { execFileSync } = require('child_process');

const TICKS_AT_EPOCH = 621355968000000000n; // .NET ticks (100 ns) at 1970-01-01

function backdateAll(files, date) {
  const ticks = BigInt(date.getTime()) * 10000n + TICKS_AT_EPOCH;
  const script = '$d=[DateTime]::new(' + ticks + ',[DateTimeKind]::Utc);foreach($p in ($env:BM_FILES -split "\\|")){$f=Get-Item -LiteralPath $p -Force;$f.CreationTimeUtc=$d;$f.LastWriteTimeUtc=$d}';
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, BM_FILES: files.join('|') }, windowsHide: true });
}

const backdate = (file, date) => backdateAll([file], date);

module.exports = { backdate, backdateAll };
