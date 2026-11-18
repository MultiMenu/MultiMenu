'use strict';
// Picture-in-picture: a small always-on-top window showing a live view of one
// Roblox client, so you can keep an eye on an alt while you play on your main.
// The picture comes from Windows' own window capture (the same API screen
// recorders use), stays on this PC and is never saved or sent anywhere.
const path = require('path');
const { BrowserWindow, session, screen } = require('electron');
const settings = require('./settings');
const sessions = require('./sessions');
const windows = require('../main-windows');
const bus = require('../bus');
const log = require('../logger').scope('pip');

let win = null, target = null; // target = session id
let handlerSet = false;

const BAR = 30;

function hwndNumber(hwnd) { return String(require('koffi').address(hwnd)); }

function running() { return sessions.listSessions().filter(s => s.status === 'running' && s.pid); }

/** Finds the capture source for a session's game window. */
async function sourceFor(sessionId) {
  const s = running().find(x => x.id === sessionId);
  if (!s) throw new Error('That session is not running.');
  const w = require('./tiler').windowFor(s.pid);
  if (!w) throw new Error('Its Roblox window was not found (it may still be loading).');
  const num = hwndNumber(w.hwnd);
  const sources = await require('./capture').sources({ thumbnailSize: { width: 0, height: 0 } });
  const src = sources.find(x => x.id.startsWith(`window:${num}:`));
  if (!src) throw new Error('Windows did not offer this window for capture. Try again once the game has loaded.');
  return { src, s, rect: w.rect };
}

function installHandlers() {
  if (handlerSet) return;
  handlerSet = true;
  // getDisplayMedia from the PiP page gets exactly the chosen Roblox window; any other page is refused.
  session.defaultSession.setDisplayMediaRequestHandler(async (req, cb) => {
    const pipWin = windows.getPip();
    const fromPip = pipWin && req.frame && pipWin.webContents.mainFrame === req.frame;
    if (!fromPip || !target) { cb({}); return; }
    try { const { src } = await sourceFor(target); cb({ video: src }); }
    catch (e) { log.warn(e.message); cb({}); }
  });
}

function geometry() {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = Math.max(240, Math.min(960, Number(settings.get('pip.width')) || 420));
  const h = Math.round(w * 9 / 16) + BAR;
  return { width: w, height: h, x: wa.x + wa.width - w - 20, y: wa.y + wa.height - h - 20 };
}

async function open(sessionId) {
  if (process.platform !== 'win32') throw new Error('Picture-in-picture needs Windows.');
  const list = running();
  if (!list.length) throw new Error('No running Roblox windows.');
  let id = sessionId;
  if (!id) {
    // Default: an alt that isn't the window you're looking at.
    let fg = null; try { fg = require('../native/win32').foregroundPid(); } catch { /* ignore */ }
    id = (list.find(s => s.pid !== fg && !s.external) || list.find(s => s.pid !== fg) || list[0]).id;
  }
  await sourceFor(id); // fail early with a clear message
  target = id;
  installHandlers();
  const existing = windows.getPip();
  if (existing) { existing.webContents.send('evt:pip:target', info()); existing.showInactive(); return info(); }
  win = new BrowserWindow({
    ...geometry(), minWidth: 240, minHeight: 165, frame: false, resizable: true, skipTaskbar: true, alwaysOnTop: true,
    show: false, backgroundColor: '#07040d', title: 'MultiMenu PiP', maximizable: false, fullscreenable: false, focusable: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setAspectRatio(16 / 9, { width: 0, height: BAR });
  win.setOpacity(Math.max(0.3, Math.min(1, (Number(settings.get('pip.opacity')) || 100) / 100)));
  win.removeMenu();
  windows.setPip(win);
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'pip.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('resized', () => { const [w] = win.getSize(); settings.set('pip.width', w); });
  win.on('closed', () => { win = null; target = null; windows.setPip(null); bus.emit('pip:update', status()); });
  bus.emit('pip:update', status());
  return info();
}

function close() { const w = windows.getPip(); if (w) w.close(); return { open: false }; }
async function toggle() { if (windows.getPip()) return close(); return open(); }

async function setTarget(id) {
  await sourceFor(id);
  target = id;
  bus.emit('pip:update', status());
  const w = windows.getPip(); if (w) w.webContents.send('evt:pip:target', info());
  return info();
}

function focusTarget() {
  if (!target) return false;
  return require('./tiler').focus(target);
}

function info() {
  const list = running();
  const cur = list.find(s => s.id === target);
  return { target, label: cur?.label || null, fps: Math.max(5, Math.min(30, Number(settings.get('pip.fps')) || 15)), sessions: list.map(s => ({ id: s.id, label: s.label })) };
}
function status() { return { open: !!windows.getPip(), target, label: running().find(s => s.id === target)?.label || null }; }

module.exports = { open, close, toggle, setTarget, focusTarget, info, status, sourceFor };
