'use strict';
// Layouts per monitor setup. MultiMenu remembers the tiling settings you used
// with each monitor arrangement (e.g. "laptop only" vs "laptop + 1440p screen")
// and switches to the right one by itself when monitors are plugged in or out.
const { JsonStore } = require('../store');
const paths = require('../paths');
const settings = require('./settings');
const bus = require('../bus');
const log = require('../logger').scope('layouts');

const KEYS = ['layout', 'gap', 'padding', 'mainRatio', 'cellWidth', 'cellHeight', 'centerLastRow'];
let store = null, current = '', timer = null;

function screen() { return require('electron').screen; }

function sortedDisplays(list) {
  return [...list].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
}

/** A stable name for a monitor arrangement: sizes, scaling and positions of every screen. */
function signature(displays) {
  return sortedDisplays(displays).map(d => `${Math.round(d.size?.width ?? d.bounds.width)}x${Math.round(d.size?.height ?? d.bounds.height)}@${Math.round((d.scaleFactor || 1) * 100)}+${d.bounds.x},${d.bounds.y}`).join('|');
}

/** Human description, e.g. "2 monitors · 2560×1440 + 1920×1080". */
function describe(sig) {
  const parts = String(sig || '').split('|').filter(Boolean).map(p => {
    const m = /^(\d+)x(\d+)@(\d+)/.exec(p);
    return m ? `${Math.round(m[1] * m[3] / 100)}×${Math.round(m[2] * m[3] / 100)}` : p;
  });
  return `${parts.length} monitor${parts.length === 1 ? '' : 's'} · ${parts.join(' + ')}`;
}

function nowSig() { try { return signature(screen().getAllDisplays()); } catch { return ''; } }
function profiles() { return store?.get('profiles') || {}; }

/** Saves the current tiling settings for the current monitor setup. */
function remember() {
  if (!store || !settings.get('tiling.perMonitorSetup')) return null;
  const sig = nowSig();
  if (!sig) return null;
  const t = settings.get('tiling');
  const displays = sortedDisplays(screen().getAllDisplays());
  const displayIndex = t.display === 'all' ? -2 : displays.findIndex(d => String(d.id) === String(t.display));
  const p = { ...Object.fromEntries(KEYS.map(k => [k, t[k]])), displayIndex, savedAt: Date.now() };
  store.get('profiles')[sig] = p;
  store.saveSoon();
  return p;
}

/** Puts the saved tiling settings for a setup back. Returns true if there was one. */
function apply(sig = nowSig()) {
  const p = profiles()[sig];
  if (!p) return false;
  for (const k of KEYS) if (k in p) settings.set(`tiling.${k}`, p[k]);
  const displays = sortedDisplays(screen().getAllDisplays());
  settings.set('tiling.display', p.displayIndex === -2 ? 'all' : p.displayIndex >= 0 && displays[p.displayIndex] ? String(displays[p.displayIndex].id) : '');
  return true;
}

function onDisplaysChanged() {
  clearTimeout(timer);
  // Windows sends several events while a monitor is connecting; wait for it to settle.
  timer = setTimeout(() => {
    const sig = nowSig();
    if (!sig || sig === current) return;
    const prev = current;
    current = sig;
    log.info(`Monitor setup changed: ${describe(prev)} -> ${describe(sig)}`);
    if (!settings.get('tiling.perMonitorSetup')) return;
    if (!apply(sig)) return;
    const tiler = require('./tiler');
    bus.emit('notify', { level: 'info', title: 'Monitor setup changed', message: `Using the layout you saved for ${describe(sig)}.` });
    bus.emit('tiler:update', tiler.preview());
    if (tiler.targets().length) tiler.tile({ auto: true }).catch(e => log.warn(e.message));
  }, 2500);
}

function status() {
  const sig = nowSig();
  return {
    enabled: !!settings.get('tiling.perMonitorSetup'), current: sig, currentName: describe(sig),
    saved: Object.entries(profiles()).map(([k, v]) => ({ sig: k, name: describe(k), layout: v.layout, savedAt: v.savedAt, current: k === sig })),
  };
}

function forget(sig) { delete profiles()[sig]; store.saveSoon(); return status(); }

function init() {
  store = new JsonStore(paths.file('layouts.json'), { profiles: {} });
  current = nowSig();
  // First run of 1.8: keep what you already have as this setup's layout.
  if (current && !profiles()[current]) remember();
  try {
    const scr = screen();
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) scr.on(ev, onDisplaysChanged);
  } catch (e) { log.warn(e.message); }
}

module.exports = { init, signature, describe, remember, apply, status, forget };
