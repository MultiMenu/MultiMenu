'use strict';
// IPC command table. Every UI action maps to exactly one handler here.
const fs = require('fs');
const { performance } = require('perf_hooks');
const { ipcMain, dialog, shell, app, BrowserWindow } = require('electron');
const settings = require('./modules/settings');
const accounts = require('./modules/accounts');
const creator = require('./modules/creator');
const sessions = require('./modules/sessions');
const system = require('./modules/system');
const processes = require('./modules/processes');
const fps = require('./modules/fps');
const trimmer = require('./modules/ramtrimmer');
const clicker = require('./modules/clicker');
const macros = require('./modules/macros');
const antiafk = require('./modules/antiafk');
const webhooks = require('./modules/webhooks');
const notifications = require('./modules/notifications');
const updater = require('./modules/updater');
const hotkeys = require('./modules/hotkeys');
const tiler = require('./modules/tiler');
const watcher = require('./modules/watcher');
const stats = require('./modules/stats');
const presets = require('./modules/presets');
const scheduler = require('./modules/scheduler');
const limiter = require('./modules/limiter');
const servers = require('./modules/servers');
const backup = require('./modules/backup');
const robloxlogs = require('./modules/robloxlogs');
const windows = require('./main-windows');
const remote = require('./modules/remote');
const report = require('./modules/report');
const health = require('./modules/health');
const capture = require('./modules/capture');
const errorcodes = require('./modules/errorcodes');
const memguard = require('./modules/memguard');
const avatars = require('./modules/avatars');
const resume = require('./modules/resume');
const follow = require('./modules/follow');
const autobackup = require('./modules/autobackup');
const guards = require('./modules/guards');
const browseas = require('./modules/browseas');
const inbox = require('./modules/inbox');
const shortcuts = require('./modules/shortcuts');
const sleeptimer = require('./modules/sleeptimer');
const capacity = require('./modules/capacity');
const launchers = require('./modules/launchers');
const ramimport = require('./modules/ramimport');
const themes = require('./modules/themes');
const paths = require('./paths');
const secure = require('./secure');
const logger = require('./logger');
const win32 = require('./native/win32');
const bus = require('./bus');
const log = logger.scope('ipc');

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

function getPath(obj, key) { return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }

async function pickFile(filters) {
  const win = BrowserWindow.getFocusedWindow();
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths[0]) return null;
  const st = fs.statSync(r.filePaths[0]);
  if (st.size > MAX_IMPORT_BYTES) throw new Error('That file is too large.');
  return { path: r.filePaths[0], text: fs.readFileSync(r.filePaths[0], 'utf8') };
}

async function saveFile(defaultPath, text, filters) {
  const r = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), { defaultPath, filters });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, text);
  return r.filePath;
}

function applySettingSideEffects(key) {
  if (key === 'hatch' || key.startsWith('hatch.')) require('./modules/hatch').reschedule();
  if (key.startsWith('screen.')) require('./modules/screenwatch').reschedule();
  try { require('./v31').onSetting(key); } catch (e) { log.warn(`3.1 setting ${key}: ${e.message}`); }
  if (key === 'appearance.textSize') { const w = windows.getMain(); if (w && !w.isDestroyed()) w.webContents.setZoomFactor(Math.min(1.5, Math.max(0.8, settings.get('appearance.textSize') / 100))); }
  if (key.startsWith('performance.')) system.start();
  if (key.startsWith('hotkeys.') || key.startsWith('altKeys.')) return hotkeys.register();
  if (key === 'startup.launchOnLogin' || key === 'startup.startMinimized') {
    if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: settings.get('startup.launchOnLogin'), args: settings.get('startup.startMinimized') ? ['--hidden'] : [] });
  }
  if (key.startsWith('ramTrimmer.')) trimmer.reschedule();
  if (key.startsWith('antiAfk.')) antiafk.reschedule();
  if (key === 'updates.autoCheck') updater.start();
  if (key.startsWith('limiter.') && key !== 'limiter.enabled') limiter.refresh();
  if (key === 'watcher.enabled') return watcher.setEnabled(settings.get('watcher.enabled'));
  if (key === 'mini.alwaysOnTop') windows.setMiniOnTop(settings.get('mini.alwaysOnTop'));
  if (key.startsWith('health.')) health.start();
  if (key.startsWith('focus.') && tiler.focusStatus().on) tiler.tile().catch(() => { /* no windows */ });
  if (key.startsWith('rotation.') && key !== 'rotation.enabled') bus.emit('rotation:update', require('./modules/rotation').status());
  if (key === 'rotation.enabled') return require('./modules/rotation').setEnabled(settings.get('rotation.enabled'));
  if (key.startsWith('autoScale.') && key !== 'autoScale.enabled') bus.emit('autoscale:update', require('./modules/autoscale').status());
  if (key === 'autoScale.enabled') return require('./modules/autoscale').setEnabled(settings.get('autoScale.enabled'));
  if (key.startsWith('overlay.') && key !== 'overlay.enabled') { try { require('./modules/overlay').refresh(); } catch { /* not started */ } }
  if (key === 'overlay.enabled') return require('./modules/overlay').setEnabled(settings.get('overlay.enabled'));
  if (key === 'api.enabled') { const api = require('./modules/api'); if (settings.get('api.enabled')) api.start().catch(e => bus.emit('notify', { level: 'warn', title: 'Local API', message: e.message })); else api.stop(); return null; }
  if (key === 'api.port') { const api = require('./modules/api'); if (api.status().running) { api.stop(); api.start().catch(() => {}); } }
  if (key === 'api.cli') { const cli = require('./cli'); if (settings.get('api.cli')) cli.startServer(paths.dataDir); else cli.stopServer(); }
  if (key === 'phone.port') { const ph = require('./modules/phone'); if (ph.status().running) { ph.stop(); ph.start().catch(() => {}); } }
  if (key === 'pip.opacity') { const w = windows.getPip(); if (w) w.setOpacity(Math.max(0.3, Math.min(1, settings.get('pip.opacity') / 100))); }
  if (key.startsWith('tiling.') && key !== 'tiling.perMonitorSetup' && key !== 'tiling.autoTile' && key !== 'tiling.includeExternal') { try { require('./modules/layouts').remember(); } catch { /* not started */ } }
  if (key === 'remote.allowedUserIds') {
    const bad = settings.get('remote.allowedUserIds').filter(x => !/^\d{15,22}$/.test(x));
    if (bad.length) { settings.set('remote.allowedUserIds', settings.get('remote.allowedUserIds').filter(x => /^\d{15,22}$/.test(x))); throw new Error(`Not a Discord user ID: ${bad[0]}. Right-click your name in Discord → Copy User ID (turn on Developer Mode first).`); }
  }
  if (key === 'performance.idleMode') system.setIdle(false);
  if (key.startsWith('follow.')) follow.start();
  if (key.startsWith('guards.')) guards.refresh();
  if (key.startsWith('inbox.')) inbox.start();
  if ((key.startsWith('appearance.theme.') && !key.endsWith('.preset') && !key.endsWith('.bgType')) || key === 'appearance.accentHue') settings.set('appearance.theme.preset', 'custom');
  if (key === 'openMulti.enabled') return settings.get('openMulti.enabled') ? sessions.enableOpenMulti() : sessions.disableOpenMulti();
  return null;
}

// Allowed values for 2.0 settings that are a choice or a range.
const ENUMS = {
  'altKeys.modifier': ['Ctrl+Alt', 'Ctrl+Shift', 'Alt+Shift', 'Ctrl+Alt+Shift'],
  'netmon.period': ['day', 'month'],
  'updateGuard.hold': ['off', 'whileOpen', 'always'],
  'performance.checkSpeed': ['normal', 'relaxed', 'slow'],
  'appearance.mode': ['dark', 'light', 'system'], 'appearance.density': ['comfortable', 'compact'], 'appearance.contrast': ['normal', 'high'],
  'perf.flags.msaa': ['default', 'x1', 'x2', 'x4'], 'perf.flags.texture': ['default', 'lowest', 'low', 'medium', 'high'], 'perf.flags.mode': ['default', 'd3d11', 'vulkan', 'opengl'],
  'overlay.position': ['top-left', 'top-right', 'bottom-left', 'bottom-right'], 'wall.size': ['s', 'm', 'l'], 'autoScale.budget': ['free', 'cap'],
};
const RANGES = {
  'perf.fpsCap': [0, 360], 'perf.tinyW': [16, 7680], 'perf.tinyH': [16, 4320], 'tiling.cellWidth': [16, 7680], 'tiling.cellHeight': [16, 4320], 'perf.planned': [1, 60],
  'appearance.textSize': [80, 150], 'overlay.scale': [70, 200], 'wall.thumbSec': [2, 60], 'rotation.size': [1, 50], 'rotation.everyMin': [5, 1440],
  'autoScale.freeGB': [0.5, 64], 'autoScale.capGB': [1, 512], 'autoScale.cpuMax': [30, 100], 'autoScale.min': [0, 50], 'autoScale.max': [1, 50],
  'hatch.badgeEverySec': [30, 3600], 'screen.everySec': [1, 120], 'screen.minWidth': [160, 4000], 'hatch.cooldownSec': [0, 3600],
  'privateServers.warnDays': [1, 30], 'updateGuard.maxWaitSec': [30, 900], 'launch.batchSize': [0, 50], 'launch.batchWaitSec': [30, 900], 'netmon.capGB': [0, 100000], 'freshRestart.everyHours': [1, 72], 'freshRestart.gapMin': [1, 240], 'volume.all': [0, 100],
  'api.port': [1024, 65535], 'launch.cpuSettle': [20, 100], 'launch.maxWaitSec': [5, 300], 'speech.volume': [0, 100], 'speech.rate': [-10, 10], 'accounts.binDays': [0, 365],
};

function setSetting(key, value) {
  const def = getPath(settings.DEFAULTS, key);
  if (def === undefined) throw new Error(`Unknown setting ${key}`);
  if (Array.isArray(def)) {
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) throw new Error('Expected a list of text values.');
    value = value.map(v => v.trim().slice(0, 100)).filter(Boolean).slice(0, 100);
  } else if (typeof def !== typeof value) throw new Error(`Setting ${key} expects a ${typeof def}.`);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid number.');
  if (ENUMS[key] && !ENUMS[key].includes(value)) throw new Error('That choice isn\'t available.');
  if (RANGES[key]) value = Math.min(RANGES[key][1], Math.max(RANGES[key][0], Math.round(value * 10) / 10));
  if (key === 'perf.fpsCap' && value > 0 && value < 5) value = 5;
  if (key.startsWith('hotkeys.') && value && !hotkeys.VALID.test(value)) throw new Error('Use a key like F6, Ctrl+Shift+K or Alt+F2.');
  if (key.startsWith('hotkeys.') && value) {
    const others = Object.entries(settings.get('hotkeys')).filter(([k]) => `hotkeys.${k}` !== key).map(([, v]) => v);
    if (others.includes(value)) throw new Error('That key is already used by another MultiMenu hotkey.');
  }
  if (key === 'hatch.ping' && value && !/^(<@[&!]?)?\d{15,22}>?$/.test(value.trim())) throw new Error('Paste your Discord user ID (a long number). In Discord: Settings → Advanced → Developer Mode, then right-click your name → Copy User ID.');
  if ((key === 'hatch.places' || key === 'hatch.badgeIds') && value.some(v => !/^\d{1,20}$/.test(v))) throw new Error('Use numbers only (IDs from the Roblox page address).');
  if (key === 'updates.repoOverride' && value && !/^[\w.-]+\/[\w.-]+$/.test(value)) throw new Error('Use the form owner/repository.');
  settings.set(key, value);
  return { value, effect: applySettingSideEffects(key) };
}

function makeHandlers(ctx) {
  return {
    ...require('./v31').handlers(),
    // app
    'app:miniCompact': (on) => { settings.set('mini.compact', !!on); windows.setMiniCompact(!!on); return !!on; },
    'app:i18n': () => require('./i18n').payload(),
    'app:languages': () => {
      const i18n = require('./i18n');
      return { current: settings.get('language') || '', suggested: i18n.suggest(app.getLocale()), list: i18n.LANGS };
    },
    'app:setLanguage': (id) => {
      const i18n = require('./i18n');
      if (!i18n.LANGS.some(l => l.id === id)) throw new Error('Unknown language.');
      settings.set('language', id);
      i18n.load(id);
      ctx.setTrayMenu?.();
      // Reload every window so the whole interface switches language.
      setTimeout(() => { for (const w of windows.all()) if (!w.isDestroyed()) w.webContents.reload(); }, 150);
      return id;
    },
    'app:info': () => ({
      version: app.getVersion(), name: app.getName(), portable: paths.isPortable, dataDir: paths.dataDir, platform: process.platform,
      native: win32.available, secureStorage: secure.available(), electron: process.versions.electron, updatedFrom: ctx.updatedFrom,
    }),
    'app:openDataDir': () => shell.openPath(paths.dataDir),
    'app:openLogs': () => shell.openPath(paths.logsDir()),
    'app:openExternal': (url) => {
      if (typeof url !== 'string' || !/^https:\/\/([a-z0-9-]+\.)*(roblox\.com|github\.com|discord\.com)\//i.test(url)) throw new Error('Link not allowed');
      return shell.openExternal(url);
    },
    'app:minimize': () => ctx.win()?.minimize(),
    'app:maximize': () => { const w = ctx.win(); if (w) (w.isMaximized() ? w.unmaximize() : w.maximize()); },
    'app:close': () => ctx.win()?.close(),
    'app:ready': () => true,

    // settings
    'settings:get': () => settings.all(),
    'settings:set': (key, value) => setSetting(String(key), value),
    'settings:export': async () => {
      const data = { format: 'multimenu-config', version: 1, exportedAt: new Date().toISOString(), settings: structuredClone(settings.all()) };
      delete data.settings.updates.history;
      return saveFile('MultiMenu-config.json', JSON.stringify(data, null, 2), [{ name: 'MultiMenu config', extensions: ['json'] }]);
    },
    'settings:import': async () => {
      const f = await pickFile([{ name: 'MultiMenu config', extensions: ['json'] }]);
      if (!f) return null;
      let j;
      try { j = JSON.parse(f.text); } catch { throw new Error('That file is not valid JSON.'); }
      if (j?.format !== 'multimenu-config' || typeof j.settings !== 'object') throw new Error('That is not a MultiMenu configuration file.');
      const clean = settings.sanitize(settings.DEFAULTS, j.settings);
      const { deepMerge } = require('./store');
      settings.store.replace(deepMerge(settings.DEFAULTS, deepMerge(settings.all(), clean)));
      settings.store.saveNow();
      hotkeys.register(); system.start(); trimmer.reschedule(); antiafk.reschedule();
      return settings.all();
    },
    'settings:reset': () => { settings.store.replace(structuredClone(settings.DEFAULTS)); settings.store.saveNow(); hotkeys.register(); system.start(); return settings.all(); },

    // accounts
    'accounts:list': () => accounts.getAll(),
    'accounts:login': (opts) => accounts.loginWithBrowser({ group: opts?.group, alias: opts?.alias }),
    'accounts:ramFile': async () => { const f = await pickFile([{ name: 'AccountData.json', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }]); return f ? ramimport.importRamFile(f.text) : null; },
    'accounts:ramList': (text) => { if (typeof text !== 'string' || text.length > 200_000) throw new Error('That list is too long.'); return ramimport.importList(text); },
    'accounts:pending': () => accounts.pendingList(),
    'accounts:pendingRemove': (id) => accounts.removePending(String(id)),
    'accounts:pendingLogin': (id) => accounts.loginPending(String(id)),
    'accounts:addPendingBulk': (text, opts) => { const { entries, invalid, duplicates } = accounts.parsePendingText(String(text || ''), opts || {}); return { ...accounts.addPending(entries), invalid, duplicates }; },
    'accounts:pendingCopyPassword': (id) => { require('electron').clipboard.writeText(accounts.revealPendingPassword(String(id))); setTimeout(() => require('electron').clipboard.clear(), 30000); return true; },
    'accounts:importCookie': (cookie, opts) => accounts.importCookie(cookie, opts || {}),
    'accounts:importFile': async () => { const f = await pickFile([{ name: 'Cookies', extensions: ['txt', 'json'] }]); return f ? accounts.importFile(f.text) : null; },
    'accounts:update': (id, patch) => accounts.update(id, patch || {}),
    'accounts:bulkUpdate': (ids, patch) => accounts.bulkUpdate(ids, patch || {}),
    'accounts:remove': (id, forever) => accounts.remove(String(id), { forever: forever === true }),
    'accounts:bin': () => accounts.binList(),
    'accounts:restore': (id) => accounts.restore(String(id)),
    'accounts:purge': (id) => accounts.purge(String(id)),
    'accounts:emptyBin': () => accounts.emptyBin(),
    'accounts:saveFilter': (name, q) => accounts.saveFilter(name, q && typeof q === 'object' ? q : {}),
    'accounts:removeFilter': (id) => accounts.removeFilter(String(id)),
    'accounts:autoSlots': () => { const r = accounts.autoSlots(); try { hotkeys.register(); } catch { /* ignore */ } return r; },
    'accounts:reorder': (ids) => accounts.reorder(Array.isArray(ids) ? ids : []),
    'accounts:refresh': (id) => accounts.refresh(id),
    'accounts:refreshAll': () => accounts.refreshAll(),
    'accounts:addGroup': (n) => accounts.addGroup(n),
    'accounts:renameGroup': (a, b) => accounts.renameGroup(a, b),
    'accounts:deleteGroup': (n) => accounts.deleteGroup(n),
    'accounts:revealPassword': (id) => accounts.revealPassword(id),
    'accounts:copyPassword': (id) => { require('electron').clipboard.writeText(accounts.revealPassword(id)); setTimeout(() => require('electron').clipboard.clear(), 30000); return true; },

    // creator
    'creator:username': () => creator.generateUsername(),
    'creator:password': () => creator.generatePassword(),
    'creator:check': (u) => creator.checkUsername(String(u || '')),
    'creator:open': (o) => creator.openSignup(o || {}),
    'creator:copy': (text) => { require('electron').clipboard.writeText(String(text).slice(0, 200)); return true; },

    // sessions
    'sessions:list': () => sessions.listSessions(),
    'sessions:launch': (accountId, target, opts) => sessions.launch(accountId, target, opts || {}),
    'sessions:launchMany': (ids, target) => { const list = accounts.byTier((Array.isArray(ids) ? ids : []).map(String)); list.forEach(id => sessions.launch(id, target)); return { queued: list.length }; },
    'sessions:close': (id) => sessions.close(id),
    'sessions:closeAll': () => sessions.closeAll(),
    'sessions:panic': () => sessions.panic(),
    'logcleaner:status': () => require('./modules/logcleaner').status(),
    'logcleaner:run': () => require('./modules/logcleaner').run(true),
    'sessions:relabel': (id, label) => sessions.relabel(id, label),
    'sessions:dismiss': (id) => sessions.dismiss(id),
    'sessions:openMulti': () => ({ ...sessions.openMultiStatus(), playerPath: win32.available ? sessions.findRobloxPlayer() : null }),
    'sessions:enableOpenMulti': () => { settings.set('openMulti.enabled', true); return sessions.enableOpenMulti(); },
    'sessions:disableOpenMulti': () => { settings.set('openMulti.enabled', false); return sessions.disableOpenMulti(); },

    // mini panel
    'app:toggleMini': () => windows.toggleMini(),
    'app:closeMini': () => windows.closeMini(),
    'app:showMain': () => { if (ctx.showMain) return ctx.showMain(); const w = ctx.win(); if (w) { w.show(); if (w.isMinimized()) w.restore(); w.focus(); } return true; },
    'app:mode': () => ({ safeMode: ctx.safeMode || null, diet: !!ctx.diet, dietSetting: !!settings.get('performance.dietMode') }),
    'app:restartSafe': () => { require('./startup').requestSafeNext(true); app.relaunch({ args: process.argv.slice(1).filter(a => a !== '--safe-mode' && a !== '--hidden') }); setTimeout(() => app.quit(), 100); return true; },
    'app:restartNormal': () => { require('./startup').requestSafeNext(false); app.relaunch({ args: process.argv.slice(1).filter(a => a !== '--safe-mode' && a !== '--hidden') }); setTimeout(() => app.quit(), 100); return true; },
    'app:metrics': () => {
      const m = app.getAppMetrics();
      const mb = (k) => Math.round(m.filter(k).reduce((a, p) => a + (p.memory?.workingSetSize || 0), 0) / 1024);
      return { totalMB: mb(() => true), rendererMB: mb(p => p.type === 'Tab'), processes: m.length, deepIdleMin: settings.get('performance.deepIdleMin') };
    },

    // reliability guards
    'guards:status': () => guards.status(),
    'guards:check': async () => { await guards.checkConnection(); return guards.status(); },

    // open roblox.com signed in as an account; inbox watcher
    'browse:open': (id, where) => browseas.openAs(String(id), typeof where === 'string' ? where : '/home'),
    'inbox:status': () => inbox.status(),
    'inbox:check': () => inbox.checkAll(),

    // desktop shortcuts, sleep timer, capacity test
    'shortcuts:create': (kind, id) => shortcuts.create(String(kind), String(id)),
    'sleeptimer:status': () => sleeptimer.status(),
    'sleeptimer:start': (minutes, action) => sleeptimer.start(minutes, String(action)),
    'sleeptimer:cancel': () => sleeptimer.cancel(),
    'capacity:quick': () => {
      const os = require('os');
      const ramGB = os.totalmem() / 1073741824, cores = os.cpus().length;
      // Rough guide before anything runs: ~1.1 GB per client after Windows and other apps.
      const byRam = Math.floor((ramGB * 0.85 - 3.5) / 1.1), byCpu = cores * 2;
      return { ramGB: Math.round(ramGB), cores, rough: Math.max(1, Math.min(byRam, byCpu, 40)), live: capacity.status().estimate };
    },
    'launchers:detect': () => launchers.detect(),
    'capacity:status': () => capacity.status(),
    'capacity:run': (ids, game, opts) => {
      const p = capacity.runTest((Array.isArray(ids) ? ids : []).map(String), String(game || ''), { closeAfter: opts?.closeAfter !== false, settleSec: Math.min(180, Math.max(30, Number(opts?.settleSec) || 60)) });
      p.catch(e => bus.emit('notify', { level: 'error', title: 'Capacity test', message: e.message }));
      return { started: true };
    },
    'capacity:cancel': () => capacity.cancel(),


    // theme studio
    // share codes & theme gallery
    'share:create': (kind, id, opts) => require('./modules/sharecodes').create(String(kind), String(id ?? ''), { name: typeof opts?.name === 'string' ? opts.name.slice(0, 50) : '' }),
    'share:preview': (text) => require('./modules/sharecodes').preview(String(text || '').slice(0, 50000)),
    'share:import': (text) => require('./modules/sharecodes').importCode(String(text || '').slice(0, 50000)),
    'share:fromClipboard': () => { try { return require('./modules/sharecodes').find(require('electron').clipboard.readText()); } catch { return null; } },
    'gallery:list': (refresh) => require('./modules/gallery').list(!!refresh),
    'gallery:restore': (t) => themes.restore(t && typeof t === 'object' ? t : {}),
    'theme:presets': () => Object.fromEntries(Object.entries(themes.PRESETS).map(([k, v]) => [k, { label: v.label, accentHue: v.accentHue, secondaryHue: v.theme.secondaryHue, bgType: v.theme.bgType }])),
    'theme:apply': (id) => themes.applyPreset(String(id)),
    'theme:background': () => themes.background(),
    'theme:pickBackground': async () => {
      const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { properties: ['openFile'], filters: [{ name: 'Images and videos', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      return themes.storeBackground(r.filePaths[0]);
    },
    'theme:clearBackground': () => themes.clearBackground(),
    'theme:export': () => saveFile('MultiMenu.mmtheme', themes.exportText(), [{ name: 'MultiMenu theme', extensions: ['mmtheme'] }]),
    'theme:import': async () => {
      const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { properties: ['openFile'], filters: [{ name: 'MultiMenu theme', extensions: ['mmtheme', 'json'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      if (fs.statSync(r.filePaths[0]).size > 20 * 1024 * 1024) throw new Error('That theme file is too large.');
      return themes.importText(fs.readFileSync(r.filePaths[0], 'utf8'));
    },


    // resume, follow my main, automatic backups, stats
    'resume:status': () => resume.status(),
    'resume:go': () => resume.resume(),
    'resume:dismiss': () => resume.dismiss(),
    'follow:status': () => follow.status(),
    'follow:checkNow': async () => { await follow.tick(); return follow.status(); },
    'autobackup:status': () => autobackup.status(),
    'autobackup:setPassword': (pw) => autobackup.setPassword(String(pw || '')),
    'autobackup:run': () => autobackup.runNow(),
    'autobackup:pickFolder': async () => {
      const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { properties: ['openDirectory', 'createDirectory'], title: 'Choose where automatic backups go' });
      if (r.canceled || !r.filePaths[0]) return null;
      settings.set('autoBackup.folder', r.filePaths[0]);
      return autobackup.status();
    },
    'autobackup:openFolder': () => { const f = settings.get('autoBackup.folder'); if (!f) throw new Error('No folder chosen.'); return shell.openPath(f); },
    'stats:overview': () => stats.overview(),
    'stats:saveImage': async (rect, name) => {
      const w = ctx.win();
      const r = rect && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k])) ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : undefined;
      const img = await w.webContents.capturePage(r);
      const out = await dialog.showSaveDialog(w, { defaultPath: name === 'card' ? 'MultiMenu-profile-card.png' : `MultiMenu-Wrapped-${new Date().toISOString().slice(0, 7)}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
      if (out.canceled || !out.filePath) return null;
      require('fs').writeFileSync(out.filePath, img.toPNG());
      return out.filePath;
    },

    // error codes, memory guard, outfits, friend alts
    'errors:all': () => errorcodes.all(),
    'memguard:status': () => memguard.status(),
    'memguard:restart': (id) => memguard.restartNow(String(id)),
    'outfits:list': (accountId) => avatars.listOutfits(String(accountId)),
    'outfits:wear': (accountId, outfitId) => avatars.wear(String(accountId), outfitId),
    'outfits:copy': (fromId, outfitId, toIds) => avatars.copy(String(fromId), outfitId, (Array.isArray(toIds) ? toIds : []).map(String)),
    'alts:friend': (ids) => avatars.friendAlts((Array.isArray(ids) ? ids : []).map(String)),

    // first-run wizard
    'app:firstRunDone': () => { settings.set('firstRunDone', true); return true; },

    // Discord remote control & Rich Presence & daily report
    'remote:status': () => remote.status(),
    'remote:setToken': (t) => remote.setToken(t),
    'remote:connect': () => remote.connect(),
    'remote:disconnect': () => remote.disconnect(),
    'remote:invite': () => { const u = remote.status().inviteUrl; if (!u) throw new Error('Connect the bot first.'); return shell.openExternal(u); },
    'report:status': () => report.status(),
    'report:send': () => report.sendNow(),
    'app:openDevPortal': () => shell.openExternal('https://discord.com/developers/applications'),

    // account health
    'health:summary': () => health.summary(),
    'logincheck:status': () => require('./modules/logincheck').status(),
    'logincheck:run': () => require('./modules/logincheck').evening(),
    'health:checkAll': () => health.checkAll(),
    'health:check': (id) => health.checkOne(String(id)),

    // screenshots
    'watcher:shot': (name) => capture.readDataUrl(String(name)),
    'watcher:openShots': () => { require('fs').mkdirSync(capture.dir(), { recursive: true }); return shell.openPath(capture.dir()); },

    // 24/7 watcher
    'watcher:status': () => watcher.status(),
    'watcher:enable': (on) => watcher.setEnabled(!!on),
    'watcher:cancel': (id) => watcher.cancelPending(String(id)),
    'watcher:stats': (days) => stats.summary(Math.min(30, Math.max(1, Number(days) || 7))),
    'watcher:events': () => stats.events(150),
    'watcher:clearStats': () => { stats.clear(); return true; },
    'sessions:setWatch': (id, on) => sessions.setWatch(String(id), !!on),
    'sessions:log': (id, filter) => {
      const s = sessions.getRaw(String(id));
      if (!s?.logFile) throw new Error('No Roblox log has been matched to this session yet. It appears a few seconds after the client starts.');
      return { file: s.logFile.split(/[\\/]/).pop(), lines: robloxlogs.tail(s.logFile, 500, typeof filter === 'string' ? filter.slice(0, 100) : '') };
    },
    'sessions:openLogFolder': () => { const d = robloxlogs.logsDir(); if (!d) throw new Error('Roblox logs folder not found.'); return shell.openPath(d); },

    // presets & schedule
    'presets:list': () => presets.list(),
    'presets:save': (p) => presets.save(p || {}),
    'presets:remove': (id) => presets.remove(String(id)),
    'presets:run': (id) => presets.run(String(id)),
    'presets:close': (id) => presets.closePreset(String(id)),
    'schedule:list': () => ({ tasks: scheduler.view(), actions: scheduler.ACTIONS, quiet: watcher.isQuiet() }),
    'schedule:save': (t) => scheduler.save(t || {}),
    'schedule:remove': (id) => scheduler.remove(String(id)),
    'schedule:run': (id) => scheduler.runNow(String(id)),

    // background limiter
    'limiter:status': () => limiter.status(),
    'limiter:start': () => limiter.start(),
    'limiter:stop': () => limiter.stop(),

    // servers & friends
    'hatch:status': () => require('./modules/hatch').status(),
    'hatch:output': (id) => require('./modules/hatch').outputTail(String(id)),
    'hatch:badges': (placeId) => require('./modules/hatch').gameBadges(placeId ? String(placeId) : undefined),
    'hatch:testScreen': (id) => require('./modules/hatch').testScreen(String(id)),
    'hatch:test': () => require('./modules/hatch').test(),
    'hatch:clear': () => require('./modules/hatch').clearLog(),
    'hatch:shot': (name) => require('./modules/capture').readDataUrl(String(name || '')),
    'hatch:reset': () => { const d = settings.DEFAULTS.hatch; for (const k of ['places', 'words', 'pets']) settings.set(`hatch.${k}`, d[k].slice()); require('./modules/hatch').reschedule(); return settings.get('hatch'); },
    'servers:games': () => servers.listGames(),
    'servers:addGame': (g) => servers.addGame(g || {}),
    'servers:removeGame': (id) => servers.removeGame(String(id)),
    'servers:renameGame': (id, n) => servers.renameGame(String(id), n),
    'servers:browse': (input, cursor) => servers.browse(String(input || ''), typeof cursor === 'string' ? cursor : undefined),
    'servers:join': (ids, placeId, jobId) => servers.joinServer(ids, placeId, jobId),
    'servers:emptiest': (ids, input) => servers.joinEmptiest(ids, String(input || '')),
    'servers:friends': (accountId) => servers.friends(String(accountId)),
    'servers:joinUser': (ids, userId) => servers.joinUser(ids, userId),
    'servers:squad': (ids, input) => servers.squad(ids, String(input || '')),

    // encrypted backup
    'backup:export': async (password) => {
      const { text, count } = backup.exportVault(String(password || ''));
      const p = await saveFile(`MultiMenu-backup-${new Date().toISOString().slice(0, 10)}.mmvault`, text, [{ name: 'MultiMenu backup', extensions: ['mmvault'] }]);
      return p ? { path: p, count } : null;
    },
    'backup:import': async (password) => {
      const f = await pickFile([{ name: 'MultiMenu backup', extensions: ['mmvault', 'json'] }]);
      if (!f) return null;
      const vault = backup.decryptJson(f.text, String(password || ''));
      return backup.restoreVault(vault);
    },
    'accounts:details': (id) => accounts.details(String(id)),
    'accounts:detailsAll': () => accounts.detailsAll(),

    // window tiling (OpenMulti box)
    'tiler:preview': (overrides) => tiler.preview(overrides && typeof overrides === 'object' ? { sampleCount: Number(overrides.sampleCount) || 0 } : {}),
    'tiler:tile': () => tiler.tile(),
    'tiler:restore': () => tiler.restore(),
    'tiler:minimizeAll': () => tiler.minimizeAll(),
    'tiler:showAll': () => tiler.showAll(),
    'tiler:focus': (id) => tiler.focus(String(id)),
    'tiler:minimize': (id) => tiler.minimize(String(id)),
    'tiler:topmost': (id) => tiler.toggleTopmost(String(id)),
    'tiler:tiny': (id, on) => tiler.setTiny(String(id), !!on),
    'tiler:swap': (a, b) => tiler.swap(String(a), String(b)),
    'tiler:order': (ids) => tiler.setOrder(ids),
    'tiler:focusMode': (on, id) => tiler.setFocus(!!on, id ? String(id) : undefined),
    'tiler:focusToggle': () => tiler.toggleFocus(),
    'tiler:focusNext': (step) => tiler.focusNext(Number(step) === -1 ? -1 : 1),
    'phone:status': (pick) => require('./modules/phone').details(typeof pick === 'string' ? pick.slice(0, 60) : ''),
    'phone:check': (address) => require('./modules/phone').check(typeof address === 'string' ? address.slice(0, 60) : ''),
    'phone:openFix': (kind) => {
      if (kind === 'network') return shell.openExternal('ms-settings:network-status');
      if (kind === 'firewall') { require('child_process').spawn('control.exe', ['/name', 'Microsoft.WindowsFirewall', '/page', 'pageConfigureApps'], { detached: true, stdio: 'ignore', windowsHide: false }).unref(); return true; }
      return false;
    },
    'phone:enable': async (on) => { await require('./modules/phone').setEnabled(!!on); return require('./modules/phone').details(); },
    'phone:setPin': (pin) => { require('./modules/phone').setPin(String(pin || '')); return require('./modules/phone').details(); },
    'phone:newPin': () => { const ph = require('./modules/phone'); const pin = ph.randomPin(); ph.setPin(pin); return { pin }; },
    'phone:signOutAll': () => require('./modules/phone').signOutAll(),
    'phone:forget': (id) => { const ph = require('./modules/phone'); ph.forgetDevice(String(id)); return ph.details(); },
    // rotation, auto-scale, eco mode, game profiles
    'rotation:status': () => require('./modules/rotation').status(),
    'rotation:enable': (on) => require('./modules/rotation').setEnabled(!!on),
    'rotation:now': () => require('./modules/rotation').rotateNow(),
    'autoscale:status': () => require('./modules/autoscale').status(),
    'autoscale:enable': (on) => require('./modules/autoscale').setEnabled(!!on),
    'limiter:eco': (on) => limiter.setEco(!!on),
    'gameprofiles:list': () => require('./modules/gameprofiles').list(),
    'gameprofiles:save': (p) => require('./modules/gameprofiles').save(p && typeof p === 'object' ? p : {}),
    'gameprofiles:remove': (placeId) => require('./modules/gameprofiles').remove(String(placeId)),

    // insights, health scores, timeline, achievements, Wrapped
    'insights:list': () => require('./modules/insights').list(),
    'insights:dismiss': (id) => require('./modules/insights').dismiss(String(id)),
    'health:scores': () => require('./modules/healthscore').all(),
    'timeline:query': (hours) => require('./modules/timeline').query(Number(hours) || 24),
    'achievements:status': () => require('./modules/achievements').status(),
    'stats:wrapped': (period) => {
      const ov = stats.overview();
      const w = period === 'lastMonth' ? ov.lastMonth : period === 'year' ? ov.year : ov.wrapped;
      const [y, m] = w.month.split('-').map(Number);
      const from = new Date(y, m ? m - 1 : 0, 1).getTime(), to = m ? new Date(y, m, 1).getTime() : new Date(y + 1, 0, 1).getTime();
      return { ...w, period: period || 'month', streak: ov.streak, achievements: require('./modules/achievements').unlockedBetween(from, to) };
    },
    'stats:copyImage': async (rect) => {
      const w = ctx.win();
      const r = rect && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k])) ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : undefined;
      const img = await w.webContents.capturePage(r);
      require('electron').clipboard.writeImage(img);
      return true;
    },

    // alt performance (presets, fine-tune, measure)
    'perf:info': () => require('./modules/perfprofile').info(),
    'perf:apply': async (values) => {
      if (!values || typeof values !== 'object') throw new Error('Nothing to apply.');
      const order = Object.keys(values).sort((a, b) => (a === 'ramTrimmer.enabled') - (b === 'ramTrimmer.enabled') || (a === 'limiter.eco') - (b === 'limiter.eco'));
      const done = [];
      for (const key of order) {
        const v = values[key];
        if (!/^(perf\.|limiter\.eco$|ramTrimmer\.(enabled|intervalSec)$)/.test(key)) continue;
        if (key === 'ramTrimmer.enabled') { try { if (v) trimmer.start(); else trimmer.stop(); } catch (e) { log.warn(`trimmer: ${e.message}`); } done.push(key); continue; }
        if (key === 'limiter.eco') { try { if (v || limiter.status().running) limiter.setEco(!!v); else settings.set('limiter.eco', false); } catch (e) { settings.set('limiter.eco', !!v); log.warn(`eco: ${e.message}`); } done.push(key); continue; }
        setSetting(key, v); done.push(key);
      }
      bus.emit('perf:changed', require('./modules/perfprofile').info());
      return { changed: done.length, settings: settings.all() };
    },
    'perf:measure': (planned) => require('./modules/perfprofile').measure(Number(planned) || 1),

    // MultiMenu Doctor
    'doctor:run': () => require('./modules/doctor').run(),
    'doctor:fix': (id) => require('./modules/doctor').fix(String(id)),
    'doctor:fixAll': () => require('./modules/doctor').fixAll(),

    // automations & spoken alerts
    'automations:list': () => { const a = require('./modules/automations'); return { rules: a.list(), catalog: a.catalog(), log: a.runLog() }; },
    'automations:catalog': () => require('./modules/automations').catalog(),
    'automations:save': (r) => require('./modules/automations').save(r && typeof r === 'object' ? r : {}),
    'automations:remove': (id) => require('./modules/automations').remove(String(id)),
    'automations:enable': (id, on) => require('./modules/automations').setEnabled(String(id), !!on),
    'automations:run': (id) => require('./modules/automations').runNow(String(id)),
    'automations:clearLog': () => require('./modules/automations').clearLog(),
    'presence:status': () => require('./modules/richpresence').status(),
    'launchqueue:view': () => sessions.queueView(),
    'accounts:exportColumns': () => Object.fromEntries(Object.entries(accounts.EXPORT_COLUMNS).map(([k, [label]]) => [k, label])),
    'accounts:copyList': (o) => { const r = accounts.exportList({ ...(o || {}), format: 'txt' }); require('electron').clipboard.writeText(r.text); return { count: r.count }; },
    'accounts:saveList': async (o) => {
      const opts = o && typeof o === 'object' ? o : {};
      const csv = opts.format !== 'txt';
      const r = accounts.exportList({ ids: opts.ids, columns: opts.columns, format: csv ? 'csv' : 'txt' });
      const date = new Date().toISOString().slice(0, 10);
      const file = await saveFile(`MultiMenu-accounts-${date}.${csv ? 'csv' : 'txt'}`, r.text, csv ? [{ name: 'Spreadsheet (CSV)', extensions: ['csv'] }] : [{ name: 'Text', extensions: ['txt'] }]);
      return file ? { count: r.count, file } : null;
    },
    'games:search': (q, token) => require('./modules/roblox').searchGames(String(q || ''), token ? String(token) : null),
    'customlayouts:list': () => require('./modules/customlayouts').list(),
    'customlayouts:save': (l) => { const r = require('./modules/customlayouts').save(l && typeof l === 'object' ? l : {}); try { bus.emit('tiler:update', tiler.preview()); } catch { /* no screen */ } return r; },
    'customlayouts:remove': (id) => { const r = require('./modules/customlayouts').remove(String(id)); try { bus.emit('tiler:update', tiler.preview()); } catch { /* no screen */ } return r; },
    'tiler:previewZones': (zones, sampleCount) => tiler.preview({ zones: require('./modules/customlayouts').cleanZones(zones), sampleCount: Math.min(40, Math.max(0, Number(sampleCount) || 0)) }),
    'launchqueue:move': (qid, to) => sessions.queueMove(String(qid), Number(to)),
    'launchqueue:remove': (qid) => sessions.queueRemove(String(qid)),
    'launchqueue:clear': () => sessions.queueClear(),
    'launchqueue:next': () => sessions.queueSkipWait(),
    'speech:voices': () => require('./modules/speech').voices(),
    'speech:test': (text) => require('./modules/speech').speak(String(text || 'This is MultiMenu. Your alerts will sound like this.').slice(0, 200), { force: true }),

    // the shared command table (same as the command line and local API)
    'cmd:run': (name, args) => require('./modules/commands').run(String(name), args && typeof args === 'object' && !Array.isArray(args) ? args : {}, { source: 'app' }),

    // Alt Wall, switcher, overlay labels
    'wall:data': () => require('./modules/wall').data(),
    'wall:thumbs': (width) => require('./modules/wall').thumbs(null, Math.min(480, Math.max(120, Number(width) || 320))),
    'switcher:open': () => { windows.openSwitcher(); return true; },
    'switcher:close': () => windows.closeSwitcher(),
    'overlay:status': () => require('./modules/overlay').status(),
    'overlay:enable': (on) => require('./modules/overlay').setEnabled(!!on),

    // local API, command line, Stream Deck
    'api:status': () => require('./modules/api').status(),
    'api:enable': async (on) => { await require('./modules/api').setEnabled(!!on); return require('./modules/api').status(); },
    'api:key': () => require('./modules/api').key(),
    'api:newKey': () => require('./modules/api').newKey(),
    'api:cliInfo': () => { const dir = require('path').dirname(process.execPath); const mm = require('path').join(dir, 'mm.cmd'); return { folder: dir, mm, exists: fs.existsSync(mm) }; },
    'api:openFolder': () => shell.openPath(require('path').dirname(process.execPath)),
    'streamdeck:install': async () => {
      const path = require('path');
      const file = [path.join(process.resourcesPath || '', 'MultiMenu.streamDeckPlugin'), path.join(__dirname, '..', '..', 'streamdeck', 'dist', 'MultiMenu.streamDeckPlugin')].find(f => fs.existsSync(f));
      if (!file) throw new Error('The Stream Deck plugin isn\'t in this build. Download MultiMenu.streamDeckPlugin from the GitHub release.');
      const err = await shell.openPath(file);
      if (err) throw new Error(`${err} Is the Stream Deck app installed?`);
      return true;
    },
    'layouts:status': () => require('./modules/layouts').status(),
    'layouts:forget': (sig) => require('./modules/layouts').forget(String(sig)),
    'pip:open': (id) => require('./modules/pip').open(id ? String(id) : undefined),
    'pip:close': () => require('./modules/pip').close(),
    'pip:info': () => require('./modules/pip').info(),
    'pip:status': () => require('./modules/pip').status(),
    'pip:set': (id) => require('./modules/pip').setTarget(String(id)),
    'pip:focusTarget': () => require('./modules/pip').focusTarget(),

    // system / performance
    'system:info': () => system.info(),
    'system:latest': () => system.latest(),
    'system:history': () => system.history(),
    'system:processes': () => processes.top(30),
    'system:recommendations': () => system.recommendations(),
    'fps:graphics': () => fps.readGraphics(),
    'fps:setGraphics': (patch) => fps.writeGraphics(patch || {}),
    'fps:caps': () => fps.FPS_CAPS,
    'fps:profiles': () => fps.PROFILES,
    'fps:applyProfile': (id) => {
      const p = fps.PROFILES[id];
      if (!p) throw new Error('Unknown profile');
      const out = { profile: p.label, steps: [] };
      try { fps.writeGraphics({ fpsCap: p.fpsCap, quality: p.quality }); out.steps.push('Roblox graphics + FPS cap saved'); } catch (e) { out.steps.push(`Roblox settings: ${e.message}`); }
      setSetting('performance.lowResourceMode', p.lowResource); out.steps.push(`Low-resource mode ${p.lowResource ? 'on' : 'off'}`);
      try { if (p.trimmer) trimmer.start(); else trimmer.stop(); out.steps.push(`RAM Trimmer ${p.trimmer ? 'on' : 'off'}`); } catch (e) { out.steps.push(`RAM Trimmer: ${e.message}`); }
      return out;
    },
    'fps:status': () => fps.presentMonStatus(),
    'fps:start': () => fps.startPresentMon(),
    'fps:stop': () => fps.stopPresentMon(),
    'fps:pickPresentMon': async () => {
      const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { properties: ['openFile'], filters: [{ name: 'PresentMon', extensions: ['exe'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      settings.set('fps.presentMonPath', r.filePaths[0]);
      return r.filePaths[0];
    },

    // RAM trimmer
    'trimmer:status': () => trimmer.status(),
    'trimmer:start': () => trimmer.start(),
    'trimmer:stop': () => trimmer.stop(),
    'trimmer:trimNow': () => trimmer.trimNow('manual'),
    'trimmer:preview': () => trimmer.preview(),

    // automation
    'clicker:status': () => clicker.status(),
    'clicker:start': () => clicker.start(),
    'clicker:stop': () => clicker.stop(),
    'clicker:capture': () => clicker.capturePosition(),
    'macros:list': () => macros.list(),
    'macros:get': (id) => macros.get(id),
    'macros:status': () => macros.status(),
    'macros:record': () => macros.startRecording(),
    'macros:pause': () => macros.pauseRecording(),
    'macros:stopRecording': (name) => { const r = macros.stopRecording(true, name); if (r.saved) hotkeys.setLastMacro(r.saved.id); return r; },
    'macros:discard': () => macros.stopRecording(false),
    'macros:play': (id, opts) => macros.startPlayback(id, opts || {}),
    'macros:stop': () => macros.stopPlayback(),
    'macros:rename': (id, name) => macros.rename(id, name),
    'macros:remove': (id) => macros.remove(id),
    'macros:import': async () => { const f = await pickFile([{ name: 'MultiMenu macro', extensions: ['json', 'mmacro'] }]); return f ? macros.importText(f.text) : null; },
    'macros:export': async (id) => { const m = macros.get(id); return saveFile(`${m.name.replace(/[^\w -]/g, '')}.json`, macros.exportText(id), [{ name: 'MultiMenu macro', extensions: ['json'] }]); },
    'automation:emergencyStop': () => { hotkeys.emergencyStop(); return true; },
    'antiafk:status': () => antiafk.status(),
    'antiafk:start': () => antiafk.start(),
    'antiafk:stop': () => antiafk.stop(),
    'antiafk:runNow': () => antiafk.runNow(),

    // discord
    'discord:list': () => webhooks.listHooks(),
    'discord:add': (name, url) => webhooks.addHook(name, url),
    'discord:update': (id, patch) => webhooks.updateHook(id, patch || {}),
    'discord:remove': (id) => webhooks.removeHook(id),
    'discord:test': (id) => webhooks.test(id, app.getVersion()),
    'discord:history': () => webhooks.history(),
    'discord:clearHistory': () => webhooks.clearHistory(),
    'discord:events': () => Object.fromEntries(Object.entries(webhooks.EVENTS).filter(([k]) => k !== 'test').map(([k, v]) => [k, v.title])),

    // Telegram, ntfy, Pushover, email
    'alertapps:list': () => ({ channels: require('./modules/alertapps').list(), history: require('./modules/alertapps').history(), defaults: require('./modules/alertapps').DEFAULT_EVENTS, presets: require('./modules/alertapps').EMAIL_PRESETS }),
    'alertapps:save': (c) => require('./modules/alertapps').save(c && typeof c === 'object' ? c : {}),
    'alertapps:remove': (id) => require('./modules/alertapps').remove(String(id)),
    'alertapps:enable': (id, on) => require('./modules/alertapps').setEnabled(String(id), !!on),
    'alertapps:test': (id) => require('./modules/alertapps').test(String(id)),
    'alertapps:telegramChats': (token, id) => require('./modules/alertapps').telegramChats(String(token || ''), id ? String(id) : null),
    'alertapps:topic': () => require('./modules/alertapps').randomTopic(),

    // notifications
    'notifications:list': () => notifications.list(),
    'notifications:read': () => notifications.markAllRead(),
    'notifications:clear': () => notifications.clear(),

    // updates
    'updates:status': () => updater.status(),
    'updates:check': () => updater.check({ manual: true }),
    'updates:download': () => updater.download(),
    'updates:install': () => updater.install(),
    'updates:remind': () => updater.remindLater(24),
    'updates:openRelease': () => { const u = updater.status().latest?.url; if (u) shell.openExternal(u); return !!u; },
  };
}

function register(ctx) {
  const handlers = makeHandlers(ctx);
  // Admin mode (src/main/admin): its commands refuse to run until a signed admin code unlocks them.
  const admin = require('./admin');
  Object.assign(handlers, admin.handlers(handlers));
  ipcMain.handle('mm', async (event, channel, ...args) => {
    // Only our own window, loaded from our own files, may call in.
    const url = event.senderFrame?.url || '';
    if (!url.startsWith('file://') || !(ctx.windows ? ctx.windows() : [ctx.win()]).some(w => w && w.webContents === event.sender)) return { __error: true, message: 'Forbidden' };
    if (typeof channel !== 'string') return { __error: true, message: 'Bad command' };
    if (channel.startsWith('admin:')) { const no = admin.blocked(channel); if (no) return { __error: true, message: no }; }
    const h = Object.prototype.hasOwnProperty.call(handlers, channel) ? handlers[channel] : null;
    if (!h) return { __error: true, message: `Unknown command ${channel}` };
    const t0 = admin.active ? performance.now() : 0;
    try {
      const r = await h(...args);
      if (t0) admin.ipcDone(channel, performance.now() - t0, true);
      return r;
    } catch (e) {
      if (t0) admin.ipcDone(channel, performance.now() - t0, e.code === 'CANCELLED', e.message);
      if (e.code !== 'CANCELLED') log.warn(`${channel} failed: ${e.message}`);
      return { __error: true, message: logger.redact(e.message || String(e)), code: e.code };
    }
  });

  // Forward bus events to the UI.
  const forward = ['admin:feed', 'hatch:new', 'presence:update', 'launchqueue:changed', 'system:sample', 'sessions:changed', 'sessions:stats', 'accounts:changed', 'notifications:new', 'trimmer:update', 'clicker:update',
    'macros:update', 'macros:changed', 'antiafk:update', 'updater:update', 'updater:available', 'fps:update', 'tiler:update', 'pip:update', 'phone:update', 'logincheck:update',
    'watcher:update', 'limiter:update', 'presets:changed', 'schedule:changed', 'remote:update', 'system:idle', 'alts:progress', 'follow:update', 'autobackup:update',
    'guards:update', 'sleeptimer:update', 'clipboard:link', 'capacity:update', 'theme:changed', 'api:update', 'overlay:update', 'rotation:update', 'autoscale:update', 'gameprofiles:changed', 'automations:changed', 'automations:ran', 'achievements:update', 'perf:changed'];
  forward.push(...require('./v31').EVENTS);
  // Live numbers wait while a window is hidden (Settings → Performance → Pause page updates while hidden).
  const lean = require('./modules/lean');
  for (const ev of forward) bus.on(ev, payload => { for (const w of (ctx.windows ? ctx.windows() : [ctx.win()])) lean.send(w, ev, payload); });
  return handlers;
}

module.exports = { register, makeHandlers, setSetting, ENUMS, RANGES };
