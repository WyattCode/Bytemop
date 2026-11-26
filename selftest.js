'use strict';
// Development self-test: `set BYTEMOP_SELFTEST=1&& npx electron .` (never in a packaged build, see main.js).
// It drives the REAL window (real preload, real IPC, real services) with read-only calls, checks the answers, tries
// to call the IPC from a foreign page and to navigate away, and saves a screenshot of each page. It prints one JSON
// report and exits with 0 only if every check passed. It never cleans, deletes, uninstalls or changes a setting.
// The privacy page is skipped on purpose: opening it copies the browsers' history files to scan them.
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run({ win, preload }) {
  const report = { checks: [], consoleErrors: [], shots: [] };
  const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail: detail === undefined ? undefined : detail }); };
  const dir = process.env.BYTEMOP_SELFTEST_DIR || '';
  const wc = win.webContents;
  wc.on('console-message', (...a) => {
    const e = a[0] && typeof a[0] === 'object' && 'message' in a[0] ? a[0] : { level: a[1], message: a[2] };
    const level = typeof e.level === 'string' ? ({ error: 3, warning: 2 }[e.level] || 0) : e.level;
    if (level >= 3) report.consoleErrors.push(String(e.message).slice(0, 300));
  });
  if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r));
  await sleep(1500);
  const js = (code) => wc.executeJavaScript(code, true);
  const shot = async (name) => {
    if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    const img = await wc.capturePage();
    const file = path.join(dir, name + '.png');
    fs.writeFileSync(file, img.toPNG());
    report.shots.push(file);
  };
  // On a machine that has never completed the guide it covers the whole window: put it away (closeWelcome saves nothing).
  await js("if (!document.getElementById('welcome').hidden) closeWelcome()");
  await sleep(300);
  // A sidebar click only shows a section's front screen, which reads nothing; openPage() is what its button does.
  const go = async (page, wait = 900) => {
    await js(`document.querySelector('[data-page=${page}]').click()`);
    if (page !== 'overview') await js(`openPage('${page}')`);
    await sleep(wait);
  };

  try {
    // ---- the page and the bridge
    check('window loaded the app page', /renderer[\\/]index\.html$/.test(new URL(wc.getURL()).pathname), wc.getURL());
    check('preload exposes the bridge', await js("typeof window.bytemop === 'object' && typeof window.bytemop.scan === 'function'"));
    const init = await js('window.bytemop.init()');
    check('app:init answers', init && typeof init.locale === 'string' && 'portable' in init, init);
    await shot('01-overview');

    // ---- read-only IPC round trips
    const settings = await js('window.bytemop.getSettings()');
    check('settings:get', settings && ['quarantine', 'permanent'].includes(settings.deleteMode), { theme: settings.theme, onboarded: settings.onboarded });
    const disk = await js('window.bytemop.disk()');
    check('disk:info reports a real drive', disk && disk.total > 0 && disk.free >= 0, { root: disk.root, freeGB: Math.round(disk.free / 2 ** 30) });
    const runs = await js('window.bytemop.runs()');
    check('runs:list', Array.isArray(runs), runs.length);
    const hist = await js('window.bytemop.history()');
    check('history:list', Array.isArray(hist), hist.length);
    const sched = await js('window.bytemop.scheduleGet()');
    check('schedule:get', sched && sched.schedule && typeof sched.schedule.enabled === 'boolean', { enabled: sched.schedule.enabled, task: sched.task && sched.task.exists, portable: sched.portable });
    const ex = await js('window.bytemop.exclusions()');
    check('exclusions:list', Array.isArray(ex), ex.length);
    const about = await js('window.bytemop.aboutInfo()');
    check('about:info', about && about.version, about);
    const su = await js('window.bytemop.startupList()');
    check('startup:list reads the registry', Array.isArray(su) && su.length > 0, su.length);
    const apps = await js('window.bytemop.appsList()');
    check('apps:list reads installed apps', apps && apps.apps.length > 0, { apps: apps.apps.length, errors: apps.errors });
    check('no startup publisher keeps a stray quote', su.every((e) => !/^"|"$/.test(e.publisher || '')), su.map((e) => e.publisher).filter(Boolean));
    check('Store apps have readable names', apps.apps.filter((x) => x.kind === 'store').every((x) => !x.name.includes('.')), apps.apps.filter((x) => x.kind === 'store').slice(0, 4).map((x) => x.name));
    const scan = await js('window.bytemop.scan()');
    check('rules:scan', Array.isArray(scan) && scan.length > 0 && scan.every((r) => typeof r.name === 'string'), scan.map((r) => r.id + ':' + r.bytes));
    const roots = await js('window.bytemop.diskRoots()');
    check('disk:roots lists fixed drives', Array.isArray(roots) && roots.some((r) => r.kind === 'drive'), roots.map((r) => r.path));

    // ---- IPC is only for our own page
    const evil = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true } });
    await evil.loadURL('data:text/html,<p>foreign page</p>');
    const verdict = await evil.webContents.executeJavaScript("window.bytemop.getSettings().then(() => 'allowed', (e) => 'blocked: ' + e.message)");
    check('a foreign page cannot call the IPC', /^blocked/.test(verdict), verdict);
    evil.destroy();

    // ---- the page cannot be navigated away
    const before = wc.getURL();
    await js("setTimeout(() => { location.href = 'https://example.invalid/'; }, 10); 0");
    await sleep(800);
    check('navigation away from the app page is refused', wc.getURL() === before, wc.getURL());
    await js("window.open('https://example.invalid/'); 0");
    await sleep(300);
    check('pop-up windows are refused', BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length === 1, BrowserWindow.getAllWindows().length);

    // ---- every page renders, with data from the real machine
    await go('clean', 500);
    await js("document.getElementById('rescan').click()");
    // a real scan walks real folders: wait until its rows are there, for at most a minute
    let rows = 0;
    for (let i = 0; i < 60 && !rows; i++) { await sleep(1000); rows = await js("document.querySelectorAll('#clean-body .row').length"); }
    await sleep(600);
    check('clean page lists the rules after a scan', rows > 0, rows);
    await shot('02-clean');
    await go('startup', 2500); await shot('03-startup');
    check('startup page lists items', (await js("document.querySelectorAll('#startup-body .su-row').length")) > 0);
    await go('apps', 3000); await shot('04-apps');
    check('apps page lists apps', (await js("document.querySelectorAll('#ap-body .ap-row').length")) > 0);
    await go('disk', 800); await shot('05-disk');
    check('disk page offers locations', (await js("document.getElementById('dk-root').options.length")) > 0);
    await go('history', 900); await shot('06-history');
    await go('settings', 2500); await shot('07-settings');
    check('settings page shows the version', /\d+\.\d+/.test(await js("document.getElementById('ab-version').textContent")));
    await go('overview', 1500); await shot('08-overview-after-scan');
    check('overview shows the reclaimable size after the scan', !/—/.test(await js("document.getElementById('reclaim').textContent")), await js("document.getElementById('reclaim').textContent"));
    check('no banner error is showing', await js("document.getElementById('app-error').hidden"));

    // ---- the welcome guide fits the minimum window, in both themes
    wc.setZoomFactor(1);
    win.setSize(860, 560);
    await sleep(500);
    await js('showWelcome(false)');
    await sleep(800);
    await js("[...document.querySelectorAll('#wl-foot button')].find((b) => b.classList.contains('primary')).click()");
    await sleep(500);
    const box = await js("(() => { const r = document.querySelector('.welcome-box').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; })()");
    check('welcome guide step 2 fits a 860x560 window', box.top >= 0 && box.bottom <= box.h + 1, box);
    await shot('09-welcome-minimum-window');
    await js('closeWelcome()'); // not finishWelcome: that would save a setting
    await sleep(500);
  } catch (e) {
    check('self-test ran to the end', false, String((e && e.stack) || e));
  }
  check('no console errors in the page', report.consoleErrors.length === 0, report.consoleErrors);
  report.ok = report.checks.every((c) => c.ok);
  return report;
}

module.exports = { run };
