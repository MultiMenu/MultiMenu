'use strict';
// Local API for your own scripts, the Stream Deck plugin and other tools.
//  - Listens on 127.0.0.1 only: nothing on your network or the internet can reach it.
//  - Every request needs your API key (Authorization: Bearer <key>). The key is
//    stored encrypted and compared as a hash. Wrong keys are rate-limited.
//  - The Host header must be 127.0.0.1 or localhost (stops DNS-rebinding web pages),
//    and there are no CORS headers, so web pages in your browser can't use it.
//  - Replies never include logins, cookies, passwords, webhooks or tokens.
const http = require('http');
const crypto = require('crypto');
const settings = require('./settings');
const secure = require('../secure');
const bus = require('../bus');
const log = require('../logger').scope('api');

let server = null, listening = null, lastError = null;
let fails = [];
let lockUntil = 0;
const calls = { count: 0, last: null };

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
function key() { const e = settings.get('api.keyEnc'); try { return e ? secure.decrypt(e) : null; } catch { return null; } }
function newKey() {
  const k = `mm_${crypto.randomBytes(24).toString('base64url')}`;
  settings.set('api.keyEnc', secure.encrypt(k));
  bus.emit('api:update', status());
  return k;
}
function keyMatches(given) {
  const k = key();
  if (!k || typeof given !== 'string' || !given) return false;
  return crypto.timingSafeEqual(sha(given), sha(k));
}
/** Host must be loopback by name or number. */
function hostOk(host, port) {
  const h = String(host || '').toLowerCase();
  return [`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1', 'localhost', `[::1]:${port}`].includes(h);
}
const loopback = (ip) => /^(127\.|::1$|::ffff:127\.)/.test(String(ip || ''));

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 8192) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('The body must be JSON.'), { status: 400 })); } });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const port = listening || settings.get('api.port');
  if (!loopback(req.socket.remoteAddress)) { req.socket.destroy(); return; }
  if (!hostOk(req.headers.host, port)) return send(res, 421, { ok: false, error: 'Use http://127.0.0.1 to reach the MultiMenu API.' });
  if (req.headers.origin) return send(res, 403, { ok: false, error: 'Browsers can\'t use the MultiMenu API.' });
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/api/v1/ping') return send(res, 200, { ok: true });
  if (Date.now() < lockUntil) return send(res, 429, { ok: false, error: 'Too many wrong keys. Try again in a minute.' });
  const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1] || req.headers['x-multimenu-key'];
  if (!keyMatches(auth)) {
    fails = fails.filter(t => Date.now() - t < 60_000);
    fails.push(Date.now());
    if (fails.length >= 10) { lockUntil = Date.now() + 60_000; log.warn('Too many wrong API keys: locked for a minute'); }
    return send(res, 401, { ok: false, error: 'Wrong or missing API key.' });
  }
  const m = /^\/api\/v1\/([a-z]+)$/.exec(url.pathname);
  if (!m) return send(res, 404, { ok: false, error: 'Not found. Try GET /api/v1/help' });
  const name = m[1];
  const commands = require('./commands');
  if (!commands.COMMANDS[name]) return send(res, 404, { ok: false, error: `Unknown command “${name}”.` });
  const readOnly = ['help', 'status', 'accounts', 'presets', 'thumb'].includes(name);
  if (req.method === 'GET' && !readOnly) return send(res, 405, { ok: false, error: `Use POST for ${name}.` });
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { ok: false, error: 'Use GET or POST.' });
  try {
    const args = req.method === 'POST' ? await readBody(req) : Object.fromEntries(url.searchParams);
    const client = String(req.headers['x-multimenu-client'] || 'api').replace(/[^\w.-]/g, '').slice(0, 30) || 'api';
    const r = await commands.run(name, args, { source: client });
    calls.count++; calls.last = { at: Date.now(), name, client };
    return send(res, 200, r);
  } catch (e) {
    return send(res, e.status || 500, { ok: false, error: e.message || 'Something went wrong' });
  }
}

function start() {
  if (server) return Promise.resolve(status());
  if (!key()) newKey();
  const port = Number(settings.get('api.port')) || 43822;
  lastError = null;
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => { handle(req, res).catch(() => { try { send(res, 500, { ok: false, error: 'Error' }); } catch { /* closed */ } }); });
    srv.headersTimeout = 10_000; srv.requestTimeout = 15_000;
    srv.on('error', (e) => {
      lastError = e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Pick another port.` : e.message;
      server = null; listening = null; bus.emit('api:update', status()); reject(new Error(lastError));
    });
    srv.listen(port, '127.0.0.1', () => { server = srv; listening = port; log.info(`Local API on 127.0.0.1:${port}`); bus.emit('api:update', status()); resolve(status()); });
  });
}
function stop() { if (server) { try { server.close(); server.closeAllConnections?.(); } catch { /* ignore */ } } server = null; listening = null; bus.emit('api:update', status()); return status(); }
async function setEnabled(on) { settings.set('api.enabled', !!on); if (on) return start(); return stop(); }
async function autoStart() { if (settings.get('api.enabled')) { try { await start(); } catch (e) { log.warn(e.message); } } }
function status() {
  return { enabled: !!settings.get('api.enabled'), running: !!server, port: listening || Number(settings.get('api.port')) || 43822, hasKey: !!settings.get('api.keyEnc'), error: lastError, calls: { ...calls }, cli: !!settings.get('api.cli') };
}

module.exports = { start, stop, setEnabled, autoStart, status, key, newKey, keyMatches, hostOk, _handle: handle };
