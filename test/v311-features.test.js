// 3.1.1 community suggestions: held Roblox updates, batches, server hop, title bars,
// Wallpaper Engine backgrounds.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
require('./helpers/electron-stub');
const settings = require('../src/main/modules/settings');
settings.init();

test('Roblox updates: held always, only while a client is open, or let through for a while', () => {
  const ug = require('../src/main/modules/updateguard');
  assert.equal(ug.isHolding('off', 5), false);
  assert.equal(ug.isHolding('always', 0), true);
  assert.equal(ug.isHolding('whileOpen', 0), false);
  assert.equal(ug.isHolding('whileOpen', 3), true);
  const now = 1_000_000;
  assert.equal(ug.isHolding('always', 3, now, now + 60_000), false, '"Update Roblox now" lets it through');
  assert.equal(ug.isHolding('always', 3, now, now - 1), true);
  assert.ok(ug.INSTALLERS.includes('robloxplayerinstaller.exe'));
  assert.equal(settings.get('updateGuard.hold'), 'off', 'off unless you turn it on');
});

test('batches: the next batch waits until every client of this one is in game or gone', () => {
  const { batchDone } = require('../src/main/modules/sessions');
  const all = { a: { status: 'running' }, b: { status: 'running' }, c: { status: 'failed' } };
  const get = (id) => all[id];
  assert.equal(batchDone(['a', 'b'], get, new Set(['a'])), false);
  assert.equal(batchDone(['a', 'b'], get, new Set(['a', 'b'])), true);
  assert.equal(batchDone(['a', 'c', 'gone'], get, new Set(['a'])), true, 'failed and removed ones don\'t hold it up');
  assert.equal(settings.get('launch.batchSize'), 0, 'off by default');
});

test('server hop: only for a public server picked by its ID, and the log says how the join went', () => {
  const hop = require('../src/main/modules/serverhop');
  const job = '0f3c2a10-1111-2222-3333-444455556666';
  assert.equal(hop.wanted({ accountId: 'x', target: { placeId: '1', jobId: job } }), true);
  assert.equal(hop.wanted({ accountId: 'x', target: { placeId: '1' } }), false, 'a plain game join');
  assert.equal(hop.wanted({ accountId: 'x', target: { placeId: '1', jobId: job, linkCode: 'abc' } }), false, 'private servers');
  assert.equal(hop.wanted({ external: true, accountId: 'x', target: { placeId: '1', jobId: job } }), false);
  const st = { now: 5, joiningAt: null };
  assert.equal(hop.verdict([`! Joining game '${job}' place 1 at 10.0.0.1`], st), null);
  assert.equal(st.joiningAt, 5);
  assert.equal(hop.verdict(['[FLog::Network] serverId: 10.0.0.1|5000'], st), 'in');
  assert.equal(hop.verdict(['[FLog::Network] Sending disconnect with reason: 279'], { now: 1 }), 'failed');
  assert.equal(settings.get('launch.hopIfJoinFails'), true);
});

test('title bars: the title bar and sizing border go, the minimise box stays', () => {
  const win32 = require('../src/main/native/win32');
  const WS_CAPTION = 0x00C00000, WS_THICKFRAME = 0x00040000, WS_MINIMIZEBOX = 0x00020000, WS_SYSMENU = 0x00080000, WS_VISIBLE = 0x10000000;
  const style = WS_VISIBLE | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX;
  const out = win32.titlelessStyle(style);
  assert.equal(out & WS_CAPTION, 0);
  assert.equal(out & WS_THICKFRAME, 0);
  assert.ok(out & WS_MINIMIZEBOX);
  assert.ok(out & WS_VISIBLE);
  assert.equal(settings.get('tiling.hideTitleBars'), false);
});

test('Wallpaper Engine: video wallpapers only, found in every Steam library', () => {
  const th = require('../src/main/modules/themes');
  const dir = path.join('C:', 'lib', 'w1');
  assert.equal(th.weProject({ type: 'video', file: 'loop.mp4', title: 'Rain' }, dir).file, path.join(dir, 'loop.mp4'));
  assert.equal(th.weProject({ type: 'Video', file: '../../evil.mp4' }, dir).file, path.join(dir, 'evil.mp4'), 'stays in its own folder');
  assert.equal(th.weProject({ type: 'scene', file: 'scene.pkg' }, dir), null);
  assert.equal(th.weProject({ type: 'video', file: 'x.exe' }, dir), null);
  const steam = path.join('P', 'Steam');
  const fake = {
    existsSync: (p) => p === path.join(steam, 'steamapps'),
    readFileSync: () => '"libraryfolders"\n{\n "0"\n {\n  "path"  "D:\\\\SteamLibrary"\n }\n}',
  };
  const libs = th.steamLibraries({ 'ProgramFiles(x86)': 'P' }, fake);
  assert.deepEqual(libs, [steam, 'D:\\SteamLibrary']);
});

test('Potato preset: every lighter option, 5 FPS and Reduce motion, main accounts untouched', () => {
  const pp = require('../src/main/modules/perfprofile');
  assert.equal(pp.ORDER[0], 'potato');
  const v = pp.PRESETS.potato.values;
  assert.equal(v['perf.fpsCap'], 5);
  assert.equal(v['perf.reducedMotion'], true);
  for (const k of ['perf.flags.graySky', 'perf.flags.noGrass', 'perf.flags.lowestQuality', 'perf.flags.pauseLighting']) assert.equal(v[k], true, k);
  for (const k of Object.keys(v)) assert.notEqual(settings.get(k), undefined, `${k} is a real setting`);
  assert.equal(settings.get('perf.reducedMotion'), false, 'off unless you pick it');
});

test('Reduce motion goes into Roblox\'s settings file only when the file has it', () => {
  const fs = require('fs'), os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-rm-'));
  const dir = path.join(tmp, 'Roblox');
  fs.mkdirSync(dir, { recursive: true });
  const before = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = tmp;
  fs.mkdirSync(require('../src/main/paths').backupsDir(), { recursive: true });
  try {
    const file = path.join(dir, 'GlobalBasicSettings_13.xml');
    fs.writeFileSync(file, '<roblox><Item class="UserGameSettings"><Properties>\n<token name="SavedQualityLevel">5</token>\n<bool name="ReducedMotion">false</bool>\n</Properties></Item></roblox>');
    const fps = require('../src/main/modules/fps');
    fps.writeGraphics({ reducedMotion: true });
    assert.match(fs.readFileSync(file, 'utf8'), /<bool name="ReducedMotion">true<\/bool>/);
    fs.writeFileSync(file, '<roblox><Item class="UserGameSettings"><Properties>\n<token name="SavedQualityLevel">5</token>\n</Properties></Item></roblox>');
    fps.writeGraphics({ reducedMotion: true }); // nothing to change, no error
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /ReducedMotion/);
  } finally { process.env.LOCALAPPDATA = before; }
});
