'use strict';
// Roblox web API client. Uses only the public endpoints the Roblox website and
// launcher use themselves. The cookie is passed in per call and never logged.
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MultiMenu/1.0';
const COOKIE_PREFIX = '_|WARNING:-DO-NOT-SHARE-THIS.';

function normaliseCookie(raw) {
  if (typeof raw !== 'string') return null;
  let c = raw.trim().replace(/^["']|["']$/g, '');
  c = c.replace(/^\.ROBLOSECURITY=/i, '').split(';')[0].trim();
  return c;
}

function looksLikeCookie(c) {
  return typeof c === 'string' && c.startsWith(COOKIE_PREFIX) && c.length > 200 && c.length < 4000 && !/\s/.test(c);
}

async function request(url, { cookie, method = 'GET', headers = {}, body, timeoutMs = 15000 } = {}) {
  const h = { 'User-Agent': UA, Accept: 'application/json', ...headers };
  if (cookie) h.Cookie = `.ROBLOSECURITY=${cookie}`;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  return fetch(url, {
    method, headers: h, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs), redirect: 'manual',
  });
}

/** Returns { id, name, displayName } or throws { code: 'INVALID' } if the cookie is expired. */
async function getAuthenticatedUser(cookie) {
  const res = await request('https://users.roblox.com/v1/users/authenticated', { cookie });
  if (res.status === 401) { const e = new Error('This account\'s login has expired. Log in again.'); e.code = 'INVALID'; throw e; }
  if (!res.ok) throw new Error(`Roblox returned ${res.status} while checking the account.`);
  const j = await res.json();
  return { id: j.id, name: j.name, displayName: j.displayName };
}

async function getHeadshots(userIds) {
  if (!userIds.length) return {};
  const out = {};
  for (let i = 0; i < userIds.length; i += 100) {
    const chunk = userIds.slice(i, i + 100);
    const url = `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${chunk.join(',')}&size=48x48&format=Png&isCircular=false`;
    const res = await request(url);
    if (!res.ok) continue;
    const j = await res.json();
    for (const d of j.data || []) if (d.imageUrl) out[d.targetId] = d.imageUrl;
  }
  return out;
}

/** Fetches a one-time authentication ticket for launching the Roblox client.
 *  First call returns 403 with an x-csrf-token header (standard Roblox CSRF flow). */
async function getAuthTicket(cookie) {
  const url = 'https://auth.roblox.com/v1/authentication-ticket';
  const base = { cookie, method: 'POST', headers: { Referer: 'https://www.roblox.com/', Origin: 'https://www.roblox.com' }, body: {} };
  let res = await request(url, base);
  const csrf = res.headers.get('x-csrf-token');
  if (res.status === 403 && csrf) res = await request(url, { ...base, headers: { ...base.headers, 'x-csrf-token': csrf } });
  if (res.status === 401) { const e = new Error('This account\'s login has expired. Log in again.'); e.code = 'INVALID'; throw e; }
  const ticket = res.headers.get('rbx-authentication-ticket');
  if (!ticket) throw new Error(`Could not get a launch ticket from Roblox (HTTP ${res.status}).`);
  return ticket;
}

/** Parses a place ID, game URL, or private server link. */
function parseTarget(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^\d{1,15}$/.test(s)) return { placeId: s };
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/(^|\.)roblox\.com$/i.test(u.hostname)) return null;
  if (/^\/share$/i.test(u.pathname) && u.searchParams.get('code')) {
    const type = u.searchParams.get('type') || 'Server';
    const code = u.searchParams.get('code');
    if (!/^(Server|ExperienceDetails|ExperienceInvite)$/.test(type) || !/^[A-Za-z0-9_-]{4,100}$/.test(code)) return null;
    return { shareCode: code, shareType: type };
  }
  const m = u.pathname.match(/\/games\/(\d+)/i);
  const placeId = m?.[1] || u.searchParams.get('placeId');
  if (!placeId || !/^\d{1,15}$/.test(placeId)) return null;
  // Anything odd in the link is dropped rather than passed on to Roblox.
  const lc = u.searchParams.get('privateServerLinkCode'), job = u.searchParams.get('gameInstanceId') || u.searchParams.get('jobId');
  const linkCode = lc && /^[\w-]{1,100}$/.test(lc) ? lc : undefined;
  const jobId = job && /^[0-9a-f-]{36}$/i.test(job) ? job : undefined;
  return { placeId, linkCode, jobId };
}

function placeLauncherUrl({ placeId, jobId, linkCode, followUserId, browserTrackerId }) {
  const p = new URLSearchParams();
  if (followUserId) { p.set('request', 'RequestFollowUser'); p.set('userId', String(followUserId)); }
  else if (linkCode) { p.set('request', 'RequestPrivateGame'); p.set('linkCode', linkCode); }
  else if (jobId) { p.set('request', 'RequestGameJob'); p.set('gameId', jobId); }
  else p.set('request', 'RequestGame');
  p.set('browserTrackerId', browserTrackerId);
  if (placeId) p.set('placeId', placeId);
  p.set('isPlayTogetherGame', 'false');
  p.set('joinAttemptId', crypto.randomUUID());
  p.set('joinAttemptOrigin', 'PlayButton');
  return `https://assetgame.roblox.com/game/PlaceLauncher.ashx?${p.toString()}`;
}

function newBrowserTrackerId() {
  return String(crypto.randomInt(100000, 999999)) + String(crypto.randomInt(100000, 999999));
}

/** roblox-player: protocol URI (same format the website uses). */
function buildLaunchUri({ ticket, target, browserTrackerId = newBrowserTrackerId(), launchTime = Date.now() }) {
  const url = placeLauncherUrl({ ...target, browserTrackerId });
  return `roblox-player:1+launchmode:play+gameinfo:${ticket}+launchtime:${launchTime}+placelauncherurl:${encodeURIComponent(url)}+browsertrackerid:${browserTrackerId}+robloxLocale:en_us+gameLocale:en_us+channel:+LaunchExp:InApp`;
}

/** Arguments for starting RobloxPlayerBeta.exe directly (lets us know the PID). */
function buildPlayerArgs({ ticket, target, browserTrackerId = newBrowserTrackerId(), launchTime = Date.now() }) {
  const url = placeLauncherUrl({ ...target, browserTrackerId });
  return ['--app', '-t', ticket, '-j', url, '-b', browserTrackerId, `--launchtime=${launchTime}`, '--rloc', 'en_us', '--gloc', 'en_us'];
}

async function getPlaceName(placeId) {
  try {
    const r1 = await request(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
    if (!r1.ok) return null;
    const { universeId } = await r1.json();
    const r2 = await request(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
    if (!r2.ok) return null;
    const j = await r2.json();
    return j.data?.[0]?.name || null;
  } catch { return null; }
}

/** POST/PATCH helper that performs Roblox's CSRF token handshake. */
async function requestWithCsrf(url, opts) {
  let res = await request(url, opts);
  const csrf = res.headers.get('x-csrf-token');
  if (res.status === 403 && csrf) res = await request(url, { ...opts, headers: { ...(opts.headers || {}), 'x-csrf-token': csrf } });
  return res;
}

function authFail(res) {
  if (res.status === 401) { const e = new Error('This account\'s login has expired. Log in again.'); e.code = 'INVALID'; throw e; }
}

/** Public servers for a place, fewest players first. */
async function getServers(placeId, { cursor, order = 'Asc' } = {}) {
  if (!/^\d{1,15}$/.test(String(placeId))) throw new Error('Enter a numeric place ID or a game link.');
  const q = new URLSearchParams({ sortOrder: order === 'Desc' ? 'Desc' : 'Asc', excludeFullGames: 'true', limit: '100' });
  if (cursor) q.set('cursor', cursor);
  const res = await request(`https://games.roblox.com/v1/games/${placeId}/servers/Public?${q}`);
  if (res.status === 429) throw new Error('Roblox is rate-limiting server lists. Wait a few seconds and try again.');
  if (!res.ok) throw new Error(`Roblox returned ${res.status} for the server list.`);
  const j = await res.json();
  return {
    servers: (j.data || []).map(s => ({ id: s.id, playing: s.playing ?? 0, maxPlayers: s.maxPlayers ?? 0, fps: s.fps ? Math.round(s.fps) : null, ping: s.ping ?? null })),
    nextCursor: j.nextPageCursor || null,
  };
}

async function getUsersByIds(ids) {
  if (!ids.length) return {};
  const res = await request('https://users.roblox.com/v1/users', { method: 'POST', body: { userIds: ids.slice(0, 100), excludeBannedUsers: false } });
  if (!res.ok) return {};
  const j = await res.json();
  return Object.fromEntries((j.data || []).map(u => [u.id, u]));
}

/** Looks up user IDs for usernames (public endpoint, no login). Returns { lowercaseName: { id, name, displayName } }. */
async function getUsersByUsernames(names) {
  if (!names.length) return {};
  const res = await request('https://users.roblox.com/v1/usernames/users', { method: 'POST', body: { usernames: names.slice(0, 100), excludeBannedUsers: false } });
  if (!res.ok) return {};
  const j = await res.json();
  return Object.fromEntries((j.data || []).map(u => [String(u.requestedUsername || u.name).toLowerCase(), { id: u.id, name: u.name, displayName: u.displayName }]));
}

async function getFriends(userId, cookie) {
  const res = await request(`https://friends.roblox.com/v1/users/${userId}/friends`, { cookie });
  authFail(res);
  if (!res.ok) throw new Error(`Roblox returned ${res.status} for the friends list.`);
  const j = await res.json();
  let list = (j.data || []).map(f => ({ id: f.id, name: f.name || '', displayName: f.displayName || '' }));
  const missing = list.filter(f => !f.name).map(f => f.id);
  if (missing.length) {
    const users = await getUsersByIds(missing);
    list = list.map(f => (f.name ? f : { ...f, name: users[f.id]?.name || String(f.id), displayName: users[f.id]?.displayName || '' }));
  }
  return list;
}

const PRESENCE = { 0: 'offline', 1: 'online', 2: 'ingame', 3: 'studio', 4: 'invisible' };

async function getPresence(userIds, cookie) {
  const out = {};
  for (let i = 0; i < userIds.length; i += 50) {
    const res = await requestWithCsrf('https://presence.roblox.com/v1/presence/users', { cookie, method: 'POST', body: { userIds: userIds.slice(i, i + 50) } });
    authFail(res);
    if (!res.ok) continue;
    const j = await res.json();
    for (const p of j.userPresences || []) {
      out[p.userId] = { state: PRESENCE[p.userPresenceType] || 'offline', location: p.lastLocation || '', placeId: p.placeId || p.rootPlaceId || null, jobId: p.gameId || null };
    }
  }
  return out;
}

async function getRobux(userId, cookie) {
  const res = await request(`https://economy.roblox.com/v1/users/${userId}/currency`, { cookie });
  authFail(res);
  if (!res.ok) return null;
  return (await res.json()).robux ?? null;
}

async function getPremium(userId, cookie) {
  const res = await request(`https://premiumfeatures.roblox.com/v1/users/${userId}/validate-membership`, { cookie });
  authFail(res);
  if (!res.ok) return null;
  return (await res.json()) === true;
}

async function getFriendCount(userId) {
  const res = await request(`https://friends.roblox.com/v1/users/${userId}/friends/count`);
  if (!res.ok) return null;
  return (await res.json()).count ?? null;
}

/** Public profile: { isBanned, created, ... } */
async function getUserInfo(userId) {
  const res = await request(`https://users.roblox.com/v1/users/${userId}`);
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new Error(`Roblox returned ${res.status} for the profile.`);
  return res.json();
}

/** Moderation notice the website shows (bans / warnings), or null if none. */
async function getModeration(cookie) {
  const res = await request('https://usermoderation.roblox.com/v1/not-approved', { cookie });
  authFail(res);
  if (!res.ok) return null;
  const j = await res.json().catch(() => ({}));
  if (!j || !j.punishmentTypeDescription) return null;
  return { type: j.punishmentTypeDescription, reason: j.messageToUser || '', endDate: j.endDate || null };
}

// ---------- avatar / outfits ----------
async function getOutfits(userId, cookie) {
  let res = await request(`https://avatar.roblox.com/v2/avatar/users/${userId}/outfits?outfitType=Avatar&page=1&itemsPerPage=50&isEditable=true`, { cookie });
  if (!res.ok) res = await request(`https://avatar.roblox.com/v1/users/${userId}/outfits?page=1&itemsPerPage=50&isEditable=true`, { cookie });
  authFail(res);
  if (!res.ok) throw new Error(`Roblox returned ${res.status} for outfits.`);
  const j = await res.json();
  const list = (j.data || []).map(o => ({ id: o.id, name: o.name }));
  if (list.length) {
    const t = await request(`https://thumbnails.roblox.com/v1/users/outfits?userOutfitIds=${list.map(o => o.id).join(',')}&size=150x150&format=Png&isCircular=false`);
    if (t.ok) { const tj = await t.json(); const m = Object.fromEntries((tj.data || []).map(d => [d.targetId, d.imageUrl])); list.forEach(o => { o.imageUrl = m[o.id] || ''; }); }
  }
  return list;
}

async function getOutfitDetails(outfitId, cookie) {
  const res = await request(`https://avatar.roblox.com/v1/outfits/${outfitId}/details`, { cookie });
  authFail(res);
  if (!res.ok) throw new Error(`Roblox returned ${res.status} for the outfit.`);
  return res.json();
}

const post = (url, cookie, body) => requestWithCsrf(url, { cookie, method: 'POST', body: body ?? {} });

/** Puts an outfit's items, body colours, scales and avatar type on an account.
 *  Items the account doesn't own are skipped by Roblox and reported back. */
async function applyOutfit(details, cookie) {
  const out = { skipped: [], steps: [] };
  if (details.playerAvatarType) { const r = await post('https://avatar.roblox.com/v1/avatar/set-player-avatar-type', cookie, { playerAvatarType: details.playerAvatarType }); authFail(r); out.steps.push(`type ${r.ok ? 'ok' : r.status}`); }
  if (details.scale) {
    const { height, width, head, depth, proportion, bodyType } = details.scale;
    const r = await post('https://avatar.roblox.com/v1/avatar/set-scales', cookie, { height, width, head, depth, proportion, bodyType }); out.steps.push(`scales ${r.ok ? 'ok' : r.status}`);
  }
  if (details.bodyColors) { const r = await post('https://avatar.roblox.com/v1/avatar/set-body-colors', cookie, details.bodyColors); out.steps.push(`colours ${r.ok ? 'ok' : r.status}`); }
  const assets = (details.assets || []).map(a => ({ id: a.id, ...(a.meta ? { meta: a.meta } : {}) }));
  let r = await post('https://avatar.roblox.com/v2/avatar/set-wearing-assets', cookie, { assets });
  if (r.status === 404) r = await post('https://avatar.roblox.com/v1/avatar/set-wearing-assets', cookie, { assetIds: assets.map(a => a.id) });
  authFail(r);
  if (!r.ok) throw new Error(`Roblox refused the outfit (HTTP ${r.status}).`);
  const j = await r.json().catch(() => ({}));
  const bad = new Set(j.invalidAssetIds || j.invalidAssets?.map(x => x.id) || []);
  out.skipped = (details.assets || []).filter(a => bad.has(a.id)).map(a => a.name || String(a.id));
  return out;
}

async function wearOwnOutfit(outfitId, cookie) {
  const r = await post(`https://avatar.roblox.com/v1/outfits/${outfitId}/wear`, cookie);
  authFail(r);
  if (r.ok) return { skipped: [], steps: ['wear ok'] };
  return applyOutfit(await getOutfitDetails(outfitId, cookie), cookie); // newer accounts: apply item by item
}

// ---------- friends between your own accounts ----------
async function getFriendStatuses(userId, otherIds, cookie) {
  const q = otherIds.map(id => `userIds=${id}`).join('&');
  const res = await request(`https://friends.roblox.com/v1/users/${userId}/friends/statuses?${q}`, { cookie });
  authFail(res);
  if (!res.ok) throw new Error(`Roblox returned ${res.status} for friend statuses.`);
  const j = await res.json();
  return Object.fromEntries((j.data || []).map(d => [d.id, d.status]));
}

function challengeError(res) {
  if (res.headers.get('rblx-challenge-id') || res.headers.get('rblx-challenge-type')) {
    const e = new Error('Roblox asked for a CAPTCHA.'); e.code = 'CHALLENGE'; return e;
  }
  return null;
}

async function sendFriendRequest(targetId, cookie) {
  const r = await post(`https://friends.roblox.com/v1/users/${targetId}/request-friendship`, cookie, { friendshipOriginSourceType: 'UserProfile' });
  authFail(r);
  const ch = challengeError(r); if (ch) throw ch;
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.errors?.[0]?.message || `Roblox returned ${r.status}`); }
  return true;
}

async function acceptFriendRequest(requesterId, cookie) {
  const r = await post(`https://friends.roblox.com/v1/users/${requesterId}/accept-friend-request`, cookie);
  authFail(r);
  const ch = challengeError(r); if (ch) throw ch;
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.errors?.[0]?.message || `Roblox returned ${r.status}`); }
  return true;
}

// ---------- game info / updates ----------
const universeCache = new Map();
async function getUniverseId(placeId) {
  if (universeCache.has(placeId)) return universeCache.get(placeId);
  const r = await request(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
  if (!r.ok) return null;
  const { universeId } = await r.json();
  universeCache.set(placeId, universeId);
  return universeId;
}

/** { universeId, name, updated (ms) } - `updated` changes whenever the game publishes. */
async function getGameInfo(placeId) {
  const universeId = await getUniverseId(placeId);
  if (!universeId) return null;
  const r = await request(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
  if (!r.ok) return null;
  const g = (await r.json()).data?.[0];
  return g ? { universeId, name: g.name, updated: Date.parse(g.updated) || null, playing: g.playing } : null;
}

// ---------- game search ----------
const searchSession = crypto.randomUUID(); // Roblox's search wants a session ID; a random one is what the site sends too
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Universe IDs (in order) out of an omni-search reply, whatever groups it uses. */
function universeIdsFromSearch(j) {
  const ids = [];
  for (const group of j?.searchResults || []) {
    for (const c of group?.contents || []) {
      const id = c?.universeId ?? (c?.contentType === 'Game' ? c?.contentId : null);
      if (id != null && /^\d{1,15}$/.test(String(id)) && !ids.includes(String(id))) ids.push(String(id));
    }
  }
  return ids;
}

/** Details for up to 50 universes: name, root place, creator, players, visits, likes and icon. */
async function getGamesDetails(universeIds) {
  const ids = universeIds.filter(id => /^\d{1,15}$/.test(String(id))).slice(0, 50);
  if (!ids.length) return [];
  const [games, votes, icons] = await Promise.all([
    Promise.all(chunk(ids, 50).map(async (c) => { const r = await request(`https://games.roblox.com/v1/games?universeIds=${c.join(',')}`); return r.ok ? (await r.json()).data || [] : []; })).then(a => a.flat()),
    request(`https://games.roblox.com/v1/games/votes?universeIds=${ids.join(',')}`).then(async r => (r.ok ? (await r.json()).data || [] : [])).catch(() => []),
    request(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${ids.join(',')}&size=150x150&format=Png&isCircular=false`).then(async r => (r.ok ? (await r.json()).data || [] : [])).catch(() => []),
  ]);
  const vote = new Map(votes.map(v => [String(v.id), v]));
  const icon = new Map(icons.map(i => [String(i.targetId), i.state === 'Completed' ? i.imageUrl : null]));
  const byId = new Map(games.map(g => [String(g.id), g]));
  return ids.map(id => byId.get(id)).filter(Boolean).map((g) => {
    const v = vote.get(String(g.id));
    const up = v?.upVotes || 0, down = v?.downVotes || 0;
    const img = icon.get(String(g.id));
    return {
      universeId: String(g.id), placeId: String(g.rootPlaceId), name: String(g.name || '').slice(0, 100),
      creator: String(g.creator?.name || '').slice(0, 60), verified: !!g.creator?.hasVerifiedBadge,
      playing: g.playing ?? 0, visits: g.visits ?? 0, maxPlayers: g.maxPlayers ?? null,
      likes: up + down ? Math.round((up / (up + down)) * 100) : null,
      // Only Roblox's own image host is allowed in the app.
      icon: img && /^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\//i.test(img) ? img : null,
    };
  });
}

/** Searches Roblox games by name. Returns { games, next } (next is a page token or null). */
async function searchGames(query, pageToken) {
  const q = String(query || '').trim().slice(0, 80);
  if (q.length < 2) throw new Error('Type at least 2 letters.');
  const url = `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&sessionId=${searchSession}&pageType=all${pageToken ? `&pageToken=${encodeURIComponent(String(pageToken).slice(0, 500))}` : ''}`;
  const r = await request(url);
  if (r.status === 429) throw new Error('Roblox asked MultiMenu to slow down. Try again in a minute.');
  if (!r.ok) throw new Error(`Roblox search did not answer (HTTP ${r.status}). Try again in a moment.`);
  const j = await r.json();
  const ids = universeIdsFromSearch(j).slice(0, 30);
  return { games: await getGamesDetails(ids), next: typeof j.nextPageToken === 'string' && j.nextPageToken ? j.nextPageToken : null };
}

// ---------- inbox counts ----------
async function getCount(url, cookie) {
  const r = await request(url, { cookie });
  authFail(r);
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return typeof j.count === 'number' ? j.count : null;
}
const getInboundTrades = (cookie) => getCount('https://trades.roblox.com/v1/trades/inbound/count', cookie);
const getUnreadMessages = (cookie) => getCount('https://privatemessages.roblox.com/v1/messages/unread/count', cookie);
const getFriendRequestCount = (cookie) => getCount('https://friends.roblox.com/v1/user/friend-requests/count', cookie);

// ---------- share links (roblox.com/share?code=...&type=Server) ----------
async function resolveShareLink(code, type, cookie) {
  const r = await requestWithCsrf('https://apis.roblox.com/sharelinks/v1/resolve-link', { cookie, method: 'POST', body: { linkId: code, linkType: type } });
  authFail(r);
  if (!r.ok) throw new Error(`Roblox couldn't open that share link (HTTP ${r.status}).`);
  const j = await r.json();
  const ps = j.privateServerInviteData;
  if (ps?.placeId) return { placeId: String(ps.placeId), linkCode: ps.linkCode || undefined };
  const ex = j.experienceInviteData || j.experienceDetailsInviteData;
  if (ex?.placeId) return { placeId: String(ex.placeId) };
  throw new Error('That share link has expired or isn\'t for a game.');
}

/** Public username validation endpoint (the one the signup form calls). */
async function validateUsername(username) {
  const url = `https://auth.roblox.com/v1/usernames/validate?request.username=${encodeURIComponent(username)}&request.birthday=2000-01-01T00:00:00.000Z&request.context=Signup`;
  const res = await request(url);
  if (!res.ok) return { checked: false, message: `Could not check (HTTP ${res.status})` };
  const j = await res.json();
  return { checked: true, valid: j.code === 0, message: j.message };
}

module.exports = {
  request, COOKIE_PREFIX, normaliseCookie, looksLikeCookie, getAuthenticatedUser, getHeadshots, getAuthTicket,
  parseTarget, buildLaunchUri, buildPlayerArgs, placeLauncherUrl, getPlaceName, validateUsername, newBrowserTrackerId,
  getServers, getUsersByUsernames, getFriends, getPresence, getRobux, getPremium, getFriendCount, getUsersByIds, getUserInfo, getModeration,
  getGameInfo, getUniverseId, searchGames, getGamesDetails, universeIdsFromSearch, getInboundTrades, getUnreadMessages, getFriendRequestCount, resolveShareLink,
  getOutfits, getOutfitDetails, applyOutfit, wearOwnOutfit, getFriendStatuses, sendFriendRequest, acceptFriendRequest,
};
