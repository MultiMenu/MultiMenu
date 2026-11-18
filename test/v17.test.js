'use strict';
// 1.7: languages, Roblox Account Manager import, Bloxstrap/Fishstrap launching.
require('./helpers/electron-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const paths = require('../src/main/paths');
paths.ensureDirs();
require('../src/main/modules/settings').init();

const T = require('../src/renderer/js/translate');
const I18N = path.join(__dirname, '..', 'src', 'i18n');

test('translate: exact, templates, joined messages, whitespace kept', () => {
  const t = T.create({
    'Ready': 'Listo', '{0} rejoin{1} queued': '{0} reconexión(es) en cola', 'Last used {0}': 'Usada {0}', '{0}h ago': 'hace {0} h',
    'Default game {0}': 'Juego {0}', 'Error {0}': 'Error {0}', 'Kicked by the game': 'Expulsado por el juego', 'running': 'en marcha',
  });
  assert.equal(t('Ready'), 'Listo');
  assert.equal(t('  Ready \n'), '  Listo \n');
  assert.equal(t('1 rejoin queued'), '1 reconexión(es) en cola');
  assert.equal(t('3 rejoins queued'), '3 reconexión(es) en cola');
  assert.equal(t('Last used 2h ago · Default game 920587237'), 'Usada hace 2 h · Juego 920587237');
  assert.equal(t('Error 267 — Kicked by the game'), 'Error 267 — Expulsado por el juego');
  assert.equal(t('running ·'), 'en marcha ·');
  assert.equal(t('NeonFalcon2291'), 'NeonFalcon2291');
  assert.equal(t('42'), '42');
});

test('translate: loose templates never swallow English sentences', () => {
  const t = T.create({ '{0}{1} account{2}{3}': '{0}{1} cuenta(s){3}', '{0} saved': '{0} guardado' });
  assert.equal(t("Farm 1: This account's login has expired."), "Farm 1: This account's login has expired.");
  assert.equal(t('Your settings were saved'), 'Your settings were saved');
  assert.equal(t('3 saved'), '3 guardado');
});

test('i18n: every language covers every key with valid placeholders', () => {
  const keys = JSON.parse(fs.readFileSync(path.join(I18N, 'keys.json'), 'utf8'));
  assert.ok(keys.length > 1500);
  for (const l of T.LANGS.filter(x => x.id !== 'en')) {
    const d = JSON.parse(fs.readFileSync(path.join(I18N, `${l.id}.json`), 'utf8'));
    const missing = keys.filter(k => !(k in d));
    assert.deepEqual(missing, [], `${l.id} is missing keys`);
    for (const [k, v] of Object.entries(d)) {
      for (const p of v.match(/\{\d\}/g) || []) assert.ok(k.includes(p), `${l.id}: "${v}" uses ${p} not in "${k}"`);
      assert.ok(v.trim(), `${l.id}: empty translation for "${k}"`);
    }
    // the brand and usual account names stay as they are
    for (const k of ['Menu', 'Main', 'Violet']) assert.ok(!(k in d), `${l.id} must not translate "${k}"`);
  }
});

test('i18n: main-process module loads, suggests from the Windows locale and falls back to English', () => {
  const i18n = require('../src/main/i18n');
  assert.equal(i18n.suggest('es-MX'), 'es');
  assert.equal(i18n.suggest('nb-NO'), 'nb');
  assert.equal(i18n.suggest('nn'), 'nb');
  assert.equal(i18n.suggest('pt-BR'), 'pt');
  assert.equal(i18n.suggest('ja-JP'), 'en');
  assert.equal(i18n.load('de'), 'de');
  assert.equal(i18n.t('Open MultiMenu'), 'MultiMenu öffnen');
  assert.ok(Object.keys(i18n.payload().dict).length > 1500);
  assert.equal(i18n.load('xx'), 'en');
  assert.equal(i18n.t('Open MultiMenu'), 'Open MultiMenu');
});

test('settings: 1.7 defaults', () => {
  const settings = require('../src/main/modules/settings');
  assert.equal(settings.get('language'), '');
  assert.equal(settings.get('mini.compact'), false);
});

test('Roblox Account Manager import: file keeps names only, never secrets', () => {
  const ri = require('../src/main/modules/ramimport');
  const file = JSON.stringify([
    { Username: 'NeonFalcon2291', UserID: 11, Alias: 'Main', Description: 'my main', Group: 'Default', SecurityToken: '_|WARNING:-DO-NOT-SHARE-THIS.secret', Password: 'hunter2' },
    { Username: 'VioletRaven_77', UserID: 12, Alias: '', Group: 'Farm', SecurityToken: 'x' },
    { Username: 'bad name!', SecurityToken: 'y' },
  ]);
  const { entries } = ri.parseRamFile(file);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { username: 'NeonFalcon2291', userId: 11, alias: 'Main', group: '', notes: 'my main', source: 'ram' });
  assert.equal(entries[1].group, 'Farm');
  assert.ok(!JSON.stringify(entries).includes('WARNING') && !JSON.stringify(entries).includes('hunter2'));
  assert.throws(() => ri.parseRamFile('Roblox Account Manager created by ic3w0lf22 @ github.com .......\u0001\u0002'), e => e.code === 'ENCRYPTED');
  assert.throws(() => ri.parseRamFile('\u0001\u0000\u0000\u0000\u00d0\u008c\u009d\u00df'), e => e.code === 'ENCRYPTED');
  assert.throws(() => ri.parseRamFile('[]'), /No accounts/);
});

test('Roblox Account Manager import: pasted list drops passwords', () => {
  const ri = require('../src/main/modules/ramimport');
  const r = ri.parseList('NeonFalcon2291:hunter2\n@VioletRaven_77, Farm 1, Alts\n# comment\n\nno spaces allowed\nLunar_Pixel\tAFK');
  assert.equal(r.ignoredSecrets, true);
  assert.equal(r.bad, 1);
  assert.deepEqual(r.entries.map(e => [e.username, e.alias, e.group]), [['NeonFalcon2291', '', ''], ['VioletRaven_77', 'Farm 1', 'Alts'], ['Lunar_Pixel', 'AFK', '']]);
  assert.ok(!JSON.stringify(r).includes('hunter2'));
  assert.throws(() => ri.parseList('   \n# nothing'), /No usernames/);
});

test('accounts: pending sign-ins skip duplicates and can be removed', () => {
  const accounts = require('../src/main/modules/accounts');
  accounts.init();
  const r1 = accounts.addPending([{ username: 'StarlightKoi_09', alias: 'Farm 3', group: 'Alts' }, { username: 'MossyBeacon' }]);
  assert.deepEqual(r1, { added: 2, skipped: 0 });
  const r2 = accounts.addPending([{ username: 'mossybeacon' }]);
  assert.deepEqual(r2, { added: 0, skipped: 1 });
  const list = accounts.pendingList();
  assert.equal(list.length, 2);
  assert.equal(accounts.removePending(list[0].id).length, 1);
});

test('launchers: registry command parsing and handler detection', () => {
  const L = require('../src/main/modules/launchers');
  assert.deepEqual(L.parseCommand('"C:\\Users\\A B\\AppData\\Local\\Bloxstrap\\Bloxstrap.exe" -player "%1"'), { exe: 'C:\\Users\\A B\\AppData\\Local\\Bloxstrap\\Bloxstrap.exe', args: ['-player', '%1'] });
  assert.equal(L.classifyHandler('"C:\\x\\Bloxstrap.exe" -player "%1"'), 'bloxstrap');
  assert.equal(L.classifyHandler('"C:\\x\\Fishstrap.exe" -player "%1"'), 'fishstrap');
  assert.equal(L.classifyHandler('"C:\\Users\\a\\AppData\\Local\\Roblox\\Versions\\version-1\\RobloxPlayerBeta.exe" %1'), 'roblox');
  assert.equal(L.classifyHandler('"C:\\x\\Other.exe" %1'), 'other');
  assert.equal(L.classifyHandler(''), null);
});
