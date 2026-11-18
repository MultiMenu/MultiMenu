'use strict';
// Session timeline: when each alt was running over the last two weeks, and where
// it crashed, disconnected, froze or was restarted.
const { JsonStore } = require('../store');
const paths = require('../paths');
const bus = require('../bus');

const KEEP = 14 * 86400000, MAX = 4000;
let store = null, beat = null;

function init() {
  store = new JsonStore(paths.file('timeline.json'), { spans: [], marks: [], lastSeen: 0 });
  // Spans left open by a crash or power cut end when MultiMenu was last seen running.
  const last = store.get('lastSeen') || Date.now();
  for (const s of store.get('spans')) if (!s.end) { s.end = Math.max(s.start, last); s.reason = s.reason || 'unknown'; }
  prune();
  store.saveSoon();
  if (!attached) attach();
  clearInterval(beat);
  beat = setInterval(() => { store.set('lastSeen', Date.now()); }, 60_000);
  beat.unref?.();
  return store;
}

function prune(now = Date.now()) {
  const spans = store.get('spans').filter(s => !s.end || now - s.end < KEEP);
  const marks = store.get('marks').filter(m => now - m.at < KEEP);
  store.set('spans', spans.slice(-MAX));
  store.set('marks', marks.slice(-MAX));
}

function start(p) {
  if (!store || !p?.id) return;
  const spans = store.get('spans');
  if (spans.some(s => s.id === p.id && !s.end)) return;
  spans.push({ id: p.id, accountId: p.accountId || null, label: String(p.label || '').slice(0, 60), game: String(p.placeName || (p.placeId ? `Place ${p.placeId}` : '')).slice(0, 80), start: p.startedAt || Date.now(), end: null, reason: null });
  if (spans.length > MAX + 200) prune();
  store.saveSoon();
}
function end(p) {
  if (!store || !p?.id) return;
  const s = store.get('spans').find(x => x.id === p.id && !x.end);
  if (!s) return;
  s.end = p.endedAt || Date.now();
  s.reason = p.reason || 'closed';
  if (!s.game && p.placeName) s.game = String(p.placeName).slice(0, 80);
  store.saveSoon();
}
function mark(kind, p) {
  if (!store) return;
  store.get('marks').push({ at: Date.now(), kind, accountId: p.accountId || null, label: String(p.label || '').slice(0, 60), detail: String(p.detail || '').slice(0, 160) });
  store.saveSoon();
}

let attached = false;
function attach() {
  attached = true;
  bus.on('session:started', start);
  bus.on('session:stopped', end);
  bus.on('watcher:problem', (p) => mark(p.kind, p));
  bus.on('event', (e) => { if (e.type === 'watcherRejoin' && !e.test) mark('rejoin', { label: e.account, detail: e.detail }); });
}

/** Closes open spans when MultiMenu quits. */
function closeAll(reason = 'app closed') {
  if (!store) return;
  for (const s of store.get('spans')) if (!s.end) { s.end = Date.now(); s.reason = reason; }
  store.saveNow();
}

/** Pure grouping (unit-tested): rows per account for a time range. */
function group(spans, marks, from, to, now = Date.now()) {
  const rows = new Map();
  const key = (x) => x.accountId || `label:${x.label}`;
  const row = (x) => { const k = key(x); if (!rows.has(k)) rows.set(k, { key: k, accountId: x.accountId, label: x.label, spans: [], marks: [], ms: 0 }); return rows.get(k); };
  for (const s of spans) {
    const e = s.end || now;
    if (e < from || s.start > to) continue;
    const r = row(s);
    r.spans.push({ start: Math.max(from, s.start), end: Math.min(to, e), realStart: s.start, realEnd: s.end, reason: s.reason, game: s.game, live: !s.end });
    r.ms += Math.min(to, e) - Math.max(from, s.start);
    r.label = s.label || r.label;
  }
  for (const m of marks) if (m.at >= from && m.at <= to) row(m).marks.push({ at: m.at, kind: m.kind, detail: m.detail });
  return [...rows.values()].sort((a, b) => b.ms - a.ms);
}

function query(hours = 24) {
  const h = Math.max(1, Math.min(14 * 24, Number(hours) || 24));
  const to = Date.now(), from = to - h * 3600000;
  return { from, to, rows: store ? group(store.get('spans'), store.get('marks'), from, to) : [] };
}

/** For achievements and Wrapped: the longest single session and whether one ran at 3 AM. */
function records() {
  if (!store) return { longestMs: 0, nightOwl: false };
  let longestMs = 0, nightOwl = false;
  for (const s of store.get('spans')) {
    const e = s.end || Date.now();
    longestMs = Math.max(longestMs, e - s.start);
    if (!nightOwl) {
      const d = new Date(s.start); d.setHours(3, 0, 0, 0);
      if (d.getTime() < s.start) d.setDate(d.getDate() + 1);
      nightOwl = d.getTime() <= e;
    }
  }
  return { longestMs, nightOwl };
}

module.exports = { init, query, group, records, closeAll, prune };
