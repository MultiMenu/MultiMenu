'use strict';
// Discord notification centre. Webhook URLs are stored encrypted. Payloads are
// built only from an allow-list of fields (label, event, status, detail), so
// cookies, passwords and tickets can never be included.
const crypto = require('crypto');
const { JsonStore } = require('../store');
const paths = require('../paths');
const secure = require('../secure');
const settings = require('./settings');
const logger = require('../logger');
const log = logger.scope('webhooks');

const WEBHOOK_RX = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{15,22}\/[\w-]{20,100}$/;
const PURPLE = 0x8b5cf6, RED = 0xef4444, AMBER = 0xf59e0b, GREEN = 0x22c55e;

const EVENTS = {
  accountLaunched: { title: 'Account launched', color: GREEN, emoji: '🟣' },
  accountClosed: { title: 'Account closed', color: PURPLE, emoji: '⚪' },
  accountCrashed: { title: 'Session ended unexpectedly', color: RED, emoji: '🔴' },
  launchFailed: { title: 'Launch failed', color: RED, emoji: '⛔' },
  sessionError: { title: 'Session error', color: AMBER, emoji: '⚠️' },
  appStarted: { title: 'MultiMenu started', color: PURPLE, emoji: '🚀' },
  appClosed: { title: 'MultiMenu closed', color: PURPLE, emoji: '🌙' },
  highUsage: { title: 'High resource usage', color: AMBER, emoji: '📈' },
  trimmer: { title: 'RAM Trimmer', color: PURPLE, emoji: '🧹' },
  appError: { title: 'Application error', color: RED, emoji: '💥' },
  updates: { title: 'Update available', color: PURPLE, emoji: '✨' },
  watcherProblem: { title: '24/7 Watcher: problem detected', color: AMBER, emoji: '🛰️' },
  watcherRejoin: { title: '24/7 Watcher: rejoining', color: GREEN, emoji: '🔁' },
  watcherGaveUp: { title: '24/7 Watcher: stopped retrying', color: RED, emoji: '🛑' },
  scheduleRan: { title: 'Scheduled task ran', color: PURPLE, emoji: '⏰' },
  dailyReport: { title: 'Daily report', color: PURPLE, emoji: '📊' },
  internetBack: { title: 'Internet is back', color: GREEN, emoji: '📶' },
  robloxOutage: { title: 'Roblox outage', color: RED, emoji: '🌩️' },
  gameUpdated: { title: 'Game updated', color: PURPLE, emoji: '🆕' },
  highPing: { title: 'High ping', color: AMBER, emoji: '🐢' },
  inbox: { title: 'New in your inbox', color: PURPLE, emoji: '📬' },
  memoryRestart: { title: 'Memory guard restarted a client', color: AMBER, emoji: '🧠' },
  accountHealth: { title: 'Account needs attention', color: AMBER, emoji: '🩺' },
  loginWarning: { title: 'Logins need refreshing', color: AMBER, emoji: '🔑' },
  automation: { title: 'Automation', color: PURPLE, emoji: '⚡' },
  achievement: { title: 'Achievement unlocked', color: GREEN, emoji: '🏆' },
  secretHatched: { title: 'Secret hatched!', color: 0xF5C518, emoji: '🥚' },
  privateServerExpiring: { title: 'Private server running out', color: AMBER, emoji: '🔒' },
  freshRestart: { title: 'Fresh restart', color: PURPLE, emoji: '🔄' },
  dataCap: { title: 'Data cap', color: AMBER, emoji: '📶' },
  robloxUpdate: { title: 'Roblox is updating', color: PURPLE, emoji: '⬇️' },
  robloxUpdateHeld: { title: 'Roblox update held', color: PURPLE, emoji: '⏸️' },
  serverHop: { title: 'Joining another server', color: PURPLE, emoji: '🔀' },
  test: { title: 'Test notification', color: PURPLE, emoji: '✅' },
};

let store;
const recent = new Map(); // key -> last sent time

function init() { store = new JsonStore(paths.file('webhooks.json'), { hooks: [], history: [] }); }

const isValidUrl = u => WEBHOOK_RX.test(String(u || '').trim());

function maskUrl(u) { const m = u.match(/webhooks\/(\d+)\//); return m ? `…/webhooks/${m[1]}/••••••` : '••••••'; }

function listHooks() { return store.get('hooks').map(h => ({ id: h.id, name: h.name, enabled: h.enabled, masked: h.masked })); }

function addHook(name, url) {
  const u = String(url || '').trim();
  if (!isValidUrl(u)) throw new Error('That is not a Discord webhook URL. It should look like https://discord.com/api/webhooks/123…/abc…');
  const h = { id: crypto.randomUUID(), name: String(name || 'Webhook').slice(0, 40), enabled: true, urlEnc: secure.encrypt(u), masked: maskUrl(u) };
  store.get('hooks').push(h); store.saveSoon();
  return listHooks();
}
function updateHook(id, patch) {
  const h = store.get('hooks').find(x => x.id === id);
  if (!h) throw new Error('Webhook not found');
  if (typeof patch.enabled === 'boolean') h.enabled = patch.enabled;
  if (typeof patch.name === 'string') h.name = patch.name.slice(0, 40);
  store.saveSoon(); return listHooks();
}
function removeHook(id) { store.set('hooks', store.get('hooks').filter(h => h.id !== id)); return listHooks(); }

function clean(v, max = 300) { return v == null ? undefined : logger.redact(String(v)).slice(0, max); }

function buildEmbed(evt, version) {
  const meta = EVENTS[evt.type] || { title: evt.type, color: PURPLE, emoji: '•' };
  const fields = [];
  if (evt.account) fields.push({ name: 'Account', value: clean(evt.account, 100), inline: true });
  fields.push({ name: 'Event', value: meta.title, inline: true });
  if (evt.status) fields.push({ name: 'Status', value: clean(evt.status, 100), inline: true });
  if (evt.placeId) fields.push({ name: 'Place', value: `[${clean(evt.placeId, 20)}](https://www.roblox.com/games/${encodeURIComponent(evt.placeId)})`, inline: true });
  if (evt.detail) fields.push({ name: 'Details', value: clean(evt.detail, 1000) });
  if (evt.error) fields.push({ name: 'Error', value: '```' + clean(evt.error, 900) + '```' });
  if (evt.description) return { title: `${meta.emoji}  ${meta.title}`, description: clean(evt.description, 3800), color: meta.color, fields, timestamp: new Date(evt.at || Date.now()).toISOString(), footer: { text: `MultiMenu v${version}` } };
  return {
    title: `${meta.emoji}  ${meta.title}`,
    color: evt.status === 'failed' ? RED : meta.color,
    fields,
    timestamp: new Date(evt.at || Date.now()).toISOString(),
    footer: { text: `MultiMenu v${version}` },
  };
}

async function post(url, body, image) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let init;
    if (image) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(body));
      form.append('files[0]', new Blob([image], { type: 'image/png' }), 'screenshot.png');
      init = { method: 'POST', body: form, signal: AbortSignal.timeout(20000) };
    } else init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) };
    const res = await fetch(url, init);
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      await new Promise(r => setTimeout(r, Math.min(10, j.retry_after || 2) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Discord returned HTTP ${res.status}`);
    return true;
  }
  throw new Error('Discord rate limit — try again shortly.');
}

function addHistory(entry) {
  const h = store.get('history');
  h.unshift(entry);
  if (h.length > 200) h.length = 200;
  store.saveSoon();
}

/** Sends an event if enabled, not on cooldown and not a duplicate. */
async function send(evt, { version, force = false, onlyHookId, image } = {}) {
  const cfg = settings.get('discord');
  if (evt.type === 'secretHatched' && evt.test) force = true; // "Send a test alert" on the Hatch alerts page
  if (!force && (!cfg.enabled || !cfg.events[evt.type])) return { sent: false, reason: 'disabled' };
  const key = `${evt.type}|${evt.account || ''}|${evt.status || ''}|${evt.error || evt.detail || ''}`;
  const cooldown = Math.max(0, Number(cfg.cooldownSec) || 0) * 1000;
  if (!force && recent.has(key) && Date.now() - recent.get(key) < cooldown) return { sent: false, reason: 'cooldown' };
  recent.set(key, Date.now());
  const hooks = store.get('hooks').filter(h => (onlyHookId ? h.id === onlyHookId : h.enabled));
  if (!hooks.length) return { sent: false, reason: 'no-webhooks' };
  const embed = buildEmbed({ ...evt, at: Date.now() }, version);
  if (image) embed.image = { url: 'attachment://screenshot.png' };
  if (evt.fields) embed.fields = embed.fields.concat(evt.fields.slice(0, 20).map(f => ({ name: clean(f.name, 250), value: clean(f.value, 1000) || '—', inline: !!f.inline })));
  const body = { username: 'MultiMenu', embeds: [embed], allowed_mentions: { parse: [] } };
  // An event can bring its own ping (hatch alerts ping whoever set them up).
  const mention = String(evt.mention || cfg.mention || '').trim();
  if (mention && /^<@[&!]?\d{15,22}>$/.test(mention) && evt.type !== 'test') {
    body.content = mention;
    body.allowed_mentions = { parse: [], users: [], roles: [] };
    const id = mention.match(/\d+/)[0];
    if (mention.includes('&')) body.allowed_mentions.roles = [id]; else body.allowed_mentions.users = [id];
  }
  const results = [];
  for (const h of hooks) {
    try { await post(secure.decrypt(h.urlEnc), body, image); results.push({ hook: h.name, ok: true }); }
    catch (e) { results.push({ hook: h.name, ok: false, error: e.message }); log.warn(`Webhook ${h.name} failed: ${e.message}`); }
  }
  addHistory({ at: Date.now(), type: evt.type, title: (EVENTS[evt.type] || {}).title || evt.type, account: evt.account || null, ok: results.every(r => r.ok), results });
  return { sent: true, results };
}

function test(hookId, version) { return send({ type: 'test', detail: 'Your MultiMenu webhook is connected.', status: 'OK' }, { version, force: true, onlyHookId: hookId }); }
function rawHooks() { return store.get('hooks'); }
function history() { return store.get('history'); }
function clearHistory() { store.set('history', []); return []; }

module.exports = { rawHooks, init, isValidUrl, listHooks, addHook, updateHook, removeHook, send, test, history, clearHistory, buildEmbed, EVENTS };
