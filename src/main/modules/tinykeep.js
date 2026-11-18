'use strict';
// Keeps tiny Roblox windows tiny. A window made smaller than Roblox allows (see
// win32.freeResize) grows back to Roblox's minimum when it comes back from being
// minimised, and Windows does the same when it is dragged by its title bar. A sweep
// every 2 seconds puts it back, keeping it where it is.
//
// Adapted from RoALT 1.1.0 (src-tauri/src/instances/window.rs: keep_tiny, sweep),
// MIT License, Copyright (c) 2026 inspectsoftware. See NOTICE.md.
//
// Left alone: the window you are using (in front), a maximised or minimised one, one that
// isn't responding, while a mouse button is held (you may be dragging it), and for 10 s
// after its size was set on purpose. If Roblox won't go as small as asked, the size it
// stays at becomes its tiny size, so the two never fight. A window Roblox keeps growing
// back (3 times in 5 minutes) is left at Roblox's size: every resize makes the game
// rebuild its picture, and doing that over and over is what made tiny clients stutter.
const win32 = require('../native/win32');
const bus = require('../bus');
const log = require('../logger').scope('tiny');

/** The game picture Roblox holds its window to, at 100 % display scaling (measured by RoALT). */
const ROBLOX_MIN = { w: 816, h: 638 };
const SWEEP_MS = 2000;
const QUIET_MS = 10_000;
const MOST_FIXING = 4;
const FIX_LIMIT = 3, FIX_WINDOW_MS = 5 * 60_000;

const kept = new Map(); // pid -> { w, h, setAt }: the inside (game picture) size, physical pixels
const fixing = new Set();
let timer = null;

/** What one sweep does with one tiny window (pure, unit-tested).
 *  st: { exists, minimized, maximized, hung, foreground, dragging, client: { w, h } } */
function decide(e, st, now = Date.now()) {
  if (!st.exists) return 'drop';
  if (st.minimized || st.maximized || st.hung || st.foreground || st.dragging) return 'wait';
  if (now - e.setAt < QUIET_MS) return 'wait';
  if (Math.abs(st.client.w - e.w) <= 1 && Math.abs(st.client.h - e.h) <= 1) return 'ok';
  return 'fix';
}

/** Pure: true when this window was put back too often lately (so stop fighting Roblox). */
function tooMany(fixes, now = Date.now()) { return fixes.filter(t => now - t < FIX_WINDOW_MS).length >= FIX_LIMIT; }

/** Sets the window's inside to w × h without moving it. */
async function shrink(hwnd, w, h) {
  const fr = win32.frameSize(hwnd) || { w: 16, h: 39 };
  return win32.freeResize(hwnd, { x: 0, y: 0, width: w + fr.w, height: h + fr.h }, true);
}

function sweep() {
  if (!kept.size) { stop(); return; }
  if (!win32.available) return;
  const now = Date.now();
  let fg = 0, dragging = false;
  try { fg = win32.foregroundPid(); dragging = win32.leftButtonDown(); } catch { /* fine */ }
  let games = new Map();
  try { games = require('./wall').gameWindows([...kept.keys()]); } catch { /* none found */ }
  for (const [pid, e] of kept) {
    if (fixing.size >= MOST_FIXING) break;
    if (fixing.has(pid)) continue;
    const w = games.get(pid) || null;
    if (!w) {
      // No window: it's minimised to nothing or the client has closed.
      try { if (!require('./processes').robloxProcesses().some(p => p.pid === pid)) kept.delete(pid); } catch { /* keep */ }
      continue;
    }
    const hwnd = w.hwnd;
    let st;
    try {
      const c = win32.clientRect(hwnd);
      st = {
        exists: win32.isWindow(hwnd), minimized: win32.isMinimized(hwnd), maximized: win32.isMaximized(hwnd), hung: win32.isHung(hwnd),
        foreground: fg === pid, dragging, client: c ? { w: c.width, h: c.height } : { w: e.w, h: e.h },
      };
    } catch { continue; }
    const d = decide(e, st, now);
    if (d === 'drop') { kept.delete(pid); continue; }
    if (d !== 'fix') continue;
    e.fixes = (e.fixes || []).filter(t => now - t < FIX_WINDOW_MS);
    if (tooMany(e.fixes, now)) {
      log.info(`Window of ${pid} keeps growing back: leaving it at ${st.client.w}×${st.client.h}`);
      e.w = st.client.w; e.h = st.client.h; e.fixes = [];
      continue;
    }
    e.fixes.push(now);
    fixing.add(pid);
    log.info(`Window of ${pid} is ${st.client.w}×${st.client.h}: back to ${e.w}×${e.h}`);
    shrink(hwnd, e.w, e.h).then(() => {
      e.setAt = Date.now();
      const after = win32.clientRect(hwnd);
      if (after && (Math.abs(after.width - e.w) > 1 || Math.abs(after.height - e.h) > 1)) {
        log.info(`Window of ${pid} stays at ${after.width}×${after.height}`);
        e.w = after.width; e.h = after.height;
      }
    }).catch(err => log.warn(err.message)).finally(() => fixing.delete(pid));
  }
}

function start() { if (!timer) { timer = setInterval(require('./lean').paced(sweep), SWEEP_MS); timer.unref?.(); } }
function stop() { clearInterval(timer); timer = null; }

/** Keeps this client's window at an inside size of w × h from now on. */
function keep(pid, w, h) {
  if (!pid || !(w > 0) || !(h > 0)) return;
  kept.set(pid, { w: Math.round(w), h: Math.round(h), setAt: Date.now(), fixes: kept.get(pid)?.fixes || [] });
  start();
  bus.emit('tiny:update', { pid, tiny: true });
}
function release(pid) {
  if (kept.delete(pid)) bus.emit('tiny:update', { pid, tiny: false });
  if (!kept.size) stop();
}
function has(pid) { return kept.has(pid); }
function sizeOf(pid) { const e = kept.get(pid); return e ? { w: e.w, h: e.h } : null; }

/** Makes one client's window tiny now (inside w × h, where it is) and keeps it so. */
async function makeTiny(pid, hwnd, w, h) {
  // A minimised window stays minimised: it's made tiny when you bring it back.
  if (win32.isMinimized(hwnd)) { keep(pid, w, h); kept.get(pid).setAt = 0; return true; }
  if (win32.isMaximized(hwnd)) await win32.unhideAsync(hwnd);
  const ok = await shrink(hwnd, Math.round(w), Math.round(h));
  if (ok) keep(pid, w, h);
  else log.warn(`Window of ${pid} could not be made tiny (busy or not responding)`);
  return ok;
}

module.exports = { ROBLOX_MIN, QUIET_MS, decide, tooMany, keep, release, has, sizeOf, makeTiny, sweep, _kept: kept };
