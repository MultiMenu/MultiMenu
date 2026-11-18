'use strict';
// Hide Roblox title bars (Sessions & Tiling): game windows lose their title bar and sizing
// border, so tiled windows show only the game. Roblox puts the title bar back sometimes
// (going full screen and back, for one), so windows are checked every few seconds.
// Turning it off gives every window its title bar back.
const settings = require('./settings');
const win32 = require('../native/win32');
const log = require('../logger').scope('titlebars');

const changed = new Map(); // window key -> { hwnd, style it had }
let timer = null, busy = false;

const key = (hwnd) => String(require('koffi').address(hwnd));

async function sweep() {
  if (busy || !win32.available) return;
  busy = true;
  try {
    const on = !!settings.get('tiling.hideTitleBars');
    if (!on) {
      for (const [k, w] of changed) { try { await win32.setTitleBar(w.hwnd, true, w.style); } catch { /* window gone */ } changed.delete(k); }
      stopTimer();
      return;
    }
    const pids = require('./sessions').listSessions().filter(s => s.pid && s.status === 'running').map(s => s.pid);
    if (!pids.length) return;
    const wins = require('./wall').gameWindows(pids);
    for (const w of wins.values()) {
      const style = win32.windowStyle(w.hwnd);
      if (style === win32.titlelessStyle(style)) continue; // already without
      try {
        const had = await win32.setTitleBar(w.hwnd, false);
        const k = key(w.hwnd);
        if (had != null && !changed.has(k)) changed.set(k, { hwnd: w.hwnd, style: had });
      } catch (e) { log.warn(`Title bar: ${e.message}`); }
    }
    for (const [k, w] of changed) { try { if (!win32.isWindow(w.hwnd)) changed.delete(k); } catch { changed.delete(k); } }
  } finally { busy = false; }
}

function stopTimer() { clearInterval(timer); timer = null; }
/** Called at start and when the setting changes. */
function apply() {
  if (process.platform !== 'win32') return;
  if (settings.get('tiling.hideTitleBars')) { if (!timer) timer = setInterval(require('./lean').paced(() => sweep().catch(() => {})), 3000); }
  sweep().catch(() => {});
}
function init() { apply(); }
/** MultiMenu closing: windows get their title bars back. */
async function stop() {
  stopTimer();
  for (const [k, w] of changed) { try { await win32.setTitleBar(w.hwnd, true, w.style); } catch { /* gone */ } changed.delete(k); }
}

module.exports = { init, apply, stop, sweep };
