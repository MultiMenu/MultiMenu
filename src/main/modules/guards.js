'use strict';
// Reliability guards for 24/7 setups:
//  - Keep awake      - stops Windows sleeping while any Roblox session runs.
//  - Internet guard  - notices when your connection drops; the watcher waits
//                      instead of burning retries, then rejoins when it's back.
//  - Roblox status   - reads status.roblox.com; a major outage pauses rejoins too.
//  - Game updates    - notices when a game you're in publishes an update and can
//                      move your clients to fresh servers (old ones shut down).
//  - Crash pop-ups   - closes Roblox crash/error dialog windows that pile up.
//  - Ping monitor    - pings each client's game server and flags lag.
const { spawn } = require('child_process');
const settings = require('./settings');
const sessions = require('./sessions');
const processes = require('./processes');
const roblox = require('./roblox');
const win32 = require('../native/win32');
const bus = require('../bus');
const log = require('../logger').scope('guards');

const st = {
  awakeId: null,
  online: true, offlineSince: null, lastCheck: null,
  roblox: { indicator: 'unknown', description: '', checkedAt: null },
  games: {}, // placeId -> { updated, name, seenAt }
  popupsClosed: 0, lastPopupAt: null,
  pings: {}, // sessionId -> [ms...]
};
const timers = [];

// ---------- keep awake ----------
function keepAwake() {
  const { powerSaveBlocker } = require('electron');
  const want = settings.get('guards.keepAwake') && sessions.listSessions().some(s => ['running', 'launching'].includes(s.status));
  if (want && st.awakeId == null) { st.awakeId = powerSaveBlocker.start('prevent-app-suspension'); log.info('Keeping PC awake (sessions running)'); }
  if (!want && st.awakeId != null) { powerSaveBlocker.stop(st.awakeId); st.awakeId = null; log.info('PC may sleep again'); }
}

// ---------- internet + Roblox status ----------
async function reachable(url) {
  try { const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(7000), redirect: 'manual' }); return r.status > 0 && r.status < 500; } catch { return false; }
}

async function checkConnection() {
  const ok = (await reachable('https://www.roblox.com/robots.txt')) || (await reachable('https://www.msftconnecttest.com/connecttest.txt'));
  st.lastCheck = Date.now();
  if (!ok && st.online) {
    st.online = false; st.offlineSince = Date.now();
    log.warn('Internet connection lost');
    bus.emit('notify', { level: 'warn', title: 'Internet connection lost', message: 'Rejoins are paused until it comes back.', toast: true });
  } else if (ok && !st.online) {
    const mins = Math.round((Date.now() - st.offlineSince) / 60000);
    st.online = true; st.offlineSince = null;
    log.info('Internet connection restored');
    bus.emit('event', { type: 'internetBack', detail: `Back online after ${mins} minute${mins === 1 ? '' : 's'}. Resuming rejoins.` });
  }
  bus.emit('guards:update', status());
}

async function checkRobloxStatus() {
  // status.roblox.com is a hosted status page; if its format isn't recognised we
  // simply report "unknown" and never block rejoins on it.
  try {
    const r = await fetch('https://status.roblox.com/api/v2/status.json', { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const prev = st.roblox.indicator;
    st.roblox = { indicator: j.status?.indicator || 'unknown', description: j.status?.description || '', checkedAt: Date.now() };
    if (['major', 'critical'].includes(st.roblox.indicator) && !['major', 'critical'].includes(prev)) {
      bus.emit('event', { type: 'robloxOutage', detail: `Roblox reports: ${st.roblox.description || 'a major outage'}. Rejoins are paused.` });
    }
  } catch { st.roblox = { indicator: 'unknown', description: '', checkedAt: Date.now() }; }
  bus.emit('guards:update', status());
}

/** Why rejoins should wait right now, or null. Used by the watcher. */
function blockReason() {
  if (!st.online) return 'waiting for your internet to come back';
  if (['major', 'critical'].includes(st.roblox.indicator)) return 'Roblox is having an outage';
  return null;
}

// ---------- game updates ----------
async function checkGameUpdates() {
  const cfg = settings.get('guards');
  if (!cfg.gameUpdates) return;
  const running = sessions.listSessions().filter(s => s.status === 'running' && s.placeId && !s.external);
  const places = [...new Set(running.map(s => s.placeId))];
  for (const placeId of places) {
    const info = await roblox.getGameInfo(placeId).catch(() => null);
    if (!info?.updated) continue;
    const prev = st.games[placeId];
    st.games[placeId] = { updated: info.updated, name: info.name, seenAt: Date.now() };
    if (!prev || info.updated <= prev.updated) continue;
    // The game published an update since we last looked.
    const affected = running.filter(s => s.placeId === placeId && s.startedAt < info.updated);
    log.info(`${info.name} updated; ${affected.length} client(s) on old servers`);
    bus.emit('event', { type: 'gameUpdated', detail: `${info.name} just updated.${cfg.restartOnUpdate && affected.length ? ` Moving ${affected.length} client(s) to fresh servers.` : ''}` });
    if (!cfg.restartOnUpdate) continue;
    for (const s of affected) {
      const raw = sessions.getRaw(s.id);
      const target = { ...(raw?.target || {}) };
      delete target.jobId; // the old server is going away
      sessions.endForRestart(s.id, 'Game updated — moving to a fresh server');
      await new Promise(r => setTimeout(r, 4000));
      sessions.launch(s.accountId, null, { label: s.label, watch: raw?.watch, target: Object.keys(target).length ? target : null });
      await new Promise(r => setTimeout(r, 6000));
    }
  }
}

// ---------- crash pop-ups ----------
function isRobloxPopup(w, robloxPids, crashPids) {
  if (crashPids.has(w.pid)) return true; // RobloxCrashHandler windows
  return robloxPids.has(w.pid) && w.className === '#32770'; // standard Windows dialogs owned by a Roblox client
}

function closePopups() {
  if (!win32.available || !settings.get('guards.closePopups')) return 0;
  const snap = processes.snapshot();
  const robloxPids = new Set(snap.filter(p => /^RobloxPlayerBeta\.exe$/i.test(p.name)).map(p => p.pid));
  const crashPids = new Set(snap.filter(p => /^RobloxCrashHandler\.exe$/i.test(p.name)).map(p => p.pid));
  if (!robloxPids.size && !crashPids.size) return 0;
  let n = 0;
  for (const w of win32.allWindows()) {
    if (isRobloxPopup(w, robloxPids, crashPids)) { win32.postClose(w.hwnd); n++; }
  }
  if (n) { st.popupsClosed += n; st.lastPopupAt = Date.now(); log.info(`Closed ${n} Roblox pop-up(s)`); bus.emit('guards:update', status()); }
  return n;
}

// ---------- ping ----------
function pingOnce(ip) {
  return new Promise((resolve) => {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return resolve(null);
    const p = spawn('ping', ['-n', '1', '-w', '1500', ip], { windowsHide: true });
    let out = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.on('close', () => resolve(parsePing(out)));
    p.on('error', () => resolve(null));
  });
}

/** Extracts the round-trip time from `ping` output in any Windows language ("time=23ms", "Zeit<1ms", "temps=15 ms"). */
function parsePing(out) {
  const m = String(out).match(/[=<]\s?(\d+)\s?ms/i);
  return m ? Number(m[1]) : null;
}

async function pingAll() {
  if (!settings.get('guards.ping')) return;
  for (const s of sessions.listSessions().filter(x => x.status === 'running' && x.serverIp)) {
    const ms = await pingOnce(s.serverIp);
    const h = (st.pings[s.id] = st.pings[s.id] || []);
    h.push(ms);
    if (h.length > 20) h.shift();
    const valid = h.filter(x => x != null);
    sessions.setMeta(s.id, { ping: valid.length ? valid.at(-1) : null });
    const recent = h.slice(-4).filter(x => x != null);
    if (recent.length === 4 && recent.every(x => x > settings.get('guards.highPingMs'))) {
      if (!h.warned) { h.warned = true; bus.emit('event', { type: 'highPing', account: s.label, detail: `Ping has been over ${settings.get('guards.highPingMs')} ms for 2 minutes (${recent.at(-1)} ms).` }); }
    } else h.warned = false;
  }
  for (const id of Object.keys(st.pings)) if (!sessions.getRaw(id)) delete st.pings[id];
}

function status() {
  return {
    keepingAwake: st.awakeId != null, online: st.online, offlineSince: st.offlineSince, lastCheck: st.lastCheck,
    roblox: st.roblox, blocked: blockReason(), popupsClosed: st.popupsClosed, lastPopupAt: st.lastPopupAt,
    games: Object.entries(st.games).map(([placeId, g]) => ({ placeId, ...g })), config: settings.get('guards'),
  };
}

function init() {
  timers.forEach(clearInterval);
  timers.length = 0;
  bus.on('sessions:changed', () => { try { keepAwake(); } catch (e) { log.warn(e.message); } });
  const every = (ms, fn) => { timers.push(setInterval(require('./lean').paced(() => Promise.resolve().then(fn).catch(e => log.warn(e.message))), ms)); };
  every(20_000, checkConnection);
  every(5 * 60_000, checkRobloxStatus);
  every(3 * 60_000, checkGameUpdates);
  every(3_000, closePopups);
  every(30_000, pingAll);
  setTimeout(() => { checkConnection().catch(() => {}); checkRobloxStatus().catch(() => {}); }, 3000);
}

function refresh() { try { keepAwake(); } catch { /* ignore */ } bus.emit('guards:update', status()); }

module.exports = { init, status, blockReason, refresh, parsePing, isRobloxPopup, closePopups, checkConnection };
