'use strict';
// Login warnings. Roblox doesn't tell anyone in advance when a login will stop
// working, so MultiMenu checks the logins that matter before they are needed:
//  - right before a preset starts (expired accounts are skipped and named),
//  - 30 minutes before a scheduled preset start,
//  - once every evening at a set time (default 21:30), for the accounts you use.
// A check only asks Roblox "is this login still valid?" through the existing
// account-health check; nothing is sent anywhere else.
const settings = require('./settings');
const accounts = require('./accounts');
const bus = require('../bus');
const log = require('../logger').scope('logincheck');

let timer = null, lastEvening = '', last = null;
const warnedTasks = new Map(); // scheduled task id -> run time we already checked for
const FRESH_MS = 20 * 60_000;  // a check newer than this is trusted

const cfg = () => settings.get('loginCheck') || {};
const nameOf = (a) => a.alias || a.username;

/** Checks the given accounts (3 at a time, quick time-out) and returns the ones whose login is expired. */
async function check(ids, { force = false, timeoutMs = 8000 } = {}) {
  const health = require('./health');
  const list = [...new Set(ids || [])].map(accounts.find).filter(Boolean);
  const queue = list.filter(a => force || a.status === 'expired' || !a.health?.checkedAt || Date.now() - a.health.checkedAt > FRESH_MS);
  const worker = async () => {
    while (queue.length) {
      const a = queue.shift();
      try { await Promise.race([health.checkOne(a.id), new Promise(r => setTimeout(r, timeoutMs))]); } catch (e) { log.warn(e.message); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const expired = list.map(a => accounts.find(a.id)).filter(a => a && (a.status === 'expired' || a.health?.state === 'expired'));
  return { checked: list.length, expired: expired.map(a => ({ id: a.id, name: nameOf(a) })) };
}

function listNames(xs, max = 4) { const n = xs.map(x => x.name); return n.length > max ? `${n.slice(0, max).join(', ')} +${n.length - max}` : n.join(', '); }

function warn(expired, kind, name) {
  if (!expired.length) return;
  const names = listNames(expired), n = expired.length;
  const detail = {
    evening: n === 1 ? `1 login needs refreshing before tomorrow: ${names}` : `${n} logins need refreshing before tomorrow: ${names}`,
    preset: `Skipped in “${name}” because the login expired: ${names}`,
    soon: `“${name}” starts in 30 minutes, but these logins need refreshing: ${names}`,
  }[kind];
  bus.emit('event', { type: 'loginWarning', detail });
}

/** Called by presets before launching. Returns the ids that are fine to launch. */
async function preflight(ids, label) {
  if (!cfg().beforeStart) return { ok: ids, expired: [] };
  const r = await check(ids);
  const bad = new Set(r.expired.map(x => x.id));
  if (r.expired.length) warn(r.expired, 'preset', label || 'preset');
  return { ok: ids.filter(id => !bad.has(id)), expired: r.expired };
}

/** The accounts worth checking in the evening: used in a preset, a favourite, or used in the last 14 days. */
function accountsInUse() {
  const inPresets = new Set();
  try { const pr = require('./presets'); for (const p of pr.list()) for (const id of pr.idsOf(p)) inPresets.add(id); } catch { /* none */ }
  return accounts.getAll().accounts.filter(a => inPresets.has(a.id) || a.favourite || (a.lastUsedAt && Date.now() - a.lastUsedAt < 14 * 86400_000)).map(a => a.id);
}

async function evening() {
  const r = await check(accountsInUse(), { force: true });
  last = { at: Date.now(), ...r };
  warn(r.expired, 'evening');
  bus.emit('logincheck:update', status());
  return status();
}

async function tick(now = new Date()) {
  const c = cfg();
  if (!c.enabled) return;
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const day = now.toDateString();
  if (hm === c.time && lastEvening !== day) { lastEvening = day; evening().catch(e => log.warn(e.message)); }
  // 30 minutes before a scheduled preset start: check that preset's accounts.
  try {
    const sched = require('./scheduler'), presets = require('./presets');
    for (const t of sched.view()) {
      if (!t.enabled || t.action !== 'launchPreset' || !t.nextRunAt) continue;
      const mins = (t.nextRunAt - now.getTime()) / 60_000;
      if (mins > 29 && mins <= 31 && warnedTasks.get(t.id) !== t.nextRunAt) {
        warnedTasks.set(t.id, t.nextRunAt);
        const p = presets.get(t.presetId);
        if (p) check(require('./presets').idsOf(p), { force: true }).then(r => warn(r.expired, 'soon', t.name)).catch(() => {});
      }
    }
  } catch (e) { log.warn(e.message); }
}

function status() {
  const expired = accounts.getAll().accounts.filter(a => a.status === 'expired' || a.health?.state === 'expired').map(a => ({ id: a.id, name: nameOf(a) }));
  return { config: cfg(), last, expired };
}

function init() {
  clearInterval(timer);
  timer = setInterval(() => { tick().catch(() => {}); }, 60_000);
}
function stop() { clearInterval(timer); timer = null; }

module.exports = { init, stop, check, preflight, evening, tick, status, accountsInUse };
