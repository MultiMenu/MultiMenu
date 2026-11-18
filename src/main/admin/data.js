'use strict';
// Admin mode: the data inspector, snapshots (with restore and factory reset on the
// next start) and debug bundles. Snapshots stay on this PC; encrypted values in
// them can only be opened by the same Windows user, exactly like the live files.
const fs = require('fs');
const path = require('path');
const paths = require('../paths');
const { flushAll } = require('../store');
const { mask, anonymize, maskString } = require('./mask');

const MAX_SNAPSHOTS = 30;
const adminDir = () => path.join(paths.dataDir, 'admin');
const snapDir = () => path.join(adminDir(), 'snapshots');
const restoreMarker = () => path.join(adminDir(), 'restore-pending.json');
const resetMarker = () => path.join(adminDir(), 'factory-reset-pending.json');
const SKIP = /^(selftest)\.json$/i;

function appVersion() { try { return require('electron').app.getVersion(); } catch { return '?'; } }

/** The JSON files in the data folder that make up MultiMenu's state. */
function dataFiles() {
  try {
    return fs.readdirSync(paths.dataDir, { withFileTypes: true })
      .filter(d => d.isFile() && /^[\w.-]+\.json$/.test(d.name) && !SKIP.test(d.name))
      .map(d => d.name).sort();
  } catch { return []; }
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }

function summarize(j) {
  if (!j || typeof j !== 'object') return { '': typeof j };
  const out = {};
  for (const [k, v] of Object.entries(j).slice(0, 40)) {
    out[k] = Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : v && typeof v === 'object' ? `${Object.keys(v).length} field${Object.keys(v).length === 1 ? '' : 's'}` : typeof v;
  }
  return out;
}

/** Every data file with its size, age and a count of what's inside. */
function stores() {
  flushAll();
  return dataFiles().map((name) => {
    const f = path.join(paths.dataDir, name);
    let st = null, summary = null, error = null;
    try { st = fs.statSync(f); } catch { /* gone */ }
    try { summary = summarize(readJson(f)); } catch (e) { error = e instanceof SyntaxError ? 'Not valid JSON' : e.code || e.message; }
    return { name, bytes: st?.size || 0, mtime: st?.mtimeMs || 0, summary, error };
  });
}

/** One data file with every secret hidden. */
function read(name) {
  if (!dataFiles().includes(name)) throw new Error('Unknown data file.');
  flushAll();
  return mask(readJson(path.join(paths.dataDir, name)));
}

// ---------- snapshots ----------
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'snapshot';
const safeId = (id) => { const s = String(id || ''); if (!/^[\w-]{1,80}$/.test(s)) throw new Error('Unknown snapshot.'); return s; };

function copyDir(src, dst) { if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true }); }
function countFiles(dir) { try { return fs.readdirSync(dir).length; } catch { return 0; } }

/** Copies the current data (and macros) into admin/snapshots/<id>. */
function snapshot(label = 'Manual') {
  flushAll();
  const at = new Date();
  let id = `${stamp(at)}-${slug(label)}`;
  for (let i = 2; fs.existsSync(path.join(snapDir(), id)); i++) id = `${stamp(at)}-${slug(label)}-${i}`;
  const dir = path.join(snapDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  let bytes = 0;
  for (const f of dataFiles()) {
    try { fs.copyFileSync(path.join(paths.dataDir, f), path.join(dir, f)); bytes += fs.statSync(path.join(dir, f)).size; files.push(f); } catch { /* skip a busy file */ }
  }
  copyDir(paths.macrosDir(), path.join(dir, 'macros'));
  const meta = { id, label: String(label).slice(0, 60), at: at.getTime(), version: appVersion(), files, macros: countFiles(path.join(dir, 'macros')), bytes };
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(meta, null, 2));
  prune();
  return meta;
}

function snapshots() {
  let ids = [];
  try { ids = fs.readdirSync(snapDir()); } catch { return []; }
  return ids.map((id) => { try { return { ...readJson(path.join(snapDir(), id, 'snapshot.json')), id }; } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.at - a.at);
}

function prune() {
  for (const s of snapshots().slice(MAX_SNAPSHOTS)) fs.rmSync(path.join(snapDir(), s.id), { recursive: true, force: true });
}

function removeSnapshot(id) {
  fs.rmSync(path.join(snapDir(), safeId(id)), { recursive: true, force: true });
  return snapshots();
}

/** Restoring happens on the next start, before anything has loaded the files. */
function scheduleRestore(id) {
  const dir = path.join(snapDir(), safeId(id));
  if (!fs.existsSync(path.join(dir, 'snapshot.json'))) throw new Error('Unknown snapshot.');
  fs.mkdirSync(adminDir(), { recursive: true });
  fs.writeFileSync(restoreMarker(), JSON.stringify({ id, at: Date.now() }));
  return true;
}

function scheduleFactoryReset() {
  fs.mkdirSync(adminDir(), { recursive: true });
  fs.writeFileSync(resetMarker(), JSON.stringify({ at: Date.now() }));
  return true;
}

function wipeDataFiles() {
  for (const f of dataFiles()) {
    for (const x of [f, `${f}.tmp`]) fs.rmSync(path.join(paths.dataDir, x), { force: true });
  }
  fs.rmSync(paths.macrosDir(), { recursive: true, force: true });
  fs.mkdirSync(paths.macrosDir(), { recursive: true });
}

/** Called at the very start, before any data file is opened. */
function applyPending(log) {
  if (fs.existsSync(resetMarker())) {
    fs.rmSync(resetMarker(), { force: true });
    const keep = snapshot('Before factory reset');
    wipeDataFiles();
    log?.warn(`Admin: factory reset done (the old data is in snapshot ${keep.id})`);
    return 'reset';
  }
  if (fs.existsSync(restoreMarker())) {
    let id = null;
    try { id = safeId(readJson(restoreMarker()).id); } catch { /* bad marker */ }
    fs.rmSync(restoreMarker(), { force: true });
    const dir = id && path.join(snapDir(), id);
    if (!dir || !fs.existsSync(path.join(dir, 'snapshot.json'))) { log?.warn('Admin: the snapshot to restore is gone'); return null; }
    const meta = readJson(path.join(dir, 'snapshot.json'));
    const before = snapshot('Before restore');
    wipeDataFiles();
    for (const f of meta.files || []) {
      if (/^[\w.-]+\.json$/.test(f) && fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(paths.dataDir, f));
    }
    if (fs.existsSync(path.join(dir, 'macros'))) copyDir(path.join(dir, 'macros'), paths.macrosDir());
    log?.warn(`Admin: restored snapshot ${id} (the data before it is in ${before.id})`);
    return 'restore';
  }
  return null;
}

// ---------- debug bundle ----------
function leafDiff(def, cur, prefix = '', out = {}) {
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return out;
  for (const [k, v] of Object.entries(cur)) {
    const key = prefix ? `${prefix}.${k}` : k;
    const d = def && typeof def === 'object' ? def[k] : undefined;
    if (v && typeof v === 'object' && !Array.isArray(v) && d && typeof d === 'object' && !Array.isArray(d)) leafDiff(d, v, key, out);
    else if (JSON.stringify(v) !== JSON.stringify(d)) out[key] = v;
  }
  return out;
}

/** Settings that differ from the defaults, secrets hidden. */
function settingsChanged() {
  const settings = require('../modules/settings');
  const diff = leafDiff(settings.DEFAULTS, settings.all());
  delete diff['updates.history'];
  const out = {};
  for (const [k, v] of Object.entries(diff)) out[k] = mask(v, {}, 0, k.split('.').pop());
  return out;
}

function tail(file, maxBytes) {
  try {
    const st = fs.statSync(file);
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      let text = buf.toString('utf8');
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
      return text;
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

/** The newest log lines, parsed. */
function logLines(n = 400) {
  const logger = require('../logger');
  if (!logger.file) return [];
  const lines = tail(logger.file, 256 * 1024).split(/\r?\n/).filter(Boolean).slice(-n);
  return lines.map((l) => {
    const m = /^(\S+) \[(\w+)\] \[([^\]]*)\] (.*)$/.exec(l);
    return m ? { at: Date.parse(m[1]) || 0, level: m[2], scope: m[3], msg: anonymize(m[4]) } : { at: 0, level: 'INFO', scope: '', msg: anonymize(l) };
  });
}

/**
 * Everything useful for finding a bug, nothing private: masked settings,
 * counts instead of contents, anonymised logs and the admin feeds.
 */
function bundle(extra = {}) {
  const logger = require('../logger');
  flushAll();
  let accounts = null, sessions = null;
  try {
    const raw = require('../modules/accounts').raw();
    const list = raw.accounts || [];
    const health = {};
    for (const a of list) { const h = a.health?.state || a.status || 'unknown'; health[h] = (health[h] || 0) + 1; }
    accounts = { count: list.length, withLogin: list.filter(a => !!a.cookieEnc).length, groups: (raw.groups || []).length, bin: (raw.bin || []).length, health };
  } catch { /* not loaded */ }
  try {
    sessions = require('../modules/sessions').listSessions().map(s => ({ status: s.status, placeId: s.placeId, startedAt: s.startedAt, memMB: s.memMB, cpu: s.cpu, external: s.external, watch: s.watch, error: s.error ? maskString(s.error) : null }));
  } catch { /* not loaded */ }
  let selftest = null;
  try { selftest = mask(readJson(paths.file('selftest.json'))); } catch { /* never ran */ }
  const log = (f, bytes) => anonymize(logger.redact(tail(f, bytes)));
  return {
    format: 'multimenu-debug', version: 1, createdAt: new Date().toISOString(),
    ...extra,
    settingsChanged: settingsChanged(),
    data: stores().map(s => ({ name: s.name, bytes: s.bytes, mtime: s.mtime, summary: s.summary, error: s.error })),
    accounts, sessions, selftest,
    log: logger.file ? log(logger.file, 1536 * 1024) : '',
    previousLog: logger.file ? log(`${logger.file}.1`, 256 * 1024) : '',
  };
}

module.exports = { adminDir, dataFiles, stores, read, snapshot, snapshots, removeSnapshot, scheduleRestore, scheduleFactoryReset, applyPending, bundle, logLines, settingsChanged, leafDiff, tail };
