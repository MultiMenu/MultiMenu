'use strict';
// 2.0.2: regression tests for the bugs found in the full code review.
require('./helpers/electron-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const paths = require('../src/main/paths');
paths.ensureDirs();
const settings = require('../src/main/modules/settings');
settings.init();
const { JsonStore } = require('../src/main/store');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mm-store-'));

// ---------- the store never loses your data ----------
test('store: a file saved by Notepad (with a byte-order mark) still loads', () => {
  const f = path.join(tmpDir(), 'a.json');
  fs.writeFileSync(f, '﻿{"x": 5}');
  const st = new JsonStore(f, { x: 1, y: 2 });
  assert.equal(st.get('x'), 5);
  assert.equal(st.get('y'), 2);
  assert.ok(!fs.readdirSync(path.dirname(f)).some(n => n.includes('corrupt')), 'not moved aside');
});

test('store: a file that can\'t be read is never saved over', () => {
  const dir = tmpDir();
  const f = path.join(dir, 'locked.json');
  fs.mkdirSync(f); // reading a folder fails like a file held by another program
  const st = new JsonStore(f, { accounts: [] });
  assert.equal(st.readOnly, true);
  st.set('accounts', [{ id: 1 }]);
  st.saveNow();
  assert.ok(fs.statSync(f).isDirectory(), 'left exactly as it was');
});

test('store: a cut-short file falls back to the last whole save, and is kept aside', () => {
  const dir = tmpDir();
  const f = path.join(dir, 's.json');
  fs.writeFileSync(f, '{"accounts": [1, 2');            // power cut mid-write
  fs.writeFileSync(`${f}.tmp`, '{"accounts": [1, 2, 3]}'); // the save that was in progress
  const st = new JsonStore(f, { accounts: [] });
  assert.deepEqual(st.get('accounts'), [1, 2, 3]);
  assert.ok(fs.readdirSync(dir).some(n => n.startsWith('s.json.corrupt-')), 'the broken file is kept, not deleted');
});

test('store: saves are complete files and leave no temp file behind', () => {
  const f = path.join(tmpDir(), 'b.json');
  const st = new JsonStore(f, { n: 0 });
  st.set('n', 42);
  st.saveNow();
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { n: 42 });
  assert.ok(!fs.existsSync(`${f}.tmp`));
});

// ---------- links ----------
test('game links: odd place, server and private-server values are dropped', () => {
  const r = require('../src/main/modules/roblox');
  assert.equal(r.parseTarget('https://www.roblox.com/games/start?placeId=abc'), null);
  assert.equal(r.parseTarget('https://www.roblox.com/games/start?placeId=../../users'), null);
  assert.deepEqual(r.parseTarget('https://www.roblox.com/games/1?gameInstanceId=not-a-server'), { placeId: '1', linkCode: undefined, jobId: undefined });
  assert.deepEqual(r.parseTarget('https://www.roblox.com/games/1?privateServerLinkCode=a%22b'), { placeId: '1', linkCode: undefined, jobId: undefined });
  const ok = r.parseTarget('https://www.roblox.com/games/920587237/x?privateServerLinkCode=AbC_12-x');
  assert.equal(ok.linkCode, 'AbC_12-x');
});

test('saved games: a roblox.com/share link isn\'t called "Place undefined"', async () => {
  const servers = require('../src/main/modules/servers');
  servers.init();
  const list = await servers.addGame({ link: 'https://www.roblox.com/share?code=abcd1234&type=Server' });
  assert.equal(list[0].name, 'Shared link');
  assert.equal(list[0].private, true);
});

// ---------- accounts ----------
test('accounts: if Windows can\'t encrypt a login, no blank account is left behind', async () => {
  const accounts = require('../src/main/modules/accounts');
  accounts.init();
  const roblox = require('../src/main/modules/roblox');
  const secure = require('../src/main/secure');
  const realUser = roblox.getAuthenticatedUser, realEnc = secure.encrypt;
  roblox.getAuthenticatedUser = async () => ({ id: 777001, name: 'enc_fail', displayName: 'enc_fail' });
  secure.encrypt = () => { throw new Error('Secure storage is not available'); };
  try {
    const before = accounts.raw().accounts.length;
    await assert.rejects(accounts.importCookie(`${roblox.COOKIE_PREFIX}${'x'.repeat(300)}`), /Secure storage/);
    assert.equal(accounts.raw().accounts.length, before);
  } finally { roblox.getAuthenticatedUser = realUser; secure.encrypt = realEnc; }
});

test('accounts: renaming a group onto an existing one merges them', () => {
  const accounts = require('../src/main/modules/accounts');
  accounts.init();
  accounts.addGroup('Farm A'); accounts.addGroup('Farm B');
  const g = accounts.renameGroup('Farm A', 'Farm B');
  assert.equal(g.filter(x => x === 'Farm B').length, 1);
  assert.ok(!g.includes('Farm A'));
});

// ---------- backups keep 2.0 fields ----------
test('backup: tiers, tags, colours, launch graphics and hotkey slots are in the backup', () => {
  const accounts = require('../src/main/modules/accounts');
  accounts.init();
  require('../src/main/modules/presets').init();
  require('../src/main/modules/servers').init();
  require('../src/main/modules/webhooks').init();
  const secure = require('../src/main/secure');
  const raw = accounts.raw().accounts;
  raw.push({ id: 'bk-1', userId: 4242, username: 'bk_user', group: 'Main', order: 99, cookieEnc: secure.encrypt('cookie'), tier: 'main', tags: ['farm'], color: 'pink', launchGraphics: { quality: 1, fpsCap: 30 }, slot: 3 });
  raw.push({ id: 'bk-2', userId: 4243, username: 'bk_broken', group: 'Main', order: 100, cookieEnc: 'damaged-not-a-secret' });
  try {
    const v = require('../src/main/modules/backup').buildVault();
    const a = v.accounts.find(x => x.userId === 4242);
    assert.deepEqual([a.tier, a.tags, a.color, a.launchGraphics, a.slot], ['main', ['farm'], 'pink', { quality: 1, fpsCap: 30 }, 3]);
    assert.equal(v.accounts.find(x => x.userId === 4243).cookie, null, 'one unreadable login doesn\'t stop the backup');
  } finally { raw.splice(raw.findIndex(x => x.id === 'bk-1'), 2); }
});
