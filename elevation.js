'use strict';
// Unelevated side of the admin helper. The app never runs as administrator: when an admin-only
// rule is chosen it starts ONE short-lived elevated helper (UAC prompt), talks to it over a
// private named pipe, and the helper exits when the job is done.
//
// Trust model: the job carries only rule ids / a run id, never a path. The helper loads the rules
// that ship with the app and re-validates everything itself (see helper.js).
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { quoteWinArg } = require('./winquote');
const { powershellExe } = require('./syspath');

const HELPER_FLAG = '--bytemop-helper';
const DENIED_EXIT_CODE = 2;

function pipeName() {
  const id = crypto.randomBytes(12).toString('hex');
  return process.platform === 'win32' ? `\\\\.\\pipe\\bytemop-${id}` : `/tmp/bytemop-${id}.sock`;
}

const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";
// Start-Process joins -ArgumentList items with spaces, so an item with a space (e.g. a project path) must carry its own quotes.
const winArg = quoteWinArg;

// Launch the helper through UAC. Resolves {ok:true} once started, {denied:true} if the user
// declined the prompt, or {error}. `exe` and `args` identify this app (see main.js).
function buildLaunchScript({ exe, args }) {
  return `try { Start-Process -FilePath ${psQuote(exe)} -ArgumentList @(${args.map((a) => psQuote(winArg(a))).join(',')}) -Verb RunAs -WindowStyle Hidden -ErrorAction Stop; exit 0 } ` +
    `catch { $b = $_.Exception.GetBaseException(); if ($_.Exception.Message -match 'canceled by the user|cancelled by the user' -or ($b -is [System.ComponentModel.Win32Exception] -and $b.NativeErrorCode -eq 1223)) { exit ${DENIED_EXIT_CODE} } else { [Console]::Error.WriteLine($_.Exception.Message); exit 1 } }`;
}

function launchElevated({ exe, args }) {
  const script = buildLaunchScript({ exe, args });
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    let err = '';
    const p = spawn(powershellExe(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ error: e.message }));
    p.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else if (code === DENIED_EXIT_CODE) resolve({ denied: true });
      else resolve({ error: err.trim() || `powershell exited with ${code}` });
    });
  });
}

// Run one job in the elevated helper. `launch({pipe, token})` starts the helper (injectable for
// tests). Resolves {status:'ok', result} | {status:'denied'} | {status:'timeout'} | {status:'failed', error}.
function runElevated(job, { launch, connectTimeoutMs = 120000, jobTimeoutMs = 30 * 60 * 1000, caller = process.env.USERPROFILE } = {}) {
  // Say whose profile this is: if the UAC prompt was answered with another administrator's credentials the helper
  // runs in a different profile (other data folder, other registry hive) and must refuse (see helper.js).
  job = { ...job, caller };
  const pipe = pipeName();
  const token = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve) => {
    let done = false;
    let connectTimer = null;
    let jobTimer = null;
    const sockets = new Set();
    let owner = null; // the one connection that said hello with the token: nobody else gets the job
    const server = net.createServer();

    const finish = (outcome) => {
      if (done) return;
      done = true;
      clearTimeout(connectTimer);
      clearTimeout(jobTimer);
      for (const s of sockets) s.destroy();
      server.close();
      resolve(outcome);
    };

    server.on('connection', (sock) => {
      sockets.add(sock);
      sock.setEncoding('utf8');
      let buf = '';
      let authed = false;
      sock.on('error', () => {});
      sock.on('close', () => { if (authed && !done) finish({ status: 'failed', error: 'helper disconnected before finishing' }); });
      sock.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          let m;
          try { m = JSON.parse(line); } catch { continue; }
          if (!m || typeof m !== 'object') continue; // 'null', numbers, strings: ignore
          if (!authed) {
            if (m.type === 'hello' && m.token === token && !owner) {
              owner = sock;
              authed = true;
              clearTimeout(connectTimer);
              jobTimer = setTimeout(() => finish({ status: 'timeout' }), jobTimeoutMs);
              sock.write(JSON.stringify({ type: 'job', job }) + '\n');
            } else { sock.destroy(); }
            continue;
          }
          if (m.type === 'result') finish({ status: 'ok', result: m.result });
          else if (m.type === 'error') finish({ status: 'failed', error: String(m.error) });
        }
      });
    });

    server.on('error', (e) => finish({ status: 'failed', error: e.message }));
    server.listen(pipe, async () => {
      connectTimer = setTimeout(() => finish({ status: 'timeout' }), connectTimeoutMs);
      let launched;
      try { launched = await launch({ pipe, token }); } catch (e) { launched = { error: e.message }; }
      if (launched && launched.denied) finish({ status: 'denied' });
      else if (launched && launched.error) finish({ status: 'failed', error: launched.error });
    });
  });
}

module.exports = { runElevated, launchElevated, buildLaunchScript, pipeName, HELPER_FLAG };
