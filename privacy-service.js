'use strict';
// Glue between the privacy engine and the app: stores the "keep signed in" list, honours the
// user's exclusions, and writes history. No Electron imports.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const exclusions = require('./exclusions');
const { atomicWrite, createQueue } = require('./atomic');
const { createPrivacy, normalizeSite, MAX_KEEP_SITES } = require('./privacy');

function createPrivacyService({ dataDir, service, env = process.env, running, tmpDir, browsers }) {
  const file = path.join(dataDir, 'privacy.json');
  const serial = createQueue();

  async function keepSites() {
    try {
      const j = JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^﻿/, ''));
      const list = Array.isArray(j.keepSites) ? j.keepSites.map(normalizeSite).filter(Boolean) : [];
      return [...new Set(list)].sort();
    } catch (e) {
      if (e && e.code === 'ENOENT') return []; // never saved yet
      // Unreadable or damaged: refuse to continue rather than treat it as 'keep nothing', which would
      // clear the cookies of sites the user wanted to stay signed in to.
      const err = new Error('keep-list-unreadable');
      err.code = 'KEEP_LIST_UNREADABLE';
      throw err;
    }
  }

  async function saveKeep(list) {
    await fsp.mkdir(dataDir, { recursive: true });
    await atomicWrite(file, JSON.stringify({ keepSites: list }, null, 2));
  }

  // Exclusions are read fresh each time so a just-added one is honoured immediately.
  async function engine() {
    const c = exclusions.compile(await service.listExclusions(), env);
    return createPrivacy({ env, running, tmpDir, browsers, isExcluded: c.isExcluded });
  }

  async function addSite(input) {
    const site = normalizeSite(input);
    if (!site) return { ok: false, error: 'invalid-site' };
    return serial(async () => {
      const list = await keepSites();
      if (list.includes(site)) return { ok: true, site, duplicate: true };
      if (list.length >= MAX_KEEP_SITES) return { ok: false, error: 'too-many' };
      await saveKeep([...list, site].sort());
      return { ok: true, site, duplicate: false };
    });
  }

  async function removeSite(input) {
    const site = normalizeSite(input);
    if (!site) return false;
    return serial(async () => {
      const list = await keepSites();
      if (!list.includes(site)) return false;
      await saveKeep(list.filter((s) => s !== site));
      return true;
    });
  }

  async function scan() {
    const keep = await keepSites();
    return { keepSites: keep, browsers: await (await engine()).scan({ keepSites: keep }) };
  }

  async function sites() { return (await engine()).cookieSites(); }

  async function clean(selection) {
    let keep;
    try { keep = await keepSites(); } catch (e) {
      if (e && e.code === 'KEEP_LIST_UNREADABLE') return { error: 'keep-list-unreadable', results: [], totals: { deleted: 0, failed: 0 } };
      throw e;
    }
    const out = await (await engine()).clean(selection, { keepSites: keep });
    if (out.results.length) {
      await service.logEvent({
        type: 'privacy', deleted: out.totals.deleted, failed: out.totals.failed,
        items: out.results.filter((r) => !r.skipped).map((r) => ({ id: r.id, deleted: r.deleted })),
      });
    }
    return out;
  }

  return { scan, sites, clean, keepSites, addSite, removeSite };
}

module.exports = { createPrivacyService };
