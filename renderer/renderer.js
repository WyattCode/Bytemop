'use strict';
/* global t, setLocale, getLocale, applyStatic */
const $ = (id) => document.getElementById(id);
const DAY = 24 * 3600 * 1000;

const state = {
  page: 'overview',
  items: [],            // decorated scan results
  scannedAt: null,
  filter: 'all',        // all | safe | caution
  collapsed: new Set(),
  selected: new Set(),  // rule ids the user has ticked
  busy: false,
  lastRunIds: [],
};

// ---------- helpers ----------
// Line icons (same stroke style as the navigation). Used instead of emoji so every symbol matches the theme.
const ICONS = {
  shield: ['M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
  'check-circle': ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M8 12.5l3 3 5-6'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  alert: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17.2v.1'],
  chevron: ['M6 9l6 6 6-6'],
};
function icon(name, cls) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ic' + (cls ? ' ' + cls : ''));
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.appendChild(p); }
  return svg;
}
// A bold success line with a check mark.
function strongOk(text) {
  const d = el('div', 'strong');
  d.append(icon('check'), document.createTextNode(text));
  return d;
}
function iconBox(name) { const d = el('div', 'empty-icon'); d.appendChild(icon(name)); return d; }

function fmt(bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes || 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  if (i > 0 && i < u.length - 1 && Number(n.toFixed(Number(n.toFixed(1)) >= 100 ? 0 : 1)) >= 1024) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(Number(n.toFixed(1)) >= 100 ? 0 : 1)) + ' ' + u[i];
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(label, onClick, cls = 'btn') {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// Separator for short meta lines (publisher, version, size...): a comma, not a decorative dot.
const dot = () => (getLocale() === 'en' ? ', ' : '，');
const when = (ts) => new Date(ts).toLocaleString(getLocale());
const isSelectable = (it) => it.count > 0 && it.blockedBy.length === 0 && !it.excluded;
const riskTag = (risk) => el('span', 'tag ' + risk, t('risk.' + risk));

// Keep admin rows' elevated scan results across normal rescans.
function mergeScan(fresh) {
  const old = new Map(state.items.map((i) => [i.id, i]));
  return fresh.map((f) => {
    const o = old.get(f.id);
    // keep the sizes from the elevated scan, but take the (possibly re-translated) texts from the fresh result
    return f.requiresAdmin && o && o.adminScanned ? { ...o, name: f.name, description: f.description, group: f.group } : f;
  });
}

// After a list re-renders, put keyboard focus back on the control (found by data-key) the user just used.
function keepFocus(containerId, key) {
  const again = [...$(containerId).querySelectorAll('[data-key]')].find((x) => x.dataset.key === key);
  if (again) again.focus();
}

// ---------- errors ----------
// Backend problems are shown in one banner at the top instead of leaving a page half-built or a button stuck.
function errText(e) {
  const msg = String((e && e.message) || e);
  if (msg.includes('exclusions-unreadable')) return t('common.exUnreadable');
  return t('common.error', { msg: msg.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') });
}
// Error text without the IPC wrapper and without a prefix, for messages that bring their own ('Operation failed: ...').
const plainErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
function showError(e) {
  const b = $('app-error');
  b.textContent = '';
  const x = btn('', clearError, 'x'); // E3: the banner floats over the page, so it can be put away
  x.setAttribute('aria-label', t('dr.close'));
  b.append(el('span', null, errText(e)), x);
  b.hidden = false;
}
function clearError() { $('app-error').hidden = true; }
// Run a page loader; any failure goes to the banner.
const safely = (fn) => (...args) => Promise.resolve().then(() => fn(...args)).catch(showError);

// A restore brings files back, so an earlier scan (and its 'undo' button) no longer describes the disk.
function invalidateScan() {
  state.scannedAt = null;
  state.items = [];
  state.selected = new Set();
  state.lastRunIds = [];
  $('result').hidden = true;
  window.E3.reset(); // E3: the home screen goes back to its idle state
}

// ---------- navigation ----------
// E3: fromNav is true only for a click in the sidebar. Clicking the section you are already in shows its front screen again.
function go(page, fromNav) {
  const real = page;
  if (!document.getElementById('page-' + real)) return; // unknown page name: stay where we are
  const again = fromNav === true && state.page === page && !!document.querySelector('.nav-item.on[data-page="' + page + '"]');
  state.page = page;
  const open = window.E3.onPage(page, again); // true when the working page is showing, false while the section's front screen is
  clearError();
  for (const p of document.querySelectorAll('.page')) p.hidden = p.id !== 'page-' + real;
  for (const n of document.querySelectorAll('.nav-item')) {
    n.classList.toggle('on', n.dataset.page === page);
    if (n.dataset.page === page) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  }
  closeDrawer();
  if (page === 'overview') safely(loadOverview)();
  if (page === 'clean') renderClean(); // draws what is already in memory; it never calls the backend
  else if (open) loadPage(page);
}
// E3: a section's data is read only when its working page is opened (the front screen's button, or coming back to a
// section that is already open). The front screen itself reads nothing.
function loadPage(page) {
  if (page === 'startup') safely(loadStartup)();
  if (page === 'apps') safely(loadApps)();
  if (page === 'disk') safely(loadDisk)();
  if (page === 'privacy') safely(loadPrivacy)(true);
  if (page === 'history') safely(loadHistory)();
  if (page === 'settings') safely(loadSettings)();
}
for (const n of document.querySelectorAll('.nav-item')) n.addEventListener('click', () => go(n.dataset.page, true));

// ---------- modal ----------
function modal({ title, body, confirmLabel, danger, list }) {
  return new Promise((resolve) => {
    const wrap = el('div', 'modal-wrap');
    const box = el('div', 'modal');
    const opener = document.activeElement;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'modal-title');
    if (danger) box.classList.add('is-danger');
    box.appendChild(window.E3.dialogArt(danger)); // E3: the section's object, or a caution mark when the action cannot be undone
    const h = el('h3', null, title);
    h.id = 'modal-title';
    box.appendChild(h);
    for (const line of body) if (line) box.appendChild(el('div', 'muted', line));
    if (list && list.length) {
      const ul = el('ul');
      for (const [name, size] of list) { const li = el('li'); li.append(el('span', null, name), el('span', 'muted', size)); ul.appendChild(li); }
      box.appendChild(ul);
    }
    const acts = el('div', 'acts');
    const done = (v) => {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      if (opener && opener.focus && document.contains(opener)) opener.focus();
      resolve(v);
    };
    const cancel = btn(t('md.cancel'), () => done(false));
    const ok = btn(confirmLabel, () => done(true), danger ? 'btn danger' : 'btn primary');
    const onKey = (e) => {
      if (e.key === 'Escape') { done(false); return; }
      if (e.key !== 'Tab') return;
      const f = [...box.querySelectorAll('button:not(:disabled)')]; // keep Tab inside the dialog
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    acts.append(cancel, ok);
    box.appendChild(acts);
    wrap.appendChild(box);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) done(false); });
    $('modal-root').appendChild(wrap);
    cancel.focus(); // the safe choice has the default focus
  });
}

// ---------- exclusions (shared by drawer, rows and settings) ----------
// Re-scan after the exclusion list changed so the lists reflect it right away.
async function refreshScan() {
  if (!state.scannedAt) return;
  // Sizes from an earlier elevated scan may now be wrong; the user can scan as administrator again.
  for (const i of state.items) if (i.requiresAdmin) i.adminScanned = false;
  state.items = mergeScan(await window.bytemop.scan());
  state.selected = new Set([...state.selected].filter((id) => { const i = state.items.find((x) => x.id === id); return i && isSelectable(i); }));
}

async function addExclusion(type, value) {
  const out = await window.bytemop.addExclusion({ type, value });
  if (!out.ok) return out;
  await refreshScan();
  return out;
}

async function removeExclusionById(id) {
  await window.bytemop.removeExclusion(id);
  await refreshScan();
}

async function unexcludeRule(it) {
  const entry = (await window.bytemop.exclusions()).find((e) => e.type === 'rule' && e.value === it.id);
  if (entry) await removeExclusionById(entry.id);
  renderClean();
}

// ---------- drawer ----------
// Tab stays inside the open drawer (it is a modal dialog, but sits after <main> in the page).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || $('drawer').hidden || $('modal-root').childElementCount) return;
  const f = [...$('drawer').querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
  if (!f.length) return;
  const first = f[0]; const last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === $('drawer'))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (!$('drawer').contains(document.activeElement)) { e.preventDefault(); first.focus(); }
});

let drawerTok = 0; // bumped on every open/close so a slow, older load cannot write into a newer drawer
let drawerOpener = null;
function closeDrawer() {
  drawerTok += 1;
  const wasOpen = !$('drawer').hidden;
  $('drawer').hidden = true;
  $('scrim').hidden = true;
  if (wasOpen && drawerOpener && document.contains(drawerOpener)) drawerOpener.focus();
  drawerOpener = null;
}
$('scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('drawer').hidden && !$('modal-root').children.length) closeDrawer(); });

async function openDrawer(it, flash) {
  const d = $('drawer');
  const tok = ++drawerTok;
  if (d.hidden) drawerOpener = document.activeElement;
  d.textContent = '';
  d.hidden = false;
  d.setAttribute('aria-label', it.name);
  $('scrim').hidden = false;
  d.focus();
  const top = el('div', 'dr-top');
  const x = btn('', closeDrawer, 'x');
  x.setAttribute('aria-label', t('dr.close'));
  top.append(window.E3.art(window.E3.objFor(it.category), 'dr-obj'), x);
  d.appendChild(top);
  const head = el('h3', null, it.name);
  head.appendChild(riskTag(it.risk));
  d.appendChild(head);
  if (!(it.requiresAdmin && !it.adminScanned)) d.appendChild(el('div', 'dr-size', it.count ? t('cl.size', { size: fmt(it.bytes), files: t('cl.files', { n: it.count }) }) : t('cl.nothing')));
  if (flash) { const f = el('div', 'callout ok', flash); f.setAttribute('role', 'status'); d.appendChild(f); }

  const about = el('div', 'sec');
  about.append(el('div', 'label', t('dr.about')), el('div', null, it.description));
  d.appendChild(about);

  let settings;
  try { settings = await window.bytemop.getSettings(); } catch { settings = { deleteMode: 'quarantine', retentionDays: '?' }; }
  if (tok !== drawerTok) return;
  const notes = el('div', 'sec');
  if (it.minAgeHours) notes.appendChild(el('div', 'callout', t('dr.age', { h: it.minAgeHours })));
  const mode = el('div', 'callout' + (settings.deleteMode === 'permanent' ? ' bad' : ''),
    settings.deleteMode === 'permanent' ? t('dr.permanent') : t('dr.quarantine', { d: settings.retentionDays }));
  notes.appendChild(mode);
  if (it.blockedBy.length) notes.appendChild(el('div', 'callout warn', t('dr.blocked', { apps: it.blockedBy.join(', ') })));
  d.appendChild(notes);
  const loadingEl = el('div', 'loading-line', t('dr.loading'));
  d.appendChild(loadingEl);

  let det = null;
  let detErr = null;
  try { det = it.requiresAdmin && !it.adminScanned ? null : await window.bytemop.details(it.id); } catch (e) { detErr = e; }
  loadingEl.remove();
  if (tok !== drawerTok) return;
  if (detErr) {
    const s = el('div', 'sec');
    s.appendChild(el('div', 'callout bad', errText(detErr)));
    d.appendChild(s);
  } else if (!det) {
    const s = el('div', 'sec');
    s.appendChild(el('div', 'callout warn', t('dr.adminNeeded')));
    d.appendChild(s);
  } else {
    if (det.roots.length) {
      const w = el('div', 'sec');
      w.appendChild(el('div', 'label', t('dr.where')));
      for (const r of det.roots) w.appendChild(el('div', 'path', r));
      d.appendChild(w);
    }
    const big = el('div', 'sec');
    big.appendChild(el('div', 'label', t('dr.biggest')));
    if (!det.entries.length) big.appendChild(el('div', 'muted', t('dr.empty')));
    const max = det.entries.reduce((m, e) => Math.max(m, e.bytes), 1);
    for (const e of det.entries) {
      const row = el('div', 'entry');
      const n = el('span', 'n', e.name);
      n.title = e.path + ' (' + (e.isDir ? t('dr.dirOf') : t('dr.fileOf')) + ')';
      const never = btn(t('ex.never'), async () => {
        never.disabled = true;
        let out;
        try { out = await addExclusion('path', e.path); } catch (err) { never.disabled = false; showError(err); return; }
        if (!out.ok) {
          never.disabled = false;
          const why = t('ex.invalid', { msg: t('ex.err.' + out.error) });
          never.title = why;
          if (!row.querySelector('.note')) row.appendChild(el('div', 'note bad', why)); // visible and read out, not only a tooltip
          return;
        }
        const fresh = state.items.find((x) => x.id === it.id) || it;
        openDrawer(fresh, t('ex.added')); // reopen with updated numbers
        if (state.page === 'clean') renderClean();
      }, 'btn small');
      row.append(n, el('span', 's', fmt(e.bytes) + dot() + t('cl.files', { n: e.count })), never);
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = Math.max(2, (e.bytes / max) * 100) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      big.appendChild(row);
    }
    if (det.moreEntries) big.appendChild(el('div', 'muted small', t('dr.more', { n: det.moreEntries })));
    d.appendChild(big);
  }
  const foot = el('div', 'foot');
  if (!it.excluded) {
    foot.appendChild(btn(t('ex.neverRule'), async () => {
      try { await addExclusion('rule', it.id); } catch (err) { showError(err); return; }
      closeDrawer();
      renderClean();
    }));
  }
  foot.appendChild(btn(t('dr.close'), closeDrawer));
  d.appendChild(foot);
}

// ---------- overview ----------
// The sweep ring: the used part of the drive, with the part a scan says can be freed marked at its end.
// E3: the home screen is a state machine drawn by e3.js (idle, scanning, result, cleaning, done, after).
async function loadOverview() { return window.E3.homeLoad(); }

async function smartScan() { return window.E3.scan(); }
$('smart-scan').addEventListener('click', smartScan);

// ---------- clean ----------
async function doScan() {
  if (state.busy) return; // a clean or another scan is running
  state.busy = true;
  state.scanning = true;
  $('rescan').disabled = true;
  $('rescan').textContent = t('cl.scanning');
  renderClean(); // E3: the list page shows that a scan is running instead of an unchanged page
  try {
    const fresh = await window.bytemop.scan();
    state.items = mergeScan(fresh);
    state.scannedAt = Date.now();
    // Default ticks: safe, non-admin rules the rule pack marks as default.
    state.selected = new Set(state.items.filter((i) => i.default && isSelectable(i)).map((i) => i.id));
  } finally {
    state.busy = false;
    state.scanning = false;
    $('rescan').disabled = false;
    $('rescan').textContent = state.scannedAt ? t('cl.rescan') : t('cl.scan');
    renderClean(); // E3: in finally, so a failed scan also takes the 'scanning' state off the page
  }
}

function visibleItems() {
  return state.items.filter((i) => state.filter === 'all' || (state.filter === 'safe' ? i.risk === 'safe' : true));
}

function renderFilters() {
  const f = $('filters');
  f.textContent = '';
  for (const [key, label] of [['all', 'cl.filterAll'], ['safe', 'cl.filterSafe']]) {
    const c = el('button', 'chip' + (state.filter === key ? ' on' : ''), t(label));
    c.type = 'button';
    c.setAttribute('aria-pressed', String(state.filter === key));
    c.addEventListener('click', () => { state.filter = key; renderClean(); keepFocus('filters', key); });
    c.dataset.key = key;
    f.appendChild(c);
  }
}

let adminScanBusy = false;
async function scanAdminFor(it, button) {
  if (adminScanBusy) return; // a second UAC prompt while one is open helps nobody
  adminScanBusy = true;
  button.disabled = true;
  button.textContent = t('cl.adminScanning');
  let r;
  try { r = await window.bytemop.scanAdmin(); } catch (e) { r = { status: 'failed' }; }
  adminScanBusy = false;
  if (r.status !== 'ok') {
    button.disabled = false;
    button.textContent = t('cl.scanAdmin');
    it.adminError = r.status === 'denied' ? t('cl.adminDenied') : r.status === 'portable' ? t('cl.adminPortable') : t('cl.adminFailed');
    renderClean();
    return;
  }
  for (const n of r.items) {
    const idx = state.items.findIndex((x) => x.id === n.id);
    if (idx >= 0) state.items[idx] = { ...n, adminScanned: true };
  }
  // Not ticked automatically: caution-level rules are always the user's explicit choice.
  renderClean();
}

function renderRow(it, max) {
  const row = el('div', 'row' + (isSelectable(it) ? '' : ' disabled'));
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.selected.has(it.id) && isSelectable(it);
  cb.disabled = !isSelectable(it);
  cb.setAttribute('aria-label', it.name);
  cb.addEventListener('change', () => { cb.checked ? state.selected.add(it.id) : state.selected.delete(it.id); updateActionBar(); });

  const name = el('div', 'name');
  const title = el('div', 'title', it.name);
  if (it.requiresAdmin) { const sh = icon('shield'); sh.setAttribute('role', 'img'); sh.setAttribute('aria-label', t('cl.adminTag')); sh.removeAttribute('aria-hidden'); const w = el('span'); w.title = t('cl.adminTag'); w.appendChild(sh); title.appendChild(w); }
  title.appendChild(riskTag(it.risk));
  name.appendChild(title);
  if (it.description) name.appendChild(el('div', 'desc', it.description)); // E3: every row says what it is, in a sentence
  const needsAdminScan = it.requiresAdmin && !it.adminScanned && !it.excluded;
  if (it.excluded) name.appendChild(el('div', 'note', t('ex.excludedNote')));
  else if (it.blockedBy.length) name.appendChild(el('div', 'note bad', t('cl.closeFirst', { apps: it.blockedBy.join(', ') })));
  else if (it.adminError) name.appendChild(el('div', 'note bad', it.adminError));
  else if (needsAdminScan) name.appendChild(el('div', 'note warn', t('cl.admin')));
  else if (!it.count) name.appendChild(el('div', 'note', t('cl.nothing')));

  const meter = el('div', 'meter');
  const act = el('div');
  if (it.excluded) {
    meter.appendChild(btn(t('ex.unexclude'), () => unexcludeRule(it), 'btn small'));
  } else if (needsAdminScan) {
    const b = btn(t('cl.scanAdmin'), () => scanAdminFor(it, b), 'btn small');
    meter.appendChild(b);
  } else if (it.count) {
    meter.appendChild(el('span', 'big', fmt(it.bytes)));
    meter.appendChild(el('span', 'muted small', t('cl.files', { n: it.count })));
  }
  const more = btn(t('cl.details'), () => openDrawer(it), 'link');
  more.setAttribute('aria-label', t('cl.details') + dot() + it.name);
  act.appendChild(more);
  row.append(cb, name, meter, act);
  return row;
}

// E3: shared pieces of the working pages. An empty state is the section's object, one sentence and at most one button.
function emptyState(obj, title, body, action) {
  const c = el('div', 'empty');
  c.appendChild(window.E3.art(obj, 'empty-obj'));
  if (title) c.appendChild(el('div', 'strong', title));
  if (body) c.appendChild(el('div', 'muted', body));
  if (action) c.appendChild(action);
  return c;
}
// A loading state: one line that says what is happening, over a few quiet placeholder rows.
function loadingState(text) {
  const c = el('div', 'loading');
  const line = el('div', 'loading-line', text);
  line.setAttribute('role', 'status');
  c.appendChild(line);
  for (let i = 0; i < 4; i++) c.appendChild(el('div', 'skel'));
  return c;
}
// Open a section's working page directly (a button that says where it goes, such as 'View records').
function openPage(page) { window.E3.open(page); go(page); }

function renderClean() {
  window.E3.sync(); // E3: keep the home tiles and the review sheet in step with the scan data
  renderFilters();
  if (!state.scanning) $('rescan').textContent = state.scannedAt ? t('cl.rescan') : t('cl.scan');
  const body = $('clean-body');
  body.textContent = '';
  const items = visibleItems();
  body.classList.toggle('is-busy', !!state.scanning);
  $('filters').hidden = !state.scannedAt;
  if (!state.scannedAt) {
    $('clean-summary').textContent = state.scanning ? t('e3.cl.scanningSum') : '';
    if (state.scanning) body.appendChild(loadingState(t('e3.cl.scanningLine')));
    else body.appendChild(emptyState('o-bucket', t('cl.empty'), t('cl.emptyBody'), btn(t('cl.scan'), safely(doScan), 'btn primary large')));
    $('actionbar').hidden = true;
    return;
  }
  const total = state.items.filter(isSelectable).reduce((s, i) => s + i.bytes, 0);
  const count = state.items.filter(isSelectable).reduce((s, i) => s + i.count, 0);
  const adminPending = state.items.some((i) => i.requiresAdmin && !i.adminScanned && !i.excluded);
  $('clean-summary').textContent = total ? t('cl.summary', { size: fmt(total), count }) : t(adminPending ? 'cl.allCleanAdmin' : 'cl.allClean');

  if (!state.items.some((i) => i.count > 0 || i.requiresAdmin)) {
    body.appendChild(emptyState('o-bucket', t('cl.allClean'), t('cl.allCleanBody')));
  }
  const max = items.reduce((m, i) => Math.max(m, i.bytes), 1);
  for (const g of [...new Set(items.map((i) => i.group))]) {
    const rows = items.filter((i) => i.group === g);
    const sec = el('div', 'group' + (state.collapsed.has(g) ? ' collapsed' : ''));
    const head = el('button', 'group-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', String(!state.collapsed.has(g)));
    head.append(window.E3.art(window.E3.objFor(rows[0].category), 'gobj'), el('span', null, g), el('span', 'gsize', fmt(rows.filter(isSelectable).reduce((s, i) => s + i.bytes, 0))), icon('chevron', 'chev'));
    head.dataset.key = g;
    head.addEventListener('click', () => { state.collapsed.has(g) ? state.collapsed.delete(g) : state.collapsed.add(g); renderClean(); keepFocus('clean-body', g); });
    const bodyEl = el('div', 'group-body');
    for (const it of rows) bodyEl.appendChild(renderRow(it, max));
    sec.append(head, bodyEl);
    body.appendChild(sec);
  }
  $('actionbar').hidden = false;
  updateActionBar();
}

// Only what is visible under the current filter: an item hidden by the filter must never be cleaned unseen.
function selectedItems() {
  return visibleItems().filter((i) => state.selected.has(i.id) && isSelectable(i));
}

function updateActionBar() {
  const sel = selectedItems();
  const bytes = sel.reduce((s, i) => s + i.bytes, 0);
  $('selected-summary').textContent = sel.length ? t('cl.selected', { n: sel.length }) + dot() + fmt(bytes) : t('cl.none');
  const b = $('clean-btn');
  b.textContent = sel.length ? t('cl.cleanSelectedN', { size: fmt(bytes) }) : t('cl.cleanSelected');
  b.disabled = sel.length === 0 || state.busy;
}

function showResult(content, warn) {
  const r = $('result');
  r.textContent = '';
  r.hidden = false;
  r.classList.toggle('warn', !!warn);
  r.appendChild(content);
  r.scrollIntoView({ block: 'nearest' });
}

// E3: the ONE clean implementation. The list page calls it with no argument; the home screen passes a view
// ({ start, end }) so it can show its scene while this same code asks, cleans and re-scans. The confirmation is
// shown for every clean, exactly as before; nothing here differs between the two callers.
async function doClean(view) {
  const sel = selectedItems();
  if (!sel.length || state.busy) return;
  const settings = await window.bytemop.getSettings();
  const permanent = settings.deleteMode === 'permanent';
  const bytes = sel.reduce((s, i) => s + i.bytes, 0);
  const adminNames = sel.filter((i) => i.requiresAdmin).map((i) => i.name);
  const ok = await modal({
    title: t(permanent ? 'md.permTitle' : 'md.confirmTitle', { n: sel.length, size: fmt(bytes) }),
    body: [t(permanent ? 'md.permBody' : 'md.quarantineBody', { d: settings.retentionDays }),
      adminNames.length ? t('md.adminBody', { names: adminNames.join(', ') }) : ''],
    list: sel.map((i) => [i.name, fmt(i.bytes)]),
    confirmLabel: permanent ? t('md.deletePermanently') : t('md.clean'),
    danger: permanent,
  });
  if (!ok) return;

  state.busy = true;
  updateActionBar();
  $('rescan').disabled = true;
  $('result').hidden = true;
  $('clean-summary').textContent = '';
  const spin = el('span', 'spinner');
  $('clean-summary').append(spin, document.createTextNode(t('md.cleaning')));
  if (view) view.start(settings);
  let out = null;
  let failure = null;
  try {
    out = await window.bytemop.clean(sel.map((i) => i.id));
    if (out.error === 'quarantine-limit') {
      const c = el('div');
      c.appendChild(el('div', null, t('rs.limitMsg', { used: fmt(out.used), wanted: fmt(out.wanted), limit: fmt(out.limit) })));
      const acts = el('div', 'acts');
      acts.appendChild(btn(t('rs.history'), () => openPage('history'), 'btn small'));
      c.appendChild(acts);
      showResult(c, true);
    } else {
      renderOutcome(out);
      // Admin rules that were cleaned are known to be empty now; normal rules are re-scanned.
      for (const r of out.results) {
        const it = state.items.find((x) => x.id === r.id);
        if (it && it.adminScanned && !r.skipped) { it.bytes = 0; it.count = 0; }
      }
      try {
        const fresh = await window.bytemop.scan();
        state.items = mergeScan(fresh);
        state.selected = new Set([...state.selected].filter((id) => { const i = state.items.find((x) => x.id === id); return i && isSelectable(i); }));
      } catch { // the clean itself worked and stays on screen; the list simply needs a new scan
        state.scannedAt = null; state.items = []; state.selected = new Set();
      }
    }
  } catch (e) {
    failure = e;
    showResult(el('div', null, errText(e)), true);
  } finally {
    state.busy = false;
    $('rescan').disabled = false;
    renderClean();
  }
  if (view) await view.end(out, failure);
}

function renderOutcome(out) {
  const { totals, results, mode, runIds } = out;
  const names = (pred) => results.filter(pred).map((r) => r.name).join(', ');
  const box = el('div');
  const head = totals.deleted
    ? t(mode === 'quarantine' ? 'rs.moved' : 'rs.deleted', { size: fmt(totals.freed), n: totals.deleted })
    : t('rs.nothingMoved');
  box.appendChild(strongOk(head));
  const lines = el('div', 'lines');
  const line = (s) => lines.appendChild(el('div', null, s));
  if (totals.deleted && mode === 'quarantine') line(t('rs.spaceNote'));
  if (totals.failed) line(t('rs.inUse', { n: totals.failed }));
  const running = names((r) => r.skipped && !r.reason);
  if (running) line(t('rs.running', { names: running }));
  const reasons = [['denied', 'rs.denied'], ['elevation-failed', 'rs.elevFailed'], ['portable', 'rs.portable'], ['different-account', 'rs.otherAccount'], ['timeout', 'rs.timeout'], ['quarantine-limit', 'rs.limit']];
  let warn = false;
  for (const [reason, key] of reasons) {
    const n = names((r) => r.reason === reason);
    if (n) { line(t(key, { names: n })); warn = true; }
  }
  box.appendChild(lines);
  const acts = el('div', 'acts');
  state.lastRunIds = runIds || [];
  if (state.lastRunIds.length) acts.appendChild(btn(t('rs.undo'), undoLast, 'btn'));
  acts.appendChild(btn(t('rs.history'), () => openPage('history'), 'btn'));
  box.appendChild(acts);
  showResult(box, warn || totals.failed > 0);
}

// Restore one or more runs; returns the summed outcome.
async function restoreRuns(ids) {
  const sum = { restored: 0, renamed: 0, failed: 0, denied: false };
  for (const id of ids) {
    const x = await window.bytemop.restore(id);
    sum.restored += x.restored; sum.renamed += x.renamed; sum.failed += x.failed;
    if (x.elevation) sum.denied = true;
  }
  return sum;
}

function restoreMessage(r) {
  let s = t('rs.restored', { n: r.restored });
  if (r.renamed) s += t('rs.restoredRenamed', { n: r.renamed });
  if (r.failed) s += t('rs.restoreFailed', { n: r.failed });
  return s + t('common.stop') + (r.denied ? ' ' + t('rs.restoreDenied') : ''); // E3: the full stop follows the language
}

async function undoLast() {
  const ids = state.lastRunIds;
  if (!ids.length || state.busy) return;
  state.busy = true;
  try {
    const r = await restoreRuns(ids);
    state.lastRunIds = [];
    showResult(el('div', 'strong', restoreMessage(r)), r.failed > 0 || r.denied);
    try { state.items = mergeScan(await window.bytemop.scan()); } catch { state.scannedAt = null; state.items = []; state.selected = new Set(); }
  } catch (e) {
    showResult(el('div', null, errText(e)), true);
  } finally {
    state.busy = false;
    renderClean();
  }
}

$('rescan').addEventListener('click', safely(doScan));
$('clean-btn').addEventListener('click', safely(() => doClean())); // no argument: the click event must not be taken for a view

// ---------- startup items ----------
const SOURCE_LABEL = {
  'hkcu-run': 'su.srcUser', 'hklm-run': 'su.srcMachine', 'hklm-run32': 'su.srcMachine32',
  'folder-user': 'su.srcFolderUser', 'folder-common': 'su.srcFolderCommon',
};
const startupState = { items: [], filter: 'all', loaded: false };

const needsAttention = (e) => e.exists === false || e.signature === 'unsigned' || e.signature === 'invalid' || (e.kind === 'registry' && !e.publisher);

async function loadStartup() {
  let failed = false;
  if (!startupState.loaded) $('startup-body').replaceChildren(loadingState(t('su.loading')));
  $('startup-refresh').disabled = true;
  try {
    startupState.items = await window.bytemop.startupList();
    startupState.loaded = true;
    $('startup-msg').textContent = '';
  } catch (e) {
    failed = true;
    $('startup-msg').textContent = t('su.failed', { msg: plainErr(e) });
  } finally {
    $('startup-refresh').disabled = false;
  }
  // the message says why; no 'nothing found' on top of it
  if (failed && !startupState.loaded) { $('startup-body').replaceChildren(emptyState('o-rocket', t('e3.loadFailed'), null, btn(t('e3.retry'), loadStartup, 'btn primary'))); return; }
  renderStartup();
}

function renderStartupFilters() {
  const f = $('startup-filters');
  f.textContent = '';
  for (const [key, label] of [['all', 'su.filterAll'], ['enabled', 'su.filterEnabled'], ['disabled', 'su.filterDisabled']]) {
    const c = el('button', 'chip' + (startupState.filter === key ? ' on' : ''), t(label));
    c.type = 'button';
    c.setAttribute('aria-pressed', String(startupState.filter === key));
    c.addEventListener('click', () => { startupState.filter = key; renderStartup(); keepFocus('startup-filters', key); });
    c.dataset.key = key;
    f.appendChild(c);
  }
}

async function toggleStartup(entry, sw) {
  sw.disabled = true;
  const target = !entry.enabled;
  try {
    const out = await window.bytemop.startupSet(entry.id, target);
    if (!out.ok) throw new Error(out.error);
    entry.enabled = target;
    $('startup-msg').textContent = t(target ? 'su.msgOn' : 'su.msgOff', { name: entry.name });
  } catch (e) {
    $('startup-msg').textContent = t('su.failed', { msg: e && e.message === 'not-found' ? t('su.err.not-found') : plainErr(e) });
  }
  renderStartup();
  const again = [...document.querySelectorAll('#startup-body .switch')].find((x) => x.dataset.id === entry.id);
  if (again) again.focus();
}

// E3: a soft letter tile in front of an app or startup row (the app's own icon is not available to the page).
function avatar(name) {
  const chars = [...String(name || '').trim()];
  const a = el('span', 'avatar', (chars[0] || '?').toUpperCase());
  let h = 0;
  for (const ch of chars) h = (h * 31 + ch.codePointAt(0)) % 6;
  a.dataset.c = String(h);
  a.setAttribute('aria-hidden', 'true');
  return a;
}

function startupRow(e) {
  const row = el('div', 'su-row' + (e.enabled ? '' : ' off'));
  const main = el('div', 'su-main');
  const title = el('div', 'su-title', e.name);
  if (e.signature === 'valid') title.appendChild(el('span', 'tag safe', t('su.sigValid')));
  if (e.signature === 'unsigned') title.appendChild(el('span', 'tag caution', t('su.sigUnsigned')));
  if (e.signature === 'invalid') title.appendChild(el('span', 'tag advanced', t('su.sigInvalid')));
  if (e.exists === false) title.appendChild(el('span', 'tag advanced', t('su.missing')));
  if (needsAttention(e)) title.appendChild(el('span', 'tag caution', t('su.attention')));
  main.appendChild(title);
  const pub = e.publisher || (e.kind === 'registry' ? t('su.unknownPublisher') : '');
  main.appendChild(el('div', 'su-sub', [pub, t(SOURCE_LABEL[e.source] || 'common.unknown')].filter(Boolean).join(dot())));
  const cmd = el('div', 'su-cmd', e.command);
  cmd.title = e.command;
  main.appendChild(cmd);

  const reveal = btn(t('su.reveal'), safely(() => window.bytemop.startupReveal(e.id)), 'link');
  reveal.setAttribute('aria-label', t('su.reveal') + dot() + e.name);
  reveal.disabled = !(e.kind === 'folder' || e.exePath) || e.exists === false;
  const sw = el('button', 'switch');
  sw.type = 'button';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(e.enabled));
  sw.setAttribute('aria-label', e.name);
  sw.dataset.id = e.id;
  sw.addEventListener('click', () => toggleStartup(e, sw));
  row.append(avatar(e.name), main, reveal, sw);
  return row;
}

function renderStartup() {
  renderStartupFilters();
  const items = startupState.items;
  const on = items.filter((i) => i.enabled).length;
  $('startup-summary').textContent = t('su.summary', { n: items.length, on, off: items.length - on });
  const body = $('startup-body');
  body.textContent = '';
  if (!items.length) { body.appendChild(emptyState('o-rocket', t('su.empty'))); return; }
  const byName = (a, b) => a.name.localeCompare(b.name, getLocale());
  const section = (label, list) => {
    if (!list.length) return;
    const g = el('div', 'su-group');
    g.appendChild(el('h2', null, label));
    const box = el('div', 'group-body');
    for (const e of list.sort(byName)) box.appendChild(startupRow(e));
    g.appendChild(box);
    body.appendChild(g);
  };
  const f = startupState.filter;
  if (f !== 'disabled') { const en = items.filter((i) => i.enabled); section(t('su.enabledSection', { n: en.length }), en); }
  if (f !== 'enabled') { const off = items.filter((i) => !i.enabled); section(t('su.disabledSection', { n: off.length }), off); }
  if (!body.children.length) body.appendChild(emptyState('o-rocket', t('su.noMatch')));
}
$('startup-refresh').addEventListener('click', loadStartup);

// ---------- apps: uninstall + leftovers ----------
const ap = { apps: [], pending: [], loaded: false, filter: 'all', sort: 'name', query: '', scans: new Map(), tok: 0 };

async function loadApps(quiet) {
  const tok = ++ap.tok;
  if (!quiet) $('ap-msg').textContent = '';
  if (!ap.loaded && !quiet) $('ap-body').replaceChildren(loadingState(t('ap.loading')));
  $('ap-refresh').disabled = true;
  try {
    const r = await window.bytemop.appsList();
    if (tok !== ap.tok) return; // a newer load is under way
    ap.apps = r.apps;
    ap.pending = r.pending;
    ap.loaded = true;
    for (const k of [...ap.scans.keys()]) if (!r.pending.some((p) => p.id === k)) ap.scans.delete(k);
    const warn = $('ap-warn');
    warn.hidden = r.errors.length === 0;
    if (r.errors.length) warn.textContent = t('ap.partial', { what: r.errors.map((e) => t(e.source === 'store' ? 'ap.srcStore' : 'ap.srcDesktop')).join(' / '), msg: r.errors[0].message });
  } finally {
    if (tok === ap.tok) {
      $('ap-refresh').disabled = false;
      // a failed first load must not stay on 'reading…'; the banner says why, this offers the way on
      if (!ap.loaded) $('ap-body').replaceChildren(emptyState('o-apps', t('e3.loadFailed'), null, btn(t('e3.retry'), safely(() => loadApps()), 'btn primary')));
    }
  }
  renderApps();
}

function renderApFilters() {
  const f = $('ap-filters');
  f.textContent = '';
  for (const [key, label] of [['all', 'ap.filterAll'], ['desktop', 'ap.filterDesktop'], ['store', 'ap.filterStore']]) {
    const c = el('button', 'chip' + (ap.filter === key ? ' on' : ''), t(label));
    c.type = 'button';
    c.setAttribute('aria-pressed', String(ap.filter === key));
    c.addEventListener('click', () => { ap.filter = key; renderApps(); keepFocus('ap-filters', key); });
    c.dataset.key = key;
    f.appendChild(c);
  }
}

function visibleApps() {
  const q = ap.query.trim().toLowerCase();
  const list = ap.apps.filter((a) => (ap.filter === 'all' || a.kind === ap.filter) && (!q || (a.name + ' ' + a.publisher + ' ' + (a.packageName || '')).toLowerCase().includes(q)));
  const byName = (a, b) => a.name.localeCompare(b.name, getLocale());
  // unknown sizes and dates go last, whichever way the list is sorted
  const num = (key) => (a, b) => (a[key] === null) - (b[key] === null) || (b[key] || 0) - (a[key] || 0) || byName(a, b);
  list.sort(ap.sort === 'size' ? num('size') : ap.sort === 'date' ? num('installDate') : byName);
  return list;
}

function appRow(a) {
  const row = el('div', 'ap-row');
  const nm = el('div', 'nm');
  const title = el('div', 't', a.name);
  if (a.kind === 'store') title.appendChild(el('span', 'tag neutral', t('ap.storeTag')));
  if (a.shared) title.appendChild(el('span', 'tag caution', t('ap.shared')));
  const sub = [a.publisher || t('ap.unknownPublisher'), a.version].filter(Boolean).join(dot());
  const p = el('div', 'p', sub);
  p.title = sub;
  nm.append(title, p);
  const b = btn(t('ap.uninstall'), () => uninstallApp(a, b), 'btn small');
  b.setAttribute('aria-label', t('ap.uninstallAria', { name: a.name }));
  row.append(avatar(a.name), nm, el('div', 'sz', a.size ? fmt(a.size) : '—'), el('div', 'dt', a.installDate ? new Date(a.installDate).toLocaleDateString(getLocale(), { timeZone: 'UTC' }) : ''), b);
  return row;
}

function renderApps() {
  renderApFilters();
  const known = ap.apps.reduce((s, a) => s + (a.size || 0), 0);
  $('ap-summary').textContent = t('ap.summary', { n: ap.apps.length, size: fmt(known) });
  renderPending();
  const body = $('ap-body');
  body.textContent = '';
  if (!ap.apps.length) { body.appendChild(emptyState('o-apps', t('ap.empty'))); return; }
  const list = visibleApps();
  if (!list.length) { body.appendChild(emptyState('o-apps', t('ap.noMatch'))); return; }
  const box = el('div', 'group-body');
  for (const a of list) box.appendChild(appRow(a));
  body.appendChild(box);
}

const apErr = (r) => t('ap.err.' + r.error, { detail: r.detail || '', limit: r.limit ? fmt(r.limit) : '', used: r.used ? fmt(r.used) : '' });

async function uninstallApp(a, b) {
  const body = [a.kind === 'store' ? t('ap.confirmStore') : t('ap.confirmDesktop')];
  if (a.shared) body.push(t('ap.confirmShared'));
  const ok = await modal({ title: t('ap.confirmTitle', { name: a.name }), body, confirmLabel: t('ap.uninstall'), danger: true });
  if (!ok) return;
  b.disabled = true;
  try {
    const r = await window.bytemop.appsUninstall(a.id);
    $('ap-msg').textContent = r.ok ? t(r.started ? 'ap.started' : 'ap.removed', { name: a.name }) : apErr(r);
  } catch (e) { showError(e); }
  b.disabled = false;
  await safely(loadApps)(true);
}

// ----- just-uninstalled apps and their leftovers -----
function renderPending() {
  const box = $('ap-pending');
  box.textContent = '';
  if (!ap.pending.length) return;
  box.appendChild(el('h2', null, t('ap.pendingTitle')));
  for (const p of ap.pending) box.appendChild(pendingCard(p));
}

function pendingCard(p) {
  const card = el('div', 'card ap-pend');
  const head = el('div', 'ap-pend-head');
  const info = el('div');
  info.append(el('div', 'strong', p.name), el('div', 'muted small', t(p.status === 'gone' ? 'ap.pStatusGone' : p.status === 'installed' ? 'ap.pStatusInstalled' : 'ap.pStatusUnknown')));
  const acts = el('div', 'acts-row');
  const sc = ap.scans.get(p.id);
  if (p.status === 'gone') {
    const c = btn(t(sc ? 'ap.recheck' : 'ap.check'), () => checkLeftovers(p, c), 'btn small primary');
    c.dataset.apCheck = p.id;
    acts.appendChild(c);
  }
  acts.appendChild(btn(t('ap.dismiss'), async () => {
    try { await window.bytemop.appsDismiss(p.id); } catch (e) { showError(e); return; }
    await safely(loadApps)(true);
  }, 'btn small'));
  head.append(info, acts);
  card.appendChild(head);
  if (sc) card.appendChild(leftoverList(p, sc));
  return card;
}

async function checkLeftovers(p, b) {
  b.disabled = true;
  b.textContent = t('ap.checking');
  try {
    const r = await window.bytemop.appsLeftovers(p.id);
    if (r.error) { $('ap-msg').textContent = apErr(r); if (r.error === 'still-installed') await loadApps(true); }
    else { ap.scans.set(p.id, newScan(r.candidates)); $('ap-msg').textContent = ''; }
  } catch (e) { showError(e); }
  renderPending();
  const again = [...document.querySelectorAll('[data-ap-check]')].find((x) => x.dataset.apCheck === p.id);
  if (again) again.focus();
}

const newScan = (candidates, keep) => ({ candidates, selected: new Set(candidates.filter((c) => (keep ? keep.has(c.id) : c.defaultSelected)).map((c) => c.id)) });

function leftoverRow(sc, c, onChange) {
  const row = el('div', 'dk-file');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = sc.selected.has(c.id);
  cb.disabled = c.truncated || (c.machine && c.keptByExclusion > 0); // the helper cannot recycle a folder with part of it kept
  cb.setAttribute('aria-label', c.path);
  cb.addEventListener('change', () => { if (cb.checked) sc.selected.add(c.id); else sc.selected.delete(c.id); onChange(); });
  const nm = el('div', 'nm');
  const title = el('div', 't', t('ap.kind.' + c.kind));
  if (c.machine) { const tag = el('span', 'tag caution', t('ap.machine')); title.appendChild(tag); }
  if (c.truncated) title.appendChild(el('span', 'tag advanced', t('ap.tooMany')));
  if (c.keptByExclusion) title.appendChild(el('span', 'tag neutral', t('ap.keptByEx', { n: c.keptByExclusion })));
  const path = el('div', 'p', c.path);
  path.title = c.path;
  nm.append(title, path);
  row.append(cb, nm, el('div', 'sz', fmt(c.size)), el('div', 'dt', c.mtimeMs ? new Date(c.mtimeMs).toLocaleDateString(getLocale()) : ''), btn(t('ap.reveal'), safely(() => window.bytemop.appsReveal(c.path)), 'btn small'));
  return row;
}

function leftoverList(p, sc) {
  const wrap = el('div', 'ap-left');
  if (!sc.candidates.length) { wrap.appendChild(el('div', 'muted', t('ap.leftNone'))); return wrap; }
  const total = sc.candidates.reduce((s, c) => s + c.size, 0);
  wrap.appendChild(el('div', 'muted small', t('ap.leftFound', { n: sc.candidates.length, size: fmt(total) })));
  const cleanBtn = btn('', () => cleanLeftovers(p, sc, cleanBtn), 'btn primary');
  const update = () => {
    const chosen = sc.candidates.filter((c) => sc.selected.has(c.id));
    cleanBtn.textContent = t('ap.cleanBtn', { n: chosen.length, size: fmt(chosen.reduce((x, c) => x + c.size, 0)) });
    cleanBtn.disabled = chosen.length === 0;
  };
  const box = el('div', 'group-body');
  for (const c of sc.candidates) box.appendChild(leftoverRow(sc, c, update));
  wrap.appendChild(box);
  update();
  const foot = el('div', 'ap-foot');
  foot.appendChild(cleanBtn);
  wrap.appendChild(foot);
  return wrap;
}

// What the elevated helper did, in words.
function adminResultText(a) {
  if (!a) return '';
  if (a.status === 'denied') return t('ap.adminDenied');
  if (a.status === 'refused' && a.error === 'still-installed') return ' ' + t('ap.err.still-installed');
  if (a.status !== 'ok') return a.error === 'portable' ? t('ap.adminPortable') : /different-account/.test(a.error || '') ? t('ap.adminOtherAccount') : t('ap.adminFailed', { msg: a.error || a.status });
  let s = t('ap.adminDone', { n: a.trashed, size: fmt(a.bytes) });
  if (a.failed.length) s += t('ap.adminSkipped', { n: a.failed.length, why: [...new Set(a.failed.map((f) => t('ap.why.' + f.reason)))].join(t('common.sep')) });
  return s;
}

async function cleanLeftovers(p, sc, b) {
  const chosen = sc.candidates.filter((c) => sc.selected.has(c.id));
  if (!chosen.length) return;
  let mode = 'quarantine';
  try { mode = (await window.bytemop.getSettings()).deleteMode; } catch { /* the service decides anyway */ }
  const shared = chosen.filter((c) => c.machine);
  const own = chosen.filter((c) => !c.machine);
  const size = fmt(own.reduce((s, c) => s + c.size, 0));
  const ok = await modal({
    title: t('ap.cleanTitle', { name: p.name, n: chosen.length }),
    body: [own.length ? t(mode === 'quarantine' ? 'ap.cleanBodyQ' : 'ap.cleanBodyP', { size }) : '', shared.length ? t('ap.cleanBodyAdmin', { n: shared.length }) : ''],
    list: chosen.map((c) => [t('ap.kind.' + c.kind) + dot() + c.path.split('\\').slice(-1)[0], fmt(c.size)]),
    confirmLabel: t('md.clean'), danger: mode !== 'quarantine',
  });
  if (!ok) return;
  b.disabled = true;
  ap.cleaning = true;
  try {
    const r = await window.bytemop.appsClean(p.id, chosen.map((c) => c.id));
    if (r.error) {
      $('ap-msg').textContent = apErr(r);
      if (r.error === 'rescan' || r.error === 'still-installed') { ap.scans.delete(p.id); await loadApps(true); }
    } else {
      $('ap-msg').textContent = (r.deleted || r.failed || !r.admin ? t('ap.cleaned', { n: r.deleted, size: fmt(r.freed) }) : '') + (r.failed ? t('ap.cleanedFailed', { n: r.failed }) : '') +
        (r.refused.length ? t('ap.cleanRefused', { n: r.refused.length }) : '') + adminResultText(r.admin) + (r.done ? t('ap.cleanDone') : '');
      if (r.done) ap.scans.delete(p.id); else ap.scans.set(p.id, newScan(r.remaining, new Set(r.remaining.filter((c) => sc.selected.has(c.id)).map((c) => c.id))));
      await loadApps(true);
      return;
    }
  } catch (e) { showError(e); } finally { ap.cleaning = false; }
  renderPending();
}

$('ap-refresh').addEventListener('click', safely(() => loadApps()));
$('ap-search').addEventListener('input', (e) => { ap.query = e.target.value; renderApps(); });
$('ap-sort').addEventListener('change', (e) => { ap.sort = e.target.value; renderApps(); });
// Coming back from an uninstaller window: re-read so a finished uninstall shows up without a manual refresh.
window.addEventListener('focus', () => {
  if (state.page === 'apps' && ap.loaded && !ap.cleaning && ap.pending.some((p) => p.status !== 'gone')) safely(loadApps)(true);
});

// ---------- disk analyzer ----------
const dk = { roots: null, result: null, tab: 'space', trail: [], minMB: 100, selected: new Set(), dups: null, busy: false, dupBusy: false, size: new Map() };
const dirOf = (p) => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')));

function rootLabel(r) {
  if (r.kind === 'drive') return t('dk.rootDrive', { p: r.path.slice(0, 2) });
  return t('dk.root' + r.kind[0].toUpperCase() + r.kind.slice(1)) + ' — ' + r.path;
}

async function loadDisk() {
  if (!dk.roots) dk.roots = await window.bytemop.diskRoots();
  const sel = $('dk-root');
  const cur = sel.value;
  sel.textContent = '';
  for (const r of dk.roots) { const o = el('option', null, rootLabel(r)); o.value = r.path; sel.appendChild(o); }
  for (const extra of dk.customRoots || []) { const o = el('option', null, extra); o.value = extra; sel.appendChild(o); }
  if (cur) sel.value = cur;
  renderDisk();
}

function diskProgress(p) {
  if (p.phase === 'walk') $('dk-progress').textContent = t('dk.walking', { files: p.files.toLocaleString(getLocale()), size: fmt(p.bytes) }) + dot() + p.current;
  else $('dk-progress').textContent = t('dk.dupScanning', { done: p.done, total: p.total });
}
window.bytemop.onDiskProgress(diskProgress);

async function runDisk() {
  if (dk.dupBusy) return; // the duplicate scan is running; wait for it (or cancel it there)
  if (dk.busy) { await window.bytemop.diskCancel(); return; }
  const root = $('dk-root').value;
  if (!root) return;
  dk.busy = true;
  $('dk-result').hidden = true;
  $('dk-go').textContent = t('dk.cancel');
  $('dk-progress').textContent = t('dk.analyzing');
  renderDisk(); // E3: the page shows that it is working (the first time there is no older result to look at)
  try {
    const r = await window.bytemop.diskAnalyze(root);
    if (r.error) $('dk-progress').textContent = t(r.error === 'no-analysis' ? 'dk.noAnalysis' : 'dk.notFolder');
    else if (r.cancelled) $('dk-progress').textContent = t('dk.cancelled');
    else { dk.result = r; dk.trail = [r.tree]; dk.selected = new Set(); dk.dups = null; $('dk-progress').textContent = ''; }
  } catch (e) {
    $('dk-progress').textContent = t('dk.failed', { msg: plainErr(e) });
  } finally {
    dk.busy = false;
    $('dk-go').textContent = t('dk.analyze');
    renderDisk();
  }
}

function renderDisk() {
  const r = dk.result;
  const tabs = $('dk-tabs');
  tabs.hidden = !r;
  $('dk-actionbar').hidden = !r || dk.tab === 'space';
  const body = $('dk-body');
  body.textContent = '';
  $('page-disk').classList.toggle('is-busy', !!dk.busy);
  if (!r) {
    $('dk-summary').textContent = '';
    body.appendChild(dk.busy ? loadingState(t('e3.dk.busy')) : emptyState('o-stack', t('e3.dk.emptyTitle'), t('dk.empty')));
    return;
  }
  $('dk-summary').textContent = t('dk.summary', { root: r.root, size: fmt(r.tree.size), files: r.stats.files.toLocaleString(getLocale()), sec: Math.max(1, Math.round(r.ms / 1000)) })
    + (r.stats.inaccessible ? t('dk.inaccessible', { n: r.stats.inaccessible }) : '');
  tabs.textContent = '';
  for (const [key, label] of [['space', 'dk.tabSpace'], ['large', 'dk.tabLarge'], ['dups', 'dk.tabDups']]) {
    const c = el('button', 'chip' + (dk.tab === key ? ' on' : ''), t(label));
    c.type = 'button';
    c.setAttribute('aria-pressed', String(dk.tab === key));
    c.dataset.key = key;
    c.addEventListener('click', () => { dk.tab = key; renderDisk(); keepFocus('dk-tabs', key); });
    tabs.appendChild(c);
  }
  if (dk.tab === 'space') renderSpace(body);
  else if (dk.tab === 'large') renderLarge(body);
  else renderDups(body);
  updateDiskBar();
}

function renderSpace(body) {
  if (!dk.trail.length) dk.trail = [dk.result.tree];
  const node = dk.trail[dk.trail.length - 1];
  const crumbs = el('div', 'dk-crumbs');
  dk.trail.forEach((n, i) => {
    if (i) crumbs.appendChild(el('span', 'sep', '›'));
    const b = btn(i === 0 ? n.path : n.name, () => { dk.trail = dk.trail.slice(0, i + 1); renderDisk(); }, '');
    if (i === dk.trail.length - 1) { b.disabled = true; b.classList.add('cur'); }
    crumbs.appendChild(b);
  });
  crumbs.appendChild(btn(t('dk.reveal'), safely(() => window.bytemop.diskReveal(node.path)), 'link end'));
  body.appendChild(crumbs);

  const rows = [];
  for (const c of node.children) rows.push({ name: c.name, size: c.size, node: c });
  if (node.fileBytes > 0) rows.push({ name: t('dk.looseFiles'), size: node.fileBytes, loose: true });
  if (node.other.size > 0) rows.push({ name: t('dk.otherDirs', { n: node.other.dirs }), size: node.other.size, loose: true });
  rows.sort((a, b) => b.size - a.size);
  // E3: one strip that shows how this folder divides up (the page's picture); the rows below are its legend.
  const tone = (i) => 'c' + Math.min(i, 6);
  if (rows.length) {
    const head = el('div', 'dk-here');
    head.append(el('b', null, fmt(node.size)), el('span', null, t('e3.dk.here', { name: dk.trail.length === 1 ? node.path : node.name })));
    const strip = el('div', 'dk-strip');
    strip.setAttribute('role', 'img');
    strip.setAttribute('aria-label', rows.slice(0, 6).map((x) => x.name + ' ' + fmt(x.size)).join(dot()));
    rows.forEach((x, i) => {
      const seg = el('i', tone(i));
      seg.style.flexGrow = String(Math.max(x.size, 1));
      seg.title = x.name + dot() + fmt(x.size);
      strip.appendChild(seg);
    });
    body.append(head, strip);
  }
  const box = el('div', 'group-body');
  if (!rows.length) box.appendChild(el('div', 'li muted', t('dk.emptyFolder')));
  rows.forEach((x, i) => {
    const row = el('div', 'dk-row');
    const nm = el('div', 'nm');
    const title = el('div', 't');
    if (x.node) title.appendChild(btn(x.name, () => { dk.trail.push(x.node); renderDisk(); }, ''));
    else { title.textContent = x.name; title.classList.add('muted'); }
    nm.appendChild(title);
    row.append(el('i', 'sw ' + tone(i)), nm, el('div', 'sz', fmt(x.size)), el('div', 'pc', Math.round((x.size / Math.max(node.size, 1)) * 100) + '%'));
    const rv = x.node ? btn(t('dk.reveal'), safely(() => window.bytemop.diskReveal(x.node.path)), 'link') : el('span');
    if (x.node) rv.setAttribute('aria-label', t('dk.reveal') + dot() + x.name);
    row.appendChild(rv);
    box.appendChild(row);
  });
  body.appendChild(box);
}

function diskFileRow(f, { checkbox, groupId } = {}) {
  const row = el('div', 'dk-file');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = dk.selected.has(f.path);
  cb.disabled = f.protected;
  cb.setAttribute('aria-label', f.name);
  cb.addEventListener('change', () => {
    if (cb.checked) {
      dk.selected.add(f.path);
      if (groupId !== undefined) {
        const g = dk.dups.groups.find((x) => x.id === groupId);
        if (g.files.every((m) => dk.selected.has(m.path))) { dk.selected.delete(f.path); cb.checked = false; $('dk-progress').textContent = t('dk.dupKeepOne'); }
      }
    } else dk.selected.delete(f.path);
    updateDiskBar();
  });
  const nm = el('div', 'nm');
  const title = el('div', 't', f.name);
  if (f.protected) { const tag = el('span', 'tag caution', t('dk.sysFile')); tag.title = t('dk.protectedHint'); title.appendChild(tag); }
  const p = el('div', 'p', dirOf(f.path));
  p.title = f.path;
  nm.append(title, p);
  const rv = btn(t('dk.reveal'), () => window.bytemop.diskReveal(f.path), 'link');
  rv.setAttribute('aria-label', t('dk.reveal') + dot() + f.name);
  row.append(cb, nm, el('div', 'sz', fmt(f.size)), el('div', 'dt', new Date(f.mtimeMs).toLocaleDateString(getLocale())), rv);
  return row;
}

function renderLarge(body) {
  const f = el('div', 'dk-filters');
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', t('dk.minSize'));
  for (const mb of [10, 50, 100, 500, 1024]) { const o = el('option', null, mb >= 1024 ? '1 GB' : mb + ' MB'); o.value = String(mb); sel.appendChild(o); }
  sel.value = String(dk.minMB);
  sel.dataset.key = 'minsize';
  sel.addEventListener('change', () => { dk.minMB = parseInt(sel.value, 10); renderDisk(); keepFocus('dk-body', 'minsize'); });
  f.append(el('span', 'muted small', t('dk.minSize')), sel);
  body.appendChild(f);
  const list = dk.result.large.filter((x) => x.size >= dk.minMB * 1024 * 1024);
  const box = el('div', 'group-body');
  if (!list.length) box.appendChild(el('div', 'li muted', t('dk.largeNone')));
  for (const x of list) box.appendChild(diskFileRow(x));
  body.appendChild(box);
}

async function findDups() {
  if (dk.dupBusy) { await window.bytemop.diskCancel(); return; }
  dk.dupBusy = true;
  renderDisk();
  $('dk-progress').textContent = t('dk.dupScanning', { done: 0, total: dk.result.candidateCount });
  try {
    const r = await window.bytemop.diskDuplicates();
    if (r.error) $('dk-progress').textContent = t(r.error === 'no-analysis' ? 'dk.noAnalysis' : 'dk.notFolder');
    else if (r.cancelled) $('dk-progress').textContent = t('dk.cancelled');
    else { dk.dups = r; $('dk-progress').textContent = ''; }
  } catch (e) { $('dk-progress').textContent = t('dk.failed', { msg: plainErr(e) }); }
  finally { dk.dupBusy = false; renderDisk(); }
}

function autoSelectDups() {
  for (const g of dk.dups.groups) {
    const ok = g.files.filter((x) => !x.protected);
    // keep the oldest copy; if the oldest is a protected file it is kept anyway
    const keep = [...g.files].sort((a, b) => a.mtimeMs - b.mtimeMs)[0];
    for (const x of ok) if (x.path !== keep.path) dk.selected.add(x.path); else dk.selected.delete(x.path);
  }
  renderDisk();
}

function renderDups(body) {
  if (!dk.dups) {
    body.appendChild(emptyState('o-stack', t('e3.dk.dupTitle'), t('dk.dupIntro'), btn(dk.dupBusy ? t('dk.cancel') : t('dk.dupFind'), findDups, 'btn primary large')));
    return;
  }
  const groups = dk.dups.groups;
  if (dk.dups.skippedCloud) body.appendChild(el('div', 'callout warn', t('dk.cloudSkipped', { n: dk.dups.skippedCloud })));
  if (!groups.length) { body.appendChild(emptyState('o-stack', t('dk.dupNone'))); return; }
  const saved = groups.reduce((s, g) => s + g.size * (g.files.length - 1), 0);
  const head = el('div', 'dk-filters');
  head.append(el('span', 'muted', t('dk.dupTotal', { n: groups.length, size: fmt(saved) })), btn(t('dk.dupAuto'), autoSelectDups, 'btn small'));
  body.appendChild(head);
  for (const g of groups) {
    const sec = el('div', 'group');
    const h = el('div', 'group-head static');
    h.appendChild(el('span', null, t('dk.dupGroup', { n: g.files.length, size: fmt(g.size), saved: fmt(g.size * (g.files.length - 1)) })));
    const box = el('div', 'group-body');
    for (const f of g.files) box.appendChild(diskFileRow(f, { groupId: g.id }));
    sec.append(h, box);
    body.appendChild(sec);
  }
}

// Only the files listed on the tab the user is looking at (and above its size filter) can be trashed: a ticked file
// that a filter or another tab hides must never be removed unseen.
function diskSelection() {
  const all = dk.tab === 'large' ? dk.result.large.filter((x) => x.size >= dk.minMB * 1024 * 1024)
    : dk.tab === 'dups' && dk.dups ? dk.dups.groups.flatMap((g) => g.files) : [];
  const byPath = new Map(all.map((f) => [f.path, f]));
  return [...dk.selected].map((p) => byPath.get(p)).filter((f) => f && !f.protected);
}

function updateDiskBar() {
  if (!dk.result) return;
  const sel = diskSelection();
  const bytes = sel.reduce((s, f) => s + f.size, 0);
  $('dk-selected').textContent = sel.length ? t('dk.selected', { n: sel.length }) : t('dk.none');
  const b = $('dk-trash');
  b.textContent = sel.length ? t('dk.trashBtnN', { size: fmt(bytes) }) : t('dk.trashBtn');
  b.disabled = sel.length === 0;
}

async function doTrash() {
  if (dk.trashing) return;
  const sel = diskSelection();
  if (!sel.length) return;
  const ok = await modal({
    title: t('dk.confirmTitle', { n: sel.length }), body: [t('dk.confirmBody')],
    list: sel.slice(0, 12).map((f) => [f.name, fmt(f.size)]).concat(sel.length > 12 ? [['…', '+' + (sel.length - 12)]] : []),
    confirmLabel: t('dk.trashBtn'),
  });
  if (!ok) return;
  dk.trashing = true;
  $('dk-trash').disabled = true; // a second click would send the same files again and report them as 'gone'
  try {
    const out = await window.bytemop.diskTrash(sel.map((f) => f.path));
    const gone = new Set(sel.map((f) => f.path));
    for (const bad of out.failed) gone.delete(bad.path);
    dk.result.large = dk.result.large.filter((f) => !gone.has(f.path));
    if (dk.dups) dk.dups.groups = dk.dups.groups.map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.path)) })).filter((g) => g.files.length > 1);
    dk.selected = new Set([...dk.selected].filter((p) => !gone.has(p)));
    const box = el('div');
    box.appendChild(strongOk(t('dk.done', { n: out.trashed, size: fmt(out.bytes) })));
    const lines = el('div', 'lines');
    lines.appendChild(el('div', null, t('dk.doneNote')));
    if (out.failed.length) {
      const why = [...new Set(out.failed.map((f) => t('dk.f.' + f.reason)))].join(t('common.sep'));
      lines.appendChild(el('div', null, t('dk.failedSome', { n: out.failed.length, why })));
    }
    box.appendChild(lines);
    const r = $('dk-result');
    r.textContent = ''; r.hidden = false; r.classList.toggle('warn', out.failed.length > 0); r.appendChild(box);
    r.scrollIntoView({ block: 'nearest' });
  } catch (e) {
    $('dk-progress').textContent = t('dk.failed', { msg: plainErr(e) });
  } finally { dk.trashing = false; }
  renderDisk();
}

$('dk-go').addEventListener('click', safely(runDisk));
$('dk-trash').addEventListener('click', safely(doTrash));
$('dk-pick').addEventListener('click', safely(async () => {
  if (dk.busy || dk.dupBusy) return; // choosing a folder would cancel the running analysis
  const p = await window.bytemop.diskPick();
  if (!p || dk.busy || dk.dupBusy) return;
  dk.customRoots = [...new Set([...(dk.customRoots || []), p])];
  await loadDisk();
  $('dk-root').value = p;
  runDisk();
}));

// ---------- privacy ----------
const PV_KINDS = ['history', 'downloads', 'cookies'];
const pv = { data: null, selected: new Set(), busy: false, scanning: false, sitesOpen: false };
const pvKey = (b, k) => b.id + ':' + k;
const pvSelectable = (b, k) => { const x = b.kinds[k]; return !!x && x.found && !x.locked && !x.unsupported && !x.excluded && x.count > 0 && b.running.length === 0; };

async function loadPrivacy(fresh = true) {
  if (pv.scanning) { pv.again = true; return; } // run once more when this scan ends, so nothing shows stale numbers
  if (fresh || !pv.data) {
    if (!pv.data) $('pv-body').replaceChildren(loadingState(t('pv.scanning')));
    pv.scanning = true;
    $('pv-rescan').disabled = true;
    $('pv-rescan').textContent = t('pv.scanning');
    try { pv.data = await window.bytemop.privacyScan(); }
    catch (e) { if (!pv.data) $('pv-body').textContent = ''; showPrivacyResult(el('div', null, errText(e)), true); }
    finally { pv.scanning = false; $('pv-rescan').disabled = false; $('pv-rescan').textContent = t('pv.rescan'); }
    if (pv.again) { pv.again = false; return loadPrivacy(true); }
  }
  if (!pv.data) return;
  pv.selected = new Set([...pv.selected].filter((key) => pv.data.browsers.some((b) => PV_KINDS.some((k) => pvKey(b, k) === key && pvSelectable(b, k)))));
  renderPrivacy();
  renderKeepSites();
  $('pv-pick').textContent = t(pv.sitesOpen ? 'pv.pickHide' : 'pv.pick');
  if (pv.sitesOpen) loadSites();
}

function showPrivacyResult(content, warn) {
  const r = $('pv-result');
  r.textContent = '';
  r.hidden = false;
  r.classList.toggle('warn', !!warn);
  r.appendChild(content);
}

function pvRow(b, kind) {
  const x = b.kinds[kind];
  const ok = pvSelectable(b, kind);
  const row = el('div', 'row' + (ok ? '' : ' disabled'));
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = pv.selected.has(pvKey(b, kind)) && ok;
  cb.disabled = !ok;
  cb.setAttribute('aria-label', b.name + dot() + t('pv.' + kind));
  cb.addEventListener('change', () => { cb.checked ? pv.selected.add(pvKey(b, kind)) : pv.selected.delete(pvKey(b, kind)); updatePrivacyBar(); });

  const name = el('div', 'name');
  name.appendChild(el('div', 'title', t('pv.' + kind)));
  let note = null;
  if (b.running.length) note = ['bad', t('pv.running', { name: b.name })];
  else if (x.excluded) note = ['', t('pv.excluded')];
  else if (x.locked) note = ['warn', t('pv.locked', { name: b.name })];
  else if (x.unsupported) note = ['warn', t('pv.unsupported')];
  else if (!x.count) note = ['', t('pv.nothing')];
  name.appendChild(el('div', 'note' + (note && note[0] ? ' ' + note[0] : ''), note ? note[1] : t('pv.' + kind + 'Desc')));

  const meter = el('div', 'meter');
  if (x.found && !x.locked && !x.unsupported && !x.excluded && x.count) meter.appendChild(el('span', null, t('pv.count', { n: x.count })));
  if (kind === 'cookies' && x.keep && !x.locked) meter.appendChild(el('span', 'muted small', t('pv.kept', { n: x.keep })));
  row.append(cb, name, meter, el('div'));
  return row;
}

function renderPrivacy() {
  const body = $('pv-body');
  body.textContent = '';
  const browsers = pv.data.browsers;
  if (!browsers.length) {
    $('pv-summary').textContent = '';
    body.appendChild(emptyState('o-shield', t('pv.noBrowser')));
    $('pv-actionbar').hidden = true;
    return;
  }
  const total = browsers.reduce((s, b) => s + PV_KINDS.reduce((n, k) => n + (pvSelectable(b, k) ? b.kinds[k].count : 0), 0), 0);
  $('pv-summary').textContent = total ? t('pv.summary', { n: total }) : t('pv.summaryNone');
  for (const b of browsers) {
    const sec = el('div', 'group');
    const head = el('div', 'group-head static');
    head.append(window.E3.art('o-globe', 'gobj'), el('span', null, b.name), el('span', 'gsize', t('pv.profiles', { n: b.profiles })));
    const box = el('div', 'group-body');
    for (const k of PV_KINDS) box.appendChild(pvRow(b, k));
    sec.append(head, box);
    body.appendChild(sec);
  }
  $('pv-actionbar').hidden = false;
  updatePrivacyBar();
}

function pvSelection() {
  const out = [];
  for (const b of pv.data ? pv.data.browsers : []) for (const k of PV_KINDS) if (pv.selected.has(pvKey(b, k)) && pvSelectable(b, k)) out.push({ browser: b.id, kind: k, name: b.name + dot() + t('pv.' + k), count: b.kinds[k].count });
  return out;
}

function updatePrivacyBar() {
  const sel = pvSelection();
  const n = sel.reduce((s, i) => s + i.count, 0);
  $('pv-selected').textContent = sel.length ? t('pv.selected', { n: sel.length }) : t('pv.none');
  const b = $('pv-clean');
  b.textContent = sel.length ? t('pv.cleanBtnN', { n }) : t('pv.cleanBtn');
  b.disabled = sel.length === 0 || pv.busy;
}

async function doPrivacyClean() {
  const sel = pvSelection();
  if (!sel.length || pv.busy) return;
  const keep = pv.data.keepSites;
  const cookies = sel.some((s) => s.kind === 'cookies');
  const body = [t('pv.confirmBody')];
  if (cookies) body.push(keep.length ? t('pv.confirmKeep', { sites: keep.slice(0, 8).join(', ') + (keep.length > 8 ? '…' : '') }) : t('pv.confirmNoKeep'));
  const ok = await modal({
    title: t('pv.confirmTitle', { n: sel.reduce((s, i) => s + i.count, 0) }),
    body, list: sel.map((s) => [s.name, t('pv.count', { n: s.count })]), confirmLabel: t('pv.confirm'), danger: true,
  });
  if (!ok) return;
  pv.busy = true;
  updatePrivacyBar();
  $('pv-result').hidden = true;
  try {
    const out = await window.bytemop.privacyClean(sel.map((s) => ({ browser: s.browser, kind: s.kind })));
    if (out.error === 'keep-list-unreadable') { showPrivacyResult(el('div', null, t('pv.keepUnreadable')), true); return; }
    const names = (pred) => out.results.filter(pred).map((r) => pvName(r)).join(', ');
    const box = el('div');
    box.appendChild(out.totals.deleted ? strongOk(t('pv.done', { n: out.totals.deleted })) : el('div', 'strong', t('pv.nothingDone')));
    const lines = el('div', 'lines');
    const line = (s) => lines.appendChild(el('div', null, s));
    const running = [...new Set(out.results.filter((r) => r.reason === 'running').map((r) => pvBrowser(r.browser)))].join(', ');
    if (running) line(t('pv.skipRunning', { names: running }));
    for (const [reason, key] of [['locked', 'pv.skipLocked'], ['unsupported', 'pv.skipUnsupported'], ['excluded', 'pv.skipExcluded'], ['error', 'pv.skipError']]) {
      const n = names((r) => r.reason === reason);
      if (n) line(t(key, { names: n }));
    }
    box.appendChild(lines);
    showPrivacyResult(box, out.totals.failed > 0 || out.results.some((r) => r.skipped && r.reason !== 'excluded'));
  } catch (e) {
    showPrivacyResult(el('div', null, errText(e)), true);
  } finally {
    pv.busy = false;
    await loadPrivacy(true);
  }
}
const pvBrowser = (id) => (pv.data && pv.data.browsers.find((b) => b.id === id) || { name: id }).name;
const pvName = (r) => pvBrowser(r.browser) + dot() + t('pv.' + r.kind);

// ----- keep-signed-in list -----
function keepMessage(msg, bad) { const m = $('pv-keep-msg'); m.className = 'small ' + (bad ? 'bad' : 'muted'); m.textContent = msg; }

function renderKeepSites() {
  const box = $('pv-keep-list');
  box.textContent = '';
  const list = pv.data ? pv.data.keepSites : [];
  if (!list.length) box.appendChild(el('div', 'muted small', t('pv.keepEmpty')));
  for (const site of list) {
    const chip = el('span', 'site-chip', site);
    const x = btn('×', async () => { await window.bytemop.privacyKeepRemove(site); await loadPrivacy(true); }, '');
    x.setAttribute('aria-label', t('pv.keepRemove', { site }));
    chip.appendChild(x);
    box.appendChild(chip);
  }
}

async function addKeepSite(value) {
  const out = await window.bytemop.privacyKeepAdd(value);
  if (!out.ok) { keepMessage(t(out.error === 'too-many' ? 'pv.keepTooMany' : 'pv.keepInvalid'), true); return false; }
  keepMessage(out.duplicate ? '' : t('pv.keepAdded', { site: out.site }));
  return true;
}

async function loadSites() {
  const box = $('pv-sites');
  box.hidden = false;
  box.replaceChildren(el('div', 'muted small', t('pv.sitesLoading')));
  let r;
  try { r = await window.bytemop.privacySites(); } catch (e) { box.replaceChildren(el('div', 'callout bad', errText(e))); return; }
  const kept = new Set(pv.data ? pv.data.keepSites : []);
  box.textContent = '';
  if (r.locked || (!r.sites.length && r.anyRunning)) box.appendChild(el('div', 'callout warn', t('pv.sitesLocked')));
  else if (!r.sites.length) box.appendChild(el('div', 'muted small', t('pv.sitesNone')));
  for (const s of r.sites) {
    const row = el('label', 'ex-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = kept.has(s.site);
    cb.addEventListener('change', async () => {
      cb.disabled = true;
      try {
        const want = cb.checked;
        const res = want ? await window.bytemop.privacyKeepAdd(s.site) : { ok: true, done: await window.bytemop.privacyKeepRemove(s.site) };
        if (!res.ok) { cb.checked = false; keepMessage(t('pv.keepFailed', { site: s.site, why: t(res.error === 'too-many' ? 'pv.keepTooMany' : 'pv.keepInvalid') }), true); }
        pv.data = await window.bytemop.privacyScan();
        renderPrivacy(); renderKeepSites();
      } catch (e) { cb.checked = !cb.checked; showError(e); }
      cb.disabled = false;
    });
    row.append(cb, el('span', 'v', s.site), el('span', 'muted small', t('pv.siteCount', { n: s.count })));
    box.appendChild(row);
  }
}

$('pv-rescan').addEventListener('click', safely(() => loadPrivacy(true)));
$('pv-clean').addEventListener('click', safely(doPrivacyClean));
$('pv-keep-add').addEventListener('click', safely(async () => {
  const input = $('pv-keep-input');
  if (await addKeepSite(input.value)) { input.value = ''; await loadPrivacy(true); }
}));
$('pv-keep-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) $('pv-keep-add').click(); });
$('pv-pick').addEventListener('click', async () => {
  pv.sitesOpen = !pv.sitesOpen;
  $('pv-pick').textContent = t(pv.sitesOpen ? 'pv.pickHide' : 'pv.pick');
  if (pv.sitesOpen) await loadSites(); else $('pv-sites').hidden = true;
});

// ---------- history ----------
function describeEvent(e) {
  switch (e.type) {
    case 'clean': return t('ev.cleanLine', { verb: e.mode === 'quarantine' ? t('ov.verbMoved') : t('ov.verbDeleted'), size: fmt(e.freed), n: e.deleted }) + (e.failed ? t('ev.skipped', { n: e.failed }) : '');
    case 'restore': return t('ev.restoreLine', { n: e.restored }) + (e.failed ? t('ev.failedN', { n: e.failed }) : '');
    case 'purge': case 'expire': return t('ev.released', { size: fmt(e.freed || 0) });
    case 'recover': return t('ev.recoverLine', { n: e.count, size: fmt(e.bytes) });
    case 'exclude': case 'unexclude': return e.value;
    case 'trash': return t('ev.trashLine', { n: e.n, size: fmt(e.bytes) });
    case 'privacy': return t('ev.privacyLine', { n: e.deleted }) + (e.failed ? t('ev.failedN', { n: e.failed }) : '');
    case 'startup': return t(e.enabled ? 'ev.startupOn' : 'ev.startupOff', { name: e.name });
    case 'uninstall': return e.name;
    case 'leftover': if (e.mode === 'recycle') return t('ev.leftoverRecycle', { name: e.name, n: e.deleted, size: fmt(e.freed) }) + (e.failed ? t('ev.failedN', { n: e.failed }) : '');
      return t('ev.leftoverLine', { name: e.name, verb: e.mode === 'quarantine' ? t('ov.verbMoved') : t('ov.verbDeleted'), size: fmt(e.freed), n: e.deleted }) + (e.failed ? t('ev.failedN', { n: e.failed }) : '');
    case 'scheduled': {
      let s = e.cleaned && e.cleaned.deleted > 0 ? t('ev.schedCleaned', { size: fmt(e.cleaned.freed), n: e.cleaned.deleted })
        : e.found > 0 ? t('ev.schedFound', { size: fmt(e.found) }) : t('ev.schedNone');
      if (e.lowDisk) s += t('ev.schedLow');
      if (e.error) s += t('ev.schedErr', { msg: e.error });
      return s;
    }
    default: return '';
  }
}

async function loadHistory() {
  const [runs, events] = await Promise.all([window.bytemop.runs(), window.bytemop.history()]);
  const total = runs.reduce((s, r) => s + (r.bytes || 0), 0);
  $('quarantine-summary').textContent = runs.length ? t('hi.summary', { size: fmt(total), n: runs.length }) : t('hi.empty');
  $('purge-all').hidden = runs.length === 0;

  const box = $('runs');
  box.textContent = '';
  if (!runs.length) box.appendChild(emptyState('o-box', t('hi.nothing')));
  for (const r of runs) {
    const li = el('div', 'li run');
    li.appendChild(window.E3.art('o-box', 'run-obj'));
    const grow = el('div', 'grow');
    const top = el('div', 'strong', when(r.createdAt));
    if (r.status === 'interrupted') top.appendChild(el('span', 'tag caution', t('hi.interrupted')));
    if (r.elevated) { const tg = el('span', 'tag neutral'); tg.append(icon('shield'), document.createTextNode(' ' + t('hi.elevated'))); top.appendChild(tg); }
    grow.append(top, el('div', 'muted small', (r.ruleNames || []).join(dot())));
    const daysLeft = Math.max(0, Math.ceil((r.expiresAt - Date.now()) / DAY));
    const info = el('div', 'when');
    info.append(el('b', null, fmt(r.bytes || 0)), el('span', 'muted small', t('cl.files', { n: r.count || 0 }) + dot() + t('hi.daysLeft', { d: daysLeft })));
    const acts = el('div', 'acts');
    acts.append(
      btn(t('hi.restore'), async (ev) => {
        const b = ev.currentTarget;
        b.disabled = true; // a double click would restore twice and leave '(restored)' copies
        try {
          const x = await restoreRuns([r.id]);
          if (x.denied) { $('quarantine-summary').textContent = t('hi.restoreDenied'); b.disabled = false; return; }
          if (x.restored) invalidateScan();
          await loadHistory();
          if (x.failed || x.renamed || !x.restored) $('quarantine-summary').textContent = restoreMessage(x);
        } catch (e) { showError(e); b.disabled = false; }
      }, 'btn primary small'),
      btn(t('hi.deleteNow'), async () => {
        const ok = await modal({ title: t('md.purgeTitle'), body: [t('md.purgeBody')], confirmLabel: t('md.purge'), danger: true });
        if (ok) { try { await window.bytemop.purge(r.id); await loadHistory(); } catch (e) { showError(e); } }
      }, 'btn small'),
    );
    li.append(grow, info, acts);
    box.appendChild(li);
  }

  const ev = $('events');
  ev.textContent = '';
  if (!events.length) ev.appendChild(el('div', 'li muted', t('hi.noActivity')));
  for (const e of events) {
    const li = el('div', 'li ev');
    const what = el('div', 'grow');
    what.append(el('div', 'strong', t('ev.' + e.type)), el('div', 'muted', describeEvent(e)));
    li.append(el('i', 'ev-dot ' + e.type), what, el('div', 'muted when', when(e.ts)));
    ev.appendChild(li);
  }
}
$('history-export').addEventListener('click', async () => {
  const msg = $('history-msg');
  msg.textContent = '';
  try {
    const r = await window.bytemop.historyExport();
    if (r.ok) msg.textContent = t('hi.exported', { n: r.count });
  } catch (e) { msg.textContent = t('hi.exportFailed', { msg: plainErr(e) }); }
});
$('purge-all').addEventListener('click', async () => {
  const ok = await modal({ title: t('md.purgeAllTitle'), body: [t('md.purgeAllBody')], confirmLabel: t('md.purgeAll'), danger: true });
  if (ok) { await window.bytemop.purgeAll(); await loadHistory(); }
});

// ---------- settings ----------
async function loadSettings() {
  const s = await window.bytemop.getSettings();
  $('set-mode').value = s.deleteMode;
  $('set-mode').dataset.prev = s.deleteMode;
  $('set-days').value = s.retentionDays;
  $('set-limit').value = s.quarantineLimitGB;
  $('set-lang').value = s.language;
  $('set-theme').value = s.theme;
  $('settings-status').textContent = '';
  try {
    const a = await window.bytemop.aboutInfo();
    $('ab-version').textContent = a.version + dot() + 'Electron ' + a.electron;
    $('ab-data').textContent = a.dataDir;
  } catch { /* the about card is informational */ }
  await Promise.all([loadSchedule(), loadExclusions()]);
}

$('ab-open').addEventListener('click', () => window.bytemop.openDataDir().catch(showError));

// ---------- schedule ----------
let scheduleBusy = false;

function fillWeekdays() {
  const sel = $('sc-weekday');
  const cur = sel.value;
  sel.textContent = '';
  for (let d = 0; d < 7; d++) { const o = el('option', null, t('sc.d' + d)); o.value = String(d); sel.appendChild(o); }
  if (cur) sel.value = cur;
}

function readSchedule() {
  return {
    enabled: $('sc-enabled').getAttribute('aria-checked') === 'true',
    frequency: $('sc-frequency').value,
    weekday: parseInt($('sc-weekday').value, 10),
    time: $('sc-time').value,
    mode: $('sc-mode').value,
    onlyOnAC: $('sc-ac').checked,
    lowDiskAlert: $('sc-lowdisk').checked,
    lowDiskGB: parseFloat($('sc-lowgb').value),
  };
}

function renderSchedule({ schedule: s, task, portable: isPortable }) {
  fillWeekdays();
  // A portable build cannot use scheduled tasks (see runtime.js): the whole section is switched off with the reason.
  for (const id of ['sc-enabled', 'sc-frequency', 'sc-weekday', 'sc-time', 'sc-mode', 'sc-ac', 'sc-lowdisk', 'sc-lowgb', 'sc-recreate']) $(id).disabled = !!isPortable;
  if (isPortable) {
    $('sc-enabled').setAttribute('aria-checked', 'false');
    $('sc-status').textContent = t('sc.portable');
    $('sc-recreate').hidden = true;
    for (const row of document.querySelectorAll('.sc-opt')) row.classList.add('dim');
    return;
  }
  $('sc-enabled').setAttribute('aria-checked', String(s.enabled));
  $('sc-frequency').value = s.frequency;
  $('sc-weekday').value = String(s.weekday);
  $('sc-time').value = s.time;
  $('sc-mode').value = s.mode;
  $('sc-ac').checked = s.onlyOnAC;
  $('sc-lowdisk').checked = s.lowDiskAlert;
  $('sc-lowgb').value = s.lowDiskGB;
  $('sc-weekday-row').hidden = s.frequency !== 'weekly';
  $('sc-mode-hint').textContent = s.mode === 'clean' ? t('sc.modeCleanHint') : '';
  for (const row of document.querySelectorAll('.sc-opt')) row.classList.toggle('dim', !s.enabled);

  const status = $('sc-status');
  const recreate = $('sc-recreate');
  recreate.hidden = true;
  if (!s.enabled) { status.textContent = t('sc.off'); return; }
  if (task && task.exists === null) { status.textContent = t('sc.checkFailed', { msg: task.error || '' }); return; }
  if (!task || task.exists === false) { status.textContent = t('sc.missing'); recreate.hidden = false; return; }
  if (task.matchesApp === false) { status.textContent = t('sc.mismatch'); recreate.hidden = false; return; }
  const parts = [task.nextRun ? t('sc.nextRun', { time: when(task.nextRun) }) : ''];
  parts.push(task.lastRun ? t('sc.lastRun', { time: when(task.lastRun) }) : t('sc.neverRun'));
  status.textContent = parts.filter(Boolean).join(dot());
}

async function loadSchedule() {
  try { renderSchedule(await window.bytemop.scheduleGet()); }
  catch (e) { $('sc-status').textContent = t('sc.checkFailed', { msg: plainErr(e) }); }
}

// Every change goes to Windows first; the UI then shows what was really saved.
let scheduleQueued = null;
async function applySchedule(patch) {
  if (scheduleBusy) { scheduleQueued = patch; return; } // the newest edit wins; it runs when the current write is done
  scheduleBusy = true;
  const msg = $('sc-msg');
  msg.className = 'small';
  msg.textContent = '';
  try {
    const out = await window.bytemop.scheduleApply(patch);
    renderSchedule(out);
    if (out.ok) msg.textContent = t('sc.saved');
    else { msg.className = 'small bad'; msg.textContent = t('sc.failed', { msg: out.error || '' }); }
  } catch (e) {
    msg.className = 'small bad';
    msg.textContent = t('sc.failed', { msg: plainErr(e) });
    await loadSchedule().catch(() => {}); // show what is really saved
  } finally { scheduleBusy = false; }
  if (scheduleQueued) { const next = scheduleQueued; scheduleQueued = null; await applySchedule(next); }
}

$('sc-enabled').addEventListener('click', () => applySchedule({ ...readSchedule(), enabled: $('sc-enabled').getAttribute('aria-checked') !== 'true' }));
for (const id of ['sc-frequency', 'sc-weekday', 'sc-time', 'sc-mode', 'sc-ac', 'sc-lowdisk', 'sc-lowgb']) $(id).addEventListener('change', () => applySchedule(readSchedule()));
$('sc-recreate').addEventListener('click', () => applySchedule({ ...readSchedule(), enabled: true }));
$('sc-test').addEventListener('click', async () => {
  const msg = $('sc-msg');
  msg.className = 'small';
  try {
    const r = await window.bytemop.scheduleTest();
    msg.textContent = r.ok ? t('sc.testSent') : t('sc.testUnsupported');
    if (!r.ok) msg.className = 'small bad';
  } catch (e) { msg.className = 'small bad'; msg.textContent = errText(e); }
});

// ---------- exclusions list in settings ----------
async function loadExclusions() {
  const box = $('ex-list');
  let list;
  try { list = await window.bytemop.exclusions(); } catch (e) {
    if (!String((e && e.message) || e).includes('exclusions-unreadable')) throw e;
    box.textContent = '';
    box.appendChild(el('div', 'callout bad', t('ex.unreadable')));
    const fix = btn(t('ex.repair'), safely(async () => { await window.bytemop.repairExclusions(); clearError(); await loadExclusions(); }), 'btn small');
    fix.style.marginTop = '8px';
    box.appendChild(fix);
    return;
  }
  box.textContent = '';
  if (!list.length) box.appendChild(el('div', 'muted small', t('ex.empty')));
  for (const e of list) {
    const row = el('div', 'ex-row');
    const tag = el('span', 'tag', t(e.type === 'rule' ? 'ex.typeRule' : 'ex.typePath'));
    const v = el('span', 'v', e.label || e.value);
    v.title = e.value;
    row.append(tag, v, btn(t('ex.remove'), safely(async () => { await removeExclusionById(e.id); await loadExclusions(); }), 'btn small'));
    box.appendChild(row);
  }
}

function exMessage(msg) { $('ex-msg').textContent = msg; }

async function addTypedExclusion() {
  const input = $('ex-input');
  const out = await addExclusion('path', input.value);
  if (!out.ok) { exMessage(t('ex.invalid', { msg: t('ex.err.' + out.error) })); return; }
  input.value = '';
  exMessage(t('ex.addedN', { n: out.duplicate ? 0 : 1 }));
  await loadExclusions();
}

async function pickExclusion(kind) {
  const out = await window.bytemop.pickExclusion(kind);
  if (out.errors.length) exMessage(t('ex.invalid', { msg: t('ex.err.' + out.errors[0]) }));
  else if (out.added) exMessage(t('ex.addedN', { n: out.added }));
  if (out.added) { await refreshScan(); await loadExclusions(); }
}
$('ex-add').addEventListener('click', safely(addTypedExclusion));
$('ex-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) safely(addTypedExclusion)(); });
$('ex-folder').addEventListener('click', safely(() => pickExclusion('folder')));
$('ex-file').addEventListener('click', safely(() => pickExclusion('file')));

async function saveSettings() {
  const mode = $('set-mode').value;
  // Risky changes (permanent delete, shorter retention) are confirmed by the main process, which can also say no.
  const want = {
    deleteMode: mode,
    retentionDays: parseInt($('set-days').value, 10),
    quarantineLimitGB: parseFloat($('set-limit').value),
    language: $('set-lang').value,
    theme: $('set-theme').value,
  };
  const { settings, locale, declined } = await window.bytemop.setSettings(want);
  const rejected = settings.retentionDays !== want.retentionDays || settings.quarantineLimitGB !== want.quarantineLimitGB;
  $('set-mode').dataset.prev = settings.deleteMode;
  $('set-mode').value = settings.deleteMode;
  $('set-days').value = settings.retentionDays;
  $('set-limit').value = settings.quarantineLimitGB;
  $('set-lang').value = settings.language;
  $('set-theme').value = settings.theme;
  if (locale !== getLocale()) { await applyLocale(locale); await loadExclusions(); }
  $('settings-status').textContent = declined ? t('st.declined') : rejected ? t('st.invalid') : t('st.saved');
}
for (const id of ['set-mode', 'set-days', 'set-limit', 'set-lang', 'set-theme']) $(id).addEventListener('change', safely(saveSettings));

// ---------- first-run welcome ----------
let isPortableBuild = false; // from app:init
const wl = { step: 0, schedule: false, settings: null, busy: false, msg: '' };
const WL_STEPS = 3;
let wlLabels = 0;

async function showWelcome(first = false) {
  try { wl.settings = await window.bytemop.getSettings(); } catch { wl.settings = { language: 'auto', theme: 'auto', retentionDays: 7 }; }
  Object.assign(wl, { step: 0, schedule: false, busy: false, msg: '', first, opener: first ? null : document.activeElement });
  $('welcome').hidden = false;
  document.addEventListener('keydown', wlKey);
  renderWelcome();
}

function closeWelcome() {
  $('welcome').hidden = true;
  document.removeEventListener('keydown', wlKey);
  const back = wl.opener;
  wl.opener = null;
  if (back && document.contains(back)) back.focus(); // reopened from Settings: focus returns to that button
  if (state.page === 'settings') safely(loadSettings)(); // the guide may have changed language, theme or the schedule
}

function wlKey(e) {
  if (e.key === 'Escape') { finishWelcome('skip'); return; }
  if (e.key !== 'Tab') return;
  const f = [...$('welcome').querySelectorAll('button:not(:disabled), input:not(:disabled)')]; // keep Tab inside the dialog
  if (!f.length) return;
  const first = f[0]; const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  else if (!$('welcome').contains(document.activeElement)) { e.preventDefault(); first.focus(); }
}

// One labelled group of exclusive choices (a radio group made of buttons).
function wlChoices(label, current, options, onPick) {
  const wrap = el('div', 'wl-field');
  const lab = el('div', 'strong', label);
  lab.id = 'wl-lab-' + (wlLabels += 1);
  const grp = el('div', 'chips');
  grp.setAttribute('role', 'radiogroup');
  grp.setAttribute('aria-labelledby', lab.id);
  for (const [value, text] of options) {
    const b = el('button', 'chip' + (current === value ? ' on' : ''), text);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(current === value));
    b.dataset.value = value;
    b.tabIndex = current === value ? 0 : -1; // one tab stop per group; arrows move inside it
    b.addEventListener('click', () => { if (current !== value) onPick(value); });
    grp.appendChild(b);
  }
  grp.addEventListener('keydown', (e) => {
    const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!k) return;
    e.preventDefault();
    const all = [...grp.querySelectorAll('[role=radio]')];
    const next = all[(all.indexOf(document.activeElement) + k + all.length) % all.length];
    if (next) next.click();
  });
  wrap.append(lab, grp);
  return wrap;
}

async function wlSave(patch) {
  if (wl.busy) return;
  wl.busy = true;
  try {
    const { settings, locale } = await window.bytemop.setSettings(patch);
    wl.settings = settings;
    if (locale !== getLocale()) await applyLocale(locale);
  } catch (e) { wl.msg = errText(e); } finally { wl.busy = false; }
  const key = patch.language !== undefined ? 'language' : 'theme';
  renderWelcome(false);
  const again = [...$('wl-main').querySelectorAll('[role=radio]')].find((x) => x.dataset.value === wl.settings[key]);
  if (again) again.focus();
}

function wlStepBody(main) {
  if (wl.step === 0) {
    const h = el('h1', null, t('wl.title'));
    main.append(h, el('p', 'wl-lead', t('wl.sub')));
    main.appendChild(wlChoices(t('wl.language'), wl.settings.language, [['auto', t('st.langAuto')], ['zh-CN', '简体中文'], ['en', 'English']], (v) => wlSave({ language: v })));
    main.appendChild(wlChoices(t('wl.theme'), wl.settings.theme, [['auto', t('theme.auto')], ['light', t('theme.light')], ['dark', t('theme.dark')]], (v) => wlSave({ theme: v })));
    return h;
  }
  if (wl.step === 1) {
    const h = el('h1', null, t('wl.safeTitle'));
    main.append(h, el('p', 'wl-lead', t('wl.safeSub')));
    const ul = el('ul', 'wl-points');
    for (let i = 1; i <= 5; i++) {
      const li = el('li');
      const body = el('div');
      body.append(el('div', 'strong', t('wl.safe' + i)), el('div', 'muted small', t('wl.safe' + i + 'b', { days: wl.settings.retentionDays || 7 })));
      const mk = el('span', 'mk' + (i === 5 ? ' warn' : ''));
      mk.appendChild(icon(i === 5 ? 'alert' : 'check'));
      li.append(mk, body);
      ul.appendChild(li);
    }
    main.appendChild(ul);
    return h;
  }
  const h = el('h1', null, t('wl.readyTitle'));
  main.append(h, el('p', 'wl-lead', t('wl.readySub')));
  if (isPortableBuild) { main.appendChild(el('div', 'callout', t('sc.portable'))); return h; }
  const box = el('label', 'wl-check');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = wl.schedule;
  cb.addEventListener('change', () => { wl.schedule = cb.checked; });
  const txt = el('div');
  txt.append(el('div', 'strong', t('wl.schedule')), el('div', 'muted small', t('wl.scheduleHint')));
  box.append(cb, txt);
  main.appendChild(box);
  return h;
}

function renderWelcome(focusHeading = true) {
  $('welcome').dataset.step = String(wl.step); // E3: each step has its own object beside the text
  const dots = $('wl-dots');
  dots.textContent = '';
  dots.setAttribute('aria-label', t('wl.step', { n: wl.step + 1, total: WL_STEPS }));
  for (let i = 0; i < WL_STEPS; i++) dots.appendChild(el('i', i <= wl.step ? 'on' : ''));
  const main = $('wl-main');
  main.textContent = '';
  const h = wlStepBody(main);
  h.id = 'wl-heading';
  h.tabIndex = -1;
  $('wl-msg').textContent = wl.msg;
  const foot = $('wl-foot');
  foot.textContent = '';
  const last = wl.step === WL_STEPS - 1;
  const left = el('div', 'grow');
  if (!last) left.appendChild(btn(t('wl.skip'), () => finishWelcome('skip')));
  foot.appendChild(left);
  if (wl.step > 0) foot.appendChild(btn(t('wl.back'), () => { wl.step -= 1; wl.msg = ''; renderWelcome(); }));
  if (last) {
    foot.appendChild(btn(t('wl.later'), () => finishWelcome('later')));
    const go1 = btn(t('wl.scan'), () => finishWelcome('scan'), 'btn primary');
    foot.appendChild(go1);
  } else {
    foot.appendChild(btn(t('wl.next'), () => { wl.step += 1; wl.msg = ''; renderWelcome(); }, 'btn primary'));
  }
  if (focusHeading) h.focus();
}

// action: 'skip' | 'later' | 'scan'. Whatever is chosen, the guide is marked done so it does not come back.
async function finishWelcome(action) {
  if (wl.busy) return;
  wl.busy = true;
  try {
    if (action !== 'skip' && wl.schedule) {
      let out;
      try {
        // keep whatever schedule already exists (reopened from Settings): only switch it on
        const cur = (await window.bytemop.scheduleGet()).schedule;
        out = cur.enabled ? { ok: true } : await window.bytemop.scheduleApply({ ...cur, enabled: true });
      } catch (e) { out = { ok: false, error: e.message }; }
      if (!out.ok) { // stay here: the user can start without it or try again
        wl.schedule = false;
        wl.msg = t('wl.scheduleFailed', { msg: String(out.error || '').replace(/[.。\s]+$/, '') });
        wl.busy = false;
        renderWelcome(false);
        return;
      }
    }
    await window.bytemop.setSettings({ onboarded: true });
  } catch (e) { showError(e); }
  wl.busy = false;
  closeWelcome();
  if (wl.first || action === 'scan') go('overview'); // re-opened from Settings: stay there unless a scan was asked for
  if (action === 'scan') safely(smartScan)();
}
// E3: Enter on a welcome step goes on (the primary button), unless a button or a field already has the focus.
$('welcome').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || (e.target.closest && e.target.closest('button, input, select'))) return;
  const primary = $('wl-foot').querySelector('.btn.primary');
  if (primary) { e.preventDefault(); primary.click(); }
});

$('set-welcome').addEventListener('click', () => safely(showWelcome)(false));

// ---------- language ----------
async function applyLocale(locale) {
  setLocale(locale);
  applyStatic();
  // Rule names come from the backend in the active language, so refresh them.
  if (state.scannedAt) state.items = mergeScan(await window.bytemop.scan());
  go(state.page);
}

(async function start() {
  let initError = null;
  let first = false;
  try {
    const init = await window.bytemop.init();
    setLocale(init.locale);
    first = init.onboarded === false;
    isPortableBuild = !!init.portable;
  } catch (e) {
    initError = e;
    setLocale(navigator.language && navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en');
  }
  applyStatic();
  go('overview');
  if (initError) showError(initError);
  else if (first) safely(showWelcome)(true);
})();
