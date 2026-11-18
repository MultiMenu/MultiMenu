'use strict';
// Reads the text on every Roblox window with Windows' own text recognition, for the
// features that react to what is on screen (hatch alerts). All windows
// come from one capture per round (asking Windows for one window's picture costs as
// much as asking for all of them), then each is read in turn. The next round starts
// screen.everySec after this one ends, so it never piles up, even with 20+ windows.
const settings = require('./settings');
const sessions = require('./sessions');
const log = require('../logger').scope('screen');

const consumers = []; // { name, active(): bool, wants(session): bool, onRead(session, read) }
const state = { rounds: 0, checked: 0, skipped: 0, error: null, lastRoundMs: 0, lastAt: null };
let timer = null, running = false;

const cfg = () => settings.get('screen');

/** A feature that wants screen text. */
function use(consumer) { consumers.push(consumer); reschedule(); }

const needed = () => consumers.some(c => { try { return c.active(); } catch { return false; } });

/** Line positions as fractions of the window (0..1), so they work at any window size. */
function withFractions(read, imgW, imgH) {
  return {
    text: read.text,
    lines: read.lines.map(l => ({ t: l.t, x: l.x / imgW, y: l.y / imgH, w: l.w / imgW, h: l.h / imgH })),
  };
}

/** Captures and reads one window now (for "Test on a window"). */
async function readOne(s) {
  const win32 = require('../native/win32');
  const w = win32.robloxWindows([s.pid])[0];
  if (!w) throw new Error('That client has no window.');
  const r = win32.windowRect(w.hwnd);
  if (win32.isMinimized(w.hwnd)) return { skipped: 'minimised', width: r?.width || 0 };
  if ((r?.width || 0) < cfg().minWidth) return { skipped: 'small', width: r?.width || 0 };
  const png = await require('./capture').captureWindowOfPid(s.pid, 1600);
  if (!png) return { skipped: 'capture', width: r.width };
  const { nativeImage } = require('electron');
  let img = nativeImage.createFromBuffer(png);
  if (img.getSize().width < 1000) img = img.resize({ width: 1400, quality: 'best' });
  const { width, height } = img.getSize();
  const read = await require('./ocr').readLines(img.toPNG(), s.id);
  return { ...withFractions(read, width, height), width: r.width };
}

async function round() {
  const win32 = require('../native/win32');
  if (!win32.available) return;
  const c = cfg();
  const list = sessions.allRaw().filter(s => s.status === 'running' && s.pid && consumers.some(k => { try { return k.active() && k.wants(s); } catch { return false; } }));
  if (!list.length) return;
  const wins = [];
  for (const s of list) {
    const w = win32.robloxWindows([s.pid])[0];
    if (!w) continue;
    const r = win32.windowRect(w.hwnd);
    if (win32.isMinimized(w.hwnd) || (r?.width || 0) < c.minWidth) { state.skipped++; continue; }
    wins.push({ s, handle: String(require('koffi').address(w.hwnd)), r });
  }
  if (!wins.length) return;
  const width = Math.min(1600, Math.max(...wins.map(x => x.r.width)));
  const height = Math.min(1200, Math.max(...wins.map(x => x.r.height)));
  const sources = await require('./capture').sources({ thumbnailSize: { width, height } });
  const byHandle = new Map(sources.map(src => [src.id.split(':')[1], src]));
  for (const { s, handle } of wins) {
    const src = byHandle.get(handle);
    if (!src || src.thumbnail.isEmpty()) { state.skipped++; continue; }
    try {
      let img = src.thumbnail;
      if (img.getSize().width < 1000) img = img.resize({ width: 1400, quality: 'best' }); // big letters read far better
      const size = img.getSize();
      const read = withFractions(await require('./ocr').readLines(img.toPNG(), s.id), size.width, size.height);
      state.checked++;
      state.error = null;
      for (const k of consumers) {
        try { if (k.active() && k.wants(s)) await k.onRead(s, read); } catch (e) { log.warn(`${k.name}: ${e.message}`); }
      }
    } catch (e) { state.error = e.message; }
  }
}

function reschedule() {
  clearTimeout(timer);
  timer = null;
  if (!needed() || !require('./ocr').available()) { if (!running) require('./ocr').stop(); return; }
  timer = setTimeout(async () => {
    if (running) return;
    running = true;
    const t0 = Date.now();
    try { await round(); } catch (e) { state.error = e.message; }
    state.rounds++; state.lastRoundMs = Date.now() - t0; state.lastAt = Date.now();
    running = false;
    reschedule();
  }, Math.max(1, cfg().everySec) * 1000);
}

function stop() { clearTimeout(timer); timer = null; require('./ocr').stop(); }

const status = () => ({ ...state, running: !!timer, ocr: require('./ocr').status() });

module.exports = { use, reschedule, readOne, stop, status, withFractions };
