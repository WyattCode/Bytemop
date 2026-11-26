'use strict';
// M4 startup manager. Lists what Windows starts at sign-in and lets the user turn items off/on.
// It never deletes anything: "disable" is the same per-user StartupApproved flag Task Manager uses.
//   HKCU\...\Explorer\StartupApproved\{Run|Run32|StartupFolder}\<name> = 12 bytes
//   byte 0: 02 = enabled, 03 = disabled (low bit set = disabled); bytes 4..11: FILETIME of the change
const fs = require('fs');
const path = require('path');
const { expandEnv } = require('./cleaner');
const { runPowerShell } = require('./powershell');
const { commonName } = require('./certname');

const HKCU = 'HKEY_CURRENT_USER';
const HKLM = 'HKEY_LOCAL_MACHINE';
const CV = 'Software\\Microsoft\\Windows\\CurrentVersion';

const DEFAULT_CONFIG = {
  runSources: [
    { id: 'hkcu-run', key: `${HKCU}\\${CV}\\Run`, approved: 'Run', scope: 'user' },
    { id: 'hklm-run', key: `${HKLM}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run`, approved: 'Run', scope: 'machine' },
    { id: 'hklm-run32', key: `${HKLM}\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run`, approved: 'Run32', scope: 'machine' },
  ],
  folderSources: [
    { id: 'folder-user', dir: '%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup', scope: 'user' },
    { id: 'folder-common', dir: '%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup', scope: 'machine' },
  ],
  approvedUser: `${HKCU}\\${CV}\\Explorer\\StartupApproved`,
  approvedMachine: `${HKLM}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved`,
};

const FILETIME_EPOCH_MS = 11644473600000n;

// 8-byte little-endian FILETIME as hex.
function filetimeHex(ms) {
  let v = (BigInt(Math.trunc(ms)) + FILETIME_EPOCH_MS) * 10000n;
  let out = '';
  for (let i = 0; i < 8; i++) { out += Number(v & 0xffn).toString(16).padStart(2, '0'); v >>= 8n; }
  return out;
}

const ENABLED_HEX = '020000000000000000000000';
const disabledHex = (ms) => '03000000' + filetimeHex(ms);
// Odd first byte = disabled (Windows writes 03; some tools write 01).
const isDisabledHex = (hex) => typeof hex === 'string' && hex.length >= 2 && (parseInt(hex.slice(0, 2), 16) & 1) === 1;

// Best-effort program path from a Run command line ("C:\x y\a.exe" /arg, C:\a.exe -b, %SystemRoot%\...).
function extractExe(command, env = process.env) {
  if (typeof command !== 'string') return null;
  const expanded = expandEnv(command.trim(), env) || command.trim();
  let m = expanded.match(/^"([^"]+)"/);
  if (m) return m[1];
  m = expanded.match(/^(.+?\.(?:exe|bat|cmd|com|lnk|msc|vbs|cpl))(?=[\s,]|$)/i); // 'app.exe,-3' (icon index) ends at the comma
  if (m) return m[1];
  const first = expanded.split(/\s+/)[0];
  return first || null;
}

function createStartupManager({ backend, config = DEFAULT_CONFIG, env = process.env, now = () => Date.now(), onChange = () => {} }) {
  const approvedKey = (base, sub) => `${base}\\${sub}`;
  const inspectCache = new Map();

  const APPROVED_SUBS = ['Run', 'Run32', 'StartupFolder'];

  // One backend call (one PowerShell start) reads every Run key and every StartupApproved key.
  async function readAll() {
    const approvedKeys = [config.approvedUser, config.approvedMachine].flatMap((b) => APPROVED_SUBS.map((s) => approvedKey(b, s)));
    const rows = await backend.readValues([...config.runSources.map((s) => s.key), ...approvedKeys]);
    const approved = { user: new Map(), machine: new Map() };
    for (const r of rows) {
      const side = r.key.startsWith(config.approvedUser + '\\') ? 'user' : r.key.startsWith(config.approvedMachine + '\\') ? 'machine' : null;
      if (side) approved[side].set(r.key + '\u0000' + r.name.toLowerCase(), r.data);
    }
    return { rows, approved };
  }

  function stateFor(approved, sub, name) {
    const k = approvedKey(config.approvedUser, sub) + '\u0000' + name.toLowerCase();
    const mk = approvedKey(config.approvedMachine, sub) + '\u0000' + name.toLowerCase();
    const hex = approved.user.has(k) ? approved.user.get(k) : approved.machine.get(mk);
    return hex === undefined ? true : !isDisabledHex(hex);
  }

  // Every autostart entry, without program details (cheap, no process spawn per entry).
  async function rawEntries() {
    const { rows: runRows, approved } = await readAll();
    const entries = [];
    for (const src of config.runSources) {
      for (const r of runRows.filter((x) => x.key === src.key)) {
        entries.push({
          id: `${src.id}|${r.name}`, name: r.name, source: src.id, scope: src.scope, kind: 'registry',
          command: String(r.data), exePath: extractExe(String(r.data), env),
          enabled: stateFor(approved, src.approved, r.name), approvedSub: src.approved,
        });
      }
    }
    for (const src of config.folderSources) {
      const dir = expandEnv(src.dir, env);
      if (!dir) continue;
      let files = [];
      try { files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.toLowerCase() !== 'desktop.ini'); } catch { continue; }
      for (const f of files) {
        const full = path.join(dir, f.name);
        entries.push({
          id: `${src.id}|${f.name}`, name: f.name.replace(/\.[^.]+$/, ''), source: src.id, scope: src.scope, kind: 'folder',
          fileName: f.name, command: full, exePath: /\.(exe|bat|cmd|com)$/i.test(f.name) ? full : null,
          enabled: stateFor(approved, 'StartupFolder', f.name), approvedSub: 'StartupFolder',
        });
      }
    }
    return entries;
  }

  // Entries plus program details (signature, publisher, file exists) from backend.inspect.
  async function list() {
    const entries = await rawEntries();
    const paths = [...new Set(entries.map((e) => e.exePath).filter(Boolean))];
    // Signature checks are the slow part; a program's details do not change while the app is open.
    const fresh = paths.filter((p) => !inspectCache.has(p.toLowerCase()));
    if (fresh.length && backend.inspect) {
      for (const i of await backend.inspect(fresh)) inspectCache.set(i.path.toLowerCase(), i);
    }
    const byPath = inspectCache;
    return entries.map((e) => {
      const i = e.exePath ? byPath.get(e.exePath.toLowerCase()) : null;
      const exists = i ? i.exists : null;
      const signature = !i || !i.exists ? null : i.status === 'Valid' ? 'valid' : i.status === 'NotSigned' ? 'unsigned' : 'invalid';
      const publisher = i && i.exists ? (i.company || commonName(i.signer) || '') : '';
      const { approvedSub, ...rest } = e;
      return { ...rest, exists, signature, publisher, product: i && i.exists ? i.product || '' : '' };
    });
  }

  // Turn one entry on/off. The id must name an entry that exists right now; nothing else is trusted.
  async function setEnabled(id, enabled) {
    const entry = (await rawEntries()).find((e) => e.id === String(id));
    if (!entry) return { ok: false, error: 'not-found' };
    const valueName = entry.kind === 'folder' ? entry.fileName : entry.name;
    const key = approvedKey(config.approvedUser, entry.approvedSub);
    await backend.writeBinary(key, valueName, enabled ? ENABLED_HEX : disabledHex(now()));
    onChange({ id: entry.id, name: entry.name, source: entry.source, enabled: !!enabled });
    return { ok: true, id: entry.id, enabled: !!enabled };
  }

  return { list, setEnabled, rawEntries };
}

// ---------- real Windows backend (PowerShell, Unicode-safe, no shell quoting) ----------
function windowsBackend({ spawn } = {}) {
  const run = (script, input) => runPowerShell(script, input, spawn ? { spawn } : {});

  const toList = (txt) => {
    if (!txt) return [];
    const v = JSON.parse(txt);
    return Array.isArray(v) ? v : [v];
  };

  return {
    async readValues(keys) {
      const script = `
$out=@()
foreach($k in @($in.keys)){
  $i=$k.IndexOf('\\'); $hive=$k.Substring(0,$i); $sub=$k.Substring($i+1)
  $root= if($hive -eq 'HKEY_CURRENT_USER'){[Microsoft.Win32.Registry]::CurrentUser}else{[Microsoft.Win32.Registry]::LocalMachine}
  $rk=$root.OpenSubKey($sub); if(-not $rk){continue}
  foreach($n in $rk.GetValueNames()){
    if($n -eq ''){continue}
    $kind=$rk.GetValueKind($n).ToString()
    $v=$rk.GetValue($n,$null,[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if($v -is [byte[]]){$v=(($v|ForEach-Object{$_.ToString('x2')}) -join '')}
    elseif($v -is [string[]]){$v=$v -join ' '}
    $out+=[pscustomobject]@{key=$k;name=$n;kind=$kind;data=[string]$v}
  }
  $rk.Close()
}
ConvertTo-Json -InputObject @($out) -Compress`;
      return toList(await run(script, { keys }));
    },

    async writeBinary(key, name, hex) {
      const script = `
$bytes=[byte[]]::new($in.hex.Length/2)
for($i=0;$i -lt $bytes.Length;$i++){$bytes[$i]=[Convert]::ToByte($in.hex.Substring(2*$i,2),16)}
$i=$in.key.IndexOf('\\'); $hive=$in.key.Substring(0,$i); $sub=$in.key.Substring($i+1)
$root= if($hive -eq 'HKEY_CURRENT_USER'){[Microsoft.Win32.Registry]::CurrentUser}else{[Microsoft.Win32.Registry]::LocalMachine}
$rk=$root.CreateSubKey($sub)
$rk.SetValue($in.name,$bytes,[Microsoft.Win32.RegistryValueKind]::Binary)
$rk.Close()`;
      if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) throw new Error('invalid hex');
      await run(script, { key, name, hex });
    },

    // Existence, signature and publisher for a batch of program paths.
    async inspect(paths) {
      const script = `
$out=@()
foreach($p in @($in.paths)){
  try{
    $full=$p
    if(-not [IO.Path]::IsPathRooted($p)){
      $c=Get-Command $p -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
      if($c){$full=$c.Source}
    }
    if(-not [IO.File]::Exists($full)){ $out+=[pscustomobject]@{path=$p;exists=$false}; continue }
    $status='UnknownError'; $signer=''; $company=''; $product=''
    try{ $s=Get-AuthenticodeSignature -LiteralPath $full; $status=$s.Status.ToString(); if($s.SignerCertificate){$signer=$s.SignerCertificate.Subject} }catch{}
    try{ $vi=(Get-Item -LiteralPath $full).VersionInfo; $company=[string]$vi.CompanyName; $product=[string]$vi.ProductName }catch{}
    $out+=[pscustomobject]@{path=$p;exists=$true;status=$status;signer=$signer;company=$company;product=$product}
  }catch{ $out+=[pscustomobject]@{path=$p;exists=$false} }
}
ConvertTo-Json -InputObject @($out) -Compress`;
      return toList(await run(script, { paths }));
    },
  };
}

module.exports = { createStartupManager, windowsBackend, extractExe, filetimeHex, isDisabledHex, ENABLED_HEX, disabledHex, DEFAULT_CONFIG };
