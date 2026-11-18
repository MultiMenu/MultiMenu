'use strict';
// Rotation mode: keep N alts from a pool running and swap them for the next N on
// a timer, round and round. Handy when you have more alts than your PC can run.
// The outgoing alts close first (the 24/7 Watcher leaves them closed), then the
// incoming ones launch one after another.
const { JsonStore } = require('../store');
const paths = require('../paths');
const settings = require('./settings');
const accounts = require('./accounts');
const sessions = require('./sessions');
const bus = require('../bus');
const log = require('../logger').scope('rotation');

let store = null, timer = null, busy = false;
function init() {
  store = new JsonStore(paths.file('rotation.json'), { cursor: 0, current: [], nextAt: null, history: [] });
  clearInterval(timer);
  timer = setInterval(() => tick().catch(e => log.warn(e.message)), 30_000);
  timer.unref?.();
  return store;
}
const cfg = () => settings.get('rotation');
const st = () => store?.data || { cursor: 0, current: [], nextAt: null, history: [] };

/** The accounts in the rotation right now (a tag pool follows the tag). Expired logins are skipped. */
function poolIds(c = cfg()) {
  const list = c.tag ? accounts.resolve(`tag:${c.tag}`) : (c.accountIds || []).map(id => accounts.find(id)).filter(Boolean);
  return list.filter(a => a.status !== 'expired').map(a => a.id);
}

/** Pure: the next `size` accounts from `cursor`, wrapping round the pool. */
function pickNext(pool, cursor, size) {
  if (!pool.length) return { next: [], cursor: 0 };
  const n = Math.min(Math.max(1, size), pool.length);
  const start = ((cursor % pool.length) + pool.length) % pool.length;
  const next = [];
  for (let i = 0; i < n; i++) next.push(pool[(start + i) % pool.length]);
  return { next, cursor: (start + n) % pool.length };
}

const live = (s) => ['running', 'launching', 'rejoining'].includes(s.status);
const nameOf = (id) => { const a = accounts.find(id); return a ? (a.alias || a.displayName || a.username) : 'removed account'; };

async function rotate(reason = 'timer') {
  if (busy) return { message: 'Already rotating.' };
  busy = true;
  try {
    const c = cfg();
    const pool = poolIds(c);
    if (!pool.length) {
      bus.emit('notify', { level: 'warn', title: 'Rotation', message: c.tag ? `No usable accounts have the tag “${c.tag}”.` : 'Pick some accounts for the rotation first.' });
      return { message: 'The rotation has no accounts.' };
    }
    const s = st();
    const { next, cursor } = pickNext(pool, s.cursor, Number(c.size) || 1);
    const outgoing = s.current.filter(id => !next.includes(id));
    let closed = 0;
    for (const sess of sessions.listSessions().filter(x => live(x) && outgoing.includes(x.accountId))) { sessions.setWatch(sess.id, false); await sessions.close(sess.id); closed++; }
    if (closed) await new Promise(r => setTimeout(r, 4000));
    const running = new Set(sessions.listSessions().filter(live).map(x => x.accountId));
    const incoming = accounts.byTier(next.filter(id => !running.has(id)));
    for (const id of incoming) sessions.launch(id, c.game || null, { watch: !!c.watch });
    s.current = next; s.cursor = cursor;
    s.nextAt = Date.now() + Math.max(5, Number(c.everyMin) || 60) * 60_000;
    s.history.unshift({ at: Date.now(), reason, out: outgoing.map(nameOf), in: incoming.map(nameOf) });
    s.history.length = Math.min(s.history.length, 20);
    store.saveSoon();
    const msg = `${incoming.length ? `In: ${incoming.map(nameOf).join(', ')}` : 'Nobody new'}${outgoing.length ? ` · Out: ${outgoing.map(nameOf).join(', ')}` : ''}`;
    log.info(`Rotated (${reason}): ${msg}`);
    bus.emit('notify', { level: 'info', title: 'Rotation', message: msg });
    bus.emit('rotation:update', status());
    return { message: msg, in: incoming, out: outgoing };
  } finally { busy = false; }
}

async function tick(now = Date.now()) {
  if (!cfg().enabled || !store) return;
  const s = st();
  if (!s.nextAt || now >= s.nextAt) await rotate(s.nextAt ? 'timer' : 'start');
}

function setEnabled(on) {
  settings.set('rotation.enabled', !!on);
  if (on) { st().nextAt = null; store?.saveSoon(); tick().catch(e => log.warn(e.message)); }
  bus.emit('rotation:update', status());
  return status();
}
const rotateNow = () => rotate('now');

function status() {
  const s = st(), c = cfg();
  return {
    enabled: !!c.enabled, config: c, pool: poolIds(c).map(id => ({ id, name: nameOf(id) })),
    current: s.current.map(id => ({ id, name: nameOf(id) })), nextAt: c.enabled ? s.nextAt : null, history: s.history.slice(0, 10),
  };
}

module.exports = { init, tick, rotate, rotateNow, setEnabled, status, pickNext, poolIds };
