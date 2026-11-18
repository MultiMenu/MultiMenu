'use strict';
const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage, session } = require('electron');

// Portable builds keep everything (including Chromium's cache) next to the exe.
const paths = require('./paths');
if (paths.isPortable) app.setPath('userData', paths.dataDir);
app.setAppUserModelId('com.multimenu.app');

// Command line: `MultiMenu.exe --cli status` asks the running MultiMenu and exits.
if (process.argv.includes('--cli')) {
  require('./cli').runClient(process.argv, paths.dataDir, (code) => app.exit(code));
  return;
}

const SELF_TEST = process.argv.includes('--self-test');
if (!SELF_TEST && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// Safe mode and diet mode are decided before Electron is ready.
const startup = require('./startup');
const SAFE_MODE = SELF_TEST ? null : startup.decideSafeMode();
// If MultiMenu itself ever crashes, Electron keeps a crash file in the logs folder (nothing is sent
// anywhere), so a report can say what happened.
if (!SELF_TEST) { try { app.setPath('crashDumps', require('path').join(paths.logsDir(), 'crashes')); require('electron').crashReporter.start({ uploadToServer: false }); } catch { /* not supported */ } }
const DIET = !SELF_TEST && startup.early().diet;
if (DIET) startup.applyDiet(app);

const logger = require('./logger');
const bus = require('./bus');

let mainWindow = null;
let tray = null;
let quitting = false;
const windows = require('./main-windows');
/** Text size from Settings → Appearance, as a page zoom (80–150%). */
const textZoom = () => Math.min(1.5, Math.max(0.8, (Number(require('./modules/settings').get('appearance.textSize')) || 100) / 100));
const ctx = { win: () => mainWindow, windows: () => windows.all(), updatedFrom: null, safeMode: SAFE_MODE, diet: DIET };

function iconPath(name = 'icon.png') { return path.join(__dirname, '..', '..', 'build', name); }

/** The main window's options (also used by the self-test, so it opens the same window). */
function mainWindowOptions() {
  const settings = require('./modules/settings');
  const mode = settings.get('appearance.mode');
  const light = mode === 'light' || (mode === 'system' && !require('electron').nativeTheme.shouldUseDarkColors);
  return {
    width: 1320, height: 840, minWidth: 1040, minHeight: 680, frame: false, show: false,
    backgroundColor: light ? '#f5f2fb' : '#07040d', title: 'MultiMenu', icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false, backgroundThrottling: true, zoomFactor: textZoom(),
    },
  };
}

function createWindow(forceShow = false) {
  const settings = require('./modules/settings');
  const hidden = !forceShow && (process.argv.includes('--hidden') || settings.get('startup.startMinimized'));
  deepIdle = false;
  mainWindow = new BrowserWindow(mainWindowOptions());
  mainWindow.removeMenu();
  windows.setMain(mainWindow);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Backup: some graphics drivers never report the first paint. Show the window anyway after 10 s.
  const win = mainWindow;
  const fallback = hidden ? null : setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) { logger.scope('main').warn('Window shown without a paint signal (graphics driver?)'); win.show(); }
  }, 10_000);
  mainWindow.once('ready-to-show', () => { clearTimeout(fallback); logger.scope('main').info(hidden ? 'Window ready (hidden in the tray)' : 'Window shown'); if (!hidden) win.show(); else scheduleDeepIdle(); });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', e => e.preventDefault());
  // A crashed page (out of memory, a graphics driver fault) reloads by itself instead of staying blank.
  let crashes = [];
  mainWindow.webContents.on('render-process-gone', (_e, d) => {
    if (!d || d.reason === 'clean-exit') return;
    logger.scope('main').error(`Window crashed (${d.reason}, code ${d.exitCode})`);
    const now = Date.now();
    crashes = crashes.filter(t => now - t < 120_000);
    crashes.push(now);
    if (crashes.length > 3) { logger.scope('main').error('Window keeps crashing: not reloading it again'); return; }
    setTimeout(() => {
      if (win.isDestroyed()) return;
      win.webContents.reload();
      win.webContents.once('did-finish-load', () => bus.emit('notify', { level: 'warn', title: 'The window crashed', message: 'MultiMenu reloaded it. Everything in the background kept running.' }));
    }, 1000);
  });
  mainWindow.on('unresponsive', () => logger.scope('main').warn('Window stopped responding'));
  mainWindow.on('responsive', () => logger.scope('main').info('Window responding again'));
  mainWindow.on('close', (e) => {
    if (!quitting && settings.get('startup.closeToTray') && tray) { e.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  // Windows shutting down or signing out isn't a crash: don't count it toward safe mode.
  mainWindow.on('session-end', () => startup.markClosed());
  const idleCheck = () => setTimeout(() => {
    const hidden = !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized();
    require('./modules/system').setIdle(hidden && !windows.getMini());
    require('./modules/lean').windowHidden(hidden);
    scheduleDeepIdle();
  }, 300);
  for (const ev of ['hide', 'show', 'minimize', 'restore']) mainWindow.on(ev, idleCheck);
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// Deep idle: when the window has sat hidden in the tray for a while, close the
// page entirely (Chromium's renderer is most of MultiMenu's memory). Everything
// keeps running in the background; the window is rebuilt when you open it.
let deepIdle = false, deepIdleTimer = null;
function scheduleDeepIdle() {
  clearTimeout(deepIdleTimer);
  const settings = require('./modules/settings');
  // Diet mode closes the hidden window after 3 minutes at most.
  const set = Number(settings.get('performance.deepIdleMin')) || 0;
  const mins = DIET ? Math.min(set || 3, 3) : set;
  if (!mins || !mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible() || !tray) return;
  deepIdleTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible() || quitting) return;
    logger.scope('main').info(`Deep idle: closing the hidden window after ${mins} min to save memory`);
    deepIdle = true;
    mainWindow.destroy();
  }, mins * 60_000);
}
function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(true);
  else { mainWindow.show(); if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  return true;
}
ctx.showMain = showMain;
ctx.isDeepIdle = () => deepIdle;

function setTrayMenu() {
  if (!tray) return;
  const { t } = require('./i18n');
  const show = () => showMain();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('Open MultiMenu'), click: show },
    { label: t('Mini panel'), click: () => windows.toggleMini() },
    { label: t('Tile Roblox windows'), click: () => { require('./modules/tiler').tile().catch((e) => { bus.emit('notify', { level: 'warn', title: 'Tile windows', message: e.message }); }); } },
    { label: t('Sleep timer: close all in 1 hour'), click: () => { try { require('./modules/sleeptimer').start(60, 'close'); } catch (e) { logger.scope('main').warn(e.message); } } },
    { label: t('Emergency stop automation'), click: () => require('./modules/hotkeys').emergencyStop() },
    { type: 'separator' },
    { label: t('Quit'), click: () => { quitting = true; app.quit(); } },
  ]));
}
ctx.setTrayMenu = setTrayMenu;

function createTray() {
  try {
    const img = nativeImage.createFromPath(iconPath('tray.png'));
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    tray.setToolTip('MultiMenu');
    const show = () => showMain();
    setTrayMenu();
    tray.on('click', show);
  } catch (e) { logger.scope('main').warn('Tray unavailable', e.message); }
}

function lockDownSessions() {
  // Default session (our UI): strict CSP and no permission prompts.
  // Only the picture-in-picture window may capture, and only the Roblox window MultiMenu hands it.
  const pipOnly = (wc, perm) => ['media', 'display-capture'].includes(perm) && !!wc && windows.getPip()?.webContents === wc;
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(pipOnly(wc, perm)));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => pipOnly(wc, perm));
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (!details.url.startsWith('file://')) return cb({});
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; img-src 'self' data: blob: https://*.rbxcdn.com; media-src blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'"] } });
  });
}

async function boot() {
  paths.ensureDirs();
  logger.init(paths.logsDir());
  const log = logger.scope('main');
  log.info(`MultiMenu ${app.getVersion()} starting (${paths.isPortable ? 'portable' : 'installed'}) data=${paths.dataDir}${SAFE_MODE ? ` SAFE MODE (${SAFE_MODE})` : ''}${DIET ? ' diet' : ''}`);
  if (startup.endedBadly()) log.warn('The last run did not close normally (crash, or Windows ended it)');
  // Chromium helper processes (graphics, network, audio) that die are logged, so a crash report has the reason.
  app.on('child-process-gone', (_e, d) => { if (d && d.reason !== 'clean-exit') log.error(`${d.type} process ended (${d.reason}, code ${d.exitCode}${d.name ? `, ${d.name}` : ''})`); });
  setTimeout(() => startup.markHealthy(), startup.HEALTHY_MS);
  // Admin mode can ask for a snapshot restore or a factory reset: both happen here, before any data file is opened.
  try { require('./admin/data').applyPending(log); } catch (e) { log.warn(`Admin: ${e.message}`); }

  const settings = require('./modules/settings');
  settings.init();
  require('./i18n').load(settings.get('language') || 'en');
  try { require('./admin').init(ctx); } catch (e) { log.warn(`Admin: ${e.message}`); }
  require('./modules/accounts').init();
  require('./modules/webhooks').init();
  require('./modules/alertapps').init();
  require('./modules/stats').init();
  require('./modules/timeline').init();
  require('./modules/remote').init();
  require('./modules/report').init();
  require('./modules/presets').init();
  require('./modules/servers').init();
  require('./modules/gameprofiles').init();
  require('./modules/perfprofile').init();
  require('./modules/notifications').init(app.getVersion());
  const updater = require('./modules/updater');
  ctx.updatedFrom = updater.afterLaunch();

  lockDownSessions();
  require('./ipc').register(ctx);
  if (settings.get('api.cli')) { try { require('./cli').startServer(paths.dataDir); } catch (e) { log.warn(`Command line: ${e.message}`); } }
  createWindow();
  createTray();

  require('./modules/system').start();
  require('./modules/sessions').start();
  require('./modules/tiler').init();
  const shortcuts = require('./modules/shortcuts');
  shortcuts.init();
  setTimeout(() => shortcuts.handleArgs(process.argv), 2500);
  updater.start();
  bus.emit('event', { type: 'appStarted', detail: `v${app.getVersion()} (${paths.isPortable ? 'portable' : 'installed'})` });
  if (startup.endedBadly() && SAFE_MODE !== 'crashLoop') {
    mainWindow?.webContents.once('did-finish-load', () => bus.emit('notify', { level: 'warn', title: 'MultiMenu closed unexpectedly', message: 'It closed by itself last time. If that keeps happening, send the newest files from Settings → Open logs (and its crashes folder) in the Discord.', toast: false }));
  }
  // Safe mode: nothing runs by itself. Accounts, launching and settings still work.
  if (SAFE_MODE) {
    log.warn('Safe mode: background features are off for this start');
    bus.emit('notify', { level: 'warn', title: 'Safe mode', message: SAFE_MODE === 'crashLoop' ? 'MultiMenu closed unexpectedly twice, so it started with background features off.' : 'Background features are off for this start.', toast: true });
    return;
  }
  require('./modules/watcher').init();
  require('./modules/memguard').init();
  require('./modules/richpresence').init();
  require('./modules/hatch').init();
  require('./v31').init();
  require('./modules/resume').init();
  require('./modules/follow').start();
  require('./modules/autobackup').init();
  require('./modules/guards').init();
  require('./modules/inbox').start();
  require('./modules/fps').recoverOnStart();
  require('./modules/logcleaner').start();
  require('./modules/playtime').start();
  require('./modules/clipwatch').start();
  bus.on('clipboard:link', (l) => {
    const w = windows.getMain();
    if (!w || !w.isVisible() || w.isMinimized()) bus.emit('notify', { level: 'info', title: 'Roblox link copied', message: 'Open MultiMenu to launch accounts into it.', toast: false });
  });
  require('./modules/scheduler').init();
  require('./modules/health').start();
  require('./modules/logincheck').init();
  require('./modules/layouts').init();
  require('./modules/overlay').init();
  require('./modules/rotation').init();
  require('./modules/autoscale').init();
  require('./modules/automations').init();
  require('./modules/achievements').init();
  require('./modules/speech').init();
  require('./modules/phone').autoStart();
  require('./modules/api').autoStart();
  if (settings.get('remote.autoConnect') && require('./modules/remote').status().hasToken) require('./modules/remote').connect();
  if (settings.get('limiter.enabled')) { try { require('./modules/limiter').start(); } catch (e) { log.warn(e.message); } }
  if (settings.get('mini.openOnStart')) windows.openMini();
  require('./modules/hotkeys').register();
  // The trimmer comes back on if it was running when MultiMenu closed (or if it starts with the app).
  if (settings.get('ramTrimmer.enabled') || settings.get('ramTrimmer.startWithApp')) { try { require('./modules/ramtrimmer').start(); } catch (e) { log.warn(e.message); } }
  if (settings.get('antiAfk.enabled')) { try { require('./modules/antiafk').start(); } catch (e) { log.warn(e.message); } }
  if (settings.get('accounts.refreshOnStart')) setTimeout(() => require('./modules/accounts').refreshAll().catch(() => {}), 4000);
}

app.on('second-instance', (_e, argv) => {
  // A desktop shortcut / jump-list entry starts a preset without opening the window.
  if (Array.isArray(argv) && require('./modules/shortcuts').handleArgs(argv)) return;
  showMain();
});
app.on('window-all-closed', () => { if (SELF_TEST || (deepIdle && !quitting)) return; if (!tray || quitting) app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(true); });

let shutdownDone = false;
app.on('before-quit', async (e) => {
  quitting = true;
  if (shutdownDone) return;
  e.preventDefault();
  try {
    require('./modules/hotkeys').unregisterAll();
    require('./modules/clicker').stop();
    require('./modules/richpresence').disconnect();
    try { require('./modules/hatch').stop(); require('./modules/screenwatch').stop(); } catch { /* not started */ }
    try { require('./v31').stop(); } catch { /* not started */ }
    require('./modules/macros').stopAll();
    require('./modules/system').shutdown();
    require('./modules/fps').stopPresentMon();
    require('./modules/limiter').stop({ quitting: true }); // stays on for next time
    require('./modules/audio').stop();
    require('./modules/remote').disconnect();
    require('./modules/sessions').stop();
    require('./modules/sleeptimer').cancel(true);
    try { require('./modules/phone').stop(); } catch { /* not started */ }
    try { require('./modules/api').stop(); require('./cli').stopServer(); } catch { /* not started */ }
    try { require('./modules/overlay').stop(); } catch { /* not started */ }
    try { require('./modules/speech').stop(); } catch { /* not started */ }
    try { require('./modules/timeline').closeAll(); } catch { /* not started */ }
    try { require('./modules/rflags').restoreAll(); } catch { /* nothing to put back */ }
    startup.markClosed();
    await Promise.race([
      require('./modules/webhooks').send({ type: 'appClosed', detail: `v${app.getVersion()}` }, { version: app.getVersion() }),
      new Promise(r => setTimeout(r, 3000)),
    ]);
    require('./modules/settings').store?.saveNow();
  } catch (err) { logger.scope('main').error('shutdown', err); }
  shutdownDone = true;
  app.quit();
});

// The same error over and over (a timer failing every second) is logged each time,
// but reported as an "app error" alert at most once a minute.
const lastAppError = new Map();
function reportAppError(message) {
  const now = Date.now(), key = String(message).slice(0, 200);
  if (now - (lastAppError.get(key) || 0) < 60_000) return;
  lastAppError.set(key, now);
  if (lastAppError.size > 100) lastAppError.delete(lastAppError.keys().next().value);
  bus.emit('event', { type: 'appError', error: message });
}
process.on('uncaughtException', (err) => {
  logger.scope('main').error('Uncaught', err.stack || err);
  reportAppError(err.message);
});
process.on('unhandledRejection', (err) => {
  logger.scope('main').error('Unhandled rejection', err?.stack || err);
});

/** Start failed before the window existed: say so and quit, instead of running on invisibly. */
function failedToStart(err) {
  try { logger.scope('main').error('Start failed', err?.stack || err); } catch { /* logger not ready */ }
  if (mainWindow && !mainWindow.isDestroyed()) return; // the window is up: keep going without that part
  try {
    const i18n = require('./i18n');
    require('electron').dialog.showErrorBox(i18n.t('MultiMenu could not start'),
      `${i18n.t('Something went wrong while opening MultiMenu. Please send the newest log file from this folder with your report: {0}').replace('{0}', paths.logsDir())}\n\n${err?.message || err}`);
  } catch { /* no dialog possible */ }
  app.exit(1);
}

app.whenReady().then(SELF_TEST ? () => require('./selftest').run({ mainWindowOptions }) : () => boot().catch(failedToStart));
