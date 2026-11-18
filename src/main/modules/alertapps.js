'use strict';
// Alerts on your phone through Telegram, ntfy, Pushover or email. Each app has its
// own list of events. Bot tokens, app keys and email passwords are stored
// encrypted. A message only ever holds an account's name, the event and its
// details: never logins, cookies, passwords or tokens.
const crypto = require('crypto');
const { JsonStore } = require('../store');
const paths = require('../paths');
const secure = require('../secure');
const logger = require('../logger');
const log = logger.scope('alertapps');

const KINDS = ['telegram', 'ntfy', 'pushover', 'email'];
const DEFAULT_EVENTS = { accountCrashed: true, launchFailed: true, watcherGaveUp: true, loginWarning: true, accountHealth: true, robloxOutage: true, highUsage: false, memoryRestart: false, internetBack: false, achievement: false, secretHatched: true, privateServerExpiring: true, dataCap: true, freshRestart: false, robloxUpdate: false, robloxUpdateHeld: false, serverHop: false };
const URGENT = new Set(['accountCrashed', 'watcherGaveUp', 'robloxOutage', 'launchFailed', 'secretHatched']);
const EMAIL_PRESETS = {
  gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  yahoo: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
  icloud: { host: 'smtp.mail.me.com', port: 587, secure: false },
};

let store = null;
const recent = new Map();
function init() { store = new JsonStore(paths.file('alertapps.json'), { channels: [], history: [] }); return store; }
const channels = () => (store ? store.get('channels') : []);

// ---------- validation (pure) ----------
const RX = {
  telegramToken: /^\d{6,12}:[\w-]{30,60}$/, chatId: /^(-?\d{1,20}|@[A-Za-z]\w{4,31})$/, topic: /^[\w-]{1,64}$/,
  pushover: /^[A-Za-z0-9]{30}$/, host: /^[a-z0-9.-]{3,253}$/i, email: /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i,
};
function cleanConfig(kind, c = {}, keepSecrets = {}) {
  const s = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const sec = (k) => s(c[k], 300) || keepSecrets[k] || '';
  if (kind === 'telegram') {
    const token = sec('token'), chatId = s(c.chatId, 40);
    if (!RX.telegramToken.test(token)) throw new Error('That isn\'t a Telegram bot token. Get one from @BotFather: it looks like 123456789:AA…');
    if (chatId && !RX.chatId.test(chatId)) throw new Error('The chat ID is a number (or @channelname).');
    return { pub: { chatId }, secret: { token } };
  }
  if (kind === 'ntfy') {
    let server = s(c.server, 200) || 'https://ntfy.sh';
    if (!/^https?:\/\/[^\s/]+(:\d+)?\/?$/i.test(server)) throw new Error('The ntfy server must be an address like https://ntfy.sh');
    server = server.replace(/\/$/, '');
    if (/^http:/i.test(server) && !/^http:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(server)) throw new Error('Use https for an ntfy server outside your home network.');
    const topic = s(c.topic, 64);
    if (!RX.topic.test(topic)) throw new Error('The topic can use letters, numbers, - and _ (up to 64).');
    return { pub: { server, topic }, secret: { token: sec('token') } };
  }
  if (kind === 'pushover') {
    const appToken = sec('appToken'), userKey = sec('userKey');
    if (!RX.pushover.test(appToken) || !RX.pushover.test(userKey)) throw new Error('Pushover keys are 30 letters and numbers. Find them at pushover.net.');
    return { pub: {}, secret: { appToken, userKey } };
  }
  if (kind === 'email') {
    const host = s(c.host, 253).toLowerCase(), port = Math.round(Number(c.port));
    if (!RX.host.test(host)) throw new Error('Enter your email provider\'s SMTP server, like smtp.gmail.com.');
    if (!(port >= 1 && port <= 65535)) throw new Error('The port is a number like 465 or 587.');
    const user = s(c.user, 200), from = s(c.from, 200) || user;
    const to = s(c.to, 400).split(/[,;\s]+/).filter(Boolean);
    if (!to.length || to.length > 5 || !to.every(t => RX.email.test(t))) throw new Error('Send to one to five email addresses.');
    if (!RX.email.test(from)) throw new Error('The "from" address isn\'t an email address.');
    return { pub: { host, port, secure: c.secure === true || (c.secure !== false && port === 465), user, from, to: to.join(', ') }, secret: { pass: sec('pass') } };
  }
  throw new Error('Unknown app.');
}

/** What the list and the editor show: never the secrets themselves. */
function view(ch) {
  return { id: ch.id, kind: ch.kind, name: ch.name, enabled: ch.enabled, events: { ...ch.events }, config: { ...ch.config }, has: Object.fromEntries(Object.entries(ch.secretEnc || {}).map(([k, v]) => [k, !!v])) };
}
function list() { return channels().map(view); }

function save(input = {}) {
  const kind = KINDS.includes(input.kind) ? input.kind : null;
  if (!kind) throw new Error('Pick an app.');
  const ex = input.id && channels().find(c => c.id === input.id);
  const keep = ex ? Object.fromEntries(Object.entries(ex.secretEnc || {}).map(([k, v]) => [k, v ? secure.decrypt(v) : ''])) : {};
  const { pub, secret } = cleanConfig(kind, input.config || {}, keep);
  const events = { ...DEFAULT_EVENTS, ...(ex?.events || {}) };
  for (const [k, v] of Object.entries(input.events || {})) if (k in DEFAULT_EVENTS) events[k] = !!v;
  const ch = ex || { id: crypto.randomUUID(), kind, createdAt: Date.now() };
  Object.assign(ch, {
    kind, name: String(input.name || '').trim().slice(0, 40) || { telegram: 'Telegram', ntfy: 'ntfy', pushover: 'Pushover', email: 'Email' }[kind],
    enabled: input.enabled !== false, events, config: pub, secretEnc: Object.fromEntries(Object.entries(secret).map(([k, v]) => [k, v ? secure.encrypt(v) : null])),
  });
  if (!ex) channels().push(ch);
  store.saveSoon();
  return list();
}
function remove(id) { store.set('channels', channels().filter(c => c.id !== id)); return list(); }
function setEnabled(id, on) { const c = channels().find(x => x.id === id); if (c) { c.enabled = !!on; store.saveSoon(); } return list(); }

// ---------- messages (pure) ----------
const clean = (v, max) => (v == null || v === '' ? '' : logger.redact(String(v)).slice(0, max));
function message(evt) {
  const meta = (() => { try { return require('./webhooks').EVENTS[evt.type] || {}; } catch { return {}; } })();
  const title = clean(evt.title || meta.title || evt.type, 120);
  const lines = [];
  if (evt.account) lines.push(`${clean(evt.account, 80)}`);
  if (evt.detail) lines.push(clean(evt.detail, 900));
  if (evt.error) lines.push(clean(evt.error, 600));
  return { title, emoji: meta.emoji || '•', body: lines.join('\n') || title, urgent: URGENT.has(evt.type) };
}
const html = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---------- delivery ----------
async function deliver(ch, m) {
  const sec = (k) => (ch.secretEnc?.[k] ? secure.decrypt(ch.secretEnc[k]) : '');
  const timeout = AbortSignal.timeout(15000);
  if (ch.kind === 'telegram') {
    if (!ch.config.chatId) throw new Error('Add the chat ID first (Find my chat ID).');
    const r = await fetch(`https://api.telegram.org/bot${sec('token')}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: timeout, body: JSON.stringify({ chat_id: ch.config.chatId, text: `${m.emoji} <b>${html(m.title)}</b>\n${html(m.body)}`, parse_mode: 'HTML', disable_web_page_preview: true }) });
    if (!r.ok) throw new Error(r.status === 401 ? 'Telegram rejected the bot token.' : r.status === 400 ? 'Telegram couldn\'t find that chat. Message your bot first.' : `Telegram returned HTTP ${r.status}`);
    return;
  }
  if (ch.kind === 'ntfy') {
    const headers = { Title: m.title.replace(/[^\x20-\x7e]/g, ''), Priority: m.urgent ? 'high' : 'default', Tags: m.urgent ? 'warning' : 'purple_circle' };
    const token = sec('token');
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(`${ch.config.server}/${encodeURIComponent(ch.config.topic)}`, { method: 'POST', headers, body: m.body, signal: timeout });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'ntfy refused: check the access token.' : `ntfy returned HTTP ${r.status}`);
    return;
  }
  if (ch.kind === 'pushover') {
    const body = new URLSearchParams({ token: sec('appToken'), user: sec('userKey'), title: m.title, message: m.body, priority: m.urgent ? '1' : '0' });
    const r = await fetch('https://api.pushover.net/1/messages.json', { method: 'POST', body, signal: timeout });
    if (!r.ok) throw new Error(r.status === 400 ? 'Pushover rejected the keys.' : `Pushover returned HTTP ${r.status}`);
    return;
  }
  if (ch.kind === 'email') {
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({ host: ch.config.host, port: ch.config.port, secure: ch.config.secure, auth: ch.config.user ? { user: ch.config.user, pass: sec('pass') } : undefined, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
    try { await t.sendMail({ from: ch.config.from, to: ch.config.to, subject: `MultiMenu: ${m.title}`, text: `${m.title}\n\n${m.body}\n\n— MultiMenu` }); }
    catch (e) { throw new Error(/auth|535|534/i.test(e.message) ? 'The email server refused the login. Gmail and Outlook need an app password.' : e.message); }
    finally { t.close(); }
  }
}

function addHistory(entry) {
  const h = store.get('history');
  h.unshift(entry); if (h.length > 100) h.length = 100;
  store.saveSoon();
}

/** Sends an event to every app that wants it (or only `onlyId`). force skips the event list and cooldown. */
async function send(evt, { force = false, onlyId = null } = {}) {
  if (!store) return { sent: 0, results: [] };
  const targets = channels().filter(c => (onlyId ? c.id === onlyId : c.enabled && (force || c.events?.[evt.type])));
  if (!targets.length) return { sent: 0, results: [] };
  const key = `${evt.type}|${evt.account || ''}|${evt.detail || evt.error || ''}`;
  if (!force && recent.has(key) && Date.now() - recent.get(key) < 60_000) return { sent: 0, results: [], reason: 'cooldown' };
  recent.set(key, Date.now());
  if (recent.size > 300) for (const [k, t] of recent) if (Date.now() - t > 60_000) recent.delete(k); // keep it small
  const m = message(evt);
  const results = [];
  for (const ch of targets) {
    try { await deliver(ch, m); results.push({ name: ch.name, ok: true }); }
    catch (e) { results.push({ name: ch.name, ok: false, error: e.message }); log.warn(`${ch.kind} "${ch.name}" failed: ${e.message}`); }
  }
  addHistory({ at: Date.now(), type: evt.type, title: m.title, account: evt.account || null, results });
  return { sent: results.filter(r => r.ok).length, results };
}
function test(id) { return send({ type: 'test', title: 'MultiMenu test', detail: 'Your MultiMenu alerts work.' }, { force: true, onlyId: id }); }

/** Telegram: the chats that messaged your bot recently, so you can pick yours. */
async function telegramChats(token, savedId = null) {
  let t = String(token || '').trim();
  // Editing a saved Telegram channel: its stored token is used (it never goes back to the window).
  if (!t && savedId) { const ch = channels().find(c => c.id === savedId && c.kind === 'telegram'); if (ch?.secretEnc?.token) t = secure.decrypt(ch.secretEnc.token); }
  if (!RX.telegramToken.test(t)) throw new Error('Paste the bot token from @BotFather first.');
  const r = await fetch(`https://api.telegram.org/bot${t}/getUpdates?limit=50`, { signal: AbortSignal.timeout(15000) });
  if (r.status === 401) throw new Error('Telegram rejected the bot token.');
  if (!r.ok) throw new Error(`Telegram returned HTTP ${r.status}`);
  const j = await r.json();
  const chats = new Map();
  for (const u of j.result || []) {
    const c = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
    if (c) chats.set(String(c.id), { id: String(c.id), name: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id) });
  }
  if (!chats.size) throw new Error('No messages yet. Send any message to your bot in Telegram, then try again.');
  return [...chats.values()];
}
function randomTopic() { return `multimenu-${crypto.randomBytes(6).toString('hex')}`; }
function history() { return store ? store.get('history').slice(0, 50) : []; }

module.exports = { init, list, save, remove, setEnabled, send, test, telegramChats, randomTopic, history, message, cleanConfig, KINDS, DEFAULT_EVENTS, EMAIL_PRESETS };
