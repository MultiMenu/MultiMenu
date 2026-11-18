// 2.0 sample data (loaded before demo-api.js by the screenshot tests and by admin demo mode).
window.__MM_SETTINGS_PATCH = {
  appearance: { mode: window.__MM_MODE || 'dark', density: window.__MM_DENSITY || 'comfortable', contrast: window.__MM_CONTRAST || 'normal', textSize: 100 },
  dashboard: { widgets: [] },
  hotkeys: { altWall: 'Ctrl+Alt+W' },
  altKeys: { enabled: true, modifier: 'Ctrl+Alt', launchIfClosed: true },
  accounts: { binDays: 30 },
  launch: { smart: true, cpuSettle: 70, maxWaitSec: 45 },
  perf: { fpsCap: 30, lowGraphics: true, lighter: true, flags: { msaa: 'x1', texture: 'lowest', mode: 'default', graySky: false, noGrass: true, lowestQuality: true, pauseLighting: false }, minimize: false, tiny: false, tinyW: 240, tinyH: 180, mute: true, planned: 6 },
  overlay: { enabled: true, fps: true, ping: true, uptime: true, mem: false, position: 'top-left', scale: 100 },
  wall: { thumbSec: 5, showOffline: true, size: 'm' },
  rotation: { enabled: true, accountIds: ['a2', 'a3', 'a4'], tag: '', size: 2, everyMin: 60, game: '920587237', watch: true },
  autoScale: { enabled: true, budget: 'free', freeGB: 2, capGB: 12, cpuMax: 85, min: 1, max: 10, accountIds: [], tag: 'farm', game: '', watch: true },
  api: { enabled: true, port: 43822, keyEnc: 'x', cli: true },
  speech: { enabled: true, voice: '', volume: 100, rate: 0, quiet: true, events: { accountCrashed: true, watcherGaveUp: true, launchFailed: false, loginWarning: true, highUsage: false, robloxOutage: true, internetBack: false, gameUpdated: false, achievement: true } },
  insights: { enabled: true, dismissed: {} },
  limiter: { eco: true },
  phone: { enabled: true, port: 43821, allowControl: true, thumbs: true },
  ramTrimmer: { enabled: true, intervalSec: 600 },
  screen: { everySec: 3, minWidth: 320 },
  hatch: { enabled: true, places: ['6403373529'], words: ['secret', 'hatched'], pets: ['Galaxy Dragon', 'Void Phoenix', 'Golden Kraken'],
    sources: { output: true, badges: true, screen: true }, badgeIds: [], badgeEverySec: 60, ping: '123456789012345678', dm: true, screenshot: true, cooldownSec: 30 },
};

window.__MM_EXTRA = ({ settings, accounts, sessions, now }) => {
  Object.assign(accounts[0], { tier: 'main', tags: ['main'], slot: 1 });
  Object.assign(accounts[1], { tier: 'important', tags: ['farm', 'trade'], slot: 2 });
  Object.assign(accounts[2], { tier: 'filler', tags: ['farm'], slot: null });
  Object.assign(accounts[3], { tier: 'filler', tags: ['farm'], slot: 3 });
  const shot = (hue, label) => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 225;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 225); sky.addColorStop(0, `hsl(${hue},70%,62%)`); sky.addColorStop(1, `hsl(${hue + 30},70%,82%)`);
    g.fillStyle = sky; g.fillRect(0, 0, 400, 225);
    g.fillStyle = '#4caf50'; g.fillRect(0, 150, 400, 75);
    g.fillStyle = '#8d6e63'; g.fillRect(50, 95, 90, 55); g.fillStyle = '#c62828'; g.beginPath(); g.moveTo(42, 95); g.lineTo(95, 62); g.lineTo(148, 95); g.fill();
    g.fillStyle = '#ffeb3b'; g.fillRect(230, 112, 18, 38); g.fillStyle = '#ffcc80'; g.fillRect(232, 92, 14, 18);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(8, 8, 128, 24); g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.fillText(label, 16, 25);
    return c.toDataURL('image/jpeg', 0.8);
  };
  const H = 3600e3;
  const tiles = [
    { id: 's1', accountId: 'a1', label: 'Main', username: 'NeonFalcon2291', tier: 'main', slot: 1, tags: ['main'], status: 'running', state: 'in game', game: 'Adopt Me!', startedAt: now - 2400e3, memMB: 1240, cpu: 12, ping: 48, fps: 60, watch: true, health: { score: 96, grade: 'great', reasons: [] }, color: 'violet' },
    { id: 's2', accountId: 'a4', label: 'Farm 2', username: 'LunarPixel4410', tier: 'filler', slot: 3, tags: ['farm'], status: 'running', state: 'not responding', game: 'Adopt Me!', startedAt: now - 900e3, memMB: 980, cpu: 8, ping: 312, fps: 10, watch: true, health: { score: 52, grade: 'poor', reasons: [{ points: 40, text: 'Moderation notice' }] } },
    { id: 's5', accountId: 'a2', label: 'Violet', username: 'VioletRaven_77', tier: 'important', slot: 2, tags: ['farm', 'trade'], status: 'running', state: 'in game', game: 'Adopt Me!', startedAt: now - 600e3, memMB: 1010, cpu: 9, ping: 140, fps: 30, watch: false, health: { score: 74, grade: 'ok', reasons: [{ points: 20, text: '4 crashes this week' }] }, color: 'cyan' },
    { id: 's6', accountId: null, label: 'Roblox (opened outside MultiMenu)', external: true, status: 'running', state: null, game: '', startedAt: now - 300e3, memMB: 870, cpu: 6, ping: null, fps: null, health: null },
  ];
  const catalog = {
    triggers: { problem: { label: 'An alt has a problem', params: { kind: ['any', 'crash', 'disconnect', 'freeze', 'stuck'] } }, gaveUp: { label: 'The watcher stops retrying an alt' }, started: { label: 'An alt starts playing' }, ram: { label: 'RAM is above a level', params: { percent: 'number', minutes: 'number' } }, time: { label: 'At a time of day', params: { time: 'time', days: 'days' } }, away: { label: 'You have been away', params: { minutes: 'number' } }, back: { label: 'You come back to the PC' } },
    conditions: { who: { label: 'The alt is', params: { who: 'text' } }, between: { label: 'The time is between', params: { start: 'time', end: 'time' } }, clients: { label: 'Alts running', params: { op: ['<', '>', '='], n: 'number' } } },
    actions: { rejoin: { label: 'Rejoin the alt', params: { who: 'text' } }, close: { label: 'Close alts', params: { who: 'text' } }, speak: { label: 'Say something out loud', params: { text: 'text' } }, alert: { label: 'Send to my phone apps', params: { text: 'text' } }, eco: { label: 'Turn eco mode', params: { state: ['on', 'off'] } }, tile: { label: 'Tile the windows' }, wait: { label: 'Wait', params: { seconds: 'number' } }, preset: { label: 'Start or close a preset', params: { name: 'text', mode: ['start', 'stop'] } } },
    accountTriggers: ['problem', 'gaveUp', 'started'],
  };
  const rules = [
    { id: 'r1', name: 'Rejoin farm alts that crash at night', enabled: true, trigger: { type: 'problem', kind: 'crash' }, conditions: [{ type: 'who', who: 'tag:farm' }, { type: 'between', start: '22:00', end: '08:00' }], actions: [{ type: 'rejoin', who: '' }, { type: 'speak', text: '{account} crashed' }], cooldownSec: 60, runs: 14, lastRunAt: now - 3 * H },
    { id: 'r2', name: 'Eco mode while I\'m away', enabled: true, trigger: { type: 'away', minutes: 10 }, conditions: [], actions: [{ type: 'eco', state: 'on' }], cooldownSec: 60, runs: 6, lastRunAt: now - 26 * H },
    { id: 'r3', name: 'Start the farm at 8', enabled: false, trigger: { type: 'time', time: '08:00', days: [1, 2, 3, 4, 5] }, conditions: [{ type: 'clients', op: '<', n: 2 }], actions: [{ type: 'preset', name: 'Farm squad', mode: 'start' }], cooldownSec: 60, runs: 0, lastRunAt: null },
  ];
  const span = (s, e, reason, game = 'Adopt Me!') => ({ start: now - s * H, end: e == null ? now : now - e * H, realStart: now - s * H, realEnd: e == null ? null : now - e * H, reason, game, live: e == null });
  const ach = [['first', 'rocket', 'First flight', 'Launch an account with MultiMenu', 1, 1, true], ['alts10', 'users', 'Squad goals', 'Save 10 accounts', 4, 10, false], ['run5', 'layout-grid', 'Five at once', 'Run 5 alts at the same time', 5, 5, true], ['hours100', 'clock', 'Centurion', '100 hours of alt time', 100, 100, true], ['marathon', 'timer', 'Marathon', 'Keep one alt on for 12 hours', 12, 12, true], ['nightowl', 'moon', 'Night owl', 'Have an alt running at 3 AM', 1, 1, true], ['streak30', 'flame', 'Unstoppable', 'A 30-day streak', 23, 30, false], ['tiler', 'layout-dashboard', 'Neat freak', 'Tile your windows 50 times', 31, 50, false], ['commander', 'command', 'Commander', 'Control MultiMenu from the command line, a script or a Stream Deck', 0, 1, false], ['eco', 'leaf', 'Eco warrior', 'Turn on eco mode', 1, 1, true]];
  const perfInfo = {
    order: ['potato', 'maxAlts', 'balanced', 'defaults'], current: 'balanced', bootstrapper: false, options: {},
    presets: {
      potato: { label: 'Potato', desc: 'For AFK farming: the least Roblox will draw.', facts: ['5 FPS', 'Lowest graphics', 'Every lighter-rendering option', 'Grey sky, no grass, lighting paused', 'Reduce motion', 'Start alts tiny', 'Minimise once in game', 'Mute once in game', 'Eco mode for background alts', 'RAM Trimmer every 5 min', 'Main accounts keep full quality'], values: { 'perf.fpsCap': 5, 'perf.lowGraphics': true, 'perf.lighter': true, 'perf.reducedMotion': true, 'perf.flags.msaa': 'x1', 'perf.flags.texture': 'lowest', 'perf.flags.mode': 'default', 'perf.flags.graySky': true, 'perf.flags.noGrass': true, 'perf.flags.lowestQuality': true, 'perf.flags.pauseLighting': true, 'perf.minimize': true, 'perf.tiny': true, 'perf.tinyW': 240, 'perf.tinyH': 180, 'perf.mute': true, 'limiter.eco': true, 'ramTrimmer.intervalSec': 300, 'ramTrimmer.enabled': true } },
      maxAlts: { label: 'Max alts', desc: 'Most alts, least detail.', facts: ['10 FPS', 'Lowest graphics', 'Start alts tiny', 'Minimise once in game', 'Mute once in game', 'Lighter rendering', 'Eco mode for background alts', 'RAM Trimmer every 5 min', 'Main accounts keep full quality'], values: { 'perf.fpsCap': 10, 'perf.lowGraphics': true, 'perf.lighter': true, 'perf.flags.msaa': 'x1', 'perf.flags.texture': 'lowest', 'perf.flags.mode': 'default', 'perf.flags.graySky': true, 'perf.flags.noGrass': true, 'perf.flags.lowestQuality': true, 'perf.flags.pauseLighting': true, 'perf.minimize': true, 'perf.tiny': true, 'perf.tinyW': 240, 'perf.tinyH': 180, 'perf.mute': true, 'limiter.eco': true, 'ramTrimmer.intervalSec': 300, 'ramTrimmer.enabled': true } },
      balanced: { label: 'Balanced', desc: 'A good start for most PCs.', facts: ['30 FPS', 'Lowest graphics', 'Stay on screen', 'Lighter rendering', 'Mute once in game', 'Eco mode for background alts', 'RAM Trimmer every 10 min'], values: { 'perf.fpsCap': 30, 'perf.lowGraphics': true, 'perf.lighter': true, 'perf.flags.msaa': 'x1', 'perf.flags.texture': 'lowest', 'perf.flags.mode': 'default', 'perf.flags.graySky': false, 'perf.flags.noGrass': true, 'perf.flags.lowestQuality': true, 'perf.flags.pauseLighting': false, 'perf.minimize': false, 'perf.tiny': false, 'perf.mute': true, 'limiter.eco': true, 'ramTrimmer.intervalSec': 600, 'ramTrimmer.enabled': true } },
      defaults: { label: 'Roblox defaults', desc: 'MultiMenu leaves Roblox as it is.', facts: ['No FPS cap', 'Your own graphics', 'Stay on screen', 'No eco mode or trimming'], values: { 'perf.fpsCap': 0, 'perf.lowGraphics': false, 'perf.lighter': false, 'perf.minimize': false, 'perf.tiny': false, 'perf.mute': false, 'limiter.eco': false, 'ramTrimmer.enabled': false } },
    },
  };
  return {
    'hatch:status': {
      enabled: true, watching: 3, running: 4, outputLines: 1840, outputMatches: 2, badgeCheckedAt: null, badgeError: null, screenChecked: 912, screenSkipped: 0, screenError: null,
      ocr: { available: true, running: true, error: null }, bot: { ready: true, hasToken: true, users: 1 }, discord: { enabled: true, hooks: 1, event: true },
      log: [
        { id: 'h1', at: now - 4 * 60e3, accountId: 'a4', label: 'Farm 2', pet: 'Galaxy Dragon', rarity: 'Secret', source: 'screen', text: 'You hatched a Galaxy Dragon!', shot: 'x.png' },
        { id: 'h2', at: now - 3 * 3600e3, accountId: 'a3', label: 'Farm 1', pet: 'Void Phoenix', rarity: 'Secret', source: 'output', text: 'Farm 1 hatched a SECRET Void Phoenix', shot: null },
      ],
      counts: [{ accountId: 'a4', label: 'Farm 2', n: 3, last: now - 4 * 60e3 }, { accountId: 'a3', label: 'Farm 1', n: 1, last: now - 3 * 3600e3 }],
      sessions: [{ id: 's1', label: 'Main', pid: 1, placeId: '6403373529', placeName: 'Rebirth Champions: Ultimate', hasLog: true, inGame: true }],
    },
    'accounts:list': { accounts, groups: ['Main', 'Alts'], secureStorage: true, tags: [{ tag: 'farm', count: 3 }, { tag: 'main', count: 1 }, { tag: 'trade', count: 1 }], filters: [{ id: 'f1', name: 'Farm alts', q: { text: '', group: '', tag: 'farm', tier: '', status: '' } }, { id: 'f2', name: 'Needs login', q: { text: '', group: '', tag: '', tier: '', status: 'expired' } }], binCount: 2 },
    'accounts:bin': [{ ...accounts[2], id: 'b1', username: 'OldFarmer_22', alias: '', deletedAt: now - 3 * 864e5, purgeAt: now + 27 * 864e5 }, { ...accounts[1], id: 'b2', username: 'TestAlt9001', alias: '', deletedAt: now - 20 * 864e5, purgeAt: now + 10 * 864e5 }],
    'health:scores': { a1: { score: 96, grade: 'great', reasons: [] }, a2: { score: 74, grade: 'ok', reasons: [{ points: 20, text: '4 crashes this week' }] }, a3: { score: 30, grade: 'poor', reasons: [{ points: 70, text: 'Login expired' }] }, a4: { score: 52, grade: 'poor', reasons: [{ points: 40, text: 'Moderation notice' }] } },
    'wall:data': { tiles, offline: [{ accountId: 'a3', label: 'Farm 1', username: 'CosmicOtter812', tier: 'filler', slot: null, tags: ['farm'], status: 'expired', health: { score: 30, grade: 'poor', reasons: [] } }], at: now },
    'wall:thumbs': () => ({ s1: shot(205, 'Coins: 48,210'), s2: shot(25, 'Coins: 12,004'), s5: null, s6: shot(280, 'Coins: 9,442') }),
    'overlay:status': { enabled: true, running: true, windows: 1, available: true }, 'overlay:enable': (on) => ({ enabled: on, running: on }),
    'switcher:open': true, 'switcher:close': true,
    'rotation:status': { enabled: true, config: settings.rotation, pool: [{ id: 'a2', name: 'Violet' }, { id: 'a3', name: 'Farm 1' }, { id: 'a4', name: 'Farm 2' }], current: [{ id: 'a2', name: 'Violet' }, { id: 'a4', name: 'Farm 2' }], nextAt: now + 38 * 60e3, history: [{ at: now - 22 * 60e3, reason: 'timer', in: ['Violet', 'Farm 2'], out: ['Farm 1'] }, { at: now - 82 * 60e3, reason: 'start', in: ['Farm 1', 'Violet'], out: [] }] },
    'autoscale:status': { enabled: true, config: settings.autoScale, pool: 3, cooldownUntil: 0, now: { freeGB: 5.8, robloxGB: 4.1, cpu: 38 }, decisions: [{ at: now - 300e3, action: 'up', reason: '6.9 GB free, CPU 31%', label: 'Farm 2' }, { at: now - 3 * H, action: 'down', reason: 'only 1.6 GB RAM free', label: 'Farm 1' }] },
    'limiter:eco': (on) => ({ eco: on, running: true, supported: true }),
    'gameprofiles:list': [{ id: 'gp1', placeId: '920587237', name: 'Adopt Me!', graphics: { enabled: true, quality: 1, fpsCap: 30 }, layout: 'grid2', watcher: { stuckMin: 8, freezeSec: 0, maxPerHour: 0 } }],
    'automations:list': { rules, catalog, log: [{ at: now - 3 * H, ruleId: 'r1', name: 'Rejoin farm alts that crash at night', trigger: 'problem', account: 'Farm 2', steps: ['Rejoining Farm 2', 'Spoke'] }, { at: now - 26 * H, ruleId: 'r2', name: 'Eco mode while I\'m away', trigger: 'away', account: null, steps: ['Eco mode on'] }] },
    'insights:list': [
      { id: 'crashy:a4', icon: 'triangle-alert', level: 'warn', title: 'Farm 2 crashed 5 times this week', text: 'Lower graphics at launch often helps (edit the account), or check whether the game itself is crashing.', action: { label: 'Open accounts', page: 'accounts' } },
      { id: 'dishour:3', icon: 'clock', level: 'info', title: 'Disconnects bunch up around 03:00', text: 'Roblox servers often restart at the same time each day. Quiet hours can skip rejoins then.', action: { label: 'Quiet hours', page: 'watcher' } },
      { id: 'streak:23', icon: 'flame', level: 'good', title: '23-day streak', text: 'Your alts have been on every day. Keep it going!' },
    ],
    'timeline:query': (h) => ({ from: now - h * H, to: now, rows: [
      { key: 'a1', accountId: 'a1', label: 'Main', ms: 14 * H, spans: [span(23, 15, 'closed'), span(9, 3, 'closed'), span(0.7, null)], marks: [] },
      { key: 'a4', accountId: 'a4', label: 'Farm 2', ms: 19 * H, spans: [span(22, 12.5, 'crash'), span(12.4, 4, 'restart'), span(3.9, null)], marks: [{ at: now - 12.5 * H, kind: 'crash' }, { at: now - 12.4 * H, kind: 'rejoin' }, { at: now - 4 * H, kind: 'freeze' }, { at: now - 3.95 * H, kind: 'rejoin' }] },
      { key: 'a2', accountId: 'a2', label: 'Violet', ms: 8 * H, spans: [span(16, 9, 'closed'), span(0.5, null)], marks: [{ at: now - 11 * H, kind: 'disconnect' }] },
    ] }),
    'achievements:status': { list: ach.map(([id, icon, title, desc, cur, goal, done]) => ({ id, icon, title, desc, current: cur, goal, done, at: done ? now - 5 * 864e5 : null })), unlocked: ach.filter(a => a[6]).length, total: 25 },
    'stats:wrapped': (p) => ({ month: p === 'year' ? '2026' : '2026-11', period: p, hours: 214.7, launches: 142, rejoins: 61, problems: 74, memRestarts: 9, activeDays: 11, accountsUsed: 6, topAccount: { label: 'Main', hours: 96.4 }, topGame: { name: 'Adopt Me!', hours: 188.2 }, topAccounts: [{ label: 'Main', hours: 96.4 }, { label: 'Farm 2', hours: 71.2 }, { label: 'Violet', hours: 30.1 }], topGames: [{ name: 'Adopt Me!', hours: 188.2 }, { name: 'Pet Simulator 99', hours: 20.3 }], bestDay: { day: '2026-11-08', hours: 31.5 }, streak: { current: 23, longest: 41 }, achievements: [{ id: 'run5', icon: 'layout-grid', title: 'Five at once' }, { id: 'nightowl', icon: 'moon', title: 'Night owl' }], personality: { icon: 'layers', title: 'Farm Tycoon', text: 'You run alts like a business.' } }),
    'doctor:run': { at: now, problems: 2, summary: '2 things to look at.', checks: [
      { id: 'windows', title: 'Windows features', status: 'ok', detail: '' }, { id: 'roblox', title: 'Roblox is installed', status: 'ok', detail: '' },
      { id: 'logins', title: 'Account logins', status: 'warn', detail: '1 login has expired: Farm 1', fix: { id: 'page:accounts', label: 'Open accounts' } },
      { id: 'graphics', title: 'Your Roblox graphics', status: 'warn', detail: 'Your Roblox graphics may still be an alt\'s low settings.', fix: { id: 'restoreGraphics', label: 'Put mine back', safe: true } },
      { id: 'disk', title: 'Free disk space', status: 'ok', detail: '212 GB free' }, { id: 'memory', title: 'Memory for MultiMenu', status: 'info', detail: 'This PC has 8 GB of RAM. Diet mode makes MultiMenu lighter.', fix: { id: 'dietOn', label: 'Turn on diet mode', safe: true } },
      { id: 'internet', title: 'Internet and Roblox', status: 'ok', detail: '' }, { id: 'update', title: 'MultiMenu version', status: 'ok', detail: 'v2.0.0' }] },
    'perf:info': perfInfo,
    'perf:measure': () => new Promise(r => setTimeout(() => r({ planned: 6, ramPct: 83, cpuPct: 64, tier: 'tight', fits: 5, memPerMB: 1080, cpuPer: 8.6, preset: null, values: { 'perf.lighter': true, 'perf.lowGraphics': true, 'ramTrimmer.enabled': true, 'perf.minimize': true }, reasons: ['Each client uses about 1080 MB of memory. Lighter rendering and lowest graphics save the most.', 'With many alts, minimised windows save GPU time.'], measured: 2, at: now }), 300)),
    'perf:apply': (v) => ({ changed: Object.keys(v).length, settings }),
    'api:status': { enabled: true, running: true, port: 43822, hasKey: true, error: null, calls: { count: 37, last: { at: now - 60e3, name: 'status', client: 'streamdeck' } }, cli: true },
    'api:cliInfo': { folder: 'C:\\Users\\You\\AppData\\Local\\Programs\\MultiMenu', mm: 'C:\\Users\\You\\AppData\\Local\\Programs\\MultiMenu\\mm.cmd', exists: true },
    'api:key': 'mm_8xJ2kQ0vZt7RqP4wLm9sN3bYc6Fh1Ud5',
    'speech:voices': [{ name: 'Microsoft David Desktop', culture: 'en-US' }, { name: 'Microsoft Zira Desktop', culture: 'en-US' }, { name: 'Microsoft Hazel Desktop', culture: 'en-GB' }],
    'automations:catalog': catalog,
    'share:create': (kind) => ({ kind, name: { preset: 'Night farm', rule: 'Rejoin farm alts that crash at night', theme: 'Midnight', layout: 'Smart grid', game: 'Adopt Me!' }[kind],
      code: 'MM2-preset-hVLLbtswEPwVQuc2ayH4ZqQ2bAHZBKRVuQq0K1z7k3o3NfgDPJ0P_6_ZZ0mXW8T3Ra1kD_oZ8ux2r1J2kV0OZlkY0ngP7dk1Z6wjUq3mR-0uS0oMbZRu91tBs7a4NCSU3-29ZrdGHvKzlP7dAN_hnTq5BWPBXuh2Ap4-k8TfV1JcqeOKUvgdnypYYc0jnGxW3aRBNwdUA', notes: kind === 'preset' ? ['The private server link was left out. The code opens the public game instead.', 'Accounts aren\'t included. Whoever imports it picks their own.'] : [] }),
    'share:fromClipboard': 'MM2-rule-jZFNTsMwEIWvMvK6RVRCQuoOJHZsYMMBnGTSWHI8kX9a0aqHYcOCDX_ex0-Hj7kcVG0DmGhG2iKxaGZ59ruYoVuoHmTqOqoiEO1GKNCwaRDpRZBf8xdNdRhgYGkGl7GNuP0d5jzq1ahrDJb9-8m3ezbCqrUmqIhk9jzVcYCqH4kh0tRDm3AhwI-28-u98dqp',
    'share:preview': (text) => (/MM2-rule/.test(text) ? { kind: 'rule', name: 'Rejoin farm alts that crash at night', code: text, data: { name: 'Rejoin farm alts that crash at night', trigger: { type: 'problem', kind: 'crash' }, conditions: [{ type: 'between', start: '22:00', end: '08:00' }], actions: [{ type: 'rejoin', who: 'tag:farm' }, { type: 'notify', text: 'Rejoined' }], cooldownSec: 60 } }
      : { kind: 'theme', name: 'Aurora', code: text, data: { name: 'Aurora', accentHue: 160, particles: true, theme: { secondaryHue: 280, glow: 130, blur: 22, bgType: 'gradient', bgDim: 55 } } }),
    'share:import': (text) => (/MM2-rule/.test(text) ? { kind: 'rule', name: 'Rejoin farm alts that crash at night (2)' } : { kind: 'theme', name: 'Aurora' }),
    'gallery:restore': true,
    'gallery:list': (() => {
      const T = (name, author, a, s, glow, blur, bg) => ({ id: name, name, author, code: `MM2-theme-${name}-0000000`, theme: { name, accentHue: a, particles: true, theme: { secondaryHue: s, glow, blur, bgType: bg, bgDim: 55 } } });
      const builtIn = [['Midnight', 270, 295, 100, 20, 'gradient', 'midnight'], ['Amethyst', 285, 325, 120, 24, 'gradient', 'amethyst'], ['Neon', 300, 190, 190, 16, 'gradient', 'neon'], ['Ember', 345, 25, 110, 20, 'gradient', 'ember'], ['Ocean', 220, 180, 100, 20, 'gradient', 'ocean'], ['Minimal', 265, 265, 0, 0, 'solid', 'minimal']]
        .map(([n, a, s, g, b, bg, id]) => ({ ...T(n, 'MultiMenu', a, s, g, b, bg), id: `builtin:${id}`, preset: id }));
      const online = [['Aurora', 160, 280, 130, 22, 'gradient'], ['Sakura', 330, 15, 110, 24, 'gradient'], ['Deep sea', 200, 235, 90, 26, 'gradient'], ['Toxic', 95, 150, 170, 16, 'gradient'], ['Sunset', 20, 320, 120, 20, 'gradient'], ['Gold rush', 45, 25, 110, 18, 'gradient'],
        ['Frost', 190, 210, 70, 30, 'gradient'], ['Blood moon', 355, 280, 140, 20, 'gradient'], ['Matrix', 125, 125, 150, 0, 'solid'], ['Lavender', 255, 300, 60, 28, 'gradient'], ['Cyber', 55, 190, 180, 14, 'gradient'], ['Graphite', 220, 220, 20, 10, 'solid']].map(x => T(x[0], 'MultiMenu', ...x.slice(1)));
      return { builtIn, online, fetchedAt: now - 40 * 60e3, error: null };
    })(),
    'phone:check': { ok: false, address: '192.168.1.42', network: 'Wi-Fi', category: 'Public', items: [
      { level: 'ok', text: 'The phone dashboard is running.' },
      { level: 'err', text: 'Windows treats “Wi-Fi” as a Public network and blocks phones on it. If this is your home network, make it Private: Windows Settings, Network & internet, Wi-Fi, then Private network.', fix: 'network' },
      { level: 'err', text: 'Windows Firewall blocks MultiMenu on this network. Open “Allow an app through firewall”, then tick Private next to MultiMenu.', fix: 'firewall' },
      { level: 'warn', text: 'A VPN is on. Some VPNs stop phones on your Wi-Fi from reaching this PC. If the phone can’t connect, turn the VPN off or allow local network access in its settings.' },
      { level: 'info', text: 'Your phone must be on the same Wi-Fi as this PC (not mobile data, and not a guest network).' }] },
    'phone:openFix': true,
    'presence:status': { enabled: true, connected: true, user: 'void', error: null, preview: { details: 'Running 4 alts', state: 'In Pet Simulator 99', timestamps: { start: Math.floor((now - 2 * 3600e3 - 14 * 60e3) / 1000) }, assets: { large_image: 'logo' }, buttons: [{ label: 'Get MultiMenu', url: 'https://github.com/voidflarerblx-coder/MultiMenu' }] } },
    'launchqueue:view': { current: { qid: 'q0', accountId: 'a5', label: 'Farm 3', startedAt: now - 9e3, phase: 'waiting' }, items: [
      { qid: 'q1', accountId: 'a6', label: 'Farm 4', etaMs: 14e3 }, { qid: 'q2', accountId: 'a7', label: 'Farm 5', etaMs: 39e3 }, { qid: 'q3', accountId: 'a8', label: 'Farm 6', etaMs: 64e3 }, { qid: 'q4', accountId: 'a9', label: 'Trader', etaMs: 89e3 }],
      avgMs: 25e3, doneInMs: 114e3 },
    'customlayouts:list': [{ id: 'c1', name: 'Two big + six', zones: [{ x: 0, y: 0, w: 0.5, h: 0.6 }, { x: 0.5, y: 0, w: 0.5, h: 0.6 }, ...[0, 1, 2, 3, 4, 5].map(c => ({ x: c / 6, y: 0.6, w: 1 / 6, h: 0.4 }))] }],
    'accounts:exportColumns': { username: 'Username', displayName: 'Display name', alias: 'Alias', userId: 'User ID', profile: 'Profile link', group: 'Group', tags: 'Tags', tier: 'Importance', notes: 'Notes', status: 'Login', robux: 'Robux', premium: 'Premium', added: 'Added', lastUsed: 'Last used' },
    'games:search': { next: 'p2', games: [
      { universeId: '1', placeId: '8737899170', name: 'Pet Simulator 99!', creator: 'BIG Games Pets', verified: true, playing: 182345, likes: 87, icon: null },
      { universeId: '2', placeId: '1537690962', name: 'Bee Swarm Simulator', creator: 'Onett', verified: true, playing: 21456, likes: 93, icon: null },
      { universeId: '3', placeId: '2753915549', name: 'Blox Fruits', creator: 'Gamer Robot', verified: true, playing: 312000, likes: 91, icon: null },
      { universeId: '4', placeId: '4', name: 'Pet Catchers', creator: 'Clever Kids', verified: true, playing: 9800, likes: 89, icon: null }] },
    'phone:status': { enabled: true, running: true, port: 43821, hasPin: true, allowControl: true, urls: ['http://192.168.1.42:43821', 'http://10.5.0.2:43821'], networks: ['Wi-Fi', 'NordLynx'], virtual: [false, true], qrUrl: 'http://192.168.1.42:43821', error: null, signedIn: [{ ip: '192.168.1.57', at: now - 600e3, agent: 'iPhone' }], qr: window.__MM_QR || '',
      thumbs: true, remembered: [{ id: 'd1', ip: '192.168.1.57', at: now - 9 * 864e5, lastSeen: now - 300e3, agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }, { id: 'd2', ip: '192.168.1.63', at: now - 3 * 864e5, lastSeen: now - 2 * 3600e3, agent: 'Mozilla/5.0 (Linux; Android 15)' }] },
  };
};
