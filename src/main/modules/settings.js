'use strict';
// Settings schema, defaults, validated import/export.
const { JsonStore } = require('../store');
const paths = require('../paths');

const DEFAULTS = {
  appearance: {
    accentHue: 270, particles: true, animations: true, reducedMotion: false, pauseUnfocused: true, sidebarCollapsed: false, particleCount: 40,
    theme: { preset: 'midnight', secondaryHue: 295, glow: 100, blur: 20, bgType: 'gradient', bgDim: 55, bgFile: '' },
    mode: 'dark', density: 'comfortable', contrast: 'normal', textSize: 100,
  },
  dashboard: { widgets: [] },
  startup: { launchOnLogin: false, startMinimized: false, closeToTray: true, showLoadingScreen: true },
  performance: { deepIdleMin: 10, idleMode: true, lowResourceMode: false, dietMode: false, monitorIntervalSec: 2, gpuMonitoring: true, alertRamPercent: 90, alertCpuPercent: 95, alertSustainSec: 30, checkSpeed: 'normal', pauseHidden: true, trimSelf: true, endCrashHandlers: false },
  hotkeys: {
    clickerToggle: 'F6', macroRecord: 'F7', macroPlay: 'Shift+F7', emergencyStop: 'F8', tileWindows: 'Ctrl+Alt+T', miniPanel: 'Ctrl+Alt+M', closeAllRoblox: '',
    focusMode: 'Ctrl+Alt+F', focusNext: 'Ctrl+Alt+N', pip: '', altWall: 'Ctrl+Alt+W', pinWindow: '',
  },
  altKeys: { enabled: false, modifier: 'Ctrl+Alt', launchIfClosed: true },
  accounts: { defaultPlaceId: '', confirmBeforeRemove: true, refreshOnStart: true, launchDelaySec: 8, binDays: 30 },
  launch: { smart: true, cpuSettle: 70, maxWaitSec: 45, batchSize: 0, batchWaitSec: 240, hopIfJoinFails: true },
  // Alt performance (Main accounts always launch at full quality). fpsCap 0 = Roblox's own.
  perf: {
    fpsCap: 0, lowGraphics: false, lighter: false, reducedMotion: false,
    flags: { msaa: 'x1', texture: 'lowest', mode: 'default', graySky: false, noGrass: true, lowestQuality: true, pauseLighting: false },
    minimize: false, tiny: false, tinyW: 240, tinyH: 180, mute: false, planned: 4,
  },
  overlay: { enabled: false, fps: true, ping: true, uptime: true, mem: false, position: 'top-left', scale: 100 },
  wall: { thumbSec: 5, showOffline: true, size: 'm' },
  rotation: { enabled: false, accountIds: [], tag: '', size: 3, everyMin: 60, game: '', watch: true },
  autoScale: { enabled: false, budget: 'free', freeGB: 2, capGB: 12, cpuMax: 85, min: 0, max: 10, accountIds: [], tag: '', game: '', watch: true },
  api: { enabled: false, port: 43822, keyEnc: '', cli: true },
  speech: {
    enabled: false, voice: '', volume: 100, rate: 0, quiet: true,
    events: { accountCrashed: true, watcherGaveUp: true, launchFailed: false, loginWarning: true, highUsage: false, robloxOutage: true, internetBack: false, gameUpdated: false, achievement: true, secretHatched: true },
  },

  insights: { enabled: true, dismissed: {} },
  openMulti: { enabled: true, labelWindows: true, launchMethod: 'protocol', minimizeOnLaunch: false, restoreGraphics: true },
  robloxLogs: { clean: false, maxAgeHours: 24, maxTotalMB: 50 },
  browse: { lockPurchases: true },
  watcher: {
    enabled: false, watchNewSessions: true, rejoinSameServer: true, detectDisconnects: true, detectFreezes: true,
    freezeSec: 120, detectStuck: true, stuckMin: 5, maxPerHour: 6, baseDelaySec: 10, maxDelaySec: 600, screenshots: true,
  },
  remote: { allowedUserIds: [], guildId: '', private: false, autoConnect: true, alertClosed: false },
  report: { enabled: false, time: '21:00' },
  resume: { enabled: true, auto: false, maxAgeHours: 24 },
  guards: { keepAwake: true, closePopups: true, gameUpdates: true, restartOnUpdate: false, ping: true, highPingMs: 250 },
  inbox: { enabled: false, intervalMin: 5, trades: true, messages: true, friends: true },
  playtime: { enabled: false, remindMin: 180, closeAtLimit: false },
  clipboard: { enabled: true },
  sleepTimer: { lastMinutes: 60, lastAction: 'close' },
  follow: { enabled: false, mainAccountId: '', followerIds: [], launchIfOffline: true, checkSec: 30 },
  autoBackup: { enabled: false, folder: '', time: '03:00', keep: 7 },
  memGuard: { enabled: false, maxMB: 3000, leakMBPerHour: 400, minUptimeMin: 45, avoidFocused: true, watchedOnly: false },
  health: { autoCheck: true, intervalHours: 6 },
  limiter: { enabled: false, backgroundPriority: 'below', focusedPriority: 'normal', limitCores: false, backgroundCores: 2, muteBackground: false, eco: false },
  schedule: { quietHours: { enabled: false, start: '02:00', end: '07:00' } },
  mini: { alwaysOnTop: true, openOnStart: false, compact: false },
  tiling: {
    layout: 'auto', display: '', gap: 4, padding: 0, mainRatio: 0.62, cellWidth: 800, cellHeight: 600,
    centerLastRow: true, autoTile: false, includeExternal: true, perMonitorSetup: true, pinned: [], hideTitleBars: false,
  },
  focus: { ratio: 0.78, stripSide: 'right' },
  pip: { width: 420, opacity: 100, fps: 15 },
  loginCheck: { enabled: true, time: '21:30', beforeStart: true },
  phone: { enabled: false, port: 43821, pinHash: '', pinSalt: '', allowControl: true, thumbs: true },
  tour: { enabled: true, seen: [] },
  screen: { everySec: 3, minWidth: 320 },
  hatch: {
    enabled: false, places: [], words: ['secret'], pets: [],
    sources: { output: true, badges: true, screen: true }, badgeIds: [], badgeEverySec: 60,
    ping: '', dm: true, screenshot: true, cooldownSec: 30,
  },
  // 3.1
  wallet: { rolimons: true },
  privateServers: { warn: true, warnDays: 3 },
  updateGuard: { enabled: true, maxWaitSec: 240, hold: 'off' },
  richPresence: { enabled: true, showCount: true, showGame: true, details: '', state: '' },
  volume: { all: 100, levels: {} },
  netmon: { enabled: true, capGB: 0, period: 'month', closeFiller: false },
  freshRestart: { enabled: false, everyHours: 6, gapMin: 10, skipMain: true, avoidFocused: true },
  checklist: { hidden: false, done: [] },
  ramTrimmer: {
    enabled: false, intervalSec: 60, mode: 'targets', targets: ['RobloxPlayerBeta.exe'],
    onlyAboveSystemPercent: 0, minWorkingSetMB: 150, startWithApp: false, watchMB: 0,
  },
  clicker: { button: 'left', intervalMs: 100, mode: 'continuous', count: 100, doubleClick: false, positionMode: 'cursor', x: 0, y: 0 },
  macros: { playbackSpeed: 1, repeat: 1, recordMouseMoves: true },
  antiAfk: { enabled: false, intervalMin: 15, mode: 'reminder', key: 'F13', onlyTracked: false, onlyWhenAway: true, awaySec: 60 },
  fps: { presentMonPath: '' },
  discord: {
    enabled: false, cooldownSec: 60, mention: '',
    events: {
      accountLaunched: true, accountClosed: true, accountCrashed: true, launchFailed: true, sessionError: true,
      appStarted: false, appClosed: false, highUsage: true, trimmer: false, appError: true, updates: true,
      watcherProblem: true, watcherRejoin: true, watcherGaveUp: true, scheduleRan: false, accountHealth: true, memoryRestart: true,
      internetBack: true, robloxOutage: true, gameUpdated: true, highPing: false, inbox: true, loginWarning: true, achievement: false, secretHatched: true,
    },
  },
  updates: { autoCheck: true, channel: 'stable', repoOverride: '', requireSignature: false, remindUntil: {}, history: [] },
  notifications: { toasts: true },
  language: '',
  lastSeenVersion: '',
  firstRunDone: false,
  migrations: [],
};

let store = null;
function init() {
  store = new JsonStore(paths.file('settings.json'), DEFAULTS);
  migrate();
  return store;
}

// One-off changes to settings people already have.
function migrate() {
  const done = new Set(store.get('migrations') || []);
  const once = (id, fn) => { if (done.has(id)) return; try { fn(); } catch { /* keep going */ } done.add(id); };
  // 1.6.2: Rich Presence was removed; drop its old settings.
  once('presence-removed', () => { const all = store.get(); if (all && 'presence' in all) { delete all.presence; store.saveSoon?.(); } });
  // 2.0: "Minimise new clients" became "Minimise once in game" on the Performance page.
  once('perf-minimize', () => { if (store.get('openMulti.minimizeOnLaunch')) store.set('perf.minimize', true); });
  // 3.1.1: "Move clients to fresh servers after a game update" is off unless you turn it on.
  // Roblox marks a game updated whenever its page is edited too, so it closed clients for nothing.
  once('update-restart-off', () => store.set('guards.restartOnUpdate', false));
  store.set('migrations', [...done]);
}
function get(key) { return store.get(key); }
function set(key, value) { store.set(key, value); }
function all() { return store.get(); }

// Import: walk the defaults tree and accept only known keys whose type matches.
function sanitize(defaults, incoming, pathStr = '') {
  const out = {};
  for (const [k, def] of Object.entries(defaults)) {
    if (!(k in (incoming || {}))) continue;
    const v = incoming[k];
    const p = pathStr ? `${pathStr}.${k}` : k;
    if (def && typeof def === 'object' && !Array.isArray(def)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // Free-form maps (e.g. remindUntil) have empty defaults: accept primitive values only.
        if (Object.keys(def).length === 0) {
          out[k] = Object.fromEntries(Object.entries(v).filter(([, x]) => ['string', 'number', 'boolean'].includes(typeof x)));
        } else out[k] = sanitize(def, v, p);
      }
    } else if (Array.isArray(def)) {
      if (Array.isArray(v)) out[k] = v.filter(x => typeof x === 'string' || (x && typeof x === 'object')).slice(0, 500);
    } else if (typeof v === typeof def) {
      out[k] = typeof v === 'string' ? v.slice(0, 500) : v;
    }
  }
  return out;
}

module.exports = { DEFAULTS, init, get, set, all, sanitize, get store() { return store; } };
