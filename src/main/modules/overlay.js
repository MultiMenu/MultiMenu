'use strict';
// Overlay labels: a small name tag on every Roblox window (hotkey slot, name, FPS,
// ping, uptime, memory). One transparent window per monitor that clicks pass
// straight through. Labels only show while a Roblox window or MultiMenu is in
// front, never on a window that is moving, and never where another window covers
// the corner, so they stay on their own window instead of floating over others.
const path = require('path');
const win32 = require('../native/win32');
const settings = require('./settings');
const sessions = require('./sessions');
const accounts = require('./accounts');
const bus = require('../bus');
const log = require('../logger').scope('overlay');

const labelWins = new Map(); // display id -> BrowserWindow
let timer = null;
let lastSent = new Map(); // display id -> json

function uptime(ms) { const m = Math.max(0, Math.floor(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; }

/** Pure: builds label text parts from a session and the overlay settings (unit-tested). */
function labelFor(s, acc, cfg, fps, now = Date.now()) {
  const parts = [];
  if (cfg.fps && fps != null) parts.push(`${Math.round(fps)} FPS`);
  if (cfg.ping && s.ping != null) parts.push(`${s.ping} ms`);
  if (cfg.uptime && s.startedAt) parts.push(uptime(now - s.startedAt));
  if (cfg.mem && s.memMB) parts.push(s.memMB >= 1024 ? `${(s.memMB / 1024).toFixed(1)} GB` : `${s.memMB} MB`);
  const state = s.watchState === 'not responding' ? 'bad' : (s.watchState && /load|stuck|join/i.test(s.watchState)) ? 'warn' : 'ok';
  return { name: s.label.replace(/ \(opened outside MultiMenu\)$/, ''), slot: acc?.slot || null, tier: acc ? accounts.publicView(acc).tier : null, info: parts.join(' · '), state };
}

function ownPids() { try { return new Set(require('electron').app.getAppMetrics().map(m => m.pid)); } catch { return new Set(); } }

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Where the label sits on a window (physical pixels), for the "is it covered" check (pure, unit-tested). */
function labelArea(c, position, scale = 100, ratio = 1) {
  const pad = Math.round(8 * ratio);
  const w = Math.min(c.width - pad * 2, Math.round(260 * (scale / 100) * ratio)), h = Math.round(26 * (scale / 100) * ratio);
  const right = /right/.test(position || ''), bottom = /bottom/.test(position || '');
  return { x: right ? c.x + c.width - pad - w : c.x + pad, y: bottom ? c.y + c.height - pad - h : c.y + pad, width: Math.max(1, w), height: Math.max(1, h) };
}

/** True when a window in front of the game window (other than the game's own pop-ups)
 *  covers the label, so the label would float over something else (pure, unit-tested). */
function covered(area, stack, index, pid) {
  for (let i = 0; i < index; i++) {
    const o = stack[i];
    if (o.pid === pid) continue;
    if (intersects(area, o.rect)) return true;
  }
  return false;
}

// A label only shows on a window that has stayed put since the last look. While a window is
// dragged or resized its label hides, instead of trailing behind the mouse.
const lastRect = new Map(); // session id -> 'x,y,w,h'
const info = new Map(); // session id -> { at, parts }
const INFO_MS = 2000; // FPS, ping and uptime refresh this often (redrawing costs the game windows too)

function collect() {
  const cfg = settings.get('overlay');
  const live = sessions.listSessions().filter(s => s.status === 'running' && s.pid);
  if (!live.length) return [];
  const fg = win32.foregroundPid();
  const own = ownPids();
  if (!live.some(s => s.pid === fg) && !own.has(fg)) { lastRect.clear(); return []; }
  const fps = (() => { try { return require('./fps').presentMonStatus().fps || {}; } catch { return {}; } })();
  const wins = require('./wall').gameWindows(live.map(s => s.pid));
  const stack = win32.windowStack(); // the labels themselves are click-through, so not in it
  const { screen } = require('electron');
  const now = Date.now();
  const out = [];
  for (const s of live) {
    const w = wins.get(s.pid);
    if (!w) continue;
    const key = String(require('koffi').address(w.hwnd));
    const index = stack.findIndex(o => o.key === key);
    if (index < 0) continue; // minimised or hidden
    const c = win32.clientRect(w.hwnd);
    if (!c || c.width < 200 || c.height < 120) continue;
    const sig = `${c.x},${c.y},${c.width},${c.height}`;
    if (lastRect.get(s.id) !== sig) { lastRect.set(s.id, sig); continue; }
    const dip = screen.screenToDipRect(null, c);
    const ratio = dip.width ? c.width / dip.width : 1;
    if (covered(labelArea(c, cfg.position, cfg.scale, ratio), stack, index, s.pid)) continue;
    const acc = s.accountId ? accounts.find(s.accountId) : null;
    let i = info.get(s.id);
    if (!i || now - i.at >= INFO_MS) { i = { at: now, label: labelFor(s, acc, cfg, fps[s.pid]) }; info.set(s.id, i); }
    out.push({ id: s.id, rect: dip, ...i.label });
  }
  for (const id of [...lastRect.keys()]) if (!live.some(s => s.id === id)) { lastRect.delete(id); info.delete(id); }
  return out;
}

function windowFor(display) {
  let w = labelWins.get(display.id);
  if (w && !w.isDestroyed()) return w;
  const { BrowserWindow } = require('electron');
  const b = display.bounds;
  w = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, backgroundColor: '#00000000', title: 'MultiMenu labels',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  w.setIgnoreMouseEvents(true);
  w.setAlwaysOnTop(true, 'screen-saver');
  w.removeMenu();
  w.loadFile(path.join(__dirname, '..', '..', 'renderer', 'overlay.html'));
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.on('closed', () => { labelWins.delete(display.id); lastSent.delete(display.id); });
  labelWins.set(display.id, w);
  return w;
}

function tick() {
  let labels = [];
  try { labels = collect(); } catch (e) { log.warn(e.message); }
  const { screen } = require('electron');
  const displays = screen.getAllDisplays();
  const cfg = settings.get('overlay');
  for (const d of displays) {
    const mine = labels.filter(l => { const cx = l.rect.x + 10, cy = l.rect.y + 10; return cx >= d.bounds.x && cx < d.bounds.x + d.bounds.width && cy >= d.bounds.y && cy < d.bounds.y + d.bounds.height; })
      .map(l => ({ ...l, rect: { x: l.rect.x - d.bounds.x, y: l.rect.y - d.bounds.y, width: l.rect.width, height: l.rect.height } }));
    const existing = labelWins.get(d.id);
    if (!mine.length) { if (existing && !existing.isDestroyed() && existing.isVisible()) existing.hide(); continue; }
    const w = windowFor(d);
    const b = w.getBounds();
    if (b.x !== d.bounds.x || b.y !== d.bounds.y || b.width !== d.bounds.width || b.height !== d.bounds.height) w.setBounds(d.bounds);
    const json = JSON.stringify({ labels: mine, position: cfg.position, scale: cfg.scale });
    if (lastSent.get(d.id) !== json && !w.webContents.isLoading()) { w.webContents.send('evt:overlay:labels', JSON.parse(json)); lastSent.set(d.id, json); }
    if (!w.isVisible()) { w.showInactive(); w.setAlwaysOnTop(true, 'screen-saver'); }
  }
  // Monitors that were unplugged.
  for (const [id, w] of labelWins) if (!displays.some(d => d.id === id) && !w.isDestroyed()) w.destroy();
}

function start() {
  if (!win32.available) throw new Error('Overlay labels need Windows.');
  clearInterval(timer);
  lastSent = new Map();
  timer = setInterval(tick, 300);
  tick();
  return status();
}
function stop() {
  clearInterval(timer); timer = null;
  for (const w of labelWins.values()) if (!w.isDestroyed()) w.destroy();
  labelWins.clear(); lastSent.clear(); lastRect.clear(); info.clear();
  return status();
}
function setEnabled(on) {
  if (on) { try { start(); } catch (e) { settings.set('overlay.enabled', false); throw e; } } else stop();
  settings.set('overlay.enabled', !!on);
  bus.emit('overlay:update', status());
  return status();
}
function init() { if (settings.get('overlay.enabled')) { try { start(); } catch (e) { log.warn(e.message); } } }
function refresh() { lastSent = new Map(); info.clear(); }
function status() { return { enabled: !!settings.get('overlay.enabled'), running: !!timer, windows: labelWins.size, available: win32.available }; }

module.exports = { init, start, stop, setEnabled, status, refresh, labelFor, labelArea, covered };
