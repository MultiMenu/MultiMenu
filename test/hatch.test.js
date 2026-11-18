// Hatch alerts and the hatch counter (generic: any game, set up on the Hatch alerts page).
const { test } = require('node:test');
const assert = require('node:assert');
require('./helpers/electron-stub');
const settings = require('../src/main/modules/settings');
settings.init();
const bus = require('../src/main/bus');
const hatch = require('../src/main/modules/hatch');
hatch.init();

test('nothing game-specific by default: off, no games, no pet names', () => {
  const c = settings.DEFAULTS.hatch;
  assert.deepEqual(c.places, []);
  assert.deepEqual(c.pets, []);
  assert.deepEqual(c.words, ['secret']);
  assert.equal(c.enabled, false, 'off until you turn it on');
});

// Set up like you would for a game whose pop-up says "You've hatched something special".
settings.set('hatch.places', ['10629695169']);
settings.set('hatch.words', ['secret', 'something special', 'hold to reveal']);
settings.set('hatch.pets', ['Void Wraith', 'Anubis', 'Chronus', 'Shinigami', 'Dragon Tamer']);

test('the secret pop-up and pet names are recognised, also with screen-reading mistakes', () => {
  assert.ok(hatch.match("You've hatched something special..\nHold to Reveal!"));
  assert.ok(hatch.match('Youve hatched somethina special'), 'one wrong letter');
  assert.ok(hatch.match("You've hatched something\nspecial.."), 'split over two lines');
  assert.equal(hatch.match('Void Wralth').pet, 'Void Wraith');
  assert.deepEqual(hatch.match('You hatched a Secret II pet: Anubis'), { pet: 'Anubis', rarity: 'Secret II', words: ['secret'] });
  for (const t of ['Common Dog', 'Secretary', 'Something', 'Rebirth special offer', '', 'Hatch 3 eggs']) assert.equal(hatch.match(t), null, t);
});

test('other players\' hatch announcements do not ping you', () => {
  const s = { accountId: 'nope', label: 'testalt3' };
  assert.equal(hatch.someoneElse('[Server] Bob123 hatched Anubis (Secret II)', s), true);
  assert.equal(hatch.someoneElse('testalt3 hatched Void Wraith!', s), false);
  assert.equal(hatch.someoneElse("You've hatched something special..", s), false);
  assert.equal(hatch.someoneElse('Youve hatched something special', s), false);
  assert.equal(hatch.someoneElse('Anubis', s), false);
});

test('the ping only accepts a Discord user or role mention', () => {
  assert.equal(hatch.normaliseMention('123456789012345678'), '<@123456789012345678>');
  assert.equal(hatch.normaliseMention('<@&123456789012345678>'), '<@&123456789012345678>');
  assert.equal(hatch.normaliseMention('@everyone'), '');
  assert.equal(hatch.normaliseMention('bob'), '');
});

test('alerts: one per hatch, a cooldown per account, and the revealed name still gets through', async () => {
  settings.set('hatch.ping', '123456789012345678');
  settings.set('hatch.cooldownSec', 30);
  const seen = [];
  const on = (e) => { if (e.type === 'secretHatched') seen.push(e); };
  bus.on('event', on);
  const session = { id: 's1', accountId: 'a1', label: 'testalt1' };
  await hatch._fire({ session, source: 'screen', text: 'something special' });
  await hatch._fire({ session, source: 'screen', text: 'something special' });
  assert.equal(seen.length, 1, 'the same pop-up is one alert');
  assert.match(seen[0].detail, /testalt1 hatched a secret pet \(not revealed yet\)/);
  assert.equal(seen[0].mention, '<@123456789012345678>');
  await hatch._fire({ session, pet: 'Anubis', rarity: 'Secret II', source: 'screen', text: 'Anubis' });
  assert.equal(seen.length, 2, 'the name after "Hold to Reveal" is sent');
  assert.match(seen[1].detail, /Anubis \(Secret II\)/);
  await hatch._fire({ session, pet: 'Chronus', source: 'output', text: 'Chronus' });
  assert.equal(seen.length, 2, 'cooldown');
  await hatch._fire({ session: { id: 's2', accountId: 'a2', label: 'testalt2' }, pet: 'Chronus', source: 'output', text: 'Chronus' });
  assert.equal(seen.length, 3, 'other accounts are not held back');
  const st = hatch.status();
  assert.equal(st.counts.find(c => c.accountId === 'a1').n, 2);
  assert.equal(st.log[0].label, 'testalt2');
  for (const e of seen) assert.ok(!JSON.stringify(e).match(/password|cookie|token/i));
  bus.off?.('event', on);
  hatch.clearLog();
});

test('game messages: nothing while the game loads, then matching lines alert', async () => {
  settings.set('hatch.enabled', true);
  const seen = [];
  const on = (e) => { if (e.type === 'secretHatched') seen.push(e); };
  bus.on('event', on);
  const session = { id: 's9', accountId: 'a9', label: 'testalt9', placeId: '10629695169' };
  bus.emit('session:joined', { id: 's9' });
  hatch.onLogLines({ session, lines: ['2026-11-14T10:00:00Z,1.0,abc,6 [FLog::Output] You hatched Shinigami!'] });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(seen.length, 0, 'loading grace');
  hatch._joinedAt.set('s9', Date.now() - 60_000);
  hatch.onLogLines({ session: { ...session, placeId: '1' }, lines: ['x [FLog::Output] You hatched Shinigami!'] });
  hatch.onLogLines({ session, lines: ['x [FLog::Output] Bob hatched Shinigami!', 'x [FLog::Output] Coins: 100', 'x [FLog::Output] You hatched Shinigami!'] });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(seen.length, 1);
  assert.match(seen[0].detail, /Shinigami/);
  settings.set('hatch.enabled', false);
  hatch.clearLog();
});

test('settings check the Discord ID and place IDs', () => {
  const { setSetting } = require('../src/main/ipc');
  assert.throws(() => setSetting('hatch.ping', 'my name'), /Discord user ID/);
  assert.equal(setSetting('hatch.ping', '123456789012345678').value, '123456789012345678');
  assert.throws(() => setSetting('hatch.places', ['tap sim']), /numbers only/);
  assert.equal(setSetting('screen.minWidth', 5).value, 160);
});

test('Discord: a hatch alert pings you and has a gold embed', () => {
  const webhooks = require('../src/main/modules/webhooks');
  assert.ok(webhooks.EVENTS.secretHatched);
  assert.equal(settings.get('discord.events.secretHatched'), true);
  assert.equal(settings.get('speech.events.secretHatched'), true);
  const src = require('fs').readFileSync(require.resolve('../src/main/modules/webhooks.js'), 'utf8');
  assert.match(src, /evt\.mention \|\| cfg\.mention/);
});

test('screen reading: a pop-up already showing is remembered, a new one alerts once', async () => {
  const c = { ...settings.get('hatch'), cooldownSec: 0 };
  const seen = [];
  const on = (e) => { if (e.type === 'secretHatched') seen.push(e); };
  bus.on('event', on);
  const s = { id: 'w1', accountId: 'aw1', label: 'testalt7' };
  await hatch._checkScreenText(s, 'Coins 1.2M  Rebirth', c);
  await hatch._checkScreenText(s, "You've hatched something special..\nHold to Reveal!", c);
  await hatch._checkScreenText(s, "You've hatched something special..\nHold to Reveal!", c);
  assert.equal(seen.length, 1);
  await hatch._checkScreenText(s, '[Server] Bob123 hatched Anubis', c);
  assert.equal(seen.length, 1, 'someone else\'s announcement');
  const s2 = { id: 'w2', accountId: 'aw2', label: 'testalt8' };
  await hatch._checkScreenText(s2, "You've hatched something special..", c);
  assert.equal(seen.length, 1, 'already on screen at the first look');
  hatch.clearLog();
});
