'use strict';
// Anti-AFK.
//  reminder mode: shows a notification every N minutes so you can check in on
//                 your sessions yourself. Sends no input.
//  nudge mode:    every N minutes, briefly focuses each Roblox window, taps the
//                 chosen key once, then gives focus back to the window you were
//                 using. Roblox disconnects idle players after 20 minutes, so
//                 intervals are capped at 19 minutes. Check the rules of any
//                 game you use this in.
//                 Several keys can be given ("W,Space"): they're pressed in
//                 order. Minimised windows are restored for the press and
//                 minimised again. By default it only acts while you're away
//                 from the PC, so it never steals focus while you're typing.
//                 F13 is the default key: no game uses it, so your character
//                 doesn't move, but Roblox still counts it as activity.
const win32 = require('../native/win32');
const settings = require('./settings');
const processes = require('./processes');
const sessionsMod = require('./sessions');
const { VK } = require('./keys');
const bus = require('../bus');
const log = require('../logger').scope('antiafk');

const state = { running: false, timer: null, nextAt: null, lastAt: null, lastCount: 0, lastError: null, actions: 0 };

async function act(force = false) {
  const cfg = settings.get('antiAfk');
  state.lastAt = Date.now();
  if (cfg.mode === 'reminder') {
    const n = processes.robloxProcesses().length;
    bus.emit('notify', { level: 'info', title: 'Anti-AFK reminder', message: n ? `${n} Roblox client${n > 1 ? 's are' : ' is'} open. Time to check in.` : 'No Roblox clients are open.', toast: true });
    state.actions++; state.lastCount = n;
    return;
  }
  const keys = parseKeys(cfg.key);
  if (!force && cfg.onlyWhenAway !== false) {
    const idle = require('electron').powerMonitor.getSystemIdleTime();
    const need = Math.max(10, Number(cfg.awaySec) || 60);
    if (idle < need) {
      state.lastSkipped = `Skipped: you were using the PC ${idle}s ago (waits until you've been away ${need}s).`;
      log.info(state.lastSkipped);
      return 'retry';
    }
  }
  state.lastSkipped = null;
  let pids = processes.robloxProcesses().map(p => p.pid);
  if (cfg.onlyTracked) {
    const tracked = new Set(sessionsMod.listSessions().filter(s => s.status === 'running' && !s.external).map(s => s.pid));
    pids = pids.filter(p => tracked.has(p));
  }
  const wins = win32.robloxWindows(pids);
  const prev = win32.foregroundWindow();
  let done = 0;
  for (const w of wins) {
    try {
      const wasMin = win32.isMinimized(w.hwnd);
      win32.focusWindow(w.hwnd); // restores a minimised window
      await new Promise(r => setTimeout(r, wasMin ? 400 : 250));
      for (const vk of keys) { await win32.tapKey(vk, 80); await new Promise(r => setTimeout(r, 100)); }
      done++;
      if (wasMin) win32.minimizeWindow(w.hwnd);
      await new Promise(r => setTimeout(r, 150));
    } catch (e) { state.lastError = e.message; }
  }
  if (prev) { try { win32.focusWindow(prev); } catch { /* window may be gone */ } }
  state.lastCount = done; state.actions++;
  log.info(`Nudged ${done}/${wins.length} Roblox windows`);
}

function schedule() {
  clearTimeout(state.timer);
  if (!state.running) return;
  const cfg = settings.get('antiAfk');
  const max = cfg.mode === 'nudge' ? 19 : 120;
  const min = Math.min(max, Math.max(1, Number(cfg.intervalMin) || 15));
  state.nextAt = Date.now() + min * 60_000;
  state.timer = setTimeout(async () => {
    try {
      // While you're at the PC, check again every 30s (still well inside Roblox's 20-minute limit).
      if ((await act()) === 'retry') { state.nextAt = Date.now() + 30_000; state.timer = setTimeout(() => { state.timer = null; retryLoop(); }, 30_000); emit(); return; }
      state.lastError = null;
    } catch (e) { state.lastError = e.message; bus.emit('event', { type: 'sessionError', error: `Anti-AFK: ${e.message}` }); }
    schedule(); emit();
  }, min * 60_000);
}

async function retryLoop() {
  if (!state.running) return;
  try {
    if ((await act()) === 'retry') { state.nextAt = Date.now() + 30_000; state.timer = setTimeout(retryLoop, 30_000); emit(); return; }
    state.lastError = null;
  } catch (e) { state.lastError = e.message; }
  schedule(); emit();
}

/** "W, Space" -> virtual-key codes (unknown names are skipped; F13 if none). Exported for tests. */
function parseKeys(text) {
  const out = String(text || '').split(/[,+]/).map(k => k.trim()).filter(Boolean).slice(0, 8)
    .map(k => VK[k] ?? VK[k.toUpperCase()] ?? VK[k[0].toUpperCase() + k.slice(1).toLowerCase()]).filter(v => v != null);
  return out.length ? out : [VK.F13];
}

function start() {
  if (!win32.available) throw new Error('Anti-AFK needs Windows.');
  state.running = true; settings.set('antiAfk.enabled', true);
  schedule(); emit();
  return status();
}
function stop() { clearTimeout(state.timer); state.running = false; state.nextAt = null; settings.set('antiAfk.enabled', false); emit(); return status(); }
async function runNow() { await act(true); if (state.running) schedule(); emit(); return status(); }
function status() { const { timer: _timer, ...s } = state; return { ...s, available: win32.available, config: settings.get('antiAfk') }; }
function emit() { bus.emit('antiafk:update', status()); }
function reschedule() { if (state.running) schedule(); emit(); }

module.exports = { parseKeys, start, stop, runNow, status, reschedule };
