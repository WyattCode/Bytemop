'use strict';
/* E3 "Scene" front layer: the home state machine (idle, scanning, result, cleaning, done, undoing, tidy), the review sheet,
   and the front screen of every other section. Loaded before renderer.js; it only calls renderer globals from inside
   functions that run later. No data is invented here: every number comes from the scan, the clean result or the history. */
/* global state, t, fmt, doScan, doClean, loadPage, openPage, isSelectable, selectedItems, mergeScan, restoreRuns, restoreMessage,
   showError, openDrawer, scanAdminFor, riskTag, safely, updateActionBar, renderClean */
(() => {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const query = new URLSearchParams(location.search);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const calm = matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- colour scheme: follows Windows, or ?scheme=light|dark for previews ----------
  const lightMq = matchMedia('(prefers-color-scheme: light)');
  const applyScheme = () => {
    const forced = query.get('scheme');
    document.documentElement.dataset.scheme = forced === 'light' || forced === 'dark' ? forced : (lightMq.matches ? 'light' : 'dark');
  };
  applyScheme();
  lightMq.addEventListener('change', applyScheme);

  // ---------- dither: a still canvas that only breaks up gradient banding. It is drawn in device pixels (one speck is
  // one screen pixel at any scaling) and changes a pixel by two or three levels of brightness at most, so it cannot be
  // seen as a texture. ----------
  const grain = document.querySelector('.grain');
  let grainTimer = 0;
  function drawGrain() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.max(1, Math.round(grain.clientWidth * dpr)); const h = Math.max(1, Math.round(grain.clientHeight * dpr));
    grain.width = w; grain.height = h;
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    const c = tile.getContext('2d');
    const img = c.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random();
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v > 0.5 ? 255 : 0;
      img.data[i + 3] = Math.round(Math.abs(v - 0.5) * 2 * 5);
    }
    c.putImageData(img, 0, 0);
    const g = grain.getContext('2d');
    g.fillStyle = g.createPattern(tile, 'repeat');
    g.fillRect(0, 0, w, h);
  }
  drawGrain();
  addEventListener('resize', () => { clearTimeout(grainTimer); grainTimer = setTimeout(drawGrain, 150); });

  // ---------- small builders ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function art(id, cls) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', id.startsWith('i-') ? '0 0 24 24' : '0 0 200 200');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    const u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#' + id);
    svg.appendChild(u);
    return svg;
  }
  function button(cls, label, onClick, iconId) {
    const b = el('button', cls);
    b.type = 'button';
    if (iconId) b.appendChild(art(iconId));
    b.appendChild(el('span', null, label));
    b.addEventListener('click', onClick);
    return b;
  }
  function check(checked, label, onToggle) {
    const b = el('button', 'chk');
    b.type = 'button';
    b.setAttribute('role', 'checkbox');
    b.setAttribute('aria-checked', String(checked));
    b.setAttribute('aria-label', label);
    b.appendChild(art('i-check'));
    b.addEventListener('click', () => { const on = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(on)); onToggle(on); });
    return b;
  }
  // A number that counts to its value once (instantly when motion is reduced).
  function countTo(node, from, to, ms, show) {
    cancelAnimationFrame(node._raf || 0);
    if (calm.matches || from === to) { node.textContent = show(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      node.textContent = show(from + (to - from) * e);
      if (k < 1) node._raf = requestAnimationFrame(step);
    };
    node._raf = requestAnimationFrame(step);
  }
  const swap = (node) => { node.classList.remove('swap'); void node.offsetWidth; node.classList.add('swap'); };

  // ---------- home ----------
  const app = document.querySelector('.app');
  const home = $('page-overview');
  const hero = $('hero');
  const H = { s: 'idle', token: 0, scanP: null, stopped: '', keepDays: 7, permanent: false, freed: 0, done: null, joy: false, notes: [], total: 0, shown: 0, resNote: '', memo: new Map(), rvGroup: null, timers: [], p: 0 };

  function clearTimers() { for (const id of H.timers) clearInterval(id); H.timers = []; }

  function startProgress(expectMs) {
    H.p = 0.02;
    hero.style.setProperty('--p', String(H.p));
    const k = 1 - Math.pow(0.08, 100 / expectMs); // reaches about 92% of the way at the expected time
    H.timers.push(setInterval(() => { H.p += (0.94 - H.p) * k; hero.style.setProperty('--p', H.p.toFixed(3)); }, 100));
  }
  function startLive(keys, every) {
    const live = $('home-live');
    let i = 0;
    const show = () => { live.textContent = ''; live.appendChild(el('span', null, t(keys[i % keys.length]))); i++; };
    show();
    if (keys.length > 1) H.timers.push(setInterval(show, every));
  }

  const ART = { x: 84, y: 44, w: 416, h: 364 };
  function placeHero(snap) {
    if (home.hidden) return;
    const name = H.s === 'result' ? 'result' : H.s === 'done' ? 'done' : 'stage';
    const slot = home.querySelector('[data-slot="' + name + '"]');
    const a = home.getBoundingClientRect();
    const b = slot.getBoundingClientRect();
    if (!b.width || !b.height) return;
    // the slot is filled by the artwork itself (drive, mop and floor shadow: ART inside the 520 x 440 canvas)
    const scale = Math.min(b.width / ART.w, b.height / ART.h);
    const x = b.left - a.left + (b.width - ART.w * scale) / 2 - ART.x * scale;
    const y = b.top - a.top + (b.height - ART.h * scale) / 2 - ART.y * scale;
    hero.classList.toggle('snap', !!snap);
    hero.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + scale.toFixed(4) + ')';
    if (snap) { void hero.offsetWidth; hero.classList.remove('snap'); }
  }
  // How many group tiles fit: four on a wide window, three on a normal one, two at the minimum size (plus the keep box).
  const tileRoom = () => (innerWidth >= 1400 ? 4 : innerWidth >= 1000 ? 3 : 2);
  let tileCap = tileRoom();
  new ResizeObserver(() => {
    placeHero(true);
    const cap = tileRoom();
    if (cap !== tileCap) { tileCap = cap; if (H.s === 'result') renderTiles(false); }
  }).observe(home);

  function setState(s) {
    const wasOnCta = !!document.activeElement && !!document.activeElement.closest && !!document.activeElement.closest('.home > .cta');
    H.s = s;
    home.dataset.s = s; hero.dataset.s = s; app.dataset.s = state.page === 'overview' ? s : '';
    hero.dataset.keep = H.permanent ? '0' : '1'; home.dataset.keep = hero.dataset.keep;
    hero.dataset.joy = s === 'done' && H.joy ? '1' : '0'; // happy eyes and sparkles only after a clean worth celebrating
    app.dataset.joy = hero.dataset.joy;
    $('smart-scan').hidden = !(s === 'idle' || s === 'tidy');
    $('home-stop').hidden = s !== 'scanning';
    $('home-run').hidden = s !== 'result';
    $('done-ok').hidden = s !== 'done';
    // cleaning and putting back: the round button's place shows a turning ring (the backend reports no progress for these)
    const busy = s === 'cleaning' || s === 'undoing';
    $('home-busy').hidden = !busy;
    if (busy) { const lab = t(s === 'cleaning' ? 'e3.busy.clean' : 'e3.busy.undo'); $('home-busy-label').textContent = lab; $('home-busy').setAttribute('aria-label', lab); }
    if (s !== 'scanning' && s !== 'cleaning' && s !== 'undoing') clearTimers();
    if (s === 'idle') hero.style.setProperty('--p', '0');
    if (s === 'result' || s === 'done' || s === 'tidy') hero.style.setProperty('--p', '1');
    renderStage();
    placeHero(false);
    // keep keyboard focus on the one round button when the previous one has just been hidden
    if (wasOnCta) { const next = [$('smart-scan'), $('home-stop'), $('home-run'), $('done-ok')].find((x) => !x.hidden && !x.disabled); if (next) next.focus({ preventScroll: true }); }
  }

  function renderStage() {
    const s = H.s;
    const d = H.keepDays;
    const title = $('home-title'); const line = $('home-line'); const bullets = $('home-bullets'); const live = $('home-live'); const aside = $('home-aside');
    $('smart-scan').firstChild.textContent = t(s === 'idle' ? 'e3.scan' : 'e3.again');
    $('home-stop').firstChild.textContent = t('e3.stop');
    $('home-run').firstChild.textContent = t('e3.run');
    $('home-restart').textContent = t('e3.restart');
    $('done-ok').firstChild.textContent = t('e3.done.ok');
    boxLabel();
    bullets.hidden = s !== 'idle'; live.hidden = !(s === 'scanning' || s === 'cleaning' || s === 'undoing');
    aside.hidden = !(s === 'idle' && H.stopped);
    if (s === 'result' || s === 'done') return;
    const key = s === 'idle' ? 'home' : s;
    title.textContent = t('e3.' + key + '.title');
    line.textContent = s === 'cleaning' ? t(H.permanent ? 'e3.cleaning.linePerm' : 'e3.cleaning.line') : t('e3.' + key + '.line');
    swap(title); swap(line);
    if (s === 'idle' && H.stopped) {
      // Stop only stops waiting: the backend cannot cancel a scan, so say what is really happening.
      aside.textContent = '';
      aside.appendChild(el('span', null, t(H.stopped === 'ready' ? 'e3.stop.ready' : 'e3.stop.running')));
      if (H.stopped === 'ready' && state.scannedAt) aside.appendChild(button('pill glass small', t('e3.stop.show'), () => { H.stopped = ''; showResult(true); }));
    }
    if (s === 'idle') {
      bullets.textContent = '';
      for (const [ic, k] of [['i-shield', 'e3.home.b1'], ['i-eye', 'e3.home.b2'], H.permanent ? ['i-alert', 'e3.home.b3perm'] : ['i-undo', 'e3.home.b3']]) {
        const li = el('li');
        li.append(art(ic, 'b-ic'), el('span', null, t(k, { d })));
        bullets.appendChild(li);
      }
    }
  }

  // The label on the keep box: the undo mark and how long things are kept ("7 天" / "7 days"), from the real setting.
  function boxLabel() {
    const tx = $('box-days');
    const d = H.keepDays;
    tx.textContent = d === 1 ? t('e3.box.day1') : t('e3.box.days', { d });
    tx.setAttribute('font-size', '26');
    let w = 0;
    try { w = tx.getComputedTextLength(); } catch { w = 0; }
    if (!w) w = tx.textContent.length * 15;
    if (w > 70) { tx.setAttribute('font-size', (26 * 70 / w).toFixed(1)); w = 70; } // long wording: smaller type, still inside the label
    const x0 = 75 - (29 + w) / 2;
    $('box-glyph').setAttribute('transform', 'translate(' + x0.toFixed(1) + ' 83)');
    tx.setAttribute('x', (x0 + 29).toFixed(1));
  }

  // ----- scan -----
  async function scan() {
    if (H.s === 'scanning' || H.s === 'cleaning') return;
    const tok = ++H.token;
    const t0 = performance.now();
    state.filter = 'all'; // the home flow always works on the whole list
    H.resNote = '';
    H.stopped = '';
    setState('scanning');
    startProgress(4000);
    startLive(['e3.live.1', 'e3.live.2', 'e3.live.3', 'e3.live.4'], 1150);
    try {
      if (!H.scanP) {
        const p = doScan();
        H.scanP = p;
        // when a scan the user stopped waiting for comes back, the idle screen says so (and offers its result)
        const settle = () => { if (H.scanP === p) H.scanP = null; if (H.stopped) { H.stopped = 'ready'; if (H.s === 'idle') renderStage(); } };
        p.then(settle, settle);
      }
      await H.scanP;
    } catch (e) {
      if (tok === H.token) { setState('idle'); showError(e); }
      return;
    }
    if (tok !== H.token) return;
    const wait = (calm.matches ? 0 : 1300) - (performance.now() - t0); // let the scene be seen even when the scan is instant
    if (wait > 0) await sleep(wait);
    if (tok !== H.token) return;
    hero.style.setProperty('--p', '1');
    await sleep(calm.matches ? 0 : 380);
    if (tok !== H.token) return;
    showResult(true);
  }
  // Stop puts the screen back at once. The scan itself cannot be cancelled (no backend call for it), so the screen
  // says that it is finishing in the background rather than claiming it was cancelled. It only reads.
  function stop() { H.token++; H.stopped = H.scanP ? 'running' : 'ready'; setState('idle'); $('smart-scan').focus(); }

  // ----- result -----
  const needsAdmin = (i) => i.requiresAdmin && !i.adminScanned && !i.excluded;
  const waiting = (i) => !state.selected.has(i.id) && (isSelectable(i) || needsAdmin(i) || (i.count > 0 && i.blockedBy.length > 0));
  const bytesOf = (list) => list.reduce((a, i) => a + i.bytes, 0);
  function groupsOf() {
    const m = new Map();
    for (const it of state.items) {
      if (!m.has(it.group)) m.set(it.group, { name: it.group, cat: it.category, items: [] });
      m.get(it.group).items.push(it);
    }
    return [...m.values()];
  }
  const OBJ = { system: 'o-drive', browser: 'o-globe', apps: 'o-apps', dev: 'o-stack', game: 'o-rocket', media: 'o-dial', other: 'o-bucket' };
  const objFor = (cat) => OBJ[cat] || 'o-bucket';

  function showResult(fresh) {
    const anything = state.items.some((i) => (i.count > 0 && !i.excluded) || needsAdmin(i));
    if (!state.scannedAt) { setState('idle'); return; }
    if (!anything) { setState('tidy'); return; }
    if (fresh) H.shown = 0;
    setState('result');
    renderResult(true);
  }

  function renderResult(animate) {
    const total = bytesOf(selectedItems());
    const title = $('res-title');
    title.textContent = '';
    if (total > 0) {
      const parts = t('e3.res.title', { size: '\u0000' }).split('\u0000');
      const num = el('b');
      title.append(document.createTextNode(parts[0]), num, document.createTextNode(parts[1] || ''));
      countTo(num, animate ? 0 : H.shown, total, animate ? 1100 : 450, fmt);
    } else title.textContent = t('e3.res.titleNone');
    H.shown = total;
    // everything the scan found that could be cleared (the title counts only what is ticked); shown when the two differ
    const found = bytesOf(state.items.filter(isSelectable));
    $('reclaim').textContent = fmt(found);
    $('res-found').textContent = t('e3.res.found');
    $('reclaim').parentNode.classList.toggle('same', found === total);
    $('res-sub').textContent = H.resNote || t('e3.res.sub');
    $('home-run').disabled = total === 0 || state.busy;
    renderTiles(animate);
  }

  function renderTiles(animate) {
    const box = $('tiles');
    box.textContent = '';
    let gs = groupsOf().sort((a, b) => bytesOf(b.items.filter(isSelectable)) - bytesOf(a.items.filter(isSelectable)));
    // Two to four tiles for the groups (by window width); the smaller groups share one 'Other' tile whose Review
    // button opens the sheet, where every group is listed on its own.
    const cap = tileRoom();
    if (gs.length > cap) gs = [...gs.slice(0, cap - 1), { name: t('e3.tile.otherN', { n: gs.length - cap + 1 }), cat: 'other', merged: true, items: gs.slice(cap - 1).flatMap((g) => g.items), first: gs[cap - 1].name, n: gs.length - cap + 1 }];
    box.dataset.n = String(gs.length + (H.permanent ? 0 : 1));
    let n = 0;
    for (const g of gs) {
      const can = g.items.filter(isSelectable);
      const sel = can.filter((i) => state.selected.has(i.id));
      const more = g.items.filter(waiting).length;
      const tile = el('div', 'tile' + (can.length && !sel.length ? ' off' : ''));
      tile.style.setProperty('--n', String(n++));
      if (!animate) tile.style.animation = 'none';
      tile.appendChild(art(objFor(g.cat), 'peek'));
      const top = el('div', 'tile-top');
      if (can.length) {
        top.appendChild(check(sel.length > 0, g.name, (on) => {
          if (on) {
            const back = H.memo.get(g.name) || can.filter((i) => i.default).map((i) => i.id);
            if (!back.length) { openReview(g.merged ? g.first : g.name); return; }
            for (const id of back) if (can.some((i) => i.id === id)) state.selected.add(id);
          } else {
            H.memo.set(g.name, sel.map((i) => i.id));
            for (const i of g.items) state.selected.delete(i.id);
          }
          updateActionBar();
          renderResult(false);
          const again = [...box.querySelectorAll('.chk')].find((x) => x.getAttribute('aria-label') === g.name);
          if (again) again.focus();
        }));
      }
      top.appendChild(el('span', null, g.name));
      tile.appendChild(top);
      const big = el('div', 'tile-big' + (can.length ? '' : ' txt'), can.length ? fmt(bytesOf(sel.length ? sel : can)) : t('e3.tile.clean'));
      tile.appendChild(big);
      const foot = el('div', 'tile-foot');
      const sub = el('div', 'tile-sub', can.length ? t(sel.length ? 'e3.tile.toClean' : 'e3.tile.skip') : (more ? '' : t('e3.tile.cleanSub')));
      if (more) sub.appendChild(el('em', null, t('e3.tile.more', { n: more })));
      foot.appendChild(sub);
      const rv = button('pill glass small', t('e3.tile.review'), () => openReview(g.merged ? g.first : g.name, rv));
      rv.setAttribute('aria-label', t('e3.tile.review') + ' ' + g.name);
      foot.appendChild(rv);
      tile.appendChild(foot);
      box.appendChild(tile);
    }
    if (!H.permanent) {
      const tile = el('div', 'tile keep');
      tile.style.setProperty('--n', String(n++));
      if (!animate) tile.style.animation = 'none';
      tile.appendChild(art('o-box', 'peek'));
      const top = el('div', 'tile-top'); top.appendChild(el('span', null, t('e3.tile.keep')));
      const big = el('div', 'tile-big txt', t('e3.tile.keepBig', { d: H.keepDays }));
      const foot = el('div', 'tile-foot');
      foot.appendChild(el('div', 'tile-sub', t('e3.tile.keepSub')));
      const open = button('pill glass small', t('e3.tile.keepOpen'), () => openPage('history'));
      open.setAttribute('aria-label', t('e3.tile.keepOpen') + ' ' + t('e3.tile.keep'));
      foot.appendChild(open);
      tile.append(top, big, foot);
      box.appendChild(tile);
    }
  }

  // ----- review sheet -----
  let rvOpener = null;
  function openReview(group, opener) {
    rvOpener = opener || document.activeElement;
    H.rvGroup = group;
    const r = $('review');
    r.hidden = false;
    renderReview();
    void r.offsetWidth;
    r.classList.add('open');
    $('rv-back').focus();
  }
  function closeReview() {
    const r = $('review');
    if (r.hidden) return;
    r.classList.remove('open');
    setTimeout(() => { r.hidden = true; }, calm.matches ? 0 : 300);
    if (H.s === 'result') renderResult(false);
    const back = [...document.querySelectorAll('#tiles .pill')].find((b) => rvOpener && b.getAttribute('aria-label') === rvOpener.getAttribute('aria-label'));
    if (back) back.focus();
  }
  function rvSummary() {
    const sel = selectedItems();
    $('rv-sum').textContent = sel.length ? t('e3.rv.sum', { n: sel.length, size: fmt(bytesOf(sel)) }) : t('e3.rv.none');
    for (const b of $('rv-groups').children) {
      const g = groupsOf().find((x) => x.name === b.dataset.key);
      if (g) b.lastChild.textContent = fmt(bytesOf(g.items.filter((i) => state.selected.has(i.id) && isSelectable(i))));
    }
  }
  function renderReview() {
    const gs = groupsOf();
    if (!gs.length) { closeReview(); return; }
    if (!gs.some((g) => g.name === H.rvGroup)) H.rvGroup = gs[0].name;
    $('rv-title').textContent = t('e3.rv.title');
    $('rv-back').lastChild.textContent = t('e3.rv.back');
    $('rv-done').textContent = t('e3.rv.done');
    const side = $('rv-groups');
    side.textContent = '';
    for (const g of gs) {
      const b = el('button', 'rv-g' + (g.name === H.rvGroup ? ' on' : ''));
      b.type = 'button';
      b.dataset.key = g.name;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(g.name === H.rvGroup));
      b.append(art(objFor(g.cat)), el('span', null, g.name), el('small'));
      b.addEventListener('click', () => { H.rvGroup = g.name; renderReview(); const again = [...side.children].find((x) => x.dataset.key === g.name); if (again) again.focus(); });
      side.appendChild(b);
    }
    const list = $('rv-list');
    list.textContent = '';
    for (const it of gs.find((g) => g.name === H.rvGroup).items) {
      const ok = isSelectable(it);
      const row = el('div', 'rv-row' + (ok ? '' : ' dis'));
      const cb = check(ok && state.selected.has(it.id), it.name, (on) => { if (on) state.selected.add(it.id); else state.selected.delete(it.id); updateActionBar(); rvSummary(); });
      cb.disabled = !ok;
      const mid = el('div');
      const name = el('div', 'rv-name', it.name);
      if (it.risk !== 'safe') name.appendChild(riskTag(it.risk));
      mid.append(name, el('div', 'rv-desc', it.description));
      if (it.excluded) mid.appendChild(el('div', 'rv-note quiet', t('ex.excludedNote')));
      else if (it.blockedBy.length) mid.appendChild(el('div', 'rv-note bad', t('cl.closeFirst', { apps: it.blockedBy.join(', ') })));
      else if (it.adminError) mid.appendChild(el('div', 'rv-note bad', it.adminError));
      else if (needsAdmin(it)) {
        const note = el('div', 'rv-note', t('cl.admin'));
        const b = el('button', 'btn small', t('cl.scanAdmin'));
        b.type = 'button';
        b.addEventListener('click', () => scanAdminFor(it, b));
        note.appendChild(b);
        mid.appendChild(note);
      } else if (!it.count) mid.appendChild(el('div', 'rv-note quiet', t('cl.nothing')));
      const side2 = el('div', 'rv-side');
      if (it.count) side2.append(el('div', 'rv-size', fmt(it.bytes)), el('div', 'rv-count', t('cl.files', { n: it.count })));
      const more = el('button', 'rv-more', t('e3.rv.details'));
      more.type = 'button';
      more.addEventListener('click', () => openDrawer(it));
      side2.appendChild(more);
      row.append(cb, mid, side2);
      list.appendChild(row);
    }
    rvSummary();
  }

  // ----- clean -----
  // The home screen does not clean anything itself. Its button calls doClean() in renderer.js (the same function the
  // list page uses: same confirmation, same IPC call, same re-scan) and passes this view, which only draws the scene.
  const cleanView = { t0: 0, started: 0 };
  cleanView.start = (settings) => { // called after the user has confirmed, just before the clean starts
    H.permanent = settings.deleteMode === 'permanent'; H.keepDays = settings.retentionDays;
    cleanView.t0 = performance.now();
    cleanView.started = Date.now();
    H.resNote = '';
    setState('cleaning');
    startProgress(3000);
    startLive(['e3.cleaning.live'], 0);
  };
  cleanView.end = async (out, failure) => { // called when doClean() has finished, whatever happened
    if (failure) { setState('result'); renderResult(false); showError(failure); return; }
    if (out.error === 'quarantine-limit') {
      H.resNote = t('rs.limitMsg', { used: fmt(out.used), wanted: fmt(out.wanted), limit: fmt(out.limit) });
      setState('result'); renderResult(false);
      return;
    }
    const started = cleanView.started;
    const wait = (calm.matches ? 0 : 3100) - (performance.now() - cleanView.t0); // long enough for the last piece to land in the box
    if (wait > 0) await sleep(wait);

    const { totals, results, mode } = out;
    H.freed = totals.freed;
    const names = (pred) => results.filter(pred).map((r) => r.name).join(', ');
    const notes = [];
    if (totals.failed) notes.push(t('rs.inUse', { n: totals.failed }));
    const running = names((r) => r.skipped && !r.reason);
    if (running) notes.push(t('rs.running', { names: running }));
    for (const [reason, key] of [['denied', 'rs.denied'], ['elevation-failed', 'rs.elevFailed'], ['portable', 'rs.portable'], ['different-account', 'rs.otherAccount'], ['timeout', 'rs.timeout'], ['quarantine-limit', 'rs.limit']]) {
      const n = names((r) => r.reason === reason);
      if (n) notes.push(t(key, { names: n }));
    }
    let sum = 0;
    try {
      const ev = await window.bytemop.history(200);
      sum = ev.filter((e) => (e.type === 'clean' || e.type === 'leftover') && e.freed > 0).reduce((a, e) => a + e.freed, 0);
      if (!ev.some((e) => e.type === 'clean' && e.ts >= started - 1000)) sum += totals.freed; // the record of this clean may not be listed yet
    } catch { sum = 0; }
    if (sum > totals.freed) notes.push(t('e3.done.total', { size: fmt(sum) }));

    H.done = { some: totals.deleted > 0, freed: totals.freed, mode, notes };
    H.joy = H.done.some && totals.freed >= JOY_BYTES;
    renderDone();
    setState('done');
    if (H.done.some) countTo($('done-size'), 0, totals.freed, 1200, fmt);
    if (state.page === 'overview') $('done-ok').focus();
  };
  // The screen after a clean. Its headline is the fact (how much was cleared). A small amount is reported calmly and
  // honestly; only a clean of JOY_BYTES or more is celebrated (happy eyes, sparkles).
  const JOY_BYTES = 10 * 1024 * 1024;
  function renderDone() {
    const dn = H.done;
    if (!dn) return;
    $('done-title').classList.toggle('plain', !dn.some);
    $('done-what').textContent = t(dn.some ? 'e3.done.cleared' : 'e3.done.titleNone');
    const size = $('done-size');
    cancelAnimationFrame(size._raf || 0);
    size.hidden = !dn.some;
    size.style.minWidth = '';
    size.textContent = fmt(dn.freed);
    if (dn.some && size.offsetWidth) size.style.minWidth = size.offsetWidth + 'px'; // the count-up never changes the layout
    const sub = $('done-sub');
    sub.textContent = dn.some && !H.joy ? t('e3.done.small') : '';
    sub.hidden = !sub.textContent;
    const line = $('done-line');
    line.textContent = dn.some ? t(dn.mode === 'quarantine' ? 'e3.done.line' : 'e3.done.linePerm', { d: H.keepDays }) : '';
    line.hidden = !line.textContent;
    const box = $('done-notes');
    box.textContent = '';
    for (const n of dn.notes) box.appendChild(el('div', null, n));
    box.hidden = !dn.notes.length;
    const u = $('done-undo');
    u.textContent = '';
    u.append(art('i-undo'), el('span', null, t('e3.done.undo')));
    u.hidden = !state.lastRunIds.length;
    u.disabled = false;
    const log = $('done-log');
    log.textContent = '';
    log.append(art('i-doc'), el('span', null, t('e3.done.log')));
  }

  async function undo() {
    const ids = state.lastRunIds;
    if (!ids.length || state.busy) return;
    state.busy = true;
    const t0 = performance.now();
    $('done-undo').disabled = true;
    // the scene plays the clean backwards: the box opens and the pieces come back out onto the floor
    setState('undoing');
    startLive(['e3.undoing.live'], 0);
    let msg = '';
    let failed = false;
    try {
      const r = await restoreRuns(ids);
      state.lastRunIds = [];
      msg = restoreMessage(r);
      try {
        state.items = mergeScan(await window.bytemop.scan());
        state.selected = new Set(state.items.filter((i) => i.default && isSelectable(i)).map((i) => i.id));
      } catch { state.scannedAt = null; state.items = []; state.selected = new Set(); }
    } catch (e) {
      failed = true;
      showError(e);
    } finally {
      state.busy = false;
      $('result').hidden = true;
      renderClean();
    }
    if (failed) { renderDone(); setState('done'); return; } // nothing came back: the box and its Undo stay where they were
    const wait = (calm.matches ? 0 : 2300) - (performance.now() - t0); // long enough for the last piece to come back out
    if (wait > 0) await sleep(wait);
    H.resNote = msg ? msg + ' ' + t('e3.res.again') : '';
    H.shown = 0;
    if (!state.scannedAt) { setState('idle'); return; }
    showResult(false);
    if (H.s === 'result') renderResult(true);
  }

  // ----- hooks called by renderer.js -----
  async function homeLoad() {
    try {
      const s = await window.bytemop.getSettings();
      H.keepDays = s.retentionDays; H.permanent = s.deleteMode === 'permanent';
    } catch { /* keep the defaults */ }
    if (H.s === 'idle' || H.s === 'result') state.filter = 'all'; // the tiles and the clean they start always cover the whole list
    if (H.s === 'idle' && state.scannedAt && !state.busy && !H.stopped) { showResult(true); placeHero(true); return; }
    if (H.s === 'result' && !state.scannedAt) H.s = 'idle';
    if (H.s === 'done') renderDone();
    setState(H.s);
    if (H.s === 'result') renderResult(false);
    placeHero(true);
  }
  function sync() {
    if (H.s === 'result' && !state.busy) {
      if (!state.scannedAt) { setState('idle'); return; }
      renderResult(false);
      if (!$('review').hidden) renderReview();
    }
  }
  function reset() {
    $('reclaim').textContent = '—';
    if (H.s === 'scanning' || H.s === 'cleaning' || H.s === 'undoing') return;
    H.stopped = '';
    if (!$('review').hidden) { $('review').classList.remove('open'); $('review').hidden = true; }
    setState('idle');
  }

  $('home-stop').addEventListener('click', stop);
  $('home-run').addEventListener('click', () => { if (H.s === 'result') safely(doClean)(cleanView); });
  $('home-restart').addEventListener('click', () => safely(scan)());
  $('done-ok').addEventListener('click', () => { H.done = null; setState('idle'); $('smart-scan').focus(); }); // Done: back to the idle home, a scan is one click away
  $('done-log').addEventListener('click', () => openPage('history'));
  $('done-undo').addEventListener('click', () => safely(undo)());
  $('rv-back').addEventListener('click', closeReview);
  $('rv-done').addEventListener('click', closeReview);
  $('review').addEventListener('mousedown', (e) => { if (e.target === $('review')) closeReview(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('review').hidden && $('drawer').hidden && !$('modal-root').children.length) closeReview();
  });

  // The object leans a few pixels toward the pointer and the eyes follow it.
  const par = { x: 0, y: 0, tx: 0, ty: 0, raf: 0 };
  function parStep() {
    par.x += (par.tx - par.x) * 0.09; par.y += (par.ty - par.y) * 0.09;
    hero.style.setProperty('--px', par.x.toFixed(3)); hero.style.setProperty('--py', par.y.toFixed(3));
    par.raf = Math.abs(par.tx - par.x) + Math.abs(par.ty - par.y) > 0.002 ? requestAnimationFrame(parStep) : 0;
  }
  home.addEventListener('pointermove', (e) => {
    if (calm.matches) return;
    const r = hero.getBoundingClientRect();
    par.tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 420));
    par.ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / 320));
    if (!par.raf) par.raf = requestAnimationFrame(parStep);
  });
  home.addEventListener('pointerleave', () => { par.tx = 0; par.ty = 0; if (!par.raf) par.raf = requestAnimationFrame(parStep); });

  // ---------- the other sections: one front screen each, then the working page on paper ----------
  // [page, object, button label, the icons of its three statements]. The statements are facts, not options, so each gets
  // a plain line icon that says what it is about (no box, no tick).
  const SECTIONS = [['clean', 'o-bucket', 'e3.scan', ['i-shield', 'i-info', 'i-box']], ['disk', 'o-stack', 'e3.open', ['i-sort', 'i-file', 'i-copy']],
    ['apps', 'o-apps', 'e3.open', ['i-trash', 'i-search', 'i-list']], ['privacy', 'o-shield', 'e3.open', ['i-lock', 'i-user', 'i-alert']],
    ['startup', 'o-rocket', 'e3.open', ['i-power', 'i-undo', 'i-flag']], ['history', 'o-box', 'e3.open', ['i-box', 'i-clock', 'i-doc']],
    ['settings', 'o-dial', 'e3.open', ['i-clock', 'i-calendar', 'i-folder']]];
  // Opening a working page is the moment its data is read (loadPage in renderer.js); the front screen reads nothing.
  function openWork(page, focus) {
    const sec = $('page-' + page);
    if (!sec || page === 'overview') return;
    sec.classList.add('working');
    if (focus) { const h = sec.querySelector('.work h1'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }
  }
  for (const [page, obj, cta, icons] of SECTIONS) {
    const sec = $('page-' + page);
    const work = sec.querySelector('.work');
    const intro = el('div', 'intro');
    const o = el('div', 'obj');
    o.setAttribute('aria-hidden', 'true');
    o.append(art(obj), el('i'), el('i'), el('i'));
    const copy = el('div', 'copy');
    const h = el('h1'); h.dataset.i18n = 'e3.m.' + page + '.title';
    const p = el('p', 'lead'); p.dataset.i18n = 'e3.m.' + page + '.line';
    const ul = el('ul', 'bullets');
    for (const n of [1, 2, 3]) {
      const li = el('li');
      const s = el('span'); s.dataset.i18n = 'e3.m.' + page + '.b' + n;
      li.append(art(icons[n - 1], 'b-ic'), s); ul.appendChild(li);
    }
    copy.append(h, p, ul);
    const bar = el('div', 'cta');
    const b = el('button', 'round'); b.type = 'button';
    const lab = el('span'); lab.dataset.i18n = cta;
    b.appendChild(lab);
    b.addEventListener('click', () => {
      openWork(page, true);
      if (page === 'clean') { if (!state.scannedAt) safely(doScan)(); } // the button says Scan, so it scans
      else loadPage(page);
    });
    bar.appendChild(b);
    intro.append(o, copy, bar);
    sec.insertBefore(intro, work);
  }
  // Called by go(). Returns true when the section's working page is showing (so its data may be read).
  function onPage(page, again) {
    app.dataset.page = page;
    document.documentElement.dataset.page = page; // dialogs and the drawer sit outside .app and take the section's accent too
    app.dataset.s = page === 'overview' ? H.s : '';
    const sec = $('page-' + page);
    if (page === 'overview' || !sec) return false;
    // Settings and Undo & Records are places you go to, not jobs you start: they open straight away (they read only Bytemop's own data).
    if (page === 'settings' || page === 'history') sec.classList.add('working');
    else if (again) sec.classList.remove('working');
    return sec.classList.contains('working');
  }

  // What a dialog shows above its title: the current section's object, or a caution mark for actions that cannot be undone.
  const PAGE_OBJ = { overview: 'o-box', clean: 'o-box', disk: 'o-stack', apps: 'o-apps', privacy: 'o-shield', startup: 'o-rocket', history: 'o-box', settings: 'o-dial' };
  function dialogArt(danger) {
    const w = el('div', 'modal-art' + (danger ? ' danger' : ''));
    w.setAttribute('aria-hidden', 'true');
    w.appendChild(art(danger ? 'i-alert' : (PAGE_OBJ[state.page] || 'o-drive')));
    return w;
  }

  // Enter starts the one round button of the screen when nothing else has the focus (never while a dialog, a sheet,
  // the drawer or the welcome guide is open, and never the Stop button).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    if (!$('welcome').hidden || !$('drawer').hidden || $('modal-root').children.length || !$('review').hidden) return;
    const sec = $('page-' + state.page);
    if (!sec || sec.classList.contains('working')) return;
    const b = [...sec.querySelectorAll('.cta .round')].find((x) => !x.hidden && !x.disabled && !x.classList.contains('quiet') && x.offsetParent !== null);
    if (b) { e.preventDefault(); b.focus(); b.click(); }
  });

  // Tab stays inside the review sheet while it is open (it is a modal dialog).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || $('review').hidden || !$('drawer').hidden || $('modal-root').children.length) return;
    const f = [...$('review').querySelectorAll('button:not(:disabled)')];
    if (!f.length) return;
    const first = f[0]; const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!$('review').contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  });

  window.E3 = { homeLoad, scan, sync, reset, onPage, open: (page) => openWork(page, false), art, objFor, dialogArt };
})();
