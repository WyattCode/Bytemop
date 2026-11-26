'use strict';
// What one scheduled run does (no Electron here, so it can be tested directly):
//   1. scan; 2. depending on the schedule mode, only notify or clean the SAFE default rules;
//   3. optionally warn about low disk space.
// Unattended runs are deliberately conservative: only rules that are safe, selected by default and
// need no administrator are touched, user exclusions apply, and cleaning always goes to the
// quarantine (never permanent delete), even if the user's interactive setting is "permanent".
const { message, formatBytes } = require('./notify-text');

// A 'found' toast for a few kilobytes is noise: below this size a scan-only run stays silent (it is still logged).
const MIN_NOTIFY_BYTES = 50 * 1024 * 1024;

async function runScheduled({ service, rules, locale, notify, now = () => Date.now(), minNotifyBytes = MIN_NOTIFY_BYTES }) {
  const settings = await service.getSettings();
  const sched = settings.schedule;
  // A leftover task after the schedule was switched off (or settings were reset) must do nothing.
  if (!sched.enabled) return { ts: now(), skipped: true, found: 0, cleaned: null, runId: null, lowDisk: false, error: null };
  const summary = { ts: now(), mode: sched.mode, found: 0, foundCount: 0, cleaned: null, runId: null, lowDisk: false, error: null };
  const byId = new Map(rules.map((r) => [r.id, r]));

  try {
    const scan = await service.scan();
    const eligible = scan.filter((m) => {
      const r = byId.get(m.id);
      return r && r.risk === 'safe' && r.defaultSelected === true && !r.requiresAdmin
        && !m.excluded && m.count > 0 && m.blockedBy.length === 0;
    });
    summary.found = eligible.reduce((s, m) => s + m.bytes, 0);
    summary.foundCount = eligible.reduce((s, m) => s + m.count, 0);

    if (summary.found > 0) {
      if (sched.mode === 'clean') {
        const out = await service.clean(eligible.map((m) => m.id), { mode: 'quarantine' });
        if (out.error === 'quarantine-limit') {
          summary.error = 'quarantine-limit';
          await notify(message(locale, 'limit'));
        } else {
          summary.cleaned = out.totals;
          summary.runId = out.runId || null;
          if (out.totals.deleted > 0) {
            await notify(message(locale, 'cleaned', { size: formatBytes(out.totals.freed), n: out.totals.deleted, d: settings.retentionDays }));
          }
        }
      } else if (summary.found >= minNotifyBytes) {
        await notify(message(locale, 'found', { size: formatBytes(summary.found) }));
      }
    }
  } catch (e) {
    summary.error = e.message;
  }

  if (sched.lowDiskAlert) {
    try {
      const d = await service.disk();
      if (d.free < sched.lowDiskGB * 1024 ** 3) {
        summary.lowDisk = true;
        await notify(message(locale, 'lowDisk', {
          drive: d.root.replace(/[\\/]+$/, '').replace(':', ''), free: formatBytes(d.free), pct: Math.round((d.free / d.total) * 100),
        }));
      }
    } catch (e) {
      summary.error = summary.error || e.message;
    }
  }

  await service.logEvent({
    type: 'scheduled', mode: summary.mode, found: summary.found, foundCount: summary.foundCount,
    cleaned: summary.cleaned, runId: summary.runId, lowDisk: summary.lowDisk, error: summary.error,
  });
  return summary;
}

module.exports = { runScheduled, MIN_NOTIFY_BYTES };
