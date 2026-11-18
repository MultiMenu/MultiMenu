'use strict';
// Background limiter. Every few seconds: the Roblox window you're looking at
// gets normal (or higher) CPU priority; every other Roblox client gets lower
// priority, can be restricted to a few CPU cores, and can be muted. Turning the
// limiter off puts every client back to normal.
const os = require('os');
const win32 = require('../native/win32');
const settings = require('./settings');
const processes = require('./processes');
const audio = require('./audio');
const bus = require('../bus');
const log = require('../logger').scope('limiter');

const state = { running: false, timer: null, applied: new Map(), focusedPid: null, lastError: null, muted: new Set(), eco: new Set() };
const boosted = new Map(); // pid -> until: treated like the window you're using for a while

/** Lifts every limit off one client for a while (the watcher does this before it calls a
 *  client frozen: one starved of CPU looks frozen to Windows but only needs a moment). */
function boost(pid, ms = 120_000) {
  if (!pid) return;
  boosted.set(pid, Date.now() + ms);
  if (state.running) { try { apply(); } catch (e) { state.lastError = e.message; } }
}

/** Pids of clients whose account is Main tier: they are treated like the window you're using. */
function mainPids() {
  try {
    const accounts = require('./accounts');
    return new Set(require('./sessions').listSessions().filter(s => s.pid && s.accountId && accounts.publicView(accounts.find(s.accountId) || {}).tier === 'main').map(s => s.pid));
  } catch { return new Set(); }
}

/** Mask with the LAST n logical cores (leaves core 0, which Windows favours, to the foreground). */
function backgroundMask(n, cores = os.cpus().length) {
  const c = Math.min(52, cores);
  const k = Math.max(1, Math.min(c, n));
  let mask = 0;
  for (let i = c - k; i < c; i++) mask += 2 ** i;
  return mask;
}
const RANK = ['idle', 'below', 'normal', 'above', 'high'];
/** Pure: the lower of two priority classes. */
function lower(a, b) { return RANK.indexOf(a) >= 0 && RANK.indexOf(a) < RANK.indexOf(b) ? a : b; }
function fullMask(cores = os.cpus().length) { let m = 0; for (let i = 0; i < Math.min(52, cores); i++) m += 2 ** i; return m; }

function apply() {
  const c = settings.get('limiter');
  const fg = win32.foregroundPid();
  const procs = processes.robloxProcesses();
  state.focusedPid = procs.some(p => p.pid === fg) ? fg : null;
  const bgMask = c.limitCores ? backgroundMask(c.backgroundCores) : fullMask();
  const toMute = [], toUnmute = [];
  const mains = mainPids();
  const now = Date.now();
  for (const [pid, until] of boosted) if (until < now) boosted.delete(pid);
  for (const p of procs) {
    const focused = p.pid === fg || mains.has(p.pid) || boosted.has(p.pid);
    // Eco mode: background alts get Windows' efficiency mode and below-normal priority.
    // (Not "idle": an idle-priority client gets no CPU at all while the PC is busy, so
    // it lags, stops responding and gets restarted when lots of clients hatch at once.)
    const eco = !!c.eco && !focused;
    const want = { priority: focused ? c.focusedPriority : eco ? lower(c.backgroundPriority, 'below') : c.backgroundPriority, mask: focused ? fullMask() : bgMask, mute: !focused && c.muteBackground, eco };
    const prev = state.applied.get(p.pid);
    try {
      if (!prev || prev.priority !== want.priority) win32.setPriority(p.pid, want.priority);
      if (!prev || prev.mask !== want.mask) win32.setAffinity(p.pid, want.mask);
      if (!prev || prev.eco !== want.eco) { if (win32.setEco(p.pid, want.eco)) { if (want.eco) state.eco.add(p.pid); else state.eco.delete(p.pid); } }
      state.applied.set(p.pid, want);
    } catch (e) { state.lastError = e.message; }
    if (want.mute && !state.muted.has(p.pid)) toMute.push(p.pid);
    if (!want.mute && state.muted.has(p.pid)) toUnmute.push(p.pid);
  }
  for (const pid of state.applied.keys()) if (!procs.some(p => p.pid === pid)) { state.applied.delete(pid); state.muted.delete(pid); state.eco.delete(pid); }
  if (toMute.length || toUnmute.length) {
    audio.setMute(toMute, true).then(() => toMute.forEach(p => state.muted.add(p))).catch(e => { state.lastError = e.message; });
    audio.setMute(toUnmute, false).then(() => toUnmute.forEach(p => state.muted.delete(p))).catch(e => { state.lastError = e.message; });
  }
}

function start() {
  if (!win32.available) throw new Error('The background limiter needs Windows.');
  if (state.running) return status();
  state.running = true; state.lastError = null;
  settings.set('limiter.enabled', true);
  const loop = () => { try { apply(); } catch (e) { state.lastError = e.message; log.warn(e.message); } };
  loop();
  state.timer = setInterval(require('./lean').paced(() => { loop(); bus.emit('limiter:update', status()); }), 1500);
  bus.emit('limiter:update', status());
  return status();
}

/** quitting: MultiMenu is closing. Clients go back to normal, but the limiter stays switched
 *  on in settings, so it starts again next time (it used to come back off). */
function stop({ quitting = false } = {}) {
  clearInterval(state.timer);
  const was = state.running;
  state.running = false;
  if (!quitting) settings.set('limiter.enabled', false);
  if (was && win32.available) {
    for (const p of processes.robloxProcesses()) {
      try { win32.setPriority(p.pid, 'normal'); win32.setAffinity(p.pid, fullMask()); if (state.eco.has(p.pid)) win32.setEco(p.pid, false); } catch { /* process may be gone */ }
    }
    if (state.muted.size) audio.setMute([...state.muted], false).catch(() => {});
  }
  state.applied.clear(); state.muted.clear(); state.eco.clear();
  bus.emit('limiter:update', status());
  return status();
}

/** Eco mode on/off. Turning it on starts the limiter if it isn't running. */
function setEco(on) {
  settings.set('limiter.eco', !!on);
  if (on && !state.running) start();
  else refresh();
  if (on && !win32.ecoSupported()) bus.emit('notify', { level: 'warn', title: 'Eco mode', message: 'This version of Windows has no efficiency mode, so background alts only get below-normal priority.' });
  return { eco: !!on, running: state.running, supported: win32.ecoSupported() };
}

function refresh() { if (state.running) { state.applied.clear(); apply(); } bus.emit('limiter:update', status()); }

function status() {
  return {
    running: state.running, available: win32.available, focusedPid: state.focusedPid, lastError: state.lastError, cores: os.cpus().length,
    clients: [...state.applied.entries()].map(([pid, v]) => ({ pid, ...v, muted: state.muted.has(pid), ecoOn: state.eco.has(pid) })), config: settings.get('limiter'), ecoSupported: win32.ecoSupported(),
    audio: audio.status(),
  };
}

module.exports = { start, stop, refresh, status, setEco, boost, lower, backgroundMask, fullMask };
