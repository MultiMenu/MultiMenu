'use strict';
const { tmp } = require('./helpers/electron-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const paths = require('../src/main/paths');
paths.ensureDirs();
const settings = require('../src/main/modules/settings');
settings.init();

const FAKE_COOKIE = '_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_' + 'A'.repeat(300);

test('roblox: cookie normalisation and validation', () => {
  const r = require('../src/main/modules/roblox');
  assert.equal(r.normaliseCookie(`  ".ROBLOSECURITY=${FAKE_COOKIE}; path=/"  `), FAKE_COOKIE);
  assert.ok(r.looksLikeCookie(FAKE_COOKIE));
  assert.ok(!r.looksLikeCookie('hello'));
  assert.ok(!r.looksLikeCookie(`${FAKE_COOKIE} with space`));
});

test('roblox: parseTarget handles ids, game links and private servers', () => {
  const { parseTarget } = require('../src/main/modules/roblox');
  assert.deepEqual(parseTarget('920587237'), { placeId: '920587237' });
  assert.equal(parseTarget('https://www.roblox.com/games/920587237/Adopt-Me').placeId, '920587237');
  const ps = parseTarget('https://www.roblox.com/games/123/x?privateServerLinkCode=ABC123');
  assert.equal(ps.linkCode, 'ABC123');
  assert.equal(parseTarget('https://evil.com/games/1'), null);
  assert.equal(parseTarget(''), null);
  assert.equal(parseTarget('abc'), null);
});

test('roblox: launch URI and player args contain the ticket and place', () => {
  const r = require('../src/main/modules/roblox');
  const uri = r.buildLaunchUri({ ticket: 'TICKET123', target: { placeId: '42' }, browserTrackerId: '111', launchTime: 5 });
  assert.match(uri, /^roblox-player:1\+launchmode:play\+gameinfo:TICKET123\+launchtime:5\+placelauncherurl:/);
  const pl = decodeURIComponent(uri.match(/placelauncherurl:([^+]+)/)[1]);
  assert.match(pl, /request=RequestGame&/);
  assert.match(pl, /placeId=42/);
  const job = r.placeLauncherUrl({ placeId: '42', jobId: 'J', browserTrackerId: '1' });
  assert.match(job, /request=RequestGameJob&gameId=J/);
  const args = r.buildPlayerArgs({ ticket: 'T', target: { placeId: '42' } });
  assert.deepEqual(args.slice(0, 3), ['--app', '-t', 'T']);
});

test('logger: redact removes cookies, webhook tokens and tickets', () => {
  const { redact } = require('../src/main/logger');
  const out = redact(`cookie ${FAKE_COOKIE} hook https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz ticket -t ABCDEFGHIJKLMNOPQRSTUVWXYZ0123`);
  assert.ok(!out.includes('DO-NOT-SHARE'));
  assert.ok(!out.includes('abcdefghijklmnopqrstuvwxyz'));
  assert.ok(!out.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123'));
});

test('store: atomic save and corrupt-file recovery', () => {
  const { JsonStore } = require('../src/main/store');
  const f = path.join(tmp, 'store-test.json');
  const s = new JsonStore(f, { a: 1, nested: { b: 2 } });
  s.set('nested.b', 5); s.saveNow();
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).nested.b, 5);
  fs.writeFileSync(f, '{not json');
  const s2 = new JsonStore(f, { a: 1 });
  assert.equal(s2.get('a'), 1);
  assert.ok(fs.readdirSync(tmp).some(n => n.startsWith('store-test.json.corrupt-')));
});

test('settings: sanitize keeps known keys with correct types only', () => {
  const clean = settings.sanitize(settings.DEFAULTS, {
    appearance: { accentHue: 300, particles: 'yes', evil: 1 },
    hotkeys: { clickerToggle: 'F7' },
    __proto__: { polluted: true },
    unknown: { x: 1 },
  });
  assert.equal(clean.appearance.accentHue, 300);
  assert.equal(clean.appearance.particles, undefined);
  assert.equal(clean.appearance.evil, undefined);
  assert.equal(clean.hotkeys.clickerToggle, 'F7');
  assert.equal(clean.unknown, undefined);
  assert.equal({}.polluted, undefined);
});

test('secure: secrets round-trip and are not stored in plain text', () => {
  const secure = require('../src/main/secure');
  const enc = secure.encrypt('hunter2');
  assert.match(enc, /^enc:v1:/);
  assert.ok(!enc.includes('hunter2'));
  assert.equal(secure.decrypt(enc), 'hunter2');
});

test('accounts: bulk import file parsing validates entries', () => {
  require('../src/main/modules/accounts').init();
  const { parseImportFile } = require('../src/main/modules/accounts');
  assert.equal(parseImportFile(`${FAKE_COOKIE}\nnot-a-cookie\n${FAKE_COOKIE}`).length, 2);
  const j = parseImportFile(JSON.stringify([{ cookie: FAKE_COOKIE, alias: 'A', group: 'G' }, { nope: 1 }]));
  assert.equal(j.length, 1);
  assert.equal(j[0].alias, 'A');
  assert.throws(() => parseImportFile('garbage'), /No valid cookies/);
});

test('accounts: renderer view never contains secrets', () => {
  const accounts = require('../src/main/modules/accounts');
  const v = accounts.publicView({ id: 'x', username: 'u', cookieEnc: 'enc:v1:SECRET', passwordEnc: 'enc:v1:PW' });
  assert.equal(JSON.stringify(v).includes('enc:v1'), false);
  assert.equal(v.hasPassword, true);
});

test('creator: generated usernames and passwords follow Roblox rules', async () => {
  const c = require('../src/main/modules/creator');
  for (let i = 0; i < 500; i++) {
    const u = c.generateUsername();
    assert.ok(c.isValidUsername(u), u);
    const p = c.generatePassword();
    assert.equal(p.length, 18);
    assert.match(p, /[A-Z]/); assert.match(p, /[a-z]/); assert.match(p, /[0-9]/); assert.match(p, /[^A-Za-z0-9]/);
  }
  assert.ok(!c.isValidUsername('_bad')); assert.ok(!c.isValidUsername('a_b_c')); assert.ok(!c.isValidUsername('ab'));
  const r = await c.checkUsername('a__b');
  assert.equal(r.valid, false);
});

test('updater: semver comparison, checksum parsing and release picking', () => {
  const u = require('../src/main/modules/updater');
  assert.equal(u.compareVer('2.0.0', '1.9.9'), 1);
  assert.equal(u.compareVer('v1.0.0', '1.0.0'), 0);
  assert.equal(u.compareVer('1.0.0-beta.2', '1.0.0'), -1);
  assert.equal(u.compareVer('1.0.0-beta.10', '1.0.0-beta.2'), 1);
  const sums = u.parseSums('a'.repeat(64) + '  MultiMenu-Setup.exe\n' + 'B'.repeat(64) + ' *MultiMenu-Portable.zip\n');
  assert.equal(sums['MultiMenu-Setup.exe'], 'a'.repeat(64));
  assert.equal(sums['MultiMenu-Portable.zip'], 'b'.repeat(64));
  const rels = [
    { tag_name: 'v1.2.0', prerelease: false, draft: false },
    { tag_name: 'v1.3.0-beta.1', prerelease: true, draft: false },
    { tag_name: 'v9.0.0', prerelease: false, draft: true },
    { tag_name: 'nonsense', prerelease: false, draft: false },
  ];
  assert.equal(u.pickRelease(rels, 'stable').tag_name, 'v1.2.0');
  assert.equal(u.pickRelease(rels, 'beta').tag_name, 'v1.3.0-beta.1');
});

test('updater: reports unconfigured when no repository is set', async () => {
  const pkg = require('../package.json');
  const saved = pkg.multimenu.updateRepo;
  pkg.multimenu.updateRepo = 'YOUR_GITHUB_USERNAME/MultiMenu';
  try {
    const u = require('../src/main/modules/updater');
    const s = await u.check();
    assert.equal(s.status, 'unconfigured');
  } finally { pkg.multimenu.updateRepo = saved; }
});

test('webhooks: URL validation and embed contains no secrets', () => {
  const w = require('../src/main/modules/webhooks');
  w.init();
  assert.ok(w.isValidUrl('https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEF'));
  assert.ok(!w.isValidUrl('https://evil.com/api/webhooks/123456789012345678/abc'));
  assert.ok(!w.isValidUrl('http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz'));
  const e = w.buildEmbed({ type: 'launchFailed', account: 'Main', error: `boom ${FAKE_COOKIE}` }, '1.0.0');
  assert.equal(e.color, 0xef4444);
  assert.ok(!JSON.stringify(e).includes('DO-NOT-SHARE'));
  assert.ok(e.fields.some(f => f.name === 'Account' && f.value === 'Main'));
  assert.ok(e.timestamp);
});

test('webhooks: stored URL is encrypted and listed masked', () => {
  const w = require('../src/main/modules/webhooks');
  const list = w.addHook('Test', 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyzABCDEF');
  assert.equal(list.length, 1);
  assert.ok(!JSON.stringify(list).includes('abcdefghijklmnop'));
  assert.throws(() => w.addHook('x', 'https://example.com'), /not a Discord webhook/);
});

test('webhooks: disabled notifications are not sent', async () => {
  const w = require('../src/main/modules/webhooks');
  settings.set('discord.enabled', false);
  const r = await w.send({ type: 'accountLaunched', account: 'A' }, { version: '1' });
  assert.equal(r.sent, false);
});

test('macros: validation rejects bad events and normalises good ones', () => {
  const m = require('../src/main/modules/macros');
  const v = m.validateMacro({ name: 'x', events: [{ t: 20, type: 'kup', vk: 65 }, { t: 10.4, type: 'kdown', vk: 65 }, { t: 30, type: 'mdown', button: 'left', x: 1, y: 2 }] });
  assert.deepEqual(v.events.map(e => e.t), [10, 20, 30]);
  assert.throws(() => m.validateMacro({ name: 'x', events: [{ t: 1, type: 'exec', cmd: 'calc' }] }), /invalid event/);
  assert.throws(() => m.validateMacro({ name: 'x', events: [{ t: 1, type: 'kdown', vk: 999 }] }), /Invalid key/);
  assert.throws(() => m.validateMacro({ name: 'x', events: [{ t: 1, type: 'mdown', button: 'x', x: 1, y: 1 }] }), /Unknown mouse/);
});

test('macros: save, list, rename, export/import, delete', () => {
  const m = require('../src/main/modules/macros');
  const saved = m.saveMacro({ name: 'Test macro', events: [{ t: 0, type: 'kdown', vk: 87 }, { t: 100, type: 'kup', vk: 87 }] });
  assert.ok(m.list().some(x => x.id === saved.id));
  m.rename(saved.id, 'Renamed');
  assert.equal(m.get(saved.id).name, 'Renamed');
  assert.equal(m.get(saved.id).events[0].key, 'W');
  const imported = m.importText(m.exportText(saved.id));
  assert.equal(m.get(imported.id).events.length, 2);
  m.remove(saved.id); m.remove(imported.id);
  assert.ok(!m.list().some(x => x.id === saved.id));
  assert.throws(() => m.importText('{bad'), /not valid JSON/);
});

test('ram trimmer: critical Windows processes are always protected', () => {
  const t = require('../src/main/modules/ramtrimmer');
  for (const n of ['csrss.exe', 'LSASS.EXE', 'svchost.exe', 'System', 'dwm.exe', 'MsMpEng.exe', 'winlogon.exe']) assert.ok(t.isProtected(n), n);
  assert.ok(!t.isProtected('RobloxPlayerBeta.exe'));
});

test('hotkeys: accelerator validation', () => {
  const { VALID } = require('../src/main/modules/hotkeys');
  for (const k of ['F6', 'Ctrl+Shift+K', 'Alt+F2', 'F24', 'Shift+1']) assert.ok(VALID.test(k), k);
  for (const k of ['', 'Ctrl+', 'F25', 'rm -rf', 'Ctrl+Shift+Alt+Ctrl+A']) assert.ok(!VALID.test(k), k);
});

test('clicker: settings validation', () => {
  const c = require('../src/main/modules/clicker');
  assert.throws(() => c.validate({ button: 'left', intervalMs: 1, mode: 'continuous' }), /Interval/);
  assert.throws(() => c.validate({ button: 'x', intervalMs: 100 }), /left, right or middle/);
  c.validate({ button: 'right', intervalMs: 50, mode: 'count', count: 10 });
});

test('fps: edits Roblox settings file with backup, rejects bad values', () => {
  const dir = path.join(tmp, 'LocalAppData', 'Roblox');
  fs.mkdirSync(dir, { recursive: true });
  process.env.LOCALAPPDATA = path.join(tmp, 'LocalAppData');
  const file = path.join(dir, 'GlobalBasicSettings_13.xml');
  fs.writeFileSync(file, '<roblox><Item class="UserGameSettings"><Properties>\n<token name="SavedQualityLevel">5</token>\n</Properties></Item></roblox>');
  const fps = require('../src/main/modules/fps');
  let g = fps.readGraphics();
  assert.equal(g.available, true); assert.equal(g.quality, 5); assert.equal(g.fpsCap, null);
  g = fps.writeGraphics({ fpsCap: 60, quality: 1 });
  assert.equal(g.fpsCap, 60); assert.equal(g.quality, 1);
  g = fps.writeGraphics({ fpsCap: -1 });
  assert.equal(g.fpsCap, -1);
  assert.throws(() => fps.writeGraphics({ fpsCap: 9999 }), /5–360/);
  assert.throws(() => fps.writeGraphics({ quality: 11 }), /Quality/);
  assert.ok(fs.readdirSync(paths.backupsDir()).some(f => f.startsWith('GlobalBasicSettings_13.xml.')));
});

test('ipc: setting validation rejects unknown keys, wrong types and duplicate hotkeys', () => {
  const ipc = require('../src/main/ipc');
  assert.throws(() => ipc.setSetting('nope.key', 1), /Unknown setting/);
  assert.throws(() => ipc.setSetting('clicker.intervalMs', 'fast'), /expects a number/);
  assert.throws(() => ipc.setSetting('hotkeys.clickerToggle', 'F8'), /already used/);
  assert.throws(() => ipc.setSetting('hotkeys.clickerToggle', 'nonsense key'), /Use a key like/);
  assert.equal(ipc.setSetting('clicker.intervalMs', 250).value, 250);
  assert.deepEqual(ipc.setSetting('ramTrimmer.targets', [' a.exe ', '', 'b.exe']).value, ['a.exe', 'b.exe']);
});



test('tiler: layouts fill the work area without overlap', () => {
  const t = require('../src/main/modules/tiler');
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const overlap = (a, b) => a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01 && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01;
  for (const layout of ['auto', 'columns', 'rows', 'grid2', 'grid3', 'grid4', 'main', 'fixed']) {
    for (const n of [1, 2, 3, 4, 5, 6, 9]) {
      const cap = { grid2: 4, grid3: 9, grid4: 16 }[layout] || 99;
      const r = t.computeLayout(layout, n, area, { gap: 6, cellWidth: 640, cellHeight: 360 });
      assert.equal(r.length, n, `${layout} n=${n}`);
      for (const q of r) {
        assert.ok(q.x >= 0 && q.y >= 0 && q.width > 0 && q.height > 0, `${layout} n=${n} positive`);
        if (n <= cap && layout !== 'fixed') assert.ok(q.x + q.width <= 1920.01 && q.y + q.height <= 1040.01, `${layout} n=${n} inside`);
      }
      if (n <= Math.min(cap, layout === 'fixed' ? 4 : 99)) for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) assert.ok(!overlap(r[i], r[j]), `${layout} n=${n} overlap ${i},${j}`);
    }
  }
});

test('tiler: smart grid picks sensible shapes and honours gap/padding', () => {
  const t = require('../src/main/modules/tiler');
  const area = { x: 100, y: 50, width: 1920, height: 1080 };
  assert.deepEqual([t.bestGrid(4, area).cols, t.bestGrid(4, area).rows], [2, 2]);
  assert.equal(t.bestGrid(2, area).cols, 2);
  const r = t.computeLayout('columns', 2, area, { gap: 10, padding: 20 });
  assert.equal(r[0].x, 120); assert.equal(r[0].y, 70);
  assert.equal(r[1].x - (r[0].x + r[0].width), 10);
  const m = t.computeLayout('main', 3, area, { gap: 0, mainRatio: 0.6 });
  assert.equal(Math.round(m[0].width), 1152);
  assert.equal(m[1].height, 540);
  const c = t.computeLayout('grid2', 3, area, { gap: 0 });
  assert.equal(c[2].x, 100 + 480, 'last row centred');
});

test('roblox: follow-user launch URL', () => {
  const r = require('../src/main/modules/roblox');
  const u = r.placeLauncherUrl({ followUserId: '123', browserTrackerId: '1' });
  assert.match(u, /request=RequestFollowUser&userId=123/);
  assert.doesNotMatch(u, /placeId=/);
});

test('sessions: sanitizeTarget only accepts safe fields', () => {
  const { sanitizeTarget } = require('../src/main/modules/sessions');
  assert.deepEqual(sanitizeTarget({ placeId: 5, jobId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', evil: 'x' }), { placeId: '5', jobId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  assert.equal(sanitizeTarget({ jobId: 'not-a-guid' }), null);
  assert.equal(sanitizeTarget({ placeId: '1; rm' }), null);
  assert.deepEqual(sanitizeTarget({ followUserId: 42 }), { followUserId: '42' });
});

test('watcher: quiet hours (incl. across midnight) and back-off', () => {
  const w = require('../src/main/modules/watcher');
  const at = (h, m) => { const d = new Date(2026, 0, 5, h, m); return d; };
  settings.set('schedule.quietHours', { enabled: true, start: '23:00', end: '07:00' });
  assert.equal(w.isQuiet(at(23, 30)), true); assert.equal(w.isQuiet(at(3, 0)), true); assert.equal(w.isQuiet(at(7, 0)), false); assert.equal(w.isQuiet(at(12, 0)), false);
  settings.set('schedule.quietHours', { enabled: true, start: '09:00', end: '17:00' });
  assert.equal(w.isQuiet(at(10, 0)), true); assert.equal(w.isQuiet(at(18, 0)), false);
  settings.set('schedule.quietHours', { enabled: false, start: '09:00', end: '17:00' });
  assert.equal(w.isQuiet(at(10, 0)), false);
  const c = { baseDelaySec: 10, maxDelaySec: 600 };
  assert.deepEqual([0, 1, 2, 3, 10].map(n => w.backoffMs(n, c)), [10000, 20000, 40000, 80000, 600000]);
});

test('roblox logs: join, teleport and disconnect parsing', () => {
  const logs = require('../src/main/modules/robloxlogs');
  const st = {};
  const ev = logs.parseLines([
    "2026-11-11T10:00:00Z,0.1,abc,6 [FLog::Output] ! Joining game 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' place 920587237 at 10.0.0.1",
    '2026-11-11T10:00:02Z,0.1,abc,6 [FLog::Network] serverId: 10.0.0.1|1234',
    '2026-11-11T10:30:00Z,0.1,abc,6 [FLog::Network] Time to disconnect replication data: 0.01',
  ], st);
  assert.deepEqual(ev.map(e => e.type), ['join', 'joined', 'disconnect']);
  assert.equal(ev[0].jobId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(ev[0].placeId, '920587237');
  const ev2 = logs.parseLines(['[FLog::SingleSurfaceApp] initiateTeleport', '[FLog::Network] Time to disconnect replication data'], {});
  assert.deepEqual(ev2.map(e => e.type), ['teleport', 'teleportLeft'], 'leaving the old server for a teleport is not a disconnect');
  // A teleport line with no leave after it (game output, a failed teleport) is only a 'teleport'.
  const ev3 = logs.parseLines(['[FLog::Output] initiateTeleport hatch effect', '[FLog::Output] Hatched 3 eggs'], {});
  assert.deepEqual(ev3.map(e => e.type), ['teleport']);
});

test('roblox logs: matches a session to its log and reads incrementally', () => {
  const dir = path.join(tmp, 'LocalAppData', 'Roblox', 'logs');
  fs.mkdirSync(dir, { recursive: true });
  process.env.LOCALAPPDATA = path.join(tmp, 'LocalAppData');
  const logs = require('../src/main/modules/robloxlogs');
  const started = Date.now();
  const stamp = new Date(started).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); // Roblox names logs by their start time
  const f = path.join(dir, `0.650.0.123_${stamp}_Player_ABCDE_last.log`);
  fs.writeFileSync(path.join(dir, '0.650.0.123_20200101T100000Z_Player_OLD00_last.log'), 'an old log, never opened\n');
  fs.writeFileSync(f, "[FLog::Output] ! Joining game 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' place 1 at 1.1.1.1\n");
  assert.equal(logs.findLogFor(started), f);
  assert.equal(logs.findLogFor(started), null, 'a log is only claimed once');
  const state = {};
  assert.equal(logs.readNew(f, state).events[0].type, 'join');
  assert.equal(logs.readNew(f, state).events.length, 0, 'nothing new');
  fs.appendFileSync(f, 'partial line without newline');
  assert.equal(logs.readNew(f, state).lines.length, 0, 'waits for complete lines');
  fs.appendFileSync(f, ' [FLog::Network] Time to disconnect replication data\n');
  assert.equal(logs.readNew(f, state).events[0].type, 'disconnect');
  fs.appendFileSync(f, 'ticket -t ' + 'Z'.repeat(300) + '\n');
  assert.ok(!logs.tail(f).join('\n').includes('Z'.repeat(200)), 'viewer redacts long tokens');
});

test('scheduler: daily/every due logic, next run and validation', () => {
  const sch = require('../src/main/modules/scheduler');
  const t = { enabled: true, kind: 'daily', time: '07:30', days: [1, 2, 3, 4, 5], lastRunAt: null };
  const mon730 = new Date(2026, 10, 9, 7, 30); // Monday
  assert.equal(mon730.getDay(), 1);
  assert.equal(sch.isDue(t, mon730), true);
  assert.equal(sch.isDue({ ...t, lastRunAt: mon730.getTime() - 10_000 }, mon730), false, 'only once per minute');
  assert.equal(sch.isDue(t, new Date(2026, 10, 8, 7, 30)), false, 'Sunday not selected');
  assert.equal(new Date(sch.nextRun(t, new Date(2026, 10, 8, 12, 0))).getDay(), 1);
  const every = { enabled: true, kind: 'every', everyHours: 2, createdAt: Date.now() - 3 * 3600_000, lastRunAt: null };
  assert.equal(sch.isDue(every), true);
  assert.equal(sch.isDue({ ...every, lastRunAt: Date.now() - 600_000 }), false);
  assert.throws(() => sch.validate({ action: 'closeAll', kind: 'daily', time: '25:00', days: [1] }), /time like/);
  assert.throws(() => sch.validate({ action: 'closeAll', kind: 'daily', time: '07:00', days: [] }), /at least one day/);
  assert.throws(() => sch.validate({ action: 'nuke' }), /Choose what/);
  assert.equal(sch.validate({ action: 'restartAll', kind: 'every', everyHours: 6 }).everyHours, 6);
});

test('limiter: affinity masks', () => {
  const l = require('../src/main/modules/limiter');
  assert.equal(l.backgroundMask(2, 8), 0b11000000);
  assert.equal(l.backgroundMask(99, 4), 0b1111);
  assert.equal(l.backgroundMask(0, 4), 0b1000);
  assert.equal(l.fullMask(6), 0b111111);
});

test('backup: AES-GCM vault round-trip, wrong password and tamper detection', () => {
  const b = require('../src/main/modules/backup');
  const text = b.encryptJson({ accounts: [{ username: 'x', cookie: 'SECRET' }] }, 'correct horse');
  assert.ok(!text.includes('SECRET'));
  assert.equal(b.decryptJson(text, 'correct horse').accounts[0].cookie, 'SECRET');
  assert.throws(() => b.decryptJson(text, 'wrong password'), /Wrong password/);
  const j = JSON.parse(text); j.data = Buffer.from('tampered').toString('base64');
  assert.throws(() => b.decryptJson(JSON.stringify(j), 'correct horse'), /Wrong password|damaged/);
  assert.throws(() => b.encryptJson({}, 'short'), /at least 8/);
  assert.throws(() => b.decryptJson('{"format":"other"}', 'x'), /not a MultiMenu backup/);
});

test('presets: validation', () => {
  const presets = require('../src/main/modules/presets');
  presets.init();
  assert.throws(() => presets.validate({ name: '', accountIds: [] }), /name/);
  assert.throws(() => presets.validate({ name: 'x', accountIds: ['nope'] }), /at least one account/);
});


test('remote: only allow-listed Discord users can run commands', async () => {
  const remote = require('../src/main/modules/remote');
  remote.init();
  settings.set('remote.allowedUserIds', ['111111111111111111']);
  assert.equal(remote.allowed('111111111111111111'), true);
  assert.equal(remote.allowed('222222222222222222'), false);
  const sent = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({}) }; };
  try {
    await remote.handleInteraction({ id: '1', token: 't', type: 2, data: { name: 'mm', options: [{ name: 'close', options: [{ name: 'account', value: 'all' }] }] }, member: { user: { id: '222222222222222222', username: 'stranger' } } });
    assert.equal(sent.length, 1);
    assert.match(sent[0].body.data.content, /not allowed/);
    assert.equal(sent[0].body.data.flags, 64, 'refusal is private');
  } finally { global.fetch = realFetch; }
  assert.throws(() => remote.setToken('not a token'), /bot token/);
  const names = remote.COMMANDS[0].options.map(o => o.name);
  assert.deepEqual(names, ['status', 'panel', 'live', 'start', 'stop', 'launch', 'rejoin', 'close', 'screenshot', 'screenshots', 'tile', 'hatches', 'watcher']);
});

test('report: daily summary text and Robux change', () => {
  const r = require('../src/main/modules/report');
  const out = r.build(
    { days: [{ day: 'x', uptimeMs: 36e6, crashes: 1, disconnects: 2, freezes: 0, rejoins: 3, launches: 4 }], accounts: { a: { label: 'Main', uptimeMs: 36e6, crashes: 1, disconnects: 2, freezes: 0, rejoins: 3 } } },
    [{ id: 'a', robux: 1500 }], { a: 1000 });
  assert.match(out.description, /\*\*Main\*\* — 10\.0h up · 3 issues · 3 rejoins · R\$ 1,500 \(\+500\)/);
  assert.equal(out.fields[1].value, '3 (1 crash · 2 disconnect · 0 freeze)');
});

test('webhooks: embeds support descriptions and extra fields without secrets', () => {
  const w = require('../src/main/modules/webhooks');
  const e = w.buildEmbed({ type: 'dailyReport', description: `report ${FAKE_COOKIE}` }, '1');
  assert.ok(e.description.startsWith('report'));
  assert.ok(!e.description.includes('DO-NOT-SHARE'));
});


test('error codes: plain-English meanings and watcher actions', () => {
  const ec = require('../src/main/modules/errorcodes');
  assert.equal(ec.describe(277), 'Error 277 — Lost connection to the game server');
  assert.equal(ec.lookup(264).action, 'stop', 'logged in elsewhere must not loop');
  assert.equal(ec.lookup(273).action, 'stop');
  assert.equal(ec.lookup(274).action, 'newServer');
  assert.equal(ec.lookup(267).action, 'slow');
  assert.equal(ec.lookup(99999).action, 'rejoin', 'unknown codes still rejoin');
  assert.equal(ec.lookup(null), null);
  assert.ok(ec.all().length >= 25);
});

test('memory guard: leak slope, hard limit, warm-up', () => {
  const mg = require('../src/main/modules/memguard');
  const cfg = { maxMB: 3000, leakMBPerHour: 400, minUptimeMin: 45 };
  const now = 10 * 3600_000;
  const series = (start, perHour, n = 60) => Array.from({ length: n }, (_, i) => ({ t: now - (n - 1 - i) * 60_000, mb: Math.round(start + perHour * (i / 60)) }));
  assert.ok(Math.abs(mg.slopeMBh(series(1000, 600)) - 600) < 15);
  assert.equal(mg.evaluate(series(1000, 600), now, cfg, 3 * 3600_000).restart, true, 'leaking 600 MB/h');
  assert.match(mg.evaluate(series(1000, 600), now, cfg, 3 * 3600_000).reason, /leak/);
  assert.equal(mg.evaluate(series(1200, 20), now, cfg, 3 * 3600_000).restart, false, 'stable client');
  assert.equal(mg.evaluate(series(3100, 0), now, cfg, 3 * 3600_000).restart, true, 'over hard limit');
  assert.equal(mg.evaluate(series(3100, 0), now, cfg, 10 * 60_000).restart, false, 'still warming up');
  assert.equal(mg.evaluate(series(1000, 600, 10), now, cfg, 3 * 3600_000).restart, false, 'needs 20+ samples for a trend');
});

test('friend alts: pairs, existing requests and CAPTCHA pause', async () => {
  const avatars = require('../src/main/modules/avatars');
  const accounts = require('../src/main/modules/accounts');
  const roblox = require('../src/main/modules/roblox');
  const accs = { a: { id: 'a', userId: 1, username: 'A', status: 'valid' }, b: { id: 'b', userId: 2, username: 'B', status: 'valid' }, c: { id: 'c', userId: 3, username: 'C', status: 'valid' } };
  const saved = { find: accounts.find, getCookie: accounts.getCookie, st: roblox.getFriendStatuses, send: roblox.sendFriendRequest, acc: roblox.acceptFriendRequest };
  const calls = [];
  accounts.find = (id) => accs[id]; accounts.getCookie = (id) => `cookie-${id}`;
  roblox.getFriendStatuses = async (uid, [other]) => ({ [other]: uid === 1 && other === 2 ? 'Friends' : uid === 1 && other === 3 ? 'RequestReceived' : 'NotFriends' });
  roblox.acceptFriendRequest = async (req, cookie) => { calls.push(`accept ${req} by ${cookie}`); return true; };
  roblox.sendFriendRequest = async (target, cookie) => { calls.push(`send ${target} by ${cookie}`); const e = new Error('cap'); e.code = 'CHALLENGE'; throw e; };
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => realSetTimeout(fn, 0);
  try {
    const r = await avatars.friendAlts(['a', 'b', 'c']);
    assert.deepEqual(r.results.map(x => x.state), ['already', 'done', 'captcha']);
    assert.ok(calls.includes('accept 3 by cookie-a'));
    assert.match(r.results[2].detail, /CAPTCHA/);
    await assert.rejects(avatars.friendAlts(['a']), /at least two/);
  } finally {
    global.setTimeout = realSetTimeout;
    Object.assign(accounts, { find: saved.find, getCookie: saved.getCookie });
    Object.assign(roblox, { getFriendStatuses: saved.st, sendFriendRequest: saved.send, acceptFriendRequest: saved.acc });
  }
});


test('resume: snapshot keeps account, exact server and watch flag', () => {
  const r = require('../src/main/modules/resume');
  const list = [
    { id: '1', status: 'running', accountId: 'a', label: 'Main', watch: true, placeName: 'Adopt Me!' },
    { id: '2', status: 'running', accountId: 'b', label: 'Priv', watch: false },
    { id: '3', status: 'running', external: true },
    { id: '4', status: 'failed', accountId: 'c' },
  ];
  const raw = { 1: { target: { placeId: '5' }, jobId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, 2: { target: { placeId: '6', linkCode: 'XYZ' }, jobId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee' } };
  const snap = r.snapshotFrom(list, id => raw[id]);
  assert.equal(snap.length, 2);
  assert.deepEqual(snap[0], { accountId: 'a', label: 'Main', watch: true, target: { placeId: '5', jobId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, placeName: 'Adopt Me!' });
  assert.equal(snap[1].target.jobId, undefined, 'private servers rejoin by link, not job id');
});

test('follow: decisions for each follower state', () => {
  const { decide } = require('../src/main/modules/follow');
  const loc = { jobId: 'J1', placeId: '5' }, now = 1_000_000;
  assert.equal(decide(null, null, now).action, 'wait');
  assert.equal(decide(null, loc, now).action, 'launch');
  assert.equal(decide({ status: 'launching' }, loc, now).action, 'wait');
  assert.equal(decide({ status: 'running', jobId: 'J1', startedAt: 0 }, loc, now).action, 'none');
  assert.equal(decide({ status: 'running', jobId: 'J2', startedAt: 0 }, loc, now).action, 'move');
  assert.equal(decide({ status: 'running', jobId: null, startedAt: now - 30_000 }, loc, now).action, 'wait', 'give a fresh client time to join');
  assert.equal(decide({ status: 'running', jobId: 'J2', startedAt: 0 }, loc, now, now - 10_000).action, 'wait', 'no ping-pong');
});

test('auto backup: keeps only the newest N automatic backups', () => {
  const ab = require('../src/main/modules/autobackup');
  const dir = path.join(tmp, 'ab'); fs.mkdirSync(dir, { recursive: true });
  for (const d of ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']) fs.writeFileSync(path.join(dir, `MultiMenu-auto-${d}.mmvault`), 'x');
  fs.writeFileSync(path.join(dir, 'my-own-file.txt'), 'keep me');
  const removed = ab.prune(dir, 2);
  assert.deepEqual(removed, ['MultiMenu-auto-2026-11-01.mmvault', 'MultiMenu-auto-2026-11-02.mmvault']);
  assert.ok(fs.existsSync(path.join(dir, 'my-own-file.txt')), 'never touches other files');
});

test('stats: totals, streaks, heatmap, stability and Wrapped', () => {
  const st = require('../src/main/modules/stats');
  const H = 3600000;
  const mk = (h, extra = {}) => ({ uptimeMs: h * H, launches: 1, crashes: 0, disconnects: 0, freezes: 0, rejoins: 0, memRestarts: 0, ...extra });
  const data = {
    labels: { a: 'Main', b: 'Alt' },
    days: {
      '2026-11-07': { a: mk(5) },
      '2026-11-09': { a: mk(10), b: mk(2, { disconnects: 3, rejoins: 3 }) },
      '2026-11-10': { a: mk(13) },
      '2026-11-11': { a: mk(4), b: mk(6, { crashes: 1 }) },
      '2026-10-20': { a: mk(1) },
    },
    games: { '2026-11-09': { 'Adopt Me!': 10 * H }, '2026-11-11': { 'Adopt Me!': 4 * H, 'Pet Sim': 6 * H } },
  };
  const o = st.compute(data, '2026-11-11');
  assert.equal(o.totals.hours, 41);
  assert.equal(o.totals.problems, 4);
  assert.deepEqual(o.streak, { current: 3, longest: 3 });
  assert.equal(o.heat.length, 182);
  assert.equal(o.heat.at(-1).day, '2026-11-11');
  assert.equal(o.heat.at(-1).hours, 10);
  assert.equal(o.accounts[0].label, 'Main');
  assert.equal(o.mostStable.label, 'Main', 'no problems wins');
  assert.equal(o.topGames[0].name, 'Adopt Me!');
  assert.equal(o.wrapped.month, '2026-11');
  assert.equal(o.wrapped.hours, 40);
  assert.equal(o.wrapped.topAccount.label, 'Main');
  assert.equal(o.wrapped.bestDay.day, '2026-11-10');
  assert.equal(o.lastMonth.month, '2026-10');
  assert.equal(o.lastMonth.hours, 1);
});

test.after(() => { setTimeout(() => process.exit(0), 50); });
