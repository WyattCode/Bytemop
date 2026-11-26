'use strict';
// M8: registers Bytemop's recurring run with the Windows Task Scheduler. The task runs as the
// current user at normal (non-elevated) rights, so it works when the app is closed and can never
// trigger a UAC prompt in the background.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { runPowerShell } = require('./powershell');

const SCHEDULED_FLAG = '--bytemop-scheduled';
const DEFAULT_TASK = { folder: 'Bytemop', name: 'Scheduled Run' };

const DEFAULT_SCHEDULE = {
  enabled: false, frequency: 'weekly', weekday: 0, time: '20:00', mode: 'scan',
  onlyOnAC: true, lowDiskAlert: true, lowDiskGB: 15,
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Merge a patch over a base schedule, keeping only valid fields.
function sanitizeSchedule(input, base = DEFAULT_SCHEDULE) {
  const s = { ...DEFAULT_SCHEDULE, ...base };
  if (!input || typeof input !== 'object') return s;
  if (typeof input.enabled === 'boolean') s.enabled = input.enabled;
  if (['daily', 'weekly'].includes(input.frequency)) s.frequency = input.frequency;
  if (Number.isInteger(input.weekday) && input.weekday >= 0 && input.weekday <= 6) s.weekday = input.weekday;
  if (typeof input.time === 'string' && TIME_RE.test(input.time)) s.time = input.time;
  if (['scan', 'clean'].includes(input.mode)) s.mode = input.mode;
  if (typeof input.onlyOnAC === 'boolean') s.onlyOnAC = input.onlyOnAC;
  if (typeof input.lowDiskAlert === 'boolean') s.lowDiskAlert = input.lowDiskAlert;
  if (Number.isFinite(input.lowDiskGB) && input.lowDiskGB >= 1 && input.lowDiskGB <= 1000) s.lowDiskGB = input.lowDiskGB;
  return s;
}

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
// Windows command-line quoting for one argument.
const { quoteWinArg: quoteArg } = require('./winquote');
const { system32 } = require('./syspath');

// Task Scheduler 1.2 definition for the schedule. `action` = {exe, args:[...]}.
function buildTaskXml(schedule, action, { folder = DEFAULT_TASK.folder, name = DEFAULT_TASK.name } = {}) {
  const s = sanitizeSchedule(schedule);
  const recurrence = s.frequency === 'daily'
    ? '<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>'
    : `<ScheduleByWeek><DaysOfWeek><${DAYS[s.weekday]} /></DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek>`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Bytemop scheduled scan (${s.mode === 'clean' ? 'auto-clean safe items' : 'scan and notify'})</Description>
    <URI>\\${xmlEscape(folder)}\\${xmlEscape(name)}</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2024-01-01T${s.time}:00</StartBoundary>
      <Enabled>true</Enabled>
      ${recurrence}
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>${s.onlyOnAC ? 'true' : 'false'}</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(action.exe)}</Command>
      <Arguments>${xmlEscape(action.args.map(quoteArg).join(' '))}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

function realRun(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
  });
}

function createScheduler({ action, task = DEFAULT_TASK, run = realRun, powershell = runPowerShell, tmpDir = os.tmpdir() }) {
  const fullName = `${task.folder}\\${task.name}`;

  // Create or replace the task. Returns {ok:true} or {ok:false, error}.
  async function register(schedule) {
    const xml = buildTaskXml(schedule, action, task);
    const file = path.join(tmpDir, `bytemop-task-${crypto.randomBytes(6).toString('hex')}.xml`);
    // schtasks wants UTF-16 with a byte-order mark for an XML declared as UTF-16.
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]));
    try {
      const r = await run(system32('schtasks.exe'), ['/Create', '/TN', fullName, '/XML', file, '/F']);
      return r.code === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim() || `schtasks exited with ${r.code}` };
    } finally {
      try { fs.unlinkSync(file); } catch { /* best effort */ }
    }
  }

  async function remove() {
    const r = await run(system32('schtasks.exe'), ['/Delete', '/TN', fullName, '/F']);
    // "task does not exist" is fine: the goal state (no task) already holds.
    if (r.code === 0) return { ok: true, existed: true };
    const missing = (await status()).exists === false;
    return missing ? { ok: true, existed: false } : { ok: false, error: (r.stderr || r.stdout).trim() };
  }

  // What Windows actually has registered right now (the user may have changed or deleted it).
  async function status() {
    const script = `
$t = Get-ScheduledTask -TaskPath ('\\' + $in.folder + '\\') -TaskName $in.name -ErrorAction SilentlyContinue
if(-not $t){ '{"exists":false}'; exit 0 }
$i = $t | Get-ScheduledTaskInfo
$a = $t.Actions | Select-Object -First 1
$iso = { param($d) if($d -and $d.Year -gt 2000){ $d.ToString('o') } else { $null } }
[pscustomobject]@{ exists=$true; state=$t.State.ToString(); nextRun=(& $iso $i.NextRunTime); lastRun=(& $iso $i.LastRunTime); lastResult=[int64]$i.LastTaskResult; exe=[string]$a.Execute; args=[string]$a.Arguments } | ConvertTo-Json -Compress`;
    try {
      const out = await powershell(script, { folder: task.folder, name: task.name });
      const s = JSON.parse(out);
      if (!s.exists) return { exists: false };
      // A task that points at a different program (the app moved) will not work and needs re-creating.
      s.matchesApp = path.resolve(s.exe || '').toLowerCase() === path.resolve(action.exe).toLowerCase()
        && (s.args || '') === action.args.map(quoteArg).join(' ');
      return s;
    } catch (e) {
      return { exists: null, error: e.message };
    }
  }

  // Make Windows match the schedule: enabled -> (re)create the task, disabled -> remove it.
  async function apply(schedule) {
    const s = sanitizeSchedule(schedule);
    return s.enabled ? register(s) : remove();
  }

  return { register, remove, status, apply, fullName };
}

module.exports = { createScheduler, buildTaskXml, sanitizeSchedule, DEFAULT_SCHEDULE, DEFAULT_TASK, SCHEDULED_FLAG, quoteArg };
