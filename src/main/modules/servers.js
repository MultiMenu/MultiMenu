'use strict';
// Server tools: saved games & private server links, public server browser
// (fewest players first), join a friend, and "squad" joins that put several
// accounts into one server.
const crypto = require('crypto');
const { JsonStore } = require('../store');
const paths = require('../paths');
const roblox = require('./roblox');
const accounts = require('./accounts');
const sessions = require('./sessions');

let store;
function init() { store = new JsonStore(paths.file('games.json'), { games: [] }); }

// ---------- saved games / private servers ----------
function listGames() { return store.get('games'); }
async function addGame({ name, link }) {
  const target = roblox.parseTarget(link);
  if (!target) throw new Error('Paste a place ID, a roblox.com game link or a private server link.');
  // roblox.com/share links have no place ID until they are opened: don't look one up or call it "Place undefined".
  const fallback = target.placeId ? `Place ${target.placeId}` : 'Shared link';
  const g = {
    id: crypto.randomUUID(), link: String(link).trim().slice(0, 400), placeId: target.placeId || null, private: !!target.linkCode || target.shareType === 'Server',
    name: String(name || '').trim().slice(0, 60) || (target.placeId ? await roblox.getPlaceName(target.placeId) : null) || fallback, addedAt: Date.now(),
  };
  store.get('games').unshift(g); store.saveSoon();
  return listGames();
}
function removeGame(id) { store.set('games', listGames().filter(g => g.id !== id)); return listGames(); }
/** Accounts a saved game remembers, so its Launch button needs no picking (empty list = forget). */
function setGameAccounts(id, accountIds) {
  const g = listGames().find(x => x.id === id);
  if (!g) throw new Error('That saved game is gone.');
  const ids = [...new Set((Array.isArray(accountIds) ? accountIds : []).filter(x => typeof x === 'string' && accounts.find(x)))].slice(0, 100);
  if (ids.length) g.accountIds = ids; else delete g.accountIds;
  store.saveSoon();
  return listGames();
}
function renameGame(id, name) { const g = listGames().find(x => x.id === id); if (g) { g.name = String(name).slice(0, 60); store.saveSoon(); } return listGames(); }

// ---------- server browser ----------
async function browse(input, cursor) {
  const t = roblox.parseTarget(input);
  if (!t?.placeId) throw new Error('Enter a place ID or a roblox.com game link.');
  const r = await roblox.getServers(t.placeId, { cursor });
  return { placeId: t.placeId, placeName: cursor ? null : await roblox.getPlaceName(t.placeId), ...r };
}

/** Launch accounts into a specific server (jobId). */
function joinServer(accountIds, placeId, jobId) {
  const target = sessions.sanitizeTarget({ placeId, jobId });
  if (!target?.jobId) throw new Error('That server ID is not valid.');
  const ids = (accountIds || []).filter(id => accounts.find(id));
  if (!ids.length) throw new Error('Pick at least one account.');
  ids.forEach(id => sessions.launch(id, null, { target }));
  return { queued: ids.length };
}

/** Emptiest server with at least `slots` free places, then join it. */
async function joinEmptiest(accountIds, input) {
  const t = roblox.parseTarget(input);
  if (!t?.placeId) throw new Error('Enter a place ID or a roblox.com game link.');
  const need = Math.max(1, (accountIds || []).length);
  const { servers } = await roblox.getServers(t.placeId, { order: 'Asc' });
  const s = servers.filter(x => x.maxPlayers - x.playing >= need).sort((a, b) => a.playing - b.playing)[0];
  if (!s) throw new Error(`No public server with ${need} free slot${need > 1 ? 's' : ''} was found.`);
  joinServer(accountIds, t.placeId, s.id);
  return { server: s, placeId: t.placeId };
}

// ---------- friends ----------
async function friends(accountId) {
  const acc = accounts.find(accountId);
  if (!acc) throw new Error('Account not found');
  const cookie = accounts.getCookie(accountId);
  const list = await roblox.getFriends(acc.userId, cookie);
  const presence = await roblox.getPresence(list.map(f => f.id), cookie);
  const shots = await roblox.getHeadshots(list.slice(0, 200).map(f => f.id)).catch(() => ({}));
  const order = { ingame: 0, online: 1, studio: 2, offline: 3, invisible: 3 };
  return list.map(f => ({ ...f, avatarUrl: shots[f.id] || '', ...(presence[f.id] || { state: 'offline' }) }))
    .sort((a, b) => (order[a.state] ?? 4) - (order[b.state] ?? 4) || a.name.localeCompare(b.name));
}

/** Join a user's current server (works when their joins are open to you). */
function joinUser(accountIds, userId) {
  const target = sessions.sanitizeTarget({ followUserId: userId });
  if (!target) throw new Error('Invalid user.');
  const ids = (accountIds || []).filter(id => accounts.find(id));
  if (!ids.length) throw new Error('Pick at least one account.');
  ids.forEach(id => sessions.launch(id, null, { target }));
  return { queued: ids.length };
}

/** Squad: the first account joins the game, the rest follow it into the same server. */
function squad(accountIds, input) {
  const t = roblox.parseTarget(input);
  if (!t) throw new Error('Enter a place ID, game link or private server link.');
  const accs = (accountIds || []).map(id => accounts.find(id)).filter(Boolean);
  if (accs.length < 2) throw new Error('Pick at least two accounts for a squad.');
  sessions.launch(accs[0].id, null, { target: t });
  accs.slice(1).forEach(a => sessions.launch(a.id, null, { target: t.linkCode ? t : { followUserId: String(accs[0].userId), placeId: t.placeId } }));
  return { queued: accs.length, leader: accs[0].username };
}

module.exports = { init, listGames, addGame, removeGame, renameGame, setGameAccounts, browse, joinServer, joinEmptiest, friends, joinUser, squad };
