'use strict';
// Auto clicker using SendInput. Uses a drift-corrected timer so long runs keep
// their configured rate. Stops on its toggle hotkey or the emergency-stop key.
const win32 = require('../native/win32');
const settings = require('./settings');
const bus = require('../bus');

const state = { running: false, clicks: 0, startedAt: null, timer: null, target: 0, error: null };

function validate(cfg) {
  if (!['left', 'right', 'middle'].includes(cfg.button)) throw new Error('Pick left, right or middle click.');
  const iv = Number(cfg.intervalMs);
  if (!(iv >= 10 && iv <= 3_600_000)) throw new Error('Interval must be between 10 ms and 1 hour.');
  if (cfg.mode === 'count' && !(Number(cfg.count) >= 1 && Number(cfg.count) <= 1_000_000)) throw new Error('Click count must be 1 to 1,000,000.');
}

function start() {
  if (!win32.available) throw new Error('The auto clicker needs Windows.');
  if (state.running) return status();
  const cfg = settings.get('clicker');
  validate(cfg);
  Object.assign(state, { running: true, clicks: 0, startedAt: Date.now(), error: null, target: cfg.mode === 'count' ? Number(cfg.count) : 0 });
  let next = performance.now();
  const tick = () => {
    if (!state.running) return;
    try {
      if (cfg.positionMode === 'fixed') win32.setCursor(cfg.x, cfg.y);
      win32.click(cfg.button);
      if (cfg.doubleClick) win32.click(cfg.button);
      state.clicks++;
    } catch (e) { state.error = e.message; stop(); return; }
    if (state.target && state.clicks >= state.target) { stop(); return; }
    next += Number(cfg.intervalMs);
    const wait = Math.max(0, next - performance.now());
    if (wait === 0) next = performance.now(); // fell behind: don't burst
    state.timer = setTimeout(tick, wait);
  };
  tick();
  emit();
  return status();
}

function stop() {
  clearTimeout(state.timer);
  state.running = false;
  emit();
  return status();
}

function toggle() { return state.running ? stop() : start(); }

function status() { const { timer: _timer, ...s } = state; return { ...s, available: win32.available, config: settings.get('clicker') }; }

function emit() { bus.emit('clicker:update', status()); }
// Live click counter while running (throttled).
setInterval(() => { if (state.running) emit(); }, 500).unref?.();

function capturePosition() {
  if (!win32.available) throw new Error('Needs Windows.');
  return new Promise(resolve => setTimeout(() => resolve(win32.getCursor()), 3000));
}

module.exports = { start, stop, toggle, status, capturePosition, validate };
