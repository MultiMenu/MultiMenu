// Admin mode (2.0.3): signed codes, masking, snapshots, the command guard and the taps.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmp, stub } = require('./helpers/electron-stub');

const codes = require('../src/main/admin/codes');
const { mask, brief, safeUrl, maskString, anonymize } = require('../src/main/admin/mask');

const kp = codes.generateKeyPair();

test('admin codes: signed codes verify, anything changed does not', () => {
  const code = codes.sign(kp.privateKey, { name: 'tester', days: 30, now: Date.parse('2026-11-01') });
  assert.match(code, /^MMA-[\w-]+\.[\w-]+$/);
  const ok = codes.verify(code, { keys: [kp.publicKey], now: Date.parse('2026-11-02') });
  assert.equal(ok.ok, true);
  assert.equal(ok.name, 'tester');
  assert.ok(ok.exp > ok.iat);
  // spaces and line breaks from copying are fine
  assert.equal(codes.verify(` ${code.slice(0, 50)}\n${code.slice(50)} `, { keys: [kp.publicKey], now: Date.parse('2026-11-02') }).ok, true);
  // expired
  const late = codes.verify(code, { keys: [kp.publicKey], now: Date.parse('2027-01-01') });
  assert.equal(late.ok, false); assert.equal(late.expired, true);
  // another key
  const other = codes.generateKeyPair();
  assert.equal(codes.verify(code, { keys: [other.publicKey] }).ok, false);
  // payload edited (name changed) with the old signature
  const [body, sig] = code.slice(4).split('.');
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  p.name = 'someone else';
  const forged = `MMA-${Buffer.from(JSON.stringify(p)).toString('base64url')}.${sig}`;
  assert.equal(codes.verify(forged, { keys: [kp.publicKey] }).ok, false);
  // revoked, garbage, wrong prefix
  assert.equal(codes.verify(code, { keys: [kp.publicKey], revoked: [ok.id], now: Date.parse('2026-11-02') }).ok, false);
  for (const junk of ['', 'hello', 'MMA-', 'MMA-a.b', 'MMA-a.b.c', `MMA-${'x'.repeat(5000)}.y`, null, 42]) assert.equal(codes.verify(junk, { keys: [kp.publicKey] }).ok, false);
  // no expiry
  const forever = codes.sign(kp.privateKey, { name: 'x' });
  assert.equal(codes.verify(forever, { keys: [kp.publicKey], now: Date.parse('2099-01-01') }).ok, true);
  assert.equal(codes.peek(forever).name, 'x');
  assert.equal(codes.publicFromPrivate(kp.privateKey), kp.publicKey);
});

test('admin codes: the shipped public key is a valid Ed25519 key', () => {
  const k = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'admin', 'keys.json'), 'utf8'));
  assert.ok(k.keys.length >= 1);
  for (const pub of k.keys) {
    const key = require('crypto').createPublicKey({ key: Buffer.from(pub, 'base64'), format: 'der', type: 'spki' });
    assert.equal(key.asymmetricKeyType, 'ed25519');
  }
  // No private key ever sits next to it.
  const all = fs.readdirSync(path.join(__dirname, '..', 'src', 'main', 'admin')).map(f => fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'admin', f), 'utf8')).join('\n');
  assert.doesNotMatch(all, /"privateKey"\s*:\s*"MC4/);
});

test('admin mask: secrets go, ordinary values stay', () => {
  const m = mask({
    api: { keyEnc: 'enc:v1:abc', port: 43822 }, phone: { pinHash: 'aa'.repeat(32), pinSalt: 'bb'.repeat(8), enabled: true, hasPin: true },
    antiAfk: { key: 'Space' }, hooks: [{ name: 'Alerts', urlEnc: 'enc:v1:zzz', masked: '…/webhooks/1/••' }],
    channel: { secretEnc: { token: 'enc:v1:t', pass: 'enc:v1:p' }, config: { chatId: '12345678', server: 'https://ntfy.sh' } },
    note: 'cookie _|WARNING:-DO-NOT-SHARE-THIS.--abcdef', link: 'https://discord.com/api/webhooks/123/abcDEF', empty: '', none: null,
    games: [{ name: 'Pet Sim', linkCode: '12345678901234567890' }], token: 'ghp_' + 'a'.repeat(36),
  });
  assert.equal(m.api.keyEnc, '‹hidden›');
  assert.equal(m.api.port, 43822);
  assert.equal(m.phone.pinHash, '‹hidden›');
  assert.equal(m.phone.pinSalt, '‹hidden›');
  assert.equal(m.phone.hasPin, true);
  assert.equal(m.antiAfk.key, 'Space');
  assert.equal(m.hooks[0].urlEnc, '‹hidden›');
  assert.equal(m.hooks[0].name, 'Alerts');
  assert.match(m.channel.secretEnc, /^‹hidden: 2 fields›$/);
  assert.equal(m.channel.config.chatId, '‹hidden›');
  assert.equal(m.channel.config.server, 'https://ntfy.sh');
  assert.equal(m.note, '‹hidden›');
  assert.equal(m.link, '‹hidden›');
  assert.equal(m.empty, '');
  assert.equal(m.none, null);
  assert.equal(m.games[0].linkCode, '‹hidden›');
  assert.equal(m.token, '‹hidden›');
  assert.equal(maskString('plain words'), 'plain words');
});

test('admin mask: brief() stays short on huge values and still hides secrets', () => {
  const big = { image: `data:image/png;base64,${'A'.repeat(500000)}`, list: Array.from({ length: 10000 }, (_, i) => ({ i })), tokenEnc: 'enc:v1:x' };
  const t0 = Date.now();
  const s = brief(big, 300);
  assert.ok(Date.now() - t0 < 200);
  assert.ok(s.length <= 301);
  assert.doesNotMatch(brief({ tokenEnc: 'enc:v1:secret', cookie: 'abc' }), /secret|abc/);
  assert.equal(brief(undefined), 'undefined');
  assert.equal(brief('x'), '"x"');
});

test('admin mask: network log URLs lose tokens, queries and ids', () => {
  assert.deepEqual(safeUrl('https://discord.com/api/webhooks/1234567890123456789/abcDEF_123-xyz?wait=true'), { host: 'discord.com', path: '/api/webhooks/…' });
  assert.deepEqual(safeUrl('https://api.telegram.org/bot123456789:AAE-abcdefghijklmnopqrstuvwxyz123/sendMessage'), { host: 'api.telegram.org', path: '/…/sendMessage' });
  assert.deepEqual(safeUrl('https://api.github.com/repos/voidflarerblx-coder/MultiMenu/releases?per_page=20'), { host: 'api.github.com', path: '/repos/voidflarerblx-coder/MultiMenu/releases' });
  assert.deepEqual(safeUrl('https://users.roblox.com/v1/users/123456789'), { host: 'users.roblox.com', path: '/v1/users/123456789' });
  assert.deepEqual(safeUrl('https://ntfy.sh/mm-alerts-x7k2p9q4w1'), { host: 'ntfy.sh', path: '/…' });
  assert.equal(safeUrl('not a url').host, '?');
  assert.equal(anonymize(path.join(require('os').homedir(), 'AppData', 'x')).startsWith('%USERPROFILE%'), true);
});

test('admin data: snapshot, restore on next start, factory reset keeps a copy', () => {
  const paths = require('../src/main/paths');
  const data = require('../src/main/admin/data');
  paths.ensureDirs();
  const file = (n) => path.join(paths.dataDir, n);
  fs.writeFileSync(file('alpha.json'), JSON.stringify({ v: 1, tokenEnc: 'enc:v1:abc' }));
  fs.writeFileSync(file('beta.json'), JSON.stringify({ list: [1, 2, 3] }));
  fs.writeFileSync(path.join(paths.macrosDir(), 'm1.json'), '{"name":"m"}');
  const listed = data.stores().find(s => s.name === 'alpha.json');
  assert.equal(listed.summary.v, 'number');
  assert.equal(data.read('alpha.json').tokenEnc, '‹hidden›');
  assert.throws(() => data.read('../secret.json'), /Unknown/);

  const snap = data.snapshot('Test one');
  assert.ok(snap.files.includes('alpha.json') && snap.files.includes('beta.json'));
  assert.equal(snap.macros, 1);
  // change things after the snapshot
  fs.writeFileSync(file('alpha.json'), JSON.stringify({ v: 2 }));
  fs.writeFileSync(file('gamma.json'), '{}');
  fs.rmSync(path.join(paths.macrosDir(), 'm1.json'));
  data.scheduleRestore(snap.id);
  assert.equal(data.applyPending(null), 'restore');
  assert.equal(JSON.parse(fs.readFileSync(file('alpha.json'), 'utf8')).v, 1);
  assert.equal(fs.existsSync(file('gamma.json')), false, 'files made after the snapshot are removed');
  assert.equal(fs.existsSync(path.join(paths.macrosDir(), 'm1.json')), true);
  assert.ok(data.snapshots().some(s => s.label === 'Before restore' && s.files.includes('gamma.json')));
  assert.equal(data.applyPending(null), null, 'only once');
  assert.throws(() => data.scheduleRestore('../../x'), /Unknown snapshot/);

  data.scheduleFactoryReset();
  assert.equal(data.applyPending(null), 'reset');
  assert.equal(data.dataFiles().filter(f => ['alpha.json', 'beta.json'].includes(f)).length, 0);
  assert.ok(data.snapshots().some(s => s.label === 'Before factory reset' && s.files.includes('alpha.json')));
  for (const s of data.snapshots()) data.removeSnapshot(s.id);
  assert.equal(data.snapshots().length, 0);
});

test('admin: commands stay locked until a valid code, then work; lock undoes the taps', async () => {
  const settings = require('../src/main/modules/settings');
  settings.init();
  const bus = require('../src/main/bus');
  const logger = require('../src/main/logger');
  const admin = require('../src/main/admin');
  admin._keys.keys.push(kp.publicKey);
  stub.app.relaunch = () => {}; stub.app.quit = () => {};
  admin.init({ win: () => null, windows: () => [] });
  assert.equal(admin.status().unlocked, false);
  assert.equal(admin.blocked('admin:overview'), 'Admin mode is locked.');
  assert.equal(admin.blocked('admin:status'), null);
  assert.equal(admin.blocked('admin:unlock'), null);
  assert.throws(() => admin.unlock('MMA-bad.code'), /damaged|not valid/);
  const emitBefore = bus.emit, fetchBefore = globalThis.fetch;
  const st = admin.unlock(codes.sign(kp.privateKey, { name: 'unit', days: 1 }));
  assert.equal(st.unlocked, true);
  assert.equal(st.name, 'unit');
  assert.equal(admin.blocked('admin:overview'), null);
  assert.notEqual(bus.emit, emitBefore, 'bus is tapped');
  // the bus tap records events (masked), not admin's own
  bus.emit('test:event', { cookieEnc: 'enc:v1:zz', n: 1 });
  bus.emit('admin:feed', {});
  const last = admin._feed.bus.at(-1);
  assert.equal(last.name, 'test:event');
  assert.doesNotMatch(last.data, /enc:v1/);
  // log lines arrive
  logger.scope('unit').info('hello from the test');
  assert.ok(admin._feed.log.some(l => l.msg === 'hello from the test'));
  // IPC timing
  admin.ipcDone('accounts:list', 12.5, true);
  admin.ipcDone('accounts:list', 7.5, false, 'oops');
  admin.ipcDone('admin:overview', 1, true);
  const h = admin.handlers({});
  const fs2 = await h['admin:feed']();
  const row = fs2.stats.find(s => s.channel === 'accounts:list');
  assert.deepEqual([row.n, row.errors, row.avg, row.max], [2, 1, 10, 12.5]);
  assert.ok(!fs2.stats.some(s => s.channel === 'admin:overview'));
  // flags
  assert.equal(admin.setFlags({ verbose: true, bogus: true }).verbose, true);
  assert.equal(logger.verbose, true);
  assert.equal('bogus' in admin.setFlags({}), false);
  admin.setFlags({ verbose: false });
  // settings table hides secrets
  const rows = await h['admin:settings']();
  assert.equal(rows.find(r => r.key === 'api.keyEnc').secret, true);
  assert.equal(rows.find(r => r.key === 'antiAfk.key').secret, false);
  assert.ok(rows.length > 200);
  // simulated events are marked as tests
  let seen = null;
  const on = (e) => { seen = e; };
  bus.on('event', on);
  require('../src/main/modules/webhooks').init();
  admin.simulate({ kind: 'event', type: 'accountCrashed' });
  bus.off('event', on);
  assert.equal(seen.test, true);
  assert.match(seen.detail, /^\[TEST\]/);
  assert.throws(() => admin.simulate({ kind: 'event', type: 'nope' }), /Unknown event/);
  // lock: taps removed, commands refused again
  admin.lock();
  assert.equal(bus.emit, emitBefore);
  assert.equal(globalThis.fetch, fetchBefore);
  assert.equal(admin.blocked('admin:overview'), 'Admin mode is locked.');
  assert.equal(logger.verbose, false);
});

test('admin: an expired code locks itself', () => {
  const admin = require('../src/main/admin');
  const code = codes.sign(kp.privateKey, { name: 'short', days: 1, now: Date.now() - 2 * 86400_000 });
  assert.throws(() => admin.unlock(code), /expired/);
});

test('logger: listeners get redacted lines; debug only when verbose', () => {
  const logger = require('../src/main/logger');
  const got = [];
  const off = logger.onLine(l => got.push(l));
  logger.scope('t').info('cookie .ROBLOSECURITY=abc123secret');
  logger.scope('t').debug('quiet');
  logger.setVerbose(true);
  logger.scope('t').debug('loud');
  logger.setVerbose(false);
  off();
  logger.scope('t').info('after');
  assert.equal(got.length, 2);
  assert.doesNotMatch(got[0].msg, /abc123secret/);
  assert.equal(got[1].level, 'DEBUG');
});

test('i18n: pseudo-language marks every known string and keeps placeholders', () => {
  const i18n = require('../src/main/i18n');
  i18n.setPseudo(true);
  const p = i18n.payload();
  assert.equal(p.lang, 'en-XA');
  assert.ok(Object.keys(p.dict).length > 1000);
  assert.match(i18n.t('Dashboard'), /^⟦.+⟧$/);
  assert.equal(i18n.pseudoText('{0} of {1}'), '⟦{0} öƒ {1}⟧');
  i18n.setPseudo(false);
  assert.equal(i18n.payload().lang, i18n.lang);
});

test('store: flushAll writes pending changes now', () => {
  const { JsonStore, flushAll } = require('../src/main/store');
  const f = path.join(tmp, 'flush-test.json');
  const s = new JsonStore(f, { n: 0 });
  s.set('n', 5);
  assert.equal(fs.existsSync(f), false);
  assert.equal(flushAll() >= 1, true);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).n, 5);
  assert.equal(flushAll(), 0, 'nothing left to write');
});

test('updater: pretend version and release descriptions', () => {
  const updater = require('../src/main/modules/updater');
  assert.throws(() => updater.setPretend('banana'), /version like/);
  const st = updater.setPretend('v1.6.0');
  assert.equal(st.current, '1.6.0');
  assert.equal(st.pretend, '1.6.0');
  assert.equal(updater.setPretend(null).pretend, null);
  const d = updater.describe({ tag_name: 'V1.8.0', name: 'MultiMenu 1.8', body: 'notes', assets: [{ name: 'MultiMenu-Setup.exe', browser_download_url: 'u1', size: 9 }, { name: 'SHA256SUMS.txt', browser_download_url: 'u2' }] });
  assert.equal(d.version, '1.8.0');
  assert.equal(d.assetUrl, 'u1');
  assert.equal(d.sumsUrl, 'u2');
});

test('ipc: unknown and inherited command names are refused', async () => {
  let dispatch = null;
  stub.ipcMain.handle = (ch, fn) => { dispatch = fn; };
  const sender = {};
  const ctx = { win: () => ({ webContents: sender }), windows: () => [{ webContents: sender }] };
  require('../src/main/ipc').register(ctx);
  const ev = { senderFrame: { url: 'file:///app/index.html' }, sender };
  assert.match((await dispatch(ev, 'constructor')).message, /Unknown command/);
  assert.match((await dispatch(ev, '__proto__')).message, /Unknown command/);
  assert.equal((await dispatch(ev, 'admin:overview')).message, 'Admin mode is locked.');
  assert.equal((await dispatch(ev, 'admin:status')).unlocked, false);
  assert.equal((await dispatch({ senderFrame: { url: 'https://evil.example' }, sender }, 'admin:status')).message, 'Forbidden');
  assert.equal((await dispatch(ev, 42)).message, 'Bad command');
});
