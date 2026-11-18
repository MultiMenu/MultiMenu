'use strict';
// OpenMulti + session management.
//
// OpenMulti: Roblox allows one client per Windows session by creating a named
// mutex ("ROBLOX_singletonMutex") at startup. If MultiMenu creates and holds that
// mutex first, each new Roblox client finds it already taken and keeps running
// alongside the others. This only works if MultiMenu takes the mutex BEFORE any
// Roblox client is running, and it can stop working if Roblox changes its client.
//
// Launching: we get a one-time authentication ticket for the saved account and
// hand it to Roblox through the roblox-player: protocol (exactly what the
// website's Play button does), or by starting RobloxPlayerBeta.exe directly.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { shell } = require('electron');
const win32 = require('../native/win32');
const roblox = require('./roblox');
const accounts = require('./accounts');
const settings = require('./settings');
const processes = require('./processes');
const bus = require('../bus');
const log = require('../logger').scope('sessions');

const MUTEX_NAME = 'ROBLOX_singletonMutex';
const sessions = new Map();
let mutex = null;
let openMultiState = { active: false, message: 'Not enabled' };
let timer = null;

// ---------- OpenMulti ----------
function enableOpenMulti() {
  if (!win32.available) { openMultiState = { active: false, message: 'OpenMulti needs Windows.' }; return openMultiState; }
  if (mutex) return openMultiState;
  const running = processes.robloxProcesses().length;
  const m = win32.createMutex(MUTEX_NAME);
  if (!m.handle) { openMultiState = { active: false, message: 'Windows refused to create the OpenMulti lock.' }; return openMultiState; }
  if (m.alreadyExisted || running > 0) {
    win32.closeHandle(m.handle);
    openMultiState = { active: false, message: 'Roblox is already running. Close every Roblox window, then enable OpenMulti again.' };
    return openMultiState;
  }
  mutex = m.handle;
  openMultiState = { active: true, message: 'Active — you can run multiple Roblox clients.' };
  log.info('OpenMulti enabled');
  return openMultiState;
}

function disableOpenMulti() {
  if (mutex) { win32.closeHandle(mutex); mutex = null; }
  openMultiState = { active: false, message: 'Disabled' };
  return openMultiState;
}

// ---------- Locating the player ----------
// The newest installed Roblox. A version folder with AppSettings.xml is complete (it's written
// last); one without it may be an update that was stopped halfway, so it's only used if
// nothing complete is installed.
function findRobloxPlayer() {
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  const roots = [path.join(local, 'Roblox', 'Versions'), path.join(local, 'Bloxstrap', 'Versions'), path.join(local, 'Fishstrap', 'Versions')];
  let best = null, partial = null;
  for (const root of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { continue; }
    for (const d of dirs) {
      const exe = path.join(root, d.name, processes.ROBLOX_EXE);
      let st = null;
      try { st = fs.statSync(exe); } catch { continue; }
      const whole = fs.existsSync(path.join(root, d.name, 'AppSettings.xml'));
      if (whole) { if (!best || st.mtimeMs > best.mtime) best = { exe, mtime: st.mtimeMs }; }
      else if (!partial || st.mtimeMs > partial.mtime) partial = { exe, mtime: st.mtimeMs };
    }
  }
  return (best || partial)?.exe || null;
}

// ---------- Sessions ----------
function view(s) {
  const acc = s.accountId ? accounts.find(s.accountId) : null;
  return {
    id: s.id, accountId: s.accountId, label: s.label, username: acc?.username || null, avatarUrl: acc?.avatarUrl || s.avatarUrl || '',
    pid: s.pid, placeId: s.placeId, placeName: s.placeName || null, status: s.status, error: s.error || null,
    startedAt: s.startedAt, memMB: s.memMB || 0, cpu: s.cpu || 0, external: !!s.external,
    watch: !!s.watch, jobId: s.jobId || s.target?.jobId || null, hasLog: !!s.logFile, watchState: s.watchState || null,
    followUserId: s.target?.followUserId || null, ping: s.ping ?? null, serverIp: s.serverIp || null, color: acc?.color || s.color || null,
  };
}
function listSessions() { return [...sessions.values()].map(view); }
function changed() { bus.emit('sessions:changed', listSessions()); }

function accountLabel(acc) { return acc.alias || acc.displayName || acc.username; }

// ---------- launch queue ----------
// Launches run one at a time (each waits for its client to start and the PC to settle).
// The queue is a visible list: reorder it, launch one next, remove one, or clear it.
let launchGen = 0;
const queue = []; // { qid, accountId, label, targetInput, opts, queuedAt }
let current = null; // the item launching now, with { startedAt, phase: 'launching' | 'waiting' }
let working = false;
let skipWaitFlag = false;
const durations = []; // how long the last launches took (ms), for the ETA

function launch(accountId, targetInput, opts = {}) {
  const acc = accounts.find(accountId);
  const item = { qid: crypto.randomUUID(), accountId, label: opts.label || (acc ? accountLabel(acc) : 'Removed account'), targetInput, opts, queuedAt: Date.now() };
  queue.push(item);
  queueChanged();
  work();
  return { queued: true, queueId: item.qid };
}

// Batches (Settings → Launching): after every N launches the queue waits until those clients
// are in their games and the PC has calmed down, so a big queue doesn't load everything at once.
const joinedIds = new Set();
bus.on('session:joined', ({ id } = {}) => { if (id) { joinedIds.add(id); if (joinedIds.size > 2000) joinedIds.delete(joinedIds.values().next().value); } });
const batchSize = () => { const n = Math.floor(Number(settings.get('launch.batchSize')) || 0); return n >= 2 ? Math.min(50, n) : 0; };
/** Pure: true once every client of the batch is in a game or gone. */
function batchDone(ids, get, joined) { return ids.every((id) => { const s = get(id); return !s || joined.has(id) || !['launching', 'running'].includes(s.status); }); }
async function waitForBatch(ids, stop) {
  const until = Date.now() + Math.max(30, Number(settings.get('launch.batchWaitSec')) || 240) * 1000;
  while (Date.now() < until && !stop() && !batchDone(ids, id => sessions.get(id), joinedIds)) await new Promise(r => setTimeout(r, 1000));
  if (!stop() && settings.get('launch.smart')) await settle({ stop });
}

async function work() {
  if (working) return;
  working = true;
  let batch = [];
  try {
    while (queue.length) {
      const gen = launchGen;
      const item = queue.shift();
      current = { ...item, startedAt: Date.now(), phase: 'launching' };
      skipWaitFlag = false;
      queueChanged();
      const t0 = Date.now();
      try {
        if (gen === launchGen) {
          let g = { forceProtocol: false, direct: false };
          try {
            g = await require('./updateguard').gate({ queued: queue.length + 1, stop: () => gen !== launchGen || skipWaitFlag,
              onWait: () => { if (current) { current.phase = 'updating'; queueChanged(); } } });
          } catch (e) { log.warn(`Update guard: ${e.message}`); }
          if (current) { current.phase = 'launching'; queueChanged(); }
          if (gen === launchGen) {
            const id = await doLaunch(item.accountId, item.targetInput, { ...item.opts, forceProtocol: !!g.forceProtocol, direct: !!g.direct });
            if (id) batch.push(id);
          }
          const size = batchSize();
          if (size && batch.length >= size && queue.length && gen === launchGen) {
            log.info(`Batch of ${batch.length} launched: waiting until they're in game`);
            if (current) { current.phase = 'batch'; current.batch = batch.length; queueChanged(); }
            skipWaitFlag = false;
            await waitForBatch(batch, () => gen !== launchGen || skipWaitFlag);
            batch = [];
          }
        }
      } catch (e) { log.error('launch', e); }
      durations.push(Date.now() - t0);
      if (durations.length > 10) durations.shift();
      current = null;
      queueChanged();
    }
  } finally { working = false; current = null; queueChanged(); }
}

/** Waits ms, or less if "Next now" is pressed. */
async function waitOrSkip(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end && !skipWaitFlag) await new Promise(r => setTimeout(r, Math.min(250, end - Date.now())));
}

/** How long one launch takes here, on average (a guess until a few have run). */
function avgLaunchMs() {
  if (durations.length) return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  return 20_000 + (settings.get('launch.smart') ? 10_000 : Math.max(0, Number(settings.get('accounts.launchDelaySec')) || 0) * 1000);
}

function queueView() {
  const avg = avgLaunchMs();
  const left = current ? Math.max(0, avg - (Date.now() - current.startedAt)) : 0;
  return {
    current: current ? { qid: current.qid, accountId: current.accountId, label: current.label, startedAt: current.startedAt, phase: current.phase } : null,
    items: queue.map((q, i) => ({ qid: q.qid, accountId: q.accountId, label: q.label, queuedAt: q.queuedAt, etaMs: left + i * avg })),
    avgMs: avg, doneInMs: current || queue.length ? left + queue.length * avg : 0,
  };
}
let qTimer = null;
function queueChanged() { clearTimeout(qTimer); qTimer = setTimeout(() => bus.emit('launchqueue:changed', queueView()), 50); }

function queueMove(qid, toIndex) {
  const i = queue.findIndex(q => q.qid === qid);
  if (i < 0) throw new Error('That launch has already started or was removed.');
  const [item] = queue.splice(i, 1);
  queue.splice(Math.max(0, Math.min(queue.length, Number(toIndex) || 0)), 0, item);
  queueChanged();
  return queueView();
}
function queueRemove(qid) { const i = queue.findIndex(q => q.qid === qid); if (i >= 0) queue.splice(i, 1); queueChanged(); return queueView(); }
function queueClear() { const n = queue.length; queue.length = 0; queueChanged(); return { removed: n, ...queueView() }; }
/** Stops waiting for the PC to settle after the current launch and starts the next one now. */
function queueSkipWait() { skipWaitFlag = true; return queueView(); }

async function doLaunch(accountId, targetInput, { label, watch, target: targetObj, replaces, forceProtocol, direct } = {}) {
  let undoFlags = null;
  const acc = accounts.find(accountId);
  if (!acc) {
    // Removed while a preset, schedule or rejoin still pointed at it: say so instead of failing silently.
    bus.emit('event', { type: 'launchFailed', account: 'Removed account', error: 'That account was removed from MultiMenu.' });
    log.warn(`Launch skipped: account ${accountId} no longer exists`);
    return;
  }
  const s = {
    id: crypto.randomUUID(), accountId, label: label || accountLabel(acc), status: 'launching', startedAt: Date.now(), pid: null,
    watch: watch !== undefined ? !!watch : !!settings.get('watcher.watchNewSessions'), replaces: replaces || null,
  };
  sessions.set(s.id, s);
  changed();
  const fail = (msg, code) => {
    s.status = 'failed'; s.error = msg; s.endedAt = Date.now(); changed();
    bus.emit('event', { type: 'launchFailed', account: s.label, error: msg });
    bus.emit('session:launchFailed', { accountId, label: s.label, error: msg, code, target: s.target, replaces: s.replaces });
    log.warn(`Launch failed for ${s.label}: ${msg}`);
  };
  try {
    if (!win32.available) return fail('Launching Roblox needs Windows.');
    let target = sanitizeTarget(targetObj) || roblox.parseTarget(targetInput || acc.defaultPlace || settings.get('accounts.defaultPlaceId'));
    if (!target) return fail('No game selected. Enter a place ID or a roblox.com game link.');
    if (target.shareCode) {
      try { target = await roblox.resolveShareLink(target.shareCode, target.shareType, accounts.getCookie(accountId)); }
      catch (e) { return fail(e.message, e.code); }
    }
    s.target = target;
    s.placeId = target.placeId || null;
    if (target.placeId) roblox.getPlaceName(target.placeId).then(n => { if (n) { s.placeName = n; changed(); } });
    else if (target.followUserId) s.placeName = `Following user ${target.followUserId}`;

    const others = processes.robloxProcesses();
    if (others.length && !mutex) {
      return fail('Roblox is already open and OpenMulti is not active, so a second client would close the first. Enable OpenMulti with Roblox closed.');
    }

    let ticket;
    try { ticket = await roblox.getAuthTicket(accounts.getCookie(accountId)); } catch (err) {
      if (err.code === 'INVALID') accounts.markExpired(accountId, err.message);
      return fail(err.message, err.code);
    }

    // Graphics for this launch, written just before the client starts (launches are sequential):
    // the account's own launch graphics, else the game profile's, else the alt performance settings
    // (Main accounts launch at full quality), else your own settings.
    const perf = require('./perfprofile');
    const own = acc.launchGraphics && (acc.launchGraphics.quality != null || acc.launchGraphics.fpsCap != null)
      ? { ...(acc.launchGraphics.quality != null ? { quality: acc.launchGraphics.quality } : {}), ...(acc.launchGraphics.fpsCap != null ? { fpsCap: acc.launchGraphics.fpsCap } : {}) } : null;
    let gameGfx = null;
    try { gameGfx = require('./gameprofiles').graphicsFor(target.placeId); } catch { /* none */ }
    let perfGfx = null;
    try { perfGfx = perf.launchPlan(acc, settings.get('perf')).graphics; } catch { /* none */ }
    const gfx = own || gameGfx || perfGfx;
    if (gfx) {
      try { require('./fps').applyForLaunch(gfx); s.customGraphics = true; } catch (e) { log.warn(`Launch graphics not applied: ${e.message}`); }
    } else {
      // An account on your own graphics must not start with the previous alt's values.
      try { require('./fps').restoreUser(false); } catch { /* ignore */ }
    }

    const before = new Set(others.map(p => p.pid));
    // Roblox updates held: the installed version starts directly, so its updater can't close the other clients.
    const method = forceProtocol ? 'protocol' : direct ? 'direct' : (settings.get('openMulti.launchMethod') || 'protocol');
    const exe = method === 'direct' ? findRobloxPlayer() : null;
    if (direct && !exe) log.warn('Roblox updates are held but no installed Roblox was found: launching the normal way');
    // Lighter rendering: allowlisted Fast Flags for this client only; your own file comes back once it has started.
    try { undoFlags = perf.beforeLaunch(acc, exe); } catch (e) { log.warn(`Lighter rendering: ${e.message}`); }
    if (exe) {
      const child = spawn(exe, roblox.buildPlayerArgs({ ticket, target }), { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
      child.on('error', e => fail(`Could not start Roblox: ${e.message}`));
      child.unref();
      s.pid = child.pid || null;
    } else if (method === 'bloxstrap' || method === 'fishstrap') {
      // Through the bootstrapper, so its mods and settings apply. The client is found by process scan.
      await require('./launchers').launchVia(method, roblox.buildLaunchUri({ ticket, target }));
    } else {
      await shell.openExternal(roblox.buildLaunchUri({ ticket, target }));
    }
    s.knownBefore = before;
    accounts.markUsed(accountId);
    changed();
    // Wait for the client to appear (protocol launches go through the Roblox launcher).
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && s.status === 'launching') {
      await new Promise(r => setTimeout(r, 1500));
      poll();
    }
    if (s.status === 'launching') return fail('Roblox did not start within 90 seconds. Check that Roblox is installed and up to date.');
    if (undoFlags) { await perf.waitForWindow(s.pid); undoFlags(); undoFlags = null; }
    if (current && current.accountId === accountId) { current.phase = 'waiting'; queueChanged(); }
    if (settings.get('launch.smart')) await settle({ stop: () => skipWaitFlag });
    else {
      const delay = Math.max(0, Number(settings.get('accounts.launchDelaySec')) || 0) * 1000;
      if (delay) await waitOrSkip(delay);
    }
    return s.id;
  } catch (err) {
    fail(err.message || String(err));
  } finally {
    if (undoFlags) undoFlags();
  }
}

// ---------- smart launches ----------
// Instead of a fixed pause, wait until the PC's CPU has calmed down after a client
// starts (3 calm seconds in a row), with a minimum and a maximum wait.
const os = require('os');
function cpuTimes() { return os.cpus().reduce((a, c) => { const t = c.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, total: 0 }); }
/** Pure: CPU busy % between two cpuTimes() samples. */
function busyPercent(a, b) { const total = b.total - a.total; return total > 0 ? Math.max(0, Math.min(100, 100 * (1 - (b.idle - a.idle) / total))) : 0; }
async function settle({ minMs = 3000, sample = cpuTimes, sleep = (ms) => new Promise(r => setTimeout(r, ms)), stop = () => false } = {}) {
  const c = settings.get('launch') || {};
  const limit = Math.min(100, Math.max(20, Number(c.cpuSettle) || 70));
  const maxMs = Math.max(5, Number(c.maxWaitSec) || 45) * 1000;
  const t0 = Date.now();
  await sleep(minMs);
  let calm = 0, prev = sample(), pct = 0;
  while (Date.now() - t0 < maxMs) {
    if (stop()) return { waitedMs: Date.now() - t0, cpu: Math.round(pct), skipped: true };
    await sleep(1000);
    const cur = sample(); pct = busyPercent(prev, cur); prev = cur;
    calm = pct < limit ? calm + 1 : 0;
    if (calm >= 3) return { waitedMs: Date.now() - t0, cpu: Math.round(pct) };
  }
  return { waitedMs: Date.now() - t0, cpu: Math.round(pct), timedOut: true };
}

/** Accepts { placeId, jobId, linkCode, followUserId } from presets/server browser; validates every field. */
function sanitizeTarget(t) {
  if (!t || typeof t !== 'object') return null;
  const out = {};
  if (t.placeId != null && /^\d{1,15}$/.test(String(t.placeId))) out.placeId = String(t.placeId);
  if (t.jobId && /^[0-9a-f-]{36}$/i.test(t.jobId)) out.jobId = t.jobId;
  if (t.linkCode && /^[\w-]{1,100}$/.test(t.linkCode)) out.linkCode = t.linkCode;
  if (t.followUserId != null && /^\d{1,15}$/.test(String(t.followUserId))) out.followUserId = String(t.followUserId);
  return out.placeId || out.followUserId ? out : null;
}

function claimedPids() { return new Set([...sessions.values()].filter(s => s.pid && !s.external).map(s => s.pid)); }

function poll() {
  if (!win32.available) return;
  const procs = processes.robloxProcesses();
  const byPid = new Map(procs.map(p => [p.pid, p]));
  const claimed = claimedPids();
  let dirty = false;

  // Attach new clients to sessions that are still launching (oldest first).
  const launching = [...sessions.values()].filter(s => s.status === 'launching').sort((a, b) => a.startedAt - b.startedAt);
  for (const s of launching) {
    if (s.pid && byPid.has(s.pid)) { markRunning(s); dirty = true; continue; }
    const fresh = procs.find(p => !claimed.has(p.pid) && !(s.knownBefore?.has(p.pid)) && !isExternal(p.pid));
    if (fresh) { s.pid = fresh.pid; claimed.add(fresh.pid); markRunning(s); dirty = true; }
  }

  for (const s of sessions.values()) {
    if (!s.pid || !['running', 'closing', 'rejoining'].includes(s.status)) continue;
    const p = byPid.get(s.pid);
    if (p) {
      s.memMB = Math.round(p.workingSet / 1048576); s.cpu = +p.cpuPercent.toFixed(1);
      if (s.external) { if (!s.identified && Date.now() >= (s.nextIdAt || 0)) identifyExternal(s); }
      else if (!s.labelled && settings.get('openMulti.labelWindows')) labelWindow(s);
      if (!s.minimizedOnLaunch && !s.external) minimizeOnLaunch(s);
      continue;
    }
    dirty = true;
    if (s.external) { if (s.logFile) require('./robloxlogs').release(s.logFile); sessions.delete(s.id); graphicsAfterExit(s); continue; }
    const endReason = s.status === 'rejoining' ? 'restart' : s.status === 'closing' ? 'closed' : 'crash';
    if (s.status === 'rejoining') {
      s.status = 'closed'; s.error = s.error || 'Restarted by the 24/7 Watcher.';
    } else if (s.status === 'closing') {
      s.status = 'closed';
      if (!s.quietClose) bus.emit('event', { type: 'accountClosed', account: s.label });
    } else {
      s.status = 'exited';
      s.error = 'Roblox exited without MultiMenu closing it (crash, kick, or closed in-game).';
      bus.emit('event', { type: 'accountCrashed', account: s.label, error: s.error });
      s.endedAt = Date.now();
      bus.emit('session:ended', { ...s, reason: 'exit' });
    }
    s.endedAt = s.endedAt || Date.now();
    bus.emit('session:stopped', { id: s.id, accountId: s.accountId, label: s.label, placeId: s.placeId || null, placeName: s.placeName || null, startedAt: s.startedAt, endedAt: s.endedAt, reason: endReason });
    graphicsAfterExit(s);
  }

  // Roblox clients MultiMenu didn't start are shown as external sessions.
  const nowClaimed = claimedPids();
  const stillLaunching = launching.some(s => s.status === 'launching');
  for (const p of procs) {
    if (nowClaimed.has(p.pid) || isExternal(p.pid) || stillLaunching) continue;
    sessions.set(`ext-${p.pid}`, { id: `ext-${p.pid}`, external: true, label: 'Roblox (opened outside MultiMenu)', pid: p.pid, status: 'running', startedAt: Date.now() });
    dirty = true;
  }

  // Forget finished sessions after 10 minutes.
  for (const [id, s] of sessions) if (s.endedAt && Date.now() - s.endedAt > 600_000) { sessions.delete(id); dirty = true; }
  if (dirty) changed(); else bus.emit('sessions:stats', listSessions());
}

function isExternal(pid) { return sessions.has(`ext-${pid}`); }

function markRunning(s) {
  s.status = 'running';
  bus.emit('event', { type: 'accountLaunched', account: s.label, placeId: s.placeId });
  bus.emit('session:started', { id: s.id, accountId: s.accountId, label: s.label, placeId: s.placeId || null, placeName: s.placeName || null, startedAt: s.startedAt });
  log.info(`Session running: ${s.label} pid=${s.pid}`);
}

// A client that closes saves its settings over Roblox's file. If it was an alt
// on its own launch graphics, put yours back; if it was yours, keep its file as yours.
function graphicsAfterExit(s) {
  const fps = require('./fps');
  if (!fps.holdingUserSettings()) return;
  setTimeout(() => {
    try {
      const customLeft = [...sessions.values()].some(x => x.customGraphics && ['running', 'launching', 'rejoining'].includes(x.status));
      if (s.customGraphics) fps.restoreUser(!customLeft);
      else { fps.adoptCurrentAsUser(); if (!customLeft) fps.restoreUser(true); }
    } catch (e) { log.warn('graphicsAfterExit', e.message); }
  }, 4000);
}

// Clients opened outside MultiMenu: find their Roblox log (created when the
// process started), read the user ID from it, and name the session and window
// after that account. The same trick as the old AHK window renamer.
async function identifyExternal(s) {
  if (s.identifying) return;
  s.identifying = true;
  s.nextIdAt = Date.now() + 15000;
  try {
    if ((s.idTries = (s.idTries || 0) + 1) > 120) { s.identified = true; return; } // give up after ~30 min
    const logs = require('./robloxlogs');
    if (!s.logFile) {
      const born = win32.processStartTime(s.pid);
      s.logFile = logs.findLogFor(born || s.startedAt);
      if (born) s.startedAt = born;
    }
    if (!s.logFile) return;
    const uid = logs.userIdFrom(s.logFile);
    if (!uid) return;
    const acc = accounts.getAll().accounts.find(a => String(a.userId) === uid);
    let name = acc ? (acc.alias || acc.displayName || acc.username) : null;
    if (!name) name = (await roblox.getUserInfo(uid).catch(() => null))?.name || null;
    if (!name) return;
    Object.assign(s, { identified: true, userId: uid, label: `${name} (opened outside MultiMenu)`, avatarUrl: acc?.avatarUrl || '', color: acc?.color || null });
    if (settings.get('openMulti.labelWindows')) {
      for (const w of win32.robloxWindows([s.pid])) win32.setWindowTitle(w.hwnd, `Roblox — ${name}`).catch(() => {});
    }
    log.info(`Identified a client opened outside MultiMenu as userId=${uid}`);
    changed();
  } catch (e) { log.warn('Could not identify an outside client', e.message); } finally { s.identifying = false; }
}

/** Minimising now happens once a client reaches a game (alt performance → Minimise once in game). */
function minimizeOnLaunch(s) {
  if (!settings.get('openMulti.minimizeOnLaunch') || settings.get('perf.minimize') != null) { s.minimizedOnLaunch = true; return; }
  if (Date.now() - s.startedAt > 120000) { s.minimizedOnLaunch = true; return; }
  try {
    const wins = win32.robloxWindows([s.pid]);
    if (!wins.length) return;
    for (const w of wins) win32.minimizeWindow(w.hwnd);
    s.minimizedOnLaunch = true;
  } catch { s.minimizedOnLaunch = true; }
}

// The title is set from a worker thread with a time limit: a client that is busy loading
// can't freeze MultiMenu. A busy window is tried again on the next poll (at most 30 times).
function labelWindow(s) {
  if (s.labelling) return;
  try {
    const wins = win32.robloxWindows([s.pid]);
    if (!wins.length) return;
    s.labelling = true;
    Promise.all(wins.map(w => win32.setWindowTitle(w.hwnd, `Roblox — ${s.label}`).catch(() => false)))
      .then((ok) => { if (ok.some(Boolean) || (s.labelTries = (s.labelTries || 0) + 1) >= 30) s.labelled = true; })
      .finally(() => { s.labelling = false; });
  } catch (e) { log.warn('Could not label window', e.message); s.labelled = true; s.labelling = false; }
}

async function close(id) {
  const s = sessions.get(id);
  if (!s || !s.pid) return false;
  const info = win32.processInfo(s.pid);
  if (!info || info.name.toLowerCase() !== processes.ROBLOX_EXE.toLowerCase()) { s.status = 'closed'; s.endedAt = s.endedAt || Date.now(); changed(); return false; }
  s.status = 'closing'; changed();
  for (const w of win32.robloxWindows([s.pid])) win32.postClose(w.hwnd);
  setTimeout(() => {
    const still = win32.processInfo(s.pid);
    if (still && still.name.toLowerCase() === processes.ROBLOX_EXE.toLowerCase()) win32.terminate(s.pid);
  }, 5000);
  return true;
}

/** Panic button: ends every Roblox process at once (including ones opened
 *  outside MultiMenu) and drops queued launches and pending rejoins. */
function panic() {
  launchGen++;
  queue.length = 0;
  skipWaitFlag = true;
  queueChanged();
  try { require('./watcher').cancelAll(); } catch { /* not started */ }
  for (const s of sessions.values()) {
    s.watch = false;
    if (s.status === 'launching') { s.status = 'closed'; s.error = 'Stopped by Close all Roblox.'; s.endedAt = Date.now(); }
    // Closed on purpose: not a crash (no crash alerts), and one summary instead of a message per client.
    else if (['running', 'rejoining'].includes(s.status) && !s.external) { s.status = 'closing'; s.quietClose = true; }
  }
  let n = 0;
  if (win32.available) for (const p of processes.robloxProcesses()) if (win32.terminate(p.pid)) n++;
  log.warn(`Close all Roblox: ended ${n} client(s)`);
  changed();
  return n;
}

async function closeAll() { for (const s of sessions.values()) if (['running', 'launching'].includes(s.status) && s.pid) await close(s.id); }

function relabel(id, label) {
  const s = sessions.get(id);
  if (!s) return false;
  s.label = String(label).slice(0, 40); s.labelled = false; changed();
  return true;
}

function getRaw(id) { return sessions.get(id) || null; }
function allRaw() { return [...sessions.values()]; }
function setWatch(id, on) { const s = sessions.get(id); if (!s || s.external) return false; s.watch = !!on; changed(); return true; }
function setMeta(id, patch) { const s = sessions.get(id); if (s) { Object.assign(s, patch); } }

/** Ends a client so the watcher can relaunch it (no "crash" event is raised). */
function endForRestart(id, reason) {
  const s = sessions.get(id);
  if (!s || !s.pid) return false;
  const info = win32.processInfo(s.pid);
  s.status = 'rejoining'; s.error = reason; changed();
  if (info && info.name.toLowerCase() === processes.ROBLOX_EXE.toLowerCase()) win32.terminate(s.pid);
  return true;
}

function dismiss(id) { const s = sessions.get(id); if (s && !['running', 'launching', 'closing'].includes(s.status)) { sessions.delete(id); changed(); } }

function start() {
  if (settings.get('openMulti.enabled')) enableOpenMulti();
  clearInterval(timer);
  timer = setInterval(require('./lean').paced(() => { try { poll(); } catch (e) { log.error('poll failed', e); } }), 2000);
}
function stop() { clearInterval(timer); disableOpenMulti(); }

module.exports = { panic, settle, busyPercent, batchDone, queueView, queueMove, queueRemove, queueClear, queueSkipWait,
  start, stop, launch, close, closeAll, relabel, dismiss, listSessions, findRobloxPlayer,
  getRaw, allRaw, setWatch, setMeta, endForRestart, sanitizeTarget,
  enableOpenMulti, disableOpenMulti, openMultiStatus: () => openMultiState,
};
