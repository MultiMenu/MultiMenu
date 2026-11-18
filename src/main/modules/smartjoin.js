'use strict';
// Smart server picker: put alts in the server with the lowest ping or the fewest
// players, or spread groups of alts over several servers.
const roblox = require('./roblox');
const accounts = require('./accounts');
const sessions = require('./sessions');

const MODES = { ping: 'Lowest ping', fewest: 'Fewest players', spread: 'Spread out' };

/** Splits ids into groups of `size` (pure). */
function groupsOf(ids, size) {
  const n = Math.max(1, Math.min(50, Math.floor(size) || 1));
  const out = [];
  for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
  return out;
}

/** Orders servers for a mode (pure, unit-tested). Servers without a ping go last for 'ping'. */
function rank(servers, mode) {
  const byPing = (a, b) => (a.ping ?? Infinity) - (b.ping ?? Infinity) || a.playing - b.playing;
  const byPlayers = (a, b) => a.playing - b.playing || (a.ping ?? Infinity) - (b.ping ?? Infinity);
  return servers.slice().sort(mode === 'fewest' ? byPlayers : byPing);
}

/** One distinct server per group, each with room for its whole group (pure, unit-tested). */
function assign(servers, groupSizes, mode) {
  const ranked = rank(servers, mode);
  const used = new Set();
  return groupSizes.map(size => {
    const s = ranked.find(x => !used.has(x.id) && x.maxPlayers - x.playing >= size);
    if (s) used.add(s.id);
    return s || null;
  });
}

async function serversFor(placeId, pages = 3) {
  const all = [];
  let cursor;
  for (let i = 0; i < pages; i++) {
    const r = await roblox.getServers(placeId, { cursor, order: 'Desc' });
    all.push(...r.servers);
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  return all;
}

/** mode: 'ping' | 'fewest' put everyone in one server; 'spread' puts `perServer` alts in each server. */
async function join(accountIds, input, { mode = 'ping', perServer = 1, by = 'ping' } = {}) {
  if (!MODES[mode]) throw new Error('Unknown mode.');
  const t = roblox.parseTarget(input);
  if (!t?.placeId || t.linkCode) throw new Error('Enter a public game: a place ID or a roblox.com game link.');
  const ids = (Array.isArray(accountIds) ? accountIds : []).filter(id => accounts.find(id));
  if (!ids.length) throw new Error('Pick at least one account.');
  const servers = await serversFor(t.placeId);
  if (!servers.length) throw new Error('No open public servers were found for that game.');
  const groups = mode === 'spread' ? groupsOf(ids, perServer) : [ids];
  const picked = assign(servers, groups.map(g => g.length), mode === 'spread' ? (by === 'fewest' ? 'fewest' : 'ping') : mode);
  const plan = [];
  groups.forEach((g, i) => {
    const s = picked[i];
    if (!s) return;
    const target = sessions.sanitizeTarget({ placeId: t.placeId, jobId: s.id });
    g.forEach(id => sessions.launch(id, null, { target }));
    plan.push({ server: { id: s.id, playing: s.playing, maxPlayers: s.maxPlayers, ping: s.ping }, accounts: g.length });
  });
  if (!plan.length) throw new Error(`No public server has ${groups[0].length} free places for this group.`);
  const left = groups.length - plan.length;
  return { placeId: t.placeId, servers: plan.length, queued: plan.reduce((s, p) => s + p.accounts, 0), skipped: groups.filter((g, i) => !picked[i]).reduce((s, g) => s + g.length, 0), groupsWithoutServer: left, plan };
}

module.exports = { MODES, join, rank, assign, groupsOf };
