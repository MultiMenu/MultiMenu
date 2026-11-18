'use strict';
// Logs page: every Roblox log on this PC (not only running alts), which
// account each one belongs to, and a search across them with filters for
// disconnects, errors and joins. Error codes are explained in plain words.
const fs = require('fs');
const path = require('path');
const robloxlogs = require('./robloxlogs');
const errorcodes = require('./errorcodes');
const accounts = require('./accounts');
const logger = require('../logger');

const KINDS = {
  disconnect: robloxlogs.PATTERNS.disconnect,
  error: /\[(FLog|DFLog)::\w*Error\w*\]|\berror\b|\bexception\b|\bcrash/i,
  join: robloxlogs.PATTERNS.join,
  teleport: robloxlogs.PATTERNS.teleport,
};
const MAX_FILES = 60, READ_BYTES = 3 * 1024 * 1024;
const userCache = new Map(); // file -> userId (logs don't change owner)

/** Which kind a log line is (pure, unit-tested). */
function kindOf(line) {
  if (KINDS.join.test(line)) return 'join';
  if (KINDS.disconnect.test(line)) return 'disconnect';
  if (KINDS.teleport.test(line)) return 'teleport';
  if (KINDS.error.test(line)) return 'error';
  return 'info';
}

/** Error code in a disconnect line, explained (pure, unit-tested). */
function explain(line) {
  const m = line.match(/(?:reason|code|error)[:= ]+\s*(\d{2,4})\b/i);
  if (!m) return null;
  const e = errorcodes.lookup(Number(m[1]));
  return e ? { code: e.code ?? Number(m[1]), title: e.title, meaning: e.meaning } : null;
}

const clean = (l) => logger.redact(l).replace(/[A-Za-z0-9+/=_-]{160,}/g, '[REDACTED]').slice(0, 2000);

function readFile(file, bytes = READ_BYTES) {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - bytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split(/\r?\n/);
    if (start > 0) lines.shift();
    return lines;
  } finally { fs.closeSync(fd); }
}

function owner(file) {
  if (!userCache.has(file)) userCache.set(file, robloxlogs.userIdFrom(file));
  const uid = userCache.get(file);
  if (!uid) return null;
  const a = (accounts.getAll().accounts || []).find(x => String(x.userId) === String(uid));
  return a ? { accountId: a.id, label: a.alias || a.displayName || a.username } : { accountId: null, label: `User ${uid}` };
}

/** Newest player logs first. */
function files() {
  const dir = robloxlogs.logsDir();
  if (!dir || !fs.existsSync(dir)) return { dir, files: [] };
  let names = [];
  try { names = fs.readdirSync(dir).filter(f => /player/i.test(f) && f.endsWith('.log')); } catch { return { dir, files: [] }; }
  const list = names.map(f => { try { const st = fs.statSync(path.join(dir, f)); return { name: f, size: st.size, modified: st.mtimeMs }; } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.modified - a.modified).slice(0, MAX_FILES);
  for (const f of list) {
    const o = owner(path.join(dir, f.name));
    f.account = o?.label || null; f.accountId = o?.accountId || null;
    f.claimed = robloxlogs.isClaimed(path.join(dir, f.name));
  }
  return { dir, files: list };
}

const safeName = (name) => { if (!/^[\w.-]+\.log$/i.test(String(name))) throw new Error('Not a Roblox log file.'); return String(name); };

/** Lines of one log, optionally only one kind or containing some text. */
function read(name, { kind = '', q = '' } = {}) {
  const dir = robloxlogs.logsDir();
  if (!dir) throw new Error('Roblox logs folder not found.');
  const file = path.join(dir, safeName(name));
  const query = String(q || '').toLowerCase().slice(0, 100);
  const lines = readFile(file).map(l => ({ text: clean(l), kind: kindOf(l) })).filter(l => l.text && (!kind || l.kind === kind) && (!query || l.text.toLowerCase().includes(query)));
  return { name, account: owner(file)?.label || null, total: lines.length, lines: lines.slice(-1500).map(l => ({ ...l, why: l.kind === 'disconnect' ? explain(l.text) : null })) };
}

/** Search every recent log at once. */
function search({ kind = '', q = '', limit = 400 } = {}) {
  const query = String(q || '').toLowerCase().slice(0, 100);
  if (!kind && !query) throw new Error('Type something to search for, or pick a filter.');
  const { dir, files: list } = files();
  const hits = [];
  const counts = { disconnect: 0, error: 0, join: 0, teleport: 0 };
  for (const f of list) {
    let lines;
    try { lines = readFile(path.join(dir, f.name), 1024 * 1024); } catch { continue; }
    for (const raw of lines) {
      const k = kindOf(raw);
      if (counts[k] != null) counts[k]++;
      if ((kind && k !== kind) || (query && !raw.toLowerCase().includes(query))) continue;
      if (hits.length < limit) hits.push({ file: f.name, account: f.account, text: clean(raw), kind: k, why: k === 'disconnect' ? explain(raw) : null });
    }
  }
  return { hits, counts, files: list.length, more: hits.length >= limit };
}

/** Disconnect reasons over the recent logs, most common first. */
function summary() {
  const { dir, files: list } = files();
  const reasons = new Map();
  for (const f of list.slice(0, 30)) {
    let lines;
    try { lines = readFile(path.join(dir, f.name), 1024 * 1024); } catch { continue; }
    for (const l of lines) {
      if (kindOf(l) !== 'disconnect') continue;
      const w = explain(l);
      const key = w ? String(w.code) : 'unknown';
      const r = reasons.get(key) || { code: w?.code ?? null, title: w?.title || 'Disconnected (no code)', count: 0, accounts: new Set() };
      r.count++; if (f.account) r.accounts.add(f.account);
      reasons.set(key, r);
    }
  }
  return [...reasons.values()].sort((a, b) => b.count - a.count).slice(0, 10).map(r => ({ ...r, accounts: [...r.accounts].slice(0, 6) }));
}

module.exports = { files, read, search, summary, kindOf, explain };
