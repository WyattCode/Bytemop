'use strict';
// Entry for the hidden background process started by the Windows Task Scheduler
// (`Bytemop.exe --bytemop-scheduled`). It runs once, shows its notifications, and exits.
const { loadPacks } = require('./rule-engine');
const { createService } = require('./clean-service');
const { runScheduled } = require('./scheduled-run');
const { resolveLocale } = require('./notify-text');

async function runScheduledProcess({ app, Notification, rulesDir, dataDir, launchApp, waitMs = 20000 }) {
  const loaded = loadPacks(rulesDir);
  const service = createService({ dataDir, rules: loaded.rules, implicitExclusions: [require('path').dirname(process.execPath)] });
  await service.startup().catch(() => {}); // finish interrupted runs, drop expired quarantine
  const { language } = await service.getSettings();
  const locale = resolveLocale(language, app.getLocale());

  const shown = [];
  const held = []; // keep the Notification objects alive, or their click events can be garbage-collected
  const notify = ({ title, body }) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    held.push(n);
    shown.push(new Promise((resolve) => {
      n.on('click', () => { launchApp(); resolve(true); });
      n.on('close', () => resolve(false));
      n.on('failed', () => resolve(false));
    }));
    n.show();
  };

  const summary = await runScheduled({ service, rules: loaded.rules, locale, notify });
  // Stay alive briefly so a click on the notification can open the app, then quit.
  if (shown.length) await Promise.race([Promise.race(shown), new Promise((r) => setTimeout(r, waitMs))]);
  return summary;
}

module.exports = { runScheduledProcess };
