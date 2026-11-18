'use strict';
// System monitor: CPU, RAM, GPU, Roblox totals, history for charts, and
// high-usage alerts. Sampling slows down automatically in low-resource mode.
const os = require('os');
const { spawn } = require('child_process');
const win32 = require('../native/win32');
const processes = require('./processes');
const settings = require('./settings');
const bus = require('../bus');
const log = require('../logger').scope('system');

const HISTORY = 150;
const history = [];
let prevCpu = null;
let timer = null;
let gpu = { value: null, status: 'off', proc: null, lastAt: 0 };
let alertState = { ram: 0, cpu: 0, ramFired: false, cpuFired: false };
let latest = null;
let idle = false;

function cpuPercent() {
  const t = os.cpus().reduce((acc, c) => {
    const tot = Object.values(c.times).reduce((a, b) => a + b, 0);
    acc.total += tot; acc.idle += c.times.idle; return acc;
  }, { total: 0, idle: 0 });
  let pct = 0;
  if (prevCpu) {
    const dt = t.total - prevCpu.total, di = t.idle - prevCpu.idle;
    pct = dt > 0 ? (1 - di / dt) * 100 : 0;
  }
  prevCpu = t;
  return Math.max(0, Math.min(100, pct));
}

function ram() {
  if (win32.available) {
    const m = win32.memoryStatus();
    if (m) return { total: m.total, used: m.total - m.available, percent: m.loadPercent };
  }
  const total = os.totalmem(), free = os.freemem();
  return { total, used: total - free, percent: ((total - free) / total) * 100 };
}

// GPU usage comes from Windows performance counters. Reading them requires a
// PowerShell process, so it is a visible, documented child process that can be
// turned off in Settings -> Performance.
const GPU_SCRIPT = `$ErrorActionPreference='SilentlyContinue'
while ($true) {
  $s = (Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage').CounterSamples
  if ($s) { $v = ($s | Measure-Object -Property CookedValue -Sum).Sum; [Console]::Out.WriteLine([math]::Round([math]::Min(100,$v),1)) } else { [Console]::Out.WriteLine('NA') }
  [Console]::Out.Flush()
  Start-Sleep -Seconds 3
}`;

function startGpu() {
  if (gpu.proc || process.platform !== 'win32') { if (process.platform !== 'win32') gpu.status = 'unsupported'; return; }
  try {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', GPU_SCRIPT], { windowsHide: true });
    gpu = { value: null, status: 'starting', proc: p, lastAt: Date.now() };
    let buf = '';
    p.stdout.on('data', d => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const l of lines) {
        if (l.trim() === 'NA') { gpu.status = 'unavailable'; gpu.value = null; }
        else if (!isNaN(parseFloat(l))) { gpu.value = parseFloat(l); gpu.status = 'ok'; gpu.lastAt = Date.now(); }
      }
    });
    p.on('exit', () => { if (gpu.proc === p) { gpu.proc = null; if (gpu.status !== 'off') gpu.status = 'unavailable'; } });
    p.on('error', () => { gpu.status = 'unavailable'; gpu.proc = null; });
  } catch (e) { gpu.status = 'unavailable'; log.warn('GPU monitor failed', e.message); }
}

function stopGpu() {
  if (gpu.proc) { try { gpu.proc.kill(); } catch { /* gone */ } }
  gpu = { value: null, status: 'off', proc: null, lastAt: 0 };
}

function sample() {
  const cpu = cpuPercent();
  const r = ram();
  const rob = processes.robloxProcesses();
  const s = {
    t: Date.now(), cpu: +cpu.toFixed(1), ramPercent: +r.percent.toFixed(1), ramUsed: r.used, ramTotal: r.total,
    gpu: gpu.status === 'ok' ? gpu.value : null, gpuStatus: gpu.status,
    roblox: { count: rob.length, memMB: Math.round(rob.reduce((a, p) => a + p.workingSet, 0) / 1048576), cpu: +rob.reduce((a, p) => a + p.cpuPercent, 0).toFixed(1) },
    appMemMB: Math.round(process.memoryUsage().rss / 1048576),
  };
  history.push({ t: s.t, cpu: s.cpu, ram: s.ramPercent, gpu: s.gpu, roblox: s.roblox.memMB });
  if (history.length > HISTORY) history.shift();
  latest = s;
  checkAlerts(s);
  bus.emit('system:sample', s);
}

function checkAlerts(s) {
  const p = settings.get('performance');
  const interval = intervalMs() / 1000;
  const sustain = Math.max(5, p.alertSustainSec);
  alertState.ram = s.ramPercent >= p.alertRamPercent ? alertState.ram + interval : 0;
  alertState.cpu = s.cpu >= p.alertCpuPercent ? alertState.cpu + interval : 0;
  if (alertState.ram >= sustain && !alertState.ramFired) {
    alertState.ramFired = true;
    bus.emit('event', { type: 'highUsage', detail: `RAM at ${s.ramPercent}% for ${sustain}s` });
  } else if (alertState.ram === 0) alertState.ramFired = false;
  if (alertState.cpu >= sustain && !alertState.cpuFired) {
    alertState.cpuFired = true;
    bus.emit('event', { type: 'highUsage', detail: `CPU at ${s.cpu}% for ${sustain}s` });
  } else if (alertState.cpu === 0) alertState.cpuFired = false;
}

function intervalMs() {
  const p = settings.get('performance');
  const base = Math.max(1, Number(p.monitorIntervalSec) || 2);
  if (idle) return Math.max(base, 10) * 1000;
  return (p.lowResourceMode ? Math.max(base, 5) : base) * 1000;
}

/** Idle mode: MultiMenu is hidden, so sample less often and stop the GPU reader.
 *  Session monitoring, the watcher and automation keep running normally. */
function setIdle(on) {
  const want = !!on && settings.get('performance.idleMode');
  if (want === idle) return;
  idle = want;
  start();
  bus.emit('system:idle', idle);
}

function start() {
  stop();
  cpuPercent();
  const p = settings.get('performance');
  if (p.gpuMonitoring && !p.lowResourceMode && !idle) startGpu(); else stopGpu();
  timer = setInterval(() => { try { sample(); } catch (e) { log.error('sample failed', e); } }, intervalMs());
  setTimeout(sample, 500);
}
function stop() { clearInterval(timer); timer = null; }
function shutdown() { stop(); stopGpu(); }

function info() {
  return {
    cpuModel: os.cpus()[0]?.model || 'Unknown CPU', cores: os.cpus().length, totalRam: os.totalmem(),
    platform: `${os.type()} ${os.release()}`, native: win32.available,
  };
}

/** Rule-based, safe suggestions. Nothing here changes system settings by itself. */
function recommendations() {
  const s = latest;
  if (!s) return [];
  const out = [];
  const trim = settings.get('ramTrimmer');
  if (s.ramPercent > 80 && !trim.enabled) out.push({ id: 'trim', level: 'warn', text: `RAM is at ${s.ramPercent}%. Turning on the RAM Trimmer can free memory held by idle Roblox clients.`, action: 'enableTrimmer' });
  if (s.roblox.count >= 3) out.push({ id: 'gfx', level: 'info', text: `${s.roblox.count} Roblox clients are open. Setting graphics to Low cuts GPU and RAM use for each one.`, action: 'graphicsLow' });
  if (s.cpu > 85) out.push({ id: 'cap', level: 'warn', text: `CPU is at ${s.cpu}%. Capping Roblox at 30–60 FPS reduces CPU load.`, action: 'fpsCap60' });
  if (!settings.get('performance.lowResourceMode') && s.ramPercent > 85) out.push({ id: 'lowres', level: 'info', text: 'Low-resource mode turns off MultiMenu\'s animations and slows its monitoring to save CPU and RAM.', action: 'lowResource' });
  if (s.gpu != null && s.gpu > 90) out.push({ id: 'gpu', level: 'warn', text: `GPU is at ${s.gpu}%. Lower Roblox graphics quality or cap FPS.`, action: 'graphicsLow' });
  if (!out.length) out.push({ id: 'ok', level: 'ok', text: 'Everything looks healthy. No changes recommended right now.' });
  return out;
}

module.exports = { setIdle, isIdle: () => idle, start, stop, shutdown, history: () => history, latest: () => latest, info, recommendations, restartGpu: () => { stopGpu(); start(); } };
