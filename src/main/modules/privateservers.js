'use strict';
// Private server manager: every private server your accounts own, with its
// expiry and link, launching alts straight into one, and a warning before one
// that won't renew runs out.
const { JsonStore } = require('../store');
const paths = require('../paths');
const roblox = require('./roblox');
const accounts = require('./accounts');
const sessions = require('./sessions');
const settings = require('./settings');
const bus = require('../bus');
const log = require('../logger').scope('privateservers');

let store = null, timer = null;
const db = () => store || (store = new JsonStore(paths.file('privateservers.json'), { servers: [], checkedAt: null, warned: {} }));

async function getJson(url, cookie) {
  const res = await roblox.request(url, { cookie });
  if (res.status === 401) { const e = new Error('This account\'s login has expired. Log in again.'); e.code = 'INVALID'; throw e; }
  if (!res.ok) throw new Error(`Roblox returned ${res.status}.`);
  return res.json();
}

/** One server from Roblox's list, in our shape (pure, unit-tested). */
function shape(raw, owner) {
  const exp = raw.expirationDate ? Date.parse(raw.expirationDate) : null;
  return {
    id: String(raw.privateServerId ?? raw.vipServerId ?? raw.id ?? ''),
    name: String(raw.name || 'Private server').slice(0, 60),
    game: String(raw.universeName || raw.gameName || '').slice(0, 80),
    placeId: raw.placeId != null ? String(raw.placeId) : null,
    universeId: raw.universeId != null ? String(raw.universeId) : null,
    active: raw.active !== false,
    willRenew: !!raw.willRenew,
    price: raw.priceInRobux ?? null,
    expiresAt: Number.isFinite(exp) ? exp : null,
    ownerAccountId: owner.id, ownerLabel: owner.alias || owner.displayName || owner.username,
    linkCode: null,
  };
}

/** Servers that run out within `days` and won't renew (pure, unit-tested). */
function expiringSoon(list, now, days) {
  return list.filter(s => s.active && !s.willRenew && s.expiresAt && s.expiresAt > now && s.expiresAt - now <= days * 86400_000);
}

async function refresh() {
  const accs = (accounts.getAll().accounts || []).filter(a => a.userId && a.status !== 'expired');
  if (!accs.length) throw new Error('Add an account first.');
  const before = new Map(db().get('servers').map(s => [s.id, s]));
  const out = [], errors = [];
  for (const a of accs.slice(0, 100)) {
    const cookie = accounts.getCookie(a.id);
    let cursor = '';
    try {
      for (let page = 0; page < 5; page++) {
        const q = new URLSearchParams({ privateServersTab: '0', itemsPerPage: '100' });
        if (cursor) q.set('cursor', cursor);
        const j = await getJson(`https://games.roblox.com/v1/private-servers/my-private-servers?${q}`, cookie);
        for (const raw of j.data || []) {
          const s = shape(raw, a);
          if (!s.id) continue;
          s.linkCode = before.get(s.id)?.linkCode || null;
          out.push(s);
        }
        cursor = j.nextPageCursor;
        if (!cursor) break;
      }
    } catch (e) {
      if (e.code === 'INVALID') accounts.markExpired(a.id, e.message);
      errors.push({ account: a.alias || a.username, error: e.message });
    }
    await new Promise(r => setTimeout(r, 150));
  }
  // Names of games Roblox didn't include.
  const missing = [...new Set(out.filter(s => !s.game && s.placeId).map(s => s.placeId))].slice(0, 30);
  for (const pid of missing) { const n = await roblox.getPlaceName(pid).catch(() => null); if (n) out.filter(s => s.placeId === pid).forEach(s => { s.game = n; }); }
  out.sort((x, y) => (y.active - x.active) || ((x.expiresAt || Infinity) - (y.expiresAt || Infinity)));
  db().set('servers', out);
  db().set('checkedAt', Date.now());
  warn();
  return { ...status(), errors };
}

/** The join link for a server (only its owner can see it). */
async function linkFor(id) {
  const s = db().get('servers').find(x => x.id === String(id));
  if (!s) throw new Error('That private server is not in the list. Press Refresh.');
  if (s.linkCode) return s;
  const j = await getJson(`https://games.roblox.com/v1/vip-servers/${encodeURIComponent(s.id)}`, accounts.getCookie(s.ownerAccountId));
  const t = j.link ? roblox.parseTarget(j.link) : null;
  if (!t?.linkCode) throw new Error('This server has no join link yet. Open it on roblox.com (Servers → Configure) and press Generate link, then try again.');
  s.linkCode = t.linkCode;
  if (!s.placeId && t.placeId) s.placeId = t.placeId;
  db().saveSoon();
  return s;
}

async function launch(id, accountIds) {
  const ids = (Array.isArray(accountIds) ? accountIds : []).filter(x => accounts.find(x));
  if (!ids.length) throw new Error('Pick at least one account.');
  const s = await linkFor(id);
  if (!s.placeId) throw new Error('Roblox didn\'t say which game this server is for.');
  const target = sessions.sanitizeTarget({ placeId: s.placeId, linkCode: s.linkCode });
  ids.forEach(a => sessions.launch(a, null, { target }));
  return { queued: ids.length, name: s.name };
}

async function save(id) {
  const s = await linkFor(id);
  const link = `https://www.roblox.com/games/${s.placeId}?privateServerLinkCode=${s.linkCode}`;
  return require('./servers').addGame({ name: `${s.name}${s.game ? ` (${s.game})` : ''}`.slice(0, 60), link });
}

function warn() {
  const cfg = settings.get('privateServers');
  if (!cfg.warn) return;
  const warned = db().get('warned');
  for (const s of expiringSoon(db().get('servers'), Date.now(), cfg.warnDays)) {
    const key = `${s.id}:${s.expiresAt}`;
    if (warned[key]) continue;
    warned[key] = Date.now();
    const ends = new Date(s.expiresAt).toLocaleDateString();
    bus.emit('event', { type: 'privateServerExpiring', account: s.ownerLabel, detail: `${s.name}${s.game ? ` (${s.game})` : ''} won't renew and ends on ${ends}.` });
  }
  for (const k of Object.keys(warned)) if (Date.now() - warned[k] > 60 * 86400_000) delete warned[k];
  db().saveSoon();
}

function status() {
  const list = db().get('servers');
  const cfg = settings.get('privateServers');
  return { servers: list, checkedAt: db().get('checkedAt'), expiring: expiringSoon(list, Date.now(), cfg.warnDays).map(s => s.id), config: cfg };
}

function init() {
  db();
  clearInterval(timer);
  // Once a day (and soon after start) while warnings are on.
  const tick = () => {
    const cfg = settings.get('privateServers');
    if (!cfg.warn || !(accounts.getAll().accounts || []).length) return;
    const last = db().get('checkedAt') || 0;
    if (Date.now() - last < 20 * 3600_000) { warn(); return; }
    refresh().catch(e => log.warn(`Private servers: ${e.message}`));
  };
  setTimeout(tick, 5 * 60_000).unref?.();
  timer = setInterval(tick, 3600_000);
  timer.unref?.();
}

module.exports = { init, refresh, status, launch, save, linkFor, shape, expiringSoon };
