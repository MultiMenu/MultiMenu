// 3.1.1 bug fixes: labels on their own window, tiny windows that stop fighting Roblox,
// gentler eco mode, Roblox log lookup by name, one window capture at a time.
const { test } = require('node:test');
const assert = require('node:assert');
require('./helpers/electron-stub');
const settings = require('../src/main/modules/settings');
settings.init();

test('overlay: the label area sits in the chosen corner and scales with display scaling', () => {
  const o = require('../src/main/modules/overlay');
  const c = { x: 100, y: 50, width: 800, height: 600 };
  assert.deepEqual(o.labelArea(c, 'top-left', 100, 1), { x: 108, y: 58, width: 260, height: 26 });
  const br = o.labelArea(c, 'bottom-right', 100, 1.5);
  assert.equal(br.width, 390); assert.equal(br.height, 39);
  assert.equal(br.x + br.width, 100 + 800 - 12); assert.equal(br.y + br.height, 50 + 600 - 12);
  // Never wider than the window.
  assert.ok(o.labelArea({ x: 0, y: 0, width: 220, height: 160 }, 'top-left').width <= 204);
});

test('overlay: a label hides when another window covers its corner, not for the game\'s own pop-ups', () => {
  const o = require('../src/main/modules/overlay');
  const area = { x: 108, y: 58, width: 260, height: 26 };
  const game = { pid: 10, rect: { x: 100, y: 50, width: 800, height: 600 } };
  const browser = { pid: 20, rect: { x: 0, y: 0, width: 300, height: 300 } };
  const popup = { pid: 10, rect: { x: 90, y: 40, width: 400, height: 200 } };
  const far = { pid: 30, rect: { x: 2000, y: 0, width: 300, height: 300 } };
  assert.equal(o.covered(area, [browser, game], 1, 10), true);
  assert.equal(o.covered(area, [popup, far, game], 2, 10), false);
  assert.equal(o.covered(area, [game, browser], 0, 10), false); // the browser is behind the game
});

test('tiny windows: put back at most 3 times in 5 minutes, then left at Roblox\'s size', () => {
  const tk = require('../src/main/modules/tinykeep');
  const now = 10_000_000;
  assert.equal(tk.tooMany([], now), false);
  assert.equal(tk.tooMany([now - 1000, now - 2000], now), false);
  assert.equal(tk.tooMany([now - 1000, now - 2000, now - 3000], now), true);
  assert.equal(tk.tooMany([now - 6 * 60_000, now - 7 * 60_000, now - 1000], now), false);
});

test('eco mode: background alts get below-normal priority, never lower than you chose', () => {
  const l = require('../src/main/modules/limiter');
  assert.equal(l.lower('normal', 'below'), 'below');
  assert.equal(l.lower('below', 'below'), 'below');
  assert.equal(l.lower('idle', 'below'), 'idle');
  assert.equal(l.lower('above', 'below'), 'below');
});

test('Roblox logs: the start time comes from the file name', () => {
  const logs = require('../src/main/modules/robloxlogs');
  assert.equal(logs.nameTime('0.698.0.6980936_20261117T153012Z_Player_6A2B1_last.log'), Date.UTC(2026, 10, 17, 15, 30, 12));
  assert.equal(logs.nameTime('player_log_123.log'), null);
});

test('game updates no longer move clients unless you turn it on', () => {
  assert.equal(settings.get('guards.restartOnUpdate'), false);
  assert.ok((settings.get('migrations') || []).includes('update-restart-off'));
});

test('window pictures: requests wait their turn and identical ones share one answer', async () => {
  const electron = require('electron');
  let running = 0, most = 0, calls = 0;
  const before = electron.desktopCapturer;
  electron.desktopCapturer = { getSources: async () => { calls++; running++; most = Math.max(most, running); await new Promise(r => setTimeout(r, 20)); running--; return [{ id: 'window:1:0' }]; } };
  try {
    const cap = require('../src/main/modules/capture');
    const a = { thumbnailSize: { width: 320, height: 180 } }, b = { thumbnailSize: { width: 0, height: 0 } };
    const res = await Promise.all([cap.sources(a), cap.sources(a), cap.sources(b), cap.sources(a)]);
    assert.equal(most, 1, 'never two captures at once');
    assert.ok(calls <= 3, `identical requests shared (${calls} calls)`);
    assert.equal(res.length, 4);
  } finally { electron.desktopCapturer = before; }
});

test('startup: a run that never closed normally is noticed at the next start', () => {
  const startup = require('../src/main/startup');
  startup.markClosed();
  startup.decideSafeMode([]);
  assert.equal(startup.endedBadly(), false);
  startup.decideSafeMode([]); // started again without closing: the last run ended by itself
  assert.equal(startup.endedBadly(), true);
  startup.markClosed();
});
