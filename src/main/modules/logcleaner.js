'use strict';
// Roblox log cleaner. Roblox writes a new log file for every client and never
// deletes them, so %LOCALAPPDATA%\Roblox\logs can grow to gigabytes. When
// switched on, once an hour this deletes logs older than the age you set, then
// the oldest ones until the folder is under the size limit. Logs that a running
// client is using (or that changed in the last 10 minutes) are never touched.
const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const logs = require('./robloxlogs');
const log = require('../logger').scope('logcleaner');

const state = { lastRun: null, lastDeleted: 0, lastFreedMB: 0, totalMB: null, files: null };
let timer = null;

/** Pure: which files to delete. files = [{ path, size, mtime, busy }]. Exported for tests. */
function plan(files, now, { maxAgeHours = 24, maxTotalMB = 50 } = {}) {
  const fresh = (f) => f.busy || now - f.mtime < 10 * 60_000;
  const del = new Set();
  if (maxAgeHours > 0) for (const f of files) if (!fresh(f) && now - f.mtime > maxAgeHours * 3600_000) del.add(f);
  if (maxTotalMB > 0) {
    let total = files.filter(f => !del.has(f)).reduce((a, f) => a + f.size, 0);
    for (const f of files.filter(f => !del.has(f) && !fresh(f)).sort((a, b) => a.mtime - b.mtime)) {
      if (total <= maxTotalMB * 1048576) break;
      del.add(f); total -= f.size;
    }
  }
  return [...del];
}

function scan() {
  const dir = logs.logsDir();
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(log|txt)$/i.test(name)) continue;
    const p = path.join(dir, name);
    try { const st = fs.statSync(p); if (st.isFile()) out.push({ path: p, size: st.size, mtime: st.mtimeMs, busy: logs.isClaimed(p) }); } catch { /* gone */ }
  }
  return out;
}

function run(force = false) {
  const cfg = settings.get('robloxLogs');
  const files = scan();
  const victims = cfg.clean || force ? plan(files, Date.now(), cfg) : [];
  let n = 0, freed = 0;
  for (const f of victims) {
    try { fs.rmSync(f.path); n++; freed += f.size; } catch { /* in use by Roblox: try next time */ }
  }
  Object.assign(state, { lastRun: Date.now(), lastDeleted: n, lastFreedMB: Math.round(freed / 1048576), files: files.length - n, totalMB: Math.round((files.reduce((a, f) => a + f.size, 0) - freed) / 1048576) });
  if (n) log.info(`Deleted ${n} old Roblox logs (${state.lastFreedMB} MB)`);
  return status();
}

function start() {
  clearInterval(timer);
  timer = setInterval(() => { try { if (settings.get('robloxLogs.clean')) run(); } catch (e) { log.warn(e.message); } }, 3600_000);
  setTimeout(() => { try { if (settings.get('robloxLogs.clean')) run(); } catch (e) { log.warn(e.message); } }, 90_000);
}

function status() {
  if (state.totalMB == null) { try { const f = scan(); state.files = f.length; state.totalMB = Math.round(f.reduce((a, x) => a + x.size, 0) / 1048576); } catch { /* no folder */ } }
  return { ...state, config: settings.get('robloxLogs'), dir: logs.logsDir() };
}

module.exports = { plan, run, start, status };
