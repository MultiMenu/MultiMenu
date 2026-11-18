'use strict';
// Achievements: little milestones for using MultiMenu. Worked out on this PC from
// your own stats; nothing is uploaded.
const { JsonStore } = require('../store');
const paths = require('../paths');
const bus = require('../bus');
const log = require('../logger').scope('achievements');

const H = 3600000;
// [id, icon, title, description, check(ctx) -> [current, goal]]
const LIST = [
  ['first', 'rocket', 'First flight', 'Launch an account with MultiMenu', c => [c.launches, 1]],
  ['alts10', 'users', 'Squad goals', 'Save 10 accounts', c => [c.accounts, 10]],
  ['alts25', 'users', 'Army', 'Save 25 accounts', c => [c.accounts, 25]],
  ['alts50', 'crown', 'Legion', 'Save 50 accounts', c => [c.accounts, 50]],
  ['run5', 'layout-grid', 'Five at once', 'Run 5 alts at the same time', c => [c.concurrent, 5]],
  ['run10', 'layout-grid', 'Ten at once', 'Run 10 alts at the same time', c => [c.concurrent, 10]],
  ['run20', 'server', 'Server farm', 'Run 20 alts at the same time', c => [c.concurrent, 20]],
  ['hours24', 'clock', 'Day one', '24 hours of alt time', c => [c.hours, 24]],
  ['hours100', 'clock', 'Centurion', '100 hours of alt time', c => [c.hours, 100]],
  ['hours1000', 'trophy', 'Thousand club', '1,000 hours of alt time', c => [c.hours, 1000]],
  ['marathon', 'timer', 'Marathon', 'Keep one alt on for 12 hours', c => [c.longestH, 12]],
  ['ironman', 'shield-check', 'Ironman', 'Keep one alt on for 24 hours', c => [c.longestH, 24]],
  ['nightowl', 'moon', 'Night owl', 'Have an alt running at 3 AM', c => [c.nightOwl ? 1 : 0, 1]],
  ['streak7', 'flame', 'On a roll', 'A 7-day streak', c => [c.streak, 7]],
  ['streak30', 'flame', 'Unstoppable', 'A 30-day streak', c => [c.streak, 30]],
  ['rejoin100', 'repeat', 'Never give up', 'The 24/7 Watcher rejoined 100 times', c => [c.rejoins, 100]],
  ['tags', 'tags', 'Organised', 'Use 5 different tags', c => [c.tags, 5]],
  ['automator', 'zap', 'Automator', 'Have an automation run', c => [c.automationRuns, 1]],
  ['commander', 'command', 'Commander', 'Control MultiMenu from the command line, a script or a Stream Deck', c => [c.commands, 1]],
  ['remote', 'smartphone', 'Remote control', 'Sign in on the phone dashboard', c => [c.phone, 1]],
  ['tiler', 'layout-dashboard', 'Neat freak', 'Tile your windows 50 times', c => [c.tiles, 50]],
  ['sharer', 'link', 'Sharing is caring', 'Make a share code', c => [c.shares, 1]],
  ['doctor', 'heart-pulse', 'Clean bill of health', 'Run the Doctor with nothing wrong', c => [c.doctorOk, 1]],
  ['eco', 'leaf', 'Eco warrior', 'Turn on eco mode', c => [c.eco, 1]],
];

let store = null, timer = null, pending = null;
function init() {
  store = new JsonStore(paths.file('achievements.json'), { unlocked: {}, counters: {}, best: { concurrent: 0 } });
  if (!attached) attach();
  clearInterval(timer);
  timer = setInterval(() => evaluate(), 10 * 60_000);
  timer.unref?.();
  setTimeout(() => evaluate(true), 15_000).unref?.();
  return store;
}

function count(name, by = 1) {
  if (!store) return;
  const c = store.get('counters');
  c[name] = (c[name] || 0) + by;
  store.saveSoon();
  soon();
}
function soon() { clearTimeout(pending); pending = setTimeout(() => evaluate(), 4000); pending.unref?.(); }

function context() {
  const ov = require('./stats').overview();
  const accounts = require('./accounts');
  const rec = (() => { try { return require('./timeline').records(); } catch { return { longestMs: 0, nightOwl: false }; } })();
  const c = store.get('counters'), best = store.get('best');
  return {
    launches: ov.totals.launches, accounts: accounts.raw().accounts.length, concurrent: best.concurrent || 0, hours: ov.totals.hours,
    longestH: Math.floor(rec.longestMs / H), nightOwl: rec.nightOwl, streak: Math.max(ov.streak.current, ov.streak.longest), rejoins: ov.totals.rejoins,
    tags: accounts.allTags().length, automationRuns: c.automationRuns || 0, commands: c.commands || 0, phone: c.phone || 0,
    tiles: c.tiles || 0, shares: c.shares || 0, doctorOk: c.doctorOk || 0, eco: c.eco || 0,
  };
}

/** Pure (unit-tested): progress for every achievement. */
function progress(ctx, unlocked = {}) {
  return LIST.map(([id, icon, title, desc, check]) => {
    const [cur, goal] = check(ctx);
    const done = !!unlocked[id] || cur >= goal;
    return { id, icon, title, desc, done, at: unlocked[id] || null, current: Math.min(goal, Math.floor(cur || 0)), goal };
  });
}

function evaluate(silent = false) {
  if (!store) return [];
  let list;
  try { list = progress(context(), store.get('unlocked')); } catch (e) { log.warn(e.message); return []; }
  const unlocked = store.get('unlocked');
  const fresh = list.filter(a => a.done && !unlocked[a.id]);
  for (const a of fresh) {
    unlocked[a.id] = Date.now();
    // The first evaluation after updating unlocks what you already did, without a pile of pop-ups.
    if (!silent || fresh.length <= 2) bus.emit('event', { type: 'achievement', detail: a.title });
  }
  if (fresh.length) { store.saveSoon(); bus.emit('achievements:update', status()); }
  return fresh;
}

function status() {
  const list = progress(context(), store.get('unlocked')).map(a => ({ ...a, at: store.get('unlocked')[a.id] || null }));
  return { list, unlocked: list.filter(a => a.done).length, total: list.length };
}
function unlockedBetween(from, to) {
  if (!store) return [];
  const u = store.get('unlocked');
  return LIST.filter(([id]) => u[id] && u[id] >= from && u[id] < to).map(([id, icon, title]) => ({ id, icon, title }));
}

let attached = false;
function attach() {
  attached = true;
  bus.on('command:run', (e) => { if (['cli', 'api', 'streamdeck'].includes(e.source)) count('commands'); });
  bus.on('automations:ran', () => count('automationRuns'));
  bus.on('phone:login', () => count('phone'));
  bus.on('tiled', () => count('tiles'));
  bus.on('share:created', () => count('shares'));
  bus.on('doctor:allOk', () => count('doctorOk'));
  bus.on('limiter:update', (s) => { if (s?.running && s.config?.eco && !(store?.get('counters').eco)) count('eco'); });
  bus.on('session:started', () => {
    if (!store) return;
    const n = require('./sessions').listSessions().filter(s => s.status === 'running').length;
    const best = store.get('best');
    if (n > (best.concurrent || 0)) { best.concurrent = n; store.saveSoon(); }
    soon();
  });
  bus.on('session:stopped', () => soon());
  bus.on('accounts:changed', () => soon());
}

/** Admin mode: forget every unlock and counter (progress from stats comes back on the next check). */
function reset() {
  if (!store) return null;
  store.replace({ unlocked: {}, counters: {}, best: { concurrent: 0 } });
  store.saveNow();
  bus.emit('achievements:update', status());
  return status();
}
/** Admin mode: shows the unlock pop-up for one achievement without changing anything. */
function preview(id) {
  const a = LIST.find(x => x[0] === id);
  if (!a) throw new Error('Unknown achievement.');
  bus.emit('event', { type: 'achievement', detail: a[2], test: true });
  return true;
}

module.exports = { init, evaluate, status, progress, count, unlockedBetween, reset, preview, LIST };
