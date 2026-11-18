// 3.0: Discord status, launch queue, custom layouts, window pinning, game search, account list export.
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./helpers/electron-stub');
const settings = require('../src/main/modules/settings');
settings.init();
require('../src/main/modules/accounts').init();

// ---------- Discord status ----------
const rp = require('../src/main/modules/richpresence');

test('Discord status: frames round-trip and the app ID is MultiMenu\'s', () => {
  const f = rp.decode(Buffer.concat([rp.encode(1, { a: 1 }), rp.encode(3, { b: 'ü' })]));
  assert.deepEqual(f, [{ op: 1, data: { a: 1 } }, { op: 3, data: { b: 'ü' } }]);
  assert.equal(rp.CLIENT_ID, '1570111240066568353');
});

test('Discord status shows counts and games, never account names, and respects the switches', () => {
  const list = [
    { status: 'running', label: 'SecretAlt1', placeName: 'Pet Simulator 99', startedAt: 1_000_000 },
    { status: 'running', label: 'SecretAlt2', placeName: 'Pet Simulator 99', startedAt: 2_000_000 },
    { status: 'closed', label: 'Old', placeName: 'Other' },
  ];
  const base = { showCount: true, showGame: true, showButton: true, onlyWhileRunning: true };
  const a = rp.activityFor(list, base);
  assert.equal(a.details, 'Running 2 alts');
  assert.equal(a.state, 'In Pet Simulator 99');
  assert.equal(a.timestamps.start, 1000);
  assert.equal(a.buttons[0].url, 'https://github.com/MultiMenu/MultiMenu');
  assert.ok(!JSON.stringify(a).includes('SecretAlt'));
  const quiet = rp.activityFor(list, { ...base, showCount: false, showGame: false, showButton: false });
  assert.equal(quiet.details, 'Running Roblox alts');
  assert.equal(quiet.state, undefined);
  assert.equal(quiet.buttons, undefined);
  assert.equal(rp.activityFor([{ status: 'running', placeName: 'A' }, { status: 'running', placeName: 'B' }], base).state, 'In 2 games');
  assert.equal(rp.activityFor([], base), null, 'nothing running: no status');
  assert.equal(rp.activityFor([], { ...base, onlyWhileRunning: false }).details, 'Getting ready');
  assert.equal(rp.activityFor([{ status: 'running', placeName: 'x'.repeat(300) }], base).state.length, 128);
});

test('Discord status: your own text with {count} and {game}, and the switches still apply', () => {
  const list = [{ status: 'running', label: 'SecretAlt1', placeName: 'Tap Sim', startedAt: 1 }, { status: 'running', label: 'SecretAlt2', placeName: 'Tap Sim', startedAt: 2 }];
  const base = { showCount: true, showGame: true, showButton: true, onlyWhileRunning: true };
  const a = rp.activityFor(list, { ...base, details: 'Idling', state: '{count} tabs in {game}' });
  assert.equal(a.details, 'Idling');
  assert.equal(a.state, '2 tabs in Tap Sim');
  const hidden = rp.activityFor(list, { ...base, showGame: false, state: 'In {game}' });
  assert.equal(hidden.state, 'In Roblox', 'the game stays hidden');
  assert.ok(!JSON.stringify(a).includes('SecretAlt'));
  assert.equal(a.buttons[0].label, 'Get MultiMenu');
});

test('Discord status is on by default and connects to the Discord app', async (t) => {
  assert.equal(settings.get('richPresence.enabled'), true, 'on unless you turn it off');
  assert.deepEqual(rp.status().enabled, true);
  if (process.platform === 'win32') return t.skip('uses a Unix socket as a stand-in for Discord');
  const sock = path.join(os.tmpdir(), `mm-discord-${process.pid}.sock`);
  try { fs.unlinkSync(sock); } catch { /* none */ }
  const got = [];
  const srv = net.createServer(c => c.on('data', (d) => {
    for (const f of rp.decode(d)) {
      got.push(f);
      if (f.op === 0) c.write(rp.encode(1, { cmd: 'DISPATCH', evt: 'READY', data: { user: { username: 'tester' } } }));
    }
  }));
  await new Promise(r => srv.listen(sock, r));
  try {
    rp._setPipe(() => sock);
    await rp._connect();
    await new Promise(r => setTimeout(r, 200));
    assert.deepEqual(got[0], { op: 0, data: { v: 1, client_id: '1570111240066568353' } });
    assert.equal(got[1].data.cmd, 'SET_ACTIVITY');
    assert.equal(got[1].data.args.activity, null, 'nothing running yet: nothing shown');
    assert.equal(rp.status().connected, true);
    assert.equal(rp.status().user, 'tester');
    rp.disconnect(); // MultiMenu closing
    await new Promise(r => setTimeout(r, 300));
    assert.equal(got.at(-1).data.args.activity, null);
  } finally { srv.close(); }
});

// ---------- launch queue ----------
test('launch queue: see the order, move one to the front, remove one, clear', () => {
  const sessions = require('../src/main/modules/sessions');
  sessions.launch('nope-1', '1', { label: 'First' });
  sessions.launch('nope-2', '1', { label: 'Second' });
  sessions.launch('nope-3', '1', { label: 'Third' });
  sessions.launch('nope-4', '1', { label: 'Fourth' });
  let v = sessions.queueView();
  assert.equal(v.current.label, 'First');
  assert.deepEqual(v.items.map(i => i.label), ['Second', 'Third', 'Fourth']);
  assert.ok(v.items[1].etaMs > v.items[0].etaMs, 'later ones have a later ETA');
  v = sessions.queueMove(v.items[2].qid, 0);
  assert.deepEqual(v.items.map(i => i.label), ['Fourth', 'Second', 'Third']);
  v = sessions.queueRemove(v.items[1].qid);
  assert.deepEqual(v.items.map(i => i.label), ['Fourth', 'Third']);
  assert.throws(() => sessions.queueMove('gone', 0), /already started or was removed/);
  const r = sessions.queueClear();
  assert.equal(r.removed, 2);
  assert.equal(r.items.length, 0);
});

test('the panic button empties the launch queue', () => {
  const sessions = require('../src/main/modules/sessions');
  sessions.launch('nope-5', '1', { label: 'A' });
  sessions.launch('nope-6', '1', { label: 'B' });
  assert.equal(sessions.queueView().items.length, 1);
  sessions.panic();
  assert.equal(sessions.queueView().items.length, 0);
});

// ---------- custom layouts ----------
const cl = require('../src/main/modules/customlayouts');

test('custom layouts: zones are checked and kept on screen', () => {
  const z = cl.cleanZones([{ x: -1, y: 0.5, w: 5, h: 0.2 }, { x: 'a' }, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }]);
  assert.deepEqual(z[0], { x: 0, y: 0.5, w: 1, h: 0.2 });
  assert.deepEqual(z[1], { x: 0.9, y: 0.9, w: 0.1, h: 0.1 });
  assert.equal(z.length, 2);
  assert.throws(() => cl.cleanZones([]), /at least one zone/);
  assert.equal(cl.cleanZones(new Array(60).fill({ x: 0, y: 0, w: 0.5, h: 0.5 })).length, 40);
});

test('custom layouts: windows fill zones in order, extra ones go round again offset', () => {
  const zones = [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }];
  const r = cl.rects(zones, 3, { x: 0, y: 0, width: 1000, height: 600 }, 0);
  assert.deepEqual(r[0], { x: 0, y: 0, width: 500, height: 600 });
  assert.deepEqual(r[1], { x: 500, y: 0, width: 500, height: 600 });
  assert.deepEqual(r[2], { x: 28, y: 28, width: 500, height: 600 });
  const tiler = require('../src/main/modules/tiler');
  assert.deepEqual(tiler.computeLayout('custom', 1, { x: 0, y: 0, width: 1000, height: 600 }, { gap: 0, customZones: zones })[0], { x: 0, y: 0, width: 500, height: 600 });
});

test('custom layouts: save, use in presets and game profiles, share as zones, delete', async () => {
  const l = cl.save({ name: 'Two big', zones: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] });
  const key = `custom:${l.id}`;
  assert.ok(cl.isKey(key));
  assert.equal(require('../src/main/modules/gameprofiles').validate({ placeId: '123', name: 'G', layout: key }).layout, key);
  assert.equal(require('../src/main/modules/gameprofiles').validate({ placeId: '123', name: 'G', layout: 'custom:nope' }).layout, '');
  settings.set('tiling.layout', key);
  const sc = require('../src/main/modules/sharecodes');
  const made = sc.create('layout', 'current');
  const data = JSON.stringify(sc.unpack(made.code));
  assert.ok(data.includes('"zones"') && !data.includes(l.id), 'shared as zones, not this PC\'s ID');
  cl.remove(l.id);
  assert.equal(settings.get('tiling.layout'), 'auto', 'removing the layout in use goes back to the smart grid');
  const imported = await sc.importCode(made.code);
  assert.equal(imported.kind, 'layout');
  assert.ok(settings.get('tiling.layout').startsWith('custom:'));
  assert.deepEqual(cl.fromKey(settings.get('tiling.layout')).zones, l.zones);
  settings.set('tiling.layout', 'auto');
});

// ---------- pinning ----------
test('pinned windows are remembered per account', () => {
  assert.deepEqual(settings.get('tiling.pinned'), []);
  assert.equal(settings.get('hotkeys.pinWindow'), '');
  const src = fs.readFileSync(require.resolve('../src/main/modules/tiler.js'), 'utf8');
  assert.match(src, /bus\.on\('session:joined'[\s\S]{0,200}repin/);
});

// ---------- game search ----------
const roblox = require('../src/main/modules/roblox');

test('game search: reads game IDs from Roblox\'s search, in order, without repeats', () => {
  const ids = roblox.universeIdsFromSearch({ searchResults: [
    { contentGroupType: 'Game', contents: [{ universeId: 111, name: 'A' }, { universeId: 222 }] },
    { contentGroupType: 'Other', contents: [{ contentType: 'Game', contentId: 333 }, { universeId: 111 }, { universeId: 'x' }] },
  ] });
  assert.deepEqual(ids, ['111', '222', '333']);
  assert.deepEqual(roblox.universeIdsFromSearch({}), []);
});

test('game search: details with players, likes and only Roblox-hosted icons', async () => {
  const orig = global.fetch;
  global.fetch = async (url) => {
    const json = (o) => ({ ok: true, status: 200, json: async () => o });
    if (url.includes('/v1/games?universeIds=')) return json({ data: [{ id: 111, rootPlaceId: 999, name: 'Pet Game', creator: { name: 'Studio', hasVerifiedBadge: true }, playing: 1234, visits: 5 }, { id: 222, rootPlaceId: 888, name: 'Obby', creator: { name: 'Bob' }, playing: 1 }] });
    if (url.includes('/votes')) return json({ data: [{ id: 111, upVotes: 90, downVotes: 10 }] });
    if (url.includes('thumbnails')) return json({ data: [{ targetId: 111, state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/abc/150/150/Image/Png' }, { targetId: 222, state: 'Completed', imageUrl: 'https://evil.example.com/x.png' }] });
    if (url.includes('omni-search')) return json({ searchResults: [{ contents: [{ universeId: 111 }, { universeId: 222 }] }], nextPageToken: 'p2' });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    const r = await roblox.searchGames('pet');
    assert.equal(r.next, 'p2');
    assert.deepEqual(r.games.map(g => [g.name, g.placeId, g.playing, g.likes, g.verified]), [['Pet Game', '999', 1234, 90, true], ['Obby', '888', 1, null, false]]);
    assert.ok(r.games[0].icon.startsWith('https://tr.rbxcdn.com/'));
    assert.equal(r.games[1].icon, null, 'icons from anywhere else are dropped');
    await assert.rejects(roblox.searchGames('a'), /at least 2 letters/);
  } finally { global.fetch = orig; }
});

// ---------- account list export ----------
test('account list export: CSV or text, safe for spreadsheets, never logins', () => {
  const accounts = require('../src/main/modules/accounts');
  const all = accounts.raw().accounts;
  all.push(
    { id: 'e1', userId: 1, username: 'alpha', displayName: 'Alpha', alias: '=HYPERLINK("x")', group: 'Main', tags: ['farm'], notes: 'a, "b"', cookieEnc: 'SECRET-COOKIE', passwordEnc: 'SECRET-PASS', order: 1, createdAt: Date.UTC(2026, 0, 2) },
    { id: 'e2', userId: 2, username: 'beta', displayName: 'Beta', group: 'Alts', order: 2 },
  );
  const csv = accounts.exportList({ columns: ['username', 'alias', 'notes', 'profile', 'added'] }).text;
  assert.ok(csv.startsWith('﻿Username,Alias,Notes,Profile link,Added'));
  assert.ok(csv.includes(`alpha,"'=HYPERLINK(""x"")","a, ""b""",https://www.roblox.com/users/1/profile,2026-01-02`));
  assert.ok(!/SECRET/.test(csv));
  const txt = accounts.exportList({ ids: ['e2', 'e1'], columns: ['username', 'group'], format: 'txt' });
  assert.equal(txt.count, 2);
  assert.equal(txt.text, 'alpha (Main)\r\nbeta (Alts)\r\n');
  assert.throws(() => accounts.exportList({ columns: ['password', 'cookie'] }), /at least one column/);
  assert.ok(!Object.keys(accounts.EXPORT_COLUMNS).some(k => /pass|cookie|secret/i.test(k)));
});
