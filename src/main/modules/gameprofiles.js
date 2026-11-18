'use strict';
// Game profiles: settings that follow a game. When an account launches into a
// game with a profile, its graphics and FPS cap are set first (an account's own
// launch graphics still win). When every window is in that game, tiling uses the
// profile's layout. The 24/7 Watcher uses its limits for those sessions.
const crypto = require('crypto');
const { JsonStore } = require('../store');
const paths = require('../paths');
const bus = require('../bus');

const LAYOUTS = ['', 'auto', 'columns', 'rows', 'grid2', 'grid3', 'grid4', 'main', 'cascade', 'fixed'];
const CAPS = [30, 60, 75, 120, 144, 165, 240, -1];
let store = null;
function init() { store = new JsonStore(paths.file('gameprofiles.json'), { profiles: [] }); return store; }
const list = () => (store ? store.get('profiles') : []);

const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : 0; };
function validate(p = {}) {
  const placeId = String(p.placeId || '').trim();
  if (!/^\d{1,15}$/.test(placeId)) throw new Error('A game profile needs the game\'s place ID.');
  const g = p.graphics || {}, w = p.watcher || {};
  return {
    placeId, name: String(p.name || '').trim().slice(0, 60) || `Place ${placeId}`,
    graphics: { enabled: !!g.enabled, quality: int(g.quality, 1, 10) || 1, fpsCap: CAPS.includes(Number(g.fpsCap)) ? Number(g.fpsCap) : 60 },
    layout: LAYOUTS.includes(p.layout) || require('./customlayouts').isKey(p.layout) ? p.layout : '',
    watcher: { stuckMin: int(w.stuckMin, 1, 60), freezeSec: int(w.freezeSec, 30, 1800), maxPerHour: int(w.maxPerHour, 1, 30) }, // 0 = use the normal setting
  };
}
function save(p) {
  const v = validate(p);
  const ex = list().find(x => x.placeId === v.placeId);
  if (ex) Object.assign(ex, v, { updatedAt: Date.now() });
  else list().push({ id: crypto.randomUUID(), createdAt: Date.now(), ...v });
  store.saveSoon();
  bus.emit('gameprofiles:changed');
  return list();
}
function remove(placeId) { store.set('profiles', list().filter(p => p.placeId !== String(placeId))); bus.emit('gameprofiles:changed'); return list(); }
const forPlace = (placeId) => (placeId ? list().find(p => p.placeId === String(placeId)) || null : null);

/** Graphics to apply before launching into this place, or null. */
function graphicsFor(placeId) { const p = forPlace(placeId); return p?.graphics.enabled ? { quality: p.graphics.quality, fpsCap: p.graphics.fpsCap } : null; }
/** The layout to tile with: the profile's, when every window is in the same game that has one. */
function layoutFor(sessionList) {
  const places = [...new Set(sessionList.filter(s => !s.external).map(s => String(s.placeId || '')))];
  if (places.length !== 1) return null;
  return forPlace(places[0])?.layout || null;
}
/** Watcher limits for a session: the normal settings with the game's overrides on top. */
function watcherFor(base, placeId) {
  const p = forPlace(placeId);
  if (!p) return base;
  const out = { ...base };
  for (const k of ['stuckMin', 'freezeSec', 'maxPerHour']) if (p.watcher[k]) out[k] = p.watcher[k];
  return out;
}

module.exports = { init, list, validate, save, remove, forPlace, graphicsFor, layoutFor, watcherFor, LAYOUTS };
