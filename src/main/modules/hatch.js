'use strict';
// Hatch alerts and a hatch counter: tells you (Discord ping, bot DM, phone, voice) when
// one of your accounts hatches a rare pet, and counts them per account. Roblox games have
// no public hatch API, so this watches what MultiMenu can legitimately see, without
// touching the game:
//   - Game messages: what the game writes to each client's Roblox log (print/warn).
//   - Badges: Roblox's public badge API, for games that award a badge per rare pet.
//   - Screen: Windows' own text recognition on each Roblox window (for example a
//     "You hatched a Secret!" banner).
// Works with any game: add its place ID, the words it shows and the pet names on the
// Hatch alerts page.
const crypto = require('crypto');
const settings = require('./settings');
const sessions = require('./sessions');
const bus = require('../bus');
const paths = require('../paths');
const { JsonStore } = require('../store');
const log = require('../logger').scope('hatch');

const OUTPUT_LINE = /\[FLog::(Output|Warning)\]\s?(.*)$/;
const LOADING_GRACE_MS = 45_000; // ignore what a game prints while it loads (owned pets, etc.)
const PET_DEDUPE_MS = 10 * 60_000;

let store = null;
/** The hatch list (hatch.json), opened on first use. */
const db = () => store || (store = new JsonStore(paths.file('hatch.json'), { log: [], counts: {}, badges: {} }));
let badgeTimer = null;
const screenSeen = new Map(); // sessionId -> Set of keys seen on screen last time
const joinedAt = new Map(); // sessionId -> time the client joined
const recent = new Map(); // `${accountId}|${pet}` -> time
const lastAlert = new Map(); // accountId -> time
const unrevealed = new Map(); // accountId -> time of an alert that had no pet name yet
const state = { outputLines: 0, outputMatches: 0, badgeCheckedAt: null, badgeError: null, universe: {} };

const cfg = () => settings.get('hatch');
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- matching ----------
// Text read off the screen has small mistakes ("somethina special", a line break in the
// middle), so longer names and phrases also match with about one wrong letter in eight.
const flat = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) { const tmp = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return row[b.length];
}
function has(text, phrase, ftext = flat(text)) {
  const p = String(phrase || '').trim();
  if (p.length < 3) return false;
  if (new RegExp(`(^|[^a-z])${esc(p)}s?([^a-z]|$)`, 'i').test(text)) return true;
  const f = flat(p);
  if (f.length < 8) return false;
  if (` ${ftext} `.includes(` ${f} `)) return true;
  const allow = Math.floor(f.length / 8);
  const words = ftext.split(' ');
  const n = f.split(' ').length;
  for (let i = 0; i < words.length; i++) {
    const piece = words.slice(i, i + n).join(' ');
    if (Math.abs(piece.length - f.length) <= allow && distance(piece, f) <= allow) return true;
  }
  return false;
}

/** What a piece of text says: { pet, rarity, words } or null when it isn't about a rare hatch. */
function match(text, c = cfg()) {
  const t = String(text || '');
  if (!t.trim()) return null;
  const ft = flat(t);
  let pet = null;
  for (const p of c.pets || []) {
    const name = String(p).trim();
    if (has(t, name, ft)) { pet = name; break; }
  }
  const words = (c.words || []).filter(w => has(t, w, ft));
  if (!pet && !words.length) return null;
  const r = /secret\s*(iii|ii|i|3|2|1)\b/i.exec(t);
  const rarity = r ? `Secret ${({ 1: 'I', 2: 'II', 3: 'III' })[r[1]] || r[1].toUpperCase()}` : /secret/i.test(t) ? 'Secret' : null;
  return { pet, rarity, words };
}

/** Names this account goes by (username and display name), lower case. */
function namesOf(session) {
  let a = null;
  try { a = (require('./accounts').getAll().accounts || []).find(x => x.id === session?.accountId); } catch { /* accounts not loaded */ }
  return [a?.username, a?.displayName, a?.alias, session?.label].filter(Boolean).map(n => String(n).toLowerCase());
}

/**
 * Games often announce everyone's rare hatches to the whole server ("Bob hatched Anubis!").
 * True when a line says someone else hatched it, so your accounts don't get pinged for
 * other players' luck. Lines that don't name anyone count as yours.
 */
function someoneElse(text, session) {
  const m = /(?:^|[\s:\]>])@?([A-Za-z0-9_]{3,20})\s+(?:has\s+(?:just\s+)?|just\s+)?hatched\b/i.exec(String(text || ''));
  if (!m) return false;
  const who = m[1].toLowerCase();
  if (['you', 'youve', 've', 'i', 'we', 'player', 'someone', 'just'].includes(who)) return false;
  const names = namesOf(session);
  return names.length > 0 && !names.includes(who);
}

/** True when this client is in one of the watched games (or no game list is set). */
function inWatchedGame(s, c = cfg()) {
  const places = (c.places || []).filter(Boolean);
  return !places.length || places.includes(String(s.placeId || ''));
}

// ---------- the alert ----------
async function fire({ session, accountId, label, username, pet, rarity, source, text, test = false }) {
  const c = cfg();
  const now = Date.now();
  const acc = accountId || session?.accountId || 'test';
  const key = `${acc}|${(pet || rarity || 'secret').toLowerCase()}`;
  if (!test) {
    if (recent.has(key) && now - recent.get(key) < PET_DEDUPE_MS) return null;
    const reveal = pet && unrevealed.has(acc) && now - unrevealed.get(acc) < 10 * 60_000; // the name after "Hold to Reveal"
    if (!reveal && lastAlert.has(acc) && now - lastAlert.get(acc) < Math.max(0, c.cooldownSec) * 1000) return null;
  }
  if (pet) unrevealed.delete(acc); else unrevealed.set(acc, now);
  recent.set(key, now);
  lastAlert.set(acc, now);
  const who = label || session?.label || username || 'An account';
  let image = null, shot = null;
  if (c.screenshot && session?.pid) {
    try {
      const capture = require('./capture');
      image = await capture.captureWindowOfPid(session.pid, 1280);
      if (image) shot = capture.save(image, `secret-${who}`);
    } catch (e) { log.warn(`screenshot failed: ${e.message}`); }
  }
  const entry = { id: crypto.randomUUID(), at: now, accountId: acc, label: who, pet: pet || null, rarity: rarity || null, source, text: String(text || '').slice(0, 300), shot, placeId: session?.placeId || null, test };
  if (!test) {
    const list = db().get('log');
    list.unshift(entry);
    if (list.length > 300) list.length = 300;
    const counts = db().get('counts');
    counts[acc] = { label: who, n: (counts[acc]?.n || 0) + 1, last: now };
    db().saveSoon();
  }
  const what = pet ? `${pet}${rarity ? ` (${rarity})` : ''}` : 'a secret pet (not revealed yet)';
  log.info(`${test ? '[TEST] ' : ''}${who} hatched ${what} (seen in ${source})`);
  bus.emit('hatch:new', entry);
  const mention = normaliseMention(c.ping);
  bus.emit('event', {
    type: 'secretHatched', account: who, placeId: session?.placeId || undefined,
    detail: `${test ? '[TEST] ' : ''}${who} hatched ${what}!`, image, mention, test, pet, rarity,
    fields: [{ name: 'Seen in', value: SOURCE_NAMES[source] || source, inline: true }, ...(entry.text ? [{ name: 'Text', value: entry.text.slice(0, 200) }] : [])],
  });
  if (c.dm) {
    try { await require('./remote').dm(`🥚 **${test ? '[TEST] ' : ''}${who} hatched ${what}!**`, image); } catch (e) { log.warn(`bot DM failed: ${e.message}`); }
  }
  return entry;
}

const SOURCE_NAMES = { output: 'Game messages', badge: 'Badges', screen: 'Screen', test: 'Test' };

function normaliseMention(v) {
  const s = String(v || '').trim();
  if (/^\d{15,22}$/.test(s)) return `<@${s}>`;
  if (/^<@[&!]?\d{15,22}>$/.test(s)) return s;
  return '';
}

// ---------- source 1: game messages (Roblox log) ----------
/** Called by the watcher with every new log line of a running client. */
function onLogLines({ session, lines }) {
  const c = cfg();
  if (!c.enabled || !c.sources.output || !session || !inWatchedGame(session, c)) return;
  const since = joinedAt.get(session.id);
  if (!since || Date.now() - since < LOADING_GRACE_MS) return;
  for (const line of lines) {
    const m = OUTPUT_LINE.exec(line);
    if (!m) continue;
    state.outputLines++;
    const msg = m[2];
    const hit = match(msg, c);
    if (!hit || someoneElse(msg, session)) continue;
    state.outputMatches++;
    fire({ session, pet: hit.pet, rarity: hit.rarity, source: 'output', text: msg }).catch(e => log.warn(e.message));
  }
}

/** The game's own messages from one client's log (for checking what a game writes). */
function outputTail(sessionId, max = 150) {
  const s = sessions.getRaw(sessionId);
  if (!s?.logFile) throw new Error('MultiMenu has not found this client\'s Roblox log yet. Give it a minute after the game loads.');
  const lines = require('./robloxlogs').tail(s.logFile, 4000);
  return lines.map(l => OUTPUT_LINE.exec(l)).filter(Boolean).map(m => ({ kind: m[1], text: m[2].slice(0, 500), match: !!match(m[2]), other: !!match(m[2]) && someoneElse(m[2], s) })).slice(-max);
}

// ---------- source 2: badges ----------
async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'MultiMenu' }, signal: AbortSignal.timeout(15000) });
  if (res.status === 429) throw new Error('Roblox is rate limiting badge checks; trying again later.');
  if (!res.ok) throw new Error(`Roblox returned HTTP ${res.status}`);
  return res.json();
}

async function universeOf(placeId) {
  if (state.universe[placeId]) return state.universe[placeId];
  const j = await getJson(`https://apis.roblox.com/universes/v1/places/${encodeURIComponent(placeId)}/universe`);
  if (!j?.universeId) throw new Error('Roblox did not find that game.');
  state.universe[placeId] = j.universeId;
  return j.universeId;
}

/** Every badge a game has, marking the ones that look like hatch badges. */
async function gameBadges(placeId = (cfg().places || [])[0]) {
  if (!placeId) throw new Error('Add a game to watch first (its place ID).');
  if (!/^\d{1,15}$/.test(String(placeId))) throw new Error('Add the game first (its place ID).');
  const uni = await universeOf(placeId);
  const out = [];
  let cursor = '';
  for (let page = 0; page < 6; page++) {
    const j = await getJson(`https://badges.roblox.com/v1/universes/${uni}/badges?limit=100&sortOrder=Asc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const b of j.data || []) {
      const text = `${b.name} ${b.description || ''}`;
      out.push({ id: String(b.id), name: b.name, description: String(b.description || '').slice(0, 200), enabled: b.enabled !== false, awarded: b.statistics?.awardedCount ?? null, looksLikeHatch: /secret|hatch/i.test(text) || !!match(text) });
    }
    cursor = j.nextPageCursor;
    if (!cursor) break;
  }
  return { placeId: String(placeId), universeId: uni, badges: out, chosen: cfg().badgeIds || [] };
}

async function checkBadges() {
  const c = cfg();
  if (!c.enabled || !c.sources.badges || !(c.badgeIds || []).length) return;
  const accounts = require('./accounts');
  const ids = c.badgeIds.slice(0, 100);
  // Accounts playing a watched game now (they can only hatch while in the game).
  const playing = sessions.allRaw().filter(s => s.status === 'running' && inWatchedGame(s, c));
  const seen = db().get('badges');
  let names = null;
  for (const s of playing) {
    const a = accounts.getAll().find(x => x.id === s.accountId);
    if (!a?.userId) continue;
    try {
      const j = await getJson(`https://badges.roblox.com/v1/users/${a.userId}/badges/awarded-dates?badgeIds=${ids.join(',')}`);
      const had = seen[a.userId];
      const now = (j.data || []).map(d => String(d.badgeId));
      if (!had) { seen[a.userId] = now; db().saveSoon(); continue; } // first look: just remember what they already have
      for (const d of j.data || []) {
        const id = String(d.badgeId);
        if (had.includes(id)) continue;
        had.push(id);
        db().saveSoon();
        if (Date.now() - Date.parse(d.awardedDate) > 24 * 3600_000) continue;
        if (!names) { try { names = Object.fromEntries((await gameBadges(s.placeId || c.places[0])).badges.map(b => [b.id, b.name])); } catch { names = {}; } }
        const name = names[id] || `Badge ${id}`;
        const hit = match(name, c);
        await fire({ session: s, pet: hit?.pet || name.replace(/^(you\s+)?(hatched|hatch)\s+(an?\s+)?/i, '').trim(), rarity: hit?.rarity || null, source: 'badge', text: name });
      }
      state.badgeError = null;
    } catch (e) { state.badgeError = e.message; }
    await new Promise(r => setTimeout(r, 400)); // be gentle with Roblox
  }
  state.badgeCheckedAt = Date.now();
}

// ---------- source 3: screen reading (screenwatch.js reads the windows) ----------
/** Looks at what is on one window's screen now and alerts when a hatch pop-up appears. */
async function checkScreenText(s, text, c) {
  const keys = new Set();
  const mine = text.split('\n').filter(l => !someoneElse(l, s)).join('\n');
  for (const p of c.pets || []) if (match(mine, { pets: [p], words: [] })) keys.add(`p:${p}`);
  for (const w of c.words || []) if (match(mine, { pets: [], words: [w] })) keys.add(`w:${w}`);
  const before = screenSeen.get(s.id);
  screenSeen.set(s.id, keys);
  if (!before) return; // first look at this window: remember what is already on screen
  if (![...keys].some(k => !before.has(k))) return;
  const hit = match(mine, c);
  await fire({ session: s, pet: hit?.pet || null, rarity: hit?.rarity || null, source: 'screen', text: mine.split('\n').filter(l => match(l, c)).join(' · ').slice(0, 200) });
}

/** Reads one window now and says what it found (for the "Test on a window" button). */
async function testScreen(sessionId) {
  const s = sessions.getRaw(sessionId);
  if (!s?.pid) throw new Error('That client is not running.');
  const r = await require('./screenwatch').readOne(s);
  const min = settings.get('screen.minWidth');
  if (r.skipped === 'small') return { ...r, message: `The window is ${r.width} px wide. Screen reading needs at least ${min} px; tiny windows are too small to read.` };
  if (r.skipped === 'minimised') return { ...r, message: 'The window is minimised, so there is nothing to read.' };
  if (r.skipped) return { ...r, message: 'Windows did not give MultiMenu a picture of that window.' };
  return { ...r, match: match(r.text) };
}

// ---------- lifecycle ----------
function reschedule() {
  clearInterval(badgeTimer); badgeTimer = null;
  require('./screenwatch').reschedule();
  const c = cfg();
  if (!c.enabled) return;
  if (c.sources.badges && (c.badgeIds || []).length) badgeTimer = setInterval(() => { checkBadges().catch(() => {}); }, Math.max(30, c.badgeEverySec) * 1000);
}

function init() {
  db();
  require('./screenwatch').use({
    name: 'hatch', active: () => cfg().enabled && cfg().sources.screen,
    wants: (sess) => inWatchedGame(sess), onRead: (sess, read) => checkScreenText(sess, read.text, cfg()),
  });
  bus.on('robloxlog:lines', onLogLines);
  bus.on('session:joined', ({ id }) => { joinedAt.set(id, Date.now()); screenSeen.delete(id); });
  bus.on('sessions:changed', () => {
    for (const id of joinedAt.keys()) if (!sessions.getRaw(id)) { joinedAt.delete(id); screenSeen.delete(id); }
  });
  reschedule();
}

function stop() { clearInterval(badgeTimer); }

function status() {
  const c = cfg();
  const running = sessions.allRaw().filter(s => s.status === 'running');
  const inGame = running.filter(s => inWatchedGame(s, c));
  return {
    enabled: c.enabled, watching: inGame.length, running: running.length, ...state, ...screenState(), ocr: require('./ocr').status(),
    bot: require('./remote').canDm(), discord: discordState(), log: db().get('log').slice(0, 60),
    counts: Object.entries(db().get('counts')).map(([id, v]) => ({ accountId: id, ...v })).sort((a, b) => b.n - a.n),
    sessions: running.map(s => ({ id: s.id, label: s.label, pid: s.pid, placeId: s.placeId || null, placeName: s.placeName || null, hasLog: !!s.logFile, inGame: inWatchedGame(s, c) })),
  };
}

function screenState() {
  const w = require('./screenwatch').status();
  return { screenChecked: w.checked, screenSkipped: w.skipped, screenError: w.error };
}

function discordState() {
  const d = settings.get('discord');
  let hooks = 0;
  try { hooks = require('./webhooks').rawHooks().filter(h => h.enabled).length; } catch { /* not loaded */ }
  return { enabled: !!d.enabled, hooks, event: d.events.secretHatched !== false };
}

function clearLog() { db().set('log', []); db().set('counts', {}); return status(); }
function test() { return fire({ label: 'Test account', pet: (cfg().pets || [])[0] || 'Secret pet', rarity: 'Secret I', source: 'test', text: 'This is a test alert from MultiMenu.', test: true }); }

module.exports = { textHas: has, _checkScreenText: checkScreenText, _unrevealed: unrevealed, init, stop, reschedule, status, match, someoneElse, inWatchedGame, onLogLines, outputTail, gameBadges, checkBadges, testScreen, clearLog, test, normaliseMention, _fire: fire, _joinedAt: joinedAt };
