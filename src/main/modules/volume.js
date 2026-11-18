'use strict';
// Volume mixer: a volume level for each alt (the same as Windows' Volume Mixer,
// per Roblox client), remembered per account and put back every time it starts.
const settings = require('./settings');
const sessions = require('./sessions');
const accounts = require('./accounts');
const audio = require('./audio');
const bus = require('../bus');
const log = require('../logger').scope('volume');

const levels = () => settings.get('volume.levels') || {};
const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v))));
const running = () => sessions.listSessions().filter(s => s.status === 'running' && s.pid && !s.external && s.accountId);

/** Level for an account: its own, else the "all alts" level (pure-ish, unit-tested through view). */
function levelFor(accountId, cfg = settings.get('volume')) {
  const own = cfg.levels?.[accountId];
  return Number.isFinite(own) ? own : cfg.all;
}

async function apply(list) {
  const groups = new Map(); // level -> pids
  for (const s of list) {
    const v = levelFor(s.accountId);
    if (v === 100 && !applied.has(s.pid)) continue; // never touched: leave Windows' level alone
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(s.pid);
  }
  let n = 0;
  for (const [v, pids] of groups) {
    try { n += await audio.setVolume(pids, v); pids.forEach(p => applied.add(p)); } catch (e) { log.warn(`Volume not set: ${e.message}`); throw e; }
  }
  return n;
}
const applied = new Set(); // pids whose level we've set

async function set(accountId, level) {
  if (!accounts.find(accountId)) throw new Error('Account not found');
  const all = { ...levels(), [accountId]: clamp(level) };
  settings.set('volume.levels', all);
  await apply(running().filter(s => s.accountId === accountId));
  return view();
}

async function setAll(level, { resetOwn = false } = {}) {
  settings.set('volume.all', clamp(level));
  if (resetOwn) settings.set('volume.levels', {});
  await apply(running());
  return view();
}

async function reset(accountId) {
  const all = { ...levels() };
  delete all[accountId];
  settings.set('volume.levels', all);
  await apply(running().filter(s => s.accountId === accountId));
  return view();
}

function view() {
  const cfg = settings.get('volume');
  return {
    all: cfg.all,
    rows: running().map(s => ({ sessionId: s.id, accountId: s.accountId, label: s.label, avatarUrl: s.avatarUrl, level: levelFor(s.accountId, cfg), own: Number.isFinite(cfg.levels?.[s.accountId]) })),
    available: process.platform === 'win32', audio: audio.status(),
  };
}

function init() {
  // Roblox opens its audio a little after the window appears: set the level when it has joined, and once more later.
  bus.on('session:joined', ({ id } = {}) => {
    const again = () => { const s = running().find(x => x.id === id); if (s && (levelFor(s.accountId) !== 100)) apply([s]).catch(() => {}); };
    setTimeout(again, 3000);
    setTimeout(again, 60_000);
  });
  bus.on('sessions:changed', (list) => { const live = new Set((list || []).map(s => s.pid)); for (const p of applied) if (!live.has(p)) applied.delete(p); });
}

module.exports = { init, set, setAll, reset, view, levelFor };
