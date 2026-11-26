'use strict';
// M5 app uninstall. Two jobs:
//   1. list what is installed (desktop programs from the Uninstall registry keys, Store apps from Appx)
//   2. after an app is gone, find the folders it left behind (never touching the registry)
// Pure logic and Windows backend only: no Electron, no deleting. apps-service.js does the actions.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { runPowerShell } = require('./powershell');
const { canonical } = require('./pathsafe');
const { commonName } = require('./certname');

const idOf = (prefix, s) => prefix + crypto.createHash('sha1').update(String(s).toLowerCase()).digest('hex').slice(0, 16);

// ---------- names ----------
// Compare names without case, spaces or punctuation; Unicode letters (e.g. Chinese) are kept.
const normalizeName = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const hasCjk = (s) => /[㐀-鿿豈-﫿]/.test(s);

// Folder names that belong to Windows or to a vendor with many products: never treated as one app's leftover.
const GENERIC = new Set([
  'microsoft', 'windows', 'windowsapps', 'common', 'commonfiles', 'packages', 'programs', 'temp', 'tmp', 'cache', 'caches',
  'google', 'adobe', 'apple', 'intel', 'nvidia', 'amd', 'mozilla', 'oracle', 'java', 'python', 'node', 'nodejs',
  'users', 'default', 'public', 'desktop', 'documents', 'downloads', 'data', 'logs', 'local', 'locallow', 'roaming',
  'system', 'system32', 'drivers', 'software', 'application', 'applications', 'apps', 'app', 'program', 'programfiles',
  'programdata', 'startmenu', 'startup', 'connecteddevicesplatform', 'publishers', 'vendor', 'shared', 'sharedfiles',
  'client', 'server', 'launcher', 'updater', 'installer', 'setup', 'bin', 'engine', 'core', 'tools', 'tool', 'game', 'games', 'studio', 'service', 'services', 'plugins', 'resources',
]);

// Names a folder may carry for one installed app: the full display name and the name without a version tail
// ("Foo 2.1.3 (x64)" -> "Foo"), plus the install folder's own name. Too short or too generic names are dropped.
function nameVariants(name, installLocation) {
  const raw = String(name || '');
  const noParens = raw.replace(/\s*[([].*?[)\]]/g, ' ');
  const noVersion = noParens.replace(/\s+v?\d+(\.\d+)+.*$/i, '').replace(/\b(x64|x86|amd64|64-?bit|32-?bit)\b/gi, '');
  const list = [raw, noParens, noVersion];
  if (installLocation) list.push(path.basename(String(installLocation).replace(/[\\/]+$/, '')));
  const out = new Set();
  for (const v of list) {
    const n = normalizeName(v);
    if (!n || GENERIC.has(n)) continue;
    if (n.length < (hasCjk(n) ? 2 : 4)) continue;
    out.add(n);
  }
  return out;
}

// ---------- listing ----------
const UPDATE_NAME = /^(KB\d{5,}|Security Update for|Update for (Microsoft|Windows)|Hotfix for|Service Pack \d)/i;
const UPDATE_TYPES = new Set(['update', 'hotfix', 'security update', 'update rollup', 'service pack']);
// Things other programs commonly rely on: still removable, but the user is warned.
const SHARED = /redistributable|visual c\+\+|\.net (runtime|desktop|core|framework)|webview2|vcredist|directx|windows (sdk|driver package)|runtime|driver/i;
const HIDDEN_STORE = /^(Microsoft\.Windows\.|Windows\.|MicrosoftWindows\.|Microsoft\.AAD|Microsoft\.AccountsControl|Microsoft\.LockApp|Microsoft\.Win32WebViewHost|Microsoft\.SecHealthUI|Microsoft\.UI\.|Microsoft\.VCLibs|Microsoft\.NET\.|NcsiUwpApp|MicrosoftCorporationII\.WinAppRuntime|1527c705|Microsoft\.(ApplicationCompatibilityEnhancements|DesktopAppInstaller|StorePurchaseApp|WindowsStore|Services\.Store|XboxIdentityProvider))|Extensions?$/i;

function parseDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isFinite(t) ? t : null;
}

// Raw registry rows -> apps the user may uninstall. Components, updates and system entries are dropped.
function parseDesktop(rows) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.name !== 'string' || !r.name.trim() || typeof r.key !== 'string') continue;
    if (Number(r.systemComponent) === 1 || r.parent || Number(r.noRemove) === 1) continue;
    if (UPDATE_TYPES.has(String(r.releaseType || '').toLowerCase()) || UPDATE_NAME.test(r.name)) continue;
    if (!r.uninstall || !String(r.uninstall).trim()) continue;
    const dedupe = normalizeName(r.name) + '|' + (r.version || '') + '|' + normalizeName(r.publisher);
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const kb = Number(r.sizeKB);
    out.push({
      id: idOf('w-', r.key), kind: 'desktop', name: r.name.trim(), publisher: String(r.publisher || '').trim(), version: String(r.version || ''),
      installDate: parseDate(r.installDate), size: Number.isFinite(kb) && kb > 0 ? kb * 1024 : null,
      scope: r.scope === 'user' ? 'user' : 'machine', installLocation: String(r.installLocation || '').trim().replace(/^"|"$/g, ''),
      shared: SHARED.test(r.name), uninstall: String(r.uninstall).trim(), key: r.key,
    });
  }
  return out;
}

// 'Microsoft.BingNews' -> 'Bing News', 'AdvancedMicroDevicesInc-RSXCM' -> 'Advanced Micro Devices Inc-RSXCM'. Only for display.
function friendlyStoreName(name) {
  const base = String(name).split('.').filter(Boolean).pop() || String(name);
  const spaced = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/_/g, ' ').trim();
  return spaced || String(name);
}

function parseStore(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.fullName !== 'string' || !r.fullName || typeof r.name !== 'string') continue;
    if (HIDDEN_STORE.test(r.name)) continue;
    out.push({
      id: idOf('s-', r.fullName), kind: 'store', name: friendlyStoreName(r.name), packageName: r.name, publisher: commonName(r.publisher),
      version: String(r.version || ''), installDate: null, size: null, scope: 'user', installLocation: '', shared: false, fullName: r.fullName,
    });
  }
  return out;
}

// ---------- uninstall command ----------
// Split a registry UninstallString into program and arguments without involving cmd.exe.
// Bare program names are only accepted when they are in System32 (msiexec.exe, rundll32.exe, ...).
function splitCommand(command, env = process.env, exists = (p) => fs.existsSync(p)) {
  let s = String(command || '').trim();
  if (!s) return null;
  s = s.replace(/%([^%]+)%/g, (m, k) => {
    const key = Object.keys(env).find((x) => x.toLowerCase() === k.toLowerCase());
    return key ? env[key] : m;
  });
  let exe;
  let args;
  let m = /^"([^"]+)"\s*(.*)$/s.exec(s);
  if (m) { exe = m[1]; args = m[2]; } else {
    m = /^(.+?\.(?:exe|msc|bat|cmd|com))(?=\s|$)\s*(.*)$/is.exec(s);
    if (!m) {
      // 'msiexec /x {guid}': a bare System32 program name without extension
      const w = /^([A-Za-z0-9_-]+)(?:\s+(.*))?$/s.exec(s);
      if (!w || !env.SystemRoot || !exists(path.join(env.SystemRoot, 'System32', w[1] + '.exe'))) return null;
      m = [s, w[1] + '.exe', w[2] || ''];
    }
    exe = m[1]; args = m[2];
  }
  if (/%/.test(exe)) return null;
  if (!path.isAbsolute(exe)) {
    if (/[\\/]/.test(exe) || !env.SystemRoot) return null;
    const sys = path.join(env.SystemRoot, 'System32', exe);
    if (!exists(sys)) return null;
    exe = sys;
  }
  if (exe.startsWith('\\\\')) return null; // network paths are not run
  args = args.trim();
  // Many entries record 'MsiExec.exe /I{guid}' (the repair/modify dialog). Settings turns that into /X (remove).
  if (path.basename(exe).toLowerCase() === 'msiexec.exe') args = args.replace(/^\/I(\s*\{)/i, '/X$1');
  return { exe, args };
}

// ---------- leftovers ----------
const norm = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
const isUnder = (p, root) => { const a = norm(p); const r = norm(root); return a === r || a.startsWith(r + '\\'); };

// Folders that may hold an app's leftovers (direct children only), and what kind of data lives there.
function leftoverRoots(env) {
  const roots = [];
  const add = (dir, kind, extra = {}) => { if (dir) roots.push({ dir, kind, ...extra }); };
  const join = (a, ...b) => (a ? path.join(a, ...b) : null);
  add(env.APPDATA, 'roaming');
  add(env.LOCALAPPDATA, 'local');
  add(join(env.LOCALAPPDATA, 'Programs'), 'install');
  add(join(env.USERPROFILE, 'AppData', 'LocalLow'), 'local');
  add(env.ProgramData, 'local', { machine: true });
  add(env.ProgramFiles, 'install', { machine: true });
  add(env['ProgramFiles(x86)'], 'install', { machine: true });
  add(join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), 'shortcut', { shortcuts: true });
  add(join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), 'shortcut', { shortcuts: true, machine: true });
  const seen = new Set();
  return roots.filter((r) => { const k = norm(r.dir); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Folders a program's own location must never be (or contain): the user's data, Windows, shared roots.
function forbiddenInstallDirs(env, extra = []) {
  const home = env.USERPROFILE;
  const sub = (n) => (home ? path.join(home, n) : null);
  return {
    // The location may not equal or contain any of these...
    keep: [env.SystemRoot, env.windir, home, home && path.dirname(home), env.SystemDrive && env.SystemDrive + '\\', env.APPDATA, env.LOCALAPPDATA,
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.ProgramData,
      ...extra].filter(Boolean),
    // ...and may not sit inside the user's own document folders.
    zones: ['Documents', 'Desktop', 'Downloads', 'Pictures', 'Music', 'Videos', 'OneDrive'].map(sub).concat(extra).filter(Boolean),
    windows: [env.SystemRoot, env.windir].filter(Boolean),
  };
}

// An install location recorded by an uninstaller is only trusted when it is a real program folder:
// at least two levels below a drive root, not Windows, not a folder holding the user's documents.
function isSafeInstallDir(dir, env = process.env, extraProtected = []) {
  if (typeof dir !== 'string' || !dir || !path.isAbsolute(dir) || dir.startsWith('\\\\')) return false;
  const full = path.resolve(dir);
  const { root } = path.parse(full);
  if (full.slice(root.length).split(/[\\/]+/).filter(Boolean).length < 2) return false;
  const f = forbiddenInstallDirs(env, extraProtected);
  if (f.windows.some((w) => isUnder(full, w))) return false;
  if (f.keep.some((k) => isUnder(k, full))) return false; // equal to, or an ancestor of, a shared folder
  if (f.zones.some((z) => isUnder(full, z))) return false;
  return true;
}

// Size and file count of a folder without following links. `isExcluded` files are left out and counted apart.
async function measure(dir, { isExcluded, maxFiles = 100000 } = {}) {
  const res = { size: 0, count: 0, excluded: 0, truncated: false, mtimeMs: 0 };
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (isExcluded && isExcluded(full)) { res.excluded += 1; continue; }
      let st;
      try { st = await fsp.lstat(full); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { stack.push(full); continue; }
      if (!st.isFile()) continue;
      res.size += st.size;
      res.count += 1;
      if (st.mtimeMs > res.mtimeMs) res.mtimeMs = st.mtimeMs;
      if (res.count >= maxFiles) { res.truncated = true; return res; }
    }
  }
  return res;
}

// Folders (and Start Menu shortcuts) that look like what `app` left behind. Read-only.
//   app: {name, installLocation}
//   others: normalized names of apps that are still installed; a folder carrying one of them is never claimed
//   keepDirs: install folders of apps that are still installed; a candidate equal to, inside or around one is never offered
//   canon: resolves a path to its real long form (8.3 short names, links); injectable for tests
async function findLeftovers(app, { env = process.env, isExcluded, others = new Set(), extraProtected = [], keepDirs = [], maxFiles, canon = canonical } = {}) {
  // The recorded install folder is resolved to its real, long spelling first: a short (8.3) name must not slip past
  // the safety, deny-list and exclusion checks, which compare spelled paths.
  let loc = '';
  if (app.installLocation && typeof app.installLocation === 'string' && path.isAbsolute(app.installLocation) && !app.installLocation.startsWith('\\\\')) {
    loc = path.resolve(await canon(path.resolve(app.installLocation)));
  }
  const locOk = loc && isSafeInstallDir(loc, env, extraProtected);
  const variants = nameVariants(app.name, locOk ? loc : null);
  const found = new Map();
  const blocked = [...keepDirs, ...extraProtected].filter(Boolean);
  const consider = async (full, kind, rootInfo, isDir) => {
    const key = norm(full);
    if (found.has(key)) return;
    if (blocked.some((b) => isUnder(full, b) || isUnder(b, full))) return; // live installs, user folders, Bytemop's own data
    if (isExcluded && isExcluded(full)) return;
    let st;
    try { st = await fsp.lstat(full); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (isDir && !st.isDirectory()) return;
    if (!isDir && !st.isFile()) return;
    const m = isDir ? await measure(full, { isExcluded, maxFiles }) : { size: st.size, count: 1, excluded: 0, truncated: false, mtimeMs: st.mtimeMs };
    const machine = !!rootInfo.machine;
    found.set(key, {
      id: idOf('l-', full), path: full, kind, isDir, size: m.size, count: m.count, truncated: m.truncated, keptByExclusion: m.excluded,
      mtimeMs: m.mtimeMs, machine, root: rootInfo.dir || null,
      // Roaming data often holds settings, profiles or save games: never ticked by default.
      defaultSelected: !m.truncated && kind !== 'roaming' && !machine && rootInfo.known !== false,
    });
  };

  // 1. the folder the uninstaller itself recorded
  if (locOk) {
    const roots = leftoverRoots(env);
    const known = roots.some((r) => r.kind === 'install' && isUnder(loc, r.dir));
    const machine = roots.some((r) => r.machine && isUnder(loc, r.dir));
    await consider(loc, 'install', { machine, known, dir: null }, true);
  }
  // 2. direct children of the usual data folders whose name is this app's name
  if (variants.size) {
    for (const r of leftoverRoots(env)) {
      let entries;
      try { entries = await fsp.readdir(r.dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const isLnk = r.shortcuts && e.isFile() && /\.lnk$/i.test(e.name);
        if (!e.isDirectory() && !isLnk) continue;
        const n = normalizeName(isLnk ? e.name.replace(/\.lnk$/i, '') : e.name);
        if (!variants.has(n) || others.has(n)) continue;
        await consider(path.join(r.dir, e.name), r.kind, r, !isLnk);
      }
    }
  }
  return [...found.values()].sort((a, b) => b.size - a.size);
}

// ---------- leftovers that need administrator rights ----------
// Top-level folders of the machine-wide roots that belong to Windows or to shared components. The elevated
// helper refuses these, whatever name an app claims; a folder owned by TrustedInstaller is refused as well.
const MACHINE_DENIED = new Set([
  'commonfiles', 'internetexplorer', 'dotnet', 'referenceassemblies', 'packagecache', 'packages', 'windowsapps', 'modifiablewindowsapps',
  'msbuild', 'uninstallinformation', 'usoprivate', 'usoshared', 'ssh', 'regid', 'oracle', 'java',
]);

// Is this machine-wide leftover off limits for the elevated helper? 'c' is a candidate from findLeftovers.
function machineDenied(c, env) {
  // The most specific root wins: the common Start Menu lives inside ProgramData, but its entries are judged by their own name.
  const root = leftoverRoots(env).filter((r) => r.machine && isUnder(c.path, r.dir)).sort((a, b) => b.dir.length - a.dir.length)[0];
  if (!root) return true; // not under a machine-wide root at all
  const rel = path.relative(path.resolve(root.dir), path.resolve(c.path));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return true;
  const top = normalizeName(rel.split(path.sep)[0].replace(/\.lnk$/i, ''));
  return /^(windows|microsoft|regid)/.test(top) || MACHINE_DENIED.has(top) || GENERIC.has(top);
}

// Is the folder owned by Windows itself (TrustedInstaller)? Unknown owner counts as yes: fail closed.
async function isSystemOwned(p, run) {
  try {
    const out = await run('(Get-Acl -LiteralPath $in.path).Owner', { path: p });
    return !out || /trustedinstaller/i.test(out);
  } catch { return true; }
}

// ---------- Windows backend ----------
function windowsAppsBackend({ spawn } = {}) {
  const run = (script, input, timeoutMs = 60000) => runPowerShell(script, input, { ...(spawn ? { spawn } : {}), timeoutMs });
  const toList = (txt) => { if (!txt) return []; const v = JSON.parse(txt); return Array.isArray(v) ? v : [v]; };
  return {
    async desktop() {
      const script = `
$out=@()
$spots=@(
  @{hive='HKLM';path='SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';scope='machine'},
  @{hive='HKLM';path='SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall';scope='machine'},
  @{hive='HKCU';path='Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';scope='user'}
)
foreach($h in $spots){
  $base= if($h.hive -eq 'HKLM'){[Microsoft.Win32.Registry]::LocalMachine}else{[Microsoft.Win32.Registry]::CurrentUser}
  $rk=$base.OpenSubKey($h.path); if(-not $rk){continue}
  foreach($sn in $rk.GetSubKeyNames()){
    $k=$null
    try{
      $k=$rk.OpenSubKey($sn); if(-not $k){continue}
      $name=$k.GetValue('DisplayName'); if(-not $name){continue}
      $out+=[pscustomobject]@{
        key=($h.hive+'\\'+$h.path+'\\'+$sn); scope=$h.scope; name=[string]$name; publisher=[string]$k.GetValue('Publisher');
        version=[string]$k.GetValue('DisplayVersion'); installDate=[string]$k.GetValue('InstallDate'); installLocation=[string]$k.GetValue('InstallLocation');
        uninstall=[string]$k.GetValue('UninstallString'); sizeKB=$k.GetValue('EstimatedSize'); systemComponent=$k.GetValue('SystemComponent');
        parent=[string]$k.GetValue('ParentKeyName'); releaseType=[string]$k.GetValue('ReleaseType'); noRemove=$k.GetValue('NoRemove')
      }
    }catch{} finally{ if($k){$k.Close()} }
  }
  $rk.Close()
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3`;
      return toList(await run(script, {}));
    },

    async store() {
      const script = `
$out=@()
foreach($p in @(Get-AppxPackage)){
  if($p.IsFramework -or $p.IsResourcePackage -or $p.NonRemovable -or $p.SignatureKind -eq 'System'){continue}
  $out+=[pscustomobject]@{fullName=$p.PackageFullName;name=$p.Name;publisher=$p.Publisher;version=[string]$p.Version}
}
ConvertTo-Json -InputObject @($out) -Compress`;
      return toList(await run(script, {}, 90000));
    },

    // Start the app's own uninstaller through the shell, so Windows can show its UAC prompt when it needs one.
    async launch({ exe, args, cwd }) {
      const script = `
$p=@{FilePath=$in.exe}
if($in.args){$p.ArgumentList=$in.args}
if($in.cwd){$p.WorkingDirectory=$in.cwd}
Start-Process @p`;
      await run(script, { exe, args: args || '', cwd: cwd || '' }, 30000);
    },

    async removeStore(fullName) {
      await run('Remove-AppxPackage -Package $in.fullName', { fullName }, 180000);
    },
  };
}

module.exports = {
  normalizeName, nameVariants, parseDesktop, parseStore, splitCommand, leftoverRoots, isSafeInstallDir, measure, findLeftovers,
  windowsAppsBackend, idOf, GENERIC, isUnder, norm, machineDenied, isSystemOwned, friendlyStoreName,
};
