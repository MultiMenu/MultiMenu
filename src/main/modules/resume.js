'use strict';
// Resume after restart. While accounts are running, MultiMenu keeps a small
// snapshot (account, game, exact server, label, watch on/off). After a reboot,
// Windows update or crash, the next start offers to put everything back - or
// does it automatically if you turn that on.
const { JsonStore } = require('../store');
const paths = require('../paths');
const settings = require('./settings');
const sessions = require('./sessions');
const accounts = require('./accounts');
const processes = require('./processes');
const bus = require('../bus');
const log = require('../logger').scope('resume');

let store, timer = null, pending = null;

/** Snapshot of the sessions worth resuming. Pure-ish (exported for tests). */
function snapshotFrom(list, raw) {
  return list.filter(s => s.status === 'running' && s.accountId && !s.external).map(s => {
    const r = raw(s.id) || {};
    const target = { ...(r.target || {}) };
    if (r.jobId && !target.linkCode && !target.followUserId) target.jobId = r.jobId;
    return { accountId: s.accountId, label: s.label, watch: !!s.watch, target: Object.keys(target).length ? target : null, placeName: s.placeName || null };
  });
}

function save() {
  const list = sessions.listSessions();
  const snap = snapshotFrom(list, sessions.getRaw);
  if (!snap.length) {
    // You closed everything on purpose -> nothing to resume. If clients died
    // (shutdown, crash) the last snapshot is kept so it can be resumed.
    const mine = list.filter(s => !s.external && s.accountId);
    if (mine.length && mine.every(s => s.status === 'closed')) clear();
    return;
  }
  store.replace({ savedAt: Date.now(), sessions: snap });
}

function clear() { store.replace({ savedAt: null, sessions: [] }); store.saveNow(); pending = null; }

/** Called at startup. Returns what can be resumed (or null). */
function check() {
  const cfg = settings.get('resume');
  const data = store.get();
  if (!cfg.enabled || !data.sessions?.length || !data.savedAt) return null;
  if (Date.now() - data.savedAt > cfg.maxAgeHours * 3600_000) return null;
  const valid = data.sessions.filter(s => { const a = accounts.find(s.accountId); return a && a.status !== 'expired'; });
  if (!valid.length) return null;
  pending = { savedAt: data.savedAt, sessions: valid, robloxRunning: processes.robloxProcesses().length };
  return pending;
}

function resume() {
  const p = pending || check();
  if (!p) return { resumed: 0 };
  if (!sessions.openMultiStatus().active && p.sessions.length > 1) sessions.enableOpenMulti();
  for (const s of p.sessions) sessions.launch(s.accountId, null, { label: s.label, watch: s.watch, target: s.target });
  log.info(`Resuming ${p.sessions.length} session(s)`);
  bus.emit('notify', { level: 'success', title: 'Resuming your sessions', message: `${p.sessions.length} account${p.sessions.length === 1 ? '' : 's'} going back to where they were.` });
  pending = null;
  return { resumed: p.sessions.length };
}

function init() {
  store = new JsonStore(paths.file('resume.json'), { savedAt: null, sessions: [] });
  bus.on('sessions:changed', () => { try { save(); } catch (e) { log.warn(e.message); } });
  clearInterval(timer);
  timer = setInterval(() => { try { save(); } catch { /* ignore */ } }, 60_000); // keeps the server ID current
  const p = check();
  if (p && settings.get('resume.auto') && !p.robloxRunning) setTimeout(() => { if (pending) resume(); }, 15_000);
  return p;
}

function status() { return { pending, config: settings.get('resume') }; }
function dismiss() { clear(); return true; }

module.exports = { init, check, resume, dismiss, clear, status, snapshotFrom };
