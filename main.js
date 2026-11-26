'use strict';
const { app, BrowserWindow, Menu, session, ipcMain, nativeTheme, dialog, shell, Notification } = require('electron');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const { createScheduler, sanitizeSchedule, SCHEDULED_FLAG } = require('./scheduler');
const { runScheduledProcess } = require('./scheduled-main');
const notifyText = require('./notify-text');
const { createStartupManager, windowsBackend } = require('./startup');
const path = require('path');
const { loadPacks, pickLocale } = require('./rule-engine');
const { createService, sanitizeSettings } = require('./clean-service');
const { sensitiveChanges, confirmOptions, withoutRisky } = require('./settings-guard');
const { createPrivacyService } = require('./privacy-service');
const { createDiskService } = require('./disk-service');
const { createAppsService } = require('./apps-service');
const { windowsAppsBackend, isSystemOwned } = require('./apps');
const { createCanTrash, windowsFixedDrives, windowsFixedDriveLetters } = require('./recycle');
const { runPowerShell } = require('./powershell');
const { sweepTemp } = require('./privacy');
const { isPortableRun } = require('./runtime');
const exclusions = require('./exclusions');
const { runElevated, launchElevated, HELPER_FLAG } = require('./elevation');
const { runHelperFromArgs, dataDirFromEnv, leftoverConfirmOptions } = require('./helper');

const RULES_DIR = path.join(__dirname, 'rules');

// When started with the helper flag this process is the short-lived elevated helper: no window,
// no IPC, just one job over the private pipe and then exit.
if (process.argv.includes(HELPER_FLAG)) {
  app.disableHardwareAcceleration();
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    try {
      const ps = (script, input) => runPowerShell(script, input || {}, { timeoutMs: 20000 });
      await runHelperFromArgs(process.argv, {
        rulesDir: RULES_DIR, fallbackDir: app.getPath('userData'),
        deps: {
          // every registry entry with a name (components and hidden entries included), not only the user-visible list
          listInstalled: async () => (await windowsAppsBackend().desktop()).filter((r) => r && typeof r.name === 'string').map((r) => ({ name: r.name, installLocation: String(r.installLocation || '').replace(/^"|"$/g, '') })),
          trashItem: (p) => shell.trashItem(p),
          canTrash: createCanTrash({ fixedDrives: () => windowsFixedDrives(ps) }),
          isSystemOwned: (p) => isSystemOwned(p, ps),
          machineEnv: async () => {
            const out = await ps("$o=@{ProgramFiles=[Environment]::GetFolderPath('ProgramFiles');'ProgramFiles(x86)'=[Environment]::GetFolderPath('ProgramFilesX86');ProgramData=[Environment]::GetFolderPath('CommonApplicationData');SystemRoot=[Environment]::GetFolderPath('Windows')};ConvertTo-Json -InputObject $o -Compress");
            const j = JSON.parse(out);
            const pick = {};
            for (const k of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'SystemRoot']) if (typeof j[k] === 'string' && j[k]) pick[k] = j[k];
            if (!pick.ProgramFiles || !pick.ProgramData || !pick.SystemRoot) throw new Error('known folders unavailable');
            return pick;
          },
          confirm: async (list, name) => (await dialog.showMessageBox(leftoverConfirmOptions(app.getLocale(), name, list))).response === 1,
          extraProtected: ['documents', 'desktop', 'downloads', 'pictures', 'music', 'videos'].map((n) => { try { return app.getPath(n); } catch { return null; } }).filter(Boolean),
        },
      });
    }
    finally { app.quit(); }
  });
  return;
}

// The program file to start for scheduled runs and the elevated helper. A portable build unpacks itself into a
// temporary folder on every start, so process.execPath would point somewhere that disappears; electron-builder
// tells us the real file in PORTABLE_EXECUTABLE_FILE.
// A portable build unpacks itself into %TEMP% on every start and wipes that folder first, so starting the same file
// again (a scheduled run, the administrator helper) would delete the runtime of the window that is open. Those
// features are only offered in installed builds (see runtime.js).
const portable = isPortableRun();
const selfExe = () => process.execPath;

// Windows needs an app id for toast notifications to show (and group) properly.
const APP_ID = 'com.bytemop.app';
app.setAppUserModelId(APP_ID);

// Hidden run started by the Task Scheduler: scan / safe auto-clean / low-disk alert, then exit.
if (process.argv.includes(SCHEDULED_FLAG)) {
  app.disableHardwareAcceleration();
  // Its own fixed profile folder (reused every run, so nothing piles up) so it never fights the
  // interactive app over Chromium's locks. The task's "ignore new instance" rule prevents overlaps.
  const dir = dataDirFromEnv(process.env, os.tmpdir());
  app.setPath('userData', path.join(dir, 'scheduled-profile'));
  app.on('window-all-closed', () => {});
  // This process has no window: an unhandled error must end it, not show a dialog nobody can see, and a
  // hung step must not block the next scheduled run (the task ignores new instances while one is alive).
  process.on('uncaughtException', (e) => { console.error('[scheduled]', e); app.exit(1); });
  setTimeout(() => app.exit(1), 10 * 60 * 1000).unref();
  app.whenReady().then(async () => {
    try {
      await runScheduledProcess({
        app, Notification, rulesDir: RULES_DIR, dataDir: dir,
        launchApp: () => {
          const child = spawn(selfExe(), process.defaultApp ? [app.getAppPath()] : [], { detached: true, stdio: 'ignore' });
          child.on('error', (e) => console.error('[scheduled] cannot open app', e.message));
          child.unref();
        },
      });
    } catch (e) { console.error('[scheduled]', e); }
    finally { app.quit(); }
  });
  return;
}

// Only one interactive window: a second launch (e.g. clicking a notification) just focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

function launchHelper({ pipe, token }) {
  const args = [...(process.defaultApp ? [app.getAppPath()] : []), HELPER_FLAG, `--pipe=${pipe}`, `--token=${token}`];
  return launchElevated({ exe: selfExe(), args });
}

const CATEGORY_LABELS = {
  system: { 'zh-CN': '系统', en: 'System' },
  browser: { 'zh-CN': '浏览器', en: 'Browsers' },
  app: { 'zh-CN': '应用', en: 'Apps' },
  dev: { 'zh-CN': '开发者', en: 'Developer' },
  privacy: { 'zh-CN': '隐私', en: 'Privacy' },
};

let win;
let loaded = { rules: [], errors: [], packs: [] };
let service;
let privacy;
let disk;
let appsSvc;
let startup;

// Local (non-roaming) data folder: quarantined files can be large and must not roam.
function dataDir() {
  return dataDirFromEnv(process.env, app.getPath('userData'));
}

// Effective UI language: the setting wins, otherwise the system language.
async function locale() {
  const { language } = await service.getSettings();
  if (language === 'zh-CN' || language === 'en') return language;
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

// Add display text (in the user's language) to scan/clean metrics. Paths never reach the renderer.
async function decorate(metrics) {
  const loc = await locale();
  const byId = new Map(loaded.rules.map((r) => [r.id, r]));
  return metrics.map((m) => {
    const r = byId.get(m.id);
    return {
      ...m,
      name: pickLocale(r.name, loc),
      description: pickLocale(r.description, loc),
      group: pickLocale(CATEGORY_LABELS[r.category], loc),
      category: r.category,
      risk: r.risk,
      requiresAdmin: r.requiresAdmin,
      default: r.defaultSelected,
      minAgeHours: r.minAgeHours || 0,
    };
  });
}

async function ruleNames(ids, loc) {
  loc = loc || await locale();
  const byId = new Map(loaded.rules.map((r) => [r.id, r]));
  return (ids || []).map((id) => (byId.get(id) ? pickLocale(byId.get(id).name, loc) : id));
}

// The window buttons sit on the page's colour field, so only their glyph colour follows the colour scheme.
const captionButtons = () => ({ color: 'rgba(0,0,0,0)', symbolColor: nativeTheme.shouldUseDarkColors ? '#FFFFFF' : '#2B1433', height: 34 });
nativeTheme.on('updated', () => { try { if (win && !win.isDestroyed()) win.setTitleBarOverlay(captionButtons()); } catch { /* not supported here */ } });

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    title: 'Bytemop',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#260A3C' : '#FFF5EE',
    // No Windows title bar: the page's own colour runs to the top edge, and only the three window buttons are
    // drawn over it. The page marks its top strip as the drag area (.dragbar in renderer/e3.css).
    titleBarStyle: 'hidden',
    titleBarOverlay: captionButtons(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); // no pop-up windows
  win.webContents.on('will-navigate', (e) => e.preventDefault()); // the page never leaves index.html
  win.loadFile(path.join(__dirname, 'renderer', 'index.html')).catch((e) => console.error('[window]', e));
}

// Only the app's own page may call these handlers (a frame that navigated elsewhere, or an injected one, may not).
const trustedSender = (e) => {
  try {
    const u = new URL(e.senderFrame.url);
    return u.protocol === 'file:' && decodeURIComponent(u.pathname).replace(/\//g, '\\').toLowerCase().endsWith(path.join('renderer', 'index.html').toLowerCase());
  } catch { return false; }
};
const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => {
  if (!trustedSender(e)) throw new Error('untrusted sender');
  return fn(e, ...args);
});

// Administrator jobs are not available in a portable build.
const elevated = (job) => (portable ? Promise.resolve({ status: 'failed', error: 'portable' }) : runElevated(job, { launch: launchHelper }));

// The theme setting drives Chromium's colour scheme, so the stylesheet's prefers-color-scheme follows it.
const applyTheme = (theme) => { nativeTheme.themeSource = theme === 'light' || theme === 'dark' ? theme : 'system'; };

handle('app:init', async () => {
  const s = await service.getSettings();
  return { locale: await locale(), ruleErrors: loaded.errors.length, onboarded: s.onboarded, theme: s.theme, portable };
});
handle('disk:info', async () => service.disk());
handle('rules:scan', async () => decorate(await service.scan()));

// Admin-only rules cannot even be listed without elevation, so their sizes come from the helper.
handle('rules:scanAdmin', async () => {
  if (portable) return { status: 'portable' };
  const e = await elevated({ type: 'scan' });
  if (e.status !== 'ok') return { status: e.status };
  return { status: 'ok', items: await decorate(e.result) };
});

handle('rules:details', async (_e, id) => {
  const d = await service.details(String(id));
  if (!d) return null;
  const r = loaded.rules.find((x) => x.id === d.id);
  const loc = await locale();
  return { ...d, name: pickLocale(r.name, loc), description: pickLocale(r.description, loc), risk: r.risk, requiresAdmin: r.requiresAdmin, minAgeHours: r.minAgeHours || 0 };
});

// Confirmation happens in the renderer (an in-app dialog); here only known rule ids are acted on.
handle('rules:clean', async (_e, ids) => {
  const settings = await service.getSettings();
  const chosen = loaded.rules.filter((r) => Array.isArray(ids) && ids.includes(r.id));
  if (chosen.length === 0) return { results: [], totals: { deleted: 0, freed: 0, failed: 0 }, runIds: [], mode: settings.deleteMode };

  const normal = chosen.filter((r) => !r.requiresAdmin).map((r) => r.id);
  const admin = chosen.filter((r) => r.requiresAdmin).map((r) => r.id);
  const results = [];
  const runIds = [];
  const totals = { deleted: 0, freed: 0, failed: 0 };
  const add = (out) => {
    results.push(...out.results);
    if (out.runId) runIds.push(out.runId);
    for (const k of Object.keys(totals)) totals[k] += out.totals[k];
  };
  const skip = (reason) => admin.map((id) => ({ id, deleted: 0, freed: 0, failed: 0, skipped: true, reason, blockedBy: [] }));

  if (normal.length) {
    const out = await service.clean(normal);
    if (out.error) return out; // e.g. quarantine limit: nothing was touched
    add(out);
  }
  let elevation = null;
  if (admin.length) {
    const e = await elevated({ type: 'clean', ruleIds: admin, mode: settings.deleteMode });
    elevation = e.status;
    if (e.status === 'ok' && !e.result.error) add(e.result);
    else if (e.status === 'ok') results.push(...skip(e.result.error)); // helper refused, e.g. quarantine-limit
    else results.push(...skip(e.status === 'denied' ? 'denied' : e.status === 'timeout' ? 'timeout' : e.error === 'portable' ? 'portable' : /different-account/.test(e.error || '') ? 'different-account' : 'elevation-failed'));
  }
  return { mode: settings.deleteMode, runId: runIds[0] || null, runIds, results: await decorate(results), totals, elevation };
});

handle('runs:list', async () => {
  const runs = await service.runs();
  const out = [];
  const loc = await locale();
  for (const r of runs) out.push({ ...r, ruleNames: r.app ? [r.app] : await ruleNames(r.rules, loc) }); // an uninstall-leftover run is named after the app
  return out;
});

handle('runs:restore', async (_e, runId) => {
  runId = String(runId);
  const run = (await service.runs()).find((r) => r.id === runId);
  if (!run) return { restored: 0, renamed: 0, failed: 0, missing: true };
  if (!run.elevated) return service.restore(runId);
  // Files that came from admin-only folders must be put back by the elevated helper.
  const e = await elevated({ type: 'restore', runId });
  return e.status === 'ok' ? e.result : { restored: 0, renamed: 0, failed: 0, elevation: e.status };
});
handle('runs:purge', async (_e, runId) => service.purge(String(runId)));
handle('runs:purgeAll', async () => service.purgeAll());

handle('history:list', async () => {
  const events = await service.history();
  const out = [];
  const loc = await locale();
  for (const e of events) out.push({ ...e, ruleNames: await ruleNames(e.rules, loc) });
  return out;
});

// Export the whole activity history as a JSON file the user picks. The renderer never names the path.
handle('history:export', async () => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: 'bytemop-history.json', filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  const events = (await service.history(1e6)).reverse(); // oldest first
  await fs.promises.writeFile(r.filePath, JSON.stringify({ app: 'Bytemop', version: app.getVersion(), exportedAt: Date.now(), events }, null, 2));
  return { ok: true, count: events.length };
});

handle('about:info', async () => ({
  version: app.getVersion(), dataDir: dataDir(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
}));
handle('about:openData', async () => { await fs.promises.mkdir(dataDir(), { recursive: true }).catch(() => {}); const e = await shell.openPath(dataDir()); return e === ''; });

// Exclusions. Adding only ever protects files, so the renderer may supply paths freely; the
// service validates the shape (absolute path / known rule id).
handle('exclusions:list', async () => {
  const list = await service.listExclusions();
  const loc = await locale();
  const byId = new Map(loaded.rules.map((r) => [r.id, r]));
  return list.map((e) => ({ ...e, label: e.type === 'rule' && byId.get(e.value) ? pickLocale(byId.get(e.value).name, loc) : e.value }));
});
handle('exclusions:add', async (_e, input) => service.addExclusion(input));
handle('exclusions:remove', async (_e, id) => service.removeExclusion(String(id)));
handle('exclusions:repair', async () => service.repairExclusions());
// Native file/folder chooser; every chosen path is added as an exclusion.
handle('exclusions:pick', async (_e, kind) => {
  const r = await dialog.showOpenDialog(win, {
    properties: kind === 'file' ? ['openFile', 'multiSelections'] : ['openDirectory', 'multiSelections'],
  });
  if (r.canceled) return { added: 0, errors: [] };
  let added = 0;
  const errors = [];
  for (const p of r.filePaths) {
    const out = await service.addExclusion({ type: 'path', value: p });
    if (out.ok && !out.duplicate) added += 1;
    if (!out.ok) errors.push(out.error);
  }
  return { added, errors };
});

// ----- schedule (Windows Task Scheduler) -----
const scheduler = createScheduler({
  action: { exe: selfExe(), args: [...(process.defaultApp ? [app.getAppPath()] : []), SCHEDULED_FLAG] },
});

async function scheduleView() {
  const { schedule } = await service.getSettings();
  if (portable) return { schedule, task: { exists: false }, portable: true };
  return { schedule, task: await scheduler.status() };
}

// After an upgrade, a manual delete or a restored profile the Windows task can be missing while the setting says
// "on". Put it back (only when it is missing): the user asked for it and the setting still says so.
async function reconcileSchedule() {
  if (portable) return;
  const { schedule } = await service.getSettings();
  if (!schedule.enabled) return;
  const st = await scheduler.status();
  if (st && st.exists === false) {
    const r = await scheduler.apply(schedule);
    await service.logEvent({ type: 'schedRestored', ok: !!r.ok });
  }
}
handle('schedule:get', async () => scheduleView());
// Windows is changed first; the setting is only saved when that worked, so they cannot disagree.
handle('schedule:apply', async (_e, patch) => {
  if (portable) return { ok: false, error: 'portable', ...(await scheduleView()) };
  const cur = (await service.getSettings()).schedule;
  const next = sanitizeSchedule(patch, cur);
  const r = await scheduler.apply(next);
  if (!r.ok) return { ok: false, error: r.error, ...(await scheduleView()) };
  try {
    await service.setSchedule(next);
  } catch (e) {
    await scheduler.apply(cur).catch(() => {}); // put Windows back so it still matches the saved setting
    return { ok: false, error: e.message, ...(await scheduleView()) };
  }
  return { ok: true, ...(await scheduleView()) };
});
handle('schedule:testNotify', async () => {
  if (!Notification.isSupported()) return { ok: false };
  const msg = notifyText.message(await locale(), 'test');
  new Notification({ title: msg.title, body: msg.body }).show();
  return { ok: true };
});

// Startup items. The renderer only ever names an entry by the id it got from list(); the manager
// re-reads the live entries before touching anything.
handle('startup:list', async () => startup.list());
handle('startup:set', async (_e, id, enabled) => startup.setEnabled(String(id), !!enabled));
handle('startup:reveal', async (_e, id) => {
  const entry = (await startup.rawEntries()).find((e) => e.id === String(id));
  if (!entry) return false;
  const target = entry.kind === 'folder' ? entry.command : entry.exePath;
  if (!target) return false;
  shell.showItemInFolder(target);
  return true;
});

// ----- privacy (browser history / downloads list / cookies). The renderer only names a browser id and
// a kind; everything else (profiles, files, the keep list) stays in the main process. -----
handle('privacy:scan', async () => privacy.scan());
handle('privacy:sites', async () => privacy.sites());
handle('privacy:keepAdd', async (_e, input) => privacy.addSite(input));
handle('privacy:keepRemove', async (_e, site) => privacy.removeSite(site));
handle('privacy:clean', async (_e, selection) => privacy.clean(selection));

// ----- apps: uninstall + leftovers. The renderer names an app / leftover only by the ids it was given. -----
handle('apps:list', async () => appsSvc.list());
handle('apps:uninstall', async (_e, id) => appsSvc.uninstall(String(id)));
handle('apps:leftovers', async (_e, id) => appsSvc.leftovers(String(id)));
handle('apps:clean', async (_e, id, ids) => appsSvc.cleanLeftovers(String(id), ids));
handle('apps:dismiss', async (_e, id) => appsSvc.dismiss(String(id)));
handle('apps:reveal', async (_e, p) => { const target = appsSvc.revealable(p); if (!target) return false; shell.showItemInFolder(target); return true; });

// ----- disk analyzer (read-only scan; deleting = Recycle Bin, only for files the scan listed) -----
handle('disk:roots', async () => {
  // Only fixed drives are listed (asked from Windows once): probing every letter can leave a thread stuck on a
  // disconnected network drive, and the thread pool is shared with all other file access. Other places: "Choose folder".
  const safePath = (n) => { try { return app.getPath(n); } catch { return null; } };
  const reachable = (p) => Promise.race([fs.promises.access(p).then(() => true, () => false), new Promise((r) => setTimeout(() => r(false), 1500))]);
  const cands = [['home', safePath('home')], ['downloads', safePath('downloads')], ['documents', safePath('documents')], ['desktop', safePath('desktop')]];
  let letters = new Set();
  try { letters = await windowsFixedDriveLetters((script) => runPowerShell(script, {}, { timeoutMs: 15000 })); } catch { /* folders only */ }
  for (const L of [...letters].sort()) cands.push(['drive', L + ':\\']);
  const ok = await Promise.all(cands.map(([, p]) => (p ? reachable(p) : false)));
  return cands.filter((_, i) => ok[i]).map(([kind, p]) => ({ kind, path: p }));
});
handle('disk:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
// Progress goes to the window at most every 100 ms: a big duplicate scan reports far more often than a screen can show.
const sendProgress = (e, phase) => {
  let last = 0;
  return (p) => {
    const t = Date.now();
    if (t - last < 100 || e.sender.isDestroyed()) return;
    last = t;
    e.sender.send('disk:progress', { phase, ...p });
  };
};
handle('disk:analyze', async (e, root) => disk.analyze(root, sendProgress(e, 'walk')));
handle('disk:duplicates', async (e) => disk.duplicates(sendProgress(e, 'dup')));
handle('disk:cancel', async () => disk.cancel());
handle('disk:trash', async (_e, paths) => disk.trash(paths));
handle('disk:reveal', async (_e, p) => { const target = disk.revealable(p); if (!target) return false; shell.showItemInFolder(target); return true; });

handle('settings:get', async () => service.getSettings());
// Changes that weaken protection (permanent delete, shorter quarantine retention) are confirmed here, in the
// main process; the renderer cannot skip this by calling the IPC directly.
handle('settings:set', async (_e, patch) => {
  const cur = await service.getSettings();
  const risky = sensitiveChanges(cur, sanitizeSettings(patch && typeof patch === 'object' ? { ...patch, schedule: undefined } : {}, cur));
  let declined = false;
  if (risky.length) {
    const r = await dialog.showMessageBox(win, confirmOptions(await locale(), risky));
    if (r.response !== 1) { declined = true; patch = withoutRisky(patch, cur, risky); }
  }
  const settings = await service.setSettings(patch);
  applyTheme(settings.theme);
  return { settings, locale: await locale(), declined };
});

app.whenReady().then(async () => {
  loaded = loadPacks(RULES_DIR);
  for (const e of loaded.errors) console.error(`[rules] ${e.pack}${e.ruleId ? '/' + e.ruleId : ''}: ${e.problems.join('; ')}`);
  // The folder this program runs from (the unpacked runtime of a portable build lives in %TEMP%) is never 'temp junk'.
  service = createService({ dataDir: dataDir(), rules: loaded.rules, implicitExclusions: [path.dirname(process.execPath)] });
  privacy = createPrivacyService({ dataDir: dataDir(), service });
  disk = createDiskService({
    trashItem: (p) => shell.trashItem(p),
    logEvent: (e) => service.logEvent(e),
    getExcluded: async () => exclusions.compile(await service.listExclusions(), process.env).isExcluded,
    extraProtected: [dataDir()], // never let the quarantine or settings be trashed from here
    canTrash: createCanTrash({ fixedDrives: () => windowsFixedDrives((script) => runPowerShell(script, {}, { timeoutMs: 20000 })) }),
  });
  appsSvc = createAppsService({
    dataDir: dataDir(), backend: windowsAppsBackend(), service,
    elevatedClean: (job) => elevated(job),
    getExcluded: async () => exclusions.compile(await service.listExclusions(), process.env).isExcluded,
    extraProtected: [dataDir(), ...['documents', 'desktop', 'downloads', 'pictures', 'music', 'videos'].map((n) => { try { return app.getPath(n); } catch { return null; } }).filter(Boolean)],
  });
  startup = createStartupManager({
    backend: windowsBackend(),
    onChange: (c) => service.logEvent({ type: 'startup', id: c.id, name: c.name, source: c.source, enabled: c.enabled }).catch(() => {}),
  });
  applyTheme((await service.getSettings()).theme);
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false)); // no camera, location, ...
  session.defaultSession.setPermissionCheckHandler(() => false);
  if (!process.defaultApp) Menu.setApplicationMenu(null); // no menu means no DevTools shortcut in the shipped app
  createWindow();
  if (!app.isPackaged && process.env.BYTEMOP_SELFTEST === '1') { // development only: drive the real window with read-only checks (selftest.js)
    require('./selftest').run({ win, preload: path.join(__dirname, 'preload.js') })
      .then((r) => { console.log('SELFTEST ' + JSON.stringify(r)); app.exit(r.ok ? 0 : 1); })
      .catch((e) => { console.log('SELFTEST-CRASH ' + String(e && e.stack || e)); app.exit(2); });
  }
  // Recovery, expiry and leftovers cleaning run after the window is up, so they never delay the first paint.
  service.startup().catch((e) => console.error('[startup]', e));
  sweepTemp(os.tmpdir()).catch(() => {});
  setInterval(() => service.startup().catch((e) => console.error('[daily]', e)), 24 * 3600 * 1000).unref(); // expiry for an app that stays open for weeks
  reconcileSchedule().catch((e) => console.error('[schedule]', e));
}).catch((e) => {
  dialog.showErrorBox('Bytemop', String((e && e.message) || e));
  app.exit(1);
});
process.on('unhandledRejection', (e) => console.error('[unhandled]', e));
app.on('window-all-closed', () => app.quit());
