'use strict';
// RAM Trimmer. Periodically asks Windows to trim the working set of chosen
// processes (K32EmptyWorkingSet). Memory the process isn't actively using is
// moved to the standby list / page file; the process keeps running and pages
// back in whatever it needs. It NEVER terminates, suspends or modifies any
// process, and system-critical processes are always skipped. The Roblox window you're
// using is never trimmed by the timer: it would have to load its memory straight back,
// which you'd see as a stutter.
const win32 = require('../native/win32');
const processes = require('./processes');
const settings = require('./settings');
const bus = require('../bus');
const log = require('../logger').scope('ramtrimmer');

const PROTECTED = new Set([
  'system', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe', 'lsaiso.exe',
  'svchost.exe', 'dwm.exe', 'fontdrvhost.exe', 'memcompression', 'secure system', 'sihost.exe', 'ctfmon.exe',
  'msmpeng.exe', 'nissrv.exe', 'securityhealthservice.exe', 'audiodg.exe', 'spoolsv.exe', 'wudfhost.exe', 'dllhost.exe',
  'taskhostw.exe', 'conhost.exe', 'runtimebroker.exe', 'searchindexer.exe', 'trustedinstaller.exe', 'explorer.exe',
]);

const state = { running: false, timer: null, runs: 0, totalFreed: 0, lastRun: null, lastFreed: 0, lastResults: [], lastError: null, nextRun: null };

function isProtected(name) {
  const n = name.toLowerCase();
  return PROTECTED.has(n) || n === require('path').basename(process.execPath).toLowerCase();
}

function candidates(cfg, skipPid = 0) {
  const snap = processes.snapshot(0);
  const minBytes = Math.max(0, cfg.minWorkingSetMB) * 1048576;
  const targets = new Set((cfg.targets || []).map(t => t.toLowerCase().trim()).filter(Boolean));
  return snap.filter(p => p.pid !== skipPid && !isProtected(p.name) && p.workingSet >= minBytes && (cfg.mode === 'all' || targets.has(p.name.toLowerCase())));
}

/** The Roblox client in front (left alone by automatic trims), or 0. */
function frontRoblox() {
  try { const pid = win32.foregroundPid(); return /^robloxplayerbeta\.exe$/i.test(win32.processInfo(pid)?.name || '') ? pid : 0; } catch { return 0; }
}

function trimNow(reason = 'manual') {
  if (!win32.available) throw new Error('The RAM Trimmer needs Windows.');
  const cfg = settings.get('ramTrimmer');
  const mem = win32.memoryStatus();
  if (reason === 'auto' && cfg.onlyAboveSystemPercent > 0 && mem && mem.loadPercent < cfg.onlyAboveSystemPercent) {
    state.lastRun = Date.now(); state.lastResults = []; state.lastFreed = 0;
    state.lastError = null; state.skipped = `RAM at ${mem.loadPercent}% — below your ${cfg.onlyAboveSystemPercent}% threshold, skipped.`;
    emit();
    return status();
  }
  state.skipped = null;
  const results = [];
  let freed = 0;
  for (const p of candidates(cfg, reason === 'auto' ? frontRoblox() : 0)) {
    const r = win32.trimWorkingSet(p.pid);
    const delta = Math.max(0, r.before - r.after);
    freed += delta;
    results.push({ pid: p.pid, name: p.name, ok: r.ok, beforeMB: Math.round(r.before / 1048576), afterMB: Math.round(r.after / 1048576), freedMB: Math.round(delta / 1048576), error: r.ok ? null : (r.error || 'Access denied') });
  }
  state.runs++; state.totalFreed += freed; state.lastFreed = freed; state.lastRun = Date.now(); state.lastResults = results;
  const failures = results.filter(r => !r.ok).length;
  state.lastError = failures && failures === results.length ? 'Windows denied access to every target. Run MultiMenu as administrator to trim elevated processes.' : null;
  log.info(`Trim (${reason}): ${results.length} processes, freed ${Math.round(freed / 1048576)} MB, ${failures} failed`);
  if (state.lastError) bus.emit('event', { type: 'trimmer', status: 'failed', error: state.lastError });
  emit();
  return status();
}

function schedule() {
  clearTimeout(state.timer);
  if (!state.running) return;
  const sec = Math.max(10, Number(settings.get('ramTrimmer.intervalSec')) || 60);
  state.nextRun = Date.now() + sec * 1000;
  state.timer = setTimeout(() => {
    try { trimNow('auto'); } catch (e) { state.lastError = e.message; bus.emit('event', { type: 'trimmer', status: 'failed', error: e.message }); }
    schedule();
  }, sec * 1000);
}

// Threshold watch: every 5 seconds, any Roblox client using more than
// ramTrimmer.watchMB is trimmed straight away (like the old AHK trimmer's
// "Threshold Limit"), instead of waiting for the next scheduled run. A client
// is trimmed at most once a minute so it isn't thrashed.
let watchTimer = null;
const lastWatchTrim = new Map(); // pid -> time
function overThreshold(clients, limitMB, now = Date.now(), last = lastWatchTrim) {
  if (!limitMB) return [];
  return clients.filter(c => c.workingSet / 1048576 > limitMB && now - (last.get(c.pid) || 0) > 60_000);
}
function watchTick() {
  if (!state.running) return;
  const limit = Number(settings.get('ramTrimmer.watchMB')) || 0;
  if (!limit) return;
  const procs = processes.robloxProcesses();
  for (const pid of lastWatchTrim.keys()) if (!procs.some(p => p.pid === pid)) lastWatchTrim.delete(pid);
  let freed = 0, n = 0;
  const front = frontRoblox();
  for (const p of overThreshold(procs.filter(p => p.pid !== front), limit)) {
    lastWatchTrim.set(p.pid, Date.now());
    const r = win32.trimWorkingSet(p.pid);
    if (r.ok) { n++; freed += Math.max(0, r.before - r.after); }
  }
  if (n) {
    state.totalFreed += freed; state.lastFreed = freed; state.watchTrims = (state.watchTrims || 0) + n;
    log.info(`Threshold watch: trimmed ${n} client(s) over ${limit} MB, freed ${Math.round(freed / 1048576)} MB`);
    emit();
  }
}
function startWatch() { clearInterval(watchTimer); watchTimer = setInterval(require('./lean').paced(() => { try { watchTick(); } catch (e) { log.warn(e.message); } }), 5000); }

function start() {
  if (!win32.available) throw new Error('The RAM Trimmer needs Windows.');
  if (state.running) return status();
  state.running = true;
  settings.set('ramTrimmer.enabled', true);
  bus.emit('event', { type: 'trimmer', status: 'started' });
  try { trimNow('auto'); } catch (e) { state.lastError = e.message; }
  schedule();
  startWatch();
  emit();
  return status();
}

function stop() {
  clearTimeout(state.timer);
  clearInterval(watchTimer);
  const was = state.running;
  state.running = false; state.nextRun = null;
  settings.set('ramTrimmer.enabled', false);
  if (was) bus.emit('event', { type: 'trimmer', status: 'stopped' });
  emit();
  return status();
}

function status() {
  const { timer: _timer, ...rest } = state;
  return { ...rest, totalFreedMB: Math.round(state.totalFreed / 1048576), lastFreedMB: Math.round(state.lastFreed / 1048576), available: win32.available, config: settings.get('ramTrimmer') };
}

function preview() {
  if (!win32.available) return [];
  return candidates(settings.get('ramTrimmer')).map(p => ({ pid: p.pid, name: p.name, memMB: Math.round(p.workingSet / 1048576) }));
}

function emit() { bus.emit('trimmer:update', status()); }

function reschedule() { if (state.running) schedule(); emit(); }

module.exports = { overThreshold, start, stop, trimNow, status, preview, reschedule, isProtected, PROTECTED };
