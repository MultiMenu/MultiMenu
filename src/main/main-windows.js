'use strict';
// Keeps track of MultiMenu's windows: the main window and the compact,
// always-on-top mini panel.
const path = require('path');
const { BrowserWindow, screen } = require('electron');

let main = null;
let mini = null;
let pip = null;
let switcher = null, switcherTimer = null;

function setMain(w) { main = w; }
function getMain() { return main && !main.isDestroyed() ? main : null; }
function getMini() { return mini && !mini.isDestroyed() ? mini : null; }
function setPip(w) { pip = w; }
function getPip() { return pip && !pip.isDestroyed() ? pip : null; }
function getSwitcher() { return switcher && !switcher.isDestroyed() ? switcher : null; }
function all() { return [getMain(), getMini(), getPip(), getSwitcher()].filter(Boolean); }

// ---------- alt switcher (quick pop-up version of the Alt Wall) ----------
// Kept hidden for a minute after closing so it opens instantly next time.
function switcherBounds() {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const n = Math.max(1, require('./modules/sessions').listSessions().filter(s => s.status === 'running').length);
  const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(n))));
  const rows = Math.min(3, Math.ceil(n / cols));
  const width = Math.min(d.width - 40, cols * 248 + 40), height = Math.min(d.height - 40, rows * 176 + 104);
  return { x: Math.round(d.x + (d.width - width) / 2), y: Math.round(d.y + (d.height - height) / 2), width, height };
}
function openSwitcher() {
  clearTimeout(switcherTimer);
  const b = switcherBounds();
  if (getSwitcher()) {
    switcher.setBounds(b);
    switcher.webContents.send('evt:switcher:show', {});
    switcher.show(); switcher.focus();
    return switcher;
  }
  switcher = new BrowserWindow({
    ...b, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false, transparent: false, backgroundColor: '#0b0614', title: 'MultiMenu switcher',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  switcher.setAlwaysOnTop(true, 'pop-up-menu');
  switcher.removeMenu();
  switcher.loadFile(path.join(__dirname, '..', 'renderer', 'switcher.html'));
  switcher.once('ready-to-show', () => { switcher.show(); switcher.focus(); });
  switcher.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  switcher.webContents.on('will-navigate', e => e.preventDefault());
  switcher.on('blur', () => closeSwitcher());
  switcher.on('closed', () => { switcher = null; });
  return switcher;
}
function closeSwitcher() {
  const w = getSwitcher();
  if (!w) return false;
  if (w.isVisible()) w.hide();
  clearTimeout(switcherTimer);
  switcherTimer = setTimeout(() => { if (getSwitcher() && !switcher.isVisible()) switcher.destroy(); }, 60_000);
  return true;
}
function toggleSwitcher() { if (getSwitcher()?.isVisible()) return closeSwitcher(); openSwitcher(); return true; }

function openMini() {
  if (getMini()) { mini.show(); mini.focus(); return mini; }
  const settings = require('./modules/settings');
  const wa = screen.getPrimaryDisplay().workArea;
  const compact = !!settings.get('mini.compact');
  mini = new BrowserWindow({
    width: compact ? STRIP.w : 340, height: compact ? STRIP.h : 540, minWidth: compact ? STRIP.w : 300, minHeight: compact ? STRIP.h : 360,
    x: wa.x + wa.width - (compact ? STRIP.w + 20 : 360), y: wa.y + 20,
    frame: false, resizable: true, skipTaskbar: true, alwaysOnTop: settings.get('mini.alwaysOnTop'), show: false,
    backgroundColor: '#07040d', title: 'MultiMenu Mini',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true },
  });
  mini.removeMenu();
  mini.loadFile(path.join(__dirname, '..', 'renderer', 'mini.html'));
  mini.once('ready-to-show', () => mini.show());
  mini.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mini.webContents.on('will-navigate', e => e.preventDefault());
  mini.on('closed', () => { mini = null; });
  return mini;
}

// Compact strip: just a status dot per account.
const STRIP = { w: 300, h: 92 };
function setMiniCompact(on) {
  const w = getMini();
  if (!w) return;
  const [x, y] = w.getPosition();
  const [cw] = w.getSize();
  if (on) {
    w.setMinimumSize(STRIP.w, STRIP.h); w.setBounds({ x: x + cw - STRIP.w, y, width: STRIP.w, height: STRIP.h });
  } else {
    w.setMinimumSize(300, 360); w.setBounds({ x: x + cw - 340, y, width: 340, height: 540 });
  }
}

function closeMini() { if (getMini()) mini.close(); }
function toggleMini() { if (getMini()) closeMini(); else openMini(); return !!getMini(); }
function setMiniOnTop(on) { if (getMini()) mini.setAlwaysOnTop(!!on); }

module.exports = { setMain, getMain, getMini, setPip, getPip, all, openMini, closeMini, toggleMini, setMiniOnTop, setMiniCompact, getSwitcher, openSwitcher, closeSwitcher, toggleSwitcher };
