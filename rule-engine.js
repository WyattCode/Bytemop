'use strict';
// M2 rule engine: schema validation and rule-pack loading. No Electron imports.
const fs = require('fs');
const path = require('path');

const CATEGORIES = ['system', 'browser', 'app', 'dev', 'privacy'];
const RISKS = ['safe', 'caution', 'advanced'];
const ACTIONS = ['files']; // more actions (recycle-bin, dns-cache) arrive with later modules
const LOCALES = ['zh-CN', 'en'];
const ID_RE = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// A target path must start with one of these (compared case-insensitively) and go deeper.
const ALLOWED_ROOTS = ['%LOCALAPPDATA%', '%APPDATA%', '%TEMP%', '%TMP%', '%ProgramData%', '%SystemRoot%\\Temp'];

// These roots are already a dedicated temp folder, so they may be targeted directly.
const SPECIFIC_ROOTS = ['%TEMP%', '%TMP%', '%SystemRoot%\\Temp'];

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function nonEmptyStr(v) { return typeof v === 'string' && v.trim().length > 0; }

function validateLocalized(value, field, errors) {
  if (!isObj(value)) { errors.push(`${field} must be an object with ${LOCALES.join(' and ')}`); return; }
  for (const l of LOCALES) if (!nonEmptyStr(value[l])) errors.push(`${field}.${l} is required`);
}

function validateTarget(t, i, errors) {
  const f = `targets[${i}]`;
  if (!isObj(t)) { errors.push(`${f} must be an object`); return; }
  if (!nonEmptyStr(t.path)) { errors.push(`${f}.path is required`); return; }
  const norm = t.path.replace(/\//g, '\\');
  if (norm.split('\\').includes('..')) errors.push(`${f}.path must not contain ".."`);
  if (/^\\\\/.test(norm)) errors.push(`${f}.path must not be a network (UNC) path`);
  const lowerNorm = norm.toLowerCase();
  const exactRoot = SPECIFIC_ROOTS.find((r) => lowerNorm === r.toLowerCase());
  const root = exactRoot || ALLOWED_ROOTS.find((r) => lowerNorm.startsWith(r.toLowerCase() + '\\'));
  if (!root) errors.push(`${f}.path must be inside one of: ${ALLOWED_ROOTS.join(', ')}`);
  else if (!exactRoot) {
    const rest = norm.slice(root.length).split('\\').filter(Boolean);
    if (rest.length === 0) errors.push(`${f}.path must be deeper than its root`);
    // A wildcard as the very first segment would make the target too broad.
    else if (rest[0].includes('*')) errors.push(`${f}.path must name a concrete folder right after ${root}`);
  }
  if (t.recurse !== undefined && typeof t.recurse !== 'boolean') errors.push(`${f}.recurse must be boolean`);
  for (const k of ['include', 'exclude']) {
    if (t[k] !== undefined && !(Array.isArray(t[k]) && t[k].every(nonEmptyStr))) errors.push(`${f}.${k} must be an array of non-empty strings`);
  }
}

// Returns an array of human-readable problems; empty means valid.
function validateRule(rule) {
  const errors = [];
  if (!isObj(rule)) return ['rule must be an object'];
  if (!nonEmptyStr(rule.id) || !ID_RE.test(rule.id)) errors.push('id must be lowercase letters/digits separated by "." or "-"');
  validateLocalized(rule.name, 'name', errors);
  validateLocalized(rule.description, 'description', errors);
  if (!CATEGORIES.includes(rule.category)) errors.push(`category must be one of ${CATEGORIES.join(', ')}`);
  if (!RISKS.includes(rule.risk)) errors.push(`risk must be one of ${RISKS.join(', ')}`);
  if (typeof rule.defaultSelected !== 'boolean') errors.push('defaultSelected must be boolean');
  if (typeof rule.requiresAdmin !== 'boolean') errors.push('requiresAdmin must be boolean');
  if (rule.defaultSelected === true && (rule.risk !== 'safe' || rule.requiresAdmin === true)) {
    errors.push('only safe, non-admin rules may be selected by default');
  }
  if (rule.blockedByProcesses !== undefined &&
      !(Array.isArray(rule.blockedByProcesses) && rule.blockedByProcesses.every((p) => nonEmptyStr(p) && /\.exe$/i.test(p)))) {
    errors.push('blockedByProcesses must be an array of .exe names');
  }
  if (rule.minAgeHours !== undefined && !(Number.isFinite(rule.minAgeHours) && rule.minAgeHours >= 0)) errors.push('minAgeHours must be a number >= 0');
  if (!ACTIONS.includes(rule.action)) errors.push(`action must be one of ${ACTIONS.join(', ')}`);
  if (!Array.isArray(rule.targets) || rule.targets.length === 0) errors.push('targets must be a non-empty array');
  else rule.targets.forEach((t, i) => validateTarget(t, i, errors));
  if (!nonEmptyStr(rule.since) || !SEMVER_RE.test(rule.since)) errors.push('since must be a semver string like 1.0.0');
  return errors;
}

// Validate a whole pack object. Returns {rules, errors:[{pack,ruleId,problems}]}.
function validatePack(pack, source = 'pack') {
  const out = { rules: [], errors: [] };
  if (!isObj(pack)) { out.errors.push({ pack: source, ruleId: null, problems: ['pack must be an object'] }); return out; }
  const header = [];
  if (!nonEmptyStr(pack.pack)) header.push('"pack" name is required');
  if (!nonEmptyStr(pack.version) || !SEMVER_RE.test(pack.version)) header.push('"version" must be semver');
  if (!Array.isArray(pack.rules)) header.push('"rules" must be an array');
  if (header.length) { out.errors.push({ pack: source, ruleId: null, problems: header }); return out; }
  for (const r of pack.rules) {
    const problems = validateRule(r);
    if (problems.length) out.errors.push({ pack: pack.pack, ruleId: isObj(r) ? r.id ?? null : null, problems });
    else out.rules.push({ ...r, pack: pack.pack, packVersion: pack.version });
  }
  return out;
}

// Load every *.json pack in a directory. Invalid rules/packs are rejected individually;
// duplicate ids keep the first rule and report the rest.
function loadPacks(dir) {
  const result = { rules: [], errors: [], packs: [] };
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort(); }
  catch (e) { result.errors.push({ pack: dir, ruleId: null, problems: [`cannot read rules directory: ${e.message}`] }); return result; }
  const seen = new Set();
  for (const f of files) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '')); }
    catch (e) { result.errors.push({ pack: f, ruleId: null, problems: [`invalid JSON: ${e.message}`] }); continue; }
    const v = validatePack(parsed, f);
    result.errors.push(...v.errors);
    if (v.rules.length || (isObj(parsed) && nonEmptyStr(parsed.pack))) result.packs.push({ pack: parsed.pack, version: parsed.version, file: f, count: v.rules.length });
    for (const r of v.rules) {
      if (seen.has(r.id)) { result.errors.push({ pack: r.pack, ruleId: r.id, problems: ['duplicate rule id'] }); continue; }
      seen.add(r.id);
      result.rules.push(r);
    }
  }
  return result;
}

function pickLocale(obj, locale) {
  if (!isObj(obj)) return '';
  const l = locale && locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
  return obj[l] || obj.en || '';
}

module.exports = { validateRule, validatePack, loadPacks, pickLocale, ALLOWED_ROOTS, CATEGORIES, RISKS };
