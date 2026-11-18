'use strict';
// Automations: "when this happens, and these are true, do that". Rules react to
// events (an alt crashes, a session starts, a game updates...) or to how things are
// (RAM above 90% for 2 minutes, every day at 18:00, you've been away 30 minutes).
// Actions use the same commands as the command line. Safety: per-rule cooldowns,
// at most 20 runs a minute in total (more pauses automations for 5 minutes), and
// no action can run programs, type keys or send logins anywhere.
const crypto = require('crypto');
const { JsonStore } = require('../store');
const paths = require('../paths');
const accounts = require('./accounts');
const bus = require('../bus');
const log = require('../logger').scope('automations');

const ACCOUNT_TRIGGERS = ['problem', 'gaveUp', 'launchFailed', 'started', 'stopped', 'ping'];
const TRIGGERS = {
  problem: { label: 'An alt has a problem', params: { kind: ['any', 'crash', 'disconnect', 'freeze', 'stuck'] } },
  gaveUp: { label: 'The watcher stops retrying an alt' },
  launchFailed: { label: 'An alt fails to launch' },
  started: { label: 'An alt starts playing' },
  stopped: { label: 'An alt closes' },
  allClosed: { label: 'Every alt has closed' },
  ram: { label: 'RAM is above a level', params: { percent: 'number', minutes: 'number' } },
  cpu: { label: 'CPU is above a level', params: { percent: 'number', minutes: 'number' } },
  ping: { label: 'An alt\'s ping is high', params: { ms: 'number' } },
  time: { label: 'At a time of day', params: { time: 'time', days: 'days' } },
  every: { label: 'Every few minutes', params: { minutes: 'number' } },
  away: { label: 'You have been away', params: { minutes: 'number' } },
  back: { label: 'You come back to the PC' },
  gameUpdated: { label: 'A game updates' },
  outage: { label: 'Roblox has an outage' },
  internetBack: { label: 'The internet comes back' },
  loginWarning: { label: 'Logins need refreshing' },
  appStarted: { label: 'MultiMenu starts' },
};
const CONDITIONS = {
  who: { label: 'The alt is', params: { who: 'text' } },
  between: { label: 'The time is between', params: { start: 'time', end: 'time' } },
  days: { label: 'The day is', params: { days: 'days' } },
  clients: { label: 'Alts running', params: { op: ['<', '>', '='], n: 'number' } },
  ram: { label: 'RAM used', params: { op: ['<', '>'], percent: 'number' } },
  away: { label: 'You are away', params: { away: ['yes', 'no'] } },
  watcher: { label: 'The 24/7 Watcher is', params: { on: ['on', 'off'] } },
};
const ACTIONS = {
  rejoin: { label: 'Rejoin the alt', params: { who: 'text' } },
  launch: { label: 'Launch alts', params: { who: 'text', game: 'text' } },
  close: { label: 'Close alts', params: { who: 'text' } },
  preset: { label: 'Start or close a preset', params: { name: 'text', mode: ['start', 'stop'] } },
  notify: { label: 'Show a notification', params: { text: 'text' } },
  speak: { label: 'Say something out loud', params: { text: 'text' } },
  discord: { label: 'Send to Discord', params: { text: 'text' } },
  alert: { label: 'Send to my phone apps', params: { text: 'text' } },
  screenshot: { label: 'Save a screenshot of the alt' },
  tile: { label: 'Tile the windows' },
  trim: { label: 'Trim RAM' },
  watcher: { label: 'Turn the 24/7 Watcher', params: { state: ['on', 'off'] } },
  eco: { label: 'Turn eco mode', params: { state: ['on', 'off'] } },
  rotation: { label: 'Rotation', params: { state: ['on', 'off', 'next'] } },
  scale: { label: 'Turn auto-scale', params: { state: ['on', 'off'] } },
  wait: { label: 'Wait', params: { seconds: 'number' } },
};

let store = null, pollTimer = null, pausedUntil = 0;
let runTimes = [];
const since = new Map(); // rule id -> when a state trigger started being true
const fired = new Map(); // rule id -> key of the last time-based firing
let awayStart = null, lastIdleSec = 0, lastCount = null;

function init() {
  store = new JsonStore(paths.file('automations.json'), { rules: [], log: [] });
  if (!listeners) attach();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => poll().catch(e => log.warn(e.message)), 15_000);
  pollTimer.unref?.();
  setTimeout(() => handle({ type: 'appStarted' }), 10_000).unref?.();
  return store;
}
const rules = () => (store ? store.get('rules') : []);

// ---------- validation ----------
const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const hm = (v) => (/^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v).padStart(5, '0') : '');
function cleanParams(defs = {}, p = {}) {
  const out = {};
  for (const [k, t] of Object.entries(defs)) {
    const v = p[k];
    if (Array.isArray(t)) out[k] = t.includes(v) ? v : t[0];
    else if (t === 'number') out[k] = Math.max(0, Math.min(100000, Number(v) || 0));
    else if (t === 'time') out[k] = hm(v) || '08:00';
    else if (t === 'days') out[k] = (Array.isArray(v) ? v : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
    else out[k] = str(v);
  }
  return out;
}
function validate(r = {}) {
  const name = str(r.name, 60);
  if (!name) throw new Error('Give the automation a name.');
  const tt = r.trigger?.type;
  if (!TRIGGERS[tt]) throw new Error('Pick what starts the automation.');
  const conditions = (Array.isArray(r.conditions) ? r.conditions : []).slice(0, 8).filter(c => CONDITIONS[c?.type]).map(c => ({ type: c.type, ...cleanParams(CONDITIONS[c.type].params, c) }));
  const actions = (Array.isArray(r.actions) ? r.actions : []).slice(0, 10).filter(a => ACTIONS[a?.type]).map(a => ({ type: a.type, ...cleanParams(ACTIONS[a.type].params, a) }));
  if (!actions.length) throw new Error('Add at least one thing to do.');
  if (actions.every(a => a.type === 'wait')) throw new Error('Add something to do besides waiting.');
  for (const a of actions) if (a.type === 'wait') a.seconds = Math.min(600, Math.max(1, a.seconds || 5));
  const trigger = { type: tt, ...cleanParams(TRIGGERS[tt].params, r.trigger) };
  if (['ram', 'cpu'].includes(tt)) { trigger.percent = Math.min(100, Math.max(10, trigger.percent || 90)); trigger.minutes = Math.min(120, Math.max(0, trigger.minutes)); }
  if (tt === 'every') trigger.minutes = Math.min(1440, Math.max(5, trigger.minutes || 60));
  if (tt === 'away') trigger.minutes = Math.min(600, Math.max(1, trigger.minutes || 15));
  if (tt === 'ping') trigger.ms = Math.min(5000, Math.max(50, trigger.ms || 300));
  return { name, enabled: r.enabled !== false, trigger, conditions, actions, cooldownSec: Math.max(0, Math.min(86400, Number(r.cooldownSec ?? 60) || 0)) };
}
function save(r) {
  const v = validate(r);
  const ex = r.id && rules().find(x => x.id === r.id);
  if (ex) Object.assign(ex, v, { updatedAt: Date.now() });
  else rules().push({ id: crypto.randomUUID(), createdAt: Date.now(), lastRunAt: null, runs: 0, ...v });
  store.saveSoon();
  bus.emit('automations:changed');
  return list();
}
function remove(id) { store.set('rules', rules().filter(r => r.id !== id)); bus.emit('automations:changed'); return list(); }
function setEnabled(id, on) { const r = rules().find(x => x.id === id); if (r) { r.enabled = !!on; store.saveSoon(); bus.emit('automations:changed'); } return list(); }
function list() { return rules().map(r => ({ ...r })); }

// ---------- matching (pure, unit-tested) ----------
const mins = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
function triggerMatches(t, ev) {
  if (t.type !== ev.type) return false;
  if (t.type === 'problem' && t.kind !== 'any' && t.kind !== ev.kind) return false;
  return true;
}
function conditionOk(c, ctx, state) {
  switch (c.type) {
    case 'who': {
      if (!c.who) return true;
      if (!ctx.accountId) return false;
      return accounts.resolve(c.who).some(a => a.id === ctx.accountId) || (!/^(tag|group|tier|id):/i.test(c.who) && String(ctx.label || '').toLowerCase() === c.who.toLowerCase());
    }
    case 'between': {
      const m = state.now.getHours() * 60 + state.now.getMinutes(), a = mins(c.start), b = mins(c.end);
      return a === b ? true : a < b ? m >= a && m < b : m >= a || m < b;
    }
    case 'days': return c.days.includes(state.now.getDay());
    case 'clients': return c.op === '<' ? state.clients < c.n : c.op === '>' ? state.clients > c.n : state.clients === c.n;
    case 'ram': return c.op === '<' ? state.ram < c.percent : state.ram > c.percent;
    case 'away': return (c.away === 'yes') === state.away;
    case 'watcher': return (c.on === 'on') === state.watcher;
    default: return true;
  }
}
function fill(text, ctx, state) {
  return String(text || '').replace(/\{(account|game|detail|time|ram|cpu|clients)\}/g, (_, k) => {
    if (k === 'account') return ctx.label || '';
    if (k === 'game') return ctx.placeName || (ctx.placeId ? `Place ${ctx.placeId}` : '');
    if (k === 'detail') return ctx.detail || '';
    if (k === 'time') return state.now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return String(state[k] ?? '');
  }).slice(0, 500);
}

function currentState() {
  const sessions = require('./sessions').listSessions().filter(s => s.status === 'running');
  const sys = require('./system').latest();
  let idle = 0;
  try { idle = require('electron').powerMonitor.getSystemIdleTime(); } catch { /* not available */ }
  let watcher = false;
  try { watcher = !!require('./watcher').status().enabled; } catch { /* not started */ }
  return { now: new Date(), clients: sessions.length, ram: Math.round(sys?.ramPercent || 0), cpu: Math.round(sys?.cpu || 0), away: idle >= 300, watcher, idleSec: idle };
}

// ---------- running ----------
async function runActions(rule, ctx, state) {
  const commands = require('./commands');
  const steps = [];
  const who = (a) => a.who || (ctx.accountId ? `id:${ctx.accountId}` : '');
  for (const a of rule.actions) {
    try {
      switch (a.type) {
        case 'rejoin': { const r = await commands.run('rejoin', { who: who(a) }, { source: 'automation' }); steps.push(r.message); break; }
        case 'launch': { const r = await commands.run('launch', { who: who(a), game: a.game }, { source: 'automation' }); steps.push(r.message); break; }
        case 'close': { const r = await commands.run('close', { who: a.who || (ctx.accountId ? `id:${ctx.accountId}` : 'all') }, { source: 'automation' }); steps.push(r.message); break; }
        case 'preset': { const r = await commands.run('preset', { name: a.name, action: a.mode }, { source: 'automation' }); steps.push(r.message); break; }
        case 'notify': bus.emit('notify', { level: 'info', title: rule.name, message: fill(a.text, ctx, state) || rule.name, toast: true }); steps.push('Notified'); break;
        case 'speak': { const r = await require('./speech').speak(fill(a.text, ctx, state) || rule.name, { force: true }); steps.push(r.spoken ? 'Spoke' : `Not spoken (${r.reason || r.error || 'unavailable'})`); break; }
        case 'discord': { const r = await require('./webhooks').send({ type: 'automation', detail: fill(a.text, ctx, state) || rule.name, account: ctx.label || undefined, status: rule.name }, { version: require('electron').app?.getVersion?.() || '', force: true }); steps.push(r.sent ? 'Sent to Discord' : `Discord: ${r.reason}`); break; }
        case 'alert': { const r = await require('./alertapps').send({ type: 'automation', title: rule.name, detail: fill(a.text, ctx, state) || rule.name, account: ctx.label || null }, { force: true }); steps.push(`Sent to ${r.sent} app${r.sent === 1 ? '' : 's'}`); break; }
        case 'screenshot': {
          const s = ctx.accountId ? require('./sessions').listSessions().find(x => x.accountId === ctx.accountId && x.status === 'running') : null;
          const png = s ? await require('./capture').captureWindowOfPid(s.pid) : null;
          if (png) { require('./capture').save(png, s.label); steps.push('Screenshot saved'); } else steps.push('No window to capture');
          break;
        }
        case 'tile': { const r = await commands.run('tile', {}, { source: 'automation' }); steps.push(r.message); break; }
        case 'trim': { const r = await commands.run('trim', {}, { source: 'automation' }); steps.push(r.message); break; }
        case 'watcher': case 'eco': case 'scale': { const r = await commands.run(a.type, { state: a.state }, { source: 'automation' }); steps.push(r.message); break; }
        case 'rotation': { const r = await commands.run('rotation', { state: a.state }, { source: 'automation' }); steps.push(r.message); break; }
        case 'wait': await new Promise(r => setTimeout(r, a.seconds * 1000)); steps.push(`Waited ${a.seconds}s`); break;
        default: break;
      }
    } catch (e) { steps.push(`${ACTIONS[a.type]?.label || a.type}: ${e.message}`); }
  }
  return steps;
}

async function fire(rule, ctx, state) {
  const now = Date.now();
  if (now < pausedUntil) return false;
  if (rule.lastRunAt && now - rule.lastRunAt < rule.cooldownSec * 1000) return false;
  runTimes = runTimes.filter(t => now - t < 60_000);
  if (runTimes.length >= 20) {
    pausedUntil = now + 5 * 60_000;
    log.warn('Automations paused: more than 20 runs in a minute');
    bus.emit('notify', { level: 'warn', title: 'Automations paused', message: 'More than 20 ran in one minute, so they are paused for 5 minutes. Check your rules for loops.', toast: true });
    return false;
  }
  runTimes.push(now);
  rule.lastRunAt = now; rule.runs = (rule.runs || 0) + 1;
  log.info(`Running “${rule.name}” (${rule.trigger.type})`);
  const steps = await runActions(rule, ctx, state);
  const entry = { at: now, ruleId: rule.id, name: rule.name, trigger: rule.trigger.type, account: ctx.label || null, steps };
  const lg = store.get('log');
  lg.unshift(entry); if (lg.length > 100) lg.length = 100;
  store.saveSoon();
  bus.emit('automations:ran', entry);
  bus.emit('automations:changed');
  return true;
}

/** An event happened: run every enabled rule it starts (that passes its conditions). */
async function handle(ev) {
  if (!store) return 0;
  const state = currentState();
  let n = 0;
  for (const r of rules()) {
    if (!r.enabled || !triggerMatches(r.trigger, ev)) continue;
    if (!r.conditions.every(c => conditionOk(c, ev, state))) continue;
    if (await fire(r, ev, state)) n++;
  }
  return n;
}

/** State-based triggers, checked every 15 seconds. */
async function poll() {
  if (!store) return;
  const state = currentState();
  const nowMs = Date.now();
  // away / back
  if (state.idleSec >= 60 && awayStart == null) awayStart = nowMs - state.idleSec * 1000;
  const cameBack = awayStart != null && state.idleSec < lastIdleSec && state.idleSec < 30;
  lastIdleSec = state.idleSec;
  for (const r of rules()) {
    if (!r.enabled) continue;
    const t = r.trigger;
    let go = false, ctx = { type: t.type };
    if (t.type === 'ram' || t.type === 'cpu') {
      const over = state[t.type] > t.percent;
      if (!over) { since.delete(r.id); continue; }
      if (!since.has(r.id)) since.set(r.id, nowMs);
      go = nowMs - since.get(r.id) >= t.minutes * 60_000;
      ctx.detail = `${t.type.toUpperCase()} ${state[t.type]}%`;
    } else if (t.type === 'time') {
      const key = `${state.now.toDateString()} ${t.time}`;
      const hhmm = `${String(state.now.getHours()).padStart(2, '0')}:${String(state.now.getMinutes()).padStart(2, '0')}`;
      go = hhmm === t.time && t.days.includes(state.now.getDay()) && fired.get(r.id) !== key;
      if (go) fired.set(r.id, key);
    } else if (t.type === 'every') {
      const last = fired.get(r.id) || r.lastRunAt || r.createdAt || nowMs;
      go = nowMs - last >= t.minutes * 60_000;
      if (go) fired.set(r.id, nowMs);
    } else if (t.type === 'away') {
      const key = `away:${awayStart}`;
      go = awayStart != null && state.idleSec >= t.minutes * 60 && fired.get(r.id) !== key;
      if (go) fired.set(r.id, key);
    } else if (t.type === 'back') {
      go = cameBack;
    } else if (t.type === 'ping') {
      for (const s of require('./sessions').listSessions().filter(x => x.status === 'running' && x.ping != null && x.ping > t.ms)) {
        const k = `${r.id}:${s.id}`;
        if (!since.has(k)) since.set(k, nowMs);
        if (nowMs - since.get(k) >= 60_000) {
          const c = { type: 'ping', accountId: s.accountId, label: s.label, placeId: s.placeId, placeName: s.placeName, detail: `${s.ping} ms` };
          if (r.conditions.every(x => conditionOk(x, c, state))) await fire(r, c, state);
        }
      }
      continue;
    }
    if (go && r.conditions.every(c => conditionOk(c, ctx, state))) await fire(r, ctx, state);
  }
  if (cameBack) awayStart = null;
}

let listeners = false;
function attach() {
  listeners = true;
  const ev = (type, map = (x) => x) => (p) => handle({ type, ...map(p || {}) }).catch(e => log.warn(e.message));
  bus.on('watcher:problem', ev('problem'));
  bus.on('watcher:gaveup', ev('gaveUp'));
  bus.on('session:launchFailed', ev('launchFailed', p => ({ ...p, detail: p.error })));
  bus.on('session:started', ev('started'));
  bus.on('session:stopped', (p) => {
    if (p.reason !== 'restart') handle({ type: 'stopped', ...p, detail: p.reason }).catch(() => {});
  });
  bus.on('sessions:changed', (list) => {
    const n = (list || []).filter(s => ['running', 'launching'].includes(s.status)).length;
    if (lastCount && !n) handle({ type: 'allClosed' }).catch(() => {});
    lastCount = n;
  });
  bus.on('event', (e) => {
    if (e.test && !e.testAutomations) return; // admin test events only reach automations when asked
    const map = { gameUpdated: 'gameUpdated', robloxOutage: 'outage', internetBack: 'internetBack', loginWarning: 'loginWarning' };
    if (map[e.type]) handle({ type: map[e.type], detail: e.detail }).catch(() => {});
  });
}

function catalog() { return { triggers: TRIGGERS, conditions: CONDITIONS, actions: ACTIONS, accountTriggers: ACCOUNT_TRIGGERS }; }
function runLog() { return store ? store.get('log').slice(0, 50) : []; }
function clearLog() { store.set('log', []); return []; }
async function runNow(id) {
  const r = rules().find(x => x.id === id);
  if (!r) throw new Error('Automation not found.');
  const state = currentState();
  const before = r.lastRunAt; r.lastRunAt = null;
  const ok = await fire(r, { type: 'manual', label: '' }, state);
  if (!ok) r.lastRunAt = before;
  return { ran: ok, log: runLog()[0] || null };
}

module.exports = { init, validate, save, remove, setEnabled, list, catalog, runLog, clearLog, runNow, handle, poll, triggerMatches, conditionOk, fill, TRIGGERS, ACTIONS, CONDITIONS };
