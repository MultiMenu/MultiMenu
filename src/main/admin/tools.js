'use strict';
// Admin mode: the window and process toolbox, profiling, caches, screenshots,
// crash tests and translation coverage.
const fs = require('fs');
const path = require('path');
const os = require('os');
const v8 = require('v8');
const { app, BrowserWindow, session, shell } = require('electron');
const paths = require('../paths');
const win32 = require('../native/win32');
const { anonymize } = require('./mask');
const { adminDir } = require('./data');

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const sub = (name) => { const d = path.join(adminDir(), name); fs.mkdirSync(d, { recursive: true }); return d; };

// ---------- windows ----------
// Window handles never leave the main process: the page gets short ids instead.
const handles = new Map();
let nextId = 1;

function listWindows({ all = false } = {}) {
  if (!win32.available) return { available: false, list: [] };
  const procs = require('../modules/processes');
  const sessions = (() => { try { return require('../modules/sessions').listSessions(); } catch { return []; } })();
  const byPid = new Map(sessions.filter(s => s.pid).map(s => [s.pid, s]));
  const snap = procs.snapshot(0);
  const procOf = new Map(snap.map(p => [p.pid, p]));
  const robloxPids = new Set(procs.robloxProcesses().map(p => p.pid));
  const own = new Set(app.getAppMetrics().map(m => m.pid));
  const tinykeep = require('../modules/tinykeep');
  handles.clear();
  const list = [];
  for (const w of win32.allWindows()) {
    const roblox = robloxPids.has(w.pid);
    if (!all && !roblox) continue;
    if (all && !w.title && !roblox) continue; // untitled helper windows are noise
    const id = String(nextId++);
    handles.set(id, { hwnd: w.hwnd, pid: w.pid });
    const rect = win32.windowRect(w.hwnd), client = win32.clientRect(w.hwnd);
    let style = null;
    try { style = `0x${(win32.windowStyle(w.hwnd) >>> 0).toString(16).padStart(8, '0')}`; } catch { /* no access */ }
    const p = procOf.get(w.pid), s = byPid.get(w.pid);
    list.push({
      id, pid: w.pid, className: w.className, title: w.title, roblox, own: own.has(w.pid),
      rect, client: client ? { width: client.width, height: client.height } : null, style,
      minimized: !!win32.isMinimized(w.hwnd), hung: !!win32.isHung(w.hwnd), keptTiny: tinykeep.sizeOf(w.pid),
      process: p ? { name: p.name, memMB: Math.round((p.workingSet || 0) / 1048576), cpu: +(p.cpuPercent || 0).toFixed(1) } : null,
      priority: (() => { try { return win32.getPriority(w.pid); } catch { return null; } })(),
      session: s ? { id: s.id, label: s.label, status: s.status, placeId: s.placeId } : null,
    });
  }
  return { available: true, list };
}

async function windowAction(id, action, arg = {}) {
  const w = handles.get(String(id));
  if (!w) throw new Error('That window is gone. Refresh the list.');
  if (!win32.isWindow(w.hwnd)) throw new Error('That window has closed.');
  const tinykeep = require('../modules/tinykeep');
  switch (action) {
    case 'focus': return win32.focusWindow(w.hwnd);
    case 'minimize': return win32.minimizeWindow(w.hwnd);
    case 'restore': return win32.restoreWindow(w.hwnd);
    case 'topmost': return win32.setTopmost(w.hwnd, !!arg.on);
    case 'close': return win32.postClose(w.hwnd);
    case 'title': return win32.setWindowTitle(w.hwnd, String(arg.title || '').slice(0, 120));
    case 'resize': {
      const r = win32.windowRect(w.hwnd) || { x: 0, y: 0 };
      const width = clamp(arg.width, 16, 7680), height = clamp(arg.height, 16, 4320);
      const ok = await win32.freeResize(w.hwnd, { x: arg.x ?? r.x, y: arg.y ?? r.y, width, height }, arg.x == null && arg.y == null);
      if (ok && arg.keep) tinykeep.keep(w.pid, width, height);
      return ok;
    }
    case 'release': tinykeep.release(w.pid); return true;
    case 'kill': return win32.terminate(w.pid);
    case 'priority': return win32.setPriority(w.pid, String(arg.value || 'normal'));
    case 'eco': return win32.setEco(w.pid, !!arg.on);
    case 'trim': return win32.trimWorkingSet(w.pid);
    default: throw new Error('Unknown action.');
  }
}

// ---------- MultiMenu's own processes and windows ----------
function ownProcesses() {
  const byPid = new Map();
  for (const w of BrowserWindow.getAllWindows()) {
    try { if (!w.isDestroyed()) byPid.set(w.webContents.getOSProcessId(), w.getTitle() || 'window'); } catch { /* closing */ }
  }
  return app.getAppMetrics().map(m => ({
    pid: m.pid, type: m.type, name: m.name || m.serviceName || byPid.get(m.pid) || '',
    cpu: +(m.cpu?.percentCPUUsage || 0).toFixed(1), wakeups: m.cpu?.idleWakeupsPerSecond || 0,
    memMB: Math.round((m.memory?.workingSetSize || 0) / 1024), privateMB: Math.round((m.memory?.privateBytes || 0) / 1024),
    sandboxed: m.sandboxed ?? null,
  }));
}

function ownWindows() {
  return BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).map((w) => {
    let file = '';
    try { file = path.basename(new URL(w.webContents.getURL()).pathname); } catch { /* blank */ }
    return { id: w.id, title: w.getTitle(), file, visible: w.isVisible(), focused: w.isFocused(), bounds: w.getBounds(), zoom: +w.webContents.getZoomFactor().toFixed(2), pid: w.webContents.getOSProcessId(), crashed: w.webContents.isCrashed() };
  });
}

// ---------- profiling ----------
function heapSnapshot() {
  const file = path.join(sub('profiles'), `main-${stamp()}.heapsnapshot`);
  v8.writeHeapSnapshot(file);
  return { name: path.basename(file), bytes: fs.statSync(file).size };
}

async function cpuProfile(seconds = 10) {
  const inspector = require('inspector');
  const s = new inspector.Session();
  s.connect();
  const post = (m, p = {}) => new Promise((res, rej) => s.post(m, p, (e, r) => (e ? rej(e) : res(r))));
  try {
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: 500 });
    await post('Profiler.start');
    await new Promise(r => setTimeout(r, clamp(seconds, 1, 60) * 1000));
    const { profile } = await post('Profiler.stop');
    const file = path.join(sub('profiles'), `main-${stamp()}.cpuprofile`);
    fs.writeFileSync(file, JSON.stringify(profile));
    return { name: path.basename(file), bytes: fs.statSync(file).size, samples: profile.samples?.length || 0 };
  } finally { try { s.disconnect(); } catch { /* closed */ } }
}

let gcFn = null;
function gc() {
  if (!gcFn) {
    v8.setFlagsFromString('--expose_gc');
    gcFn = require('vm').runInNewContext('gc');
  }
  const before = process.memoryUsage();
  gcFn();
  const after = process.memoryUsage();
  const mb = (n) => Math.round(n / 1048576 * 10) / 10;
  return { before: { heapMB: mb(before.heapUsed), rssMB: mb(before.rss) }, after: { heapMB: mb(after.heapUsed), rssMB: mb(after.rss) } };
}

// ---------- caches and folders ----------
function dirSize(dir, budget = { files: 200_000 }) {
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (budget.files-- <= 0) break;
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += dirSize(p, budget);
      else if (e.isFile()) total += fs.statSync(p).size;
    } catch { /* vanished */ }
  }
  return total;
}

function folders() {
  const ud = app.getPath('userData');
  const list = [
    ['chromium', 'Page cache', [path.join(ud, 'Cache'), path.join(ud, 'Code Cache'), path.join(ud, 'GPUCache'), path.join(ud, 'DawnGraphiteCache'), path.join(ud, 'DawnWebGPUCache'), path.join(ud, 'Shared Dictionary')], true],
    ['browse', 'Browse-as profiles', [path.join(ud, 'Partitions')], false],
    ['logs', 'Logs', [paths.logsDir()], false],
    ['backups', 'Backups', [paths.backupsDir()], false],
    ['updates', 'Update downloads', [paths.updatesDir()], true],
    ['macros', 'Macros', [paths.macrosDir()], false],
    ['snapshots', 'Admin snapshots', [path.join(adminDir(), 'snapshots')], false],
    ['profiles', 'Admin profiles', [path.join(adminDir(), 'profiles')], true],
    ['screenshots', 'Admin screenshots', [path.join(adminDir(), 'screenshots')], true],
  ];
  return list.map(([id, name, dirs, clearable]) => ({ id, name, bytes: dirs.reduce((n, d) => n + dirSize(d), 0), clearable }));
}

async function clearFolder(id) {
  switch (id) {
    case 'chromium':
      await session.defaultSession.clearCache();
      try { await session.defaultSession.clearCodeCaches({}); } catch { /* older Electron */ }
      await session.defaultSession.clearStorageData({ storages: ['shadercache', 'cachestorage'] });
      break;
    case 'updates': require('../modules/updater').reset(); break;
    case 'profiles': case 'screenshots': fs.rmSync(path.join(adminDir(), id), { recursive: true, force: true }); break;
    default: throw new Error('That folder cannot be cleared here.');
  }
  return folders();
}

const OPENABLE = {
  data: () => paths.dataDir, logs: () => paths.logsDir(), backups: () => paths.backupsDir(), updates: () => paths.updatesDir(), macros: () => paths.macrosDir(),
  app: () => path.dirname(process.execPath), admin: () => adminDir(), snapshots: () => sub('snapshots'), profiles: () => sub('profiles'), screenshots: () => sub('screenshots'),
};
async function openFolder(which) {
  const fn = OPENABLE[which];
  if (!fn) throw new Error('Unknown folder.');
  const dir = fn();
  fs.mkdirSync(dir, { recursive: true });
  const err = await shell.openPath(dir);
  if (err) throw new Error(err);
  return true;
}

// ---------- screenshots ----------
async function screenshot(win) {
  if (!win || win.isDestroyed()) throw new Error('The window is not open.');
  const img = await win.webContents.capturePage();
  const file = path.join(sub('screenshots'), `MultiMenu-${stamp()}.png`);
  fs.writeFileSync(file, img.toPNG());
  const { width, height } = img.getSize();
  return { name: path.basename(file), width, height };
}

function windowSize(win, width, height) {
  if (!win || win.isDestroyed()) throw new Error('The window is not open.');
  if (win.isMaximized()) win.unmaximize();
  if (win.isFullScreen()) win.setFullScreen(false);
  win.setContentSize(clamp(width, 400, 7680), clamp(height, 300, 4320));
  win.center();
  const [w, h] = win.getContentSize();
  return { width: w, height: h };
}

// ---------- crash tests ----------
function crash(kind, win) {
  const msg = '[TEST] Admin crash test';
  switch (kind) {
    case 'renderer':
      if (!win || win.isDestroyed()) throw new Error('The window is not open.');
      setTimeout(() => win.webContents.forcefullyCrashRenderer(), 300);
      return true;
    case 'main': setTimeout(() => { throw new Error(`${msg}: an uncaught error in the main process`); }, 50); return true;
    case 'rejection': setTimeout(() => { Promise.reject(new Error(`${msg}: an unhandled promise rejection`)); }, 50); return true;
    case 'hang': {
      // Blocks the main process for 6 seconds, like a stuck Windows call would.
      setTimeout(() => { const end = Date.now() + 6000; while (Date.now() < end) { /* busy */ } }, 300);
      return true;
    }
    case 'gpu': {
      const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
      w.loadURL('chrome://gpucrash').catch(() => {});
      setTimeout(() => { if (!w.isDestroyed()) w.destroy(); }, 4000);
      return true;
    }
    default: throw new Error('Unknown crash test.');
  }
}

// ---------- translations ----------
function i18nCoverage() {
  const i18n = require('../i18n');
  const dir = path.join(__dirname, '..', '..', 'i18n');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /^[a-z]{2,3}\.json$/.test(f)); } catch { /* none */ }
  const dicts = {};
  for (const f of files) { try { dicts[f.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { dicts[f.replace('.json', '')] = {}; } }
  const all = new Set();
  for (const d of Object.values(dicts)) for (const k of Object.keys(d)) all.add(k);
  const names = Object.fromEntries(i18n.LANGS.map(l => [l.id, l.english || l.name]));
  return {
    total: all.size, current: i18n.lang, pseudo: i18n.pseudo,
    languages: Object.entries(dicts).map(([id, d]) => {
      const missing = [...all].filter(k => !(k in d));
      const same = Object.entries(d).filter(([k, v]) => k === v && /[a-z]{4}/i.test(k)).length;
      return { id, name: names[id] || id, count: Object.keys(d).length, missing: missing.slice(0, 100), missingCount: missing.length, same };
    }).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

// ---------- system ----------
let lastCpu = { usage: process.cpuUsage(), at: process.hrtime.bigint() };
function mainCpu() {
  const now = process.hrtime.bigint(), usage = process.cpuUsage();
  const elapsedUs = Number(now - lastCpu.at) / 1000;
  const used = (usage.user - lastCpu.usage.user) + (usage.system - lastCpu.usage.system);
  lastCpu = { usage, at: now };
  return elapsedUs > 0 ? +Math.min(100, (used / elapsedUs) * 100).toFixed(1) : 0;
}

function resources() {
  const out = {};
  for (const k of process.getActiveResourcesInfo?.() || []) out[k] = (out[k] || 0) + 1;
  return out;
}

function system() {
  const cpus = os.cpus();
  let mem = null;
  try { mem = win32.available ? win32.memoryStatus() : null; } catch { /* no access */ }
  return {
    os: `${os.type()} ${os.release()}`, arch: os.arch(), cpus: cpus.length, cpuModel: cpus[0]?.model?.trim() || '', totalGB: +(os.totalmem() / 1073741824).toFixed(1), freeGB: +(os.freemem() / 1073741824).toFixed(1),
    uptimeH: +(os.uptime() / 3600).toFixed(1), wine: (() => { try { return !!win32.isWine(); } catch { return false; } })(), memoryLoad: mem?.loadPercent ?? null,
  };
}

function versions() {
  let koffi = null;
  try { koffi = require('koffi/package.json').version; } catch { /* not installed */ }
  return { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8, koffi };
}

function pathsInfo() {
  const p = { exe: process.execPath, app: app.getAppPath(), data: paths.dataDir, logs: paths.logsDir(), userData: app.getPath('userData'), temp: app.getPath('temp') };
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, anonymize(v)]));
}

module.exports = {
  listWindows, windowAction, ownProcesses, ownWindows, heapSnapshot, cpuProfile, gc, folders, clearFolder, openFolder,
  screenshot, windowSize, crash, i18nCoverage, mainCpu, resources, system, versions, pathsInfo,
};
