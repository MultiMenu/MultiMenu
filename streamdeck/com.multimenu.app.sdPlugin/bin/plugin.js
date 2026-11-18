'use strict';
// MultiMenu for Stream Deck. Talks to MultiMenu's local API on this PC
// (http://127.0.0.1:<port>, with your API key) and to the Stream Deck app over
// its local WebSocket. No dependencies: the WebSocket client is below.
const net = require('net');
const http = require('http');
const crypto = require('crypto');

// ---------- minimal WebSocket client (RFC 6455, text frames) ----------
class WS {
  constructor(port, onOpen, onMessage, onClose) {
    this.buf = Buffer.alloc(0); this.open = false; this.frags = [];
    const key = crypto.randomBytes(16).toString('base64');
    this.sock = net.connect(port, '127.0.0.1', () => {
      this.sock.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    this.sock.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      if (!this.open) {
        const end = this.buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = this.buf.slice(0, end).toString();
        if (!/^HTTP\/1\.1 101/.test(head) || !head.includes(accept)) { this.sock.destroy(); return; }
        this.buf = this.buf.slice(end + 4); this.open = true; onOpen();
      }
      this.readFrames(onMessage);
    });
    this.sock.on('close', () => { this.open = false; onClose(); });
    this.sock.on('error', () => {});
  }
  readFrames(onMessage) {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      const masked = (b1 & 0x80) !== 0;
      const mOff = off; if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = this.buf.slice(off, off + len);
      if (masked) { const m = this.buf.slice(mOff, mOff + 4); payload = Buffer.from(payload.map((x, i) => x ^ m[i % 4])); }
      this.buf = this.buf.slice(off + len);
      const op = b0 & 0x0f, fin = (b0 & 0x80) !== 0;
      if (op === 0x9) this.frame(0xA, payload);
      else if (op === 0x8) { try { this.frame(0x8, Buffer.alloc(0)); } catch { /* closing */ } this.sock.end(); return; }
      else if (op === 0x1 || op === 0x0) {
        this.frags.push(payload);
        if (fin) { const text = Buffer.concat(this.frags).toString('utf8'); this.frags = []; onMessage(text); }
      }
    }
  }
  frame(op, data) {
    const mask = crypto.randomBytes(4);
    const len = data.length;
    const head = len < 126 ? Buffer.from([0x80 | op, 0x80 | len]) : len < 65536 ? Buffer.from([0x80 | op, 0x80 | 126, len >> 8, len & 255]) : Buffer.concat([Buffer.from([0x80 | op, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
    const body = Buffer.from(data.map((x, i) => x ^ mask[i % 4]));
    this.sock.write(Buffer.concat([head, mask, body]));
  }
  send(obj) { if (this.open) this.frame(0x1, Buffer.from(JSON.stringify(obj), 'utf8')); }
}

// ---------- MultiMenu API ----------
let globalCfg = { port: 43822, key: '' };
function api(method, name, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: Number(globalCfg.port) || 43822, path: `/api/v1/${name}${method === 'GET' && body ? `?${new URLSearchParams(body)}` : ''}`, method,
      headers: { Authorization: `Bearer ${globalCfg.key || ''}`, 'X-MultiMenu-Client': 'streamdeck', ...(data && method === 'POST' ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) },
      timeout: 15000,
    }, (res) => {
      let s = ''; res.setEncoding('utf8');
      res.on('data', c => { s += c; });
      res.on('end', () => { try { const j = JSON.parse(s); resolve(res.statusCode === 200 ? j : { ok: false, error: j.error || `HTTP ${res.statusCode}` }); } catch { resolve({ ok: false, error: `HTTP ${res.statusCode}` }); } });
    });
    req.on('timeout', () => req.destroy(new Error('MultiMenu did not answer.')));
    req.on('error', (e) => resolve({ ok: false, error: e.code === 'ECONNREFUSED' ? 'MultiMenu is closed, or its local API is off.' : e.message }));
    if (data && method === 'POST') req.write(data);
    req.end();
  });
}

// ---------- Stream Deck ----------
const arg = (n) => { const i = process.argv.indexOf(`-${n}`); return i >= 0 ? process.argv[i + 1] : null; };
const PORT = Number(arg('port')), UUID = arg('pluginUUID'), REGISTER = arg('registerEvent');
const A = (s) => `com.multimenu.app.${s}`;
const contexts = new Map(); // context -> { action, settings }
let ws = null;

const ACTIONS = {
  [A('launch')]: (s) => api('POST', 'launch', { who: s.who || '', game: s.game || '' }),
  [A('preset')]: (s) => api('POST', 'preset', { name: s.name || '', action: s.mode === 'stop' ? 'stop' : 'start' }),
  [A('close')]: (s) => api('POST', 'close', { who: s.who || 'all' }),
  [A('tile')]: () => api('POST', 'tile'),
  [A('focus')]: (s) => api('POST', 'focus', { who: s.who || '' }),
  [A('rejoin')]: (s) => api('POST', 'rejoin', { who: s.who || '' }),
  [A('watcher')]: () => api('POST', 'watcher', { state: 'toggle' }),
  [A('eco')]: () => api('POST', 'eco', { state: 'toggle' }),
  [A('status')]: () => api('POST', 'wall'),
};

function sd(event, context, payload) { ws?.send(payload === undefined ? { event, context } : { event, context, payload }); }

async function refresh() {
  if (!contexts.size || !globalCfg.key) return;
  const needStatus = [...contexts.values()].some(c => [A('status'), A('watcher'), A('eco')].includes(c.action));
  const st = needStatus ? await api('GET', 'status') : null;
  for (const [ctx, c] of contexts) {
    if (c.action === A('status') && st) {
      if (!st.ok) sd('setTitle', ctx, { title: 'Off' });
      else sd('setTitle', ctx, { title: `${st.data.sessions.filter(x => x.status === 'running').length} ▶${st.data.pc ? `\n${st.data.pc.ram}% RAM` : ''}` });
    }
    if (c.action === A('watcher') && st?.ok) sd('setState', ctx, { state: st.data.watcher.enabled ? 1 : 0 });
    if (c.action === A('focus') && c.settings.thumb && c.settings.who) {
      const t = await api('GET', 'thumb', { who: c.settings.who });
      if (t.ok && t.data?.image) sd('setImage', ctx, { image: t.data.image, target: 0 });
    }
  }
}

function connect() {
  ws = new WS(PORT, () => {
    ws.send({ event: REGISTER, uuid: UUID });
    ws.send({ event: 'getGlobalSettings', context: UUID });
  }, async (text) => {
    let m; try { m = JSON.parse(text); } catch { return; }
    const { event, context, action, payload = {} } = m;
    if (event === 'didReceiveGlobalSettings') { globalCfg = { port: 43822, key: '', ...(payload.settings || {}) }; refresh(); }
    else if (event === 'willAppear') { contexts.set(context, { action, settings: payload.settings || {} }); refresh(); }
    else if (event === 'willDisappear') contexts.delete(context);
    else if (event === 'didReceiveSettings') { contexts.set(context, { action, settings: payload.settings || {} }); refresh(); }
    else if (event === 'keyDown') {
      const run = ACTIONS[action];
      if (!run) return;
      if (!globalCfg.key) { sd('showAlert', context); return; }
      const r = await run(payload.settings || {});
      sd(r.ok ? 'showOk' : 'showAlert', context);
      setTimeout(refresh, 1500);
    } else if (event === 'sendToPlugin') {
      if (payload.type === 'test' || payload.type === 'lists') {
        if (payload.globalCfg) globalCfg = { ...globalCfg, ...payload.globalCfg };
        const [acc, pre] = await Promise.all([api('GET', 'accounts'), api('GET', 'presets')]);
        sd('sendToPropertyInspector', context, {
          type: 'lists', ok: acc.ok, error: acc.error || null,
          accounts: acc.ok ? acc.data.accounts.map(a => ({ name: a.name, tags: a.tags })) : [], presets: pre.ok ? pre.data.presets.map(p => p.name) : [],
        });
      }
    }
  }, () => { setTimeout(connect, 2000); });
}

if (PORT && UUID && REGISTER) {
  connect();
  setInterval(() => { refresh().catch(() => {}); }, 8000);
}

module.exports = { WS, api };
