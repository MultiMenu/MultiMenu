'use strict';
// Account health: checks each saved account for an expired login, a ban, or an
// active moderation notice, on a timer (default every 6 hours) and on demand.
// Problems are shown on the account card and sent as notifications / Discord.
const settings = require('./settings');
const accounts = require('./accounts');
const roblox = require('./roblox');
const bus = require('../bus');
const log = require('../logger').scope('health');

let timer = null, running = false, lastRun = null;

/** Checks one account; returns { state: ok|expired|banned|moderated|error, detail }. */
async function checkOne(id) {
  const a = accounts.find(id);
  if (!a) throw new Error('Account not found');
  let health;
  try {
    const info = await roblox.getUserInfo(a.userId);
    if (info.missing) health = { state: 'banned', detail: 'This Roblox account no longer exists.' };
    else if (info.isBanned) health = { state: 'banned', detail: 'Roblox reports this account as banned.' };
    else {
      const cookie = accounts.getCookie(id);
      await roblox.getAuthenticatedUser(cookie);
      const mod = await roblox.getModeration(cookie).catch(e => { if (e.code === 'INVALID') throw e; return null; });
      health = mod ? { state: 'moderated', detail: `${mod.type}${mod.endDate ? ` until ${new Date(mod.endDate).toLocaleString()}` : ''}${mod.reason ? ` — ${mod.reason}` : ''}` } : { state: 'ok', detail: 'Login valid, no moderation.' };
    }
  } catch (e) {
    health = e.code === 'INVALID' ? { state: 'expired', detail: 'Login expired — log in again.' } : { state: 'error', detail: e.message };
  }
  const prev = a.health?.state;
  accounts.setHealth(id, { ...health, checkedAt: Date.now() });
  if (['expired', 'banned', 'moderated'].includes(health.state) && prev !== health.state) {
    bus.emit('event', { type: 'accountHealth', account: a.alias || a.username, status: health.state, detail: health.detail });
  }
  return health;
}

async function checkAll() {
  if (running) return summary();
  running = true;
  try {
    for (const a of accounts.getAll().accounts) {
      try { await checkOne(a.id); } catch (e) { log.warn(e.message); }
      await new Promise(r => setTimeout(r, 500));
    }
    lastRun = Date.now();
  } finally { running = false; }
  return summary();
}

function summary() {
  const list = accounts.getAll().accounts;
  const count = (s) => list.filter(a => a.health?.state === s).length;
  return { total: list.length, ok: count('ok'), expired: count('expired'), banned: count('banned'), moderated: count('moderated'), unchecked: list.filter(a => !a.health).length, running, lastRun, config: settings.get('health') };
}

function start() {
  clearInterval(timer);
  if (!settings.get('health.autoCheck')) return;
  const h = Math.max(1, Number(settings.get('health.intervalHours')) || 6);
  timer = setInterval(() => checkAll().catch(() => {}), h * 3600_000);
  setTimeout(() => checkAll().catch(() => {}), 60_000);
}

module.exports = { checkOne, checkAll, summary, start };
