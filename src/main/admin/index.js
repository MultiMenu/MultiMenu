'use strict';
// Admin mode: private developer tools inside MultiMenu.
//
// It only switches on with a code signed by the private key in the MultiMenu Dev
// Console (see codes.js), so it is safe to ship in public builds. Even when on it
// never shows, logs or exports cookies, passwords, tokens or webhook links:
// everything passes through mask.js first. Admin pages are English only.
const path = require('path');
const { performance, monitorEventLoopDelay } = require('perf_hooks');
const { app, dialog, Notification } = require('electron');
const fs = require('fs');
const paths = require('../paths');
const bus = require('../bus');
const logger = require('../logger');
const { JsonStore } = require('../store');
const codes = require('./codes');
const { mask, maskString, brief, anonymize, safeUrl } = require('./mask');
const data = require('./data');
const tools = require('./tools');

const log = logger.scope('admin');

function loadKeys() {
  try {
    const k = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys.json'), 'utf8'));
    return { keys: Array.isArray(k.keys) ? k.keys.filter(x => typeof x === 'string') : [], revoked: Array.isArray(k.revoked) ? k.revoked : [] };
  } catch { return { keys: [], revoked: [] }; }
}
const KEYS = loadKeys();

/** Lab switches. The page applies the visual ones; verbose and pseudo work here. */
const FLAGS = { inspector: false, outlines: false, slow: false, fps: false, pseudo: false, verbose: false, demoBadge: true };
const OPEN = new Set(['admin:status', 'admin:unlock']);
const LIMIT = { log: 1000, bus: 800, ipc: 800, net: 500 };
const MAX_TRIES = 8, TRY_WINDOW_MS = 10 * 60_000;

let ctx = null;
let store = null;
let who = null; // { id, name, iat, exp } while unlocked
let demo = false; // sample data in the windows, until restart
let watching = false; // a page is showing the live feed
let eld = null;
let offLog = null, origEmit = null, hadOwnEmit = false, tappedEmit = null, origFetch = null, tappedFetch = null;
const feed = { log: [], bus: [], ipc: [], net: [] };
let outbox = null, outTimer = null;
const ipcStats = new Map();
const tries = [];

// ---------- unlock ----------
function init(context) {
  if (context) ctx = context;
  if (store) return;
  store = new JsonStore(path.join(data.adminDir(), 'admin.json'), { code: null, flags: { ...FLAGS } });
  const code = store.get('code');
  if (!code) return;
  const v = codes.verify(code, { ...KEYS });
  if (v.ok) activate(v);
  else { log.info(`Admin mode switched off: ${v.reason}`); store.set('code', null); }
}

function flags() { return { ...FLAGS, ...(store?.get('flags') || {}) }; }

function activate(v) {
  who = v;
  installTaps();
  const f = flags();
  logger.setVerbose(f.verbose);
  if (f.pseudo) { try { require('../i18n').setPseudo(true); } catch { /* i18n not loaded */ } }
  log.info(`Admin mode on (${v.name}, code ${v.id}${v.exp ? `, until ${new Date(v.exp).toISOString().slice(0, 10)}` : ''})`);
}

function deactivate() {
  who = null; demo = false; watching = false;
  removeTaps();
  logger.setVerbose(false);
  try { require('../i18n').setPseudo(false); } catch { /* i18n not loaded */ }
}

function isUnlocked() {
  if (!who) return false;
  if (who.exp && who.exp < Date.now()) {
    log.info('Admin code expired');
    store?.set('code', null);
    deactivate();
    return false;
  }
  return true;
}

function status() {
  if (!isUnlocked()) return { unlocked: false };
  return { unlocked: true, name: who.name, id: who.id, iat: who.iat, exp: who.exp, flags: flags(), demo, keys: KEYS.keys.map(codes.fingerprint) };
}

function unlock(code) {
  const now = Date.now();
  while (tries.length && now - tries[0] > TRY_WINDOW_MS) tries.shift();
  if (tries.length >= MAX_TRIES) throw new Error('Too many tries. Wait a few minutes.');
  tries.push(now);
  if (!store) init(ctx);
  const clean = String(code || '').replace(/\s+/g, '').slice(0, 1200);
  const v = codes.verify(clean, { ...KEYS });
  if (!v.ok) { log.info(`Admin code refused: ${v.reason}`); throw new Error(v.reason); }
  store.set('code', clean);
  store.saveNow();
  activate(v);
  return status();
}

function lock() {
  if (store) { store.set('code', null); store.saveNow(); }
  deactivate();
  log.info('Admin mode locked');
  reloadWindows();
  return { unlocked: false };
}

/** The dispatcher asks this before running any admin:* command. */
function blocked(channel) {
  if (OPEN.has(channel)) return null;
  return isUnlocked() ? null : 'Admin mode is locked.';
}

function reloadWindows(delay = 250) {
  setTimeout(() => {
    for (const w of require('../main-windows').all()) { try { if (w && !w.isDestroyed()) w.webContents.reload(); } catch { /* closing */ } }
  }, delay);
}

// ---------- live feeds ----------
function push(kind, entry) {
  const b = feed[kind];
  b.push(entry);
  if (b.length > LIMIT[kind] + 100) b.splice(0, b.length - LIMIT[kind]);
  if (!watching) return;
  if (!outbox) outbox = { log: [], bus: [], ipc: [], net: [] };
  outbox[kind].push(entry);
  if (!outTimer) outTimer = setTimeout(flushOut, 400);
}
function flushOut() {
  outTimer = null;
  const out = outbox;
  outbox = null;
  if (out && watching) bus.emit('admin:feed', out);
}

function installTaps() {
  if (!offLog) offLog = logger.onLine((l) => push('log', { at: l.at, level: l.level, scope: l.scope, msg: anonymize(l.msg).slice(0, 2000) }));
  if (!origEmit) {
    hadOwnEmit = Object.prototype.hasOwnProperty.call(bus, 'emit');
    origEmit = bus.emit;
    tappedEmit = function (name, ...args) {
      if (who && typeof name === 'string' && !name.startsWith('admin:')) {
        try { push('bus', { at: Date.now(), name, listeners: bus.listenerCount(name), data: brief(args[0], 300) }); } catch { /* never break the bus */ }
        if (logger.verbose && name !== 'system:sample') log.debug(`bus ${name}`);
      }
      return origEmit.call(this, name, ...args);
    };
    bus.emit = tappedEmit;
  }
  if (!origFetch && typeof globalThis.fetch === 'function') {
    origFetch = globalThis.fetch;
    tappedFetch = async function (input, init) {
      if (!who) return origFetch(input, init);
      const t0 = performance.now();
      let url = '';
      try { url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input?.url || ''); } catch { /* odd input */ }
      const method = String(init?.method || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
      const where = safeUrl(url);
      try {
        const res = await origFetch(input, init);
        push('net', { at: Date.now(), method, host: where.host, path: where.path, status: res.status, ms: Math.round(performance.now() - t0) });
        if (logger.verbose) log.debug(`net ${method} ${where.host}${where.path} ${res.status}`);
        return res;
      } catch (e) {
        const why = e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'Timed out or cancelled' : maskString(String(e?.cause?.code || e?.message || e)).slice(0, 160);
        push('net', { at: Date.now(), method, host: where.host, path: where.path, status: 0, error: why, ms: Math.round(performance.now() - t0) });
        throw e;
      }
    };
    globalThis.fetch = tappedFetch;
  }
  if (!eld) { try { eld = monitorEventLoopDelay({ resolution: 20 }); eld.enable(); } catch { eld = null; } }
}

function removeTaps() {
  if (offLog) { offLog(); offLog = null; }
  if (origEmit) {
    if (bus.emit === tappedEmit) { if (hadOwnEmit) bus.emit = origEmit; else delete bus.emit; }
    origEmit = null; tappedEmit = null;
  }
  if (origFetch) {
    if (globalThis.fetch === tappedFetch) globalThis.fetch = origFetch;
    origFetch = null; tappedFetch = null;
  }
  if (eld) { try { eld.disable(); } catch { /* fine */ } eld = null; }
  clearTimeout(outTimer); outTimer = null; outbox = null;
}

/** Called by the dispatcher after every command (admin:* excluded). */
function ipcDone(channel, ms, ok, error) {
  if (!who || typeof channel !== 'string' || channel.startsWith('admin:')) return;
  let s = ipcStats.get(channel);
  if (!s) { if (ipcStats.size >= 800) return; s = { n: 0, errors: 0, total: 0, max: 0, last: 0 }; ipcStats.set(channel, s); }
  s.n++; s.total += ms; s.last = Date.now();
  if (ms > s.max) s.max = ms;
  if (!ok) s.errors++;
  push('ipc', { at: s.last, channel, ms: Math.round(ms * 10) / 10, ok, error: ok ? undefined : maskString(String(error || '')).slice(0, 200) });
  if (logger.verbose) log.debug(`ipc ${channel} ${ms.toFixed(1)} ms${ok ? '' : ' (failed)'}`);
}

function feedSnapshot() {
  const logs = feed.log.length >= 200 ? feed.log.slice(-LIMIT.log) : data.logLines(400);
  return {
    log: logs, bus: feed.bus.slice(-LIMIT.bus), ipc: feed.ipc.slice(-LIMIT.ipc), net: feed.net.slice(-LIMIT.net),
    stats: [...ipcStats.entries()].map(([channel, s]) => ({ channel, n: s.n, errors: s.errors, avg: +(s.total / s.n).toFixed(1), max: +s.max.toFixed(1), last: s.last })),
  };
}

function clearFeed(kind) {
  for (const k of Object.keys(feed)) if (!kind || kind === k) feed[k].length = 0;
  if (!kind || kind === 'ipc') ipcStats.clear();
  return true;
}

// ---------- overview ----------
function features() {
  const st = (name) => { try { return require(`../modules/${name}`).status(); } catch { return null; } };
  let running = 0;
  try { running = require('../modules/sessions').listSessions().filter(s => s.status === 'running').length; } catch { /* not started */ }
  return [
    ['Roblox clients', running > 0, `${running} running`],
    ['Watcher', st('watcher')?.enabled],
    ['RAM trimmer', st('ramtrimmer')?.running],
    ['Auto clicker', st('clicker')?.running],
    ['Anti-AFK', st('antiafk')?.running],
    ['FPS limiter', st('limiter')?.running],
    ['Phone dashboard', st('phone')?.running],
    ['Local API', st('api')?.running],
    ['Discord bot', st('remote')?.status === 'online'],
    ['Rotation', st('rotation')?.enabled],
    ['Auto-scale', st('autoscale')?.enabled],
    ['Overlay', st('overlay')?.running],
    ['Sleep timer', !!st('sleeptimer')?.endsAt],
  ].map(([name, on, detail]) => ({ name, on: !!on, detail: detail || '' }));
}

function overview() {
  const mem = process.memoryUsage(), heap = require('v8').getHeapStatistics();
  const mb = (n) => Math.round(n / 1048576 * 10) / 10;
  let lag = null;
  if (eld) {
    lag = { mean: +(eld.mean / 1e6).toFixed(1), p50: +(eld.percentile(50) / 1e6).toFixed(1), p99: +(eld.percentile(99) / 1e6).toFixed(1), max: +(eld.max / 1e6).toFixed(1) };
    eld.reset();
  }
  const names = bus.eventNames();
  return {
    status: status(),
    app: {
      version: app.getVersion(), portable: paths.isPortable, packaged: app.isPackaged, safeMode: ctx?.safeMode || null, diet: !!ctx?.diet,
      locale: app.getLocale(), language: require('../i18n').lang, uptimeSec: Math.round(process.uptime()), pid: process.pid, updatedFrom: ctx?.updatedFrom || null,
    },
    versions: tools.versions(), paths: tools.pathsInfo(), system: tools.system(),
    argv: process.argv.slice(1).map(a => maskString(a)),
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(MULTIMENU_|ELECTRON_)/.test(k)).map(([k, v]) => [k, maskString(String(v))])),
    main: {
      cpu: tools.mainCpu(), rssMB: mb(mem.rss), heapMB: mb(mem.heapUsed), heapTotalMB: mb(mem.heapTotal), heapLimitMB: mb(heap.heap_size_limit),
      externalMB: mb(mem.external), arrayBuffersMB: mb(mem.arrayBuffers), lag, resources: tools.resources(),
      busEvents: names.length, busListeners: names.reduce((n, e) => n + bus.listenerCount(e), 0),
    },
    processes: tools.ownProcesses(), windows: tools.ownWindows(),
    gpu: app.getGPUFeatureStatus(), features: features(),
  };
}

// ---------- settings ----------
function settingsTable() {
  const settings = require('../modules/settings');
  const { ENUMS, RANGES } = require('../ipc');
  const rows = [];
  const walk = (def, cur, prefix) => {
    for (const [k, d] of Object.entries(def)) {
      const key = prefix ? `${prefix}.${k}` : k;
      const v = cur && typeof cur === 'object' ? cur[k] : undefined;
      if (d && typeof d === 'object' && !Array.isArray(d)) { walk(d, v, key); continue; }
      // Only text settings can hold a secret (requireSignature: true is not one).
      const secret = (typeof d === 'string' || d === null) && require('./mask').isSecretField(k, typeof v === 'string' ? v : '');
      rows.push({
        key, type: Array.isArray(d) ? 'list' : typeof d, secret,
        value: secret ? (v ? '‹hidden›' : '') : mask(v), def: secret ? '' : mask(d),
        changed: JSON.stringify(v) !== JSON.stringify(d), enum: ENUMS[key] || null, range: RANGES[key] || null,
      });
    }
  };
  walk(settings.DEFAULTS, settings.all(), '');
  return rows;
}

function settingReset(key) {
  const settings = require('../modules/settings');
  const def = String(key).split('.').reduce((o, k) => (o == null ? undefined : o[k]), settings.DEFAULTS);
  if (def === undefined || (def && typeof def === 'object' && !Array.isArray(def))) throw new Error('Unknown setting.');
  return require('../ipc').setSetting(String(key), structuredClone(def));
}

// ---------- lab flags, demo ----------
function setFlags(patch) {
  if (!store) throw new Error('Admin mode is locked.');
  const cur = flags();
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch || {})) if (k in FLAGS) next[k] = !!v;
  store.set('flags', next);
  if (next.verbose !== cur.verbose) logger.setVerbose(next.verbose);
  if (next.pseudo !== cur.pseudo) {
    require('../i18n').setPseudo(next.pseudo);
    try { ctx?.setTrayMenu?.(); } catch { /* no tray */ }
    reloadWindows();
  }
  return next;
}

function setDemo(on) {
  demo = !!on;
  log.info(`Demo mode ${demo ? 'on' : 'off'}`);
  reloadWindows();
  return status();
}

// ---------- tests ----------
function simulate({ kind = 'event', type = 'test', level = 'info', automations = false } = {}) {
  switch (kind) {
    case 'event': {
      const EVENTS = require('../modules/webhooks').EVENTS;
      if (!EVENTS[type]) throw new Error('Unknown event type.');
      const title = EVENTS[type].title || type;
      bus.emit('event', {
        type, account: 'Test account', detail: `[TEST] ${title} (sent from admin mode)`,
        error: /fail|error|crash|gaveup|problem|warning/i.test(type) ? '[TEST] Example error' : undefined,
        test: true, testAutomations: !!automations,
      });
      return true;
    }
    case 'notify': {
      const lv = ['info', 'success', 'warn', 'error'].includes(level) ? level : 'info';
      bus.emit('notify', { level: lv, title: `[TEST] ${lv}`, message: 'A test notification from admin mode.' });
      return true;
    }
    case 'native': {
      if (!Notification.isSupported()) throw new Error('Windows notifications are not available here.');
      new Notification({ title: '[TEST] MultiMenu', body: 'A test Windows notification from admin mode.' }).show();
      return true;
    }
    case 'speech': return require('../modules/speech').speak('This is a test from admin mode.', { force: true });
    case 'achievement': return require('../modules/achievements').preview(String(type));
    default: throw new Error('Unknown test.');
  }
}

async function reset(kind, confirm) {
  const { setSetting } = require('../ipc');
  switch (kind) {
    case 'wizard': setSetting('firstRunDone', false); return 'The setup wizard opens on the next start.';
    case 'tour': setSetting('tour.seen', []); return 'Page tips show again.';
    case 'language': setSetting('language', ''); return 'The language picker opens on the next start.';
    case 'achievements': require('../modules/achievements').reset(); return 'Achievements reset.';
    case 'stats': require('../modules/stats').clear(); return 'Stats cleared.';
    case 'notifications': require('../modules/notifications').clear(); return 'Notifications cleared.';
    case 'factory': {
      if (confirm !== 'RESET') throw new Error('Type RESET to confirm.');
      data.scheduleFactoryReset();
      setTimeout(() => { app.relaunch(); app.quit(); }, 300);
      return 'Restarting with fresh data (a snapshot is kept).';
    }
    default: throw new Error('Unknown reset.');
  }
}

async function exportBundle() {
  const w = ctx?.win?.();
  const name = `MultiMenu-debug-${new Date().toISOString().slice(0, 10)}.mmdebug.json`;
  const r = await dialog.showSaveDialog(w || undefined, { defaultPath: path.join(app.getPath('downloads'), name), filters: [{ name: 'MultiMenu debug bundle', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) { const e = new Error('Cancelled'); e.code = 'CANCELLED'; throw e; }
  const extra = { overview: { ...overview(), paths: undefined, argv: undefined }, feeds: { ipc: feedSnapshot().stats, net: feed.net.slice(-150), bus: feed.bus.slice(-150).map(b => ({ at: b.at, name: b.name })) } };
  const out = data.bundle(extra);
  fs.writeFileSync(r.filePath, JSON.stringify(out, null, 1));
  return { file: path.basename(r.filePath), bytes: fs.statSync(r.filePath).size };
}

// ---------- commands ----------
function handlers(all) {
  const win = () => ctx?.win?.();
  return {
    'admin:status': () => status(),
    'admin:unlock': (code) => unlock(code),
    'admin:lock': () => lock(),
    'admin:overview': () => overview(),
    'admin:channels': () => Object.keys(all).sort(),
    'admin:feed': () => feedSnapshot(),
    'admin:watch': (on) => { watching = !!on; return watching; },
    'admin:clearFeed': (kind) => clearFeed(kind ? String(kind) : null),
    'admin:settings': () => settingsTable(),
    'admin:settingReset': (key) => settingReset(key),
    'admin:stores': () => data.stores(),
    'admin:store': (name) => data.read(String(name)),
    'admin:snapshots': () => data.snapshots(),
    'admin:snapshot': (label) => data.snapshot(String(label || 'Manual')),
    'admin:removeSnapshot': (id) => data.removeSnapshot(id),
    'admin:restore': (id) => { data.scheduleRestore(id); setTimeout(() => { app.relaunch(); app.quit(); }, 300); return true; },
    'admin:bundle': () => exportBundle(),
    'admin:windows': (opts) => tools.listWindows({ all: !!opts?.all }),
    'admin:window': (id, action, arg) => tools.windowAction(id, String(action), arg && typeof arg === 'object' ? arg : {}),
    'admin:releases': () => require('../modules/updater').releases(),
    'admin:offerVersion': (tag) => require('../modules/updater').offer(tag),
    'admin:pretendVersion': (v) => require('../modules/updater').setPretend(v || null),
    'admin:resetUpdater': () => require('../modules/updater').reset(),
    'admin:flags': (patch) => (patch ? setFlags(patch) : flags()),
    'admin:demo': (on) => setDemo(on),
    'admin:devtools': () => { const w = win(); if (!w) throw new Error('The window is not open.'); w.webContents.openDevTools({ mode: 'detach' }); return true; },
    'admin:reload': () => { reloadWindows(50); return true; },
    'admin:relaunch': () => { setTimeout(() => { app.relaunch(); app.quit(); }, 200); return true; },
    'admin:simulate': (opts) => simulate(opts && typeof opts === 'object' ? opts : {}),
    'admin:achievements': () => require('../modules/achievements').status(),
    'admin:crash': (kind) => tools.crash(String(kind), win()),
    'admin:reset': (kind, confirm) => reset(String(kind), confirm),
    'admin:heapSnapshot': () => tools.heapSnapshot(),
    'admin:cpuProfile': (sec) => tools.cpuProfile(sec),
    'admin:gc': () => tools.gc(),
    'admin:folders': () => tools.folders(),
    'admin:clearFolder': (id) => tools.clearFolder(String(id)),
    'admin:open': (which) => tools.openFolder(String(which)),
    'admin:screenshot': () => tools.screenshot(win()),
    'admin:windowSize': (w, h) => tools.windowSize(win(), w, h),
    'admin:i18n': () => tools.i18nCoverage(),
    'admin:hotkeys': () => { try { return require('../modules/hotkeys').lastResult() || null; } catch { return null; } },
  };
}

module.exports = {
  init, handlers, blocked, ipcDone, isUnlocked, status, unlock, lock, setFlags, simulate,
  get active() { return !!who; },
  get demo() { return demo; },
  _feed: feed, _keys: KEYS,
};
