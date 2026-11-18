'use strict';
// Shared process snapshot with per-process CPU %. One snapshot is cached and
// reused by sessions, the performance centre and the RAM trimmer so we never
// enumerate processes more often than needed.
const os = require('os');
const win32 = require('../native/win32');

const ROBLOX_EXE = 'RobloxPlayerBeta.exe';
let last = { at: 0, list: [] };
let prevCpu = new Map(); // pid -> { cpuMs, at }

function snapshot(maxAgeMs = 900) {
  if (!win32.available) return [];
  const now = Date.now();
  if (now - last.at < maxAgeMs) return last.list;
  const cores = os.cpus().length || 1;
  const list = win32.snapshotProcesses();
  const next = new Map();
  for (const p of list) {
    const prev = prevCpu.get(p.pid);
    p.cpuPercent = prev && now > prev.at ? Math.max(0, Math.min(100, ((p.cpuMs - prev.cpuMs) / (now - prev.at)) * 100 / cores)) : 0;
    next.set(p.pid, { cpuMs: p.cpuMs, at: now });
  }
  prevCpu = next;
  last = { at: now, list };
  return list;
}

const robloxProcesses = () => snapshot().filter(p => p.name.toLowerCase() === ROBLOX_EXE.toLowerCase());

function top(n = 25) {
  return snapshot().slice().sort((a, b) => b.workingSet - a.workingSet).slice(0, n)
    .map(p => ({ pid: p.pid, name: p.name, memMB: Math.round(p.workingSet / 1048576), cpu: +p.cpuPercent.toFixed(1) }));
}

module.exports = { ROBLOX_EXE, snapshot, robloxProcesses, top };
