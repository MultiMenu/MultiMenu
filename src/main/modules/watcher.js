'use strict';
// 24/7 Watcher. For every watched session it detects:
//   crash      - the client process exited without MultiMenu closing it
//   disconnect - the client logged a disconnect (kick, error 277, server shutdown)
//   freeze     - the client window has been "not responding" for too long
//   stuck      - the client never got into a server (stuck on loading / a menu)
// and relaunches the account, back into the same server when possible, with
// exponential back-off, a per-hour retry limit and quiet hours.
const crypto = require('crypto');
const win32 = require('../native/win32');
const settings = require('./settings');
const sessions = require('./sessions');
const accounts = require('./accounts');
const logs = require('./robloxlogs');
const stats = require('./stats');
const errorcodes = require('./errorcodes');
const bus = require('../bus');
const log = require('../logger').scope('watcher');

const tracked = new Map(); // sessionId -> { logFile, logState, hungSince, lastTick, handled, runningSince, joined }
const streaks = new Map(); // accountId -> { attempts: [timestamps], streak }
const pending = new Map(); // id -> { accountId, label, at, reason, timer }
let timer = null;

const cfg = () => settings.get('watcher');
/** The watcher settings for one session, with its game profile's limits on top. */
const cfgFor = (s) => { try { return require('./gameprofiles').watcherFor(cfg(), s?.placeId || s?.target?.placeId); } catch { return cfg(); } };

function parseHM(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; }
/** True during quiet hours (supports ranges that cross midnight, e.g. 23:00–07:00). */
function isQuiet(now = new Date()) {
  const q = settings.get('schedule.quietHours');
  if (!q?.enabled) return false;
  const a = parseHM(q.start), b = parseHM(q.end);
  if (a == null || b == null || a === b) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/** Back-off: base·2^streak seconds, capped. */
function backoffMs(streak, c = cfg()) {
  return Math.min(Math.max(1, c.maxDelaySec), Math.max(1, c.baseDelaySec) * 2 ** Math.min(streak, 10)) * 1000;
}

/** True when a client has been loading longer than the stuck limit. */
function isStuck(since, now = Date.now(), c = cfg()) {
  return !!since && Math.max(1, Number(c.stuckMin) || 5) * 60_000 <= now - since;
}

function streakOf(accountId) {
  const s = streaks.get(accountId) || { attempts: [], streak: 0 };
  s.attempts = s.attempts.filter(t => Date.now() - t < 3600_000);
  streaks.set(accountId, s);
  return s;
}

function record(type, s, extra = {}) {
  const e = { type, account: s.label, accountId: s.accountId, ...extra };
  stats.event(e);
  bus.emit('watcher:update', status());
  return e;
}

async function handleProblem(s, kind, detail) {
  const t = tracked.get(s.id);
  if (t?.handled) return;
  if (t) t.handled = true;
  try { await handleProblemNow(s, kind, detail); } catch (e) {
    // Never leave a session marked "handled" without a rejoin: the next check tries again.
    log.error(`Handling ${kind} for ${s.label} failed`, e);
    if (t) t.handled = false;
  }
}

async function handleProblemNow(s, kind, detail) {
  // Grab a screenshot of the error / frozen window before it is closed.
  let image = null, shot = null;
  if (kind !== 'crash' && cfg().screenshots) {
    try { image = await require('./capture').captureWindowOfPid(s.pid); if (image) shot = require('./capture').save(image, s.label); } catch (e) { log.warn('screenshot failed', e.message); }
  }
  const field = { crash: 'crashes', disconnect: 'disconnects', freeze: 'freezes', stuck: 'freezes', memory: 'memRestarts' }[kind];
  stats.add(s.accountId, field, 1, s.label);
  const code = kind === 'disconnect' ? errorcodes.lookup(detail) : null;
  const what = {
    crash: 'Client exited unexpectedly',
    disconnect: code ? `${errorcodes.describe(code.code)}. ${code.meaning}` : 'Disconnected from the game',
    freeze: `Not responding for ${cfgFor(s).freezeSec}s`,
    stuck: `Stuck loading for ${cfgFor(s).stuckMin} min`,
    memory: detail || 'Using too much memory',
  }[kind];
  const action = code?.action || 'rejoin';
  record(kind, s, { detail: what, shot, code: code?.code || null, hint: code?.hint || null, action: code ? code.actionText : null });
  bus.emit('watcher:problem', { kind, accountId: s.accountId, label: s.label, placeId: s.placeId || s.target?.placeId || null, placeName: s.placeName || null, detail: what });
  bus.emit('event', { type: 'watcherProblem', account: s.label, status: kind, detail: code?.hint ? `${what} ${code.hint}` : what, image });
  if (kind !== 'crash') sessions.endForRestart(s.id, `${what} — ${action === 'stop' ? 'stopped' : 'restarting'}.`);
  if (action === 'stop') {
    const msg = `${code ? errorcodes.describe(code.code) : what}: rejoining won't help.${code?.hint ? ` ${code.hint}` : ''}`;
    record('gaveup', s, { detail: msg });
    bus.emit('event', { type: 'watcherGaveUp', account: s.label, detail: msg });
    bus.emit('watcher:gaveup', { accountId: s.accountId, label: s.label, detail: msg });
    return;
  }
  scheduleRejoin(s, code ? errorcodes.describe(code.code) : what, { newServer: action === 'newServer', slow: action === 'slow', sameServer: kind === 'memory' });
}

function scheduleRejoin(s, reason, opts = {}) {
  const c = cfgFor(s);
  if (!s.accountId) return;
  if (!c.enabled) return;
  if (isQuiet()) { record('skipped', s, { detail: 'Quiet hours: not rejoining.' }); return; }
  const st = streakOf(s.accountId);
  if (st.attempts.length >= c.maxPerHour) {
    record('gaveup', s, { detail: `Reached ${c.maxPerHour} rejoins in the last hour. Watching paused for this account.` });
    bus.emit('event', { type: 'watcherGaveUp', account: s.label, detail: `Too many rejoins (${c.maxPerHour}/hour). Check the game or your connection.` });
    bus.emit('watcher:gaveup', { accountId: s.accountId, label: s.label, detail: `Too many rejoins (${c.maxPerHour}/hour).` });
    return;
  }
  const delay = opts.slow ? Math.max(120_000, backoffMs(st.streak, c) * 4) : opts.sameServer ? 5000 : backoffMs(st.streak, c);
  // Same server only on the first try of a streak; if that fails the server is probably gone.
  const target = { ...(s.target || {}) };
  const jobId = s.jobId || target.jobId;
  const sameOk = opts.sameServer || (c.rejoinSameServer && st.streak === 0 && !opts.newServer);
  if (sameOk && jobId && !target.linkCode) target.jobId = jobId; else delete target.jobId;
  const id = crypto.randomUUID();
  const p = { id, accountId: s.accountId, label: s.label, at: Date.now() + delay, reason, sameServer: !!target.jobId };
  const fire = () => {
    // Internet down or Roblox outage: hold the rejoin (doesn't count as a retry).
    const block = require('./guards').blockReason();
    if (block && cfg().enabled) {
      if (p.waiting !== block) { p.waiting = block; record('waiting', s, { detail: `Rejoin on hold — ${block}.` }); }
      p.at = Date.now() + 15000;
      p.timer = setTimeout(fire, 15000);
      bus.emit('watcher:update', status());
      return;
    }
    pending.delete(id);
    if (!cfg().enabled) return;
    if (isQuiet()) { record('skipped', s, { detail: 'Quiet hours started: rejoin cancelled.' }); return; }
    // Started again meanwhile (by you, a preset or another feature): a second copy would get kicked.
    if (sessions.listSessions().some(x => x.accountId === s.accountId && x.id !== s.id && ['running', 'launching'].includes(x.status))) {
      record('skipped', s, { detail: 'Already running again: no rejoin needed.' });
      bus.emit('watcher:update', status());
      return;
    }
    const acc = accounts.find(s.accountId);
    if (!acc || acc.status === 'expired') { record('gaveup', s, { detail: 'Login expired — log in again to resume.' }); return; }
    st.attempts.push(Date.now()); st.streak++;
    stats.add(s.accountId, 'rejoins', 1, s.label);
    record('rejoin', s, { detail: p.sameServer ? 'Rejoining the same server' : 'Rejoining the game' });
    bus.emit('event', { type: 'watcherRejoin', account: s.label, detail: p.sameServer ? `Rejoining same server (${reason})` : `Rejoining game (${reason})` });
    sessions.launch(s.accountId, null, { label: s.label, watch: true, target: Object.keys(target).length ? target : null, replaces: s.id });
  };
  p.timer = setTimeout(fire, delay);
  pending.set(id, p);
  record('scheduled', s, { detail: `Rejoin in ${Math.round(delay / 1000)}s` });
}

function cancelAll() {
  for (const p of pending.values()) clearTimeout(p.timer);
  pending.clear();
  bus.emit('watcher:update', status());
}

function cancelPending(id) {
  const p = pending.get(id);
  if (p) { clearTimeout(p.timer); pending.delete(id); }
  bus.emit('watcher:update', status());
  return !!p;
}

function tick() {
  const now = Date.now();
  for (const s of sessions.allRaw()) {
    if (s.external) continue;
    const c = cfgFor(s);
    let t = tracked.get(s.id);
    if (!t) { t = { logState: {}, lastTick: now, handled: false }; tracked.set(s.id, t); }
    if (s.status !== 'running') continue;
    if (!t.runningSince) { t.runningSince = now; stats.add(s.accountId, 'launches', 1, s.label); }
    // uptime
    const upMs = Math.min(15000, now - t.lastTick);
    stats.add(s.accountId, 'uptimeMs', upMs, s.label);
    stats.addGame(s.placeName || (s.placeId ? `Place ${s.placeId}` : null), upMs);
    t.lastTick = now;
    // stable for 10 min -> reset the streak
    if (now - t.runningSince > 600_000) { const st = streakOf(s.accountId); st.streak = 0; }
    // log: find + read
    if (!t.logFile) { t.logFile = logs.findLogFor(s.startedAt); if (t.logFile) sessions.setMeta(s.id, { logFile: t.logFile }); }
    if (t.logFile) {
      const { lines, events } = logs.readNew(t.logFile, t.logState);
      if (lines.length) bus.emit('robloxlog:lines', { session: s, lines });
      if (!t.loadingSince && !t.joined) t.loadingSince = now;
      for (const e of events) {
        if (e.type === 'join') { sessions.setMeta(s.id, { jobId: e.jobId, placeId: s.placeId || e.placeId, serverIp: e.ip || null }); t.joined = true; t.loadingSince = null; t.joinAt = now; }
        if (e.type === 'joined') { t.joined = true; t.loadingSince = null; t.joinAt = now; }
        if (t.joined && !t.joinedOnce) { t.joinedOnce = true; bus.emit('session:joined', { id: s.id, accountId: s.accountId, pid: s.pid, label: s.label }); }
        // Only loading again once the client has really left its server for the teleport.
        // A teleport line alone (a game printing it, or a teleport that failed) keeps it in game,
        // so hatching animations and the like are never mistaken for a stuck loading screen.
        if (e.type === 'teleport') t.teleportAt = now;
        if (e.type === 'teleportLeft' && !(t.joinAt && t.teleportAt && t.joinAt > t.teleportAt)) { t.joined = false; t.loadingSince = now; }
        if (e.type === 'disconnect' && s.watch && c.enabled && c.detectDisconnects && t.joined) { handleProblem(s, 'disconnect', e.reason); break; }
      }
    }
    // No Roblox log found after 90 s: assume the client is in game (for the once-in-game options).
    if (!t.joinedOnce && !t.logFile && t.runningSince && now - t.runningSince > 90_000) { t.joinedOnce = true; bus.emit('session:joined', { id: s.id, accountId: s.accountId, pid: s.pid, label: s.label, guessed: true }); }
    // freeze
    if (s.watch && c.enabled && c.detectFreezes && win32.available && s.pid) {
      let hung = false;
      try { const w = require('./wall').gameWindows([s.pid]).get(s.pid); hung = w ? win32.isHung(w.hwnd) : false; } catch { hung = false; }
      if (hung) {
        t.hungSince = t.hungSince || now;
        if (now - t.hungSince >= c.freezeSec * 1000) {
          // A client held back by eco mode or the background limiter can look frozen while
          // lots of clients are busy (hatching, loading). Give it full speed and one more
          // stretch of time before calling it frozen and restarting it.
          const limiter = require('./limiter');
          if (!t.boosted && limiter.status().running) {
            t.boosted = true;
            limiter.boost(s.pid, (c.freezeSec + 60) * 1000);
            t.hungSince = now;
            log.info(`${s.label} isn't responding: running it at full speed for a moment before restarting it`);
          } else handleProblem(s, 'freeze');
        }
      } else { t.hungSince = null; t.boosted = false; }
    }
    // stuck loading: the log shows no server join for too long (only when the log was found)
    if (s.watch && c.enabled && c.detectStuck && t.logFile && !t.joined && t.loadingSince && !t.hungSince && isStuck(t.loadingSince, now, c)) { handleProblem(s, 'stuck'); continue; }
    const state = !s.watch ? null : t.hungSince ? 'not responding' : t.joined ? 'in game' : 'loading';
    if (s.watchState !== state) sessions.setMeta(s.id, { watchState: state });
  }
  // forget ended sessions
  for (const id of tracked.keys()) { const s = sessions.getRaw(id); if (!s) { const t = tracked.get(id); if (t.logFile) logs.release(t.logFile); tracked.delete(id); } }
}

function status() {
  return {
    enabled: cfg().enabled, quiet: isQuiet(), available: win32.available, config: cfg(),
    pending: [...pending.values()].map(({ timer: _t, ...p }) => p),
    watched: sessions.listSessions().filter(s => s.watch && ['running', 'launching'].includes(s.status)).length,
    streaks: Object.fromEntries([...streaks.entries()].map(([k, v]) => [k, { recent: v.attempts.filter(x => Date.now() - x < 3600_000).length, streak: v.streak }])),
  };
}

function init() {
  bus.on('session:ended', (s) => { if (s.watch && cfg().enabled && s.accountId) handleProblem(s, 'crash'); });
  bus.on('session:launchFailed', (f) => {
    if (!f.replaces || !cfg().enabled) return;
    const fake = { id: `fail-${Date.now()}`, accountId: f.accountId, label: f.label, target: f.target };
    if (f.code === 'INVALID') { record('gaveup', fake, { detail: 'Login expired — log in again to resume.' }); bus.emit('event', { type: 'watcherGaveUp', account: f.label, detail: 'Login expired.' }); return; }
    record('failed', fake, { detail: f.error });
    scheduleRejoin(fake, 'launch failed');
  });
  clearInterval(timer);
  timer = setInterval(require('./lean').paced(() => { try { tick(); } catch (e) { log.error('tick', e); } }), 5000);
}

function setEnabled(on) {
  settings.set('watcher.enabled', !!on);
  if (!on) for (const id of [...pending.keys()]) cancelPending(id);
  bus.emit('watcher:update', status());
  return status();
}

module.exports = { cfgFor, init, status, setEnabled, cancelPending, cancelAll, isQuiet, backoffMs, parseHM, isStuck, tick, handleProblem };
