'use strict';
// Scheduler: runs tasks at set times (daily on chosen days, or every N hours).
// Task actions: start a preset, close a preset, close everything, restart every
// running client (fresh memory), or trim RAM. Quiet hours live in settings and
// are honoured by the 24/7 Watcher.
const crypto = require('crypto');
const { JsonStore } = require('../store');
const paths = require('../paths');
const sessions = require('./sessions');
const bus = require('../bus');
const log = require('../logger').scope('scheduler');

const ACTIONS = { launchPreset: 'Start preset', closePreset: 'Close preset', closeAll: 'Close all Roblox', restartAll: 'Restart all clients', trimRam: 'Trim RAM' };
let store, timer = null;

function init() {
  store = new JsonStore(paths.file('schedule.json'), { tasks: [] });
  clearInterval(timer);
  timer = setInterval(() => { try { check(); } catch (e) { log.error('check', e); } }, 20_000);
}
const list = () => store.get('tasks');

function validate(t) {
  const name = String(t.name || '').trim().slice(0, 50) || ACTIONS[t.action] || 'Task';
  if (!ACTIONS[t.action]) throw new Error('Choose what the task should do.');
  if ((t.action === 'launchPreset' || t.action === 'closePreset') && !require('./presets').get(t.presetId)) throw new Error('Choose a preset.');
  const kind = t.kind === 'every' ? 'every' : 'daily';
  const out = { name, action: t.action, presetId: t.presetId || null, kind, enabled: t.enabled !== false };
  if (kind === 'daily') {
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(t.time || ''))) throw new Error('Enter a time like 07:30.');
    const days = (Array.isArray(t.days) ? t.days : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
    if (!days.length) throw new Error('Pick at least one day.');
    out.time = t.time.padStart(5, '0'); out.days = [...new Set(days)].sort();
  } else {
    const h = Number(t.everyHours);
    if (!(h >= 0.25 && h <= 168)) throw new Error('Repeat every 0.25 to 168 hours.');
    out.everyHours = h;
  }
  return out;
}

function save(t) {
  const v = validate(t);
  const arr = list();
  const ex = t.id && arr.find(x => x.id === t.id);
  if (ex) Object.assign(ex, v);
  else arr.push({ id: crypto.randomUUID(), createdAt: Date.now(), lastRunAt: null, ...v });
  store.saveSoon();
  return ex || arr.at(-1);
}
function remove(id) { store.set('tasks', list().filter(t => t.id !== id)); return true; }

/** Is the task due at `now`? Daily tasks fire once in the minute they're set for. */
function isDue(t, now = new Date()) {
  if (!t.enabled) return false;
  if (t.kind === 'every') {
    const base = t.lastRunAt || t.createdAt;
    return now.getTime() - base >= t.everyHours * 3600_000;
  }
  const [h, m] = t.time.split(':').map(Number);
  if (!t.days.includes(now.getDay()) || now.getHours() !== h || now.getMinutes() !== m) return false;
  return !t.lastRunAt || now.getTime() - t.lastRunAt > 90_000;
}

function nextRun(t, now = new Date()) {
  if (!t.enabled) return null;
  if (t.kind === 'every') return (t.lastRunAt || t.createdAt) + t.everyHours * 3600_000;
  const [h, m] = t.time.split(':').map(Number);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now); d.setDate(now.getDate() + i); d.setHours(h, m, 0, 0);
    if (d > now && t.days.includes(d.getDay())) return d.getTime();
  }
  return null;
}

async function restartAll() {
  const running = sessions.listSessions().filter(s => s.status === 'running' && s.accountId && !s.external);
  for (const s of running) {
    const raw = sessions.getRaw(s.id);
    // Back into the same server (like the memory guard and resume), unless it's a private server link.
    const target = { ...(raw?.target || {}) };
    if (raw?.jobId && !target.linkCode && !target.followUserId) target.jobId = raw.jobId;
    sessions.endForRestart(s.id, 'Scheduled restart');
    await new Promise(r => setTimeout(r, 3000));
    sessions.launch(s.accountId, null, { label: s.label, watch: raw?.watch, target: Object.keys(target).length ? target : null });
  }
  return running.length;
}

async function execute(t) {
  const presets = require('./presets');
  let result = '';
  switch (t.action) {
    case 'launchPreset': await presets.run(t.presetId); result = 'Preset started'; break;
    case 'closePreset': result = `${presets.closePreset(t.presetId, 'Scheduled').closed} closed`; break;
    case 'closeAll': await sessions.closeAll(); result = 'All closed'; break;
    case 'restartAll': result = `${await restartAll()} restarted`; break;
    case 'trimRam': result = `${require('./ramtrimmer').trimNow('manual').lastFreedMB} MB freed`; break;
    default: break;
  }
  return result;
}

async function runNow(id) {
  const t = list().find(x => x.id === id);
  if (!t) throw new Error('Task not found');
  t.lastRunAt = Date.now();
  store.saveSoon();
  const result = await execute(t);
  t.lastResult = result;
  bus.emit('event', { type: 'scheduleRan', detail: `${t.name}: ${result}` });
  bus.emit('schedule:changed');
  return { result };
}

function check() {
  const now = new Date();
  for (const t of list()) {
    if (isDue(t, now)) { log.info(`Running scheduled task ${t.name}`); runNow(t.id).catch(e => { t.lastResult = `Failed: ${e.message}`; bus.emit('event', { type: 'scheduleRan', detail: `${t.name} failed: ${e.message}` }); }); }
  }
}

function view() { return list().map(t => ({ ...t, nextRunAt: nextRun(t) })); }

module.exports = { ACTIONS, init, list, view, save, remove, runNow, isDue, nextRun, validate };
