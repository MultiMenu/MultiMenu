'use strict';
// Using less CPU and RAM (Settings → Performance):
// - Background checks: MultiMenu's frequent checks (sessions, limiter, tiny windows, popups,
//   the watcher, the network monitor...) run every time, every 2nd time or every 4th time.
// - Pause page updates while hidden: while MultiMenu's window is hidden or minimised, live
//   numbers aren't sent to the page; it gets the latest of each when you open it again.
// - Free MultiMenu's memory when hidden: a minute after the window is hidden, Windows is
//   asked to move MultiMenu's unused memory out of RAM.
// - End Roblox's crash reporters: every Roblox client starts a RobloxCrashHandler.exe that
//   only waits for a crash. Ending them frees a little RAM per client; Roblox then can't
//   send its own crash reports. The clients keep running.
const settings = require('./settings');
const log = require('../logger').scope('lean');

const FACTOR = { normal: 1, relaxed: 2, slow: 4 };

/** Pure: how many ticks to skip per run, from the choice and low-resource mode. */
function factorFor(speed, lowResource) { return Math.max(FACTOR[speed] || 1, lowResource ? 2 : 1); }
function factor() { return factorFor(settings.get('performance.checkSpeed'), settings.get('performance.lowResourceMode')); }

/** Wraps a timer callback so it only runs every factor()-th tick (the first tick always runs).
 *  Changing the setting takes effect at once, no restart. */
function paced(fn) {
  let n = -1;
  return (...a) => {
    n += 1;
    if (n % factor() !== 0) return undefined;
    return fn(...a);
  };
}

// ---------- page updates while hidden ----------
// Events that only show live numbers: while the window is hidden the latest of each waits.
const LIVE = new Set(['system:sample', 'sessions:stats', 'fps:update', 'limiter:update', 'trimmer:update', 'watcher:update', 'netmon:update', 'overlay:update',
  'capacity:update', 'clicker:update', 'macros:update', 'antiafk:update', 'guards:update', 'tiler:update', 'pip:update', 'phone:update', 'autoscale:update',
  'rotation:update', 'api:update', 'updateguard:update', 'presence:update', 'launchqueue:changed', 'admin:feed', 'checklist:update']);
const held = new WeakMap(); // window -> Map(event -> payload)
const hooked = new WeakSet();

function hiddenWin(w) { try { return !w.isVisible() || w.isMinimized(); } catch { return false; } }
function flush(w) {
  const m = held.get(w);
  if (!m || !m.size || w.isDestroyed()) return;
  for (const [ev, payload] of m) w.webContents.send(`evt:${ev}`, payload);
  m.clear();
}

/** Sends an event to a window now, or keeps the latest one for when it's shown. */
function send(w, ev, payload) {
  if (!w || w.isDestroyed()) return;
  if (LIVE.has(ev) && settings.get('performance.pauseHidden') !== false && hiddenWin(w)) {
    if (!hooked.has(w)) { hooked.add(w); for (const e of ['show', 'restore']) w.on(e, () => setTimeout(() => flush(w), 50)); }
    if (!held.has(w)) held.set(w, new Map());
    held.get(w).set(ev, payload);
    return;
  }
  w.webContents.send(`evt:${ev}`, payload);
}

// ---------- MultiMenu's own memory ----------
let trimTimer = null;
function ownPids() { try { return require('electron').app.getAppMetrics().map(m => m.pid); } catch { return []; } }
/** Asks Windows to move MultiMenu's unused memory out of RAM. Returns MB freed. */
function trimSelf() {
  const win32 = require('../native/win32');
  if (!win32.available) return 0;
  let freed = 0;
  for (const pid of ownPids()) {
    try { const r = win32.trimWorkingSet(pid); if (r.ok) freed += Math.max(0, r.before - r.after); } catch { /* gone */ }
  }
  const mb = Math.round(freed / 1048576);
  if (mb) log.info(`Freed ${mb} MB of MultiMenu's own memory`);
  return mb;
}
/** Called when the main window is hidden or shown. */
function windowHidden(hidden) {
  clearTimeout(trimTimer); trimTimer = null;
  if (hidden && settings.get('performance.trimSelf')) trimTimer = setTimeout(trimSelf, 60_000);
}

// ---------- Roblox crash reporters ----------
const CRASH_HANDLER = 'robloxcrashhandler.exe';
let crashTimer = null;
function endCrashHandlers() {
  if (!settings.get('performance.endCrashHandlers')) return 0;
  const win32 = require('../native/win32');
  let n = 0;
  let procs = [];
  try { procs = require('./processes').snapshot(1000).filter(p => String(p.name).toLowerCase() === CRASH_HANDLER); } catch { return 0; }
  for (const p of procs) { try { if (win32.terminate(p.pid)) n++; } catch { /* no access */ } }
  if (n) log.info(`Ended ${n} Roblox crash reporter${n === 1 ? '' : 's'}`);
  return n;
}
function applyCrashHandlers() {
  clearInterval(crashTimer); crashTimer = null;
  if (process.platform === 'win32' && settings.get('performance.endCrashHandlers')) {
    crashTimer = setInterval(paced(endCrashHandlers), 15_000);
    endCrashHandlers();
  }
}

// The lightest settings in one go (Settings → Performance → Use the least).
const LIGHTEST = {
  'performance.checkSpeed': 'slow', 'performance.pauseHidden': true, 'performance.trimSelf': true, 'performance.lowResourceMode': true,
  'performance.gpuMonitoring': false, 'performance.idleMode': true, 'appearance.pauseUnfocused': true, 'appearance.particles': false,
};
function deepIdleFloor() { const d = Number(settings.get('performance.deepIdleMin')) || 0; return d === 0 || d > 5 ? 5 : d; }

function init() { applyCrashHandlers(); }
function stop() { clearInterval(crashTimer); clearTimeout(trimTimer); }

module.exports = { init, stop, factor, factorFor, paced, send, LIVE, trimSelf, windowHidden, endCrashHandlers, applyCrashHandlers, LIGHTEST, deepIdleFloor };
