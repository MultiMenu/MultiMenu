'use strict';
// 1.8: stuck loading, bulk edit, login warnings, phone dashboard, monitor layouts, focus mode, safe mode.
const { stub } = require('./helpers/electron-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');

const paths = require('../src/main/paths');
paths.ensureDirs();
const settings = require('../src/main/modules/settings');
settings.init();

test('watcher: stuck loading after the set minutes only', () => {
  const w = require('../src/main/modules/watcher');
  const now = 10_000_000;
  assert.equal(w.isStuck(now - 4 * 60_000, now, { stuckMin: 5 }), false);
  assert.equal(w.isStuck(now - 5 * 60_000, now, { stuckMin: 5 }), true);
  assert.equal(w.isStuck(null, now, { stuckMin: 5 }), false);
  assert.equal(w.isStuck(now - 4 * 60_000, now, { stuckMin: 0 }), false, 'blank falls back to 5 minutes');
  assert.equal(settings.get('watcher.detectStuck'), true);
  assert.equal(settings.get('watcher.stuckMin'), 5);
});

test('accounts: bulk update changes only the ticked fields', () => {
  const accounts = require('../src/main/modules/accounts');
  accounts.init();
  const mk = (id) => ({ id, userId: id.charCodeAt(0), username: `user_${id}`, displayName: id, group: 'Main', notes: 'old', favourite: false });
  accounts.raw().accounts.push(mk('a'), mk('b'), mk('c')); // raw() hands back the stored list
  const r = accounts.bulkUpdate(['a', 'b', 'missing'], { group: 'Farm', notesAppend: 'AFK alt', launchGraphics: { quality: 1, fpsCap: 30 } });
  assert.equal(r.changed, 2);
  for (const id of ['a', 'b']) {
    const a = accounts.find(id);
    assert.equal(a.group, 'Farm');
    assert.equal(a.notes, 'old\nAFK alt');
    assert.deepEqual(a.launchGraphics, { quality: 1, fpsCap: 30 });
    assert.equal(a.favourite, false, 'untouched');
  }
  assert.equal(accounts.find('c').group, 'Main', 'unselected account untouched');
  accounts.bulkUpdate(['a'], { clearNotes: true, favourite: true });
  assert.equal(accounts.find('a').notes, '');
  assert.equal(accounts.find('a').favourite, true);
  assert.throws(() => accounts.bulkUpdate([], { group: 'x' }), /No accounts/);
  assert.throws(() => accounts.bulkUpdate(['a'], { launchGraphics: { quality: 99 } }), /0–10/);
});

test('phone: private-network and host checks', () => {
  const ph = require('../src/main/modules/phone');
  for (const ip of ['192.168.0.10', '10.1.2.3', '172.16.5.5', '172.31.255.1', '127.0.0.1', '::1', '::ffff:192.168.1.9', 'fe80::1', 'fd12:3456::1']) assert.ok(ph.isPrivate(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '2001:4860::8888', '::ffff:1.1.1.1', '']) assert.ok(!ph.isPrivate(ip), ip);
  assert.ok(ph.hostAllowed('192.168.1.20:43821'));
  assert.ok(ph.hostAllowed('localhost:43821'));
  assert.ok(ph.hostAllowed('[fe80::1]:43821'));
  assert.ok(!ph.hostAllowed('attacker.example:43821'));
  assert.ok(!ph.hostAllowed('192.168.1.20.nip.io:43821'));
});

test('phone: PIN is hashed, checked in constant time and rate limited', () => {
  const ph = require('../src/main/modules/phone');
  assert.throws(() => ph.setPin('12345'), /6 digits/);
  assert.throws(() => ph.setPin('111111'), /harder/);
  ph.setPin('482913');
  assert.notEqual(settings.get('phone.pinHash'), '482913');
  assert.equal(settings.get('phone.pinHash').length, 64);
  assert.ok(ph.checkPin('482913'));
  assert.ok(!ph.checkPin('482914'));
  assert.ok(!ph.checkPin('48291'));
  const ip = '192.168.50.50', now = Date.now();
  for (let i = 0; i < 4; i++) ph.recordFail(ip, now);
  assert.equal(ph.lockedFor(ip, now), 0);
  ph.recordFail(ip, now);
  assert.ok(ph.lockedFor(ip, now) >= 4 * 60_000, 'locked after 5 wrong PINs');
  const p = ph.randomPin();
  assert.match(p, /^\d{6}$/);
});

test('phone: HTTP — page is public, data needs the PIN, secrets never appear', async () => {
  require('../src/main/modules/presets').init();
  const ph = require('../src/main/modules/phone');
  ph.setPin('730261');
  const srv = http.createServer((q, r) => { ph._handle(q, r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const req = (p, opts = {}) => new Promise((res, rej) => {
    const q = http.request({ host: '127.0.0.1', port, path: p, method: opts.method || 'GET', headers: { Host: opts.host || `127.0.0.1:${port}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } }, (r) => {
      let b = ''; r.on('data', c => { b += c; }); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: b }));
    });
    q.on('error', rej); if (opts.body) q.write(JSON.stringify(opts.body)); q.end();
  });
  try {
    const page = await req('/');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(page.headers['x-frame-options'], 'DENY');
    assert.equal((await req('/api/status')).status, 401);
    assert.equal((await req('/', { host: 'evil.example' })).status, 421, 'DNS-rebinding host refused');
    assert.equal((await req('/api/login', { method: 'POST', body: { pin: '000001' } })).status, 401);
    const ok = await req('/api/login', { method: 'POST', body: { pin: '730261' } });
    assert.equal(ok.status, 200);
    const { token } = JSON.parse(ok.body);
    assert.match(token, /^[a-f0-9]{64}$/);
    const st = await req('/api/status', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(st.status, 200, st.body);
    const j = JSON.parse(st.body);
    assert.ok(Array.isArray(j.sessions) && Array.isArray(j.presets));
    assert.ok(!/cookie|ROBLOSECURITY|password|webhook|token/i.test(st.body), 'no secrets in the status reply');
    assert.equal((await req('/api/action/nope', { method: 'POST', body: {}, headers: { Authorization: `Bearer ${token}` } })).status, 404);
    settings.set('phone.allowControl', false);
    assert.equal((await req('/api/action/closeAll', { method: 'POST', body: {}, headers: { Authorization: `Bearer ${token}` } })).status, 403, 'view-only mode');
    settings.set('phone.allowControl', true);
    await req('/api/logout', { method: 'POST', body: {}, headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await req('/api/status', { headers: { Authorization: `Bearer ${token}` } })).status, 401, 'signed out');
  } finally { srv.close(); }
});

test('layouts: monitor-setup signature and description', () => {
  const l = require('../src/main/modules/layouts');
  const a = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 };
  const b = { bounds: { x: 1920, y: 0, width: 1707, height: 960 }, size: { width: 1707, height: 960 }, scaleFactor: 1.5 };
  assert.equal(l.signature([b, a]), l.signature([a, b]), 'order-independent');
  assert.notEqual(l.signature([a]), l.signature([a, b]));
  assert.equal(l.describe(l.signature([a, b])), '2 monitors · 1920×1080 + 2561×1440');
  assert.equal(l.describe(l.signature([a])), '1 monitor · 1920×1080');
});

test('tiler: focus layout — big window plus a strip, mirrored for the left side', () => {
  const t = require('../src/main/modules/tiler');
  const area = { x: 0, y: 0, width: 2000, height: 1000 };
  const r = t.focusRects(3, area, { ratio: 0.8, gap: 0 });
  assert.equal(r.length, 3);
  assert.equal(Math.round(r[0].width), 1600);
  assert.equal(Math.round(r[1].x), 1600);
  assert.equal(Math.round(r[1].height), 500);
  const l = t.focusRects(3, area, { ratio: 0.8, gap: 0, side: 'left' });
  assert.equal(Math.round(l[0].x), 400);
  assert.equal(Math.round(l[1].x), 0);
  assert.equal(t.focusRects(1, area, { ratio: 0.8 })[0].width, 2000);
});

test('safe mode: flag, request and crash-loop detection', () => {
  const startup = require('../src/main/startup');
  const marker = paths.file('startup.json');
  try { fs.unlinkSync(marker); } catch { /* none */ }
  assert.equal(startup.decideSafeMode(['x']), null);
  assert.equal(startup.decideSafeMode(['x']), null); // second unfinished start
  assert.equal(startup.decideSafeMode(['x']), 'crashLoop', 'two starts that never became healthy');
  assert.equal(startup.decideSafeMode(['x']), null, 'counter reset after entering safe mode');
  startup.markHealthy();
  assert.equal(startup.decideSafeMode(['x', '--safe-mode']), 'flag');
  startup.markHealthy();
  startup.requestSafeNext(true);
  assert.equal(startup.decideSafeMode(['x']), 'requested');
  assert.equal(startup.decideSafeMode(['x']), null, 'only once');
  startup.markHealthy();
  assert.deepEqual(startup.early(), { diet: false });
});

test('settings: 1.8 defaults and hotkeys', () => {
  assert.equal(settings.get('hotkeys.focusMode'), 'Ctrl+Alt+F');
  assert.equal(settings.get('hotkeys.focusNext'), 'Ctrl+Alt+N');
  assert.equal(settings.get('performance.dietMode'), false);
  assert.equal(settings.get('tiling.perMonitorSetup'), true);
  assert.equal(settings.get('loginCheck.time'), '21:30');
  assert.equal(settings.get('phone.enabled'), false);
  assert.equal(settings.get('tour.enabled'), true);
  void stub;
});
