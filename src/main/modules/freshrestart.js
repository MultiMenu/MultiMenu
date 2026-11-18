'use strict';
// Fresh restarts: long sessions get slower and use more memory, so every few
// hours each alt is restarted back into the same server, one at a time with a
// gap between them, so they never all drop together.
const settings = require('./settings');
const sessions = require('./sessions');
const accounts = require('./accounts');
const win32 = require('../native/win32');
const bus = require('../bus');
const log = require('../logger').scope('freshrestart');

let timer = null, lastAt = 0;
const recent = [];

/** The session to restart now, or null (pure, unit-tested). */
function pick(list, { now, everyHours, gapMin, lastAt: lastRestart, skipMain, focusedPid, busy, tierOf = () => 'filler' }) {
  if (busy) return null;
  if (now - (lastRestart || 0) < gapMin * 60_000) return null;
  const due = list.filter(s => s.status === 'running' && s.pid && !s.external && s.accountId
    && now - s.startedAt >= everyHours * 3600_000
    && s.pid !== focusedPid
    && !(skipMain && tierOf(s.accountId) === 'main'));
  due.sort((a, b) => a.startedAt - b.startedAt);
  return due[0] || null;
}

function restart(s, auto = true) {
  const raw = sessions.getRaw(s.id);
  lastAt = Date.now();
  const reason = `Fresh restart after ${Math.floor((Date.now() - s.startedAt) / 3600_000)}h`;
  recent.unshift({ at: Date.now(), label: s.label, accountId: s.accountId, auto });
  if (recent.length > 20) recent.length = 20;
  bus.emit('event', { type: 'freshRestart', account: s.label, detail: `${reason}. Rejoining the same server.` });
  log.info(`${s.label}: ${reason}`);
  sessions.endForRestart(s.id, `${reason} — restarting.`);
  const target = { ...(raw?.target || {}) };
  if ((raw?.jobId || target.jobId) && !target.linkCode) target.jobId = raw?.jobId || target.jobId;
  setTimeout(() => sessions.launch(s.accountId, null, { label: s.label, watch: raw?.watch, target: Object.keys(target).length ? target : null }), 4000);
}

function tick() {
  const cfg = settings.get('freshRestart');
  if (!cfg.enabled) return;
  const q = sessions.queueView ? sessions.queueView() : {};
  const s = pick(sessions.listSessions(), {
    now: Date.now(), everyHours: cfg.everyHours, gapMin: cfg.gapMin, lastAt, skipMain: cfg.skipMain,
    focusedPid: cfg.avoidFocused && win32.available ? win32.foregroundPid() : 0,
    busy: !!(q.current || (q.items && q.items.length)),
    tierOf: (id) => accounts.find(id)?.tier || 'filler',
  });
  if (s) restart(s);
}

function next() {
  const cfg = settings.get('freshRestart');
  const list = sessions.listSessions().filter(s => s.status === 'running' && s.pid && !s.external && s.accountId && !(cfg.skipMain && accounts.find(s.accountId)?.tier === 'main'));
  return list.map(s => ({ id: s.id, label: s.label, dueAt: s.startedAt + cfg.everyHours * 3600_000 })).sort((a, b) => a.dueAt - b.dueAt).slice(0, 10);
}

function status() { return { config: settings.get('freshRestart'), recent: recent.slice(0, 10), next: next(), lastAt }; }

function restartNow(id) {
  const s = sessions.listSessions().find(x => x.id === id && x.status === 'running' && x.pid && !x.external);
  if (!s) throw new Error('That alt isn\'t running.');
  restart(s, false);
  return status();
}

function init() {
  clearInterval(timer);
  timer = setInterval(() => { try { tick(); } catch (e) { log.warn(e.message); } }, 60_000);
  timer.unref?.();
}

module.exports = { init, tick, pick, status, restartNow };
