'use strict';
// Exclusions: things the user never wants cleaned. They override every rule.
//   {id, type:'rule', value:<rule id>}                 the whole rule is skipped
//   {id, type:'path', value:<folder|file|pattern>}     matching files (and everything under a matching folder) are kept
// Patterns: '*' matches within one folder level, '**' matches across folders; %VARS% are expanded.
const { expandEnv } = require('./cleaner');
const { canonicalSync } = require('./pathsafe');

const MAX_EXCLUSIONS = 500;
const MAX_LENGTH = 400;

function normalize(p) {
  return String(p).replace(/\//g, '\\').replace(/\\{2,}/g, '\\').replace(/\\+$/, '').toLowerCase();
}

const MAX_MATCH_LENGTH = 4096;

// A pattern becomes a list of tokens: literal characters, '*' (anything except a backslash) and '**'
// (anything). Matching walks the path once per token, so its cost is pattern length x path length, however
// the wildcards are arranged (a regular expression can backtrack for seconds on a crafted pattern).
function compilePattern(pat) {
  const tokens = [];
  for (let i = 0; i < pat.length; i++) {
    // '\\**\\' = a backslash, then zero or more whole folders: 'Downloads\\**\\*.iso' also covers 'Downloads\\x.iso'
    if (pat[i] === '\\' && pat.startsWith('**\\', i + 1) && pat[i + 3] !== '*') {
      tokens.push({ ch: '\\' }, { dirs: true });
      i += 3;
      continue;
    }
    if (pat[i] === '*') {
      if (pat[i + 1] === '*') { while (pat[i + 1] === '*') i++; tokens.push({ any: true }); } else tokens.push({ star: true });
    } else tokens.push({ ch: pat[i] });
  }
  const firstWild = tokens.findIndex((t) => !('ch' in t));
  const literal = tokens.slice(0, firstWild < 0 ? tokens.length : firstWild).map((t) => t.ch).join('');
  return { tokens, literal };
}

// Does the pattern match the whole path, or a leading folder of it? (A match on a folder also covers
// everything inside it.)
function matchPattern({ tokens, literal }, s) {
  if (!s.startsWith(literal)) return false; // cheap rejection for nearly every path
  if (s.length > MAX_MATCH_LENGTH) s = s.slice(0, MAX_MATCH_LENGTH);
  const n = s.length;
  let cur = new Uint8Array(n + 1);
  cur[0] = 1;
  for (const t of tokens) {
    const next = new Uint8Array(n + 1);
    if ('ch' in t) {
      for (let j = 0; j < n; j++) if (cur[j] && s[j] === t.ch) next[j + 1] = 1;
    } else if (t.dirs) {
      // zero folders, or any text ending in a backslash
      let seen = false;
      for (let j = 0; j <= n; j++) {
        next[j] = cur[j] || (j > 0 && s[j - 1] === '\\' && seen) ? 1 : 0;
        if (cur[j]) seen = true;
      }
    } else {
      for (let j = 0; j <= n; j++) {
        if (cur[j] || (j > 0 && next[j - 1] && (t.any || s[j - 1] !== '\\'))) next[j] = 1;
      }
    }
    cur = next;
  }
  for (let j = 0; j <= n; j++) if (cur[j] && (j === n || s[j] === '\\')) return true;
  return false;
}

// Turn a stored list into a fast predicate. Entries whose %VARS% cannot be resolved are ignored.
function compile(list, env = process.env) {
  const exact = [];
  const patterns = [];
  const rules = new Set();
  for (const e of list) {
    if (e.type === 'rule') { rules.add(e.value); continue; }
    if (e.type !== 'path') continue;
    // An entry whose %VAR% cannot be resolved is kept as written rather than dropped: dropping it would silently
    // un-protect a folder (fail closed).
    const expanded = expandEnv(e.value, env) || e.value;
    const n = normalize(expanded);
    if (n.includes('*')) { patterns.push(compilePattern(n)); continue; }
    exact.push(n);
    const real = normalize(canonicalSync(expanded)); // the long, real spelling of a path typed as an 8.3 short name
    if (real !== n) exact.push(real);
  }
  const isExcluded = (filePath) => {
    const p = normalize(filePath);
    for (const x of exact) if (p === x || p.startsWith(x + '\\')) return true;
    for (const pat of patterns) if (matchPattern(pat, p)) return true;
    return false;
  };
  return { isExcluded, rules };
}

// Returns {ok:true, entry:{type,value}} or {ok:false, error:<code>}.
function validate(input, knownRuleIds) {
  if (!input || (input.type !== 'path' && input.type !== 'rule')) return { ok: false, error: 'invalid-type' };
  const value = typeof input.value === 'string' ? input.value.trim() : '';
  if (!value) return { ok: false, error: 'empty' };
  if (value.length > MAX_LENGTH) return { ok: false, error: 'too-long' };
  if (input.type === 'rule') {
    return knownRuleIds.has(value) ? { ok: true, entry: { type: 'rule', value } } : { ok: false, error: 'unknown-rule' };
  }
  const abs = /^[A-Za-z]:[\\/]/.test(value) || /^%[^%]+%/.test(value);
  if (!abs || /^\\\\/.test(value)) return { ok: false, error: 'not-absolute' };
  if (value.split(/[\\/]/).includes('..')) return { ok: false, error: 'not-absolute' };
  return { ok: true, entry: { type: 'path', value: value.replace(/\//g, '\\') } };
}

const sameEntry = (a, b) => a.type === b.type && (a.type === 'rule' ? a.value === b.value : normalize(a.value) === normalize(b.value));

module.exports = { compile, validate, normalize, sameEntry, MAX_EXCLUSIONS };
