// Sample data that stands in for the preload bridge (window.mm).
// Used by the UI screenshot tests, and by admin mode's demo mode, where it answers
// the page instead of the real MultiMenu (window.__MM_DEMO; the real bridge stays).
(function () {
const api = (() => {
  const now = Date.now();
  const listeners = {};
  const settings = {
    appearance: { accentHue: 270, particles: true, animations: true, reducedMotion: false, pauseUnfocused: true, sidebarCollapsed: false, particleCount: 40, theme: { preset: 'midnight', secondaryHue: 295, glow: 100, blur: 20, bgType: 'gradient', bgDim: 55, bgFile: '' } },
    guards: { keepAwake: true, closePopups: true, gameUpdates: true, restartOnUpdate: false, ping: true, highPingMs: 250 },
    inbox: { enabled: true, intervalMin: 5, trades: true, messages: true, friends: true },
    playtime: { enabled: false, remindMin: 180, closeAtLimit: false },
    clipboard: { enabled: true },
    sleepTimer: { lastMinutes: 60, lastAction: 'close' },
    startup: { launchOnLogin: false, startMinimized: false, closeToTray: true, showLoadingScreen: true },
    performance: { deepIdleMin: 10, idleMode: true, lowResourceMode: false, dietMode: !!window.__MM_DIET, monitorIntervalSec: 2, gpuMonitoring: true, alertRamPercent: 90, alertCpuPercent: 95, alertSustainSec: 30, checkSpeed: 'normal', pauseHidden: true, trimSelf: true, endCrashHandlers: false },
    hotkeys: { clickerToggle: 'F6', macroRecord: 'F7', macroPlay: 'Shift+F7', emergencyStop: 'F8', tileWindows: 'Ctrl+Alt+T', miniPanel: 'Ctrl+Alt+M', closeAllRoblox: 'Ctrl+Alt+K', focusMode: 'Ctrl+Alt+F', focusNext: 'Ctrl+Alt+N', pip: 'Ctrl+Alt+P' },
    tiling: { layout: 'auto', display: '1', gap: 4, padding: 0, mainRatio: 0.62, cellWidth: 800, cellHeight: 600, centerLastRow: true, autoTile: true, includeExternal: true, perMonitorSetup: true, hideTitleBars: false },
    focus: { ratio: 0.78, stripSide: 'right' },
    pip: { width: 420, opacity: 100, fps: 15 },
    loginCheck: { enabled: true, time: '21:30', beforeStart: true },
    phone: { enabled: true, port: 43821, pinHash: 'x', pinSalt: 'y', allowControl: true },
    tour: { enabled: !!window.__MM_TOUR, seen: [] },
    accounts: { defaultPlaceId: '920587237', confirmBeforeRemove: true, refreshOnStart: true, launchDelaySec: 8 },
    openMulti: { enabled: true, labelWindows: true, launchMethod: 'protocol', minimizeOnLaunch: false, restoreGraphics: true },
    robloxLogs: { clean: true, maxAgeHours: 24, maxTotalMB: 50 },
    browse: { lockPurchases: true },
    ramTrimmer: { enabled: true, intervalSec: 60, mode: 'targets', targets: ['RobloxPlayerBeta.exe'], onlyAboveSystemPercent: 0, minWorkingSetMB: 150, startWithApp: false, watchMB: 350 },
    clicker: { button: 'left', intervalMs: 100, mode: 'continuous', count: 100, doubleClick: false, positionMode: 'cursor', x: 0, y: 0 },
    macros: { playbackSpeed: 1, repeat: 1, recordMouseMoves: true },
    antiAfk: { enabled: false, intervalMin: 15, mode: 'nudge', key: 'F13', onlyTracked: false, onlyWhenAway: true, awaySec: 60 },
    fps: { presentMonPath: 'C:\\Tools\\PresentMon-2.3.0-x64.exe' },
    discord: { enabled: true, cooldownSec: 60, mention: '', events: { accountLaunched: true, accountClosed: true, accountCrashed: true, launchFailed: true, sessionError: true, appStarted: false, appClosed: false, highUsage: true, trimmer: false, appError: true, updates: true } },
    updates: { autoCheck: true, channel: 'stable', repoOverride: '', requireSignature: false, remindUntil: {}, history: [] },
    notifications: { toasts: true },
    watcher: { enabled: true, watchNewSessions: true, rejoinSameServer: true, detectDisconnects: true, detectFreezes: true, freezeSec: 120, detectStuck: true, stuckMin: 5, maxPerHour: 6, baseDelaySec: 10, maxDelaySec: 600 },
    limiter: { enabled: true, backgroundPriority: 'below', focusedPriority: 'normal', limitCores: true, backgroundCores: 2, muteBackground: true },
    schedule: { quietHours: { enabled: true, start: '02:00', end: '07:00' } },
    mini: { alwaysOnTop: true, openOnStart: false, compact: false },
    remote: { allowedUserIds: ['123456789012345678'], guildId: '', private: true, autoConnect: true, alertClosed: true },
    launch: { smart: true, cpuSettle: 70, maxWaitSec: 45, batchSize: 4, batchWaitSec: 240, hopIfJoinFails: true },
    richPresence: { enabled: true, showCount: true, showGame: true, details: '', state: '' },
    report: { enabled: true, time: '21:00' },
    resume: { enabled: true, auto: false, maxAgeHours: 24 },
    follow: { enabled: true, mainAccountId: 'a1', followerIds: ['a2', 'a4'], launchIfOffline: true, checkSec: 30 },
    autoBackup: { enabled: true, folder: 'C:\\Users\\You\\OneDrive\\MultiMenu Backups', time: '03:00', keep: 7 },
    memGuard: { enabled: true, maxMB: 3000, leakMBPerHour: 400, minUptimeMin: 45, avoidFocused: true, watchedOnly: false },
    health: { autoCheck: true, intervalHours: 6 },
    firstRunDone: true,
    language: window.__MM_LANG || 'en',
  };
  // 2.0 screenshots add settings and handlers (demo-data.js).
  const deep = (a, b) => { for (const [k, v] of Object.entries(b || {})) { if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object') deep(a[k], v); else a[k] = v; } return a; };
  deep(settings, window.__MM_SETTINGS_PATCH);
  const accounts = [
    { id: 'a1', userId: 1, username: 'NeonFalcon2291', displayName: 'Neon', alias: 'Main', group: 'Main', favourite: true, status: 'valid', avatarUrl: '', defaultPlace: '920587237', hasPassword: true, createdAt: now - 9e8, lastUsedAt: now - 3600e3, robux: 12450, premium: true, friendCount: 87, detailsAt: now, color: 'violet', inbox: { trades: 2, messages: 1, friends: 0 } },
    { id: 'a2', userId: 2, username: 'VioletRaven_77', displayName: 'Violet', alias: '', group: 'Alts', favourite: false, status: 'valid', avatarUrl: '', defaultPlace: '', hasPassword: false, createdAt: now - 5e8, lastUsedAt: now - 86400e3, color: 'cyan', launchGraphics: { quality: 1, fpsCap: 30 } },
    { id: 'a3', userId: 3, username: 'CosmicOtter812', displayName: 'Otter', alias: 'Farm 1', group: 'Alts', favourite: false, status: 'expired', statusMessage: "This account's login has expired. Log in again.", avatarUrl: '', defaultPlace: '', hasPassword: true, createdAt: now - 4e8, lastUsedAt: null },
    { id: 'a4', userId: 4, username: 'LunarPixel4410', displayName: 'Lunar', alias: 'Farm 2', group: 'Alts', favourite: true, status: 'valid', avatarUrl: '', defaultPlace: '', hasPassword: false, createdAt: now - 2e8, lastUsedAt: now - 600e3, health: { state: 'moderated', detail: 'Ban 1 Day' } },
  ];
  const sessions = [
    { id: 's1', accountId: 'a1', label: 'Main', username: 'NeonFalcon2291', pid: 14220, placeId: '920587237', placeName: 'Adopt Me!', status: 'running', startedAt: now - 2400e3, memMB: 1240, cpu: 12.4, watch: true, watchState: 'in game', jobId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', hasLog: true, ping: 48, color: 'violet' },
    { id: 's2', accountId: 'a4', label: 'Farm 2', username: 'LunarPixel4410', pid: 15872, placeId: '920587237', placeName: 'Adopt Me!', status: 'running', startedAt: now - 900e3, memMB: 980, cpu: 8.1, watch: true, watchState: 'not responding', jobId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', hasLog: true, ping: 312 },
    { id: 's5', accountId: 'a2', label: 'Violet', username: 'VioletRaven_77', pid: 16004, placeId: '920587237', placeName: 'Adopt Me!', status: 'running', startedAt: now - 600e3, memMB: 1010, cpu: 9.2, watch: false, hasLog: true, ping: 140, color: 'cyan' },
    { id: 's6', label: 'Roblox (opened outside MultiMenu)', external: true, pid: 17220, status: 'running', startedAt: now - 300e3, memMB: 870, cpu: 6.3 },
    { id: 's3', accountId: 'a2', label: 'VioletRaven_77', username: 'VioletRaven_77', pid: null, placeId: '2753915549', status: 'launching', startedAt: now - 5e3 },
    { id: 's4', accountId: 'a3', label: 'Farm 1', username: 'CosmicOtter812', pid: null, status: 'failed', error: "This account's login has expired. Log in again.", startedAt: now - 60e3 },
  ];
  const hist = Array.from({ length: 150 }, (_, i) => ({ t: now - (150 - i) * 2000, cpu: 25 + 15 * Math.sin(i / 9) + Math.random() * 8, ram: 62 + 6 * Math.sin(i / 25) + Math.random() * 2, gpu: 40 + 20 * Math.sin(i / 14) + Math.random() * 6, roblox: 2000 + 200 * Math.sin(i / 20) }));
  const sample = { t: now, cpu: 31.4, ramPercent: 64.2, ramUsed: 10.3e9, ramTotal: 16e9, gpu: 47, gpuStatus: 'ok', roblox: { count: 2, memMB: 2220, cpu: 20.5 }, appMemMB: 168 };
  const macros = [
    { id: 'm1', name: 'Pet farm loop', createdAt: now - 3e8, lastUsedAt: now - 7200e3, durationMs: 42000, eventCount: 812 },
    { id: 'm2', name: 'Daily rewards', createdAt: now - 6e8, lastUsedAt: now - 86400e3 * 2, durationMs: 9500, eventCount: 120 },
  ];
  const macroEvents = [];
  for (let t = 0; t < 42000; t += 120) { macroEvents.push({ t, type: 'move', x: 600 + (t % 300), y: 400 }); if (t % 2400 === 0) macroEvents.push({ t: t + 30, type: 'kdown', vk: 87 }, { t: t + 200, type: 'kup', vk: 87 }); if (t % 3600 === 0) macroEvents.push({ t: t + 60, type: 'mdown', button: 'left', x: 640, y: 410 }, { t: t + 110, type: 'mup', button: 'left', x: 640, y: 410 }); }
  const notes = [
    { id: 1, at: now - 60e3, read: false, level: 'error', title: 'Launch failed', message: "Farm 1: This account's login has expired. Log in again." },
    { id: 2, at: now - 900e3, read: false, level: 'success', title: 'Session running', message: 'Farm 2' },
    { id: 3, at: now - 2400e3, read: true, level: 'success', title: 'Session running', message: 'Main' },
    { id: 4, at: now - 3000e3, read: true, level: 'warn', title: 'High resource usage', message: 'RAM at 91% for 30s' },
  ];
  const trimmer = { running: true, runs: 14, watchTrims: 9, totalFreedMB: 5320, lastFreedMB: 412, lastRun: now - 40e3, nextRun: now + 20e3, lastError: null, available: true, lastResults: [{ pid: 14220, name: 'RobloxPlayerBeta.exe', ok: true, beforeMB: 1450, afterMB: 1210, freedMB: 240 }, { pid: 15872, name: 'RobloxPlayerBeta.exe', ok: true, beforeMB: 1150, afterMB: 978, freedMB: 172 }], config: settings.ramTrimmer };
  const update = { status: 'available', message: 'MultiMenu v2.0.0 is ready!', current: '1.0.0', kind: 'installer', repo: 'multimenu-dev/MultiMenu', channel: 'stable', checkedAt: now - 30e3, history: [], latest: { version: '2.0.0', name: 'v2.0.0', notes: '## New\n- Account tabs redesign\n- Faster OpenMulti launches\n\n## Fixed\n- Trimmer skipped elevated processes', url: 'https://github.com/x/y/releases/tag/v2.0.0' } };
  const tilePreview = () => {
    const live = sessions.filter(s => s.status === 'running');
    const W = 2560, Hh = 1440, wa = { x: 0, y: 0, width: 2560, height: 1392 }, gap = settings.tiling.gap;
    const tiny = settings.tiling.layout === 'tiny';
    const n = live.length, cols = tiny ? 10 : 2, rows = Math.ceil(n / cols);
    const cw = tiny ? (settings.perf?.tinyW || 240) + 2 : (wa.width - gap * (cols - 1)) / cols, ch = tiny ? (settings.perf?.tinyH || 180) + 32 : (wa.height - gap * (rows - 1)) / rows;
    return {
      display: { id: '1', width: W, height: Hh, workArea: wa },
      displays: [{ id: '1', label: 'Monitor 1 (main) — 2560×1440' }, { id: '2', label: 'Monitor 2 — 1920×1080' }],
      layouts: { auto: 'Smart grid', columns: 'Side by side', rows: 'Stacked', grid2: '2 × 2', grid3: '3 × 3', grid4: '4 × 4', main: 'Main + side', cascade: 'Cascade', fixed: 'Fixed size', tiny: 'Tiny windows' , 'custom:c1': 'Two big + six'},
      cells: live.map((s, i) => ({ x: (i % cols) * (cw + gap) / W, y: Math.floor(i / cols) * (ch + gap) / Hh, w: cw / W, h: ch / Hh, sessionId: s.id, label: s.label, avatarUrl: '', placeholder: false })),
      windows: live.map((s, i) => ({ id: s.id, label: s.label, pid: s.pid, external: !!s.external, topmost: i === 0, tiny: tiny || i === 2 })),
      tinySize: { w: settings.perf?.tinyW || 240, h: settings.perf?.tinyH || 180 },
      savedCount: 4, autoTile: settings.tiling.autoTile, focus: { on: !!window.__MM_FOCUS, sessionId: 's1', label: 'Main' },
    };
  };
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(now - (6 - i) * 864e5); return { day: d.toISOString().slice(0, 10), uptimeMs: (8 + i * 2.2) * 36e5, launches: 3 + i, crashes: i % 3, disconnects: (i * 2) % 5, freezes: i % 2, rejoins: (i % 3) + ((i * 2) % 5) }; });
  const H = {
    'watcher:status': { enabled: true, quiet: false, available: true, config: settings.watcher, watched: 2, pending: [{ id: 'p1', accountId: 'a4', label: 'Farm 2', at: now + 38e3, reason: 'Not responding for 120s', sameServer: true }], streaks: {} },
    'remote:status': { status: 'online', message: 'Online as MultiMenu Bot. Use /mm in your server.', hasToken: true, botName: 'MultiMenu Bot', appId: '1', inviteUrl: 'https://discord.com/x', lastCommand: { at: now - 300e3, user: 'you', command: 'status' }, config: settings.remote },
    'report:status': { lastSentDay: '2026-11-10', config: settings.report },
    'health:summary': { total: 4, ok: 2, expired: 1, banned: 0, moderated: 1, unchecked: 0, running: false, lastRun: now - 3600e3, config: settings.health },
    'app:firstRunDone': true,
    'resume:status': () => ({ config: settings.resume, pending: window.__showResume ? { savedAt: now - 1800e3, robloxRunning: 0, sessions: [{ accountId: 'a1', label: 'Main', watch: true, placeName: 'Adopt Me!', target: { placeId: '920587237', jobId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } }, { accountId: 'a4', label: 'Farm 2', watch: true, placeName: 'Adopt Me!', target: { placeId: '920587237', jobId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } }, { accountId: 'a2', label: 'Violet', watch: false, placeName: 'Pet Simulator 99', target: { placeId: '8737899170' } }] } : null }),
    'follow:status': { config: settings.follow, loc: { placeId: '920587237', jobId: 'x', placeName: 'Adopt Me!', source: 'this PC' }, message: 'Main is in Adopt Me! (seen via this PC).', moving: false, lastMove: { at: now - 600e3, account: 'Farm 2', to: 'Adopt Me!' }, followers: { a2: { action: 'move', why: 'In a different server' }, a4: { action: 'none', why: 'With main' } } },
    'autobackup:status': { hasPassword: true, lastRun: now - 36e6, lastFile: 'MultiMenu-auto-2026-11-11.mmvault', lastError: null, files: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], config: settings.autoBackup },
    'stats:overview': (() => {
      const heat = Array.from({ length: 182 }, (_, i) => { const d = new Date(now - (181 - i) * 864e5); const v = i < 60 ? 0 : Math.max(0, Math.round((Math.sin(i / 5) + 1) * 6 + (i % 7 === 0 ? -6 : 2) + i / 25)); return { day: d.toISOString().slice(0, 10), hours: v }; });
      const w = (m, hrs) => ({ month: m, hours: hrs, launches: 142, rejoins: 61, problems: 74, memRestarts: 9, activeDays: 11, topAccount: { label: 'Main', hours: 96.4 }, topGame: { name: 'Adopt Me!', hours: 188.2 }, bestDay: { day: '2026-11-09', hours: 41.5 } });
      return { totals: { hours: 1284.6, activeDays: 118, rejoins: 402, problems: 455, launches: 1210, since: '2026-05-14' }, streak: { current: 23, longest: 41 }, heat,
        accounts: [{ label: 'Main', uptimeMs: 412 * 36e5, activeDays: 110, launches: 240, rejoins: 21, perDay: 0.12, problems: 2 }, { label: 'Farm 2', uptimeMs: 388 * 36e5, activeDays: 102, launches: 410, rejoins: 210, perDay: 2.3, problems: 37 }, { label: 'Violet', uptimeMs: 301 * 36e5, activeDays: 90, launches: 300, rejoins: 120, perDay: 1.1, problems: 14 }, { label: 'Farm 1', uptimeMs: 183 * 36e5, activeDays: 70, launches: 260, rejoins: 51, perDay: 4.2, problems: 32 }],
        mostStable: { label: 'Main', uptimeMs: 412 * 36e5, perDay: 0.12, problems: 2 }, topGames: [{ name: 'Adopt Me!', hours: 702.1 }, { name: 'Pet Simulator 99', hours: 340.6 }, { name: 'Blox Fruits', hours: 160.2 }, { name: 'Bee Swarm Simulator', hours: 81.7 }],
        wrapped: w('2026-11', 214.7), lastMonth: w('2026-10', 388.1) };
    })(),
    'memguard:status': { config: settings.memGuard, recent: [{ at: now - 5400e3, label: 'Farm 1', reason: 'Memory leak: growing 520 MB/hour (now 2890 MB)' }], clients: [
      { id: 's1', label: 'Main', mb: 1240, slope: 35, samples: 60, uptimeMs: 2400e3, flagged: null, spark: Array.from({ length: 60 }, (_, i) => 1180 + i + Math.random() * 20) },
      { id: 's2', label: 'Farm 2', mb: 2610, slope: 480, samples: 60, uptimeMs: 9000e3, flagged: 'Memory leak: growing 480 MB/hour (now 2610 MB)', spark: Array.from({ length: 60 }, (_, i) => 2130 + i * 8 + Math.random() * 30) },
      { id: 's5', label: 'Violet', mb: 1010, slope: 0, samples: 9, uptimeMs: 600e3, flagged: null, spark: Array.from({ length: 9 }, () => 1000 + Math.random() * 20) }] },
    'errors:all': [{ code: 264, title: 'Logged in somewhere else', meaning: 'The same account joined a game from another device.', action: 'stop', actionText: 'Not rejoining', hint: 'Make sure this account isn\'t running in two places.' }, { code: 267, title: 'Kicked by the game', meaning: 'The game\'s own scripts removed you.', action: 'slow', actionText: 'Rejoining after a longer wait', hint: 'Repeated 267s often mean the game doesn\'t allow AFK.' }, { code: 274, title: 'Server shut down by the developer', meaning: 'The game\'s developer closed this server.', action: 'newServer', actionText: 'Joining a different server' }, { code: 277, title: 'Lost connection to the game server', meaning: 'The most common disconnect.', action: 'rejoin', actionText: 'Rejoining' }],
    'outfits:list': [{ id: 1, name: 'Farm fit', imageUrl: '' }, { id: 2, name: 'Neon drip', imageUrl: '' }, { id: 3, name: 'Default', imageUrl: '' }, { id: 4, name: 'Winter', imageUrl: '' }],
    'watcher:enable': (on) => ({ enabled: on, quiet: false, available: true, config: settings.watcher, watched: 2, pending: [], streaks: {} }),
    'watcher:stats': { days, accounts: { a1: { label: 'Main', uptimeMs: 96 * 36e5, launches: 9, crashes: 0, disconnects: 0, freezes: 0, rejoins: 0 }, a4: { label: 'Farm 2', uptimeMs: 71 * 36e5, launches: 22, crashes: 3, disconnects: 9, freezes: 2, rejoins: 14 }, a3: { label: 'Farm 1', uptimeMs: 40 * 36e5, launches: 6, crashes: 1, disconnects: 1, freezes: 0, rejoins: 2 } } },
    'watcher:events': [
      { at: now - 20e3, type: 'freeze', account: 'Farm 2', detail: 'Not responding for 120s', shot: 'x.png' }, { at: now - 19e3, type: 'scheduled', account: 'Farm 2', detail: 'Rejoin in 40s' },
      { at: now - 3600e3, type: 'disconnect', account: 'Farm 2', detail: 'Error 267 — Kicked by the game. The game\'s own scripts removed you.', action: 'Rejoining after a longer wait', hint: 'Repeated 267s often mean the game doesn\'t allow AFK or automation.' }, { at: now - 3500e3, type: 'memory', account: 'Farm 1', detail: 'Memory leak: growing 520 MB/hour (now 2890 MB) — restarted into the same server.' }, { at: now - 3590e3, type: 'rejoin', account: 'Farm 2', detail: 'Rejoining the same server' },
      { at: now - 7200e3, type: 'crash', account: 'Farm 1', detail: 'Client exited unexpectedly' }, { at: now - 9e6, type: 'gaveup', account: 'Old alt', detail: 'Login expired — log in again to resume.' },
    ],
    'presets:list': [
      { id: 'pr1', name: 'Farm squad', accountIds: ['a1', 'a2', 'a4'], game: 'https://www.roblox.com/games/920587237', mode: 'sameServer', layout: 'grid2', tile: true, watch: true, limiter: true, antiAfk: true, graphics: { enabled: true, quality: 1, fpsCap: 30 }, closeAfterHours: 12, lastRunAt: now - 5e6 },
      { id: 'pr2', name: 'Main only', accountIds: ['a1'], game: '', mode: 'default', layout: '', tile: false, watch: true, limiter: false, antiAfk: false, graphics: { enabled: false, quality: 1, fpsCap: 60 }, closeAfterHours: 0, lastRunAt: null },
    ],
    'schedule:list': { quiet: false, actions: { launchPreset: 'Start preset', closePreset: 'Close preset', closeAll: 'Close all Roblox', restartAll: 'Restart all clients', trimRam: 'Trim RAM' }, tasks: [
      { id: 't1', name: 'Morning farm', action: 'launchPreset', presetId: 'pr1', kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5], enabled: true, nextRunAt: now + 7e7, lastRunAt: now - 1.6e7, lastResult: 'Preset started' },
      { id: 't2', name: 'Fresh memory', action: 'restartAll', kind: 'every', everyHours: 6, enabled: true, nextRunAt: now + 9e6, lastRunAt: now - 1.2e7, lastResult: '3 restarted' },
    ] },
    'servers:games': [{ id: 'g1', name: 'Adopt Me!', link: 'https://www.roblox.com/games/920587237', placeId: '920587237', private: false }, { id: 'g2', name: 'Squad private server', link: 'https://www.roblox.com/games/2753915549/x?privateServerLinkCode=abc', placeId: '2753915549', private: true }],
    'servers:browse': { placeId: '920587237', placeName: 'Adopt Me!', nextCursor: 'c2', servers: [2, 5, 9, 14, 21, 33, 40, 47].map((p, i) => ({ id: `${i}aaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`, playing: p, maxPlayers: 48, ping: 40 + i * 9, fps: 60 - (i % 3) })) },
    'servers:friends': [{ id: 9, name: 'BestBuddy', displayName: 'Buddy', state: 'ingame', location: 'Adopt Me!', avatarUrl: '' }, { id: 10, name: 'CoolKid', displayName: 'Cool', state: 'online', location: 'Website', avatarUrl: '' }, { id: 11, name: 'SleepyCat', displayName: '', state: 'offline', location: '', avatarUrl: '' }],
    'limiter:status': { running: true, available: true, focusedPid: 14220, lastError: null, cores: 12, config: settings.limiter, audio: { state: 'ok' }, clients: [{ pid: 14220, priority: 'normal', mask: 4095, mute: false, muted: false }, { pid: 15872, priority: 'below', mask: 3072, mute: true, muted: true }, { pid: 16004, priority: 'below', mask: 3072, mute: true, muted: true }] },
    'sessions:log': { file: '0.650.0.123_20261111T100000Z_Player_ABCDE_last.log', lines: ["2026-11-11T10:00:00Z [FLog::Output] ! Joining game 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' place 920587237 at 10.0.0.1", '2026-11-11T10:00:02Z [FLog::Network] serverId: 10.0.0.1|1234', '2026-11-11T11:30:00Z [FLog::Network] Time to disconnect replication data: 0.01'] },
    'tiler:preview': () => tilePreview(), 'tiler:tiny': (id, on) => ({ tiny: !!on }), 'tiler:swap': () => tilePreview(), 'tiler:order': () => tilePreview(),
    'tiler:tile': { placed: 4, total: 4, missing: [] },
    'app:info': { version: '3.1.1', portable: false, dataDir: 'C:\\Users\\You\\AppData\\Roaming\\MultiMenu', native: true, secureStorage: true, electron: '45.3.0', updatedFrom: null },
    'settings:get': settings,
    'settings:set': (k, v) => ({ value: v }),
    'notifications:list': notes, 'notifications:read': notes, 'notifications:clear': [],
    'updates:status': { ...update, status: 'current', message: "You're on the latest version (v1.7.0).", latest: null },
    'updates:check': update,
    'accounts:list': { accounts, groups: ['Main', 'Alts'], secureStorage: true },
    'sessions:list': sessions,
    'sessions:openMulti': { active: true, message: 'Active — you can run multiple Roblox clients.', playerPath: 'C:\\Users\\You\\AppData\\Local\\Roblox\\Versions\\version-abc123\\RobloxPlayerBeta.exe' },
    'system:history': hist, 'system:latest': sample,
    'system:processes': [{ pid: 14220, name: 'RobloxPlayerBeta.exe', memMB: 1240, cpu: 12.4 }, { pid: 15872, name: 'RobloxPlayerBeta.exe', memMB: 980, cpu: 8.1 }, { pid: 8812, name: 'chrome.exe', memMB: 640, cpu: 2.2 }, { pid: 1200, name: 'MultiMenu.exe', memMB: 168, cpu: 0.6 }, { pid: 4420, name: 'Discord.exe', memMB: 410, cpu: 0.9 }],
    'system:recommendations': [{ id: 'gfx', level: 'info', text: '2 Roblox clients are open. Setting graphics to Low cuts GPU and RAM use for each one.', action: 'graphicsLow' }, { id: 'cap', level: 'warn', text: 'CPU is at 88%. Capping Roblox at 30–60 FPS reduces CPU load.', action: 'fpsCap60' }],
    'fps:caps': [30, 60, 75, 120, 144, 165, 240, -1],
    'fps:graphics': { available: true, fpsCap: 60, quality: 3, robloxRunning: true },
    'fps:profiles': { balanced: { label: 'Balanced', quality: 0, fpsCap: 60, trimmer: false }, maxfps: { label: 'Max FPS', quality: 1, fpsCap: -1, trimmer: true }, multi: { label: 'Many clients', quality: 1, fpsCap: 30, trimmer: true, lowResource: true }, quality: { label: 'Best quality', quality: 10, fpsCap: 144, trimmer: false } },
    'fps:status': { status: 'ok', message: 'Measuring', path: settings.fps.presentMonPath, fps: { 14220: { fps: 142, low1: 98, frameMs: 7.04 }, 15872: { fps: 60, low1: 52, frameMs: 16.6 } } },
    'trimmer:status': trimmer, 'trimmer:preview': [{ pid: 14220, name: 'RobloxPlayerBeta.exe', memMB: 1210 }, { pid: 15872, name: 'RobloxPlayerBeta.exe', memMB: 978 }],
    'clicker:status': { running: true, clicks: 1532, target: 0, available: true, startedAt: now - 150e3, config: settings.clicker },
    'macros:list': macros, 'macros:status': { available: true, recording: false, playing: false, recordedEvents: 0 },
    'macros:get': { id: 'm1', name: 'Pet farm loop', durationMs: 42000, events: macroEvents, totalEvents: macroEvents.length },
    'antiafk:status': { running: true, nextAt: now + 600e3, lastAt: now - 300e3, lastCount: 2, actions: 7, available: true, config: settings.antiAfk },
    'discord:list': [{ id: 'w1', name: 'Alerts', enabled: true, masked: '…/webhooks/1234567890123456789/••••••' }],
    'discord:events': { accountLaunched: 'Account launched', accountClosed: 'Account closed', accountCrashed: 'Session ended unexpectedly', launchFailed: 'Launch failed', sessionError: 'Session error', appStarted: 'MultiMenu started', appClosed: 'MultiMenu closed', highUsage: 'High resource usage', trimmer: 'RAM Trimmer', appError: 'Application error', updates: 'Update available' },
    'discord:history': [{ at: now - 900e3, type: 'accountLaunched', title: 'Account launched', account: 'Farm 2', ok: true, results: [] }, { at: now - 60e3, type: 'launchFailed', title: 'Launch failed', account: 'Farm 1', ok: false, results: [{ hook: 'Alerts', ok: false, error: 'Discord returned HTTP 404' }] }],
    'logcleaner:status': { lastRun: now - 1800e3, lastDeleted: 14, lastFreedMB: 61, files: 23, totalMB: 38, config: settings.robloxLogs },
    'logcleaner:run': { lastRun: now, lastDeleted: 3, lastFreedMB: 9, files: 20, totalMB: 29 },
    'sessions:panic': 3,
    'guards:status': { keepingAwake: true, online: true, offlineSince: null, lastCheck: now - 10e3, roblox: { indicator: 'none', description: 'All Systems Operational' }, blocked: null, popupsClosed: 3, lastPopupAt: now - 7200e3, games: [{ placeId: '920587237', name: 'Adopt Me!', updated: now - 9e6 }], config: settings.guards },
    'inbox:status': { running: false, lastRun: now - 120e3, config: settings.inbox },
    'sleeptimer:status': { endsAt: now + 47 * 60e3, action: 'close', actionText: 'Close all Roblox', actions: { close: 'Close all Roblox', sleep: 'Close all, then sleep the PC', shutdown: 'Close all, then shut down the PC' }, last: settings.sleepTimer },
    'app:metrics': { totalMB: 212, rendererMB: 96, processes: 5, deepIdleMin: 10 },
    'capacity:status': { limits: { ram: 85, cpu: 90, gpu: 95 }, estimate: { possible: 9, current: 3, limitedBy: 'RAM', perClient: { memMB: 1077, cpu: 9.9, gpu: 15.7 }, byRam: 9, byCpu: 11, byGpu: 10 },
      test: { running: false, message: 'Done.', result: { maxClients: 7, limitedBy: 'RAM', reachedAt: 8 }, steps: [{ clients: 0, ram: 41, cpu: 9, gpu: 6 }, { clients: 1, ram: 48, cpu: 19, gpu: 18 }, { clients: 2, ram: 54, cpu: 28, gpu: 30 }, { clients: 3, ram: 60, cpu: 37, gpu: 41 }, { clients: 4, ram: 66, cpu: 45, gpu: 52 }, { clients: 5, ram: 71, cpu: 55, gpu: 63 }, { clients: 6, ram: 77, cpu: 63, gpu: 72 }, { clients: 7, ram: 82, cpu: 71, gpu: 81 }, { clients: 8, ram: 87, cpu: 78, gpu: 89 }] } },
    'theme:presets': { midnight: { label: 'Midnight', accentHue: 270, secondaryHue: 295, bgType: 'gradient' }, amethyst: { label: 'Amethyst', accentHue: 285, secondaryHue: 325, bgType: 'gradient' }, neon: { label: 'Neon', accentHue: 300, secondaryHue: 190, bgType: 'gradient' }, ember: { label: 'Ember', accentHue: 345, secondaryHue: 25, bgType: 'gradient' }, ocean: { label: 'Ocean', accentHue: 220, secondaryHue: 180, bgType: 'gradient' }, minimal: { label: 'Minimal', accentHue: 265, secondaryHue: 265, bgType: 'solid' } },
    'theme:background': null,
    'app:languages': { current: window.__MM_LANG || '', suggested: 'en', list: [{ id: 'en', name: 'English', english: 'English' }, { id: 'es', name: 'Español', english: 'Spanish' }, { id: 'de', name: 'Deutsch', english: 'German' }, { id: 'fr', name: 'Français', english: 'French' }, { id: 'pt', name: 'Português (Brasil)', english: 'Portuguese' }, { id: 'nb', name: 'Norsk', english: 'Norwegian' }, { id: 'it', name: 'Italiano', english: 'Italian' }, { id: 'pl', name: 'Polski', english: 'Polish' }, { id: 'tr', name: 'Türkçe', english: 'Turkish' }, { id: 'ru', name: 'Русский', english: 'Russian' }, { id: 'id', name: 'Bahasa Indonesia', english: 'Indonesian' }, { id: 'vi', name: 'Tiếng Việt', english: 'Vietnamese' }, { id: 'fil', name: 'Filipino', english: 'Filipino' }] },
    'app:setLanguage': (id) => id,
    'app:miniCompact': (on) => on,
    'launchers:detect': { roblox: { installed: true, version: 'version-48a28da848b7420d' }, bloxstrap: { installed: true }, fishstrap: { installed: false }, handler: 'bloxstrap' },
    'capacity:quick': { ramGB: 16, cores: 12, rough: 9, live: { possible: null } },
    'accounts:pending': [{ id: 'p1', username: 'StarlightKoi_09', alias: 'Farm 3', group: 'Alts', source: 'ram' }, { id: 'p2', username: 'MossyBeacon', alias: '', group: '', source: 'ram' }],
    'accounts:ramList': { added: 2, skipped: 0, found: 2, bad: 0, ignoredSecrets: true, pending: [] },
    'accounts:pendingRemove': [], 'accounts:pendingLogin': null,
    'app:mode': { safeMode: window.__MM_SAFE || null, diet: !!window.__MM_DIET, dietSetting: !!window.__MM_DIET },
    'phone:status': { enabled: true, running: true, port: 43821, hasPin: true, allowControl: true, urls: ['http://192.168.1.42:43821'], networks: ['Wi-Fi'], error: null, signedIn: [{ ip: '192.168.1.57', at: now - 600e3, agent: 'iPhone' }], qr: window.__MM_QR || '' },
    'layouts:status': { enabled: true, current: 'a', currentName: '2 monitors · 2560×1440 + 1920×1080', saved: [{ sig: 'a', name: '2 monitors · 2560×1440 + 1920×1080', layout: 'grid2', savedAt: now - 86400e3, current: true }, { sig: 'b', name: '1 monitor · 1920×1080', layout: 'auto', savedAt: now - 5 * 86400e3, current: false }] },
    'pip:status': { open: true, target: 's2', label: 'Farm 2' },
    'pip:open': { target: 's2', label: 'Farm 2', fps: 15, sessions: [] },
    'tiler:focusMode': (on) => ({ on, sessionId: 's1', label: 'Main', placed: 4 }),
    'logincheck:status': { config: settings.loginCheck, last: null, expired: [] },
    'accounts:bulkUpdate': (ids) => ({ changed: ids.length }),
    'creator:username': 'NovaLynx4821', 'creator:password': 'k7#Rq9-mVt2!xPe4Wz',
  };
  // 3.1
  Object.assign(settings, {
    wallet: { rolimons: true }, privateServers: { warn: true, warnDays: 3 }, updateGuard: { enabled: true, maxWaitSec: 240, hold: 'whileOpen' },
    volume: { all: 100, levels: { a4: 40 } }, netmon: { enabled: true, capGB: 500, period: 'month', closeFiller: false },
    freshRestart: { enabled: true, everyHours: 6, gapMin: 10, skipMain: true, avoidFocused: true }, checklist: { hidden: false, done: ['launch', 'tile'] },
  });
  const sec = (two, email, phone, pin, score, grade, issues) => ({ twoStep: two, email, phone, pin, score, grade, issues: issues.map(t => ({ text: t })), at: now - 3600e3 });
  const itemsDemo = {
    rows: [
      { accountId: 'a1', label: 'Main', username: 'NeonFalcon2291', avatarUrl: '', tier: 'main', security: sec(true, 'verified', 'verified', true, 100, 'good', []), wallet: { robux: 12450, pending: 820, premium: true, at: now - 3600e3 }, items: { count: 37, rap: 184200, value: 231500, top: [{ assetId: '1', name: 'Sparkle Time Fedora', value: 98000, rap: 71000 }, { assetId: '2', name: 'Valkyrie Helm', value: 54000, rap: 48000 }, { assetId: '3', name: 'Clockwork Shades', value: 21000, rap: 19800 }], at: now - 3600e3 } },
      { accountId: 'a2', label: 'Violet', username: 'VioletRaven_77', avatarUrl: '', tier: 'important', security: sec(false, 'verified', 'none', false, 45, 'weak', ['2-step verification is off', 'No phone number', 'No account PIN']), wallet: { robux: 310, pending: 0, premium: false, at: now - 3600e3 }, items: { count: 2, rap: 3100, value: 3100, top: [{ assetId: '4', name: 'Bighead', value: 2600, rap: 2600 }], at: now - 3600e3 } },
      { accountId: 'a4', label: 'Farm 2', username: 'LunarPixel4410', avatarUrl: '', tier: 'filler', security: sec(true, 'unverified', 'none', false, 60, 'fair', ['Email not verified', 'No phone number', 'No account PIN']), wallet: { robux: 0, pending: 45, premium: false, at: now - 3600e3 }, items: { hidden: true, count: 0, rap: 0, value: 0, top: [], at: now - 3600e3 } },
      { accountId: 'a3', label: 'Farm 1', username: 'CosmicOtter812', avatarUrl: '', tier: 'filler', expired: true, security: null, wallet: null, items: null },
    ],
    totals: { wallet: { robux: 12760, pending: 865, incoming: 0, premium: 1, counted: 3 }, items: { count: 39, rap: 187300, value: 234600 }, security: { weak: 1, checked: 3 } },
    passes: { placeId: '920587237', name: 'Adopt Me!', at: now - 600e3, passes: [{ id: 'p1', name: 'Royal Neon Pass' }, { id: 'p2', name: 'Lucky Egg' }, { id: 'p3', name: 'VIP' }], badges: [{ id: 'b1', name: 'Welcome' }, { id: 'b2', name: 'Pet Master' }],
      rows: [{ label: 'Main', passes: { p1: true, p2: true, p3: false }, badges: { b1: true, b2: true } }, { label: 'Violet', passes: { p1: false, p2: true, p3: false }, badges: { b1: true, b2: false } }, { label: 'Farm 2', passes: { p1: false, p2: false, p3: false }, badges: { b1: true, b2: false } }] },
    config: { rolimons: true },
  };
  const psDemo = { checkedAt: now - 7200e3, expiring: ['ps2'], config: { warn: true, warnDays: 3 }, servers: [
    { id: 'ps1', name: 'Grind server', game: 'Adopt Me!', placeId: '920587237', active: true, willRenew: true, expiresAt: now + 21 * 86400e3, ownerLabel: 'Main' },
    { id: 'ps2', name: 'Trading spot', game: 'Pet Simulator 99', placeId: '8737899170', active: true, willRenew: false, expiresAt: now + 2 * 86400e3, ownerLabel: 'Violet' },
    { id: 'ps3', name: 'Old hangout', game: 'Blox Fruits', placeId: '2753915549', active: false, willRenew: false, expiresAt: null, ownerLabel: 'Main' }] };
  const netHist = Array.from({ length: 90 }, (_, i) => ({ t: now - (90 - i) * 5e3, down: 380e3 + Math.sin(i / 6) * 160e3 + (i % 7) * 20e3, up: 90e3 + Math.cos(i / 5) * 30e3 }));
  const logFiles = [
    { name: '0.650.0.123_20261115T201500Z_Player_A1B2C_last.log', size: 3.2e6, modified: now - 60e3, account: 'Main', accountId: 'a1', claimed: true },
    { name: '0.650.0.123_20261115T201800Z_Player_D3E4F_last.log', size: 2.1e6, modified: now - 120e3, account: 'Farm 2', accountId: 'a4', claimed: true },
    { name: '0.650.0.123_20261115T094000Z_Player_G5H6I_last.log', size: 5.4e6, modified: now - 9 * 3600e3, account: 'Violet', accountId: 'a2', claimed: false },
  ];
  const logLines = [
    { text: "2026-11-15T20:15:03Z [FLog::Output] ! Joining game 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' place 920587237 at 10.0.0.1", kind: 'join' },
    { text: '2026-11-15T22:41:10Z [FLog::Network] Sending disconnect with reason: 277', kind: 'disconnect', why: { code: 277, title: 'Lost connection to the game server', meaning: 'The most common disconnect: a network hiccup or a server problem.' } },
    { text: '2026-11-15T22:41:40Z [FLog::Output] ! Joining game \'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\' place 920587237 at 10.0.0.1', kind: 'join' },
  ];
  Object.assign(H, {
    'items:status': itemsDemo, 'items:security': itemsDemo, 'items:wallets': itemsDemo, 'items:limiteds': itemsDemo, 'items:game': itemsDemo.passes,
    'privservers:status': psDemo, 'privservers:refresh': { ...psDemo, errors: [] }, 'privservers:launch': { queued: 2, name: 'Grind server' }, 'privservers:save': [],
    'smartjoin:join': { servers: 2, queued: 4, skipped: 0, plan: [] },
    'updateguard:check': { latest: 'version-5b1e0c7d93a24f61', installed: ['version-48a28da848b7420d'], upToDate: false, holding: true, state: { phase: 'idle' }, config: settings.updateGuard },
    'updateguard:updateNow': { latest: 'version-5b1e0c7d93a24f61', installed: ['version-48a28da848b7420d'], upToDate: false, updatingNow: true, state: { phase: 'idle' }, config: settings.updateGuard },
    'lean:trimSelf': { freedMB: 61 },
    'presence:status': { enabled: true, connected: true, user: 'VoidFlare', error: null, preview: { details: 'Running 4 alts', state: 'In Pet Simulator 99', timestamps: { start: Math.floor(Date.now() / 1000) - 5400 }, buttons: [{ label: 'Get MultiMenu', url: '' }] } },
    'theme:weList': [{ id: '0', title: 'Neon city rain', sizeMB: 18, fits: true, preview: null }, { id: '1', title: 'Purple nebula loop', sizeMB: 24, fits: true, preview: null }, { id: '2', title: 'Mountain lake 4K', sizeMB: 142, fits: false, preview: null }],
    'volume:view': { all: 100, available: true, rows: [{ sessionId: 's1', accountId: 'a1', label: 'Main', avatarUrl: '', level: 100, own: false }, { sessionId: 's2', accountId: 'a4', label: 'Farm 2', avatarUrl: '', level: 40, own: true }, { sessionId: 's5', accountId: 'a2', label: 'Violet', avatarUrl: '', level: 100, own: false }] },
    'netmon:view': { available: true, error: null, rate: { down: 512e3, up: 96e3, at: now }, history: netHist, today: { down: 3.1e9, up: 0.6e9 }, month: { down: 148e9, up: 22e9 }, alts: 3, perAltHour: 7.3e8, cap: { gb: 500, period: 'month', used: 170e9, pct: 31.7 }, last7: [], config: settings.netmon },
    'freshrestart:status': { config: settings.freshRestart, lastAt: now - 3 * 3600e3, recent: [{ at: now - 3 * 3600e3, label: 'Farm 1', auto: true }], next: [{ id: 's5', label: 'Violet', dueAt: now + 5.8 * 3600e3 }, { id: 's2', label: 'Farm 2', dueAt: now + 5.7 * 3600e3 }] },
    'logs:files': { dir: 'C:\\Users\\You\\AppData\\Local\\Roblox\\logs', files: logFiles },
    'logs:summary': [{ code: 277, title: 'Lost connection to the game server', count: 9, accounts: ['Farm 2', 'Violet'] }, { code: 267, title: 'Kicked by the game', count: 3, accounts: ['Farm 2'] }, { code: null, title: 'Disconnected (no code)', count: 2, accounts: ['Main'] }],
    'logs:search': { hits: logLines.map(l => ({ ...l, file: logFiles[1].name, account: 'Farm 2' })), counts: { disconnect: 14, error: 3, join: 40, teleport: 6 }, files: 3, more: false },
    'logs:read': { name: logFiles[0].name, account: 'Main', total: 3, lines: logLines },
    'checklist:status': { steps: [
      { id: 'account', title: 'Add your first account', page: 'accounts', done: true }, { id: 'launch', title: 'Launch an alt', page: 'sessions', done: true },
      { id: 'tile', title: 'Tile your windows', page: 'sessions', done: true }, { id: 'perf', title: 'Pick an alt performance preset', page: 'perf', done: false },
      { id: 'watcher', title: 'Turn on the 24/7 Watcher', page: 'watcher', done: true }, { id: 'alerts', title: 'Get alerts on Discord or your phone', page: 'discord', done: true },
      { id: 'preset', title: 'Save a preset', page: 'presets', done: false }], done: 5, total: 7, complete: false, hidden: false },
    'checklist:hide': { hidden: true, complete: false, steps: [], done: 0, total: 7 },
  });
  if (window.__MM_EXTRA) Object.assign(H, window.__MM_EXTRA({ settings, accounts, sessions, now }));
  return {
    i18n: window.__MM_I18N || { lang: 'en', dict: {} },
    invoke: (ch, ...a) => new Promise((res) => {
      const v = H[ch];
      setTimeout(() => res(typeof v === 'function' ? v(...a) : JSON.parse(JSON.stringify(v ?? null))), 5);
    }),
    on: (ev, cb) => { (listeners[ev] = listeners[ev] || []).push(cb); return () => {}; },
    _emit: (ev, p) => (listeners[ev] || []).forEach(f => f(p)),
  };
})();
if (window.mm) window.__MM_DEMO = api; else window.mm = api;
})();
