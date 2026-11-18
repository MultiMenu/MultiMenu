'use strict';
// Discord Rich Presence: "Playing MultiMenu · Running 12 alts" on your Discord profile.
// Talks to the Discord desktop app on this PC through its local pipe (the same way games
// do). No login, no token, nothing over the internet from MultiMenu. It shows a count and
// the game name, or your own text, never account names.
const net = require('net');
const crypto = require('crypto');
const bus = require('../bus');
const log = require('../logger').scope('presence');

// The public ID of the "MultiMenu" application on Discord (not a secret: every app that
// shows Rich Presence ships its ID). The logo is its art asset named "logo".
const CLIENT_ID = '1570111240066568353';
const SITE = 'https://github.com/MultiMenu/MultiMenu';
const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const MIN_GAP_MS = 15_000; // Discord allows 5 updates per 20 s; stay well under

let sock = null, ready = false, user = null, lastError = null;
let buf = Buffer.alloc(0);
let lastSent = null, lastSentAt = 0, pendingTimer = null, retryTimer = null;
let pipePath = (i) => `\\\\?\\pipe\\discord-ipc-${i}`; // replaced in tests
const appStartedAt = Date.now();

// Your choices (Discord page → Discord status): on or off, show the count and the game or
// not, and your own two lines of text with {count} and {game} in them. Fixed: the
// "Get MultiMenu" button, nothing while no alt runs, and never account names (there is no
// way to put one in). People can also hide all activity in Discord: User Settings → Activity Privacy.
const FIXED = Object.freeze({ showButton: true, onlyWhileRunning: true });
const text = (v) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 100);
function cfg() {
  let c = {};
  try { c = require('./settings').get('richPresence') || {}; } catch { /* settings not loaded (tests) */ }
  return { enabled: c.enabled !== false, showCount: c.showCount !== false, showGame: c.showGame !== false, details: text(c.details), state: text(c.state), ...FIXED };
}

/** Your own line with {count} and {game} filled in (pure). */
function fill(template, n, game) {
  return template.replace(/\{count\}/gi, String(n)).replace(/\{game\}/gi, game || 'Roblox');
}

// ---------- the wire format: [op int32 LE][length int32 LE][JSON] ----------
function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

/** Pulls whole frames out of the buffer: [{ op, data }]. */
function decode(chunk) {
  buf = Buffer.concat([buf, chunk]);
  const out = [];
  while (buf.length >= 8) {
    const len = buf.readInt32LE(4);
    if (len < 0 || len > 1 << 20) { buf = Buffer.alloc(0); break; } // garbage: drop it
    if (buf.length < 8 + len) break;
    const op = buf.readInt32LE(0);
    let data = null;
    try { data = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')); } catch { /* skip */ }
    buf = buf.subarray(8 + len);
    out.push({ op, data });
  }
  return out;
}

function send(op, data) { if (sock && !sock.destroyed) sock.write(encode(op, data)); }

// ---------- what to show ----------
const clip = (s, max = 128) => { const t = String(s || '').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

/** The activity for the clients running now, or null to show nothing. Pure (for tests). */
function activityFor(list, c = cfg(), now = Date.now()) {
  const running = list.filter(s => s.status === 'running' || s.status === 'launching' || s.status === 'rejoining');
  if (!running.length && c.onlyWhileRunning) return null;
  const n = running.length;
  const games = [...new Set(running.map(s => s.placeName).filter(Boolean))];
  const game = games.length === 1 ? games[0] : games.length > 1 ? `${games.length} games` : '';
  let details = !n ? 'Getting ready' : c.showCount ? `Running ${n} ${n === 1 ? 'alt' : 'alts'}` : 'Running Roblox alts';
  if (n && c.details) details = fill(c.details, c.showCount ? n : '', c.showGame ? game : '');
  let state;
  if (n && c.showGame) {
    if (games.length === 1) state = `In ${games[0]}`;
    else if (games.length > 1) state = `In ${games.length} games`;
  }
  if (n && c.state) state = fill(c.state, c.showCount ? n : '', c.showGame ? game : '');
  const started = n ? Math.min(...running.map(s => s.startedAt || now)) : appStartedAt;
  const activity = {
    details: clip(details),
    ...(state ? { state: clip(state) } : {}),
    timestamps: { start: Math.floor(started / 1000) },
    assets: { large_image: 'logo', large_text: 'MultiMenu' },
    instance: false,
  };
  if (c.showButton) activity.buttons = [{ label: 'Get MultiMenu', url: SITE }];
  // Discord needs at least 2 characters in each text field.
  if (activity.details.length < 2) activity.details = 'MultiMenu';
  return activity;
}

function setActivity(activity) {
  send(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: crypto.randomUUID() });
}

/** Sends the current activity if it changed, at most once per MIN_GAP_MS. */
function update({ force = false } = {}) {
  clearTimeout(pendingTimer);
  if (!ready) return;
  let list = [];
  try { list = require('./sessions').listSessions(); } catch { /* not started */ }
  const activity = cfg().enabled ? activityFor(list) : null;
  // The elapsed time is not a reason to send again; compare without it.
  const key = JSON.stringify(activity && { ...activity, timestamps: undefined });
  if (!force && key === lastSent) return;
  const wait = lastSentAt + MIN_GAP_MS - Date.now();
  if (!force && wait > 0) { pendingTimer = setTimeout(() => update(), wait); return; }
  setActivity(activity);
  lastSent = key; lastSentAt = Date.now();
  emit();
}

// ---------- connection ----------
function tryPipe(i) {
  return new Promise((resolve) => {
    const s = net.createConnection(pipePath(i));
    const t = setTimeout(() => { s.destroy(); resolve(null); }, 1500);
    s.once('connect', () => { clearTimeout(t); resolve(s); });
    s.once('error', () => { clearTimeout(t); resolve(null); });
  });
}

async function connect() {
  if (sock || !cfg().enabled) return;
  let s = null;
  for (let i = 0; i < 10 && !s; i++) s = await tryPipe(i);
  if (!s) { lastError = 'Discord is not open on this PC.'; emit(); scheduleRetry(); return; }
  if (!cfg().enabled) { s.destroy(); return; }
  sock = s; buf = Buffer.alloc(0);
  s.on('data', (chunk) => {
    for (const { op, data } of decode(chunk)) {
      if (op === OP.PING) send(OP.PONG, data);
      else if (op === OP.CLOSE) { lastError = data?.message || 'Discord closed the connection.'; s.destroy(); }
      else if (op === OP.FRAME && data?.evt === 'READY') {
        ready = true; lastError = null;
        user = data.data?.user ? (data.data.user.global_name || data.data.user.username || null) : null;
        log.info('Connected to Discord');
        update({ force: true });
      } else if (op === OP.FRAME && data?.evt === 'ERROR') {
        lastError = data.data?.message || 'Discord refused the status.';
        log.warn(`Discord: ${lastError}`);
        emit();
      }
    }
  });
  const gone = () => {
    if (sock !== s) return;
    sock = null; ready = false; user = null; lastSent = null;
    emit();
    scheduleRetry();
  };
  s.on('close', gone);
  s.on('error', gone);
  send(OP.HANDSHAKE, { v: 1, client_id: CLIENT_ID });
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!cfg().enabled) return;
  retryTimer = setTimeout(() => connect().catch(() => {}), 30_000); // Discord may be opened later
}

function disconnect() {
  clearTimeout(retryTimer); clearTimeout(pendingTimer);
  if (sock) {
    try { if (ready) setActivity(null); } catch { /* gone */ }
    const s = sock; sock = null; ready = false; user = null; lastSent = null;
    setTimeout(() => s.destroy(), 200); // let the "clear" reach Discord first
  }
  emit();
}

/** Called when the setting changes. */
function apply() {
  if (cfg().enabled) { if (sock && ready) update({ force: true }); else connect().catch(() => {}); } else disconnect();
}

function status() { return { enabled: cfg().enabled, connected: ready, user, error: cfg().enabled && !ready ? lastError : null, preview: activityFor((() => { try { return require('./sessions').listSessions(); } catch { return []; } })(), { ...cfg(), onlyWhileRunning: false }) }; }
function emit() { bus.emit('presence:update', status()); }

function init() {
  bus.on('sessions:changed', () => { if (ready) update(); });
  if (process.platform === 'win32') apply();
}

module.exports = { init, apply, update, status, disconnect, activityFor, fill, encode, decode, CLIENT_ID, _setPipe: (fn) => { pipePath = fn; }, _connect: connect };
