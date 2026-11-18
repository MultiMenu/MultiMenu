'use strict';
// Tests for the pure parts of the v1.6 features.
require('./helpers/electron-stub');
const test = require('node:test');
const assert = require('node:assert/strict');

const paths = require('../src/main/paths');
paths.ensureDirs();
require('../src/main/modules/settings').init();

test('guards: ping parsing (English and other Windows languages)', () => {
  const { parsePing } = require('../src/main/modules/guards');
  assert.equal(parsePing('Reply from 128.116.1.2: bytes=32 time=43ms TTL=54'), 43);
  assert.equal(parsePing('Antwort von 128.116.1.2: Bytes=32 Zeit<1ms TTL=128'), 1);
  assert.equal(parsePing('Réponse de 1.2.3.4 : octets=32 temps=120 ms TTL=50'), 120);
  assert.equal(parsePing('Request timed out.'), null);
  assert.equal(parsePing(''), null);
});

test('guards: only Roblox pop-ups are recognised', () => {
  const { isRobloxPopup } = require('../src/main/modules/guards');
  const pids = new Set([100]);
  assert.ok(isRobloxPopup({ pid: 100, className: '#32770', title: 'Roblox Crash' }, pids, new Set()));
  assert.ok(isRobloxPopup({ pid: 7, className: 'Whatever', title: 'Roblox Crash' }, pids, new Set([7])), 'crash handler window');
  assert.ok(!isRobloxPopup({ pid: 100, className: 'WINDOWSCLIENT', title: 'Roblox' }, pids, new Set()), 'the game window itself');
  assert.ok(!isRobloxPopup({ pid: 55, className: '#32770', title: 'Save as' }, pids, new Set()), 'someone else\'s dialog');
});

test('inbox: diff reports only increases', () => {
  const { diff } = require('../src/main/modules/inbox');
  assert.deepEqual(diff(null, { trades: 2, messages: 1, friends: 0 }), [], 'first check is the baseline');
  assert.deepEqual(diff({ trades: 1, messages: 0, friends: 3 }, { trades: 2, messages: 3, friends: 1 }), ['1 new trade request', '3 new messages']);
  assert.deepEqual(diff({ trades: 1, messages: null }, { trades: null, messages: 4 }), [], 'unknown values are ignored');
});

test('playtime: reminders are due every interval', () => {
  const { due } = require('../src/main/modules/playtime');
  const M = 60_000;
  assert.equal(due(0, 179 * M, 180), 0);
  assert.equal(due(0, 180 * M, 180), 1);
  assert.equal(due(0, 400 * M, 180), 2);
  assert.equal(due(0, 400 * M, 0), 0);
});

test('clipboard: finds Roblox game and share links, ignores the rest', () => {
  const { findLink } = require('../src/main/modules/clipwatch');
  const g = findLink('join me!! https://www.roblox.com/games/920587237/Adopt-Me?privateServerLinkCode=XYZ123 thx');
  assert.equal(g.target.placeId, '920587237');
  assert.equal(g.target.linkCode, 'XYZ123');
  const s = findLink('https://www.roblox.com/share?code=abc123DEF&type=Server');
  assert.equal(s.target.shareCode, 'abc123DEF');
  assert.equal(s.target.shareType, 'Server');
  assert.equal(findLink('https://evil.example/games/1'), null);
  assert.equal(findLink('my password is hunter2'), null);
  assert.equal(findLink(''), null);
});

test('roblox: parseTarget understands share links', () => {
  const { parseTarget } = require('../src/main/modules/roblox');
  assert.deepEqual(parseTarget('https://www.roblox.com/share?code=Q1w2E3&type=ExperienceInvite'), { shareCode: 'Q1w2E3', shareType: 'ExperienceInvite' });
  assert.equal(parseTarget('https://www.roblox.com/share?code=bad code!&type=Server'), null);
});

test('capacity: estimate picks the tightest resource', () => {
  const { estimate } = require('../src/main/modules/capacity');
  const clients = [{ memMB: 900, cpu: 8 }, { memMB: 1100, cpu: 12 }];
  // 16 GB PC, 6 GB used in total (2 GB of it Roblox), CPU 30% (20% Roblox)
  const e = estimate({ totalMB: 16384, usedMB: 6144, cpu: 30, gpu: 40, clients });
  assert.equal(e.current, 2);
  assert.equal(e.perClient.memMB, 1000);
  assert.equal(e.byRam, Math.floor((16384 * 0.85 - 4096) / 1000));
  assert.equal(e.byCpu, Math.floor((90 - 10) / 10));
  assert.equal(e.byGpu, Math.floor(95 / 20));
  assert.equal(e.limitedBy, 'GPU');
  assert.equal(e.possible, 4);
  assert.equal(estimate({ totalMB: 8000, usedMB: 4000, cpu: 10, gpu: null, clients: [] }).possible, null);
});

test('themes: clean() clamps everything a theme file can contain', () => {
  const { clean, PRESETS } = require('../src/main/modules/themes');
  const c = clean({ accentHue: 999, particles: 'yes', theme: { secondaryHue: -5, glow: 1e9, blur: 'x', bgType: 'javascript:', bgDim: 50.6, bgFile: '../../evil' } });
  assert.deepEqual(c, { accentHue: 360, particles: true, theme: { secondaryHue: 0, glow: 200, blur: 20, bgType: 'gradient', bgDim: 51 } });
  assert.ok(!('bgFile' in c.theme), 'file names never come from a theme file');
  for (const p of Object.values(PRESETS)) assert.deepEqual(clean(p).theme, p.theme);
});

test('themes: import/export round trip without a background', () => {
  const themes = require('../src/main/modules/themes');
  const settings = require('../src/main/modules/settings');
  themes.applyPreset('neon');
  const text = themes.exportText();
  themes.applyPreset('minimal');
  assert.equal(settings.get('appearance.theme.bgType'), 'solid');
  themes.importText(text);
  assert.equal(settings.get('appearance.accentHue'), 300);
  assert.equal(settings.get('appearance.theme.secondaryHue'), 190);
  assert.equal(settings.get('appearance.theme.preset'), 'custom');
  assert.throws(() => themes.importText('{"format":"nope"}'), /not a MultiMenu theme/);
});

test.after(() => { setTimeout(() => process.exit(0), 50); });
