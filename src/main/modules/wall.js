'use strict';
// Alt Wall: every alt at a glance, with a small live picture of each Roblox
// window. Pictures come from one Windows window-capture call for all windows and
// are only taken while something is showing them (the wall, the switcher, the
// phone or a Stream Deck key). Nothing is recorded or saved.
const win32 = require('../native/win32');
const sessions = require('./sessions');
const accounts = require('./accounts');
const settings = require('./settings');

const cache = new Map(); // `${width}:${format}` -> { at, shots }
const CACHE_MS = 1500;
const last = new Map(); // session id -> last picture before its window was minimised

/** The game window of each Roblox process: the largest WINDOWSCLIENT window. */
function gameWindows(pids) {
  const by = new Map();
  for (const w of win32.robloxWindows(pids)) {
    const r = win32.windowRect(w.hwnd);
    const area = r ? r.width * r.height : 0;
    const cur = by.get(w.pid);
    if (!cur || area > cur.area) by.set(w.pid, { ...w, rect: r, area });
  }
  return by;
}

/** { sessionId: dataURL | null } for running sessions (null = minimised or hidden). */
async function thumbs(ids, width = 320, format = 'jpeg') {
  if (!win32.available) return {};
  const key = `${width}:${format}`;
  const hit = cache.get(key);
  const list = sessions.listSessions().filter(s => s.status === 'running' && s.pid && (!ids || ids.includes(s.id)));
  if (!list.length) return {};
  let shots = hit && Date.now() - hit.at < CACHE_MS ? hit.shots : null;
  if (!shots) {
    const sources = await require('./capture').sources({ thumbnailSize: { width, height: Math.round(width * 0.5625) } });
    shots = new Map(sources.map(s => [s.id.split(':')[1], s.thumbnail]));
    cache.set(key, { at: Date.now(), shots });
  }
  const koffi = require('koffi');
  const wins = gameWindows(list.map(s => s.pid));
  const out = {};
  for (const s of list) {
    const w = wins.get(s.pid);
    const img = w && !win32.isMinimized(w.hwnd) ? shots.get(String(koffi.address(w.hwnd))) : null;
    out[s.id] = img && !img.isEmpty() ? (format === 'png' ? img.toDataURL() : `data:image/jpeg;base64,${img.toJPEG(72).toString('base64')}`) : null;
    // A minimised window shows the last picture taken before it was minimised.
    if (!out[s.id] && last.has(s.id) && format !== 'png') out[s.id] = last.get(s.id);
  }
  for (const id of last.keys()) if (!list.some(s => s.id === id)) last.delete(id);
  return out;
}

/** Keeps a picture of a window that is about to be minimised. */
async function remember(sessionId) {
  const s = sessions.listSessions().find(x => x.id === sessionId);
  if (!s?.pid) return false;
  cache.clear();
  const shot = (await thumbs([s.id], 400))[s.id];
  if (shot) last.set(s.id, shot);
  return !!shot;
}

/** Everything the Alt Wall and the switcher draw (no pictures, no secrets). */
function data() {
  const fpsByPid = (() => { try { return require('./fps').presentMonStatus().fps || {}; } catch { return {}; } })();
  let score = () => null;
  try { score = require('./healthscore').forAccount; } catch { /* optional */ }
  const all = accounts.raw().accounts;
  const live = sessions.listSessions().filter(s => ['running', 'launching', 'rejoining'].includes(s.status));
  const tiles = live.map(s => {
    const a = s.accountId ? accounts.find(s.accountId) : null;
    const v = a ? accounts.publicView(a) : null;
    return {
      id: s.id, accountId: s.accountId || null, label: s.label, username: s.username, avatarUrl: s.avatarUrl, color: s.color,
      tier: v?.tier || null, slot: v?.slot || null, tags: v?.tags || [], external: !!s.external, status: s.status, state: s.watchState || null,
      game: s.placeName || (s.placeId ? `Place ${s.placeId}` : ''), startedAt: s.startedAt, memMB: s.memMB || 0, cpu: s.cpu || 0, ping: s.ping ?? null,
      fps: s.pid && fpsByPid[s.pid] != null ? Math.round(fpsByPid[s.pid]) : null, watch: !!s.watch, health: a ? score(a.id) : null,
      pinned: !!(s.accountId && (settings.get('tiling.pinned') || []).includes(s.accountId)),
    };
  });
  const runningIds = new Set(live.map(s => s.accountId).filter(Boolean));
  const offline = all.filter(a => !runningIds.has(a.id)).map(a => { const v = accounts.publicView(a); return { accountId: a.id, label: v.alias || v.displayName || v.username, username: v.username, avatarUrl: v.avatarUrl, tier: v.tier, slot: v.slot, tags: v.tags, status: v.status, color: v.color, health: score(a.id) }; });
  const rank = (t) => accounts.TIERS.indexOf(t || 'filler');
  tiles.sort((x, y) => (x.external - y.external) || (rank(x.tier) - rank(y.tier)) || ((x.slot || 99) - (y.slot || 99)) || (x.startedAt - y.startedAt));
  offline.sort((x, y) => (rank(x.tier) - rank(y.tier)) || ((x.slot || 99) - (y.slot || 99)));
  return { tiles, offline, at: Date.now() };
}

module.exports = { thumbs, data, gameWindows, remember };
