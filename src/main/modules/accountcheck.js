'use strict';
// Items & security: a security check for every account (2-step verification,
// email, phone, PIN), Robux and pending Robux totals, limited items with their
// value, and which accounts own a game's passes and badges.
// Read-only: nothing here changes an account. Email addresses and phone numbers
// are never kept or shown, only whether they are set up.
const { JsonStore } = require('../store');
const paths = require('../paths');
const roblox = require('./roblox');
const accounts = require('./accounts');
const settings = require('./settings');
const bus = require('../bus');
const log = require('../logger').scope('accountcheck');

let store = null;
const db = () => store || (store = new JsonStore(paths.file('accountcheck.json'), { security: {}, wallet: {}, items: {}, passes: null }));
function init() { db(); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Runs fn over items, at most n at a time, keeping the order of the results. */
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function getJson(url, cookie) {
  const res = await roblox.request(url, { cookie });
  if (res.status === 401) { const e = new Error('This account\'s login has expired. Log in again.'); e.code = 'INVALID'; throw e; }
  if (res.status === 429) { const e = new Error('Roblox is rate-limiting. Try again in a minute.'); e.code = 'RATE'; throw e; }
  if (!res.ok) { const e = new Error(`Roblox returned ${res.status}.`); e.status = res.status; throw e; }
  return res.json();
}

function pickAccounts(ids) {
  const all = accounts.getAll().accounts || [];
  const list = Array.isArray(ids) && ids.length ? all.filter(a => ids.includes(a.id)) : all;
  return list.filter(a => a.userId && a.status !== 'expired').slice(0, 200);
}

const labelOf = (a) => a.alias || a.displayName || a.username;

// ---------- security ----------
/** Turns the raw answers into a score and a list of problems (pure, unit-tested). */
function summarizeSecurity(r) {
  const issues = [];
  if (r.twoStep === false) issues.push({ id: 'twoStep', level: 'high', text: '2-step verification is off' });
  if (r.email === 'none') issues.push({ id: 'email', level: 'high', text: 'No email address' });
  else if (r.email === 'unverified') issues.push({ id: 'email', level: 'medium', text: 'Email not verified' });
  if (r.phone === 'none') issues.push({ id: 'phone', level: 'low', text: 'No phone number' });
  if (r.pin === false) issues.push({ id: 'pin', level: 'low', text: 'No account PIN' });
  const known = ['twoStep', 'email', 'phone', 'pin'].filter(k => r[k] != null).length;
  const weight = { high: 35, medium: 20, low: 10 };
  const score = known ? Math.max(0, 100 - issues.reduce((s, i) => s + weight[i.level], 0)) : null;
  return { score, issues, grade: score == null ? 'unknown' : score >= 90 ? 'good' : score >= 60 ? 'fair' : 'weak' };
}

async function securityOf(a) {
  const cookie = accounts.getCookie(a.id);
  const r = { twoStep: null, email: null, phone: null, pin: null };
  const tryGet = async (url) => { try { return await getJson(url, cookie); } catch (e) { if (e.code === 'INVALID' || e.code === 'RATE') throw e; return null; } };
  const ts = await tryGet(`https://twostepverification.roblox.com/v1/users/${a.userId}/configuration`);
  if (ts) r.twoStep = Array.isArray(ts.methods) ? ts.methods.some(m => m && m.enabled) : !!ts.primaryMediaType;
  const em = await tryGet('https://accountsettings.roblox.com/v1/email');
  if (em) r.email = !em.emailAddress ? 'none' : em.verified ? 'verified' : 'unverified';
  const ph = await tryGet('https://accountinformation.roblox.com/v1/phone');
  if (ph) r.phone = !ph.phone ? 'none' : ph.isVerified ? 'verified' : 'unverified';
  const pin = await tryGet('https://auth.roblox.com/v1/account/pin');
  if (pin) r.pin = !!pin.isEnabled;
  return { ...r, ...summarizeSecurity(r), at: Date.now() };
}

async function checkSecurity(ids) {
  const list = pickAccounts(ids);
  if (!list.length) throw new Error('Add an account first (expired logins are skipped).');
  const out = db().get('security');
  await mapLimit(list, 3, async (a) => {
    try { out[a.id] = await securityOf(a); } catch (e) {
      if (e.code === 'INVALID') accounts.markExpired(a.id, e.message);
      out[a.id] = { ...(out[a.id] || {}), error: e.message, at: Date.now() };
    }
    await sleep(150);
  });
  db().saveSoon();
  return status();
}

// ---------- Robux ----------
async function walletOf(a) {
  const cookie = accounts.getCookie(a.id);
  const [robux, premium] = await Promise.all([roblox.getRobux(a.userId, cookie), roblox.getPremium(a.userId, cookie).catch(() => null)]);
  let pending = null, incoming = null;
  try {
    const t = await getJson(`https://economy.roblox.com/v2/users/${a.userId}/transaction-totals?timeFrame=Month&transactionType=summary`, cookie);
    pending = Number.isFinite(t.pendingRobuxTotal) ? t.pendingRobuxTotal : null;
    incoming = Number.isFinite(t.incomingRobuxTotal) ? t.incomingRobuxTotal : null;
  } catch (e) { if (e.code === 'INVALID') throw e; }
  return { robux, premium, pending, incoming, at: Date.now() };
}

/** Totals over every account's last known wallet (pure, unit-tested). */
function walletTotals(wallets) {
  const v = Object.values(wallets || {}).filter(w => w && !w.error);
  const sum = (k) => v.reduce((s, w) => s + (Number.isFinite(w[k]) ? w[k] : 0), 0);
  return { robux: sum('robux'), pending: sum('pending'), incoming: sum('incoming'), premium: v.filter(w => w.premium).length, counted: v.length };
}

async function checkWallets(ids) {
  const list = pickAccounts(ids);
  if (!list.length) throw new Error('Add an account first (expired logins are skipped).');
  const out = db().get('wallet');
  await mapLimit(list, 3, async (a) => {
    try {
      out[a.id] = await walletOf(a);
    } catch (e) {
      if (e.code === 'INVALID') accounts.markExpired(a.id, e.message);
      out[a.id] = { ...(out[a.id] || {}), error: e.message, at: Date.now() };
    }
    await sleep(150);
  });
  db().saveSoon();
  return status();
}

// ---------- limited items ----------
let values = null; // { at, items: { assetId: value } } from Rolimons
async function rolimonsValues() {
  if (values && Date.now() - values.at < 3600_000) return values.items;
  try {
    const res = await fetch('https://api.rolimons.com/items/v2/itemdetails', { headers: { 'User-Agent': 'MultiMenu' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const items = {};
    for (const [id, d] of Object.entries(j.items || {})) if (Array.isArray(d) && Number(d[3]) > 0) items[id] = Number(d[3]);
    values = { at: Date.now(), items };
    return items;
  } catch (e) { log.warn(`Item values unavailable: ${e.message}`); return values?.items || {}; }
}

/** RAP and value of a list of collectibles (pure, unit-tested). value falls back to RAP. */
function valueItems(list, valueMap = {}) {
  const items = list.map(i => {
    const rap = Number(i.recentAveragePrice) || 0;
    const v = Number(valueMap[String(i.assetId)]) || 0;
    return { assetId: String(i.assetId), name: String(i.name || '').slice(0, 80), serial: i.serialNumber ?? null, rap, value: v || rap, valued: !!v, onHold: !!i.isOnHold };
  }).sort((a, b) => b.value - a.value);
  return { count: items.length, rap: items.reduce((s, i) => s + i.rap, 0), value: items.reduce((s, i) => s + i.value, 0), top: items.slice(0, 12) };
}

async function collectiblesOf(a) {
  const cookie = accounts.getCookie(a.id);
  const all = [];
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ sortOrder: 'Asc', limit: '100' });
    if (cursor) q.set('cursor', cursor);
    let j;
    try { j = await getJson(`https://inventory.roblox.com/v1/users/${a.userId}/assets/collectibles?${q}`, cookie); } catch (e) {
      if (e.status === 403) return { hidden: true, count: 0, rap: 0, value: 0, top: [], at: Date.now() };
      throw e;
    }
    all.push(...(j.data || []));
    cursor = j.nextPageCursor;
    if (!cursor) break;
    await sleep(200);
  }
  const map = settings.get('wallet.rolimons') ? await rolimonsValues() : {};
  return { ...valueItems(all, map), at: Date.now() };
}

async function checkItems(ids) {
  const list = pickAccounts(ids);
  if (!list.length) throw new Error('Add an account first (expired logins are skipped).');
  const out = db().get('items');
  await mapLimit(list, 2, async (a) => {
    try { out[a.id] = await collectiblesOf(a); } catch (e) {
      if (e.code === 'INVALID') accounts.markExpired(a.id, e.message);
      out[a.id] = { ...(out[a.id] || {}), error: e.message, at: Date.now() };
    }
  });
  // Pictures for the most valuable items (rbxcdn only, which the page may show).
  const ids2 = [...new Set(Object.values(out).flatMap(x => (x.top || []).slice(0, 6).map(t => t.assetId)))].slice(0, 100);
  if (ids2.length) {
    try {
      const j = await getJson(`https://thumbnails.roblox.com/v1/assets?assetIds=${ids2.join(',')}&size=110x110&format=Png&isCircular=false`);
      const pics = Object.fromEntries((j.data || []).filter(d => /^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\//i.test(d.imageUrl || '')).map(d => [String(d.targetId), d.imageUrl]));
      for (const x of Object.values(out)) for (const t of x.top || []) if (pics[t.assetId]) t.icon = pics[t.assetId];
    } catch { /* pictures are optional */ }
  }
  db().saveSoon();
  return status();
}

// ---------- game passes and badges ----------
async function passesOf(universeId) {
  try {
    const j = await getJson(`https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?passView=Full&pageSize=100`);
    const list = j.gamePasses || j.data || [];
    if (list.length) return list.map(p => ({ id: String(p.id), name: String(p.displayName || p.name || '').slice(0, 60), price: p.price ?? null }));
  } catch { /* older endpoint below */ }
  try {
    const j = await getJson(`https://games.roblox.com/v1/games/${universeId}/game-passes?limit=100&sortOrder=Asc`);
    return (j.data || []).map(p => ({ id: String(p.id), name: String(p.displayName || p.name || '').slice(0, 60), price: p.price ?? null }));
  } catch { return []; }
}

async function badgesOf(universeId) {
  try {
    const j = await getJson(`https://badges.roblox.com/v1/universes/${universeId}/badges?limit=100&sortOrder=Asc`);
    return (j.data || []).filter(b => b.enabled !== false).map(b => ({ id: String(b.id), name: String(b.displayName || b.name || '').slice(0, 60) }));
  } catch { return []; }
}

/** Which accounts own which passes and badges in one game. */
async function checkGame(input, ids) {
  const t = roblox.parseTarget(input);
  if (!t?.placeId) throw new Error('Enter a place ID or a roblox.com game link.');
  const universeId = await roblox.getUniverseId(t.placeId);
  if (!universeId) throw new Error('That game was not found.');
  const list = pickAccounts(ids).slice(0, 50);
  if (!list.length) throw new Error('Pick at least one account (expired logins are skipped).');
  const [passes, badges, name] = await Promise.all([passesOf(universeId), badgesOf(universeId), roblox.getPlaceName(t.placeId)]);
  const P = passes.slice(0, 40), B = badges.slice(0, 100);
  const rows = await mapLimit(list, 2, async (a) => {
    const cookie = accounts.getCookie(a.id);
    const row = { accountId: a.id, label: labelOf(a), passes: {}, badges: {}, error: null };
    try {
      for (const p of P) {
        try {
          const j = await getJson(`https://inventory.roblox.com/v1/users/${a.userId}/items/GamePass/${p.id}`, cookie);
          row.passes[p.id] = Array.isArray(j.data) && j.data.length > 0;
        } catch (e) { if (e.code === 'INVALID' || e.code === 'RATE') throw e; row.passes[p.id] = null; }
        await sleep(80);
      }
      if (B.length) {
        const j = await getJson(`https://badges.roblox.com/v1/users/${a.userId}/badges/awarded-dates?badgeIds=${B.map(b => b.id).join(',')}`, cookie);
        const got = new Set((j.data || []).map(d => String(d.badgeId)));
        for (const b of B) row.badges[b.id] = got.has(b.id);
      }
    } catch (e) { row.error = e.message; }
    return row;
  });
  const result = { placeId: t.placeId, universeId: String(universeId), name: name || `Place ${t.placeId}`, passes: P, badges: B, rows, at: Date.now(), morePasses: passes.length > P.length, moreBadges: badges.length > B.length };
  db().set('passes', result);
  return result;
}

// ---------- view ----------
function status() {
  const all = accounts.getAll().accounts || [];
  const sec = db().get('security'), wal = db().get('wallet'), it = db().get('items');
  const rows = all.map(a => ({ accountId: a.id, label: labelOf(a), username: a.username, avatarUrl: a.avatarUrl || '', tier: a.tier || 'filler', expired: a.status === 'expired', security: sec[a.id] || null, wallet: wal[a.id] || null, items: it[a.id] || null }));
  const known = new Set(all.map(a => a.id));
  const live = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => known.has(k)));
  const itemsV = Object.values(live(it)).filter(x => !x.error);
  return {
    rows,
    totals: {
      wallet: walletTotals(live(wal)),
      items: { count: itemsV.reduce((s, x) => s + (x.count || 0), 0), rap: itemsV.reduce((s, x) => s + (x.rap || 0), 0), value: itemsV.reduce((s, x) => s + (x.value || 0), 0) },
      security: { weak: Object.values(live(sec)).filter(s => s.grade === 'weak').length, checked: Object.values(live(sec)).filter(s => s.grade).length },
    },
    passes: db().get('passes'),
    config: settings.get('wallet'),
  };
}

function forget(accountId) { for (const k of ['security', 'wallet', 'items']) delete db().get(k)[accountId]; db().saveSoon(); }

bus.on('accounts:removed', (p) => { try { if (p?.id && p.forever) forget(p.id); } catch { /* not started */ } });

module.exports = { init, status, checkSecurity, checkWallets, checkItems, checkGame, summarizeSecurity, walletTotals, valueItems, mapLimit };
