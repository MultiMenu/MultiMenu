'use strict';
// Features carried over from the old AHK trimmer and ideas from RoALT.
require('./helpers/electron-stub');
const test = require('node:test');
const assert = require('node:assert/strict');

const paths = require('../src/main/paths');
paths.ensureDirs();
require('../src/main/modules/settings').init();

test('anti-AFK: key lists parse like the AHK recorder output', () => {
  const { parseKeys } = require('../src/main/modules/antiafk');
  const { VK } = require('../src/main/modules/keys');
  assert.deepEqual(parseKeys('Space'), [VK.Space]);
  assert.deepEqual(parseKeys('w, space ,F13'), [VK.W, VK.Space, VK.F13]);
  assert.deepEqual(parseKeys('Left,Right'), [VK.Left, VK.Right]);
  assert.deepEqual(parseKeys(''), [VK.F13], 'empty falls back to F13');
  assert.deepEqual(parseKeys('nonsense'), [VK.F13], 'unknown names are skipped');
  assert.equal(parseKeys('A,B,C,D,E,F,G,H,I,J').length, 8, 'at most 8 keys');
});

test('RAM trimmer: threshold watch picks clients over the limit, once a minute', () => {
  const { overThreshold } = require('../src/main/modules/ramtrimmer');
  const MB = 1048576, now = 1_000_000;
  const clients = [{ pid: 1, workingSet: 300 * MB }, { pid: 2, workingSet: 900 * MB }, { pid: 3, workingSet: 400 * MB }];
  assert.deepEqual(overThreshold(clients, 350, now, new Map()).map(c => c.pid), [2, 3]);
  assert.deepEqual(overThreshold(clients, 350, now, new Map([[2, now - 10_000]])).map(c => c.pid), [3], 'trimmed 10s ago: wait');
  assert.deepEqual(overThreshold(clients, 350, now, new Map([[2, now - 70_000]])).map(c => c.pid), [2, 3]);
  assert.deepEqual(overThreshold(clients, 0, now, new Map()), [], '0 = off');
});

test('log cleaner: deletes old logs, then oldest until under the size, never fresh or busy ones', () => {
  const { plan } = require('../src/main/modules/logcleaner');
  const H = 3600_000, MB = 1048576, now = 100 * H;
  const f = (n, ageH, mb, busy = false) => ({ path: n, mtime: now - ageH * H, size: mb * MB, busy });
  const files = [f('old', 30, 5), f('mid', 10, 30), f('new', 2, 30), f('fresh', 0.05, 40), f('busy', 50, 10, true)];
  const out = plan(files, now, { maxAgeHours: 24, maxTotalMB: 50 }).map(x => x.path);
  assert.ok(out.includes('old'), 'older than 24h');
  assert.ok(!out.includes('busy') && !out.includes('fresh'), 'busy and fresh are kept');
  assert.ok(out.includes('mid') && out.includes('new'), 'oldest removed until under 50 MB (fresh+busy alone are 50)');
  assert.deepEqual(plan(files, now, { maxAgeHours: 0, maxTotalMB: 0 }), [], 'both limits off');
});

test('roblox.com window: logout and paid purchases blocked, free items allowed', () => {
  const { blockReason } = require('../src/main/modules/browseas');
  const body = (o) => [{ bytes: Buffer.from(JSON.stringify(o)) }];
  assert.equal(blockReason({ url: 'https://auth.roblox.com/v2/logout', method: 'POST' }), 'logout');
  assert.equal(blockReason({ url: 'https://economy.roblox.com/v1/purchases/products/123', method: 'POST', uploadData: body({ expectedPrice: 250 }) }), 'purchase');
  assert.equal(blockReason({ url: 'https://economy.roblox.com/v1/purchases/products/123', method: 'POST', uploadData: body({ expectedPrice: 0 }) }), null, 'free item');
  assert.equal(blockReason({ url: 'https://apis.roblox.com/marketplace-sales/v1/item/abc/purchase-item', method: 'POST', uploadData: body({ expectedPrice: 80 }) }), 'purchase');
  assert.equal(blockReason({ url: 'https://apis.roblox.com/marketplace-sales/v1/item/abc/purchase-item', method: 'POST' }), 'purchase', 'unreadable body counts as paid');
  assert.equal(blockReason({ url: 'https://www.roblox.com/upgrades/robux?ctx=nav', method: 'GET', resourceType: 'mainFrame' }), 'purchase');
  assert.equal(blockReason({ url: 'https://www.roblox.com/premium/membership', method: 'GET', resourceType: 'mainFrame' }), 'purchase');
  assert.equal(blockReason({ url: 'https://www.roblox.com/catalog', method: 'GET', resourceType: 'mainFrame' }), null);
  assert.equal(blockReason({ url: 'https://economy.roblox.com/v1/purchases/products/123', method: 'POST', uploadData: body({ expectedPrice: 250 }) }, false), null, 'lock off');
  assert.equal(blockReason({ url: 'https://auth.roblox.com/v2/logout', method: 'POST' }, false), 'logout', 'logout is always blocked');
});

test('Roblox logs: user ID is found the way the AHK renamer did', () => {
  const fs = require('fs'); const path = require('path'); const os = require('os');
  const { userIdFrom } = require('../src/main/modules/robloxlogs');
  const p = path.join(os.tmpdir(), `mm-log-${process.pid}.log`);
  fs.writeFileSync(p, '2026-11-11T10:00:00.000Z,1.0,abc,6 [FLog::Output] ! Joining game \'x\' place 1 at 1.2.3.4\n... Report game_join_loadtime: placeid:1, userid:123456789, ...\n');
  assert.equal(userIdFrom(p), '123456789');
  fs.writeFileSync(p, 'nothing here');
  assert.equal(userIdFrom(p), null);
  fs.rmSync(p);
});

test.after(() => { setTimeout(() => process.exit(0), 50); });
