'use strict';
// Small file logger with rotation. Every line passes through redact() so cookies,
// auth tickets and webhook tokens can never end up on disk.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 2 * 1024 * 1024;
let logFile = null;
let verbose = false;
const listeners = new Set(); // admin mode's live log view

function redact(input) {
  let s = typeof input === 'string' ? input : safeJson(input);
  s = s.replace(/_\|WARNING:-DO-NOT-SHARE-THIS[^\s"';]*/g, '[REDACTED_COOKIE]');
  s = s.replace(/\.ROBLOSECURITY=[^\s;"']+/gi, '.ROBLOSECURITY=[REDACTED]');
  s = s.replace(/(api\/webhooks\/\d+\/)[\w-]+/g, '$1[REDACTED]');
  s = s.replace(/(-t |gameinfo:|rbx-authentication-ticket["':\s]+)[A-Za-z0-9+/=_-]{20,}/gi, '$1[REDACTED_TICKET]');
  return s;
}

function safeJson(v) {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'multimenu.log');
}

function rotate() {
  try {
    const st = fs.statSync(logFile);
    if (st.size > MAX_BYTES) {
      const old = logFile + '.1';
      try { fs.unlinkSync(old); } catch { /* none */ }
      fs.renameSync(logFile, old);
    }
  } catch { /* file not created yet */ }
}

function write(level, scope, args) {
  const msg = args.map(a => (typeof a === 'string' ? a : safeJson(a))).join(' ');
  const at = new Date();
  const clean = redact(msg);
  const line = `${at.toISOString()} [${level}] [${scope}] ${clean}`;
  if (process.env.MULTIMENU_DEBUG || !require('electron').app?.isPackaged) console.log(line);
  for (const fn of listeners) { try { fn({ at: at.getTime(), level, scope, msg: clean }); } catch { /* a listener must never break logging */ } }
  if (!logFile) return;
  rotate();
  try { fs.appendFileSync(logFile, line + '\n'); } catch { /* disk issues should never crash the app */ }
}

function scope(name) {
  return {
    /** Only written while verbose logging is on (admin mode). */
    debug: (...a) => { if (verbose) write('DEBUG', name, a); },
    info: (...a) => write('INFO', name, a),
    warn: (...a) => write('WARN', name, a),
    error: (...a) => write('ERROR', name, a),
  };
}

/** Calls fn({ at, level, scope, msg }) for every line written (already redacted). Returns an unsubscribe function. */
function onLine(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setVerbose(on) { verbose = !!on; }

module.exports = { init, scope, redact, onLine, setVerbose, get verbose() { return verbose; }, get file() { return logFile; } };
