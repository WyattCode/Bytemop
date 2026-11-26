'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { runElevated } = require('../elevation');
const { backdate } = require('./backdate');
const { executeJob, makeAllow } = require('../helper');
const { loadPacks } = require('../rule-engine');
const { createService } = require('../clean-service');

const allRules = loadPacks(path.join(__dirname, '..', 'rules')).rules;
const ENTRY = path.join(__dirname, 'fixtures', 'helper-entry.js');

function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bytemop-elev-'));
  const sysRoot = path.join(base, 'Windows');
  const local = path.join(base, 'Local');
  const winTemp = path.join(sysRoot, 'Temp');
  fs.mkdirSync(winTemp, { recursive: true });
  fs.mkdirSync(local, { recursive: true });
  const env = { SystemRoot: sysRoot, LOCALAPPDATA: local, TEMP: path.join(local, 'Temp') };
  const old = (name, content) => {
    const p = path.join(winTemp, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    const t = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    backdate(p, t);
    return p;
  };
  return { base, env, winTemp, old, dataDir: path.join(local, 'Bytemop') };
}

// Launch the helper as a normal child process instead of through UAC.
const childLauncher = (env) => ({ pipe, token }) => {
  const p = spawn(process.execPath, [ENTRY, '--bytemop-helper', `--pipe=${pipe}`, `--token=${token}`], {
    env: { ...process.env, BYTEMOP_TEST_ENV: JSON.stringify(env) }, stdio: 'ignore',
  });
  p.on('error', () => {});
  return Promise.resolve({ ok: true });
};

test('end to end: helper cleans an admin-only rule into quarantine, then restores it', async () => {
  const s = sandbox();
  const f = s.old('junk.tmp', 'hello');
  const out = await runElevated({ type: 'clean', ruleIds: ['win-temp'], mode: 'quarantine' }, { launch: childLauncher(s.env), connectTimeoutMs: 20000 });
  assert.strictEqual(out.status, 'ok', JSON.stringify(out));
  assert.strictEqual(out.result.totals.deleted, 1);
  assert.ok(out.result.runId);
  assert.ok(!fs.existsSync(f));

  // The normal (unelevated) service can see the run and knows it is an elevated one.
  const svc = createService({ dataDir: s.dataDir, rules: allRules });
  const [run] = await svc.runs();
  assert.strictEqual(run.elevated, true);
  assert.strictEqual(run.id, out.result.runId);

  const back = await runElevated({ type: 'restore', runId: run.id }, { launch: childLauncher(s.env), connectTimeoutMs: 20000 });
  assert.strictEqual(back.status, 'ok', JSON.stringify(back));
  assert.strictEqual(back.result.restored, 1);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'hello');
});

test('elevated scan reports what only an administrator can see, without deleting', async () => {
  const s = sandbox();
  const f = s.old('junk.tmp', 'hello');
  const out = await runElevated({ type: 'scan' }, { launch: childLauncher(s.env), connectTimeoutMs: 20000 });
  assert.strictEqual(out.status, 'ok', JSON.stringify(out));
  assert.deepStrictEqual(out.result.map((r) => [r.id, r.count, r.bytes]), [['win-temp', 1, 5]]);
  assert.ok(fs.existsSync(f));
});

test('the user declining UAC is reported as denied and nothing is touched', async () => {
  const s = sandbox();
  const f = s.old('junk.tmp', 'x');
  const out = await runElevated({ type: 'clean', ruleIds: ['win-temp'] }, { launch: async () => ({ denied: true }) });
  assert.deepStrictEqual(out, { status: 'denied' });
  assert.ok(fs.existsSync(f));
});

test('launch errors and a helper that never connects are reported', async () => {
  const a = await runElevated({ type: 'clean', ruleIds: ['win-temp'] }, { launch: async () => ({ error: 'boom' }) });
  assert.deepStrictEqual(a, { status: 'failed', error: 'boom' });
  const b = await runElevated({ type: 'clean', ruleIds: ['win-temp'] }, { launch: async () => ({ ok: true }), connectTimeoutMs: 150 });
  assert.deepStrictEqual(b, { status: 'timeout' });
});

test('a client with the wrong token never receives the job', async () => {
  let received = '';
  const out = await runElevated({ type: 'clean', ruleIds: ['win-temp'] }, {
    connectTimeoutMs: 600,
    launch: ({ pipe }) => new Promise((resolve) => {
      const sock = net.connect(pipe);
      sock.setEncoding('utf8');
      sock.on('data', (d) => { received += d; });
      sock.on('connect', () => sock.write(JSON.stringify({ type: 'hello', token: 'wrong' }) + '\n'));
      sock.on('error', () => {});
      resolve({ ok: true });
    }),
  });
  assert.strictEqual(out.status, 'timeout');
  assert.strictEqual(received, '');
});

test('a helper that drops the connection mid-job is a failure, not a hang', async () => {
  const out = await runElevated({ type: 'clean', ruleIds: ['win-temp'] }, {
    connectTimeoutMs: 5000,
    launch: ({ pipe, token }) => new Promise((resolve) => {
      const sock = net.connect(pipe);
      sock.on('connect', () => sock.write(JSON.stringify({ type: 'hello', token }) + '\n'));
      sock.on('data', () => sock.destroy());
      sock.on('error', () => {});
      resolve({ ok: true });
    }),
  });
  assert.strictEqual(out.status, 'failed');
});

test('the helper only accepts admin-only rules from the bundled set', async () => {
  const s = sandbox();
  const opts = { allRules, env: s.env };
  await assert.rejects(executeJob({ type: 'clean', ruleIds: ['user-temp'] }, opts), /no administrator rules/);
  await assert.rejects(executeJob({ type: 'clean', ruleIds: ['../../evil', 42] }, opts), /no administrator rules/);
  await assert.rejects(executeJob({ type: 'clean', ruleIds: 'win-temp' }, opts), /no administrator rules/);
  await assert.rejects(executeJob({ type: 'format-c' }, opts), /unknown job type/);
  await assert.rejects(executeJob(null, opts), /invalid job/);
  // a path smuggled into the job is simply ignored: only the bundled rule's own target is cleaned
  const keep = path.join(s.base, 'precious.txt');
  fs.writeFileSync(keep, 'x');
  const f = s.old('a.tmp', 'a');
  const r = await executeJob({ type: 'clean', ruleIds: ['win-temp'], mode: 'permanent', path: keep, targets: [{ path: keep }] }, opts);
  assert.strictEqual(r.totals.deleted, 1);
  assert.ok(fs.existsSync(keep));
  assert.ok(!fs.existsSync(f));
});

test('helper restore refuses runs it did not create and malformed run ids', async () => {
  const s = sandbox();
  const opts = { allRules, env: s.env };
  // A normal (non-elevated) run made by the user's own service
  const userFile = path.join(s.base, 'u.txt');
  fs.writeFileSync(userFile, 'u');
  const svc = createService({ dataDir: s.dataDir, rules: allRules });
  const run = await svc.quarantine.begin({ rules: ['user-temp'] });
  await svc.quarantine.moveFile(run, userFile, 1, 'user-temp', 0);
  await svc.quarantine.commit(run);
  await assert.rejects(executeJob({ type: 'restore', runId: run.id }, opts), /not created by the administrator helper/);
  await assert.rejects(executeJob({ type: 'restore', runId: '..\\..\\Windows' }, opts), /invalid run id/);
  await assert.rejects(executeJob({ type: 'restore', runId: 'nope' }, opts), /run not found/);
  assert.ok(!fs.existsSync(userFile), 'refused restore leaves the file quarantined');
});

test('a tampered journal cannot make the helper restore outside the admin folders', async () => {
  const s = sandbox();
  const f = s.old('junk.tmp', 'hello');
  const opts = { allRules, env: s.env };
  const out = await executeJob({ type: 'clean', ruleIds: ['win-temp'], mode: 'quarantine' }, opts);
  const journal = path.join(s.dataDir, 'quarantine', out.runId, 'journal.jsonl');
  const victim = path.join(s.base, 'Windows', 'System32', 'evil.dll');
  const line = JSON.parse(fs.readFileSync(journal, 'utf8').trim());
  fs.writeFileSync(journal, JSON.stringify({ ...line, orig: victim }) + '\n');
  const r = await executeJob({ type: 'restore', runId: out.runId }, opts);
  assert.strictEqual(r.restored, 0);
  assert.strictEqual(r.failed, 1);
  assert.ok(!fs.existsSync(victim));
  assert.ok(!fs.existsSync(f));
});

test('makeAllow accepts only paths inside admin targets', () => {
  const admin = allRules.filter((r) => r.requiresAdmin);
  const env = { SystemRoot: 'C:\\Windows' };
  const allow = makeAllow(admin, env);
  assert.ok(allow('C:\\Windows\\Temp\\a.tmp'));
  assert.ok(allow('c:\\windows\\temp\\sub\\a.tmp'));
  assert.ok(!allow('C:\\Windows\\System32\\x.dll'));
  assert.ok(!allow('C:\\Windows\\Temp\\..\\System32\\x.dll'));
  assert.ok(!allow('C:\\Windows\\TempEvil\\x'));
  assert.ok(!allow(undefined));
});

test('the UAC launch script is valid PowerShell even with spaces and quotes in paths', { skip: process.platform !== 'win32' }, () => {
  const { buildLaunchScript } = require('../elevation');
  const script = buildLaunchScript({ exe: "C:\\Program Files\\Byte'mop\\Bytemop.exe", args: ['C:\\my app', '--bytemop-helper', '--pipe=\\\\.\\pipe\\bytemop-ab', '--token=cd'] });
  const check = "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(),[ref]$null,[ref]$e); exit $e.Count";
  const r = require('child_process').spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', check], { input: script, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(script.includes("Byte''mop"), 'single quotes are doubled');
});

test('forceCopy quarantine keeps content and removes the original', async () => {
  const s = sandbox();
  const { Quarantine } = require('../quarantine');
  const q = new Quarantine(path.join(s.base, 'q'), { forceCopy: true });
  const f = s.old('c.tmp', 'copy-me');
  const run = await q.begin();
  assert.strictEqual(await q.moveFile(run, f, 7, 'r', fs.statSync(f).mtimeMs), true);
  assert.ok(!fs.existsSync(f));
  const [e] = await q.entries(run.id);
  assert.strictEqual(fs.readFileSync(e.stored, 'utf8'), 'copy-me');
});

test('launch arguments containing spaces are quoted so the helper really starts', () => {
  const { buildLaunchScript } = require('../elevation');
  const script = buildLaunchScript({ exe: 'C:\\app\\electron.exe', args: ['C:\\My Projects\\Bytemop', '--bytemop-helper'] });
  assert.ok(script.includes('\'"C:\\My Projects\\Bytemop"\''), script);
  assert.ok(script.includes("'--bytemop-helper'"));
});

test('a helper running in another account\'s profile refuses every job', async () => {
  const s = sandbox();
  const own = { ...s.env, USERPROFILE: 'C:\\Users\\alice' };
  const opts = { allRules, env: own };
  await assert.rejects(executeJob({ type: 'scan', caller: 'C:\\Users\\bob' }, opts), /different-account/);
  await assert.rejects(executeJob({ type: 'scan', caller: '' }, opts), /different-account/);
  await assert.rejects(executeJob({ type: 'scan', caller: 5 }, opts), /different-account/);
  await assert.rejects(executeJob({ type: 'scan', caller: 'C:\\Users\\alice' }, { allRules, env: s.env }), /different-account/); // helper has no profile
  assert.ok(Array.isArray(await executeJob({ type: 'scan', caller: 'c:\\users\\ALICE\\' }, opts)), 'same profile, whatever the spelling');
  assert.ok(Array.isArray(await executeJob({ type: 'scan' }, opts)), 'jobs without a caller (older callers, tests) still run');
});

test('end to end: runElevated names the caller and a helper in a different profile reports why it refused', async () => {
  const s = sandbox();
  const out = await runElevated({ type: 'scan' }, { launch: childLauncher({ ...s.env, USERPROFILE: 'C:\\Users\\someone-else' }), connectTimeoutMs: 20000, caller: 'C:\\Users\\me' });
  assert.strictEqual(out.status, 'failed');
  assert.match(out.error, /different-account/);
  const same = await runElevated({ type: 'scan' }, { launch: childLauncher({ ...s.env, USERPROFILE: 'C:\\Users\\me' }), connectTimeoutMs: 20000, caller: 'C:\\Users\\me' });
  assert.strictEqual(same.status, 'ok');
});
