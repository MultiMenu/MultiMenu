'use strict';
// Auto-scale: launch alts while your PC has room and close the least important
// ones when it runs low. You set a RAM budget (keep X GB free, or let Roblox use at
// most Y GB) and a CPU limit. Main accounts are never closed; Filler alts go
// first, then Important. Each change waits for the PC to settle before the next.
const os = require('os');
const settings = require('./settings');
const accounts = require('./accounts');
const sessions = require('./sessions');
const bus = require('../bus');
const log = require('../logger').scope('autoscale');

const UP_COOLDOWN = 90_000, DOWN_COOLDOWN = 45_000, SUSTAIN = 30_000;
const state = { timer: null, cooldownUntil: 0, overSince: null, decisions: [], launched: new Set() };
const cfg = () => settings.get('autoScale');

/**
 * Pure decision (unit-tested). Returns { action: 'up' | 'down' | 'hold', reason, accountId?, sessionId? }.
 * input: { cfg, freeMB, robloxMB, cpu, running: [{ id, accountId, tier, startedAt, mine, external }], candidates: [accountId], now, overSince, quiet }
 */
function decide({ cfg: c, freeMB, robloxMB, cpu, running, candidates, now = Date.now(), overSince = null, quiet = false }) {
  const managed = running.filter(r => !r.external);
  const count = running.length;
  const per = Math.max(700, Math.round(running.filter(r => r.memMB > 300).reduce((a, r) => a + r.memMB, 0) / Math.max(1, running.filter(r => r.memMB > 300).length)) || 1100);
  const freeNeed = Math.max(0.5, Number(c.freeGB) || 2) * 1024, cap = Math.max(1, Number(c.capGB) || 12) * 1024;
  const cpuMax = Math.min(100, Math.max(30, Number(c.cpuMax) || 85));
  const ramOver = c.budget === 'cap' ? robloxMB > cap : freeMB < freeNeed;
  const over = ramOver || cpu > cpuMax + 5;
  const room = (c.budget === 'cap' ? robloxMB + per < cap - 256 : freeMB - per > freeNeed + 512) && cpu < cpuMax - 10;
  const why = ramOver ? (c.budget === 'cap' ? `Roblox is using ${(robloxMB / 1024).toFixed(1)} GB` : `only ${(freeMB / 1024).toFixed(1)} GB RAM free`) : `CPU at ${Math.round(cpu)}%`;
  if (over) {
    if (!overSince || now - overSince < SUSTAIN) return { action: 'hold', reason: 'over budget, waiting to be sure', over: true };
    if (managed.length && count > Math.max(0, Number(c.min) || 0)) {
      const rank = (t) => ({ filler: 0, important: 1, main: 2 }[t] ?? 0);
      const victim = managed.filter(r => r.tier !== 'main').sort((a, b) => rank(a.tier) - rank(b.tier) || (b.mine - a.mine) || (b.startedAt - a.startedAt))[0];
      if (victim) return { action: 'down', sessionId: victim.id, accountId: victim.accountId, reason: why, over: true };
    }
    return { action: 'hold', reason: `${why}, but nothing can be closed`, over: true };
  }
  if (count >= Math.max(1, Number(c.max) || 10)) return { action: 'hold', reason: 'at the most clients you allowed' };
  if (!candidates.length) return { action: 'hold', reason: 'every account in the pool is running' };
  if (quiet) return { action: 'hold', reason: 'quiet hours' };
  if (!room) return { action: 'hold', reason: 'not enough room for another client' };
  return { action: 'up', accountId: candidates[0], reason: `${(freeMB / 1024).toFixed(1)} GB free, CPU ${Math.round(cpu)}%` };
}

function poolIds(c = cfg()) {
  const list = c.tag ? accounts.resolve(`tag:${c.tag}`) : (c.accountIds || []).map(id => accounts.find(id)).filter(Boolean);
  return accounts.byTier(list.filter(a => a.status !== 'expired').map(a => a.id));
}

function measure() {
  const sys = require('./system');
  const hist = (sys.history() || []).slice(-15);
  const cpu = hist.length ? hist.reduce((a, h) => a + (h.cpu || 0), 0) / hist.length : (sys.latest()?.cpu || 0);
  const latest = sys.latest();
  return { freeMB: os.freemem() / 1048576, robloxMB: latest?.roblox?.memMB || 0, cpu };
}

function note(d) {
  state.decisions.unshift({ at: Date.now(), action: d.action, reason: d.reason, label: d.label || null });
  state.decisions.length = Math.min(state.decisions.length, 20);
}

async function tick(now = Date.now()) {
  const c = cfg();
  if (!c.enabled || now < state.cooldownUntil) return null;
  const live = sessions.listSessions().filter(s => s.status === 'running' || s.status === 'launching');
  if (live.some(s => s.status === 'launching')) return null; // let launches finish first
  const running = live.map(s => ({ id: s.id, accountId: s.accountId, external: !!s.external, startedAt: s.startedAt, memMB: s.memMB || 0, mine: state.launched.has(s.accountId), tier: s.accountId ? accounts.publicView(accounts.find(s.accountId) || {}).tier : null }));
  const runIds = new Set(running.map(r => r.accountId));
  const candidates = poolIds(c).filter(id => !runIds.has(id));
  const m = measure();
  const d = decide({ cfg: c, ...m, running, candidates, now, overSince: state.overSince, quiet: require('./watcher').isQuiet() });
  state.overSince = d.over ? (state.overSince || now) : null;
  const prev = state.decisions[0];
  if (d.action === 'up') {
    const a = accounts.find(d.accountId);
    d.label = a ? (a.alias || a.displayName || a.username) : '';
    state.launched.add(d.accountId);
    sessions.launch(d.accountId, c.game || null, { watch: !!c.watch });
    state.cooldownUntil = now + UP_COOLDOWN;
    log.info(`Scale up: ${d.label} (${d.reason})`);
    bus.emit('notify', { level: 'info', title: 'Auto-scale: launching', message: `${d.label} · ${d.reason}` });
  } else if (d.action === 'down') {
    const s = sessions.listSessions().find(x => x.id === d.sessionId);
    d.label = s?.label || '';
    sessions.setWatch(d.sessionId, false);
    await sessions.close(d.sessionId);
    state.launched.delete(d.accountId);
    state.cooldownUntil = now + DOWN_COOLDOWN;
    state.overSince = null;
    log.info(`Scale down: ${d.label} (${d.reason})`);
    bus.emit('notify', { level: 'warn', title: 'Auto-scale: closed an alt', message: `${d.label} · ${d.reason}` });
  }
  if (d.action !== 'hold' || !prev || prev.reason !== d.reason) { note(d); bus.emit('autoscale:update', status()); }
  return d;
}

function start() { clearInterval(state.timer); state.timer = setInterval(() => tick().catch(e => log.warn(e.message)), 15_000); state.timer.unref?.(); }
function stop() { clearInterval(state.timer); state.timer = null; }
function init() { if (cfg().enabled) start(); }
function setEnabled(on) {
  settings.set('autoScale.enabled', !!on);
  if (on) { state.cooldownUntil = 0; start(); setTimeout(() => tick().catch(() => {}), 1000); } else stop();
  bus.emit('autoscale:update', status());
  return status();
}
function status() {
  const c = cfg();
  let m = null;
  try { m = measure(); } catch { /* not ready */ }
  return { enabled: !!c.enabled, config: c, pool: poolIds(c).length, decisions: state.decisions.slice(0, 10), cooldownUntil: state.cooldownUntil, now: m ? { freeGB: +(m.freeMB / 1024).toFixed(1), robloxGB: +(m.robloxMB / 1024).toFixed(1), cpu: Math.round(m.cpu) } : null };
}

module.exports = { init, start, stop, tick, decide, setEnabled, status, poolIds };
