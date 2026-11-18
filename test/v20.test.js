'use strict';
// 2.0: tiers, tags, saved filters, recycle bin, and the rest of the 2.0 features.
require('./helpers/electron-stub');
const test = require('node:test');
const assert = require('node:assert/strict');

const paths = require('../src/main/paths');
paths.ensureDirs();
const settings = require('../src/main/modules/settings');
settings.init();
const accounts = require('../src/main/modules/accounts');
accounts.init();

const mk = (id, extra = {}) => ({ id, userId: 1000 + id.charCodeAt(0), username: `user_${id}`, displayName: id, group: 'Alts', favourite: false, order: 0, status: 'valid', cookieEnc: 'enc:v1:x', ...extra });
function seed(list) { accounts.raw().accounts.length = 0; accounts.raw().accounts.push(...list); }

test('accounts: tiers, tags and hotkey slots', () => {
  seed([mk('a'), mk('b'), mk('c', { order: 2 })]);
  const a = accounts.update('a', { tier: 'main', tags: ['Farm', ' farm ', 'Trade Bot!!', ''], slot: 3 });
  assert.equal(a.tier, 'main');
  assert.deepEqual(a.tags, ['farm', 'trade bot']);
  assert.equal(a.slot, 3);
  assert.equal(accounts.publicView(accounts.find('b')).tier, 'filler', 'default tier');
  accounts.update('b', { slot: 3 });
  assert.equal(accounts.find('a').slot, null, 'a slot belongs to one account');
  assert.throws(() => accounts.update('b', { slot: 12 }), /1–9/);
  assert.throws(() => accounts.update('b', { tier: 'boss' }), /priority/);
  accounts.update('c', { tier: 'important' });
  accounts.autoSlots();
  assert.deepEqual(['a', 'c', 'b'].map(id => accounts.find(id).slot), [1, 2, 3], 'Main first, then Important');
  assert.deepEqual(accounts.byTier(['b', 'c', 'a']), ['a', 'c', 'b']);
});

test('accounts: bulk tags add and remove', () => {
  seed([mk('a', { tags: ['farm'] }), mk('b', { tags: ['farm', 'old'] })]);
  accounts.bulkUpdate(['a', 'b'], { tagsAdd: ['squad'], tagsRemove: ['old'], tier: 'important' });
  assert.deepEqual(accounts.find('a').tags, ['farm', 'squad']);
  assert.deepEqual(accounts.find('b').tags, ['farm', 'squad']);
  assert.equal(accounts.find('b').tier, 'important');
  assert.deepEqual(accounts.allTags().map(t => [t.tag, t.count]), [['farm', 2], ['squad', 2]]);
});

test('accounts: resolve by name, tag, group and tier', () => {
  seed([mk('a', { alias: 'Main', tier: 'main', tags: ['farm'] }), mk('b', { tags: ['farm'], group: 'Farm' }), mk('c')]);
  assert.deepEqual(accounts.resolve('tag:farm').map(a => a.id), ['a', 'b']);
  assert.deepEqual(accounts.resolve('group:farm').map(a => a.id), ['b']);
  assert.deepEqual(accounts.resolve('tier:filler').map(a => a.id), ['b', 'c']);
  assert.deepEqual(accounts.resolve('main').map(a => a.id), ['a']);
  assert.deepEqual(accounts.resolve('user_c').map(a => a.id), ['c']);
  assert.equal(accounts.resolve('all').length, 3);
  assert.deepEqual(accounts.resolve('nobody'), []);
});

test('accounts: saved filters match accounts', () => {
  seed([mk('a', { tier: 'main', tags: ['farm'], notes: 'pet sim' }), mk('b', { status: 'expired' })]);
  const f = accounts.saveFilter('Farmers', { tag: 'Farm', tier: 'main', bogus: 1 });
  assert.equal(f.length, 1);
  assert.deepEqual(f[0].q, { text: '', group: '', tag: 'farm', tier: 'main', status: '' });
  assert.equal(accounts.matches(accounts.find('a'), f[0].q), true);
  assert.equal(accounts.matches(accounts.find('b'), f[0].q), false);
  assert.equal(accounts.matches(accounts.find('a'), { text: 'PET sim' }), true);
  assert.equal(accounts.matches(accounts.find('b'), { status: 'expired' }), true);
  accounts.saveFilter('farmers', { tag: 'x' });
  assert.equal(accounts.filters().length, 1, 'same name replaces');
  accounts.removeFilter(f[0].id);
  assert.equal(accounts.filters().length, 0);
});

test('accounts: removing goes to the recycle bin and can be restored', () => {
  seed([mk('a', { slot: 2 }), mk('b')]);
  settings.set('accounts.binDays', 30);
  assert.equal(accounts.remove('a'), true);
  assert.equal(accounts.find('a'), undefined);
  const bin = accounts.binList();
  assert.equal(bin.length, 1);
  assert.equal(bin[0].id, 'a');
  assert.ok(!('cookieEnc' in bin[0]), 'the bin view has no secrets');
  assert.equal(accounts.restore('a').id, 'a');
  assert.ok(accounts.find('a'));
  assert.equal(accounts.find('a').slot, null, 'slot is freed while in the bin');
  accounts.remove('a');
  assert.equal(accounts.pruneBin(Date.now() + 29 * 86400000), 0);
  assert.equal(accounts.pruneBin(Date.now() + 31 * 86400000), 1, 'gone after 30 days');
  accounts.remove('b', { forever: true });
  assert.equal(accounts.binList().length, 0, 'delete forever skips the bin');
  seed([mk('c')]);
  settings.set('accounts.binDays', 0);
  accounts.remove('c');
  assert.equal(accounts.binList().length, 0, '0 days deletes straight away');
  settings.set('accounts.binDays', 30);
});

test('accounts: restoring when the same Roblox account was added again keeps the new one', () => {
  seed([mk('a')]);
  accounts.remove('a');
  accounts.raw().accounts.push(mk('z', { userId: 1000 + 'a'.charCodeAt(0) }));
  assert.throws(() => accounts.restore('a'), /already/);
  assert.equal(accounts.binList().length, 0);
});

test('presets: a preset can follow a tag', () => {
  seed([mk('a', { tags: ['farm'], tier: 'filler' }), mk('b', { tags: ['farm'], tier: 'main' }), mk('c')]);
  const presets = require('../src/main/modules/presets');
  presets.init();
  const v = presets.validate({ name: 'Farm', tag: 'Farm', accountIds: ['c'] });
  assert.equal(v.tag, 'farm');
  assert.deepEqual(v.accountIds, [], 'tag presets keep no fixed list');
  assert.deepEqual(presets.idsOf(v), ['b', 'a'], 'Main first');
  assert.throws(() => presets.validate({ name: 'x', accountIds: [] }), /at least one/);
});

// ---------- commands, local API, command line, Stream Deck ----------
const http = require('http');
const crypto = require('crypto');

test('commands: command-line words become named arguments', () => {
  const c = require('../src/main/modules/commands');
  assert.deepEqual(c.parseArgs('launch', ['tag:farm', '920587237']), { who: 'tag:farm', game: '920587237' });
  assert.deepEqual(c.parseArgs('launch', ['Main', '--game', '123']), { who: 'Main', game: '123' });
  assert.deepEqual(c.parseArgs('launch', ['--game=5', 'x']), { game: '5', who: 'x' });
  assert.deepEqual(c.parseArgs('preset', ['Morning', 'stop']), { name: 'Morning', action: 'stop' });
  assert.deepEqual(c.parseArgs('watcher', ['on']), { state: 'on' });
  assert.equal(c.onOff('ON'), true); assert.equal(c.onOff('off'), false); assert.equal(c.onOff('toggle'), null);
  assert.throws(() => c.onOff('maybe'), /on, off/);
});

test('commands: accounts list has no secrets and help lists every command', async () => {
  seed([mk('a', { alias: 'Main', tier: 'main', tags: ['farm'], passwordEnc: 'enc:v1:pw', slot: 1 })]);
  const c = require('../src/main/modules/commands');
  const r = await c.run('accounts', [], { source: 'test' });
  assert.equal(r.ok, true);
  const json = JSON.stringify(r);
  assert.ok(!/enc:v1|cookie|password/i.test(json), 'no secrets in the reply');
  assert.deepEqual(r.data.accounts[0], { id: 'a', name: 'Main', username: 'user_a', tier: 'main', tags: ['farm'], group: 'Alts', status: 'valid', slot: 1, running: false });
  const h = await c.run('help');
  for (const k of ['status', 'launch', 'preset', 'focus', 'eco', 'rotation', 'scale', 'doctor']) assert.ok(h.data.commands.includes(k), k);
  await assert.rejects(c.run('format-c'), /Unknown command/);
  await assert.rejects(c.run('launch', { who: 'nobody' }), /No account matches/);
});

function req(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let s = ''; res.on('data', d => { s += d; }); res.on('end', () => resolve({ status: res.statusCode, json: s ? JSON.parse(s) : null, headers: res.headers }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

test('local API: loopback only, needs the key, refuses browsers and odd hosts', async () => {
  const api = require('../src/main/modules/api');
  settings.set('api.port', 43000 + Math.floor(Math.random() * 900));
  await api.setEnabled(true);
  const port = api.status().port;
  const key = api.key();
  assert.match(key, /^mm_[\w-]{20,}$/);
  assert.ok(!settings.get('api.keyEnc').includes(key), 'stored encrypted (stub prefixes it)');
  assert.equal((await req(port, { path: '/api/v1/ping' })).json.ok, true);
  assert.equal((await req(port, { path: '/api/v1/status' })).status, 401);
  assert.equal((await req(port, { path: '/api/v1/status', headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const ok = await req(port, { path: '/api/v1/accounts', headers: { Authorization: `Bearer ${key}` } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
  assert.equal(ok.headers['access-control-allow-origin'], undefined, 'no CORS');
  assert.equal((await req(port, { path: '/api/v1/accounts', headers: { Authorization: `Bearer ${key}`, Host: 'evil.example:80' } })).status, 421);
  assert.equal((await req(port, { path: '/api/v1/accounts', headers: { Authorization: `Bearer ${key}`, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await req(port, { path: '/api/v1/tile', headers: { 'X-MultiMenu-Key': key } })).status, 405, 'actions need POST');
  const bad = await req(port, { method: 'POST', path: '/api/v1/launch', headers: { Authorization: `Bearer ${key}` }, body: { who: 'nobody' } });
  assert.equal(bad.status, 404);
  assert.match(bad.json.error, /No account/);
  const old = key;
  api.newKey();
  assert.equal((await req(port, { path: '/api/v1/accounts', headers: { Authorization: `Bearer ${old}` } })).status, 401, 'old key stops working');
  await api.setEnabled(false);
  assert.equal(api.status().running, false);
});

test('local API: wrong keys are rate-limited', async () => {
  const api = require('../src/main/modules/api');
  settings.set('api.port', 44000 + Math.floor(Math.random() * 900));
  await api.setEnabled(true);
  const port = api.status().port;
  for (let i = 0; i < 10; i++) await req(port, { path: '/api/v1/status', headers: { Authorization: `Bearer nope${i}` } });
  assert.equal((await req(port, { path: '/api/v1/status', headers: { Authorization: `Bearer ${api.key()}` } })).status, 429);
  await api.setEnabled(false);
});

test('command line: talks to the running app over its pipe', async () => {
  const cli = require('../src/main/cli');
  const dir = require('path').join(require('os').tmpdir(), `mm-cli-${Date.now()}`);
  cli.startServer(dir);
  await new Promise(r => setTimeout(r, 50));
  const r = await cli.send(dir, 'accounts', []);
  assert.equal(r.ok, true);
  const e = await cli.send(dir, 'nope', []);
  assert.equal(e.ok, false);
  assert.match(e.error, /Unknown command/);
  assert.deepEqual(cli.parseCli(['MultiMenu.exe', '--cli', 'launch', 'tag:farm', '--json', '--out=C:\\t\\o.txt']), { cmd: 'launch', args: ['tag:farm'], json: true, out: 'C:\\t\\o.txt' });
  cli.stopServer();
  await assert.rejects(cli.send(require('path').join(dir, 'other'), 'status', []), /isn't running/);
});

test('stream deck: plugin WebSocket client speaks to a WebSocket server', async () => {
  const { WS } = require('../streamdeck/com.multimenu.app.sdPlugin/bin/plugin.js');
  const got = [];
  const server = http.createServer();
  server.on('upgrade', (rq, sock) => {
    const accept = crypto.createHash('sha1').update(`${rq.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sock.on('data', (d) => {
      const len = d[1] & 0x7f; const mask = d.slice(2, 6);
      const text = Buffer.from(d.slice(6, 6 + len).map((x, i) => x ^ mask[i % 4])).toString();
      got.push(JSON.parse(text));
      const reply = Buffer.from(JSON.stringify({ event: 'keyDown', n: 'x'.repeat(200) }));
      sock.write(Buffer.concat([Buffer.from([0x81, 126, reply.length >> 8, reply.length & 255]), reply]));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const msgs = await new Promise((resolve) => {
    const ws = new WS(server.address().port, () => ws.send({ event: 'registerPlugin', uuid: 'u1' }), (t) => { resolve(JSON.parse(t)); ws.sock.destroy(); }, () => {});
  });
  server.close();
  assert.deepEqual(got[0], { event: 'registerPlugin', uuid: 'u1' });
  assert.equal(msgs.event, 'keyDown');
  assert.equal(msgs.n.length, 200, '16-bit length frames');
});

test('stream deck: manifest actions all have images and a handler', () => {
  const fs = require('fs'); const path = require('path');
  const dir = path.join(__dirname, '..', 'streamdeck', 'com.multimenu.app.sdPlugin');
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const src = fs.readFileSync(path.join(dir, 'bin', 'plugin.js'), 'utf8');
  assert.equal(m.SDKVersion, 2);
  for (const a of m.Actions) {
    assert.ok(fs.existsSync(path.join(dir, `${a.Icon}.png`)) && fs.existsSync(path.join(dir, `${a.Icon}@2x.png`)), a.Icon);
    for (const st of a.States) assert.ok(fs.existsSync(path.join(dir, `${st.Image}@2x.png`)), st.Image);
    assert.ok(src.includes(`A('${a.UUID.split('.').pop()}')`), `handler for ${a.UUID}`);
  }
});

// ---------- overlay, rotation, auto-scale, smart launches, game profiles ----------
test('overlay: label text follows the settings', () => {
  const o = require('../src/main/modules/overlay');
  const now = 10_000_000;
  const s = { label: 'Farm 2 (opened outside MultiMenu)', ping: 48, startedAt: now - 75 * 60000, memMB: 1536, watchState: 'not responding' };
  const l = o.labelFor(s, { slot: 3, tier: 'main' }, { fps: true, ping: true, uptime: true, mem: true }, 59.6, now);
  assert.deepEqual(l, { name: 'Farm 2', slot: 3, tier: 'main', info: '60 FPS · 48 ms · 1h 15m · 1.5 GB', state: 'bad' });
  assert.equal(o.labelFor({ ...s, watchState: 'loading' }, null, { fps: false, ping: false, uptime: false, mem: false }, null, now).info, '');
  assert.equal(o.labelFor({ ...s, watchState: 'loading' }, null, {}, null, now).state, 'warn');
});

test('rotation: picks the next alts round the pool', () => {
  const { pickNext } = require('../src/main/modules/rotation');
  assert.deepEqual(pickNext(['a', 'b', 'c', 'd', 'e'], 0, 2), { next: ['a', 'b'], cursor: 2 });
  assert.deepEqual(pickNext(['a', 'b', 'c', 'd', 'e'], 4, 2), { next: ['e', 'a'], cursor: 1 });
  assert.deepEqual(pickNext(['a', 'b'], 1, 5), { next: ['b', 'a'], cursor: 1 }, 'never more than the pool');
  assert.deepEqual(pickNext([], 3, 2), { next: [], cursor: 0 });
  assert.deepEqual(pickNext(['a', 'b', 'c'], 7, 1), { next: ['b'], cursor: 2 }, 'cursor past the end wraps');
});

test('auto-scale: launches with room, closes Filler first when low, never Main', () => {
  const { decide } = require('../src/main/modules/autoscale');
  const c = { budget: 'free', freeGB: 2, capGB: 12, cpuMax: 85, min: 0, max: 10 };
  const run = [
    { id: 's1', accountId: 'm', tier: 'main', startedAt: 1, memMB: 1200, mine: false },
    { id: 's2', accountId: 'i', tier: 'important', startedAt: 3, memMB: 1100, mine: true },
    { id: 's3', accountId: 'f', tier: 'filler', startedAt: 2, memMB: 1000, mine: false },
  ];
  assert.equal(decide({ cfg: c, freeMB: 8000, robloxMB: 3300, cpu: 30, running: run, candidates: ['x'] }).action, 'up');
  assert.equal(decide({ cfg: c, freeMB: 3000, robloxMB: 3300, cpu: 30, running: run, candidates: ['x'] }).action, 'hold', 'not enough room');
  assert.equal(decide({ cfg: c, freeMB: 8000, robloxMB: 3300, cpu: 80, running: run, candidates: ['x'] }).action, 'hold', 'CPU too busy');
  assert.equal(decide({ cfg: { ...c, max: 3 }, freeMB: 8000, robloxMB: 3300, cpu: 30, running: run, candidates: ['x'] }).action, 'hold', 'at max');
  assert.equal(decide({ cfg: c, freeMB: 8000, robloxMB: 3300, cpu: 30, running: run, candidates: ['x'], quiet: true }).action, 'hold', 'quiet hours');
  const now = 1_000_000;
  assert.equal(decide({ cfg: c, freeMB: 1000, robloxMB: 3300, cpu: 30, running: run, candidates: [], now, overSince: now - 5000 }).action, 'hold', 'must stay low for a while');
  const d = decide({ cfg: c, freeMB: 1000, robloxMB: 3300, cpu: 30, running: run, candidates: [], now, overSince: now - 40000 });
  assert.equal(d.action, 'down'); assert.equal(d.sessionId, 's3', 'Filler goes first');
  const d2 = decide({ cfg: c, freeMB: 1000, robloxMB: 3300, cpu: 30, running: run.slice(0, 2), candidates: [], now, overSince: now - 40000 });
  assert.equal(d2.sessionId, 's2');
  const d3 = decide({ cfg: c, freeMB: 1000, robloxMB: 3300, cpu: 30, running: run.slice(0, 1), candidates: [], now, overSince: now - 40000 });
  assert.equal(d3.action, 'hold', 'Main is never closed');
  const d4 = decide({ cfg: { ...c, min: 3 }, freeMB: 1000, robloxMB: 3300, cpu: 30, running: run, candidates: [], now, overSince: now - 40000 });
  assert.equal(d4.action, 'hold', 'never below the minimum');
  const cap = decide({ cfg: { ...c, budget: 'cap', capGB: 3 }, freeMB: 9000, robloxMB: 3300, cpu: 30, running: run, candidates: [], now, overSince: now - 40000 });
  assert.equal(cap.action, 'down', 'Roblox over its RAM cap');
});

test('smart launches: waits for three calm CPU seconds, gives up at the limit', async () => {
  const sessions = require('../src/main/modules/sessions');
  assert.equal(Math.round(sessions.busyPercent({ idle: 100, total: 200 }, { idle: 150, total: 300 })), 50);
  settings.set('launch.cpuSettle', 70); settings.set('launch.maxWaitSec', 45);
  const busy = [95, 90, 40, 80, 30, 20, 25, 90];
  let i = 0, idle = 0, total = 0;
  const sample = () => { const b = busy[Math.min(i++, busy.length - 1)]; idle += 100 - b; total += 100; return { idle, total }; };
  sample(); i = 0; idle = 0; total = 0;
  const r = await sessions.settle({ minMs: 0, sample, sleep: async () => {} });
  assert.ok(!r.timedOut);
  assert.ok(r.cpu < 70);
  settings.set('launch.maxWaitSec', 5);
  const t0 = Date.now();
  const r2 = await sessions.settle({ minMs: 0, sample: () => { idle += 5; total += 100; return { idle, total }; }, sleep: (ms) => new Promise(res => setTimeout(res, Math.min(ms, 400))) });
  assert.equal(r2.timedOut, true);
  assert.ok(Date.now() - t0 >= 5000);
  settings.set('launch.maxWaitSec', 45);
});

test('game profiles: graphics, layout and watcher limits follow the game', () => {
  const gp = require('../src/main/modules/gameprofiles');
  gp.init();
  assert.throws(() => gp.validate({ placeId: 'abc' }), /place ID/);
  gp.save({ placeId: '920587237', name: 'Adopt Me!', graphics: { enabled: true, quality: 2, fpsCap: 30 }, layout: 'grid3', watcher: { stuckMin: 8, freezeSec: 5, maxPerHour: 0 } });
  assert.deepEqual(gp.graphicsFor('920587237'), { quality: 2, fpsCap: 30 });
  assert.equal(gp.graphicsFor('1'), null);
  assert.equal(gp.layoutFor([{ placeId: '920587237' }, { placeId: '920587237' }, { external: true }]), 'grid3');
  assert.equal(gp.layoutFor([{ placeId: '920587237' }, { placeId: '1' }]), null, 'mixed games use your layout');
  const base = { stuckMin: 5, freezeSec: 120, maxPerHour: 6, enabled: true };
  assert.deepEqual(gp.watcherFor(base, '920587237'), { stuckMin: 8, freezeSec: 120, maxPerHour: 6, enabled: true }, 'freezeSec 5 is out of range so it stays normal');
  gp.save({ placeId: '920587237', name: 'Adopt Me!', layout: 'nonsense' });
  assert.equal(gp.list().length, 1, 'one profile per game');
  assert.equal(gp.forPlace('920587237').layout, '');
  gp.remove('920587237');
  assert.equal(gp.list().length, 0);
});

// ---------- automations & spoken alerts ----------
test('automations: rules are cleaned before saving', () => {
  const au = require('../src/main/modules/automations');
  au.init();
  assert.throws(() => au.validate({ name: '', trigger: { type: 'problem' }, actions: [{ type: 'tile' }] }), /name/);
  assert.throws(() => au.validate({ name: 'x', trigger: { type: 'format-disk' }, actions: [{ type: 'tile' }] }), /starts/);
  assert.throws(() => au.validate({ name: 'x', trigger: { type: 'problem' }, actions: [{ type: 'runProgram', path: 'C:\\evil.exe' }] }), /at least one/);
  assert.throws(() => au.validate({ name: 'x', trigger: { type: 'problem' }, actions: [{ type: 'wait', seconds: 5 }] }), /besides waiting/);
  const v = au.validate({ name: ' Night ', trigger: { type: 'time', time: '7:05', days: [1, 9, 'x'] }, conditions: [{ type: 'clients', op: '!', n: '3' }, { type: 'nope' }], actions: [{ type: 'wait', seconds: 9999 }, { type: 'close', who: 'tag:farm', extra: 'dropped' }] });
  assert.deepEqual(v.trigger, { type: 'time', time: '07:05', days: [1] });
  assert.deepEqual(v.conditions, [{ type: 'clients', op: '<', n: 3 }]);
  assert.deepEqual(v.actions, [{ type: 'wait', seconds: 600 }, { type: 'close', who: 'tag:farm' }]);
  assert.equal(au.validate({ name: 'x', trigger: { type: 'every', minutes: 1 }, actions: [{ type: 'tile' }] }).trigger.minutes, 5, 'at least every 5 minutes');
});

test('automations: triggers, conditions and text placeholders', () => {
  const au = require('../src/main/modules/automations');
  seed([mk('a', { alias: 'Farm 1', tags: ['farm'] }), mk('b')]);
  assert.equal(au.triggerMatches({ type: 'problem', kind: 'any' }, { type: 'problem', kind: 'freeze' }), true);
  assert.equal(au.triggerMatches({ type: 'problem', kind: 'crash' }, { type: 'problem', kind: 'freeze' }), false);
  assert.equal(au.triggerMatches({ type: 'started' }, { type: 'stopped' }), false);
  const night = { now: new Date(2026, 0, 5, 23, 30), clients: 4, ram: 70, away: true, watcher: true };
  assert.equal(au.conditionOk({ type: 'between', start: '22:00', end: '06:00' }, {}, night), true, 'across midnight');
  assert.equal(au.conditionOk({ type: 'between', start: '08:00', end: '22:00' }, {}, night), false);
  assert.equal(au.conditionOk({ type: 'days', days: [1] }, {}, night), true, '5 Jan 2026 is a Monday');
  assert.equal(au.conditionOk({ type: 'clients', op: '>', n: 3 }, {}, night), true);
  assert.equal(au.conditionOk({ type: 'ram', op: '<', percent: 60 }, {}, night), false);
  assert.equal(au.conditionOk({ type: 'who', who: 'tag:farm' }, { accountId: 'a' }, night), true);
  assert.equal(au.conditionOk({ type: 'who', who: 'tag:farm' }, { accountId: 'b' }, night), false);
  assert.equal(au.conditionOk({ type: 'who', who: 'tag:farm' }, {}, night), false, 'no alt in the event');
  assert.equal(au.fill('{account} in {game}: {detail} ({clients} running)', { label: 'Farm 1', placeId: '42', detail: 'Error 277' }, night), 'Farm 1 in Place 42: Error 277 (4 running)');
});

test('automations: an event runs matching rules, with cooldowns', async () => {
  const au = require('../src/main/modules/automations');
  const bus = require('../src/main/bus');
  seed([mk('a', { alias: 'Farm 1', tags: ['farm'] }), mk('b')]);
  const seen = [];
  const on = (n) => seen.push(n);
  bus.on('notify', on);
  au.save({ name: 'Farm crash', trigger: { type: 'problem', kind: 'crash' }, conditions: [{ type: 'who', who: 'tag:farm' }], actions: [{ type: 'notify', text: '{account} crashed' }], cooldownSec: 60 });
  assert.equal(await au.handle({ type: 'problem', kind: 'crash', accountId: 'b', label: 'user_b' }), 0, 'condition fails');
  assert.equal(await au.handle({ type: 'problem', kind: 'freeze', accountId: 'a', label: 'Farm 1' }), 0, 'wrong problem');
  assert.equal(await au.handle({ type: 'problem', kind: 'crash', accountId: 'a', label: 'Farm 1' }), 1);
  assert.equal(await au.handle({ type: 'problem', kind: 'crash', accountId: 'a', label: 'Farm 1' }), 0, 'cooldown');
  bus.off('notify', on);
  const n = seen.find(x => x.title === 'Farm crash');
  assert.equal(n.message, 'Farm 1 crashed');
  assert.equal(au.runLog()[0].steps[0], 'Notified');
  for (const r of au.list()) au.remove(r.id);
});

test('automations: too many runs in a minute pauses them', async () => {
  const au = require('../src/main/modules/automations');
  const bus = require('../src/main/bus');
  let paused = false;
  const on = (n) => { if (n.title === 'Automations paused') paused = true; };
  bus.on('notify', on);
  au.save({ name: 'Loop', trigger: { type: 'started' }, actions: [{ type: 'notify', text: 'x' }], cooldownSec: 0 });
  let ran = 0;
  for (let i = 0; i < 25; i++) ran += await au.handle({ type: 'started', accountId: 'a', label: 'a' });
  bus.off('notify', on);
  assert.ok(ran <= 20, `ran ${ran}`);
  assert.equal(paused, true);
  for (const r of au.list()) au.remove(r.id);
});

test('speech: sentences for app events', () => {
  const sp = require('../src/main/modules/speech');
  assert.equal(sp.sentence({ type: 'accountCrashed', account: 'Farm 2' }), 'Farm 2 crashed');
  assert.equal(sp.sentence({ type: 'robloxOutage' }), 'Roblox is having an outage');
  assert.equal(sp.sentence({ type: 'accountLaunched', account: 'x' }), null, 'not every event is spoken');
});

// ---------- health score, insights, timeline, achievements, Wrapped ----------
test('health score: logins, bans and problems lower it', () => {
  const hs = require('../src/main/modules/healthscore');
  const now = Date.now();
  const fresh = { status: 'valid', checkedAt: now - 3600e3 };
  assert.deepEqual(hs.compute(fresh, {}, now), { score: 100, grade: 'great', reasons: [] });
  assert.equal(hs.compute({ ...fresh, status: 'expired' }, {}, now).score, 30);
  assert.equal(hs.compute({ ...fresh, health: { state: 'banned', checkedAt: now } }, {}, now).score, 20);
  const r = hs.compute(fresh, { uptimeMs: 2 * 86400000, crashes: 4, disconnects: 2, freezes: 2, memRestarts: 1 }, now);
  assert.equal(r.score, 100 - 20 - 10 - 3);
  assert.deepEqual(r.reasons.map(x => x.text), ['4 crashes this week', '4 disconnects or freezes this week', 'Restarted 1 time for memory']);
  assert.equal(hs.compute({ status: 'valid', checkedAt: now - 8 * 86400000 }, {}, now).score, 95, 'not checked for a week');
  assert.equal(hs.compute({ status: 'expired', health: { state: 'banned' } }, { crashes: 50, uptimeMs: 1 }, now).score, 0, 'never below 0');
});

test('insights: tips come from the data', () => {
  const ins = require('../src/main/modules/insights');
  const now = new Date(2026, 5, 10, 12).getTime();
  const accounts = [
    { id: 'a', username: 'u_a', alias: 'Farm 1', status: 'valid', createdAt: now - 90 * 864e5, lastUsedAt: now },
    { id: 'b', username: 'u_b', status: 'expired', createdAt: now - 90 * 864e5 },
    { id: 'c', username: 'u_c', status: 'valid', createdAt: now - 90 * 864e5, lastUsedAt: now - 60 * 864e5 },
    { id: 'd', username: 'u_d', status: 'valid', createdAt: now - 90 * 864e5, lastUsedAt: now - 45 * 864e5 },
  ];
  const at3 = (d) => new Date(2026, 5, 10 - d, 3, 10).getTime();
  const events = [1, 2, 3, 4, 5].map(d => ({ type: 'disconnect', at: at3(d) })).concat([{ type: 'disconnect', at: new Date(2026, 5, 9, 15).getTime() }]);
  const list = ins.compute({ accounts, week: { a: { crashes: 4, uptimeMs: 864e5 } }, events, overview: { topGames: [{ name: 'Adopt Me!', hours: 12 }], streak: { current: 8 } }, ramHistory: Array(30).fill(91), running: 4, cfg: { watcher: false, backups: false }, profiles: 0, now });
  const ids = list.map(i => i.id);
  for (const want of ['crashy:a', 'dishour:3', 'expired:1', 'idle:2', 'ram', 'watcher', 'profile:Adopt Me!', 'streak:8']) assert.ok(ids.includes(want), want);
  assert.equal(list.find(i => i.id === 'crashy:a').title, 'Farm 1 crashed 4 times this week');
  assert.equal(ins.compute({ accounts: [], now }).length, 0, 'nothing to say without data');
});

test('timeline: spans are grouped per alt and clipped to the range', () => {
  const tl = require('../src/main/modules/timeline');
  const H = 3600000, to = 100 * H, from = to - 24 * H;
  const spans = [
    { id: '1', accountId: 'a', label: 'Main', start: to - 30 * H, end: to - 20 * H, reason: 'closed', game: 'G' },
    { id: '2', accountId: 'a', label: 'Main', start: to - 2 * H, end: null, game: 'G' },
    { id: '3', accountId: 'b', label: 'Alt', start: to - 50 * H, end: to - 40 * H },
  ];
  const marks = [{ at: to - 21 * H, kind: 'crash', accountId: 'a', label: 'Main' }, { at: to - 30 * H, kind: 'crash', accountId: 'a' }];
  const rows = tl.group(spans, marks, from, to, to);
  assert.equal(rows.length, 1, 'b is outside the range');
  assert.equal(rows[0].spans.length, 2);
  assert.equal(rows[0].spans[0].start, from, 'clipped to the start of the range');
  assert.equal(rows[0].ms, 6 * H);
  assert.equal(rows[0].marks.length, 1);
  assert.equal(rows[0].spans[1].live, true);
});

test('achievements: progress and unlocking', () => {
  const ach = require('../src/main/modules/achievements');
  const ctx = { launches: 3, accounts: 12, concurrent: 6, hours: 30, longestH: 13, nightOwl: true, streak: 2, rejoins: 40, tags: 5, automationRuns: 0, commands: 1, phone: 0, tiles: 49, shares: 0, doctorOk: 0, eco: 0 };
  const p = Object.fromEntries(ach.progress(ctx, { remote: 123 }).map(a => [a.id, a]));
  for (const id of ['first', 'alts10', 'run5', 'hours24', 'marathon', 'nightowl', 'tags', 'commander']) assert.equal(p[id].done, true, id);
  for (const id of ['alts25', 'run10', 'ironman', 'streak7', 'tiler', 'automator']) assert.equal(p[id].done, false, id);
  assert.equal(p.remote.done, true, 'stays unlocked');
  assert.deepEqual([p.tiler.current, p.tiler.goal], [49, 50]);
  assert.equal(ach.LIST.length, new Set(ach.LIST.map(a => a[0])).size, 'unique ids');
});

test('wrapped: yearly numbers and a personality', () => {
  const stats = require('../src/main/modules/stats');
  const H = 3600000;
  const days = { '2026-01-05': { a: { uptimeMs: 10 * H, launches: 2, crashes: 0, disconnects: 1, freezes: 0, rejoins: 1, memRestarts: 0 } }, '2026-03-02': { b: { uptimeMs: 5 * H, launches: 1, crashes: 1, disconnects: 0, freezes: 0, rejoins: 0, memRestarts: 0 } } };
  const r = stats.compute({ days, games: { '2026-01-05': { 'Adopt Me!': 10 * H } }, labels: { a: 'Main', b: 'Alt' } }, '2026-03-10');
  assert.equal(r.year.month, '2026');
  assert.equal(r.year.hours, 15);
  assert.equal(r.year.accountsUsed, 2);
  assert.deepEqual(r.year.topAccounts.map(a => a.label), ['Main', 'Alt']);
  assert.equal(r.year.topGames[0].name, 'Adopt Me!');
  assert.equal(r.wrapped.hours, 5, 'this month only');
  assert.equal(stats.personality({ accountsUsed: 9, hours: 1, rejoins: 0, activeDays: 1, problems: 0 }).title, 'Farm Tycoon');
  assert.equal(stats.personality({ accountsUsed: 1, hours: 60, rejoins: 0, activeDays: 10, problems: 0 }).title, 'Smooth Operator');
  assert.equal(stats.personality({ accountsUsed: 1, hours: 1, rejoins: 0, activeDays: 1, problems: 0 }).title, 'Rising Star');
});

// ---------- alt performance (RoALT-style presets, flags, measure) ----------
test('lighter rendering: allowlisted flags for each choice', () => {
  const rf = require('../src/main/modules/rflags');
  const has = (o, k) => Object.fromEntries(rf.flagsOf(o))[k];
  const base = { msaa: 'x1', texture: 'lowest', mode: 'default', graySky: false, noGrass: true, lowestQuality: true, pauseLighting: false };
  assert.equal(has(base, 'FIntDebugForceMSAASamples'), '1');
  assert.equal(has(base, 'DFIntTextureQualityOverride'), '0');
  assert.equal(has(base, 'DFFlagTextureQualityOverrideEnabled'), 'True');
  assert.equal(has(base, 'FIntFRMMaxGrassDistance'), '0');
  assert.equal(has(base, 'DFIntDebugFRMQualityLevelOverride'), '1');
  assert.equal(has(base, 'DFIntCSGLevelOfDetailSwitchingDistance'), '0', 'distant detail always lowest');
  assert.equal(has(base, 'FFlagDebugSkyGray'), undefined);
  assert.equal(has({ ...base, graySky: true, pauseLighting: true }, 'DFFlagDebugPauseVoxelizer'), 'True');
  assert.equal(has({ ...base, msaa: 'default' }, 'FIntDebugForceMSAASamples'), undefined, 'Roblox default = no flag');
  assert.equal(has({ ...base, texture: 'high' }, 'DFIntTextureQualityOverride'), '3');
  assert.equal(has({ ...base, mode: 'vulkan' }, 'FFlagDebugGraphicsPreferVulkan'), 'True');
  for (const [k] of rf.flagsOf({ ...base, graySky: true, pauseLighting: true, mode: 'd3d11' })) assert.ok(!/TaskSchedulerTargetFps|FPS/i.test(k), `no frame-rate flags (${k})`);
});

test('lighter rendering: merged into your own flags, one rendering mode only', () => {
  const rf = require('../src/main/modules/rflags');
  const set = rf.flagsOf({ msaa: 'x1', texture: 'lowest', mode: 'opengl', noGrass: true });
  const own = '{"FFlagDebugGraphicsPreferD3D11": "True", "DFIntTextureQualityOverride": "3", "MyFlag": "5"}';
  const v = JSON.parse(rf.merge(own, set));
  assert.equal(v.MyFlag, '5', 'your other flags stay');
  assert.equal(v.DFIntTextureQualityOverride, '0');
  assert.equal(v.FFlagDebugGraphicsPreferD3D11, undefined, 'the chosen mode replaces yours');
  assert.equal(v.FFlagDebugGraphicsPreferOpenGL, 'True');
  assert.ok(rf.merge('  ', set), 'blank counts as empty');
  for (const bad of ['not json', '[1,2]', '{"a":']) assert.equal(rf.merge(bad, set), null, bad);
});

test('lighter rendering: written for one launch, then your file comes back exactly', () => {
  const rf = require('../src/main/modules/rflags');
  const fs = require('fs'); const path = require('path'); const os = require('os');
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-rbx-'));
  const ver = path.join(local, 'Roblox', 'Versions', 'version-abc');
  fs.mkdirSync(path.join(ver, 'ClientSettings'), { recursive: true });
  const file = rf.fileFor(ver);
  const mine = '{\n "MyFlag": "1"\n}';
  fs.writeFileSync(file, mine);
  const undo = rf.apply(ver, rf.flagsOf({ msaa: 'x1', texture: 'lowest', noGrass: true }));
  assert.ok(undo);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).MyFlag, '1');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).FIntDebugForceMSAASamples, '1');
  undo();
  assert.equal(fs.readFileSync(file, 'utf8'), mine, 'byte for byte');
  assert.ok(!fs.existsSync(path.join(ver, 'ClientSettings', rf.SAVED)));
  // No file before: none after.
  fs.rmSync(file);
  const undo2 = rf.apply(ver, rf.flagsOf({ msaa: 'x1' }));
  assert.ok(fs.existsSync(file));
  undo2();
  assert.ok(!fs.existsSync(file));
  // A launch cut short (MultiMenu closed): the next start puts yours back.
  fs.writeFileSync(file, mine);
  rf.apply(ver, rf.flagsOf({ msaa: 'x2' }));
  const old = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = local;
  try { assert.equal(rf.restoreAll(), 1); } finally { process.env.LOCALAPPDATA = old; }
  assert.equal(fs.readFileSync(file, 'utf8'), mine);
  // Not a JSON object: left alone.
  fs.writeFileSync(file, 'garbage');
  assert.equal(rf.apply(ver, rf.flagsOf({ msaa: 'x1' })), null);
  assert.equal(fs.readFileSync(file, 'utf8'), 'garbage');
});

test('alt performance: presets, your own mix, and what changes', () => {
  const pp = require('../src/main/modules/perfprofile');
  const s = structuredClone(settings.DEFAULTS);
  assert.equal(pp.current(s), 'defaults', 'a fresh install leaves Roblox as it is');
  s.perf.fpsCap = 45;
  assert.equal(pp.current(s), null, 'anything else is your own mix');
  s.perf.fpsCap = 0;
  for (const id of pp.ORDER) {
    const v = pp.PRESETS[id].values;
    const applied = structuredClone(s);
    for (const [k, val] of Object.entries(v)) { const parts = k.split('.'); let o = applied; parts.slice(0, -1).forEach(p => { o = o[p]; }); o[parts.at(-1)] = val; }
    assert.equal(pp.current(applied), id);
    assert.deepEqual(pp.diff(applied, v), []);
  }
  const d = pp.diff(s, pp.PRESETS.maxAlts.values);
  assert.ok(d.some(c => c.key === 'perf.fpsCap' && c.from === 0 && c.to === 10));
  for (const p of Object.values(pp.PRESETS)) for (const k of Object.keys(p.values)) {
    const parts = k.split('.'); let o = settings.DEFAULTS; for (const x of parts) o = o?.[x];
    assert.notEqual(o, undefined, `${k} is a real setting`);
  }
});

test('alt performance: Main accounts launch at full quality', () => {
  const pp = require('../src/main/modules/perfprofile');
  const cfg = { ...settings.DEFAULTS.perf, fpsCap: 10, lowGraphics: true, lighter: true };
  const alt = pp.launchPlan({ tier: 'filler', status: 'valid' }, cfg);
  assert.deepEqual(alt.graphics, { fpsCap: 10, quality: 1 });
  assert.ok(alt.flags.length > 4);
  assert.deepEqual(pp.launchPlan({ tier: 'main' }, cfg), { light: false, graphics: null, flags: null });
  assert.deepEqual(pp.launchPlan({ tier: 'important' }, { ...cfg, fpsCap: 0, lowGraphics: false, lighter: false }), { light: true, graphics: null, flags: null });
});

test('alt performance: the plan for this PC', () => {
  const pp = require('../src/main/modules/perfprofile');
  const base = { memPerMB: 1000, cpuPer: 5, totalMB: 16384, freeMB: 10000, robloxMB: 1000, systemCpu: 15, robloxCpu: 5 };
  const light = pp.plan({ ...base, planned: 3 });
  assert.equal(light.tier, 'light');
  assert.equal(light.preset, null);
  assert.equal(light.fits, 8, '(85% of 16 GB − 5.3 GB used by other apps) ÷ 1 GB');
  const over = pp.plan({ ...base, planned: 14 });
  assert.equal(over.tier, 'over');
  assert.equal(over.preset, 'maxAlts');
  assert.equal(over.values['perf.lighter'], true);
  assert.equal(over.values['perf.minimize'], true);
  const cpu = pp.plan({ ...base, cpuPer: 12, planned: 6 });
  assert.ok(cpu.cpuPct > 70);
  assert.equal(cpu.values['perf.fpsCap'] <= 30, true);
});

test('graphics file: any FPS cap from 5 to 360, lowest graphics sets the engine level too', () => {
  const fps = require('../src/main/modules/fps');
  assert.equal(fps.validCap(10), true); assert.equal(fps.validCap(360), true); assert.equal(fps.validCap(-1), true);
  assert.equal(fps.validCap(4), false); assert.equal(fps.validCap(361), false); assert.equal(fps.validCap(12.5), false);
  const fs = require('fs'); const path = require('path'); const os = require('os');
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-gbs-'));
  fs.mkdirSync(path.join(local, 'Roblox'));
  const file = path.join(local, 'Roblox', 'GlobalBasicSettings_13.xml');
  fs.writeFileSync(file, '<roblox>\n<Item class="UserGameSettings">\n<Properties>\n<int name="FramerateCap">240</int>\n<int name="GraphicsQualityLevel">19</int>\n<token name="SavedQualityLevel">9</token>\n</Properties>\n</Item>\n</roblox>');
  const old = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = local;
  try {
    fps.writeGraphics({ fpsCap: 10, quality: 1 });
    const xml = fs.readFileSync(file, 'utf8');
    assert.match(xml, /<int name="FramerateCap">10<\/int>/);
    assert.match(xml, /<int name="GraphicsQualityLevel">1<\/int>/);
    assert.match(xml, /<token name="SavedQualityLevel">1<\/token>/);
    assert.throws(() => fps.writeGraphics({ fpsCap: 2 }), /5–360/);
  } finally { process.env.LOCALAPPDATA = old; }
});

test('doctor: every check answers, even when things are missing', async () => {
  const doc = require('../src/main/modules/doctor');
  const r = await doc.run();
  assert.equal(r.checks.length, doc.CHECKS.length);
  for (const c of r.checks) assert.ok(['ok', 'warn', 'fail', 'info'].includes(c.status), `${c.id}: ${c.status}`);
  assert.match(r.summary, /look|good/);
  for (const c of r.checks) if (c.fix && !c.fix.id.startsWith('page:')) assert.ok(doc.FIXES[c.fix.id], `fix ${c.fix.id} exists`);
  await assert.rejects(doc.fix('formatDisk'), /isn't available/);
});

// ---------- alert apps & Discord bot 2.0 ----------
function mockFetch(handler) {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); const r = await handler(String(url), init); return { ok: (r.status || 200) < 300, status: r.status || 200, json: async () => r.json || {}, text: async () => JSON.stringify(r.json || {}) }; };
  return { calls, restore: () => { global.fetch = orig; } };
}

test('alert apps: settings are checked and secrets never come back out', () => {
  const aa = require('../src/main/modules/alertapps');
  aa.init();
  assert.throws(() => aa.save({ kind: 'telegram', config: { token: 'nope' } }), /bot token/);
  assert.throws(() => aa.save({ kind: 'ntfy', config: { server: 'http://example.com', topic: 'x' } }), /https/);
  assert.throws(() => aa.save({ kind: 'ntfy', config: { topic: 'has spaces!' } }), /topic/);
  assert.throws(() => aa.save({ kind: 'email', config: { host: 'smtp.gmail.com', port: 465, to: 'not-an-email' } }), /email/);
  assert.throws(() => aa.save({ kind: 'carrier-pigeon' }), /Pick an app/);
  const token = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
  const list = aa.save({ kind: 'telegram', name: 'My phone', config: { token, chatId: '987654' }, events: { highUsage: true, bogus: true } });
  assert.equal(list.length, 1);
  assert.ok(!JSON.stringify(list).includes(token), 'the token is never listed');
  assert.equal(list[0].has.token, true);
  assert.equal(list[0].events.highUsage, true);
  assert.equal('bogus' in list[0].events, false);
  // Editing without retyping the token keeps it.
  const again = aa.save({ id: list[0].id, kind: 'telegram', name: 'Phone', config: { token: '', chatId: '111' } });
  assert.equal(again[0].config.chatId, '111');
  assert.equal(again[0].has.token, true);
  const email = aa.save({ kind: 'email', config: { host: 'SMTP.Gmail.com', port: 465, user: 'me@gmail.com', pass: 'app pw', to: 'me@gmail.com; you@x.org' } });
  const e = email.find(c => c.kind === 'email');
  assert.deepEqual([e.config.host, e.config.secure, e.config.from, e.config.to], ['smtp.gmail.com', true, 'me@gmail.com', 'me@gmail.com, you@x.org']);
  for (const c of aa.list()) aa.remove(c.id);
});

test('alert apps: each app gets the right request, with no secrets in the text', async () => {
  const aa = require('../src/main/modules/alertapps');
  aa.init();
  aa.save({ kind: 'telegram', config: { token: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', chatId: '42' } });
  aa.save({ kind: 'ntfy', config: { topic: 'multimenu-abc123' } });
  aa.save({ kind: 'pushover', config: { appToken: 'a'.repeat(30), userKey: 'u'.repeat(30) } });
  const f = mockFetch(() => ({ json: { ok: true } }));
  try {
    const cookie = '_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_ABCDEF0123456789';
    const r = await aa.send({ type: 'accountCrashed', account: 'Farm <2>', detail: `oops ${cookie}` });
    assert.equal(r.sent, 3);
    const [tg, nt, po] = f.calls;
    assert.match(tg.url, /^https:\/\/api\.telegram\.org\/bot123456789:/);
    const tgBody = JSON.parse(tg.init.body);
    assert.equal(tgBody.chat_id, '42');
    assert.match(tgBody.text, /Farm &lt;2&gt;/, 'HTML is escaped');
    assert.equal(nt.url, 'https://ntfy.sh/multimenu-abc123');
    assert.equal(nt.init.headers.Priority, 'high');
    assert.equal(po.url, 'https://api.pushover.net/1/messages.json');
    for (const c of f.calls) assert.ok(!String(c.init.body).includes('DO-NOT-SHARE'), 'cookies are redacted');
    const again = await aa.send({ type: 'accountCrashed', account: 'Farm <2>', detail: `oops ${cookie}` });
    assert.equal(again.sent, 0, 'the same alert within a minute is skipped');
    const off = await aa.send({ type: 'internetBack', detail: 'x' });
    assert.equal(off.sent, 0, 'events you didn\'t pick are not sent');
  } finally { f.restore(); for (const c of aa.list()) aa.remove(c.id); }
});

test('discord bot 2.0: panel fits Discord\'s limits and buttons check who you are', async () => {
  const remote = require('../src/main/modules/remote');
  remote.init();
  require('../src/main/modules/presets').init();
  const p = remote.panel();
  assert.ok(p.components.length >= 1 && p.components.length <= 5, 'at most 5 rows');
  for (const row of p.components) assert.ok(row.components.length <= 5, 'at most 5 per row');
  assert.ok(p.embeds[0].title.startsWith('MultiMenu'));
  for (const c of remote.COMMANDS[0].options) assert.ok(c.name.length <= 32 && c.description.length <= 100, c.name);
  settings.set('remote.allowedUserIds', ['111111111111111111']);
  const f = mockFetch(() => ({ json: {} }));
  try {
    await remote.handleInteraction({ id: '1', token: 't', type: 3, member: { user: { id: '222222222222222222', username: 'x' } }, data: { custom_id: 'mm:closeAll' } });
    assert.match(JSON.parse(f.calls[0].init.body).data.content, /not allowed/);
    await remote.handleInteraction({ id: '2', token: 't', type: 3, member: { user: { id: '111111111111111111', username: 'me' } }, data: { custom_id: 'mm:refresh' } });
    assert.equal(JSON.parse(f.calls[1].init.body).type, 7, 'refresh updates the panel in place');
    seed([mk('a', { alias: 'Farm 1', tags: ['farm'] })]);
    await remote.handleInteraction({ id: '3', token: 't', type: 4, member: { user: { id: '111111111111111111' } }, data: { name: 'mm', options: [{ name: 'launch', options: [{ name: 'account', value: 'fa', focused: true }] }] } });
    const choices = JSON.parse(f.calls[2].init.body).data.choices.map(c => c.value);
    assert.deepEqual(choices, ['Farm 1', 'tag:farm']);
    await remote.handleInteraction({ id: '4', token: 't', type: 4, member: { user: { id: '222222222222222222' } }, data: { name: 'mm', options: [{ name: 'launch', options: [{ name: 'account', value: '', focused: true }] }] } });
    assert.deepEqual(JSON.parse(f.calls[3].init.body).data.choices, [], 'strangers get no suggestions');
  } finally { f.restore(); }
});

test('phone 2.0: remembered sign-in, live pictures setting, launch, and forgetting a device', async () => {
  require('../src/main/modules/presets').init();
  const http = require('http');
  const ph = require('../src/main/modules/phone');
  ph.setPin('604213');
  settings.set('phone.allowControl', true);
  const srv = http.createServer((q, r) => { ph._handle(q, r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const req = (p, opts = {}) => new Promise((res, rej) => {
    const q = http.request({ host: '127.0.0.1', port, path: p, method: opts.method || 'GET', headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', ...(opts.headers || {}) } }, (r) => {
      let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res({ status: r.statusCode, body: b, json: (() => { try { return JSON.parse(b); } catch { return null; } })() }));
    });
    q.on('error', rej); if (opts.body) q.write(JSON.stringify(opts.body)); q.end();
  });
  try {
    ph.signOutAll();
    const login = await req('/api/login', { method: 'POST', body: { pin: '604213', remember: true } });
    assert.equal(login.status, 200, login.body);
    assert.equal(login.json.expiresIn, 30 * 86400_000, 'remembered for 30 days');
    const auth = { Authorization: `Bearer ${login.json.token}` };
    const st = ph.status();
    assert.equal(st.remembered.length, 1);
    assert.match(st.remembered[0].agent, /iPhone/);
    assert.ok(!JSON.stringify(st).includes(login.json.token), 'the sign-in never comes back out');
    assert.equal(st.remembered[0].hash, undefined, 'not even its hash');
    settings.set('phone.thumbs', false);
    assert.deepEqual((await req('/api/thumbs', { headers: auth })).json, {}, 'pictures off');
    settings.set('phone.thumbs', true);
    assert.equal((await req('/api/thumbs', { headers: auth })).status, 200);
    const snap = (await req('/api/status', { headers: auth })).json;
    assert.ok(Array.isArray(snap.offline));
    assert.equal(snap.name, undefined, 'the PC\'s name isn\'t sent');
    assert.equal((await req('/api/action/launch', { method: 'POST', body: { id: 'nobody' }, headers: auth })).status, 404);
    assert.deepEqual((await req('/api/action/closeAll', { method: 'POST', body: {}, headers: auth })).json, { ok: true, message: 'Closing every session' });
    ph.forgetDevice(st.remembered[0].id);
    assert.equal(ph.status().remembered.length, 0);
    assert.equal((await req('/api/status', { headers: auth })).status, 401, 'a forgotten phone is signed out');
  } finally { srv.close(); settings.set('phone.thumbs', false); }
});

test('share codes: every kind goes round, and private things stay out', async () => {
  const sc = require('../src/main/modules/sharecodes');
  const presets = require('../src/main/modules/presets'); presets.init();
  const auto = require('../src/main/modules/automations'); auto.init();
  const gp = require('../src/main/modules/gameprofiles'); gp.init();
  const servers = require('../src/main/modules/servers'); servers.init();
  seed([mk('a', { tags: ['farm'] }), mk('b')]);

  const p = presets.save({ name: 'Night farm', accountIds: ['a', 'b'], game: 'https://www.roblox.com/games/920587237/Adopt-Me?privateServerLinkCode=12345678901234567890', layout: 'grid2', tile: true, graphics: { enabled: true, quality: 1, fpsCap: 30 } });
  const made = sc.create('preset', p.id);
  assert.match(made.code, /^MM2-preset-[A-Za-z0-9_-]+-[0-9a-z]{7}$/);
  assert.ok(made.notes.some(n => /private server/.test(n)) && made.notes.some(n => /Accounts aren't included/.test(n)));
  const back = sc.unpack(`Here you go: ${made.code} have fun!`);
  assert.equal(back.data.game, '920587237', 'the game stays, the private server goes');
  assert.ok(!JSON.stringify(back.data).includes('12345678901234567890'));
  assert.equal(back.data.accounts, 2);
  assert.equal(back.data.accountIds, undefined, 'no account IDs');
  const imp = await sc.importCode(made.code);
  assert.equal(imp.draft.name, 'Night farm (2)', 'names don\'t clash');
  assert.deepEqual(imp.draft.accountIds, []);
  assert.equal(presets.list().length, 1, 'a preset only arrives as a draft for the editor');

  settings.set('tiling', { ...settings.get('tiling'), layout: 'main', gap: 12, mainRatio: 0.7 });
  const lay = sc.create('layout', 'current');
  settings.set('tiling', { ...settings.get('tiling'), layout: 'auto', gap: 0, mainRatio: 0.62 });
  await sc.importCode(lay.code);
  assert.deepEqual([settings.get('tiling.layout'), settings.get('tiling.gap'), settings.get('tiling.mainRatio')], ['main', 12, 0.7]);

  settings.set('appearance.theme', { ...settings.get('appearance.theme'), bgType: 'image', bgFile: 'background.png' });
  const th = sc.create('theme', 'current');
  assert.equal(th.notes.length, 1, 'says the picture stays on this PC');
  assert.equal(sc.unpack(th.code).data.theme.bgType, 'gradient');

  auto.save({ name: 'Rejoin farm', trigger: { type: 'problem', kind: 'crash' }, actions: [{ type: 'rejoin', who: 'tag:farm' }, { type: 'notify', text: 'Back in' }] });
  const rc = sc.create('rule', auto.list().find(r => r.name === 'Rejoin farm').id);
  const ri = await sc.importCode(rc.code);
  assert.equal(ri.name, 'Rejoin farm (2)');
  assert.equal(auto.list().find(r => r.name === ri.name).enabled, false, 'imported automations start switched off');

  gp.save({ placeId: '920587237', name: 'Adopt Me!', graphics: { enabled: true, quality: 2, fpsCap: 30 }, layout: 'grid3', watcher: { stuckMin: 5 } });
  const gc = sc.create('game', '920587237');
  gp.remove('920587237');
  assert.equal(sc.preview(gc.code).exists, false);
  await sc.importCode(gc.code);
  assert.equal(gp.forPlace('920587237').graphics.fpsCap, 30);
  assert.ok(servers.listGames().some(g => g.placeId === '920587237'), 'the game shows up in your saved games');
  assert.equal(sc.preview(gc.code).exists, true);
});

test('share codes: damaged, newer and secret-carrying codes are refused', () => {
  const sc = require('../src/main/modules/sharecodes');
  const zlib = require('zlib');
  const hand = (kind, obj) => { const body = `${kind}-${zlib.deflateRawSync(Buffer.from(JSON.stringify(obj))).toString('base64url')}`; return `MM2-${body}-${sc.crc(body)}`; };
  const good = sc.pack('layout', sc.CLEAN.layout({ layout: 'grid2' }));
  const typo = good.slice(0, 20) + (good[20] === 'A' ? 'B' : 'A') + good.slice(21);
  assert.throws(() => sc.unpack(typo), /typo/);
  assert.throws(() => sc.unpack(good.slice(0, -2)), /share code|typo/);
  assert.throws(() => sc.unpack('hello'), /MM2-/);
  assert.throws(() => sc.pack('rule', { name: 'x', note: '_|WARNING:-DO-NOT-SHARE-THIS.--|_abc' }), /secret/);
  assert.throws(() => sc.unpack(hand('rule', { v: 1, name: 'x', trigger: { type: 'appStarted' }, actions: [{ type: 'notify', text: 'https://discord.com/api/webhooks/1/abc' }] })), /secret/);
  assert.throws(() => sc.unpack(hand('theme', { v: 2 })), /newer/);
  assert.throws(() => sc.unpack(hand('theme', { v: 1, name: 'x'.repeat(100000) })), /damaged/);
  const d = sc.unpack(hand('layout', { v: 1, layout: 'grid2', gap: 9999, run: 'calc.exe' })).data;
  assert.equal(d.gap, 40, 'values are clamped');
  assert.equal(d.run, undefined, 'unknown fields are dropped');
  assert.equal(sc.find('see MM2-theme-abc_DEF-1234567 here'), 'MM2-theme-abc_DEF-1234567');
  for (const s of ['mm_8xJ2kQ0vZt7RqP4wLm9sN3bYc6Fh1Ud5aa', 'Bearer abcdefabcdefabcdef12', 'https://roblox.com/games/1?privateServerLinkCode=1', 'a'.repeat(10) + 'f'.repeat(40)]) assert.equal(sc.hasSecret(s), true, s);
  for (const s of ['Rejoin farm', 'Back in at 08:00', 'tag:farm']) assert.equal(sc.hasSecret(s), false, s);
});

test('theme gallery: only valid theme codes, and "go back" keeps your own picture', () => {
  const fs = require('fs');
  const path = require('path');
  const sc = require('../src/main/modules/sharecodes');
  const g = require('../src/main/modules/gallery');
  const themes = require('../src/main/modules/themes');
  const mint = sc.pack('theme', sc.CLEAN.theme({ name: 'Mint', accentHue: 150 }));
  const list = g.parseIndex({ themes: [{ name: 'Mint', author: 'me', code: mint }, { name: 'Again', code: mint }, { name: 'Layout', code: sc.pack('layout', sc.CLEAN.layout({})) }, { code: 'MM2-theme-xxxx-0000000' }, null, 'junk', { code: 5 }] });
  assert.deepEqual(list.map(e => [e.name, e.theme.accentHue]), [['Mint', 150]]);
  assert.equal(g.builtIn().length, Object.keys(themes.PRESETS).length);
  const repo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'themes', 'index.json'), 'utf8'));
  assert.equal(g.parseIndex(repo).length, repo.themes.length, 'every theme in the repo\'s list is valid');

  const dir = path.join(paths.dataDir, 'theme');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'background.png'), 'x');
  settings.set('appearance.theme', { ...settings.get('appearance.theme'), bgType: 'image', bgFile: 'background.png', preset: 'custom' });
  const before = JSON.parse(JSON.stringify(themes.current()));
  themes.apply({ accentHue: 10, theme: { bgType: 'gradient' } });
  assert.equal(settings.get('appearance.theme.bgFile'), '');
  themes.restore(before);
  assert.deepEqual([settings.get('appearance.theme.bgType'), settings.get('appearance.theme.bgFile')], ['image', 'background.png']);
  themes.restore({ ...before, theme: { ...before.theme, bgFile: '../../evil.png' } });
  assert.equal(settings.get('appearance.theme.bgType'), 'gradient', 'only the real background file');
});
