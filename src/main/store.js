'use strict';
// Atomic JSON store. Writes go to a temp file, are flushed to disk, then renamed
// over the real file, so a crash or power cut mid-save can never leave a half-
// written accounts or settings file. Only a file that really isn't JSON is moved
// aside (never deleted). A file Windows or antivirus is holding for a moment is
// read again; if it still can't be read, the store won't save over it.
const fs = require('fs');
const path = require('path');

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function deepMerge(defaults, value) {
  if (!isPlainObject(defaults)) return value === undefined ? defaults : value;
  const out = {};
  const src = isPlainObject(value) ? value : {};
  for (const k of Object.keys(defaults)) out[k] = deepMerge(defaults[k], src[k]);
  for (const k of Object.keys(src)) if (!(k in defaults)) out[k] = src[k];
  return out;
}

/** Waits ms without returning to the event loop (for the few retries a save or load needs). */
const pause = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no wait */ } };
/** Errors that mean "busy right now", not "broken" (antivirus, backup or indexing tools on Windows). */
const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN', 'EMFILE', 'ENFILE']);

function readWithRetry(file, tries = 5) {
  for (let i = 0; ; i++) {
    try { return fs.readFileSync(file, 'utf8'); } catch (err) {
      if (!BUSY.has(err.code) || i + 1 >= tries) throw err;
      pause(60 * (i + 1));
    }
  }
}

// The newest store for each file, so admin snapshots can write pending changes first.
const LATEST = new Map();

class JsonStore {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.defaults = defaults;
    this.readOnly = false;
    this.data = this._load();
    this._timer = null;
    this._pending = false;
    this._failures = 0;
    LATEST.set(path.resolve(filePath), this);
  }

  _load() {
    let raw;
    try { raw = readWithRetry(this.filePath); } catch (err) {
      if (err.code === 'ENOENT') return this._fromTmp() || structuredClone(this.defaults);
      // Can't be read (still locked, no permission): keep going with defaults in memory,
      // but never save them over the real file.
      this.readOnly = true;
      this.loadError = err.code || err.message;
      return structuredClone(this.defaults);
    }
    // A file saved by Notepad can start with a byte-order mark; JSON.parse doesn't accept it.
    try { return deepMerge(this.defaults, JSON.parse(raw.replace(/^\uFEFF/, ''))); } catch {
      // Not JSON (cut short by a power cut, edited by hand...): keep it aside, use the last
      // write that was in progress if that one is whole, else start from the defaults.
      try { fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`); } catch { /* ignore */ }
      return this._fromTmp() || structuredClone(this.defaults);
    }
  }

  _fromTmp() {
    try { return deepMerge(this.defaults, JSON.parse(fs.readFileSync(`${this.filePath}.tmp`, 'utf8'))); } catch { return null; }
  }

  get(key) {
    if (!key) return this.data;
    return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.data);
  }

  set(key, value) {
    const parts = key.split('.');
    let o = this.data;
    for (const p of parts.slice(0, -1)) {
      if (!isPlainObject(o[p])) o[p] = {};
      o = o[p];
    }
    o[parts.at(-1)] = value;
    this.saveSoon();
  }

  replace(data) { this.data = data; this.saveSoon(); }

  saveSoon(delay = 250) {
    clearTimeout(this._timer);
    this._pending = true;
    this._timer = setTimeout(() => {
      try { this.saveNow(); this._failures = 0; } catch (err) {
        // Busy file or full disk: try again shortly (the data is still in memory).
        this._failures++;
        try { require('./logger').scope('store').warn(`Couldn't save ${path.basename(this.filePath)} (${err.code || err.message}); trying again`); } catch { /* logger not ready */ }
        if (this._failures < 30) this.saveSoon(Math.min(30_000, 1000 * this._failures));
      }
    }, delay);
  }

  saveNow() {
    clearTimeout(this._timer);
    if (this.readOnly) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, JSON.stringify(this.data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    for (let i = 0; ; i++) {
      try { fs.renameSync(tmp, this.filePath); this._pending = false; return; } catch (err) {
        if (!BUSY.has(err.code) || i >= 4) throw err;
        pause(50 * (i + 1));
      }
    }
  }
}

/** Writes every store with unsaved changes now. Returns how many were written. */
function flushAll() {
  let n = 0;
  for (const st of LATEST.values()) {
    if (!st._pending || st.readOnly) continue;
    try { st.saveNow(); n++; } catch { /* the normal retry keeps going */ }
  }
  return n;
}

module.exports = { JsonStore, deepMerge, flushAll };
