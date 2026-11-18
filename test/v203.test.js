// 2.0.3: the window's command filter lets every real command through, and every pushed event is allowed.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
require('./helpers/electron-stub');

const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload.js'), 'utf8');
const ipcSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ipc.js'), 'utf8');

test('every command name passes the window\'s channel filter (app:i18n was once blocked)', () => {
  const re = new RegExp(/\/(\^\[a-z\][^/]+\$)\/\.test\(channel\)/.exec(preload)[1]);
  const { makeHandlers } = require('../src/main/ipc');
  const all = makeHandlers({ win: () => null, windows: () => [] });
  Object.assign(all, require('../src/main/admin').handlers(all));
  const names = Object.keys(all);
  assert.ok(names.length > 300);
  const blocked = names.filter(n => !re.test(n));
  assert.deepEqual(blocked, []);
  assert.ok(re.test('app:i18n'));
  assert.ok(!re.test('app:i18n; drop'));
  assert.ok(!re.test('constructor'));
});

test('every event the main process forwards is one the window may listen to', () => {
  const events = new Set([...preload.slice(preload.indexOf('const EVENTS'), preload.indexOf(']);')).matchAll(/'([a-z]+:[a-zA-Z]+|nav)'/g)].map(m => m[1]));
  const fwd = ipcSrc.slice(ipcSrc.indexOf('const forward = ['), ipcSrc.indexOf('];', ipcSrc.indexOf('const forward = [')));
  const forwarded = [...fwd.matchAll(/'([a-z]+:[a-zA-Z]+)'/g)].map(m => m[1]);
  assert.ok(forwarded.length > 30);
  assert.deepEqual(forwarded.filter(e => !events.has(e)), []);
  assert.ok(events.has('admin:feed'));
});

test('admin settings table: only text settings can be secret', () => {
  require('../src/main/modules/settings').init();
  // Called directly: the lock is checked by the dispatcher, not the handler.
  const table = require('../src/main/admin').handlers({})['admin:settings']();
  const req = table.find(r => r.key === 'updates.requireSignature');
  assert.equal(req.secret, false);
  assert.equal(typeof req.value, 'boolean');
  assert.equal(table.find(r => r.key === 'api.keyEnc').secret, true);
});
