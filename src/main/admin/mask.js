'use strict';
// Hides secrets before admin tools show or save anything. Encrypted values,
// cookies, tokens, webhook links, PINs and private server codes never leave as
// they are, and file paths lose the Windows user name.
const os = require('os');
const { redact } = require('../logger');

const HIDE = '‹hidden›';
// Field names that hold secrets. A plain "...key" field only counts when its
// value is long (so antiAfk.key = "Space" stays readable).
const SECRET_NAME = /(enc|token|secret|password|passwd|passcode|pin|pinhash|pinsalt|cookie|cookies|ticket|apikey|privatekey|credential|credentials|webhook|webhookurl|linkcode|accesscode|privateserver|topic|chatid|salt|hash|signature|auth|authorization|smtp)$/i;
const KEY_NAME = /key$/i;
const SECRET_VALUE = [
  /^enc:v\d+:/, // DPAPI-encrypted value
  /_\|WARNING:-DO-NOT-SHARE-THIS/i, // .ROBLOSECURITY cookie
  /\.ROBLOSECURITY/i,
  /discord(app)?\.com\/api\/webhooks\//i,
  /^\d{6,12}:[\w-]{30,}$/, // Telegram bot token
  /^(gh[pousr]_|github_pat_)[\w]{20,}/, // GitHub token
  /^[A-Za-z0-9+/_-]{40,}={0,2}$/, // long opaque token
  /[?&](privateServerLinkCode|linkCode|code|token|key|sig)=/i,
];

function secretValue(s) { return SECRET_VALUE.some(r => r.test(s)); }

let homeRe = null, userRe = null;
function pathRes() {
  if (homeRe !== null) return;
  try {
    const home = os.homedir();
    homeRe = home ? new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : false;
    const user = os.userInfo().username;
    userRe = user && user.length > 1 ? new RegExp(`([\\\\/])${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\\\/])`, 'gi') : false;
  } catch { homeRe = false; userRe = false; }
}

/** Replaces the home folder and the Windows user name in a path or message. */
function anonymize(s) {
  if (typeof s !== 'string') return s;
  pathRes();
  let out = s;
  if (homeRe) out = out.replace(homeRe, '%USERPROFILE%');
  if (userRe) out = out.replace(userRe, '$1%USERNAME%$2');
  return out;
}

/** A string as admin tools may show it. */
function maskString(s, { paths = true } = {}) {
  if (typeof s !== 'string') return s;
  if (secretValue(s)) return HIDE;
  const r = redact(s);
  return paths ? anonymize(r) : r;
}

function hiddenOf(v) {
  if (Array.isArray(v)) return `‹hidden: ${v.length} item${v.length === 1 ? '' : 's'}›`;
  if (v && typeof v === 'object') { const n = Object.keys(v).length; return `‹hidden: ${n} field${n === 1 ? '' : 's'}›`; }
  return HIDE;
}

function isSecretField(name, v) {
  if (typeof name !== 'string') return false;
  if (SECRET_NAME.test(name)) return true;
  return KEY_NAME.test(name) && typeof v === 'string' && v.length >= 16;
}

/** Deep copy of a value with every secret replaced. Booleans and null stay (hasPin: true is fine). */
function mask(value, opts = {}, depth = 0, name = '') {
  if (depth > 40) return '‹too deep›';
  if (value == null || typeof value === 'boolean') return value;
  if (name && isSecretField(name, value)) return value === '' ? '' : hiddenOf(value);
  if (typeof value === 'string') return maskString(value, opts);
  if (typeof value === 'number' || typeof value === 'bigint') return typeof value === 'bigint' ? String(value) : value;
  if (Array.isArray(value)) return value.map(v => mask(v, opts, depth + 1, ''));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = mask(v, opts, depth + 1, k);
    return out;
  }
  return String(value);
}

/** One-line preview of any value: masked, then cut to n characters. */
function preview(value, n = 240) {
  let s;
  try { s = typeof value === 'string' ? maskString(value) : JSON.stringify(mask(value)); } catch { s = String(value); }
  if (s === undefined) s = '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * A short, masked description of any value that stops building once it reaches
 * max characters (so a big event payload, like a screenshot, costs almost nothing).
 */
function brief(value, max = 300) {
  let out = '';
  const full = () => out.length >= max;
  const walk = (v, depth, name) => {
    if (full()) return;
    if (name && v != null && typeof v !== 'boolean' && v !== '' && isSecretField(name, v)) { out += JSON.stringify(hiddenOf(v)); return; }
    if (v === undefined) { out += 'undefined'; return; }
    if (v === null || typeof v === 'boolean' || typeof v === 'number') { out += String(v); return; }
    if (typeof v === 'string') {
      const cut = v.length > 120 ? `${v.slice(0, 120)}…` : v;
      out += JSON.stringify(maskString(cut));
      return;
    }
    if (typeof v !== 'object') { out += JSON.stringify(String(v)); return; }
    if (depth > 4) { out += Array.isArray(v) ? '[…]' : '{…}'; return; }
    if (Array.isArray(v)) {
      out += '[';
      for (let i = 0; i < v.length; i++) { if (full()) { out += '…'; break; } if (i) out += ','; walk(v[i], depth + 1, ''); }
      out += ']';
      return;
    }
    out += '{';
    let i = 0;
    for (const k of Object.keys(v)) {
      if (full()) { out += '…'; break; }
      if (i++) out += ',';
      out += `${JSON.stringify(k)}:`;
      walk(v[k], depth + 1, k);
    }
    out += '}';
  };
  try { walk(value, 0, ''); } catch { out += '…'; }
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

/**
 * A URL as the network log keeps it: method-free, no query, no fragment, and any
 * path piece that could be a token (long, mixed letters and digits, or with a ':')
 * replaced by "…". Discord webhook ids and Telegram bot tokens never survive.
 */
function safeUrl(u) {
  let url;
  try { url = new URL(String(u)); } catch { return { host: '?', path: '?' }; }
  const parts = url.pathname.split('/').map((seg) => {
    if (!seg) return seg;
    let d = seg;
    try { d = decodeURIComponent(seg); } catch { /* keep raw */ }
    if (/^\d{1,12}$/.test(d)) return d;
    if (!/^[\w.-]{1,40}$/.test(d)) return '…';
    const digits = /\d/.test(d), letters = /[a-z]/i.test(d);
    if (digits && letters && d.length >= 12) return '…';
    if (/^[0-9a-f-]{20,}$/i.test(d)) return '…';
    return d;
  });
  let path = parts.join('/');
  if (/webhooks/i.test(path)) path = path.replace(/(webhooks)\/.*/i, '$1/…');
  return { host: url.host, path: path.length > 120 ? `${path.slice(0, 120)}…` : path };
}

module.exports = { mask, maskString, preview, brief, anonymize, safeUrl, isSecretField, HIDE };
