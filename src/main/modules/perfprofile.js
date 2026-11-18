'use strict';
// Alt performance: how hard your alts work your PC. Three presets plus
// fine-tuning: FPS cap, lowest graphics, lighter rendering (allowlisted Fast
// Flags, see rflags.js), and what happens once a client reaches a game
// (minimise it, shrink it to a tiny window, mute it). Main accounts always
// launch at full quality. Changes apply from the next launch.
const os = require('os');
const settings = require('./settings');
const accounts = require('./accounts');
const sessions = require('./sessions');
const processes = require('./processes');
const win32 = require('../native/win32');
const rflags = require('./rflags');
const bus = require('../bus');
const log = require('../logger').scope('perf');

const PRESETS = {
  maxAlts: {
    label: 'Max alts', desc: 'Most alts, least detail.',
    facts: ['10 FPS', 'Lowest graphics', 'Start alts tiny', 'Minimise once in game', 'Mute once in game', 'Lighter rendering', 'Eco mode for background alts', 'RAM Trimmer every 5 min', 'Main accounts keep full quality'],
    values: {
      'perf.fpsCap': 10, 'perf.lowGraphics': true, 'perf.lighter': true,
      'perf.flags.msaa': 'x1', 'perf.flags.texture': 'lowest', 'perf.flags.mode': 'default', 'perf.flags.graySky': true, 'perf.flags.noGrass': true, 'perf.flags.lowestQuality': true, 'perf.flags.pauseLighting': true,
      'perf.minimize': true, 'perf.tiny': true, 'perf.tinyW': 240, 'perf.tinyH': 180, 'perf.mute': true,
      'limiter.eco': true, 'ramTrimmer.intervalSec': 300, 'ramTrimmer.enabled': true,
    },
  },
  potato: {
    label: 'Potato', desc: 'For AFK farming: the least Roblox will draw.',
    facts: ['5 FPS', 'Lowest graphics', 'Every lighter-rendering option', 'Grey sky, no grass, lighting paused', 'Reduce motion', 'Start alts tiny', 'Minimise once in game', 'Mute once in game', 'Eco mode for background alts', 'RAM Trimmer every 5 min', 'Main accounts keep full quality'],
    values: {
      'perf.fpsCap': 5, 'perf.lowGraphics': true, 'perf.lighter': true, 'perf.reducedMotion': true,
      'perf.flags.msaa': 'x1', 'perf.flags.texture': 'lowest', 'perf.flags.mode': 'default', 'perf.flags.graySky': true, 'perf.flags.noGrass': true, 'perf.flags.lowestQuality': true, 'perf.flags.pauseLighting': true,
      'perf.minimize': true, 'perf.tiny': true, 'perf.tinyW': 240, 'perf.tinyH': 180, 'perf.mute': true,
      'limiter.eco': true, 'ramTrimmer.intervalSec': 300, 'ramTrimmer.enabled': true,
    },
  },
  balanced: {
    label: 'Balanced', desc: 'A good start for most PCs.',
    facts: ['30 FPS', 'Lowest graphics', 'Stay on screen', 'Lighter rendering', 'Mute once in game', 'Eco mode for background alts', 'RAM Trimmer every 10 min'],
    values: {
      'perf.fpsCap': 30, 'perf.lowGraphics': true, 'perf.lighter': true,
      'perf.flags.msaa': 'x1', 'perf.flags.texture': 'lowest', 'perf.flags.mode': 'default', 'perf.flags.graySky': false, 'perf.flags.noGrass': true, 'perf.flags.lowestQuality': true, 'perf.flags.pauseLighting': false,
      'perf.minimize': false, 'perf.tiny': false, 'perf.mute': true,
      'limiter.eco': true, 'ramTrimmer.intervalSec': 600, 'ramTrimmer.enabled': true,
    },
  },
  defaults: {
    label: 'Roblox defaults', desc: 'MultiMenu leaves Roblox as it is.',
    facts: ['No FPS cap', 'Your own graphics', 'Stay on screen', 'No eco mode or trimming'],
    values: { 'perf.fpsCap': 0, 'perf.lowGraphics': false, 'perf.lighter': false, 'perf.reducedMotion': false, 'perf.minimize': false, 'perf.tiny': false, 'perf.mute': false, 'limiter.eco': false, 'ramTrimmer.enabled': false },
  },
};
const ORDER = ['potato', 'maxAlts', 'balanced', 'defaults'];

const get = (all, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), all);
/** Pure: the preset your settings match, or null ("your own mix"). */
function current(all) { return ORDER.find(id => Object.entries(PRESETS[id].values).every(([k, v]) => get(all, k) === v)) || null; }
/** Pure: what applying `values` would change: [{ key, from, to }]. */
function diff(all, values) { return Object.entries(values).filter(([k, v]) => get(all, k) !== v).map(([key, to]) => ({ key, from: get(all, key), to })); }

const isLight = (acc) => !!acc && accounts.publicView(acc).tier !== 'main';
/** Pure: what a launch gives an account. Main accounts get nothing (full quality). */
function launchPlan(acc, cfg) {
  if (!isLight(acc)) return { light: false, graphics: null, flags: null };
  const g = {};
  if (cfg.fpsCap > 0) g.fpsCap = cfg.fpsCap;
  if (cfg.lowGraphics) g.quality = 1;
  if (cfg.reducedMotion) g.reducedMotion = true;
  return { light: true, graphics: Object.keys(g).length ? g : null, flags: cfg.lighter ? rflags.flagsOf(cfg.flags) : null };
}

// ---------- launch hooks (called from sessions.doLaunch, one launch at a time) ----------
let warnedBootstrapper = false;
/** Writes lighter-rendering flags for this launch. Returns an undo function or null. */
function beforeLaunch(acc, exePath) {
  const plan = launchPlan(acc, settings.get('perf'));
  if (!plan.flags) return null;
  const method = settings.get('openMulti.launchMethod');
  if (method === 'bloxstrap' || method === 'fishstrap') {
    if (!warnedBootstrapper) { warnedBootstrapper = true; bus.emit('notify', { level: 'info', title: 'Lighter rendering', message: 'Bloxstrap and Fishstrap use their own Fast Flags. Set these in their Fast Flag editor instead.' }); }
    return null;
  }
  const exe = exePath || sessions.findRobloxPlayer();
  if (!exe) return null;
  return rflags.apply(require('path').dirname(exe), plan.flags);
}
/** Waits until the client has opened its window (it has read its flags by then), at most 30 s. */
async function waitForWindow(pid, maxMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try { if (pid && win32.robloxWindows([pid]).length) { await new Promise(r => setTimeout(r, 2000)); return true; } } catch { /* keep waiting */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

// ---------- once a client reaches a game ----------
const joined = new Set();
async function onJoined(p) {
  joined.add(p.id);
  const s = sessions.getRaw(p.id);
  if (!s || s.external || !s.pid || !win32.available) return;
  const acc = s.accountId ? accounts.find(s.accountId) : null;
  if (!isLight(acc)) return;
  const c = settings.get('perf');
  const w = require('./wall').gameWindows([s.pid]).get(s.pid);
  if (w && c.tiny) {
    // Past Roblox's minimum window size, the RoALT way, and kept that small (tinykeep).
    try { await require('./tinykeep').makeTiny(s.pid, w.hwnd, c.tinyW, c.tinyH); } catch (e) { log.warn(`tiny: ${e.message}`); }
  }
  if (w && c.minimize) {
    try { await require('./wall').remember(s.id); } catch { /* picture is optional */ }
    try { win32.minimizeNoActivate(w.hwnd); } catch (e) { log.warn(`minimise: ${e.message}`); }
  }
  if (c.mute) require('./audio').setMute([s.pid], true).catch(e => log.warn(`mute: ${e.message}`));
}

// ---------- For this PC: measure what one client costs ----------
function cpuTimes() { return os.cpus().reduce((a, c) => { const t = c.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, total: 0 }); }

/** Pure (unit-tested): the plan for `planned` clients from one measurement. */
function plan({ planned, memPerMB, cpuPer, totalMB, freeMB, robloxMB, systemCpu, robloxCpu, currentPreset }) {
  const baseMB = Math.max(0, totalMB - freeMB - robloxMB);
  const otherCpu = Math.max(0, systemCpu - robloxCpu);
  const ramPct = Math.round(((baseMB + planned * memPerMB) / totalMB) * 100);
  const cpuPct = Math.round(otherCpu + planned * cpuPer);
  const tier = ramPct <= 75 && cpuPct <= 70 ? 'light' : ramPct <= 90 && cpuPct <= 90 ? 'tight' : 'over';
  const fits = Math.max(0, Math.floor(Math.min((totalMB * 0.85 - baseMB) / Math.max(200, memPerMB), (90 - otherCpu) / Math.max(0.5, cpuPer))));
  const values = {}, reasons = [];
  let preset = null;
  if (tier !== 'light') {
    preset = tier === 'over' ? 'maxAlts' : currentPreset === 'maxAlts' ? null : 'balanced';
    if (cpuPct > 70) { values['perf.fpsCap'] = tier === 'over' ? 10 : 30; reasons.push(`Each alt uses about ${cpuPer.toFixed(1)}% CPU. A lower FPS cap cuts that the most.`); }
    if (ramPct > 75) { values['perf.lighter'] = true; values['perf.lowGraphics'] = true; values['ramTrimmer.enabled'] = true; reasons.push(`Each alt uses about ${Math.round(memPerMB)} MB of memory. Lighter rendering and lowest graphics save the most.`); }
  }
  if (planned >= 6) { values['perf.minimize'] = true; reasons.push('With many alts, minimised windows save GPU time.'); }
  if (!reasons.length) reasons.push('Your PC has room for this. No changes needed.');
  return { planned, ramPct, cpuPct, tier, fits, memPerMB: Math.round(memPerMB), cpuPer: +cpuPer.toFixed(1), preset, values, reasons };
}

let measuring = null;
async function measure(planned) {
  if (measuring) return measuring;
  measuring = (async () => {
    const live = sessions.listSessions().filter(s => s.status === 'running' && s.pid && (joined.has(s.id) || s.watchState === 'in game'));
    if (!live.length) throw new Error('Start a client and let it reach a game first.');
    const pids = new Set(live.map(s => s.pid));
    await new Promise(r => setTimeout(r, 3000));
    let mem = 0, cpu = 0, sys = 0, rounds = 0, prev = cpuTimes();
    processes.robloxProcesses(); // first call primes the CPU counters
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 2500));
      const procs = processes.robloxProcesses().filter(p => pids.has(p.pid));
      if (!procs.length) break;
      const cur = cpuTimes();
      const busy = cur.total > prev.total ? 100 * (1 - (cur.idle - prev.idle) / (cur.total - prev.total)) : 0;
      prev = cur;
      mem += procs.reduce((a, p) => a + p.workingSet / 1048576, 0) / procs.length;
      cpu += procs.reduce((a, p) => a + p.cpuPercent, 0) / procs.length;
      sys += busy; rounds++;
    }
    if (!rounds) throw new Error('The client closed while it was being measured.');
    const memPerMB = mem / rounds, cpuPer = cpu / rounds;
    const all = processes.robloxProcesses();
    const robloxMB = all.reduce((a, p) => a + p.workingSet / 1048576, 0);
    const robloxCpu = all.reduce((a, p) => a + p.cpuPercent, 0);
    const r = plan({ planned: Math.max(1, Math.min(60, Number(planned) || 1)), memPerMB, cpuPer, totalMB: os.totalmem() / 1048576, freeMB: os.freemem() / 1048576, robloxMB, systemCpu: sys / rounds, robloxCpu, currentPreset: current(settings.all()) });
    log.info(`Measured ${live.length} client(s): ${r.memPerMB} MB, ${r.cpuPer}% CPU each; ${r.planned} planned → ${r.tier}`);
    return { ...r, measured: live.length, at: Date.now() };
  })();
  try { return await measuring; } finally { measuring = null; }
}

function init() {
  bus.on('session:joined', (p) => onJoined(p).catch(e => log.warn(e.message)));
  bus.on('session:stopped', (p) => joined.delete(p.id));
  try { rflags.restoreAll(); } catch (e) { log.warn(e.message); }
}

function info() {
  return {
    presets: Object.fromEntries(ORDER.map(id => [id, { label: PRESETS[id].label, desc: PRESETS[id].desc, facts: PRESETS[id].facts, values: PRESETS[id].values }])),
    order: ORDER, current: current(settings.all()), bootstrapper: ['bloxstrap', 'fishstrap'].includes(settings.get('openMulti.launchMethod')), options: rflags.OPTIONS,
  };
}

module.exports = { init, info, current, diff, launchPlan, beforeLaunch, waitForWindow, onJoined, measure, plan, PRESETS, ORDER, isLight };
