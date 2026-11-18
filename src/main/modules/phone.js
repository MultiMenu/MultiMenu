'use strict';
// Phone dashboard. A small web page served on your home Wi-Fi so you can check
// on your alts from your phone's browser and rejoin / close them or start a
// preset. It is off until you turn it on.
//
// Safety:
//  - Answers only devices on your local network (private IP addresses).
//  - Every request except the page itself needs a sign-in with your 6-digit PIN.
//    The PIN is stored only as a salted scrypt hash. Sign-ins last 12 hours in
//    memory, or 30 days for a remembered phone (only a hash of its sign-in is saved).
//  - Wrong PINs are rate-limited per device and overall.
//  - The page shows names, game, status and uptime. Logins, cookies, passwords,
//    webhooks and tokens are never part of any reply.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const settings = require('./settings');
const bus = require('../bus');
const log = require('../logger').scope('phone');

const TOKEN_MS = 12 * 3600_000;
const REMEMBER_MS = 30 * 86400_000;
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/phone.js': ['phone.js', 'text/javascript; charset=utf-8'],
  '/phone.css': ['phone.css', 'text/css; charset=utf-8'],
  '/translate.js': ['../renderer/js/translate.js', 'text/javascript; charset=utf-8'],
  '/icon.png': ['../../build/icon.png', 'image/png'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
};
const DIR = path.join(__dirname, '..', '..', 'phone');

let server = null, listening = null, lastError = null;
let devicesStore = null;
function devices() {
  if (!devicesStore) { const { JsonStore } = require('../store'); devicesStore = new JsonStore(require('../paths').file('phone.json'), { devices: [] }); }
  devicesStore.set('devices', devicesStore.get('devices').filter(d => d.exp > Date.now()));
  return devicesStore.get('devices');
}
const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const tokens = new Map();      // token -> { exp, ip, name }
const fails = new Map();       // ip -> { count, until }
let globalFails = [];          // timestamps of wrong PINs from anyone
let globalLockUntil = 0;

// ---------- network helpers (unit-tested) ----------
function stripMapped(ip) { return String(ip || '').replace(/^::ffff:/i, ''); }
/** True for loopback and private-network addresses (RFC 1918, link-local, IPv6 ULA). */
function isPrivate(ipRaw) {
  const ip = stripMapped(ipRaw);
  if (ip === '::1' || /^127\./.test(ip)) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe[89ab][0-9a-f]:/i.test(ip);
}
/** Host header must be an IP address or localhost (blocks DNS-rebinding pages). */
function hostAllowed(host) {
  const h = String(host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return h === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(h) || /^[0-9a-f:]+$/i.test(h);
}
/** This PC's addresses on the local network, best first. */
/** Adapter names that are VPNs or virtual machines, not your Wi-Fi or Ethernet. */
const VIRTUAL = /vethernet|virtualbox|vmware|vmnet|hyper-v|wsl|loopback|docker|tailscale|zerotier|hamachi|radmin|nordlynx|wireguard|openvpn|tap-|\btun\b|proton|mullvad|expressvpn|surfshark|windscribe|cloudflare|warp|forticlient|cisco|anyconnect|globalprotect|pangp|vpn|bluetooth|npcap/i;
/** This PC's addresses on the local network, best first: Wi-Fi and Ethernet before VPNs and virtual adapters. */
function lanAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || !isPrivate(a.address) || /^169\.254\./.test(a.address)) continue;
      const virtual = VIRTUAL.test(name);
      const real = /wi-?fi|wlan|wireless|ethernet|^eth|^en|^wl/i.test(name);
      out.push({ address: a.address, name, virtual, real });
    }
  }
  return out.sort((x, y) => (x.virtual - y.virtual) || (y.real - x.real) || ((/^192\.168\./.test(y.address)) - (/^192\.168\./.test(x.address))));
}

// ---------- PIN ----------
function hashPin(pin, salt) { return crypto.scryptSync(String(pin), Buffer.from(salt, 'hex'), 32).toString('hex'); }
function validPin(pin) { return /^\d{6}$/.test(String(pin || '')); }
function setPin(pin) {
  if (!validPin(pin)) throw new Error('The PIN must be exactly 6 digits.');
  if (/^(\d)\1{5}$/.test(pin) || ['123456', '654321', '012345', '111111'].includes(pin)) throw new Error('Pick a PIN that is harder to guess.');
  const salt = crypto.randomBytes(16).toString('hex');
  settings.set('phone.pinSalt', salt);
  settings.set('phone.pinHash', hashPin(pin, salt));
  signOutAll();
  return status();
}
function randomPin() {
  let p;
  do { p = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); } while (/^(\d)\1{5}$/.test(p) || ['123456', '654321', '012345'].includes(p));
  return p;
}
function checkPin(pin) {
  const salt = settings.get('phone.pinSalt'), hash = settings.get('phone.pinHash');
  if (!salt || !hash || !validPin(pin)) return false;
  const a = Buffer.from(hashPin(pin, salt), 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- rate limiting ----------
function lockedFor(ip, now = Date.now()) {
  if (globalLockUntil > now) return globalLockUntil - now;
  const f = fails.get(ip);
  return f && f.until > now ? f.until - now : 0;
}
function recordFail(ip, now = Date.now()) {
  const f = fails.get(ip) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) { f.until = now + 5 * 60_000 * 2 ** Math.min(4, Math.floor(f.count / 5) - 1); }
  fails.set(ip, f);
  globalFails = globalFails.filter(t => now - t < 10 * 60_000);
  globalFails.push(now);
  if (globalFails.length >= 20) { globalLockUntil = now + 10 * 60_000; log.warn('Too many wrong PINs: phone sign-in locked for 10 minutes'); bus.emit('notify', { level: 'warn', title: 'Phone dashboard', message: 'Too many wrong PINs. Sign-in is locked for 10 minutes.' }); }
}

function signOutAll() { tokens.clear(); try { devices(); devicesStore.set('devices', []); devicesStore.saveNow(); } catch { /* none */ } bus.emit('phone:update', status()); return status(); }
function forgetDevice(id) { const left = devices().filter(d => d.id !== id); devicesStore.set('devices', left); devicesStore.saveSoon(); bus.emit('phone:update', status()); return status(); }
function authed(req) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const t = tokens.get(m[1]);
  if (t && t.exp >= Date.now()) return t;
  tokens.delete(m[1]);
  // Remembered devices ("Remember this phone"): only a hash of the sign-in is stored.
  const h = tokenHash(m[1]);
  const d = devices().find(x => x.hash === h);
  if (!d) return null;
  const stale = Date.now() - (d.lastSeen || 0) > 600_000;
  d.lastSeen = Date.now();
  if (stale) devicesStore.saveSoon();
  return d;
}

// ---------- what the phone sees ----------
function snapshot() {
  const sessions = require('./sessions');
  const list = sessions.listSessions().filter(s => ['running', 'launching'].includes(s.status));
  const sys = require('./system').latest();
  const w = require('./watcher').status();
  return {
    at: Date.now(),
    sessions: list.map(s => ({
      id: s.id, accountId: s.accountId || null, label: s.label, status: s.status, state: s.watchState || (s.status === 'running' ? 'running' : 'starting'),
      game: s.placeName || (s.placeId ? `Place ${s.placeId}` : ''), since: s.startedAt || null, watched: !!s.watch,
      memMB: s.memMB || null,
    })),
    presets: require('./presets').list().map(p => ({ id: p.id, name: p.name, count: require('./presets').idsOf(p).length })),
    pc: sys ? { cpu: Math.round(sys.cpu), ram: Math.round(sys.ramPercent) } : null,
    watcher: { enabled: !!w.enabled, queued: w.pending.length },
    control: !!settings.get('phone.allowControl'),
    lang: settings.get('language') || 'en',
    thumbs: !!settings.get('phone.thumbs'),
    offline: (() => {
      const running = new Set(list.map(s => s.accountId).filter(Boolean));
      const acc = require('./accounts');
      return acc.raw().accounts.filter(a => !running.has(a.id) && a.status !== 'expired').sort((x, y) => (acc.tierRank(x) - acc.tierRank(y)) || ((x.order ?? 0) - (y.order ?? 0))).slice(0, 30)
        .map(a => ({ id: a.id, label: a.alias || a.displayName || a.username, tier: acc.publicView(a).tier }));
    })(),
  };
}

async function action(name, body) {
  if (!settings.get('phone.allowControl')) { const e = new Error('Control from the phone is turned off in MultiMenu.'); e.status = 403; throw e; }
  const sessions = require('./sessions');
  const find = (id) => { const s = sessions.listSessions().find(x => x.id === String(id || '')); if (!s) { const e = new Error('That session is not running any more.'); e.status = 404; throw e; } return s; };
  switch (name) {
    case 'rejoin': {
      const s = find(body.id);
      if (!s.accountId) throw new Error('Only accounts MultiMenu launched can be rejoined.');
      const raw = sessions.getRaw(s.id);
      sessions.endForRestart(s.id, 'Rejoin requested from the phone dashboard');
      setTimeout(() => sessions.launch(s.accountId, null, { label: s.label, watch: raw?.watch, target: raw?.target || null }), 3000);
      return { ok: true, message: `Rejoining ${s.label}` };
    }
    case 'close': {
      const s = find(body.id);
      sessions.setWatch(s.id, false);
      await sessions.close(s.id);
      return { ok: true, message: `Closing ${s.label}` };
    }
    case 'closeAll': await sessions.closeAll(); return { ok: true, message: 'Closing every session' };
    case 'preset': {
      const p = require('./presets').get(String(body.id || ''));
      if (!p) { const e = new Error('Preset not found.'); e.status = 404; throw e; }
      const r = await require('./presets').run(p.id);
      return { ok: true, message: `Started “${p.name}”`, steps: r.steps };
    }
    case 'tile': { const r = await require('./tiler').tile(); return { ok: true, message: `${r.placed} windows tiled` }; }
    case 'launch': {
      const a = require('./accounts').find(String(body.id || ''));
      if (!a) { const e = new Error('That account is gone.'); e.status = 404; throw e; }
      Promise.resolve(sessions.launch(a.id, null)).catch(e => log.warn(`Phone launch: ${e.message}`));
      return { ok: true, message: `Launching ${a.alias || a.displayName || a.username}` };
    }
    case 'eco': { const r = require('./limiter').setEco(!!body.on); return { ok: true, message: r.eco ? 'Eco mode on' : 'Eco mode off' }; }
    case 'watcher': { const r = require('./watcher').setEnabled(!!body.on); return { ok: true, message: r.enabled ? '24/7 Watcher on' : '24/7 Watcher off' }; }
    default: { const e = new Error('Unknown action.'); e.status = 404; throw e; }
  }
}

// ---------- safe retries ----------
// The phone retries a request when the connection drops. Each action carries an
// id, and an id seen in the last 2 minutes gets the first answer again instead of
// running twice (no double launches or closes).
const recentActions = new Map(); // rid -> { at, promise }
const RID_MS = 120_000;
function once(rid, run, now = Date.now()) {
  for (const [k, v] of recentActions) if (now - v.at > RID_MS) recentActions.delete(k);
  if (typeof rid !== 'string' || !/^[A-Za-z0-9-]{8,40}$/.test(rid)) return run();
  const seen = recentActions.get(rid);
  if (seen) return seen.promise;
  const promise = Promise.resolve().then(run);
  recentActions.set(rid, { at: now, promise });
  if (recentActions.size > 300) recentActions.delete(recentActions.keys().next().value);
  promise.catch(() => recentActions.delete(rid)); // a failed action may be tried again
  return promise;
}

// ---------- HTTP ----------
const HEADERS = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { ...HEADERS, 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 4096) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('Bad request'), { status: 400 })); } });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const ip = stripMapped(req.socket.remoteAddress);
  if (!isPrivate(ip)) { req.socket.destroy(); return; }
  if (!hostAllowed(req.headers.host)) return send(res, 421, { error: 'Open the dashboard using the address MultiMenu shows.' });
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      return send(res, 200, fs.readFileSync(path.join(DIR, file)), type);
    }
    if (req.method === 'GET' && url.pathname === '/api/i18n') {
      const lang = settings.get('language') || 'en';
      return send(res, 200, { lang, dict: lang === 'en' ? {} : require('../i18n').payload().dict });
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const wait = lockedFor(ip);
      if (wait) return send(res, 429, { error: `Too many wrong PINs. Try again in ${Math.ceil(wait / 60000)} min.` });
      const body = await readBody(req);
      if (!settings.get('phone.pinHash')) return send(res, 403, { error: 'Set a PIN in MultiMenu first.' });
      if (!checkPin(String(body.pin || ''))) { recordFail(ip); return send(res, 401, { error: 'Wrong PIN.' }); }
      fails.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      const agent = String(req.headers['user-agent'] || '').slice(0, 120);
      if (body.remember === true) {
        const list = devices();
        list.push({ id: crypto.randomUUID(), hash: tokenHash(token), exp: Date.now() + REMEMBER_MS, ip, at: Date.now(), agent, lastSeen: Date.now() });
        if (list.length > 20) list.splice(0, list.length - 20);
        devicesStore.saveSoon();
      } else tokens.set(token, { exp: Date.now() + TOKEN_MS, ip, at: Date.now(), agent });
      log.info(`Phone signed in from ${ip}`);
      bus.emit('phone:login', { ip });
      bus.emit('phone:update', status());
      bus.emit('notify', { level: 'info', title: 'Phone dashboard', message: `A device signed in from ${ip}.` });
      return send(res, 200, { token, expiresIn: body.remember === true ? REMEMBER_MS : TOKEN_MS });
    }
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    const who = authed(req);
    if (!who) return send(res, 401, { error: 'Sign in again.' });
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, snapshot());
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const t = (req.headers.authorization || '').slice(7);
      tokens.delete(t);
      if (devicesStore) { devicesStore.set('devices', devices().filter(d => d.hash !== tokenHash(t))); devicesStore.saveSoon(); }
      bus.emit('phone:update', status());
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/thumbs') {
      if (!settings.get('phone.thumbs')) return send(res, 200, {});
      return send(res, 200, await require('./wall').thumbs(null, 320));
    }
    const m = /^\/api\/action\/([a-zA-Z]+)$/.exec(url.pathname);
    if (req.method === 'POST' && m) {
      const body = await readBody(req);
      const r = await once(body.rid, () => { log.info(`Phone action ${m[1]} from ${ip}`); return action(m[1], body); });
      return send(res, 200, r);
    }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    return send(res, e.status || 500, { error: e.status ? e.message : (e.message || 'Something went wrong') });
  }
}

function start() {
  if (server) return status();
  if (!settings.get('phone.pinHash')) throw new Error('Set a PIN first.');
  const port = Number(settings.get('phone.port')) || 43821;
  lastError = null;
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => { handle(req, res).catch(() => { try { send(res, 500, { error: 'Error' }); } catch { /* closed */ } }); });
    // Idle connections stay open well past the phone's 5-second refresh. When both were
    // 5 s the phone reused a connection just as the PC closed it, and requests failed now and then.
    srv.keepAliveTimeout = 30_000; srv.headersTimeout = 35_000; srv.requestTimeout = 40_000;
    srv.on('error', (e) => {
      lastError = e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Pick another port.` : e.message;
      server = null; listening = null;
      bus.emit('phone:update', status());
      reject(new Error(lastError));
    });
    srv.listen(port, '0.0.0.0', () => {
      server = srv; listening = port;
      watchAddress();
      log.info(`Phone dashboard listening on port ${port}`);
      bus.emit('phone:update', status());
      resolve(status());
    });
  });
}

// ---------- "Check connection" ----------
// Why a phone can't reach the PC is almost always Windows, not MultiMenu: the Wi-Fi is
// set to Public (Windows blocks phones there), the firewall blocks MultiMenu, or a VPN
// is in the way. This reads those settings (nothing is changed) and says what to do.
const CHECK_PS = `$ErrorActionPreference='SilentlyContinue'
$p = @(Get-NetConnectionProfile | ForEach-Object { [pscustomobject]@{ alias = [string]$_.InterfaceAlias; category = $_.NetworkCategory.ToString() } })
$exe = $env:MM_EXE
$r = @(Get-NetFirewallApplicationFilter | Where-Object { $_.Program -ieq $exe } | Get-NetFirewallRule | Where-Object { $_.Direction.ToString() -eq 'Inbound' -and $_.Enabled.ToString() -eq 'True' } | ForEach-Object { [pscustomobject]@{ action = $_.Action.ToString(); profile = $_.Profile.ToString() } })
$f = @(Get-NetFirewallProfile | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; enabled = $_.Enabled.ToString() } })
[pscustomobject]@{ profiles = $p; rules = $r; firewall = $f } | ConvertTo-Json -Compress -Depth 4`;

function readWindowsNetwork() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', CHECK_PS],
      { windowsHide: true, timeout: 25_000, env: { ...process.env, MM_EXE: process.execPath } },
      (err, stdout) => { try { resolve(JSON.parse(String(stdout || '').trim())); } catch { resolve(null); } });
  });
}

/** Does a firewall rule's profile ("Private", "Domain, Private", "Any") cover this network type? (pure) */
function covers(profile, category) {
  const p = String(profile || '');
  if (/\bany\b/i.test(p)) return true;
  const want = /domain/i.test(category) ? 'Domain' : category;
  return p.split(/[,\s]+/).some(x => x.toLowerCase() === String(want).toLowerCase());
}

/** Turns what Windows reported into findings for the settings card (pure, unit-tested).
 *  addr: { address, name, virtual } the phone uses; all: every LAN address; win: readWindowsNetwork() output. */
function parseCheck({ running, error, reachable, addr, all = [], win }) {
  const items = [];
  const say = (level, text, fix) => items.push(fix ? { level, text, fix } : { level, text });
  if (!running) say('err', error || 'The phone dashboard is off. Turn it on first.');
  else if (reachable === false) say('err', 'MultiMenu could not reach its own phone page. Restart the phone dashboard (turn it off and on).');
  else if (running) say('ok', 'The phone dashboard is running.');
  if (!addr) say('err', 'This PC is not on a home network. Connect it to Wi-Fi or Ethernet.');
  let category = null;
  if (addr && win) {
    const prof = (win.profiles || []).find(p => p.alias === addr.name) || ((win.profiles || []).length === 1 ? win.profiles[0] : null);
    category = prof?.category || null;
    if (category === 'Public') say('err', `Windows treats “${addr.name}” as a Public network and blocks phones on it. If this is your home network, make it Private: Windows Settings, Network & internet, ${addr.name}, then Private network.`, 'network');
    else if (category === 'Private') say('ok', `“${addr.name}” is a Private network.`);
    else if (category) say('ok', `“${addr.name}” is a work network.`);
    const fwName = category === 'DomainAuthenticated' ? 'Domain' : category;
    const fwOn = !(win.firewall || []).some(f => f.name === fwName && f.enabled === 'False');
    if (category && fwOn) {
      const rules = win.rules || [];
      const blocked = rules.some(r => r.action === 'Block' && covers(r.profile, category));
      const allowed = rules.some(r => r.action === 'Allow' && covers(r.profile, category));
      if (blocked) say('err', 'Windows Firewall blocks MultiMenu on this network. Open “Allow an app through firewall”, then tick Private next to MultiMenu.', 'firewall');
      else if (!allowed) say('warn', 'Windows Firewall may block MultiMenu. Open “Allow an app through firewall” and tick Private next to MultiMenu (or answer Allow if Windows asks).', 'firewall');
      else say('ok', 'Windows Firewall lets MultiMenu through.');
    }
  }
  if (addr?.virtual) say('warn', `The address shown is on “${addr.name}”, which looks like a VPN or virtual adapter. Your phone can probably not reach it. Pick the Wi-Fi or Ethernet address instead.`);
  else if (all.some(a => a.virtual && /vpn|nordlynx|wireguard|openvpn|proton|mullvad|express|surfshark|windscribe|warp|tailscale|zerotier|radmin|hamachi|tap-|\btun\b/i.test(a.name))) say('warn', 'A VPN is on. Some VPNs stop phones on your Wi-Fi from reaching this PC. If the phone can’t connect, turn the VPN off or allow local network access in its settings.');
  say('info', 'Your phone must be on the same Wi-Fi as this PC (not mobile data, and not a guest network).');
  return { ok: !items.some(i => i.level === 'err'), items, address: addr?.address || null, network: addr?.name || null, category };
}

/** Self-request over the LAN address: shows the server answers (Windows Firewall never blocks the PC itself). */
function selfTest(address, port) {
  return new Promise((resolve) => {
    const q = http.get({ host: address, port, path: '/manifest.webmanifest', headers: { Host: `${address}:${port}` }, timeout: 4000 }, (r) => { r.resume(); resolve(r.statusCode === 200); });
    q.on('timeout', () => { q.destroy(); resolve(false); });
    q.on('error', () => resolve(false));
  });
}

async function check(address) {
  const st = status();
  const all = lanAddresses();
  const addr = all.find(a => a.address === address) || all[0] || null;
  const [reachable, win] = await Promise.all([st.running && addr ? selfTest(addr.address, st.port) : Promise.resolve(null), readWindowsNetwork()]);
  return parseCheck({ running: st.running, error: st.error, reachable, addr, all, win });
}

// ---------- address changes ----------
let addrTimer = null, lastAddress = null;
function watchAddress() {
  clearInterval(addrTimer);
  lastAddress = lanAddresses()[0]?.address || null;
  addrTimer = setInterval(() => {
    if (!server) return;
    const now = lanAddresses()[0]?.address || null;
    if (now === lastAddress) return;
    const before = lastAddress;
    lastAddress = now;
    if (!now) { log.warn('Phone dashboard: this PC left the network'); bus.emit('phone:update', status()); return; }
    log.info(`Phone dashboard address changed from ${before || 'none'} to ${now}`);
    bus.emit('phone:update', status());
    if (before) bus.emit('notify', { level: 'warn', title: 'Phone dashboard', message: `This PC's network address changed. On your phone, open http://${now}:${listening} or scan the new QR code in Settings.` });
  }, 30_000);
  addrTimer.unref?.();
}

function stop() {
  clearInterval(addrTimer); addrTimer = null;
  if (server) { try { server.close(); server.closeAllConnections?.(); } catch { /* ignore */ } }
  server = null; listening = null; tokens.clear();
  bus.emit('phone:update', status());
  return status();
}

async function setEnabled(on) {
  settings.set('phone.enabled', !!on);
  if (on) return start();
  return stop();
}

async function autoStart() {
  if (!settings.get('phone.enabled') || !settings.get('phone.pinHash')) return;
  try { await start(); } catch (e) { log.warn(e.message); }
}

async function qr(url) {
  return require('qrcode').toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0d0717', light: '#ffffff' } });
}

function status() {
  const port = listening || Number(settings.get('phone.port')) || 43821;
  const addrs = lanAddresses();
  const urls = addrs.map(a => `http://${a.address}:${port}`);
  const out = {
    enabled: !!settings.get('phone.enabled'), running: !!server, port, hasPin: !!settings.get('phone.pinHash'),
    allowControl: !!settings.get('phone.allowControl'), urls, networks: addrs.map(a => a.name), virtual: addrs.map(a => !!a.virtual), error: lastError,
    signedIn: [...tokens.values()].filter(t => t.exp > Date.now()).map(t => ({ ip: t.ip, at: t.at, agent: t.agent })),
    remembered: (() => { try { return devices().map(d => ({ id: d.id, ip: d.ip, at: d.at, lastSeen: d.lastSeen, agent: d.agent })); } catch { return []; } })(),
    thumbs: !!settings.get('phone.thumbs'),
  };
  return out;
}

/** Status plus a QR code of the first address (for the settings card). */
async function details(pick) {
  const out = status();
  const i = Math.max(0, out.urls.indexOf(String(pick || '')));
  out.qrUrl = out.urls[i] || null;
  if (out.running && out.qrUrl) { try { out.qr = await qr(out.qrUrl); } catch (e) { log.warn(e.message); } }
  return out;
}

module.exports = { forgetDevice, start, stop, setEnabled, autoStart, status, details, setPin, randomPin, signOutAll, isPrivate, hostAllowed, lanAddresses, checkPin, lockedFor, recordFail, snapshot, once, check, parseCheck, _handle: handle };
