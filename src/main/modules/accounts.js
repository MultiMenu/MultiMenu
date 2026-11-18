'use strict';
// Account manager: storage, groups/favourites, official-login capture, cookie import.
// Cookies are encrypted with DPAPI (secure.js), never sent to the renderer and never logged.
const crypto = require('crypto');
const { BrowserWindow, session } = require('electron');
const { JsonStore } = require('../store');
const paths = require('../paths');
const secure = require('../secure');
const roblox = require('./roblox');
const bus = require('../bus');
const log = require('../logger').scope('accounts');

let store;
let loginWin = null;
let binTimer = null;
const COLORS = ['violet', 'pink', 'blue', 'cyan', 'green', 'yellow', 'orange', 'red'];
// Priority tiers. Main is never closed or slowed down automatically; launches go Main → Important → Filler.
const TIERS = ['main', 'important', 'filler'];
const tierRank = (a) => { const i = TIERS.indexOf(a?.tier); return i < 0 ? 2 : i; };

function init() {
  store = new JsonStore(paths.file('accounts.json'), { version: 1, accounts: [], groups: ['Main', 'Alts'], pending: [], filters: [], bin: [] });
  try { pruneBin(); } catch { /* settings not ready in some tests */ }
  clearInterval(binTimer);
  binTimer = setInterval(() => { try { pruneBin(); } catch { /* ignore */ } }, 6 * 3600_000);
  binTimer.unref?.();
  return store;
}

const list = () => store.get('accounts');
const find = id => list().find(a => a.id === id);
function save() { store.saveSoon(); bus.emit('accounts:changed'); }

/** Renderer-safe view: never includes secrets. */
function publicView(a) {
  return {
    id: a.id, userId: a.userId, username: a.username, displayName: a.displayName, alias: a.alias,
    group: a.group, favourite: !!a.favourite, notes: a.notes || '', status: a.status || 'unknown',
    statusMessage: a.statusMessage || '', avatarUrl: a.avatarUrl || '', defaultPlace: a.defaultPlace || '',
    hasPassword: !!a.passwordEnc, createdAt: a.createdAt, lastUsedAt: a.lastUsedAt || null, order: a.order ?? 0,
    robux: a.robux ?? null, premium: a.premium ?? null, friendCount: a.friendCount ?? null, detailsAt: a.detailsAt || null, health: a.health || null,
    color: a.color || null, launchGraphics: a.launchGraphics || null, inbox: a.inbox || null,
    tier: TIERS.includes(a.tier) ? a.tier : 'filler', tags: Array.isArray(a.tags) ? a.tags.slice() : [], slot: a.slot || null,
  };
}

// ---------- export a list (never logins) ----------
const EXPORT_COLUMNS = {
  username: ['Username', v => v.username], displayName: ['Display name', v => v.displayName], alias: ['Alias', v => v.alias],
  userId: ['User ID', v => v.userId], profile: ['Profile link', v => (v.userId ? `https://www.roblox.com/users/${v.userId}/profile` : '')],
  group: ['Group', v => v.group], tags: ['Tags', v => (v.tags || []).join(' ')], tier: ['Importance', v => v.tier],
  notes: ['Notes', v => v.notes], status: ['Login', v => v.status], robux: ['Robux', v => (v.robux ?? '')], premium: ['Premium', v => (v.premium == null ? '' : v.premium ? 'yes' : 'no')],
  added: ['Added', v => (v.createdAt ? new Date(v.createdAt).toISOString().slice(0, 10) : '')], lastUsed: ['Last used', v => (v.lastUsedAt ? new Date(v.lastUsedAt).toISOString().slice(0, 10) : '')],
};

/** A spreadsheet cell: quoted, and never a formula (a cell starting with = + - @ is made plain text). */
function csvCell(v) {
  let t = String(v ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",;]/.test(t) || t !== t.trim() ? `"${t.replace(/"/g, '""')}"` : t;
}

/**
 * The account list as text. Built only from publicView, so passwords and logins can't be in it.
 * opts: { ids (default all), columns (keys of EXPORT_COLUMNS), format: 'csv' | 'txt' }
 */
function exportList({ ids, columns, format = 'csv' } = {}) {
  const want = (Array.isArray(columns) ? columns : ['username', 'displayName', 'alias', 'group', 'tags', 'notes']).filter(c => EXPORT_COLUMNS[c]);
  if (!want.length) throw new Error('Pick at least one column.');
  const pick = Array.isArray(ids) && ids.length ? new Set(ids.map(String)) : null;
  const rows = list().filter(a => !a.deletedAt && (!pick || pick.has(a.id))).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(publicView);
  if (!rows.length) throw new Error('No accounts to export.');
  if (format === 'txt') {
    // One account per line: the first column, then the rest in brackets when they have something.
    return { count: rows.length, text: `${rows.map(v => { const [first, ...rest] = want.map(c => String(EXPORT_COLUMNS[c][1](v) ?? '').replace(/\s+/g, ' ').trim()); const extra = rest.filter(Boolean); return extra.length ? `${first} (${extra.join(', ')})` : first; }).join('\r\n')}\r\n` };
  }
  const head = want.map(c => csvCell(EXPORT_COLUMNS[c][0])).join(',');
  const body = rows.map(v => want.map(c => csvCell(EXPORT_COLUMNS[c][1](v))).join(','));
  return { count: rows.length, text: `\uFEFF${[head, ...body].join('\r\n')}\r\n` }; // BOM so Excel reads accents right
}

/** Tags are short, lower-case and unique per account. */
function cleanTags(v) {
  const list = (Array.isArray(v) ? v : String(v || '').split(','))
    .map(t => String(t).toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 24)).filter(Boolean);
  return [...new Set(list)].slice(0, 10);
}

function getAll() {
  return {
    accounts: list().slice().sort((x, y) => (!!y.favourite - !!x.favourite) || ((x.order ?? 0) - (y.order ?? 0))).map(publicView),
    groups: store.get('groups'),
    secureStorage: secure.available(),
    filters: filters().map(f => ({ ...f, q: { ...f.q } })), tags: allTags(), binCount: bin().length,
  };
}

function getCookie(id) {
  const a = find(id);
  if (!a) throw new Error('Account not found');
  return secure.decrypt(a.cookieEnc);
}

async function upsertFromCookie(cookie, extra = {}) {
  const user = await roblox.getAuthenticatedUser(cookie);
  // Encrypt first: if Windows can't, nothing is added (no blank half-made account).
  const cookieEnc = secure.encrypt(cookie);
  const passwordEnc = extra.password ? secure.encrypt(extra.password) : null;
  let a = list().find(x => x.userId === user.id);
  const isNew = !a;
  if (!a) {
    a = { id: crypto.randomUUID(), createdAt: Date.now(), group: extra.group || store.get('groups')[0] || 'Main', favourite: false, order: list().reduce((m, x) => Math.max(m, (x.order ?? 0) + 1), 0) };
    list().push(a);
  }
  Object.assign(a, {
    userId: user.id, username: user.name, displayName: user.displayName,
    cookieEnc, status: 'valid', statusMessage: '', checkedAt: Date.now(),
  });
  if (passwordEnc) a.passwordEnc = passwordEnc;
  if (extra.alias) a.alias = extra.alias;
  if (extra.notes && !a.notes) a.notes = String(extra.notes).slice(0, 500);
  if (extra.group && isNew) {
    const g = String(extra.group).slice(0, 30);
    if (!store.get('groups').includes(g)) store.get('groups').push(g);
    a.group = g;
  }
  try { a.avatarUrl = (await roblox.getHeadshots([user.id]))[user.id] || a.avatarUrl; } catch { /* cosmetic */ }
  save();
  log.info(`${isNew ? 'Added' : 'Updated'} account userId=${user.id}`);
  if (!extra.quiet) bus.emit('notify', { level: 'success', title: isNew ? 'Account added' : 'Account updated', message: user.name });
  return publicView(a);
}

async function importCookie(raw, opts = {}) {
  const cookie = roblox.normaliseCookie(raw);
  if (!roblox.looksLikeCookie(cookie)) {
    throw new Error('That does not look like a Roblox .ROBLOSECURITY cookie. Paste the full value, which starts with _|WARNING:-DO-NOT-SHARE-THIS.');
  }
  return upsertFromCookie(cookie, opts);
}

/** Validates a JSON/TXT bulk import file: one cookie per line, or [{cookie, alias, group}]. */
function parseImportFile(text) {
  if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('File is empty or too large.');
  let entries = [];
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    let arr;
    try { arr = JSON.parse(trimmed); } catch { throw new Error('The JSON file could not be read.'); }
    if (!Array.isArray(arr)) throw new Error('Expected a JSON array.');
    entries = arr.filter(x => x && typeof x.cookie === 'string').map(x => ({
      cookie: x.cookie, alias: typeof x.alias === 'string' ? x.alias.slice(0, 40) : '', group: typeof x.group === 'string' ? x.group.slice(0, 30) : '',
    }));
  } else {
    entries = trimmed.split(/\r?\n/).map(l => ({ cookie: l.trim() })).filter(e => e.cookie);
  }
  entries = entries.map(e => ({ ...e, cookie: roblox.normaliseCookie(e.cookie) })).filter(e => roblox.looksLikeCookie(e.cookie));
  if (!entries.length) throw new Error('No valid cookies were found in that file.');
  if (entries.length > 200) throw new Error('Import is limited to 200 accounts at a time.');
  return entries;
}

async function importFile(text) {
  const entries = parseImportFile(text);
  const results = { added: 0, failed: 0, errors: [] };
  for (const e of entries) {
    try { await upsertFromCookie(e.cookie, { ...e, quiet: true }); results.added++; } catch (err) { results.failed++; results.errors.push(err.message); }
    await new Promise(r => setTimeout(r, 400)); // be gentle with Roblox's API
  }
  // One message for the whole file instead of one per account.
  bus.emit('notify', { level: results.failed ? 'warn' : 'success', title: 'Import finished', message: results.failed ? `${results.added} added, ${results.failed} failed.` : `${results.added} added.` });
  return results;
}

/** Validates per-account launch graphics; returns the value to store (or null). */
function cleanGraphics(g) {
  if (!g) return null;
  const q = g.quality == null || g.quality === '' ? null : Number(g.quality);
  const f = g.fpsCap == null || g.fpsCap === '' ? null : Number(g.fpsCap);
  if (q != null && !(Number.isInteger(q) && q >= 0 && q <= 10)) throw new Error('Graphics quality must be 0–10.');
  if (f != null && ![30, 60, 75, 120, 144, 165, 240, -1].includes(f)) throw new Error('Unsupported FPS cap.');
  return q == null && f == null ? null : { quality: q, fpsCap: f };
}

function update(id, patch) {
  const a = find(id);
  if (!a) throw new Error('Account not found');
  if (typeof patch.alias === 'string') a.alias = patch.alias.trim().slice(0, 40);
  if (typeof patch.group === 'string') { a.group = patch.group.slice(0, 30); addGroup(a.group); }
  if (typeof patch.favourite === 'boolean') a.favourite = patch.favourite;
  if (typeof patch.notes === 'string') a.notes = patch.notes.slice(0, 1000);
  if (typeof patch.defaultPlace === 'string') a.defaultPlace = patch.defaultPlace.trim().slice(0, 300);
  if ('color' in patch) a.color = COLORS.includes(patch.color) ? patch.color : null;
  if ('launchGraphics' in patch) a.launchGraphics = cleanGraphics(patch.launchGraphics);
  if ('tier' in patch) { if (!TIERS.includes(patch.tier)) throw new Error('Unknown priority level.'); a.tier = patch.tier; }
  if ('tags' in patch) a.tags = cleanTags(patch.tags);
  if ('slot' in patch) setSlot(a, patch.slot);
  save();
  return publicView(a);
}

/** Hotkey slots 1–9 belong to one account at a time. */
function setSlot(a, slot) {
  const n = slot == null || slot === '' ? null : Number(slot);
  if (n != null && !(Number.isInteger(n) && n >= 1 && n <= 9)) throw new Error('The hotkey slot must be 1–9.');
  if (n != null) for (const o of list()) if (o !== a && o.slot === n) o.slot = null;
  a.slot = n;
}

/** Gives slots 1–9 to the first nine accounts: Main first, then Important, then the rest in your order. */
function autoSlots() {
  const sorted = list().slice().sort((x, y) => (tierRank(x) - tierRank(y)) || (!!y.favourite - !!x.favourite) || ((x.order ?? 0) - (y.order ?? 0)));
  list().forEach(a => { a.slot = null; });
  sorted.slice(0, 9).forEach((a, i) => { a.slot = i + 1; });
  save();
  return getAll();
}

/** Changes the same fields on many accounts at once. Only keys present in the patch change. */
function bulkUpdate(ids, patch = {}) {
  const list = (Array.isArray(ids) ? ids : []).map(find).filter(Boolean);
  if (!list.length) throw new Error('No accounts selected.');
  const p = {};
  for (const k of ['group', 'favourite', 'defaultPlace', 'color', 'launchGraphics', 'tier']) if (k in patch) p[k] = patch[k];
  if ('launchGraphics' in p) p.launchGraphics = cleanGraphics(p.launchGraphics); // fail before changing anything
  if ('tier' in p && !TIERS.includes(p.tier)) throw new Error('Unknown priority level.');
  const append = typeof patch.notesAppend === 'string' ? patch.notesAppend.trim() : '';
  const addTags = cleanTags(patch.tagsAdd || []), dropTags = cleanTags(patch.tagsRemove || []);
  for (const a of list) {
    const one = { ...p };
    if (append) one.notes = (a.notes ? `${a.notes}\n${append}` : append).slice(0, 1000);
    if (patch.clearNotes) one.notes = '';
    if (addTags.length || dropTags.length) one.tags = [...(a.tags || []), ...addTags].filter(t => !dropTags.includes(t));
    update(a.id, one);
  }
  return { changed: list.length };
}

function reorder(ids) {
  ids.forEach((id, i) => { const a = find(id); if (a) a.order = i; });
  save();
}

// ---------- Recycle bin ----------
// Removed accounts wait here (still encrypted) for accounts.binDays days, then are deleted for good.
const bin = () => store.get('bin') || (store.data.bin = []);
function binDays() { try { return Math.max(0, Math.min(365, Number(require('./settings').get('accounts.binDays')) || 0)); } catch { return 30; } }

function remove(id, { forever = false } = {}) {
  const arr = list();
  const i = arr.findIndex(a => a.id === id);
  if (i < 0) return false;
  const [a] = arr.splice(i, 1);
  if (!forever && binDays() > 0) { a.deletedAt = Date.now(); a.slot = null; bin().unshift(a); }
  save();
  bus.emit('accounts:removed', { id, forever: forever || binDays() === 0 });
  return true;
}
function binList() {
  const days = binDays();
  return bin().map(a => ({ ...publicView(a), deletedAt: a.deletedAt, purgeAt: a.deletedAt + days * 86400000 }));
}
function restore(id) {
  const i = bin().findIndex(a => a.id === id);
  if (i < 0) throw new Error('That account is no longer in the recycle bin.');
  const [a] = bin().splice(i, 1);
  delete a.deletedAt;
  // The same Roblox account may have been added again meanwhile: keep the newer one.
  if (list().some(x => x.userId === a.userId)) { save(); throw new Error(`${a.username} is already in your account list.`); }
  a.order = list().length;
  list().push(a);
  save();
  return publicView(a);
}
function purge(id) {
  const n = bin().length;
  store.set('bin', bin().filter(a => a.id !== id));
  save();
  return n !== bin().length;
}
function emptyBin() { const n = bin().length; store.set('bin', []); save(); return n; }
function pruneBin(now = Date.now()) {
  const keep = binDays() * 86400000;
  const before = bin().length;
  const left = bin().filter(a => now - (a.deletedAt || 0) < keep);
  if (left.length === before) return 0; // nothing expired: don't rewrite the file
  store.set('bin', left);
  save();
  return before - left.length;
}

// ---------- Saved filters & tags ----------
function cleanQuery(q = {}) {
  const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return {
    text: s(q.text, 60), group: s(q.group, 30), tag: cleanTags([q.tag || ''])[0] || '',
    tier: TIERS.includes(q.tier) ? q.tier : '', status: ['valid', 'expired', 'unknown', 'error'].includes(q.status) ? q.status : '',
  };
}
function filters() { return store.get('filters') || (store.data.filters = []); }
function saveFilter(name, q) {
  const n = String(name || '').trim().slice(0, 30);
  if (!n) throw new Error('Give the filter a name.');
  const f = filters().find(x => x.name.toLowerCase() === n.toLowerCase());
  if (f) f.q = cleanQuery(q);
  else { if (filters().length >= 20) throw new Error('You can save up to 20 filters.'); filters().push({ id: crypto.randomUUID(), name: n, q: cleanQuery(q) }); }
  save();
  return filters();
}
function removeFilter(id) { store.set('filters', filters().filter(f => f.id !== id)); save(); return filters(); }
/** Applies a saved-filter query to an account (public or raw). */
function matches(a, q) {
  q = cleanQuery(q);
  if (q.group && a.group !== q.group) return false;
  if (q.tag && !(a.tags || []).includes(q.tag)) return false;
  if (q.tier && (TIERS.includes(a.tier) ? a.tier : 'filler') !== q.tier) return false;
  if (q.status && (a.status || 'unknown') !== q.status) return false;
  if (q.text) {
    const hay = `${a.username} ${a.displayName || ''} ${a.alias || ''} ${a.notes || ''} ${(a.tags || []).join(' ')}`.toLowerCase();
    if (!q.text.toLowerCase().split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}
function allTags() {
  const count = {};
  for (const a of list()) for (const t of a.tags || []) count[t] = (count[t] || 0) + 1;
  return Object.entries(count).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([tag, n]) => ({ tag, count: n }));
}

/** Finds accounts from text: "tag:farm", "group:Alts", "tier:main", "all", or a name / nickname. */
function resolve(spec) {
  const q = String(spec || '').trim();
  if (!q) return [];
  const m = /^(tag|group|tier|id):(.+)$/i.exec(q);
  let out;
  if (/^all$/i.test(q)) out = list().slice();
  else if (m) {
    const kind = m[1].toLowerCase(), v = m[2].trim().toLowerCase();
    out = list().filter(a => (kind === 'id' ? a.id === m[2].trim() : kind === 'tag' ? (a.tags || []).includes(v) : kind === 'group' ? String(a.group).toLowerCase() === v : (TIERS.includes(a.tier) ? a.tier : 'filler') === v));
  } else {
    const l = q.toLowerCase();
    const names = (a) => [a.alias, a.displayName, a.username].filter(Boolean).map(x => String(x).toLowerCase());
    out = list().filter(a => names(a).includes(l));
    if (!out.length) out = list().filter(a => names(a).some(n => n.includes(l)));
    if (out.length > 1 && !m) out = out.slice(0, 1);
  }
  return out.sort((x, y) => (tierRank(x) - tierRank(y)) || ((x.order ?? 0) - (y.order ?? 0)));
}
/** Sorts account ids so Main launches first, then Important, then Filler (stable otherwise). */
function byTier(ids) {
  return ids.map((id, i) => ({ id, i, r: tierRank(find(id)) })).sort((x, y) => x.r - y.r || x.i - y.i).map(x => x.id);
}

function addGroup(name) {
  const n = String(name || '').trim().slice(0, 30);
  if (!n) throw new Error('Group name is empty');
  const g = store.get('groups');
  if (!g.includes(n)) { g.push(n); save(); }
  return g;
}

function renameGroup(oldName, newName) {
  const n = String(newName || '').trim().slice(0, 30);
  if (!n) throw new Error('Group name is empty');
  const g = store.get('groups');
  const i = g.indexOf(oldName);
  if (i < 0) throw new Error('Group not found');
  // Renaming onto a group that already exists merges the two (no duplicate names).
  if (n !== oldName && g.includes(n)) g.splice(i, 1); else g[i] = n;
  list().forEach(a => { if (a.group === oldName) a.group = n; });
  save();
  return g;
}

function deleteGroup(name) {
  const g = store.get('groups').filter(x => x !== name);
  if (!g.length) g.push('Main');
  store.set('groups', g);
  list().forEach(a => { if (a.group === name) a.group = g[0]; });
  save();
  return g;
}

function revealPassword(id) {
  const a = find(id);
  if (!a?.passwordEnc) throw new Error('No password saved for this account');
  return secure.decrypt(a.passwordEnc);
}

async function refresh(id) {
  const a = find(id);
  if (!a) throw new Error('Account not found');
  try {
    const user = await roblox.getAuthenticatedUser(secure.decrypt(a.cookieEnc));
    Object.assign(a, { username: user.name, displayName: user.displayName, status: 'valid', statusMessage: '', checkedAt: Date.now() });
  } catch (err) {
    a.status = err.code === 'INVALID' ? 'expired' : 'error';
    a.statusMessage = err.message;
  }
  save();
  return publicView(a);
}

async function refreshAll() {
  const ids = list().map(a => a.id);
  for (const id of ids) { await refresh(id); await new Promise(r => setTimeout(r, 300)); }
  try {
    const shots = await roblox.getHeadshots(list().map(a => a.userId).filter(Boolean));
    list().forEach(a => { if (shots[a.userId]) a.avatarUrl = shots[a.userId]; });
    save();
  } catch { /* cosmetic */ }
  return getAll();
}

/** Robux balance, Premium status and friend count (shown on the account card). */
async function details(id) {
  const a = find(id);
  if (!a) throw new Error('Account not found');
  const cookie = secure.decrypt(a.cookieEnc);
  try {
    const [robux, premium, friendCount] = await Promise.all([roblox.getRobux(a.userId, cookie), roblox.getPremium(a.userId, cookie), roblox.getFriendCount(a.userId)]);
    Object.assign(a, { robux, premium, friendCount, detailsAt: Date.now() });
  } catch (err) {
    if (err.code === 'INVALID') { a.status = 'expired'; a.statusMessage = err.message; }
    else throw err;
  }
  save();
  return publicView(a);
}

async function detailsAll() {
  for (const a of list().filter(x => x.status !== 'expired')) { try { await details(a.id); } catch { /* keep going */ } await new Promise(r => setTimeout(r, 350)); }
  return getAll();
}

/** Re-fetches the headshot a few seconds after an outfit change (Roblox re-renders it). */
function refreshAvatar(id) {
  const a = find(id);
  if (!a) return;
  setTimeout(async () => { try { const s = await roblox.getHeadshots([a.userId]); if (s[a.userId]) { a.avatarUrl = s[a.userId]; save(); } } catch { /* cosmetic */ } }, 6000);
}

function setInbox(id, inbox) { const a = find(id); if (a) { a.inbox = inbox; save(); } }

function setHealth(id, health) {
  const a = find(id);
  if (!a) return;
  a.health = health || null;
  if (health?.state === 'expired') { a.status = 'expired'; a.statusMessage = health.detail; }
  else if (health?.state === 'ok') { a.status = 'valid'; a.statusMessage = ''; }
  save();
}

function markUsed(id) { const a = find(id); if (a) { a.lastUsedAt = Date.now(); save(); } }
function markExpired(id, message) { const a = find(id); if (a) { a.status = 'expired'; a.statusMessage = message; save(); } }

// ---------- Official login window ----------
const ROBLOX_HOST = /^https:\/\/([a-z0-9-]+\.)*roblox\.com(\/|$)/i;

/** Opens a sandboxed window on the real roblox.com login page, in a throwaway
 *  session. When the user finishes logging in, Roblox sets .ROBLOSECURITY on
 *  that session; we pick it up, save it encrypted, then wipe the session. */
function openRobloxWindow({ url, title, onLoaded, extra }) {
  return new Promise((resolve, reject) => {
    if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return reject(new Error('A Roblox sign-in window is already open.')); }
    const partition = `mm-login-${crypto.randomUUID()}`;
    const ses = session.fromPartition(partition, { cache: false });
    let done = false;
    loginWin = new BrowserWindow({
      width: 1000, height: 760, title, backgroundColor: '#0b0612', autoHideMenuBar: true,
      webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const win = loginWin;
    win.webContents.setWindowOpenHandler(({ url: u }) => (ROBLOX_HOST.test(u) ? { action: 'allow' } : { action: 'deny' }));
    win.webContents.on('will-navigate', (e, u) => { if (!ROBLOX_HOST.test(u)) e.preventDefault(); });
    if (onLoaded) win.webContents.on('did-finish-load', () => onLoaded(win).catch(() => {}));

    const finish = async (cookie) => {
      if (done) return;
      done = true;
      try { resolve(await upsertFromCookie(cookie, extra || {})); } catch (err) { reject(err); }
      finally {
        ses.cookies.removeListener('changed', onCookie);
        if (!win.isDestroyed()) win.close();
      }
    };
    const onCookie = (_e, c, _cause, removed) => {
      if (!removed && c.name === '.ROBLOSECURITY' && roblox.looksLikeCookie(c.value)) finish(c.value);
    };
    ses.cookies.on('changed', onCookie);
    win.on('closed', () => {
      loginWin = null;
      ses.clearStorageData().catch(() => {});
      if (!done) { done = true; reject(Object.assign(new Error('Sign-in window was closed.'), { code: 'CANCELLED' })); }
    });
    win.loadURL(url);
  });
}

/** Types the username into Roblox's own login form (the user still enters the password themselves). */
function fillUsername(username) {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username || '')) return null;
  return async (win) => {
    const js = `(() => { let n = 0; const go = () => { const el = document.querySelector('#login-username, input[name="username"]');
      if (el && !el.value) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(username)}); el.dispatchEvent(new Event('input', { bubbles: true })); return; }
      if (++n < 20) setTimeout(go, 250); }; go(); })()`;
    await win.webContents.executeJavaScript(js, true);
  };
}

function loginWithBrowser(opts = {}) {
  return openRobloxWindow({ url: 'https://www.roblox.com/login', title: 'MultiMenu — Sign in to Roblox', extra: opts, onLoaded: fillUsername(opts.username) });
}

// ---------- Accounts waiting to be signed in (from an import) ----------
const pending = () => store.get('pending');
// Never let a saved password leave the main process: expose only whether one is set.
function pendingList() { return pending().map(({ passwordEnc, ...rest }) => ({ ...rest, hasPassword: !!passwordEnc })); }
function addPending(entries) {
  const have = new Set([...list().map(a => String(a.username).toLowerCase()), ...pending().map(p => p.username.toLowerCase())]);
  let added = 0, skipped = 0;
  for (const e of entries) {
    const key = e.username.toLowerCase();
    if (have.has(key)) { skipped++; continue; }
    have.add(key);
    const entry = { id: crypto.randomUUID(), username: e.username, userId: e.userId || null, displayName: e.displayName || '', alias: e.alias || '', group: e.group || '', notes: e.notes || '', source: e.source || 'import', addedAt: Date.now() };
    // Encrypt the password at rest with Windows DPAPI, exactly like a saved login. If encryption fails, the account is still added without it.
    if (e.password) { try { entry.passwordEnc = secure.encrypt(String(e.password)); } catch { /* keep the account, drop the password */ } }
    pending().push(entry);
    added++;
  }
  save();
  return { added, skipped };
}

/**
 * Parses a pasted list of accounts for bulk import. One account per line:
 *   username              username:password              username,password,alias,group
 * Separators accepted are a colon, a comma, a tab or spaces; with a colon the whole
 * rest of the line is the password (so passwords may contain commas or spaces).
 * Lines starting with # or // are ignored. Usernames must be valid Roblox names.
 */
function parsePendingText(text, { group = '' } = {}) {
  if (typeof text !== 'string') throw new Error('Nothing to add.');
  if (text.length > 500_000) throw new Error('That list is too large.');
  const USER = /^[A-Za-z0-9_]{3,20}$/;
  const defaultGroup = String(group || '').slice(0, 30);
  const entries = [];
  const seen = new Set();
  let invalid = 0, duplicates = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const m = /^(\S+?)\s*([:,\t ])\s*(.*)$/.exec(line);
    const username = (m ? m[1] : line).trim();
    const sep = m ? m[2].trim() || ' ' : '';
    let password = '', alias = '', grp = defaultGroup;
    if (m) {
      const rest = m[3].trim();
      if (sep === ',') { const parts = rest.split(',').map(s => s.trim()); [password, alias] = [parts[0] || '', (parts[1] || '').slice(0, 40)]; if (parts[2]) grp = parts[2].slice(0, 30); }
      else password = rest; // colon, tab or space: the rest is the password, untouched
    }
    if (!USER.test(username)) { invalid++; continue; }
    const key = username.toLowerCase();
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    entries.push({ username, password, alias, group: grp, source: 'bulk' });
    if (entries.length >= 200) break;
  }
  if (!entries.length) throw new Error('No valid usernames found. Roblox usernames are 3–20 letters, numbers or underscores — one account per line, e.g. name:password.');
  return { entries, invalid, duplicates };
}

function revealPendingPassword(id) {
  const p = pending().find(x => x.id === id);
  if (!p?.passwordEnc) throw new Error('No password saved for this account');
  return secure.decrypt(p.passwordEnc);
}
function removePending(id) {
  const i = pending().findIndex(p => p.id === id);
  if (i >= 0) { pending().splice(i, 1); save(); }
  return pendingList();
}
async function loginPending(id) {
  const p = pending().find(x => x.id === id);
  if (!p) throw new Error('That account is no longer waiting to be signed in.');
  // Carry the bulk-imported password onto the finished account (stored encrypted). It is
  // never typed into or submitted on the Roblox page - the user does that themselves.
  let password = '';
  if (p.passwordEnc) { try { password = secure.decrypt(p.passwordEnc); } catch { /* unreadable on this PC: sign in without it */ } }
  const acc = await loginWithBrowser({ username: p.username, password, alias: p.alias, group: p.group, notes: p.notes });
  if (String(acc.username).toLowerCase() === p.username.toLowerCase()) removePending(id);
  else bus.emit('notify', { level: 'warn', title: 'Signed in as a different account', message: `You signed in as ${acc.username}, not ${p.username}. Both are kept.` });
  return acc;
}

function raw() { return { accounts: list(), groups: store.get('groups') }; }

module.exports = {
  exportList, EXPORT_COLUMNS,
  raw, TIERS, tierRank, cleanTags, setSlot, autoSlots, binList, restore, purge, emptyBin, pruneBin, filters, saveFilter, removeFilter, cleanQuery, matches, allTags, resolve, byTier,
  init, getAll, getCookie, importCookie, importFile, parseImportFile, update, bulkUpdate, reorder, remove,
  addGroup, renameGroup, deleteGroup, revealPassword, refresh, refreshAll, markUsed, markExpired,
  loginWithBrowser, openRobloxWindow, pendingList, addPending, parsePendingText, revealPendingPassword, removePending, loginPending, find, publicView, details, detailsAll, setHealth, refreshAvatar, setInbox, COLORS,
};
