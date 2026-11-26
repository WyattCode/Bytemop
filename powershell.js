'use strict';
// Run a PowerShell script with a JSON input object, without any shell quoting: the script is passed
// as -EncodedCommand and the input travels base64-encoded in an environment variable ($in).
const { spawn: realSpawn } = require('child_process');
const { powershellExe } = require('./syspath');

// PowerShell reports errors as CLIXML ('#< CLIXML <Objs ...>') when stdin/stdout are redirected. Pull the
// human-readable text out of it.
function cleanError(text) {
  if (!text.startsWith('#< CLIXML')) return text;
  const parts = [...text.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => m[1]);
  const msg = parts.join('').replace(/_x000D__x000A_/g, '\n').replace(/_x[0-9A-Fa-f]{4}_/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
  return msg.split('\n')[0] || 'PowerShell error';
}

function runPowerShell(script, input = {}, { spawn = realSpawn, timeoutMs = 60000 } = {}) {
  const full = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ErrorActionPreference='Stop';" +
    "$in=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:BYTEMOP_IN))|ConvertFrom-Json;" + script;
  const encoded = Buffer.from(full, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const p = spawn(powershellExe(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      env: { ...process.env, BYTEMOP_IN: Buffer.from(JSON.stringify(input), 'utf8').toString('base64') },
    });
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { p.kill(); } catch { /* already gone */ } }, timeoutMs);
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error('PowerShell timed out'));
      return code === 0 ? resolve(out.trim()) : reject(new Error(cleanError(err.trim()) || `powershell exited with ${code}`));
    });
  });
}

module.exports = { runPowerShell, cleanError };
