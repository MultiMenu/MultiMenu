'use strict';
// Share codes: a preset, window layout, theme, automation or game profile as one
// line of text you can paste into Discord. Format: MM2-<kind>-<data>-<check>.
// <data> is the item's settings as JSON, compressed and base64url-encoded, and
// <check> is a CRC-32 so a code that was cut off or mistyped is caught.
//
// Only the fields listed in CLEAN below go into a code: never accounts, cookies,
// passwords, webhooks, API keys or private server links. A code that still looks
// like it carries a secret is refused, both when it is made and when it is read.
// Codes are plain settings: reading one never runs anything by itself.
const zlib = require('zlib');
const bus = require('../bus');

const KINDS = ['preset', 'layout', 'theme', 'rule', 'game'];
const MAX_CODE = 8000; // characters
const MAX_JSON = 20000; // bytes once unpacked
const LAYOUTS = ['auto', 'columns', 'rows', 'grid2', 'grid3', 'grid4', 'main', 'cascade', 'fixed'];
const CAPS = [30, 60, 75, 120, 144, 165, 240, -1];

// Things that must never travel in a share code.
const SECRET = [
  /_\|WARNING:-DO-NOT-SHARE-THIS/i, /ROBLOSECURITY/i, // Roblox sign-in cookie
  /discord(?:app)?\.com\/api\/webhooks\//i, // Discord webhook
  /\b[MNO][\w-]{23,27}\.[\w-]{6}\.[\w-]{27,}/, // Discord bot token
  /\b\d{8,10}:[\w-]{35}\b/, // Telegram bot token
  /\bmm_[\w-]{30,}/, // MultiMenu API key
  /\benc:v1:/, /\bBearer\s+[\w.~+/-]{16,}/i, // stored secrets, sign-ins
  /privateServerLinkCode|[?&](?:code|linkCode)=/i, // private server links
  /\b[a-f\d]{40,}\b/i, // long hex: tokens, hashes
];

/** Pure: true when the text looks like it holds a secret. */
const hasSecret = (text) => SECRET.some(re => re.test(String(text || '')));

// ---------- CRC-32 ----------
const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
/** Pure: CRC-32 of a string, as 7 base-36 characters. */
function crc(str) {
  let c = -1;
  for (const b of Buffer.from(String(str), 'utf8')) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return ((c ^ -1) >>> 0).toString(36).padStart(7, '0');
}

// ---------- cleaning: only these fields, as plain values ----------
const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');
const int = (v, lo, hi, d) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
const num = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
const pick = (v, list, d) => (list.includes(v) ? v : d);

/** A public game only: a place ID. Private server links, share links and exact servers are left out. */
function publicGame(v) {
  const s = text(v, 400);
  if (!s) return { game: '', dropped: '' };
  if (/^\d{1,15}$/.test(s)) return { game: s, dropped: '' };
  let t = null;
  try { t = require('./roblox').parseTarget(s); } catch { t = null; }
  if (!t) return { game: '', dropped: 'link' };
  if (t.shareCode) return { game: '', dropped: 'private' };
  if (t.linkCode) return { game: t.placeId || '', dropped: 'private' };
  return { game: t.placeId || '', dropped: t.jobId ? 'server' : '' };
}

const CLEAN = {
  preset(p = {}) {
    const g = p.graphics || {};
    const name = text(p.name, 50);
    if (!name) throw new Error('This preset has no name.');
    return {
      name, tag: text(p.tag, 24).toLowerCase(), game: publicGame(p.game).game,
      mode: pick(p.mode, ['default', 'sameServer'], 'default'), layout: pick(p.layout, ['', ...LAYOUTS], ''),
      tile: !!p.tile, watch: p.watch !== false, limiter: !!p.limiter, antiAfk: !!p.antiAfk,
      graphics: { enabled: !!g.enabled, quality: int(g.quality, 0, 10, 1), fpsCap: CAPS.includes(Number(g.fpsCap)) ? Number(g.fpsCap) : 60 },
      closeAfterHours: num(p.closeAfterHours, 0, 168, 0), accounts: int(p.accounts, 0, 100, 0),
    };
  },
  layout(l = {}) {
    return {
      name: text(l.name, 50), layout: pick(l.layout, [...LAYOUTS, 'custom'], 'auto'), gap: int(l.gap, 0, 40, 4), padding: int(l.padding, 0, 80, 0),
      // A layout you drew travels as its zones (fractions of the screen), never as an ID from this PC.
      ...(l.layout === 'custom' ? { zones: (() => { try { return require('./customlayouts').cleanZones(l.zones); } catch { return [{ x: 0, y: 0, w: 1, h: 1 }]; } })() } : {}),
      mainRatio: num(l.mainRatio, 0.3, 0.85, 0.62), cellWidth: int(l.cellWidth, 200, 7680, 800), cellHeight: int(l.cellHeight, 150, 4320, 600),
      centerLastRow: l.centerLastRow !== false,
    };
  },
  theme(t = {}) {
    const c = require('./themes').clean(t);
    // Background pictures and videos are files on your PC, so they never go in a code.
    if (['image', 'video'].includes(c.theme.bgType)) c.theme.bgType = 'gradient';
    return { name: text(t.name, 40), ...c };
  },
  rule(r = {}) {
    const v = require('./automations').validate({ ...r, enabled: false });
    return { name: v.name, trigger: v.trigger, conditions: v.conditions, actions: v.actions, cooldownSec: v.cooldownSec };
  },
  game(p = {}) {
    const v = require('./gameprofiles').validate(p);
    return { placeId: v.placeId, name: v.name, graphics: v.graphics, layout: v.layout, watcher: v.watcher };
  },
};

/** Pure-ish: packs already-cleaned data into a code. */
function pack(kind, data) {
  if (!KINDS.includes(kind)) throw new Error('That can\'t be shared.');
  const json = JSON.stringify({ v: 1, ...data });
  if (hasSecret(json)) throw new Error('This looks like it holds a login or secret, so no code was made.');
  if (Buffer.byteLength(json) > MAX_JSON) throw new Error('That is too big for a share code.');
  const body = `${kind}-${zlib.deflateRawSync(Buffer.from(json), { level: 9 }).toString('base64url')}`;
  const code = `MM2-${body}-${crc(body)}`;
  if (code.length > MAX_CODE) throw new Error('That is too big for a share code.');
  return code;
}

const FIND = /MM2-(preset|layout|theme|rule|game)-([A-Za-z0-9_-]{4,})-([0-9a-z]{7})(?![A-Za-z0-9_-])/;
/** Pure: the first share code inside some text (a Discord message, say), or null. */
function find(input) {
  const s = String(input || '').slice(0, 50000);
  const m = FIND.exec(s) || FIND.exec(s.replace(/\s+/g, ''));
  return m ? m[0] : null;
}

/** Reads a code: checks it, unpacks it and cleans it again. Throws a friendly error. */
function unpack(input) {
  const code = find(input);
  if (!code) throw new Error('That isn\'t a MultiMenu share code. They start with MM2-.');
  if (code.length > MAX_CODE) throw new Error('That code is too long.');
  const m = FIND.exec(code);
  const [, kind, data, check] = m;
  if (crc(`${kind}-${data}`) !== check) throw new Error('That code is incomplete or has a typo. Copy the whole code again.');
  let json;
  try { json = zlib.inflateRawSync(Buffer.from(data, 'base64url'), { maxOutputLength: MAX_JSON }).toString('utf8'); }
  catch { throw new Error('That code is damaged. Copy the whole code again.'); }
  if (hasSecret(json)) throw new Error('That code looks like it holds a login or secret, so it was not opened.');
  let obj;
  try { obj = JSON.parse(json); } catch { throw new Error('That code is damaged. Copy the whole code again.'); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('That code is damaged.');
  if (obj.v !== 1) throw new Error('That code is from a newer MultiMenu. Update MultiMenu to open it.');
  return { kind, code, data: CLEAN[kind](obj) };
}

// ---------- making codes from your own things ----------
function fromItem(kind, id, opts = {}) {
  const notes = [];
  if (kind === 'preset') {
    const p = require('./presets').get(String(id));
    if (!p) throw new Error('That preset is gone.');
    const pg = publicGame(p.game);
    if (pg.dropped === 'private') notes.push(pg.game ? 'The private server link was left out. The code opens the public game instead.' : 'The private server link was left out.');
    if (pg.dropped === 'server') notes.push('The exact server was left out: it opens the game, not that server.');
    if (!p.tag) notes.push('Accounts aren\'t included. Whoever imports it picks their own.');
    return { data: CLEAN.preset({ ...p, accounts: require('./presets').idsOf(p).length }), notes };
  }
  if (kind === 'layout') {
    const s = require('./settings');
    const t = s.get('tiling');
    const custom = require('./customlayouts').fromKey(t.layout);
    if (custom) return { data: CLEAN.layout({ ...t, layout: 'custom', zones: custom.zones, name: opts.name || custom.name }), notes };
    return { data: CLEAN.layout({ ...t, name: opts.name || require('./tiler').LAYOUTS[t.layout] || '' }), notes };
  }
  if (kind === 'theme') {
    const themes = require('./themes');
    const preset = themes.PRESETS[String(id)];
    const cur = themes.current();
    const src = preset || cur;
    const name = opts.name || preset?.label || (cur.theme.preset && themes.PRESETS[cur.theme.preset]?.label) || 'My theme';
    if (!preset && ['image', 'video'].includes(cur.theme.bgType)) notes.push('Your own background picture or video stays on this PC. The code uses the gradient instead.');
    return { data: CLEAN.theme({ ...src, name }), notes };
  }
  if (kind === 'rule') {
    const r = require('./automations').list().find(x => x.id === String(id));
    if (!r) throw new Error('That automation is gone.');
    return { data: CLEAN.rule(r), notes };
  }
  if (kind === 'game') {
    const g = require('./gameprofiles').forPlace(String(id));
    if (!g) throw new Error('That game has no profile yet. Save one first.');
    return { data: CLEAN.game(g), notes };
  }
  throw new Error('That can\'t be shared.');
}

/** Makes a code for one of your things. */
function create(kind, id, opts = {}) {
  const { data, notes } = fromItem(kind, id, opts);
  const code = pack(kind, data);
  bus.emit('share:created', { kind });
  return { kind, code, name: data.name || '', notes };
}

/** What a code holds, for the "import" preview. Changes nothing. */
function preview(input) {
  const { kind, code, data } = unpack(input);
  const out = { kind, code, name: data.name || '', data };
  if (kind === 'game') out.exists = !!require('./gameprofiles').forPlace(data.placeId);
  if (kind === 'preset' && data.tag) out.tagged = require('./accounts').resolve(`tag:${data.tag}`).length;
  return out;
}

function uniqueName(name, taken) {
  const base = name || 'Imported';
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i++) { const n = `${base} (${i})`.slice(0, 60); if (!taken.includes(n)) return n; }
  return `${base} (${Date.now() % 1000})`;
}

/** Brings a code in. Presets come back as a draft for the editor (you pick the accounts). */
async function importCode(input) {
  const { kind, data } = unpack(input);
  if (kind === 'preset') {
    const draft = { ...data };
    delete draft.accounts;
    draft.name = uniqueName(draft.name, require('./presets').list().map(p => p.name));
    return { kind, name: draft.name, draft: { ...draft, accountIds: [] } };
  }
  if (kind === 'layout') {
    const s = require('./settings');
    let layout = data.layout;
    if (layout === 'custom') layout = `custom:${require('./customlayouts').save({ name: data.name || 'Shared layout', zones: data.zones }).id}`;
    s.set('tiling', { ...s.get('tiling'), ...Object.fromEntries(['gap', 'padding', 'mainRatio', 'cellWidth', 'cellHeight', 'centerLastRow'].map(k => [k, data[k]])), layout });
    try { require('./layouts').remember(); } catch { /* not started */ }
    try { bus.emit('tiler:update', require('./tiler').preview()); } catch { /* no screen (tests) */ }
    return { kind, name: data.name };
  }
  if (kind === 'theme') {
    const themes = require('./themes');
    themes.apply(data, 'custom');
    bus.emit('theme:changed', themes.current());
    return { kind, name: data.name };
  }
  if (kind === 'rule') {
    const auto = require('./automations');
    // Imported automations start switched off, so nothing happens until you've looked at it.
    const name = uniqueName(data.name, auto.list().map(r => r.name));
    auto.save({ ...data, name, enabled: false });
    return { kind, name };
  }
  if (kind === 'game') {
    require('./gameprofiles').save(data);
    const servers = require('./servers');
    if (!servers.listGames().some(g => g.placeId === data.placeId && !g.private)) {
      try { await servers.addGame({ name: data.name, link: data.placeId }); } catch { /* the profile still works */ }
    }
    return { kind, name: data.name };
  }
  throw new Error('That can\'t be imported.');
}

module.exports = { KINDS, create, preview, importCode, pack, unpack, find, crc, hasSecret, CLEAN };
