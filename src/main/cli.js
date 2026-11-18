'use strict';
// Command line. `MultiMenu.exe --cli status` (or `mm status` with mm.cmd next to
// MultiMenu.exe) talks to the running MultiMenu over a named pipe. Windows only
// lets your own user account (and administrators) send to it, so no key is needed,
// and web pages can't reach it.
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function pipePath(dataDir) {
  const id = crypto.createHash('sha256').update(String(dataDir).toLowerCase()).digest('hex').slice(0, 12);
  return process.platform === 'win32' ? `\\\\.\\pipe\\multimenu-${id}` : path.join(os.tmpdir(), `multimenu-${id}.sock`);
}

// ---------- server (inside the running app) ----------
let server = null;
function startServer(dataDir) {
  if (server) return server;
  const commands = require('./modules/commands');
  const log = require('./logger').scope('cli');
  const file = pipePath(dataDir);
  if (process.platform !== 'win32') { try { fs.unlinkSync(file); } catch { /* none */ } }
  server = net.createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.setTimeout(30_000, () => sock.destroy());
    sock.on('data', async (d) => {
      buf += d;
      if (buf.length > 16_384) { sock.destroy(); return; }
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      let msg;
      try { msg = JSON.parse(buf.slice(0, nl)); } catch { sock.end(`${JSON.stringify({ ok: false, error: 'Bad request' })}\n`); return; }
      let out;
      try { out = await commands.run(String(msg.cmd || 'help'), Array.isArray(msg.args) ? msg.args.map(String).slice(0, 20) : [], { source: 'cli' }); }
      catch (e) { out = { ok: false, error: e.message }; }
      sock.end(`${JSON.stringify(out)}\n`);
    });
    sock.on('error', () => {});
  });
  server.on('error', (e) => { log.warn(`Command line unavailable: ${e.message}`); server = null; });
  server.listen(file);
  return server;
}
function stopServer() { try { server?.close(); } catch { /* ignore */ } server = null; }

// ---------- client (MultiMenu.exe --cli ...) ----------
function send(dataDir, cmd, args, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(pipePath(dataDir));
    let buf = '';
    const t = setTimeout(() => { sock.destroy(); reject(new Error('MultiMenu did not answer in time.')); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(`${JSON.stringify({ cmd, args })}\n`));
    sock.on('data', (d) => { buf += d; });
    sock.on('end', () => { clearTimeout(t); try { resolve(JSON.parse(buf.trim())); } catch { reject(new Error('MultiMenu sent an unreadable reply.')); } });
    sock.on('error', (e) => { clearTimeout(t); reject(e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? Object.assign(new Error('MultiMenu isn\'t running. Start it, then try again.'), { code: 'NOT_RUNNING' }) : e); });
  });
}

/** Splits argv after --cli into the command, its words and our own options. */
function parseCli(argv) {
  const i = argv.indexOf('--cli');
  const rest = i >= 0 ? argv.slice(i + 1) : [];
  const opts = { json: false, out: null };
  const words = [];
  for (const w of rest) {
    if (w === '--json') opts.json = true;
    else if (w.startsWith('--out=')) opts.out = w.slice(6);
    else words.push(w);
  }
  return { cmd: (words.shift() || 'help').toLowerCase(), args: words, ...opts };
}

async function runClient(argv, dataDir, exit) {
  const { cmd, args, json, out } = parseCli(argv);
  let text, code = 0;
  try {
    const r = await send(dataDir, cmd, args);
    if (!r.ok) { code = 1; text = json ? JSON.stringify(r) : `Error: ${r.error}`; }
    else text = json ? JSON.stringify(r, null, 2) : (cmd === 'help' ? `MultiMenu command line\n\nUsage: mm <command> [arguments] [--json]\n\n${r.message}` : r.message);
  } catch (e) {
    code = e.code === 'NOT_RUNNING' ? 2 : 1;
    text = json ? JSON.stringify({ ok: false, error: e.message }) : e.message;
  }
  text = `${text}\n`;
  // mm.cmd passes --out=<temp file>: GUI programs have no console, so it prints the file for us.
  if (out && /\.txt$/i.test(out) && path.isAbsolute(out)) { try { fs.writeFileSync(out, text, { flag: 'wx' }); } catch { /* fall back to stdout */ process.stdout.write(text); } }
  else { try { process.stdout.write(text); } catch { /* no console */ } }
  setTimeout(() => exit(code), 50);
}

module.exports = { pipePath, startServer, stopServer, send, parseCli, runClient };
