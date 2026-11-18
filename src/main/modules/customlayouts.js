'use strict';
// Custom tiling layouts: zones you draw yourself (Sessions & Tiling → Draw your own).
// A zone is a part of the monitor's work area as fractions (0..1), so a layout works on
// any monitor size. Windows fill the zones in order; with more windows than zones, the
// extra ones go into the zones again, a little offset, so every window still shows.
const crypto = require('crypto');
const paths = require('../paths');
const bus = require('../bus');
const { JsonStore } = require('../store');

const MAX_LAYOUTS = 30;
const MAX_ZONES = 40;
let store = null;
const db = () => store || (store = new JsonStore(paths.file('customlayouts.json'), { layouts: [] }));

const r4 = (v) => Math.round(v * 10000) / 10000;

/** Zones checked and kept on screen; tiny or invalid ones dropped. */
function cleanZones(zones) {
  if (!Array.isArray(zones)) throw new Error('A layout needs at least one zone.');
  const out = [];
  for (const z of zones.slice(0, MAX_ZONES)) {
    let x = Number(z?.x), y = Number(z?.y), w = Number(z?.w), h = Number(z?.h);
    if (![x, y, w, h].every(Number.isFinite)) continue;
    x = Math.min(0.98, Math.max(0, x)); y = Math.min(0.98, Math.max(0, y));
    w = Math.min(1 - x, Math.max(0.02, w)); h = Math.min(1 - y, Math.max(0.02, h));
    out.push({ x: r4(x), y: r4(y), w: r4(w), h: r4(h) });
  }
  if (!out.length) throw new Error('A layout needs at least one zone.');
  return out;
}

function clean(l) {
  return {
    id: typeof l.id === 'string' && /^[\w-]{1,60}$/.test(l.id) ? l.id : crypto.randomUUID(),
    name: String(l.name || '').trim().slice(0, 40) || 'My layout',
    zones: cleanZones(l.zones),
  };
}

const list = () => db().get('layouts');
const get = (id) => list().find(l => l.id === id) || null;
/** 'custom:<id>' -> the layout, or null. */
function fromKey(key) { const m = /^custom:([\w-]{1,60})$/.exec(String(key || '')); return m ? get(m[1]) : null; }
const isKey = (key) => !!fromKey(key);

function save(l) {
  const layout = clean(l || {});
  const all = list();
  const i = all.findIndex(x => x.id === layout.id);
  if (i >= 0) all[i] = layout; else { if (all.length >= MAX_LAYOUTS) throw new Error(`At most ${MAX_LAYOUTS} custom layouts.`); all.push(layout); }
  db().set('layouts', all);
  bus.emit('customlayouts:changed');
  return layout;
}

function remove(id) {
  db().set('layouts', list().filter(l => l.id !== id));
  // Anything set to the removed layout goes back to the smart grid.
  const settings = require('./settings');
  if (settings.get('tiling.layout') === `custom:${id}`) settings.set('tiling.layout', 'auto');
  bus.emit('customlayouts:changed');
  return list();
}

/** Window rectangles for n windows in the work area a (pure). */
function rects(zones, n, a, gap = 0) {
  const half = gap / 2;
  return Array.from({ length: n }, (_, i) => {
    const z = zones[i % zones.length];
    const round = Math.floor(i / zones.length); // more windows than zones: offset each extra round
    const off = round * 28;
    return {
      x: a.x + z.x * a.width + half + off, y: a.y + z.y * a.height + half + off,
      width: Math.max(16, z.w * a.width - gap), height: Math.max(16, z.h * a.height - gap),
    };
  });
}

/** For the layout picker: { 'custom:<id>': name }. */
function names() { return Object.fromEntries(list().map(l => [`custom:${l.id}`, l.name])); }

module.exports = { list, get, fromKey, isKey, save, remove, rects, names, cleanZones, MAX_ZONES };
