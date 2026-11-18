'use strict';
// 2.0.1: tiny windows (adapted from RoALT) and a more reliable phone dashboard.
require('./helpers/electron-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const paths = require('../src/main/paths');
paths.ensureDirs();
const settings = require('../src/main/modules/settings');
settings.init();
require('../src/main/modules/accounts').init();

// ---------- tiny windows ----------
test('tiny windows: the frame comes off for the resize only (style maths)', () => {
  const win32 = require('../src/main/native/win32');
  const normal = 0x16CF0000; // visible, clip children/siblings, overlapped window (title bar, sizing frame, buttons)
  const b = win32.borderlessStyle(normal);
  assert.equal(b >>> 0, 0x96000000, 'popup, nothing else of the frame');
  assert.equal(b & 0x00040000, 0, 'no sizing frame: Windows stops holding it to Roblox\'s minimum');
  assert.equal((b >>> 0) & 0x10000000, 0x10000000, 'still visible');
  assert.equal(win32.borderlessStyle(b) >>> 0, 0x96000000, 'doing it twice changes nothing');
});

test('tiny windows: layout cells of any size, wrapping when the screen is full', () => {
  const tiler = require('../src/main/modules/tiler');
  const area = { x: 0, y: 0, width: 1000, height: 600 };
  const cells = tiler.computeLayout('tiny', 14, area, { gap: 0, tinyCell: { width: 250, height: 200 } });
  assert.equal(cells.length, 14);
  assert.deepEqual(cells[0], { x: 0, y: 0, width: 250, height: 200 });
  assert.deepEqual(cells[5], { x: 250, y: 200, width: 250, height: 200 }, 'left to right, then the next row');
  assert.deepEqual(cells[11], { x: 750, y: 400, width: 250, height: 200 }, '4 × 3 fit');
  assert.deepEqual(cells[12], { x: 28, y: 28, width: 250, height: 200 }, 'the 13th starts over at the top, offset so it still shows');
  const micro = tiler.computeLayout('tiny', 2, area, { gap: 4, tinyCell: { width: 20, height: 16 } });
  assert.deepEqual(micro.map(c => [c.x, c.width, c.height]), [[0, 20, 16], [24, 20, 16]], 'as small as you like');
  const fixed = tiler.computeLayout('fixed', 3, area, { gap: 0, cellWidth: 100, cellHeight: 80 });
  assert.deepEqual([fixed[2].x, fixed[2].width, fixed[2].height], [200, 100, 80], 'Fixed size goes below 200 × 150 now');
  assert.equal(tiler.LAYOUTS.tiny, 'Tiny windows');
});

test('tiny windows: the tiny size is the game picture, the cell adds the frame', () => {
  const tiler = require('../src/main/modules/tiler');
  settings.set('perf.tinyW', 240); settings.set('perf.tinyH', 180);
  const c = tiler.tinyCell({ scaleFactor: 1 }, []);
  assert.deepEqual(c.client, { w: 240, h: 180 });
  assert.equal(c.width, 240 + 16 - 14, 'frame width without the invisible borders');
  assert.equal(c.height, 180 + 39 - 7);
  const hi = tiler.tinyCell({ scaleFactor: 1.5 }, []);
  assert.ok(Math.abs(hi.width - (240 + 24 - 22) / 1.5) < 0.01, 'in screen units at 150 %');
});

test('tiny windows: the sweep puts grown windows back, and leaves the rest alone', () => {
  const { decide, QUIET_MS } = require('../src/main/modules/tinykeep');
  const now = 1_000_000;
  const e = { w: 240, h: 180, setAt: now - QUIET_MS - 1 };
  const st = (o = {}) => ({ exists: true, minimized: false, maximized: false, hung: false, foreground: false, dragging: false, client: { w: 816, h: 638 }, ...o });
  assert.equal(decide(e, st(), now), 'fix', 'grown to Roblox\'s minimum after a restore');
  assert.equal(decide(e, st({ client: { w: 241, h: 179 } }), now), 'ok', 'a pixel off is fine');
  assert.equal(decide(e, st({ exists: false }), now), 'drop', 'closed');
  for (const k of ['minimized', 'maximized', 'hung', 'foreground', 'dragging']) assert.equal(decide(e, st({ [k]: true }), now), 'wait', k);
  assert.equal(decide({ ...e, setAt: now - 2000 }, st(), now), 'wait', 'just set on purpose');
});

test('tiny windows: kept and released per client', () => {
  const tk = require('../src/main/modules/tinykeep');
  tk.keep(4242, 300, 200);
  assert.ok(tk.has(4242));
  assert.deepEqual(tk.sizeOf(4242), { w: 300, h: 200 });
  tk.release(4242);
  assert.ok(!tk.has(4242));
  tk.keep(0, 300, 200); tk.keep(7, 0, 200);
  assert.ok(!tk.has(0) && !tk.has(7), 'nonsense is ignored');
});

// ---------- phone ----------
test('phone: Wi-Fi and Ethernet come before VPNs and virtual adapters', () => {
  const ph = require('../src/main/modules/phone');
  const v4 = (address) => [{ family: 'IPv4', address, internal: false }];
  const list = ph.lanAddresses({ NordLynx: v4('10.5.0.2'), 'vEthernet (WSL)': v4('172.22.16.1'), 'Wi-Fi': v4('10.0.0.23'), 'Ethernet 2': v4('192.168.1.40'), 'Radmin VPN': v4('26.1.2.3'), 'Loopback Pseudo-Interface 1': [{ family: 'IPv4', address: '127.0.0.1', internal: true }] });
  assert.deepEqual(list.map(a => a.name), ['Ethernet 2', 'Wi-Fi', 'vEthernet (WSL)', 'NordLynx']);
  assert.ok(list.find(a => a.name === 'NordLynx').virtual);
  assert.ok(!list.find(a => a.name === 'Wi-Fi').virtual);
});

test('phone: an action retried with the same id runs once', async () => {
  const ph = require('../src/main/modules/phone');
  let runs = 0;
  const job = () => { runs++; return new Promise(r => setTimeout(() => r({ ok: true, n: runs }), 20)); };
  const [a, b] = await Promise.all([ph.once('rid-aaaaaaaa1', job), ph.once('rid-aaaaaaaa1', job)]);
  assert.equal(runs, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(await ph.once('rid-aaaaaaaa1', job), a, 'a late retry gets the first answer');
  await ph.once('rid-bbbbbbbb2', job);
  assert.equal(runs, 2, 'another id runs');
  await ph.once(undefined, job); await ph.once(undefined, job);
  assert.equal(runs, 4, 'no id: every call runs');
  let fails = 0;
  await assert.rejects(ph.once('rid-ccccccccc3', () => { fails++; throw new Error('busy'); }));
  await ph.once('rid-ccccccccc3', () => { fails++; return { ok: true }; });
  assert.equal(fails, 2, 'a failed action can be tried again');
});

test('phone: "Check connection" explains Public networks, the firewall and VPNs', () => {
  const ph = require('../src/main/modules/phone');
  const wifi = { address: '192.168.1.20', name: 'Wi-Fi', virtual: false };
  const vpn = { address: '10.5.0.2', name: 'NordLynx', virtual: true };
  const win = (category, rules, fwOn = true) => ({ profiles: [{ alias: 'Wi-Fi', category }], rules, firewall: [{ name: category === 'DomainAuthenticated' ? 'Domain' : category, enabled: fwOn ? 'True' : 'False' }] });

  const pub = ph.parseCheck({ running: true, reachable: true, addr: wifi, all: [wifi], win: win('Public', [{ action: 'Allow', profile: 'Private' }, { action: 'Block', profile: 'Public' }]) });
  assert.equal(pub.ok, false);
  assert.ok(pub.items.some(i => i.level === 'err' && i.fix === 'network' && /Public network/.test(i.text)));
  assert.ok(pub.items.some(i => i.level === 'err' && i.fix === 'firewall'));
  assert.equal(pub.category, 'Public');

  const good = ph.parseCheck({ running: true, reachable: true, addr: wifi, all: [wifi, vpn], win: win('Private', [{ action: 'Allow', profile: 'Private' }, { action: 'Block', profile: 'Public' }]) });
  assert.equal(good.ok, true);
  assert.ok(good.items.some(i => i.level === 'ok' && /Firewall lets MultiMenu through/.test(i.text)));
  assert.ok(good.items.some(i => i.level === 'warn' && /VPN is on/.test(i.text)));

  const noRule = ph.parseCheck({ running: true, reachable: true, addr: wifi, all: [wifi], win: win('Private', []) });
  assert.ok(noRule.items.some(i => i.level === 'warn' && i.fix === 'firewall'), 'no rule yet: may be blocked');
  const fwOff = ph.parseCheck({ running: true, reachable: true, addr: wifi, all: [wifi], win: win('Private', [], false) });
  assert.ok(!fwOff.items.some(i => i.fix === 'firewall'), 'firewall off for that network');
  const any = ph.parseCheck({ running: true, reachable: true, addr: wifi, all: [wifi], win: win('Private', [{ action: 'Allow', profile: 'Any' }]) });
  assert.ok(any.ok);

  const viaVpn = ph.parseCheck({ running: true, reachable: true, addr: vpn, all: [vpn, wifi], win: null });
  assert.ok(viaVpn.items.some(i => i.level === 'warn' && /VPN or virtual adapter/.test(i.text)));
  const off = ph.parseCheck({ running: false, error: null, addr: wifi, all: [wifi], win: null });
  assert.equal(off.ok, false);
  const noNet = ph.parseCheck({ running: true, reachable: null, addr: null, all: [], win: null });
  assert.ok(noNet.items.some(i => /not on a home network/.test(i.text)));
});

test('phone: connections stay open past the phone\'s 5-second refresh, and retried actions run once', async () => {
  const ph = require('../src/main/modules/phone');
  ph.setPin('604213');
  settings.set('phone.allowControl', true);
  settings.set('phone.port', 0);
  const st = await ph.start();
  const port = st.port;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const req = (p, opts = {}) => new Promise((res, rej) => {
    const q = http.request({ host: '127.0.0.1', port, agent, path: p, method: opts.method || 'GET', headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } }, (r) => {
      let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res({ status: r.statusCode, headers: r.headers, json: (() => { try { return JSON.parse(b); } catch { return null; } })() }));
    });
    q.on('error', rej); if (opts.body) q.write(JSON.stringify(opts.body)); q.end();
  });
  try {
    const login = await req('/api/login', { method: 'POST', body: { pin: '604213' } });
    assert.equal(login.status, 200);
    const ka = /timeout=(\d+)/.exec(login.headers['keep-alive'] || '');
    assert.ok(ka && Number(ka[1]) >= 30, `keep-alive ${login.headers['keep-alive']}`);
    const auth = { Authorization: `Bearer ${login.json.token}` };
    const watcher = require('../src/main/modules/watcher');
    const before = watcher.status().enabled;
    const body = { on: !before, rid: 'a1b2c3d4e5f6a1b2c3d4e5f6' };
    const one = await req('/api/action/watcher', { method: 'POST', body, headers: auth });
    const two = await req('/api/action/watcher', { method: 'POST', body: { ...body, on: before }, headers: auth });
    assert.deepEqual(two.json, one.json, 'the retry got the first answer');
    assert.equal(watcher.status().enabled, !before, 'and changed nothing');
    watcher.setEnabled(before);
  } finally { agent.destroy(); ph.stop(); settings.set('phone.port', 43821); }
});
