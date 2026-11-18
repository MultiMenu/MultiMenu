'use strict';
// Network monitor: how much this PC downloads and uploads right now, data used
// today and this month, a rough figure per alt, and a data cap that warns you
// (and can close Filler alts) before you go over.
// Windows only reports totals per network adapter (per-app numbers need admin
// rights), so the per-alt figure is the PC total shared between running alts.
const { execFile } = require('child_process');
const { JsonStore } = require('../store');
const paths = require('../paths');
const settings = require('./settings');
const sessions = require('./sessions');
const accounts = require('./accounts');
const bus = require('../bus');
const log = require('../logger').scope('netmon');

const WRAP = 2 ** 32;
let store = null, timer = null, last = null, rate = { down: 0, up: 0, at: null }, history = [], error = null;
const db = () => store || (store = new JsonStore(paths.file('netusage.json'), { days: {}, warned: {} }));

/** Received and sent byte counters out of `netstat -e` (any Windows language: the first line with two big numbers). */
function parseNetstat(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const nums = line.trim().split(/\s+/).filter(x => /^\d+$/.test(x));
    if (nums.length === 2 && /\D/.test(line.trim().split(/\s+/)[0])) return { rx: Number(nums[0]), tx: Number(nums[1]) };
  }
  return null;
}

/** Bytes between two counter readings; the counters are 32-bit on some systems and wrap (pure, unit-tested). */
function delta(prev, cur) {
  if (prev == null || cur == null) return 0;
  if (cur >= prev) return cur - prev;
  const wrapped = cur + WRAP - prev;
  return wrapped < WRAP / 4 ? wrapped : 0; // more than 1 GB in one reading is a reset (adapter reconnected), not a wrap
}

const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Usage in the current day or month from the per-day table (pure, unit-tested). */
function periodUsage(days, period, now = Date.now()) {
  const today = dayKey(now);
  const keys = Object.keys(days).filter(k => (period === 'day' ? k === today : k.slice(0, 7) === today.slice(0, 7)));
  return keys.reduce((a, k) => ({ down: a.down + (days[k].down || 0), up: a.up + (days[k].up || 0) }), { down: 0, up: 0 });
}

function read() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('netstat', ['-e'], { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err) { error = err.message; return resolve(null); }
      const r = parseNetstat(out);
      error = r ? null : 'Windows didn\'t report network totals.';
      resolve(r);
    });
  });
}

async function tick() {
  const r = await read();
  const now = Date.now();
  if (!r) return;
  if (last) {
    const down = delta(last.rx, r.rx), up = delta(last.tx, r.tx), sec = Math.max(1, (now - last.at) / 1000);
    rate = { down: down / sec, up: up / sec, at: now };
    history.push({ t: now, down: rate.down, up: rate.up });
    while (history.length > 180) history.shift();
    const days = db().get('days'), k = dayKey(now);
    days[k] = { down: (days[k]?.down || 0) + down, up: (days[k]?.up || 0) + up };
    for (const key of Object.keys(days)) if (now - Date.parse(key) > 70 * 86400_000) delete days[key];
    db().saveSoon();
    checkCap();
    bus.emit('netmon:update', view());
  }
  last = { rx: r.rx, tx: r.tx, at: now };
}

function checkCap() {
  const cfg = settings.get('netmon');
  if (!(cfg.capGB > 0)) return;
  const used = periodUsage(db().get('days'), cfg.period);
  const total = used.down + used.up, cap = cfg.capGB * 1024 ** 3;
  const periodKey = cfg.period === 'day' ? dayKey() : dayKey().slice(0, 7);
  const warned = db().get('warned');
  for (const step of [80, 100]) {
    const key = `${periodKey}:${step}`;
    if (total < cap * (step / 100) || warned[key]) continue;
    warned[key] = Date.now();
    const gb = (total / 1024 ** 3).toFixed(1);
    if (step === 80) bus.emit('event', { type: 'dataCap', detail: `${gb} GB of your ${cfg.capGB} GB data cap used.` });
    else {
      let closed = 0;
      if (cfg.closeFiller) {
        for (const s of sessions.listSessions().filter(x => x.status === 'running' && x.accountId && !x.external)) {
          if ((accounts.find(s.accountId)?.tier || 'filler') === 'filler') { sessions.close(s.id).catch(() => {}); closed++; }
        }
      }
      bus.emit('event', { type: 'dataCap', detail: `Data cap reached: ${gb} GB used.${closed ? ` Filler alts closed: ${closed}.` : ''}` });
    }
  }
  for (const k of Object.keys(warned)) if (Date.now() - warned[k] > 40 * 86400_000) delete warned[k];
  db().saveSoon();
}

function view() {
  const cfg = settings.get('netmon');
  const days = db().get('days');
  const alts = sessions.listSessions().filter(s => s.status === 'running' && !s.external).length;
  const today = periodUsage(days, 'day'), month = periodUsage(days, 'month');
  const used = cfg.period === 'day' ? today : month;
  const perHour = (rate.down + rate.up) * 3600;
  return {
    available: process.platform === 'win32', error, rate, history: history.slice(-90),
    today, month, alts, perAltHour: alts ? perHour / alts : null,
    cap: cfg.capGB > 0 ? { gb: cfg.capGB, period: cfg.period, used: used.down + used.up, pct: Math.min(100, ((used.down + used.up) / (cfg.capGB * 1024 ** 3)) * 100) } : null,
    last7: Object.entries(days).sort().slice(-7).map(([d, v]) => ({ day: d, down: v.down || 0, up: v.up || 0 })),
    config: cfg,
  };
}

function start() {
  clearInterval(timer);
  if (!settings.get('netmon.enabled')) { last = null; return; }
  tick().catch(e => log.warn(e.message));
  timer = setInterval(require('./lean').paced(() => tick().catch(e => log.warn(e.message))), 5000);
  timer.unref?.();
}
function stop() { clearInterval(timer); timer = null; last = null; }
function init() { db(); start(); }

module.exports = { init, start, stop, view, parseNetstat, delta, periodUsage, dayKey };
