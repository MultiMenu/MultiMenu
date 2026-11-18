// Admin-mode answers for the UI screenshot tests (loaded after demo-api.js).
// window.__MM_ADMIN = true starts unlocked; otherwise admin mode is locked.
(function () {
  const base = window.mm;
  const now = Date.now();
  let unlocked = !!window.__MM_ADMIN;
  let demo = false;
  let flags = { inspector: false, outlines: false, slow: false, fps: false, pseudo: false, verbose: false, demoBadge: true, ...(window.__MM_ADMIN_FLAGS || {}) };
  const feedListeners = [];
  let settings = null;
  base.invoke('settings:get').then((s) => { settings = s; });
  const status = () => (unlocked ? { unlocked: true, name: 'voidflare', id: '3f9c2a7b1e04', iat: now - 3 * 86400e3, exp: null, flags, demo, keys: ['7cc8998ac1eeca8d'] } : { unlocked: false });
  const L = (ago, level, scope, msg) => ({ at: now - ago * 1000, level, scope, msg });
  const log = [
    L(600, 'INFO', 'main', 'MultiMenu 2.0.3 starting (installed) data=%USERPROFILE%\\AppData\\Roaming\\MultiMenu'),
    L(598, 'INFO', 'admin', 'Admin mode on (voidflare, code 3f9c2a7b1e04)'),
    L(596, 'INFO', 'main', 'Window shown'),
    L(590, 'INFO', 'phone', 'Phone dashboard on 192.168.1.42:43821'),
    L(560, 'INFO', 'sessions', 'Launched Main into 920587237 (pid 14220)'),
    L(530, 'INFO', 'sessions', 'Launched Farm 2 into 920587237 (pid 15872)'),
    L(500, 'INFO', 'tiler', 'Tiled 2 windows (grid, display 1)'),
    L(420, 'WARN', 'updater', 'Update check failed GitHub returned HTTP 403.'),
    L(300, 'INFO', 'watcher', 'Watching 2 clients'),
    L(240, 'DEBUG', 'admin', 'ipc accounts:list 3.2 ms'),
    L(200, 'ERROR', 'alertapps', 'telegram "Phone" failed: getaddrinfo ENOTFOUND api.telegram.org'),
    L(120, 'INFO', 'trimmer', 'Trimmed 2 processes, freed 412 MB'),
    L(60, 'INFO', 'store', 'Saved accounts.json'),
    L(12, 'WARN', 'guards', 'High ping on Farm 2: 312 ms'),
  ];
  const B = (ago, name, listeners, data) => ({ at: now - ago * 1000, name, listeners, data });
  const bus = [
    B(30, 'system:sample', 3, '{"t":1731489000000,"cpu":31.4,"ramPercent":64.2,"gpu":47,"roblox":{"count":2,"memMB":2220}}'),
    B(25, 'sessions:changed', 2, '[{"id":"s1","label":"Main","status":"running","pid":14220},{"id":"s2","label":"Farm 2","status":"running"…'),
    B(20, 'event', 5, '{"type":"accountLaunched","account":"Farm 2","detail":"Joined Pet Simulator 99"}'),
    B(14, 'notify', 1, '{"level":"info","title":"Trimmed RAM","message":"Freed 412 MB"}'),
    B(8, 'tiled', 1, '{"count":2}'),
    B(4, 'settings:changed', 1, '{"key":"tiling.gap","value":6}'),
  ];
  const I = (ago, channel, ms, ok = true, error) => ({ at: now - ago * 1000, channel, ms, ok, error });
  const ipc = [I(40, 'accounts:list', 3.2), I(38, 'sessions:list', 1.1), I(30, 'system:latest', 0.6), I(22, 'tiler:tile', 186.4), I(15, 'updates:check', 1532.9, false, 'GitHub returned HTTP 403.'), I(6, 'settings:set', 2.4)];
  const stats = [
    { channel: 'system:latest', n: 1204, errors: 0, avg: 0.7, max: 9.1, last: now - 2e3 }, { channel: 'accounts:list', n: 86, errors: 0, avg: 3.1, max: 21.4, last: now - 40e3 },
    { channel: 'sessions:list', n: 77, errors: 0, avg: 1.2, max: 6.3, last: now - 38e3 }, { channel: 'tiler:tile', n: 9, errors: 0, avg: 171.2, max: 412.5, last: now - 22e3 },
    { channel: 'updates:check', n: 2, errors: 1, avg: 1208.1, max: 1532.9, last: now - 15e3 }, { channel: 'settings:set', n: 31, errors: 0, avg: 2.2, max: 7.7, last: now - 6e3 },
  ];
  const N = (ago, method, host, path, status, ms, error) => ({ at: now - ago * 1000, method, host, path, status, ms, error });
  const net = [
    N(580, 'GET', 'users.roblox.com', '/v1/users/authenticated', 200, 182), N(575, 'GET', 'thumbnails.roblox.com', '/v1/users/avatar-headshot', 200, 141),
    N(420, 'GET', 'api.github.com', '/repos/voidflarerblx-coder/MultiMenu/releases', 403, 230), N(200, 'POST', 'api.telegram.org', '/…/sendMessage', 0, 5012, 'ENOTFOUND'),
    N(150, 'POST', 'discord.com', '/api/webhooks/…', 204, 312), N(40, 'GET', 'presence.roblox.com', '/v1/presence/users', 200, 96),
  ];
  const settingsRows = () => {
    const rows = [];
    const walk = (o, p) => {
      for (const [k, v] of Object.entries(o || {})) {
        const key = p ? `${p}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) { walk(v, key); continue; }
        const secret = /(enc|pinhash|pinsalt)$/i.test(k);
        rows.push({ key, type: Array.isArray(v) ? 'list' : typeof v, secret, value: secret ? '‹hidden›' : v, def: secret ? '' : v, changed: /gap|fpsCap|accentHue|intervalSec/.test(key), enum: key === 'appearance.mode' ? ['dark', 'light', 'system'] : null, range: key === 'perf.fpsCap' ? [0, 360] : null });
      }
    };
    walk(settings, '');
    return rows;
  };
  const H = {
    'admin:status': () => status(),
    'admin:unlock': (code) => { if (!/^MMA-[\w-]+\.[\w-]+$/.test(String(code).trim())) throw new Error('That code is damaged.'); unlocked = true; return status(); },
    'admin:lock': () => { unlocked = false; return { unlocked: false }; },
    'admin:overview': () => ({
      status: status(),
      app: { version: '2.0.3', portable: false, packaged: true, safeMode: null, diet: false, locale: 'en-GB', language: 'en', uptimeSec: 612, pid: 9120, updatedFrom: { from: '2.0.2' } },
      versions: { app: '2.0.3', electron: '38.2.0', chrome: '140.0.7339.133', node: '22.19.0', v8: '14.0.365.10', koffi: '2.14.1' },
      paths: { exe: 'C:\\Program Files\\MultiMenu\\MultiMenu.exe', app: 'C:\\Program Files\\MultiMenu\\resources\\app.asar', data: '%USERPROFILE%\\AppData\\Roaming\\MultiMenu', logs: '%USERPROFILE%\\AppData\\Roaming\\MultiMenu\\logs', userData: '%USERPROFILE%\\AppData\\Roaming\\MultiMenu', temp: '%USERPROFILE%\\AppData\\Local\\Temp' },
      system: { os: 'Windows_NT 10.0.26100', arch: 'x64', cpus: 12, cpuModel: 'AMD Ryzen 5 5600X 6-Core Processor', totalGB: 16, freeGB: 5.7, uptimeH: 31.2, wine: false, memoryLoad: 64 },
      argv: ['--hidden'], env: { MULTIMENU_DEBUG: '1' },
      main: { cpu: +(2 + Math.random() * 3).toFixed(1), rssMB: 148 + Math.round(Math.random() * 6), heapMB: +(41 + Math.random() * 3).toFixed(1), heapTotalMB: 52, heapLimitMB: 4096, externalMB: 6.2, arrayBuffersMB: 1.1, lag: { mean: 10.4, p50: 10.1, p99: 14.6 + Math.random() * 4, max: 31.2 }, resources: { Timeout: 38, TCPServerWrap: 2, TCPSocketWrap: 3, FSReqCallback: 1, Immediate: 1 }, busEvents: 41, busListeners: 77 },
      processes: [{ pid: 9120, type: 'Browser', name: '', cpu: 2.1, wakeups: 12, memMB: 148, privateMB: 96, sandboxed: false }, { pid: 9184, type: 'GPU', name: '', cpu: 1.2, memMB: 121, privateMB: 88, sandboxed: true }, { pid: 9212, type: 'Utility', name: 'Network Service', cpu: 0.1, memMB: 34, privateMB: 12, sandboxed: true }, { pid: 9330, type: 'Tab', name: 'MultiMenu', cpu: 3.4, memMB: 186, privateMB: 141, sandboxed: true }],
      windows: [{ id: 1, title: 'MultiMenu', file: 'index.html', visible: true, focused: true, bounds: { x: 120, y: 80, width: 1440, height: 900 }, zoom: 1, pid: 9330, crashed: false }, { id: 2, title: 'MultiMenu mini', file: 'mini.html', visible: false, focused: false, bounds: { x: 1600, y: 60, width: 300, height: 420 }, zoom: 1, pid: 9331, crashed: false }],
      gpu: { '2d_canvas': 'enabled', gpu_compositing: 'enabled', rasterization: 'enabled', video_decode: 'enabled', webgl: 'enabled', webgl2: 'enabled', webgpu: 'disabled_off', vulkan: 'disabled_off' },
      features: [{ name: 'Roblox clients', on: true, detail: '2 running' }, { name: 'Watcher', on: true }, { name: 'RAM trimmer', on: true }, { name: 'Auto clicker', on: false }, { name: 'Anti-AFK', on: false }, { name: 'FPS limiter', on: true }, { name: 'Phone dashboard', on: true }, { name: 'Local API', on: true }, { name: 'Discord bot', on: false }, { name: 'Rotation', on: false }, { name: 'Auto-scale', on: false }, { name: 'Overlay', on: true }, { name: 'Sleep timer', on: false }],
    }),
    'admin:channels': ['accounts:list', 'accounts:refresh', 'admin:overview', 'app:info', 'sessions:launch', 'sessions:list', 'settings:get', 'settings:set', 'tiler:tile', 'updates:check'],
    'admin:feed': () => ({ log, bus, ipc, net, stats }),
    'admin:watch': (on) => !!on,
    'admin:clearFeed': () => true,
    'admin:settings': () => settingsRows(),
    'admin:settingReset': (key) => ({ value: null, key }),
    'admin:stores': [
      { name: 'accounts.json', bytes: 18422, mtime: now - 60e3, summary: { version: 'number', accounts: '4 items', groups: '2 items', pending: '0 items', bin: '1 item' } },
      { name: 'settings.json', bytes: 9311, mtime: now - 6e3, summary: { appearance: '12 fields', performance: '9 fields', tiling: '13 fields' } },
      { name: 'games.json', bytes: 2210, mtime: now - 86400e3, summary: { games: '5 items' } },
      { name: 'stats.json', bytes: 40210, mtime: now - 300e3, summary: { days: '42 fields', labels: '4 fields', events: '120 items' } },
      { name: 'webhooks.json', bytes: 1802, mtime: now - 7 * 86400e3, summary: { hooks: '1 item', history: '12 items' } },
    ],
    'admin:store': () => ({ version: 1, accounts: [{ id: 'a1', username: 'NovaLynx4821', alias: 'Main', group: 'Main', cookieEnc: '‹hidden›', tier: 'main', health: { state: 'ok', at: now - 3600e3 } }, { id: 'a2', username: 'StarlightKoi_09', alias: 'Farm 2', group: 'Alts', cookieEnc: '‹hidden›', tags: ['farm', 'trade'] }], groups: ['Main', 'Alts'], pending: [], bin: [] }),
    'admin:snapshots': [{ id: '20261113-104455-before-testing', label: 'Before testing', at: now - 3600e3, version: '2.0.3', files: ['accounts.json', 'settings.json', 'games.json', 'stats.json'], macros: 2, bytes: 70145 }, { id: '20261112-221010-before-restore', label: 'Before restore', at: now - 13 * 3600e3, version: '2.0.2', files: ['accounts.json', 'settings.json'], macros: 2, bytes: 27733 }],
    'admin:snapshot': (label) => ({ id: 'new', label, at: Date.now(), version: '2.0.3', files: ['a.json'], macros: 0, bytes: 1200 }),
    'admin:achievements': () => base.invoke('achievements:status'),
    'admin:windows': () => ({ available: true, list: [
      { id: '1', pid: 14220, className: 'WINDOWSCLIENT', title: 'Roblox', roblox: true, own: false, rect: { x: 0, y: 0, width: 960, height: 540 }, client: { width: 944, height: 501 }, style: '0x16cf0000', minimized: false, hung: false, keptTiny: null, process: { name: 'RobloxPlayerBeta.exe', memMB: 1240, cpu: 12.4 }, priority: 'normal', session: { id: 's1', label: 'Main', status: 'running', placeId: '920587237' } },
      { id: '2', pid: 15872, className: 'WINDOWSCLIENT', title: 'Roblox', roblox: true, own: false, rect: { x: 960, y: 0, width: 320, height: 200 }, client: { width: 304, height: 161 }, style: '0x16cf0000', minimized: false, hung: false, keptTiny: { w: 320, h: 200 }, process: { name: 'RobloxPlayerBeta.exe', memMB: 980, cpu: 8.1 }, priority: 'below', session: { id: 's2', label: 'Farm 2', status: 'running', placeId: '920587237' } },
      { id: '3', pid: 16004, className: 'WINDOWSCLIENT', title: 'Roblox', roblox: true, own: false, rect: { x: 1280, y: 0, width: 320, height: 200 }, client: { width: 304, height: 161 }, style: '0x16cf0000', minimized: true, hung: true, keptTiny: null, process: { name: 'RobloxPlayerBeta.exe', memMB: 1630, cpu: 0 }, priority: 'below', session: { id: 's3', label: 'Farm 3', status: 'running', placeId: '920587237' } },
    ] }),
    'admin:window': () => true,
    'admin:folders': [{ id: 'chromium', name: 'Page cache', bytes: 41e6, clearable: true }, { id: 'browse', name: 'Browse-as profiles', bytes: 182e6, clearable: false }, { id: 'logs', name: 'Logs', bytes: 2.4e6, clearable: false }, { id: 'backups', name: 'Backups', bytes: 1.1e6, clearable: false }, { id: 'updates', name: 'Update downloads', bytes: 0, clearable: true }, { id: 'macros', name: 'Macros', bytes: 88e3, clearable: false }, { id: 'snapshots', name: 'Admin snapshots', bytes: 98e3, clearable: false }, { id: 'profiles', name: 'Admin profiles', bytes: 12.2e6, clearable: true }, { id: 'screenshots', name: 'Admin screenshots', bytes: 3.4e6, clearable: true }],
    'admin:i18n': { total: 3163, current: 'en', pseudo: false, languages: ['de', 'es', 'fil', 'fr', 'id', 'it', 'nb', 'pl', 'pt', 'ru', 'tr', 'vi'].map((id, i) => ({ id, name: { de: 'German', es: 'Spanish', fil: 'Filipino', fr: 'French', id: 'Indonesian', it: 'Italian', nb: 'Norwegian', pl: 'Polish', pt: 'Portuguese', ru: 'Russian', tr: 'Turkish', vi: 'Vietnamese' }[id], count: 3163 - (i === 4 ? 2 : 0), missing: i === 4 ? ['Window stopped responding', 'The window crashed'] : [], missingCount: i === 4 ? 2 : 0, same: 40 + i })) },
    'admin:hotkeys': { clickerToggle: 'F6 ok', emergencyStop: 'F8 ok', tileWindows: 'Ctrl+Alt+T ok', miniPanel: 'Ctrl+Alt+M taken by another app' },
    'admin:releases': [{ tag: 'v2.0.3', version: '2.0.3', name: 'MultiMenu 2.0.3', publishedAt: new Date(now - 86400e3).toISOString(), prerelease: false, installable: true, current: true, downloads: 214 }, { tag: 'V1.8.0', version: '1.8.0', name: 'MultiMenu 1.8', publishedAt: new Date(now - 40 * 86400e3).toISOString(), prerelease: false, installable: true, current: false, downloads: 1893 }],
    'admin:flags': (patch) => { if (patch) flags = { ...flags, ...patch }; return flags; },
    'admin:demo': (on) => { demo = !!on; return status(); },
    'admin:simulate': () => true,
    'admin:screenshot': { name: 'MultiMenu-20261113-104455.png', width: 1440, height: 900 },
    'admin:cpuProfile': { name: 'main-20261113-104512.cpuprofile', bytes: 412000, samples: 19622 },
    'admin:heapSnapshot': { name: 'main-20261113-104540.heapsnapshot', bytes: 38e6 },
    'admin:gc': { before: { heapMB: 44.1, rssMB: 152.3 }, after: { heapMB: 31.7, rssMB: 149.8 } },
    'admin:bundle': { file: 'MultiMenu-debug-2026-11-13.mmdebug.json', bytes: 812000 },
  };
  for (const k of ['admin:devtools', 'admin:reload', 'admin:relaunch', 'admin:open', 'admin:crash', 'admin:reset', 'admin:removeSnapshot', 'admin:restore', 'admin:clearFolder', 'admin:pretendVersion', 'admin:resetUpdater', 'admin:offerVersion', 'admin:windowSize']) if (!(k in H)) H[k] = true;
  window.mm = {
    ...base,
    invoke: (ch, ...a) => {
      if (!(ch in H)) return base.invoke(ch, ...a);
      if (!unlocked && !['admin:status', 'admin:unlock'].includes(ch)) return Promise.reject(new Error('Admin mode is locked.'));
      return new Promise((res, rej) => setTimeout(() => {
        try { const v = H[ch]; const r = typeof v === 'function' ? v(...a) : JSON.parse(JSON.stringify(v)); Promise.resolve(r).then(res, rej); } catch (e) { rej(e); }
      }, 5));
    },
    on: (ev, cb) => { if (ev === 'admin:feed') { feedListeners.push(cb); return () => {}; } return base.on(ev, cb); },
    _adminFeed: (b) => feedListeners.forEach(f => f(b)),
  };
})();
