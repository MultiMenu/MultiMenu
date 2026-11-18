// 3.1: items & security, private servers, smart server picker, update guard, multi-monitor tiling,
// volume mixer, network monitor, fresh restarts, logs page, getting started checklist.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./helpers/electron-stub');
const settings = require('../src/main/modules/settings');
settings.init();
require('../src/main/modules/accounts').init();

// ---------- items & security ----------
const ac = require('../src/main/modules/accountcheck');

test('security check: everything on scores 100, missing 2-step and email make it weak', () => {
  const good = ac.summarizeSecurity({ twoStep: true, email: 'verified', phone: 'verified', pin: true });
  assert.equal(good.score, 100); assert.equal(good.grade, 'good'); assert.deepEqual(good.issues, []);
  const weak = ac.summarizeSecurity({ twoStep: false, email: 'none', phone: 'none', pin: false });
  assert.equal(weak.grade, 'weak');
  assert.deepEqual(weak.issues.map(i => i.id), ['twoStep', 'email', 'phone', 'pin']);
  assert.equal(ac.summarizeSecurity({ twoStep: null, email: null, phone: null, pin: null }).grade, 'unknown');
  assert.equal(ac.summarizeSecurity({ twoStep: true, email: 'unverified', phone: 'verified', pin: true }).issues[0].level, 'medium');
});

test('wallet totals skip accounts that failed', () => {
  const t = ac.walletTotals({ a: { robux: 100, pending: 20, premium: true }, b: { robux: 50, pending: null, premium: false }, c: { error: 'x', robux: 999 } });
  assert.deepEqual(t, { robux: 150, pending: 20, incoming: 0, premium: 1, counted: 2 });
});

test('limited items: value falls back to RAP and the most valuable come first', () => {
  const r = ac.valueItems([
    { assetId: 1, name: 'Cheap', recentAveragePrice: 100 },
    { assetId: 2, name: 'Valued', recentAveragePrice: 500 },
    { assetId: 3, name: 'Big RAP', recentAveragePrice: 900 },
  ], { 2: 5000 });
  assert.equal(r.count, 3); assert.equal(r.rap, 1500); assert.equal(r.value, 6000);
  assert.deepEqual(r.top.map(i => i.name), ['Valued', 'Big RAP', 'Cheap']);
  assert.equal(r.top[0].valued, true); assert.equal(r.top[1].valued, false);
});

test('mapLimit keeps order and never runs more than n at once', async () => {
  let live = 0, peak = 0;
  const out = await ac.mapLimit([5, 1, 3, 2], 2, async (x) => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, x)); live--; return x * 10; });
  assert.deepEqual(out, [50, 10, 30, 20]); assert.equal(peak, 2);
});

// ---------- private servers ----------
const ps = require('../src/main/modules/privateservers');

test('private servers: shape and which ones are running out', () => {
  const s = ps.shape({ privateServerId: 77, name: 'Grind', universeName: 'Pet Game', placeId: 123, active: true, willRenew: false, expirationDate: '2030-01-03T00:00:00Z', priceInRobux: 100 }, { id: 'a1', username: 'Owner1' });
  assert.equal(s.id, '77'); assert.equal(s.placeId, '123'); assert.equal(s.ownerLabel, 'Owner1'); assert.equal(s.expiresAt, Date.parse('2030-01-03T00:00:00Z'));
  const now = Date.parse('2030-01-01T00:00:00Z');
  const list = [s, { ...s, id: '78', willRenew: true }, { ...s, id: '79', expiresAt: now + 10 * 86400_000 }, { ...s, id: '80', active: false }];
  assert.deepEqual(ps.expiringSoon(list, now, 3).map(x => x.id), ['77']);
});

// ---------- smart server picker ----------
const sj = require('../src/main/modules/smartjoin');

test('smart picker: lowest ping, fewest players and distinct servers per group', () => {
  const servers = [
    { id: 'a', playing: 10, maxPlayers: 12, ping: 40 },
    { id: 'b', playing: 2, maxPlayers: 12, ping: 120 },
    { id: 'c', playing: 5, maxPlayers: 12, ping: null },
    { id: 'd', playing: 8, maxPlayers: 12, ping: 60 },
  ];
  assert.deepEqual(sj.rank(servers, 'ping').map(s => s.id), ['a', 'd', 'b', 'c']);
  assert.deepEqual(sj.rank(servers, 'fewest').map(s => s.id), ['b', 'c', 'd', 'a']);
  // a has 2 free slots: a group of 3 skips it
  assert.deepEqual(sj.assign(servers, [3, 3, 2], 'ping').map(s => s && s.id), ['d', 'b', 'a']);
  assert.deepEqual(sj.assign(servers, [12], 'ping'), [null]);
  assert.deepEqual(sj.groupsOf(['1', '2', '3', '4', '5'], 2), [['1', '2'], ['3', '4'], ['5']]);
});

// ---------- update guard ----------
const ug = require('../src/main/modules/updateguard');

test('update guard: up to date only when the latest version folder has a player', () => {
  assert.equal(ug.isUpToDate('version-abc123', ['version-abc123', 'version-old']), true);
  assert.equal(ug.isUpToDate('version-ABC123', ['version-abc123']), true);
  assert.equal(ug.isUpToDate('version-fff999', ['version-abc123']), false);
  assert.equal(ug.isUpToDate(null, ['version-abc123']), null);
  assert.equal(ug.isUpToDate('version-abc123', []), null); // nothing found: never hold launches back
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-ug-'));
  fs.mkdirSync(path.join(dir, 'version-aaa111')); fs.writeFileSync(path.join(dir, 'version-aaa111', 'RobloxPlayerBeta.exe'), '');
  fs.mkdirSync(path.join(dir, 'version-bbb222')); // still downloading: no player yet
  fs.mkdirSync(path.join(dir, 'not-a-version'));
  assert.deepEqual(ug.installedVersions([dir]), ['version-aaa111']);
});

test('update guard lets launches through when it is off', async () => {
  settings.set('updateGuard.enabled', false);
  assert.deepEqual(await ug.gate({ queued: 5 }), { forceProtocol: false });
  settings.set('updateGuard.enabled', true);
});

// ---------- multi-monitor tiling ----------
const tiler = require('../src/main/modules/tiler');

test('all monitors: windows are shared out by monitor size and always add up', () => {
  assert.deepEqual(tiler.splitCounts(10, [1, 1]), [5, 5]);
  assert.deepEqual(tiler.splitCounts(5, [1, 1]), [3, 2]);
  assert.deepEqual(tiler.splitCounts(9, [2, 1]), [6, 3]);
  assert.deepEqual(tiler.splitCounts(1, [1, 4]), [0, 1]);
  for (let n = 0; n < 30; n++) assert.equal(tiler.splitCounts(n, [3, 2, 7]).reduce((a, b) => a + b, 0), n);
});

// ---------- volume ----------
const vol = require('../src/main/modules/volume');

test('volume: an account\'s own level beats the all-alts level', () => {
  assert.equal(vol.levelFor('a', { all: 60, levels: { a: 20 } }), 20);
  assert.equal(vol.levelFor('b', { all: 60, levels: { a: 20 } }), 60);
  assert.equal(vol.levelFor('a', { all: 100, levels: { a: 0 } }), 0);
});

// ---------- network monitor ----------
const nm = require('../src/main/modules/netmon');

test('network monitor reads netstat in any language and survives counter wraps', () => {
  const en = 'Interface Statistics\r\n\r\n                           Received            Sent\r\n\r\nBytes                    1234567890      987654321\r\nUnicast packets             1000000         900000\r\n';
  assert.deepEqual(nm.parseNetstat(en), { rx: 1234567890, tx: 987654321 });
  const de = 'Schnittstellenstatistik\n\n                          Empfangen            Gesendet\n\nBytes                    55            66\n';
  assert.deepEqual(nm.parseNetstat(de), { rx: 55, tx: 66 });
  assert.equal(nm.parseNetstat('nothing here'), null);
  assert.equal(nm.delta(100, 250), 150);
  assert.equal(nm.delta(2 ** 32 - 100, 50), 150); // 32-bit wrap
  assert.equal(nm.delta(3_000_000_000, 10), 0); // adapter reset, not a wrap
});

test('network monitor: today and this month from the daily table', () => {
  const now = new Date(2026, 10, 15, 12).getTime();
  const days = { '2026-11-15': { down: 10, up: 1 }, '2026-11-02': { down: 5, up: 5 }, '2026-10-31': { down: 100, up: 100 } };
  assert.deepEqual(nm.periodUsage(days, 'day', now), { down: 10, up: 1 });
  assert.deepEqual(nm.periodUsage(days, 'month', now), { down: 15, up: 6 });
});

// ---------- fresh restarts ----------
const fr = require('../src/main/modules/freshrestart');

test('fresh restarts: oldest due alt first, one at a time, never Main or the window you use', () => {
  const now = 100 * 3600_000;
  const list = [
    { id: 'old', status: 'running', pid: 1, accountId: 'f1', startedAt: now - 9 * 3600_000 },
    { id: 'older', status: 'running', pid: 2, accountId: 'm1', startedAt: now - 12 * 3600_000 },
    { id: 'young', status: 'running', pid: 3, accountId: 'f2', startedAt: now - 1 * 3600_000 },
    { id: 'ext', status: 'running', pid: 4, accountId: 'f3', external: true, startedAt: 0 },
  ];
  const base = { now, everyHours: 6, gapMin: 10, lastAt: 0, skipMain: true, focusedPid: 0, busy: false, tierOf: (id) => (id === 'm1' ? 'main' : 'filler') };
  assert.equal(fr.pick(list, base).id, 'old');
  assert.equal(fr.pick(list, { ...base, skipMain: false }).id, 'older');
  assert.equal(fr.pick(list, { ...base, focusedPid: 1 }), null);
  assert.equal(fr.pick(list, { ...base, lastAt: now - 5 * 60_000 }), null); // gap not over yet
  assert.equal(fr.pick(list, { ...base, busy: true }), null); // launches are running
});

// ---------- logs ----------
const lb = require('../src/main/modules/logbrowser');

test('logs: lines are sorted into kinds and disconnect codes are explained', () => {
  assert.equal(lb.kindOf("2026 [FLog::Output] ! Joining game 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' place 1 at 1.2.3.4"), 'join');
  assert.equal(lb.kindOf('[FLog::Network] Sending disconnect with reason: 277'), 'disconnect');
  assert.equal(lb.kindOf('[FLog::Error] Something broke'), 'error');
  assert.equal(lb.kindOf('[FLog::Output] hello'), 'info');
  const w = lb.explain('[FLog::Network] Sending disconnect with reason: 277');
  assert.equal(w.code, 277); assert.match(w.title, /Lost connection/);
  assert.equal(lb.explain('no code here'), null);
});

// ---------- getting started ----------
const cl = require('../src/main/modules/checklist');

test('getting started checklist ticks each step from what you have done', () => {
  const none = cl.compute({ accounts: 0, presets: 0 });
  assert.equal(none.done, 0); assert.equal(none.complete, false); assert.equal(none.total, 7);
  const all = cl.compute({ accounts: 2, launched: true, tiled: true, perf: true, watcher: true, alerts: true, presets: 1 });
  assert.equal(all.complete, true);
  assert.deepEqual(cl.compute({ accounts: 1, presets: 0 }).steps.filter(s => s.done).map(s => s.id), ['account']);
});

// ---------- wiring ----------
test('every 3.1 command has a valid channel name and the UI may listen to its events', () => {
  const v31 = require('../src/main/v31');
  for (const ch of Object.keys(v31.handlers())) assert.match(ch, /^[a-z]+:[a-zA-Z0-9]+$/);
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload.js'), 'utf8');
  for (const ev of v31.EVENTS) assert.ok(preload.includes(`'${ev}'`), ev);
  const ipc = require('../src/main/ipc');
  const all = ipc.makeHandlers({ win: () => null });
  assert.ok(all['items:status'] && all['logs:search'] && all['volume:set']);
});

test('3.1 settings exist with safe defaults', () => {
  assert.equal(settings.get('freshRestart.enabled'), false); // restarts only when you turn them on
  assert.equal(settings.get('updateGuard.enabled'), true);
  assert.equal(settings.get('netmon.capGB'), 0);
  assert.equal(settings.get('volume.all'), 100);
  const ipc = require('../src/main/ipc');
  assert.equal(ipc.setSetting('freshRestart.everyHours', 999).value, 72);
  assert.throws(() => ipc.setSetting('netmon.period', 'week'));
});

test('saved games remember accounts; unknown accounts are dropped and an empty list forgets', async () => {
  const servers = require('../src/main/modules/servers');
  servers.init();
  const accounts = require('../src/main/modules/accounts');
  const real = (accounts.getAll().accounts || [])[0]?.id;
  const list = await servers.addGame({ name: 'Test game', link: '920587237' });
  const id = list[0].id;
  const after = servers.setGameAccounts(id, ['not-an-account', ...(real ? [real] : [])]);
  assert.deepEqual(after[0].accountIds || [], real ? [real] : []);
  assert.equal(servers.setGameAccounts(id, [])[0].accountIds, undefined);
  assert.throws(() => servers.setGameAccounts('gone', []), /gone/);
});
