'use strict';
// Full paths of Windows' own tools. Starting 'powershell.exe' or 'schtasks.exe' by bare name makes Windows look in
// the current directory and in every PATH folder first; a planted copy would then run (as administrator, for the
// elevated launch). The full path in System32 avoids that. Falls back to the bare name where SystemRoot is unknown
// (tests, other systems).
const fs = require('fs');
const path = require('path');

function system32(name, env = process.env, exists = fs.existsSync) {
  const root = env.SystemRoot || env.windir;
  if (!root) return name;
  const full = path.join(root, 'System32', name);
  return exists(full) ? full : name;
}

function powershellExe(env = process.env, exists = fs.existsSync) {
  const root = env.SystemRoot || env.windir;
  if (!root) return 'powershell.exe';
  const full = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return exists(full) ? full : 'powershell.exe';
}

module.exports = { system32, powershellExe };
