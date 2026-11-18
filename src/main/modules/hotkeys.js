'use strict';
// Global hotkeys (work even when MultiMenu isn't focused).
const { globalShortcut } = require('electron');
const settings = require('./settings');
const clicker = require('./clicker');
const macros = require('./macros');
const bus = require('../bus');
const log = require('../logger').scope('hotkeys');

const VALID = /^((Ctrl|Alt|Shift)\+){0,3}(F([1-9]|1[0-9]|2[0-4])|[A-Z0-9]|Insert|Home|End|PageUp|PageDown|Delete)$/;
let lastRecordedMacro = null;

function emergencyStop() {
  clicker.stop();
  macros.stopAll();
  bus.emit('notify', { level: 'warn', title: 'Emergency stop', message: 'All automation was stopped.' });
}

function actions() {
  return {
    clickerToggle: () => { try { clicker.toggle(); } catch (e) { bus.emit('notify', { level: 'error', title: 'Auto clicker', message: e.message }); } },
    macroRecord: () => {
      try {
        const st = macros.status();
        if (st.recording) { const r = macros.stopRecording(true); lastRecordedMacro = r.saved?.id || lastRecordedMacro; }
        else macros.startRecording();
      } catch (e) { bus.emit('notify', { level: 'error', title: 'Macro recorder', message: e.message }); }
    },
    macroPlay: () => {
      try {
        const st = macros.status();
        if (st.playing) { macros.stopPlayback(); return; }
        const id = lastRecordedMacro || macros.list()[0]?.id;
        if (id) macros.startPlayback(id);
        else bus.emit('notify', { level: 'warn', title: 'Macro player', message: 'No macros saved yet.' });
      } catch (e) { bus.emit('notify', { level: 'error', title: 'Macro player', message: e.message }); }
    },
    emergencyStop,
    miniPanel: () => { try { require('../main-windows').toggleMini(); } catch (e) { bus.emit('notify', { level: 'warn', title: 'Mini panel', message: e.message }); } },
    closeAllRoblox: () => {
      try {
        const n = require('./sessions').panic();
        bus.emit('notify', { level: 'warn', title: 'Closed all Roblox', message: `Ended ${n} client${n === 1 ? '' : 's'}. Pending launches and rejoins were stopped too.` });
        return n;
      } catch (e) { bus.emit('notify', { level: 'error', title: 'Close all Roblox', message: e.message }); }
    },
    tileWindows: () => {
      require('./tiler').tile()
        .then(r => bus.emit('notify', { level: 'success', title: 'Windows tiled', message: `${r.placed} Roblox window${r.placed === 1 ? '' : 's'} arranged.` }))
        .catch(e => bus.emit('notify', { level: 'warn', title: 'Tile windows', message: e.message }));
    },
    focusMode: () => {
      Promise.resolve().then(() => require('./tiler').toggleFocus())
        .then(r => bus.emit('notify', { level: 'info', title: r.on ? 'Focus mode on' : 'Focus mode off', message: r.on ? `${r.label || 'One window'} is big; the rest are in the strip.` : 'Windows are back in your normal layout.' }))
        .catch(e => bus.emit('notify', { level: 'warn', title: 'Focus mode', message: e.message }));
    },
    focusNext: () => {
      Promise.resolve().then(() => require('./tiler').focusNext(1)).catch(e => bus.emit('notify', { level: 'warn', title: 'Focus mode', message: e.message }));
    },
    pinWindow: () => {
      try {
        const r = require('./tiler').pinFront();
        bus.emit('notify', { level: 'info', title: r.topmost ? 'Pinned on top' : 'Unpinned', message: r.label });
      } catch (e) { bus.emit('notify', { level: 'warn', title: 'Pin window', message: e.message }); }
    },
    pip: () => { require('./pip').toggle().catch(e => bus.emit('notify', { level: 'warn', title: 'Picture-in-picture', message: e.message })); },
    altWall: () => { try { require('../main-windows').toggleSwitcher(); } catch (e) { bus.emit('notify', { level: 'warn', title: 'Alt switcher', message: e.message }); } },
  };
}

// ---------- hotkeys per alt ----------
const MODIFIERS = ['Ctrl+Alt', 'Ctrl+Shift', 'Alt+Shift', 'Ctrl+Alt+Shift'];
/** Brings the alt with hotkey slot n to the front, or launches it when it isn't running. */
function focusSlot(n) {
  const accounts = require('./accounts');
  const a = accounts.raw().accounts.find(x => x.slot === n);
  if (!a) return { ok: false, message: `No account has hotkey slot ${n}.` };
  const name = a.alias || a.displayName || a.username;
  const sessions = require('./sessions');
  const mine = sessions.listSessions().filter(x => x.accountId === a.id);
  const run = mine.find(x => x.status === 'running');
  if (run) { try { require('./tiler').focus(run.id); return { ok: true, message: name, focused: run.id }; } catch (e) { return { ok: false, message: e.message }; } }
  if (mine.some(x => x.status === 'launching')) return { ok: true, message: `${name} is still starting` };
  if (settings.get('altKeys.launchIfClosed') && a.status !== 'expired') { sessions.launch(a.id, null); return { ok: true, message: `Launching ${name}`, launched: a.id }; }
  return { ok: false, message: `${name} isn't running.` };
}
function altAccels() {
  const c = settings.get('altKeys') || {};
  if (!c.enabled) return [];
  const mod = MODIFIERS.includes(c.modifier) ? c.modifier : 'Ctrl+Alt';
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [n, `${mod}+${n}`]);
}

function register() {
  globalShortcut.unregisterAll();
  const h = settings.get('hotkeys');
  const acts = actions();
  const result = {};
  for (const [name, accel] of Object.entries(h)) {
    if (!accel || !acts[name]) continue;
    if (!VALID.test(accel)) { result[name] = 'invalid'; continue; }
    try { result[name] = globalShortcut.register(accel, acts[name]) ? 'ok' : 'in-use'; }
    catch { result[name] = 'invalid'; }
    if (result[name] !== 'ok') log.warn(`Hotkey ${name}=${accel}: ${result[name]}`);
  }
  const taken = new Set(Object.values(h).filter(Boolean));
  for (const [n, accel] of altAccels()) {
    if (taken.has(accel)) { result[`slot${n}`] = 'in-use'; continue; }
    try { result[`slot${n}`] = globalShortcut.register(accel, () => { const r = focusSlot(n); if (!r.ok) bus.emit('notify', { level: 'warn', title: `Hotkey slot ${n}`, message: r.message }); }) ? 'ok' : 'in-use'; }
    catch { result[`slot${n}`] = 'invalid'; }
  }
  lastResult = result;
  return result;
}
let lastResult = {};

function setLastMacro(id) { lastRecordedMacro = id; }

module.exports = { register, emergencyStop, setLastMacro, focusSlot, altAccels, MODIFIERS, lastResult: () => lastResult, VALID, unregisterAll: () => globalShortcut.unregisterAll() };
