'use strict';
// Macro recorder and player.
// Recording polls key and mouse state ~125 times a second with GetAsyncKeyState
// (no system-wide hooks are installed). Playback replays events with SendInput,
// scaled by playback speed. Any keys or buttons held by playback are released
// when it stops, including on emergency stop.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const win32 = require('../native/win32');
const settings = require('./settings');
const paths = require('../paths');
const { VK, NAME, RECORDABLE } = require('./keys');
const bus = require('../bus');
const log = require('../logger').scope('macros');

const MOUSE_VK = { 1: 'left', 2: 'right', 4: 'middle' };
const TYPES = new Set(['move', 'mdown', 'mup', 'kdown', 'kup']);
const MAX_EVENTS = 200_000;

const rec = { active: false, paused: false, events: [], startedAt: 0, pausedTotal: 0, pausedAt: 0, timer: null, keyState: new Map(), lastPos: null, lastMoveT: -1 };
const play = { active: false, macroId: null, timers: [], held: new Set(), heldButtons: new Set(), loop: 0, progress: 0, duration: 0, startedAt: 0 };

// ---------- storage ----------
const fileFor = id => path.join(paths.macrosDir(), `${id.replace(/[^a-z0-9-]/gi, '')}.json`);

function validateMacro(m) {
  if (!m || typeof m !== 'object') throw new Error('Not a MultiMenu macro file.');
  if (typeof m.name !== 'string' || !Array.isArray(m.events)) throw new Error('Macro file is missing its name or events.');
  if (m.events.length > MAX_EVENTS) throw new Error('Macro is too large.');
  const events = m.events.map(e => {
    if (!e || !TYPES.has(e.type) || !(Number.isFinite(e.t) && e.t >= 0)) throw new Error('Macro contains an invalid event.');
    const o = { t: Math.round(e.t), type: e.type };
    if (e.type === 'move' || e.type === 'mdown' || e.type === 'mup') {
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) throw new Error('Mouse event without a position.');
      o.x = Math.round(e.x); o.y = Math.round(e.y);
      if (e.type !== 'move') { if (!['left', 'right', 'middle'].includes(e.button)) throw new Error('Unknown mouse button.'); o.button = e.button; }
    } else {
      if (!Number.isInteger(e.vk) || e.vk < 1 || e.vk > 254) throw new Error('Invalid key code.');
      o.vk = e.vk;
    }
    return o;
  }).sort((a, b) => a.t - b.t);
  return { name: m.name.slice(0, 60), events };
}

function list() {
  let files = [];
  try { files = fs.readdirSync(paths.macrosDir()).filter(f => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(paths.macrosDir(), f), 'utf8'));
      out.push({ id: m.id, name: m.name, createdAt: m.createdAt, lastUsedAt: m.lastUsedAt || null, durationMs: m.durationMs, eventCount: m.events.length });
    } catch { /* skip unreadable */ }
  }
  return out.sort((a, b) => (b.lastUsedAt || b.createdAt) - (a.lastUsedAt || a.createdAt));
}

function load(id) { return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')); }

function saveMacro({ name, events, id }) {
  const v = validateMacro({ name, events });
  const m = { id: id || crypto.randomUUID(), name: v.name, createdAt: Date.now(), durationMs: v.events.at(-1)?.t || 0, events: v.events };
  fs.writeFileSync(fileFor(m.id), JSON.stringify(m));
  bus.emit('macros:changed');
  return { id: m.id, name: m.name };
}

function rename(id, name) {
  const m = load(id);
  m.name = String(name).trim().slice(0, 60) || m.name;
  fs.writeFileSync(fileFor(id), JSON.stringify(m));
  bus.emit('macros:changed');
  return true;
}

function remove(id) { try { fs.unlinkSync(fileFor(id)); } catch { /* already gone */ } bus.emit('macros:changed'); return true; }

function get(id) {
  const m = load(id);
  return { id: m.id, name: m.name, durationMs: m.durationMs, events: m.events.slice(0, 5000).map(e => (e.vk ? { ...e, key: NAME[e.vk] || `VK ${e.vk}` } : e)), totalEvents: m.events.length };
}

function importText(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  return saveMacro(validateMacro(raw));
}

function exportText(id) { const m = load(id); return JSON.stringify({ format: 'multimenu-macro', version: 1, name: m.name, events: m.events }, null, 1); }

// ---------- recording ----------
function hotkeyVks() {
  const h = settings.get('hotkeys');
  return new Set(Object.values(h).map(k => VK[String(k).split('+').pop()]).filter(Boolean));
}

function startRecording() {
  if (!win32.available) throw new Error('Macro recording needs Windows.');
  if (play.active) throw new Error('Stop playback before recording.');
  if (rec.active) return status();
  const ignore = hotkeyVks();
  const watch = RECORDABLE.filter(v => !ignore.has(v));
  Object.assign(rec, { active: true, paused: false, events: [], startedAt: performance.now(), pausedTotal: 0, keyState: new Map(), lastPos: win32.getCursor(), lastMoveT: -1 });
  // Prime current state so keys already held (e.g. the hotkey) aren't recorded.
  for (const v of [...watch, 1, 2, 4]) rec.keyState.set(v, win32.isKeyDown(v));
  const recordMoves = settings.get('macros.recordMouseMoves');
  rec.timer = setInterval(() => {
    if (rec.paused) return;
    const t = Math.round(performance.now() - rec.startedAt - rec.pausedTotal);
    const pos = win32.getCursor();
    if (recordMoves && (pos.x !== rec.lastPos.x || pos.y !== rec.lastPos.y) && t - rec.lastMoveT >= 15) {
      rec.events.push({ t, type: 'move', x: pos.x, y: pos.y }); rec.lastPos = pos; rec.lastMoveT = t;
    }
    for (const [vk, button] of Object.entries(MOUSE_VK)) {
      const down = win32.isKeyDown(+vk);
      if (down !== rec.keyState.get(+vk)) {
        rec.keyState.set(+vk, down);
        rec.events.push({ t, type: down ? 'mdown' : 'mup', button, x: pos.x, y: pos.y });
      }
    }
    for (const vk of watch) {
      const down = win32.isKeyDown(vk);
      if (down !== rec.keyState.get(vk)) { rec.keyState.set(vk, down); rec.events.push({ t, type: down ? 'kdown' : 'kup', vk }); }
    }
    if (rec.events.length > MAX_EVENTS) stopRecording(false);
  }, 8);
  emit();
  return status();
}

function pauseRecording() {
  if (!rec.active) return status();
  if (rec.paused) { rec.pausedTotal += performance.now() - rec.pausedAt; rec.paused = false; }
  else { rec.pausedAt = performance.now(); rec.paused = true; }
  emit();
  return status();
}

function stopRecording(saveIt = true, name) {
  if (!rec.active) return { saved: null };
  clearInterval(rec.timer);
  rec.active = false; rec.paused = false;
  let saved = null;
  if (saveIt && rec.events.length) {
    // Drop unmatched trailing "down" events' partners are handled at playback; save as-is.
    saved = saveMacro({ name: name || `Macro ${new Date().toLocaleString()}`, events: rec.events });
    log.info(`Recorded macro with ${rec.events.length} events`);
  }
  rec.events = [];
  emit();
  return { saved, status: status() };
}

// ---------- playback ----------
function releaseHeld() {
  for (const vk of play.held) { try { win32.key(vk, false); } catch { /* ignore */ } }
  for (const b of play.heldButtons) { try { win32.mouseButton(b, false); } catch { /* ignore */ } }
  play.held.clear(); play.heldButtons.clear();
}

function runEvent(e) {
  switch (e.type) {
    case 'move': win32.setCursor(e.x, e.y); break;
    case 'mdown': win32.setCursor(e.x, e.y); win32.mouseButton(e.button, true); play.heldButtons.add(e.button); break;
    case 'mup': win32.setCursor(e.x, e.y); win32.mouseButton(e.button, false); play.heldButtons.delete(e.button); break;
    case 'kdown': win32.key(e.vk, true); play.held.add(e.vk); break;
    case 'kup': win32.key(e.vk, false); play.held.delete(e.vk); break;
    default: break;
  }
}

function startPlayback(id, opts = {}) {
  if (!win32.available) throw new Error('Macro playback needs Windows.');
  if (rec.active) throw new Error('Stop recording before playing a macro.');
  if (play.active) stopPlayback();
  const m = load(id);
  const v = validateMacro(m);
  const speed = Math.min(8, Math.max(0.1, Number(opts.speed ?? settings.get('macros.playbackSpeed')) || 1));
  const repeat = Math.max(0, Math.floor(Number(opts.repeat ?? settings.get('macros.repeat')) || 0)); // 0 = loop forever
  m.lastUsedAt = Date.now();
  fs.writeFileSync(fileFor(id), JSON.stringify(m));
  Object.assign(play, { active: true, macroId: id, macroName: m.name, loop: 0, repeat, speed, duration: (v.events.at(-1)?.t || 0) / speed, startedAt: performance.now() });

  const runLoop = () => {
    if (!play.active) return;
    play.loop++;
    play.startedAt = performance.now();
    let i = 0;
    const base = performance.now();
    // Chunked scheduler: one timer at a time, catching up on any due events.
    const step = () => {
      if (!play.active) return;
      const elapsed = (performance.now() - base) * speed;
      while (i < v.events.length && v.events[i].t <= elapsed) {
        try { runEvent(v.events[i]); } catch (e) { log.error('playback event', e); }
        i++;
      }
      if (i >= v.events.length) {
        releaseHeld();
        if (repeat === 0 || play.loop < repeat) { play.timers = [setTimeout(runLoop, 150)]; }
        else stopPlayback();
        emit();
        return;
      }
      const wait = Math.max(0, (v.events[i].t - elapsed) / speed);
      play.timers = [setTimeout(step, Math.min(wait, 250))];
    };
    step();
  };
  runLoop();
  bus.emit('macros:changed');
  emit();
  return status();
}

function stopPlayback() {
  play.timers.forEach(clearTimeout);
  play.timers = [];
  const was = play.active;
  play.active = false;
  releaseHeld();
  if (was) emit();
  return status();
}

function status() {
  return {
    available: win32.available,
    recording: rec.active, paused: rec.paused, recordedEvents: rec.events.length,
    recordingMs: rec.active ? Math.round(performance.now() - rec.startedAt - rec.pausedTotal - (rec.paused ? performance.now() - rec.pausedAt : 0)) : 0,
    playing: play.active, playingId: play.macroId, playingName: play.macroName, loop: play.loop, repeat: play.repeat,
    progress: play.active && play.duration ? Math.min(1, (performance.now() - play.startedAt) / play.duration) : 0,
  };
}

function emit() { bus.emit('macros:update', status()); }
setInterval(() => { if (rec.active || play.active) emit(); }, 500).unref?.();

function stopAll() { stopPlayback(); if (rec.active) stopRecording(true); }

module.exports = {
  list, get, rename, remove, importText, exportText, validateMacro, saveMacro,
  startRecording, pauseRecording, stopRecording, startPlayback, stopPlayback, stopAll, status,
};
