'use strict';
// Reads the log files each Roblox client writes to %LOCALAPPDATA%\Roblox\logs.
// Used to learn which server a client joined (so it can rejoin the same one),
// to spot disconnects while the window is still open, and for the log viewer.
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

const PATTERNS = {
  join: /! Joining game '([0-9a-f-]{36})' place (\d+) at ([\d.]+)/i,
  joined: /\[FLog::Network\] serverId:/i,
  teleport: /initiateTeleport/i,
  disconnect: /\[FLog::Network\] Time to disconnect replication data|Disconnection Notification|Sending disconnect with reason|Lost connection with reason/i,
  reason: /reason:?\s*(\d{2,4})/i,
  userId: /\buserid[:=]\s*(\d{1,15})/i,
};

function logsDir() {
  return process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Roblox', 'logs') : null;
}

const claimed = new Set();

/** When Roblox says a log was started, from its name ("..._20261117T153012Z_Player_..."), or null (pure). */
function nameTime(name) {
  const m = /_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z_/.exec(name);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

// The logs folder can hold thousands of files. One listing is shared for a few seconds,
// and files whose name says they're from another time aren't opened at all, so finding
// the logs of many new clients doesn't hold MultiMenu up.
let listing = { at: 0, dir: null, files: [] };
function playerLogs(dir) {
  if (listing.dir === dir && Date.now() - listing.at < 3000) return listing.files;
  const files = fs.readdirSync(dir).filter(f => /player/i.test(f) && f.endsWith('.log'));
  listing = { at: Date.now(), dir, files };
  return files;
}

/** Finds the player log created when this session started (oldest unclaimed log at/after launch). */
function findLogFor(startedAt) {
  const dir = logsDir();
  if (!dir) return null;
  let files = [];
  try { files = playerLogs(dir); } catch { return null; }
  const cands = [];
  for (const f of files) {
    const p = path.join(dir, f);
    if (claimed.has(p)) continue;
    const named = nameTime(f);
    if (named != null && (named < startedAt - 10 * 60_000 || named > startedAt + 10 * 60_000)) continue;
    try {
      const st = fs.statSync(p);
      const born = st.birthtimeMs || st.ctimeMs;
      if (born >= startedAt - 15000 && born <= startedAt + 180000) cands.push({ p, born });
    } catch { /* gone */ }
  }
  cands.sort((a, b) => a.born - b.born);
  if (!cands.length) return null;
  claimed.add(cands[0].p);
  return cands[0].p;
}

function release(file) { claimed.delete(file); }
function isClaimed(file) { return claimed.has(file); }

/** The Roblox user ID a client's log belongs to (it appears once the client signs in to a game). */
function userIdFrom(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 4 * 1024 * 1024));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const m = buf.toString('utf8').match(PATTERNS.userId);
    return m ? m[1] : null;
  } catch { return null; }
}

/** Reads new lines since the last call. state = { offset, teleportAt } (mutated). */
function readNew(file, state) {
  const out = { lines: [], events: [] };
  let fd;
  try {
    const size = fs.statSync(file).size;
    if (state.offset == null) state.offset = 0;
    if (size < state.offset) state.offset = 0;
    const len = Math.min(size - state.offset, 2 * 1024 * 1024);
    if (len <= 0) return out;
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, state.offset);
    const text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) return out; // wait for a full line
    state.offset += Buffer.byteLength(text.slice(0, lastNl + 1));
    out.lines = text.slice(0, lastNl).split(/\r?\n/);
  } catch { return out; } finally { if (fd !== undefined) fs.closeSync(fd); }
  out.events = parseLines(out.lines, state);
  return out;
}

/** Turns log lines into events: join (jobId, placeId), joined, teleport, teleportLeft, disconnect (reason). */
function parseLines(lines, state = {}) {
  const events = [];
  for (const line of lines) {
    let m;
    if ((m = line.match(PATTERNS.join))) events.push({ type: 'join', jobId: m[1], placeId: m[2], ip: m[3] });
    else if (PATTERNS.joined.test(line)) events.push({ type: 'joined' });
    else if (PATTERNS.teleport.test(line)) { state.teleportAt = Date.now(); events.push({ type: 'teleport' }); }
    else if (PATTERNS.disconnect.test(line)) {
      // A real teleport leaves the old server right after it starts: that's not a disconnect,
      // it's the moment the client starts loading the next server. A teleport line with no
      // leave after it (a game's own output, or a teleport that failed) changes nothing.
      const teleporting = state.teleportAt && Date.now() - state.teleportAt < 60000;
      if (teleporting) { state.teleportAt = null; events.push({ type: 'teleportLeft' }); }
      else events.push({ type: 'disconnect', reason: (line.match(PATTERNS.reason) || [])[1] || null });
    }
  }
  return events;
}

/** Last N lines for the log viewer, with anything secret-looking redacted. */
function tail(file, maxLines = 400, filter = '') {
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - 512 * 1024);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    let lines = buf.toString('utf8').split(/\r?\n/);
    if (start > 0) lines.shift();
    if (filter) { const f = filter.toLowerCase(); lines = lines.filter(l => l.toLowerCase().includes(f)); }
    return lines.slice(-maxLines).map(l => logger.redact(l).replace(/[A-Za-z0-9+/=_-]{160,}/g, '[REDACTED]').slice(0, 2000));
  } catch (e) { throw new Error(`Could not read the log: ${e.message}`); }
}

module.exports = { logsDir, nameTime, findLogFor, release, isClaimed, userIdFrom, readNew, parseLines, tail, PATTERNS };
