'use strict';
// Getting started checklist on the dashboard. Each step ticks itself off when
// you've done it; the card goes away when everything is done or you hide it.
const settings = require('./settings');
const bus = require('../bus');

const STEPS = [
  { id: 'account', title: 'Add your first account', page: 'accounts' },
  { id: 'launch', title: 'Launch an alt', page: 'sessions' },
  { id: 'tile', title: 'Tile your windows', page: 'sessions' },
  { id: 'perf', title: 'Pick an alt performance preset', page: 'perf' },
  { id: 'watcher', title: 'Turn on the 24/7 Watcher', page: 'watcher' },
  { id: 'alerts', title: 'Get alerts on Discord or your phone', page: 'discord' },
  { id: 'preset', title: 'Save a preset', page: 'presets' },
];

/** Which steps are done (pure, unit-tested). */
function compute(f) {
  const done = {
    account: f.accounts > 0,
    launch: !!f.launched,
    tile: !!f.tiled,
    perf: !!f.perf,
    watcher: !!f.watcher,
    alerts: !!f.alerts,
    preset: f.presets > 0,
  };
  const steps = STEPS.map(s => ({ ...s, done: !!done[s.id] }));
  return { steps, done: steps.filter(s => s.done).length, total: steps.length, complete: steps.every(s => s.done) };
}

const mark = (id) => {
  const d = settings.get('checklist.done') || [];
  if (!d.includes(id)) { settings.set('checklist.done', [...d, id]); bus.emit('checklist:update', status()); }
};

function facts() {
  const d = settings.get('checklist.done') || [];
  const accounts = (require('./accounts').getAll().accounts || []).length;
  let launched = d.includes('launch');
  if (!launched) {
    try { launched = require('./stats').summary(30).days.some(x => x.launches > 0) || require('./sessions').listSessions().some(s => s.status === 'running'); } catch { /* not started */ }
  }
  const p = settings.get('perf') || {};
  let alerts = false;
  try { alerts = require('./webhooks').listHooks().length > 0 || require('./alertapps').list().length > 0 || settings.get('phone.enabled'); } catch { /* not started */ }
  let presets = 0;
  try { presets = require('./presets').list().length; } catch { /* not started */ }
  return { accounts, launched, tiled: d.includes('tile'), perf: !!(p.fpsCap > 0 || p.lowGraphics || p.lighter) || d.includes('perf'), watcher: settings.get('watcher.enabled'), alerts, presets };
}

function status() {
  const c = compute(facts());
  return { ...c, hidden: !!settings.get('checklist.hidden') };
}

function hide(on = true) { settings.set('checklist.hidden', !!on); return status(); }

function init() {
  bus.on('session:joined', () => mark('launch'));
  bus.on('tiled', () => mark('tile'));
  bus.on('perf:changed', () => mark('perf'));
}

module.exports = { init, status, hide, compute, STEPS };
