'use strict';
// Inbox watcher: checks each account for incoming trades, unread messages and
// friend requests every few minutes and tells you when a number goes up.
const settings = require('./settings');
const accounts = require('./accounts');
const roblox = require('./roblox');
const bus = require('../bus');
const log = require('../logger').scope('inbox');

let timer = null, running = false, lastRun = null;

/** What's new compared with the previous check. Pure (exported for tests). */
function diff(prev, next) {
  const out = [];
  const label = { trades: 'trade request', messages: 'message', friends: 'friend request' };
  for (const k of ['trades', 'messages', 'friends']) {
    const a = prev?.[k], b = next[k];
    if (b == null || a == null) continue;
    if (b > a) out.push(`${b - a} new ${label[k]}${b - a === 1 ? '' : 's'}`);
  }
  return out;
}

async function checkOne(a, cfg) {
  const cookie = accounts.getCookie(a.id);
  const next = { checkedAt: Date.now() };
  next.trades = cfg.trades ? await roblox.getInboundTrades(cookie).catch(() => null) : null;
  next.messages = cfg.messages ? await roblox.getUnreadMessages(cookie).catch(() => null) : null;
  next.friends = cfg.friends ? await roblox.getFriendRequestCount(cookie).catch(() => null) : null;
  const news = diff(a.inbox, next);
  accounts.setInbox(a.id, next);
  if (news.length) bus.emit('event', { type: 'inbox', account: a.alias || a.displayName || a.username, detail: news.join(', ') });
  return next;
}

async function checkAll() {
  if (running) return status();
  running = true;
  const cfg = settings.get('inbox');
  try {
    const raw = accounts.getAll().accounts.filter(a => a.status !== 'expired');
    for (const pa of raw) {
      const a = accounts.find(pa.id);
      try { await checkOne(a, cfg); } catch (e) { log.warn(`${pa.username}: ${e.message}`); }
      await new Promise(r => setTimeout(r, 700));
    }
    lastRun = Date.now();
  } finally { running = false; }
  return status();
}

function start() {
  clearInterval(timer);
  const cfg = settings.get('inbox');
  if (!cfg.enabled) return;
  timer = setInterval(() => checkAll().catch(() => {}), Math.max(2, Number(cfg.intervalMin) || 5) * 60_000);
  setTimeout(() => checkAll().catch(() => {}), 20_000);
}

function status() { return { running, lastRun, config: settings.get('inbox') }; }

module.exports = { start, checkAll, status, diff };
