'use strict';
// Can this file safely go to the Recycle Bin? Electron's shell.trashItem asks Windows to recycle it
// without a confirmation dialog, and Windows deletes for good (silently) when the drive has no Recycle
// Bin (removable, network) or the file is bigger than the bin allows. So we refuse those cases up front.
const path = require('path');
const fsp = require('fs').promises;

// Windows' default Recycle Bin limit is about 10% of the drive; half of that leaves room for what is
// already in it and for people who lowered the limit.
const DEFAULT_MAX_FRACTION = 0.05;

function createCanTrash({ fixedDrives, statfs = (p) => fsp.statfs(p), maxFraction = DEFAULT_MAX_FRACTION }) {
  let cache = null;
  return async function canTrash(file, size) {
    const root = path.parse(path.resolve(file)).root; // 'C:\' or '\\server\share\'
    if (!/^[a-z]:\\$/i.test(root)) return { ok: false, reason: 'no-recycle-bin' };
    let drives;
    try { cache = cache || fixedDrives(); drives = await cache; } catch { cache = null; return { ok: false, reason: 'no-recycle-bin' }; }
    if (!drives.has(root[0].toUpperCase())) return { ok: false, reason: 'no-recycle-bin' };
    try {
      const s = await statfs(root);
      if (size > s.blocks * s.bsize * maxFraction) return { ok: false, reason: 'too-big' };
    } catch { return { ok: false, reason: 'no-recycle-bin' }; }
    return { ok: true };
  };
}

// Letters of all fixed (internal) drives, via PowerShell.
async function windowsFixedDriveLetters(runPowerShell) {
  const out = await runPowerShell("[IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' } | ForEach-Object { $_.Name.Substring(0,1) }");
  return new Set(out.split(/\s+/).filter(Boolean).map((x) => x.toUpperCase()));
}

// Fixed drives whose Recycle Bin really keeps files. A drive set to "Don't move files to the Recycle Bin"
// (BitBucket\Volume\{guid}\NukeOnDelete = 1), or the NoRecycleFiles policy, deletes for good: trashItem would
// be a silent permanent delete there, so those drives are left out.
async function windowsFixedDrives(runPowerShell) {
  const script = `
$nuke=@{}
$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\BitBucket\\Volume'
if(Test-Path $k){ Get-ChildItem $k | ForEach-Object { if((Get-ItemProperty $_.PSPath).NukeOnDelete -eq 1){ $nuke[$_.PSChildName.ToUpper()]=1 } } }
$pol=0
try{ $pol=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer' -ErrorAction Stop).NoRecycleFiles }catch{}
try{ if((Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer' -ErrorAction Stop).NoRecycleFiles -eq 1){ $pol=1 } }catch{}
if($pol -eq 1){ return }
Get-CimInstance Win32_Volume | Where-Object { $_.DriveType -eq 3 -and $_.DriveLetter } | ForEach-Object {
  $g=($_.DeviceID -replace '^\\\\\\?\\\\Volume','' -replace '\\\\$','').ToUpper()
  if(-not $nuke[$g]){ $_.DriveLetter.Substring(0,1) }
}`;
  const out = await runPowerShell(script);
  return new Set(out.split(/\s+/).filter(Boolean).map((x) => x.toUpperCase()));
}

module.exports = { createCanTrash, windowsFixedDrives, windowsFixedDriveLetters, DEFAULT_MAX_FRACTION };
