'use strict';
// Follow my main. Keeps chosen alts in the same server as your main account.
// The main's server comes from its Roblox log when it runs on this PC, or from
// Roblox presence when you play the main somewhere else (phone, another PC -
// the main's joins must be visible to itself, which they always are).
// When the main settles in a new server (20s), each alt is moved there, one by
// one. Alts already in that server are left alone.
const settings = require('./settings');
const sessions = require('./sessions');
const accounts = require('./accounts');
const roblox = require('./roblox');
const bus = require('../bus');
const log = require('../logger').scope('follow');

const STABLE_MS = 20_000;
const st = { loc: null, changedAt: 0, moving: false, lastMove: null, message: 'Off', followers: {}, lastMovedAt: {}, tries: {} };
const MAX_TRIES = 3; // per follower and main server: a full or closed server would loop forever
let timer = null;

const running = (id) => sessions.listSessions().find(s => s.accountId === id && ['running', 'launching'].includes(s.status));

/** What should happen to one follower. Pure (exported for tests). */
function decide(follower, loc, now, lastMovedAt = 0) {
  if (!loc?.jobId) return { action: 'wait', why: 'Main is not in a game' };
  if (follower && follower.status === 'launching') return { action: 'wait', why: 'Launching' };
  if (now - lastMovedAt < 60_000) return { action: 'wait', why: 'Moved recently' };
  if (!follower) return { action: 'launch', why: 'Not running' };
  if (follower.jobId === loc.jobId) return { action: 'none', why: 'With main' };
  if (!follower.jobId && now - follower.startedAt < 90_000) return { action: 'wait', why: 'Joining' };
  return { action: 'move', why: follower.jobId ? 'In a different server' : 'Server unknown' };
}

async function mainLocation(main) {
  const s = running(main.id);
  if (s && s.status === 'running') {
    const raw = sessions.getRaw(s.id);
    const jobId = raw?.jobId || raw?.target?.jobId;
    if (jobId) return { placeId: raw.placeId || raw.target?.placeId, jobId, placeName: s.placeName, source: 'this PC' };
  }
  try {
    const p = (await roblox.getPresence([main.userId], accounts.getCookie(main.id)))[main.userId];
    if (p?.state === 'ingame' && p.jobId) return { placeId: p.placeId ? String(p.placeId) : null, jobId: p.jobId, placeName: p.location || null, source: 'Roblox presence' };
  } catch (e) { st.message = `Couldn't read the main's location: ${e.message}`; }
  return null;
}

async function tick() {
  const cfg = settings.get('follow');
  if (!cfg.enabled) { st.message = 'Off'; return; }
  const main = accounts.find(cfg.mainAccountId);
  if (!main) { st.message = 'Choose your main account.'; return; }
  const loc = await mainLocation(main);
  const now = Date.now();
  if ((loc?.jobId || null) !== (st.loc?.jobId || null)) { st.changedAt = now; if (loc) log.info(`Main moved to ${loc.jobId}`); }
  st.loc = loc;
  st.message = loc ? `Main is in ${loc.placeName || `place ${loc.placeId}`} (seen via ${loc.source}).` : `${main.alias || main.username} is not in a game right now.`;
  const followerIds = (cfg.followerIds || []).filter(id => id !== main.id && accounts.find(id));
  for (const id of followerIds) {
    const s = running(id);
    st.followers[id] = decide(s ? { status: s.status, jobId: s.jobId, startedAt: s.startedAt } : null, loc, now, st.lastMovedAt[id]);
    const tr = st.tries[id];
    if (['move', 'launch'].includes(st.followers[id].action) && tr && tr.jobId === loc?.jobId && tr.n >= MAX_TRIES) {
      st.followers[id] = { action: 'wait', why: 'Couldn\'t get into the main\'s server (full?). Waiting for the main to move.' };
    }
  }
  bus.emit('follow:update', status());
  if (!loc || st.moving || now - st.changedAt < STABLE_MS) return;
  const todo = followerIds.filter(id => ['move', 'launch'].includes(st.followers[id].action) && (st.followers[id].action !== 'launch' || cfg.launchIfOffline));
  if (!todo.length) return;
  st.moving = true;
  try {
    for (const id of todo) {
      const a = accounts.find(id);
      const s = running(id);
      const raw = s ? sessions.getRaw(s.id) : null;
      // Roblox sometimes gives the server but not the game: then join the main the way Roblox's own "Join" does.
      const target = loc.placeId ? { placeId: loc.placeId, jobId: loc.jobId } : { followUserId: String(main.userId) };
      const tr = st.tries[id]?.jobId === loc.jobId ? st.tries[id] : { jobId: loc.jobId, n: 0 };
      tr.n++; st.tries[id] = tr;
      if (s) sessions.endForRestart(s.id, 'Following your main to a new server');
      await new Promise(r => setTimeout(r, s ? 3500 : 0));
      sessions.launch(id, null, { label: s?.label, watch: raw ? raw.watch : undefined, target });
      st.lastMovedAt[id] = Date.now();
      st.lastMove = { at: Date.now(), account: a.alias || a.displayName || a.username, to: loc.placeName || loc.placeId };
      await new Promise(r => setTimeout(r, 8000));
    }
    bus.emit('notify', { level: 'info', title: 'Following your main', message: `${todo.length} alt${todo.length === 1 ? '' : 's'} moved to ${loc.placeName || 'the main\'s server'}.` });
  } finally { st.moving = false; }
}

function start() {
  clearInterval(timer);
  const sec = Math.max(15, Number(settings.get('follow.checkSec')) || 30);
  timer = setInterval(() => tick().catch(e => log.warn(e.message)), sec * 1000);
  setTimeout(() => tick().catch(() => {}), 2000);
}

function status() {
  return { config: settings.get('follow'), loc: st.loc, message: st.message, moving: st.moving, lastMove: st.lastMove, followers: st.followers };
}

module.exports = { start, tick, status, decide };
