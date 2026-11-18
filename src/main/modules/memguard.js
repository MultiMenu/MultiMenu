'use strict';
// Memory guard. Roblox clients slowly use more RAM over long sessions. Every
// minute this records each client's memory, works out the growth rate over the
// last hour (least-squares slope), and restarts a client back into the same
// server when it is above your hard limit, or clearly leaking. It never restarts
// the window you're using (optional), and only one client at a time.
const settings = require('./settings');
const sessions = require('./sessions');
const stats = require('./stats');
const win32 = require('../native/win32');
const bus = require('../bus');
const log = require('../logger').scope('memguard');

const history = new Map(); // sessionId -> [{ t, mb }]
const recent = []; // last restarts
let timer = null, lastRestartAt = 0;
const MAX_PER_HOUR = 3; // per account: more means the limit is lower than this game needs
const warned = new Map(); // accountId -> when we said so

/** Least-squares slope in MB per hour. */
function slopeMBh(samples) {
  if (samples.length < 2) return 0;
  const t0 = samples[0].t, xs = samples.map(s => (s.t - t0) / 3600_000), ys = samples.map(s => s.mb);
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : 0;
}

/** Pure decision (exported for tests). */
function evaluate(samples, now, cfg, uptimeMs) {
  const window = samples.filter(s => now - s.t <= 3600_000);
  const mb = samples.at(-1)?.mb || 0;
  const slope = window.length >= 20 ? slopeMBh(window) : 0;
  if (uptimeMs < cfg.minUptimeMin * 60_000) return { restart: false, slope, mb, reason: 'warming up' };
  if (mb >= cfg.maxMB) return { restart: true, slope, mb, reason: `Using ${mb} MB (limit ${cfg.maxMB} MB)` };
  if (window.length >= 20 && slope >= cfg.leakMBPerHour && mb >= window[0].mb * 1.3) {
    return { restart: true, slope, mb, reason: `Memory leak: growing ${Math.round(slope)} MB/hour (now ${mb} MB)` };
  }
  return { restart: false, slope, mb, reason: null };
}

function restart(s, reason, auto = false) {
  const raw = sessions.getRaw(s.id);
  lastRestartAt = Date.now();
  stats.add(s.accountId, 'memRestarts', 1, s.label);
  stats.event({ type: 'memory', account: s.label, accountId: s.accountId, detail: `${reason} — restarted into the same server.` });
  recent.unshift({ at: Date.now(), label: s.label, reason, accountId: s.accountId, auto });
  if (recent.length > 20) recent.length = 20;
  bus.emit('event', { type: 'memoryRestart', account: s.label, detail: `${reason}. Restarting into the same server.` });
  log.info(`Restarting ${s.label}: ${reason}`);
  sessions.endForRestart(s.id, `${reason} — restarting.`);
  const target = { ...(raw?.target || {}) };
  if ((raw?.jobId || target.jobId) && !target.linkCode) target.jobId = raw?.jobId || target.jobId;
  setTimeout(() => sessions.launch(s.accountId, null, { label: s.label, watch: raw?.watch, target: Object.keys(target).length ? target : null }), 4000);
  history.delete(s.id);
}

function tick() {
  const cfg = settings.get('memGuard');
  const now = Date.now();
  const running = sessions.listSessions().filter(s => s.status === 'running' && !s.external && s.pid);
  for (const s of running) {
    const h = history.get(s.id) || [];
    if (s.memMB) h.push({ t: now, mb: s.memMB });
    while (h.length > 150) h.shift();
    history.set(s.id, h);
  }
  for (const id of history.keys()) if (!running.some(s => s.id === id)) history.delete(id);
  if (!cfg.enabled || now - lastRestartAt < 90_000) return;
  const fg = cfg.avoidFocused && win32.available ? win32.foregroundPid() : 0;
  for (const s of running) {
    if (cfg.watchedOnly && !s.watch) continue;
    const d = evaluate(history.get(s.id) || [], now, cfg, now - s.startedAt);
    if (!d.restart) continue;
    if (s.pid === fg) continue; // you're using this window: try again next minute
    // A limit set below what this game needs would restart the same alt forever.
    const lastHour = recent.filter(r => r.accountId === s.accountId && r.auto && now - r.at < 3600_000).length;
    if (lastHour >= MAX_PER_HOUR) {
      if (now - (warned.get(s.accountId) || 0) > 3600_000) {
        warned.set(s.accountId, now);
        bus.emit('notify', { level: 'warn', title: 'Memory guard paused for one account', message: `${s.label} was restarted ${lastHour} times this hour for memory. The limit (${cfg.maxMB} MB) may be too low for this game.` });
      }
      continue;
    }
    restart(s, d.reason, true);
    return; // one at a time
  }
}

function restartNow(id) {
  const s = sessions.listSessions().find(x => x.id === id && x.status === 'running');
  if (!s) throw new Error('That session is not running.');
  restart(s, 'Manual memory restart');
  return true;
}

function status() {
  const cfg = settings.get('memGuard');
  const now = Date.now();
  return {
    config: cfg, recent,
    clients: sessions.listSessions().filter(s => s.status === 'running' && !s.external).map(s => {
      const h = history.get(s.id) || [];
      const d = evaluate(h, now, cfg, now - s.startedAt);
      return { id: s.id, label: s.label, mb: s.memMB || 0, slope: Math.round(d.slope), samples: h.length, uptimeMs: now - s.startedAt, flagged: d.restart ? d.reason : null, spark: h.slice(-60).map(x => x.mb) };
    }),
  };
}

function init() { clearInterval(timer); timer = setInterval(() => { try { tick(); } catch (e) { log.error('tick', e); } }, 60_000); }

module.exports = { init, tick, status, restartNow, evaluate, slopeMBh };
