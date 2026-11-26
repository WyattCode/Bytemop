'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createScheduler, buildTaskXml, sanitizeSchedule, DEFAULT_SCHEDULE, quoteArg } = require('../scheduler');

const ACTION = { exe: 'C:\\Program Files\\Byte & <mop>\\Bytemop.exe', args: ['C:\\my app\\resources', '--bytemop-scheduled'] };

test('sanitizeSchedule keeps valid fields and ignores the rest', () => {
  const s = sanitizeSchedule({ enabled: true, frequency: 'daily', weekday: 3, time: '07:05', mode: 'clean', onlyOnAC: false, lowDiskAlert: false, lowDiskGB: 40 });
  assert.deepStrictEqual(s, { enabled: true, frequency: 'daily', weekday: 3, time: '07:05', mode: 'clean', onlyOnAC: false, lowDiskAlert: false, lowDiskGB: 40 });
  assert.deepStrictEqual(sanitizeSchedule(null), DEFAULT_SCHEDULE);
  const bad = sanitizeSchedule({ enabled: 'yes', frequency: 'hourly', weekday: 9, time: '24:00', mode: 'shred', onlyOnAC: 1, lowDiskGB: 0 });
  assert.deepStrictEqual(bad, DEFAULT_SCHEDULE);
  assert.strictEqual(sanitizeSchedule({ time: '9:30' }).time, DEFAULT_SCHEDULE.time, 'time must be zero padded HH:MM');
  assert.strictEqual(sanitizeSchedule({ mode: 'scan' }, { ...DEFAULT_SCHEDULE, mode: 'clean' }).mode, 'scan', 'patches apply over the given base');
});

test('weekly and daily triggers, time, battery and run level in the task XML', () => {
  const weekly = buildTaskXml({ frequency: 'weekly', weekday: 5, time: '03:30', onlyOnAC: true }, ACTION);
  assert.match(weekly, /<StartBoundary>2024-01-01T03:30:00<\/StartBoundary>/);
  assert.match(weekly, /<ScheduleByWeek><DaysOfWeek><Friday \/><\/DaysOfWeek>/);
  assert.match(weekly, /<DisallowStartIfOnBatteries>true</);
  assert.match(weekly, /<RunLevel>LeastPrivilege<\/RunLevel>/, 'never elevated');
  assert.match(weekly, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(weekly, /<StartWhenAvailable>true</, 'a missed run starts when the PC is next on');
  assert.match(weekly, /<MultipleInstancesPolicy>IgnoreNew</);
  assert.match(weekly, /<ExecutionTimeLimit>PT30M</);
  const daily = buildTaskXml({ frequency: 'daily', time: '21:00', onlyOnAC: false }, ACTION);
  assert.match(daily, /<ScheduleByDay><DaysInterval>1<\/DaysInterval>/);
  assert.match(daily, /<DisallowStartIfOnBatteries>false</);
  assert.ok(!/ScheduleByWeek/.test(daily));
});

test('the program path and arguments are XML-escaped and command-line quoted', () => {
  const xml = buildTaskXml(DEFAULT_SCHEDULE, ACTION);
  assert.ok(xml.includes('<Command>C:\\Program Files\\Byte &amp; &lt;mop&gt;\\Bytemop.exe</Command>'));
  assert.ok(xml.includes('<Arguments>&quot;C:\\my app\\resources&quot; --bytemop-scheduled</Arguments>'));
  assert.strictEqual(quoteArg('--flag'), '--flag');
  assert.strictEqual(quoteArg('a b'), '"a b"');
  assert.strictEqual(quoteArg('say "hi"'), '"say \\"hi\\""');
});

test('every weekday maps to the right element', () => {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  names.forEach((n, i) => assert.ok(buildTaskXml({ frequency: 'weekly', weekday: i }, ACTION).includes(`<${n} />`), n));
});

// ---- Windows Task Scheduler calls through an injected runner ----
test('register writes a UTF-16 (BOM) XML file, calls schtasks /Create, and cleans the file up', async () => {
  const calls = [];
  let fileSeen;
  const run = async (file, args) => {
    calls.push([file, ...args]);
    const f = args[args.indexOf('/XML') + 1];
    fileSeen = fs.readFileSync(f);
    return { code: 0, stdout: '', stderr: '' };
  };
  const sch = createScheduler({ action: ACTION, task: { folder: 'T', name: 'N' }, run });
  assert.deepStrictEqual(await sch.register(DEFAULT_SCHEDULE), { ok: true });
  assert.strictEqual(require('path').basename(calls[0][0]), 'schtasks.exe'); // full System32 path when SystemRoot is known
  assert.deepStrictEqual(calls[0].slice(1, 4), ['/Create', '/TN', 'T\\N']);
  assert.ok(calls[0].includes('/F'));
  assert.deepStrictEqual([fileSeen[0], fileSeen[1]], [0xff, 0xfe], 'UTF-16 LE byte-order mark');
  assert.ok(fileSeen.slice(2).toString('utf16le').startsWith('<?xml'));
  assert.ok(!fs.existsSync(calls[0][calls[0].indexOf('/XML') + 1]), 'temp XML removed');
});

test('register reports schtasks errors', async () => {
  const sch = createScheduler({ action: ACTION, run: async () => ({ code: 1, stdout: '', stderr: 'ERROR: Access is denied.' }) });
  assert.deepStrictEqual(await sch.register(DEFAULT_SCHEDULE), { ok: false, error: 'ERROR: Access is denied.' });
});

test('apply: enabled registers, disabled removes; removing a missing task is not an error', async () => {
  const calls = [];
  const run = async (f, args) => { calls.push(args[0]); return args[0] === '/Delete' ? { code: 1, stdout: '', stderr: 'does not exist' } : { code: 0, stdout: '', stderr: '' }; };
  const sch = createScheduler({ action: ACTION, run, powershell: async () => '{"exists":false}' });
  assert.deepStrictEqual(await sch.apply({ ...DEFAULT_SCHEDULE, enabled: true }), { ok: true });
  assert.deepStrictEqual(await sch.apply({ ...DEFAULT_SCHEDULE, enabled: false }), { ok: true, existed: false });
  assert.deepStrictEqual(calls, ['/Create', '/Delete']);
});

test('a failed delete of an existing task is an error', async () => {
  const sch = createScheduler({ action: ACTION, run: async () => ({ code: 1, stdout: '', stderr: 'Access is denied' }), powershell: async () => JSON.stringify({ exists: true, exe: ACTION.exe, args: '' }) });
  const r = await sch.remove();
  assert.strictEqual(r.ok, false);
});

test('status flags a task that points at a different program', async () => {
  const same = { exists: true, state: 'Ready', nextRun: '2030-01-01T20:00:00.0000000+08:00', lastRun: null, exe: ACTION.exe, args: ACTION.args.map(quoteArg).join(' ') };
  const sch = createScheduler({ action: ACTION, powershell: async () => JSON.stringify(same) });
  assert.strictEqual((await sch.status()).matchesApp, true);
  const moved = createScheduler({ action: ACTION, powershell: async () => JSON.stringify({ ...same, exe: 'D:\\old\\Bytemop.exe' }) });
  assert.strictEqual((await moved.status()).matchesApp, false);
  const failing = createScheduler({ action: ACTION, powershell: async () => { throw new Error('boom'); } });
  assert.deepStrictEqual(await failing.status(), { exists: null, error: 'boom' });
});

// ---- the real Task Scheduler, with a throw-away task that never fires ----
test('real Task Scheduler: create, read back, replace and delete a temporary task', { skip: process.platform !== 'win32' || !process.env.BYTEMOP_REAL_TESTS, timeout: 120000 }, async () => {
  const rand = Math.random().toString(36).slice(2, 8);
  const task = { folder: 'BytemopTest' + rand, name: 'Temp ' + rand };
  const action = { exe: process.execPath, args: ['--bytemop-scheduled-test', 'with space'] };
  const sch = createScheduler({ action, task });
  try {
    const r = await sch.register({ ...DEFAULT_SCHEDULE, enabled: true, frequency: 'weekly', weekday: 2, time: '03:15', onlyOnAC: true });
    assert.deepStrictEqual(r, { ok: true }, JSON.stringify(r));
    let st = await sch.status();
    assert.strictEqual(st.exists, true);
    assert.strictEqual(st.matchesApp, true, 'exe and arguments round-trip through Windows');
    assert.ok(st.nextRun, 'Windows computed a next run time');
    assert.match(st.nextRun, /T03:15:00/, 'at the requested time');
    assert.strictEqual(new Date(st.nextRun).getDay(), 2, 'on the requested weekday (Tuesday)');

    // XML as stored by Windows: not elevated, battery rule applied
    const q = spawnSync('schtasks.exe', ['/Query', '/TN', sch.fullName, '/XML'], { encoding: 'utf8' });
    // (Windows omits RunLevel when it is the default, least privilege; elevation would be spelled out)
    assert.ok(!/HighestAvailable/.test(q.stdout), 'the task does not run elevated');
    assert.match(q.stdout, /<LogonType>InteractiveToken<\/LogonType>/);
    assert.match(q.stdout, /<DisallowStartIfOnBatteries>true</);

    // re-registering replaces it (daily now)
    assert.deepStrictEqual(await sch.register({ ...DEFAULT_SCHEDULE, enabled: true, frequency: 'daily', time: '04:45', onlyOnAC: false }), { ok: true });
    st = await sch.status();
    assert.match(st.nextRun, /T04:45:00/);

    assert.deepStrictEqual(await sch.apply({ ...DEFAULT_SCHEDULE, enabled: false }), { ok: true, existed: true });
    assert.strictEqual((await sch.status()).exists, false);
  } finally {
    spawnSync('schtasks.exe', ['/Delete', '/TN', sch.fullName, '/F']);
    spawnSync('schtasks.exe', ['/Delete', '/TN', `${task.folder}`, '/F']);
  }
  assert.strictEqual((await sch.status()).exists, false);
});
