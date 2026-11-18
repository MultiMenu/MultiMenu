'use strict';
// Sleep timer: after N minutes, close every Roblox session, and optionally put
// the PC to sleep or shut it down. Shutdown goes through Windows' own 60-second
// countdown, so it can still be cancelled ("shutdown /a").
const { exec } = require('child_process');
const settings = require('./settings');
const sessions = require('./sessions');
const bus = require('../bus');
const log = require('../logger').scope('sleeptimer');

const ACTIONS = { close: 'Close all Roblox', sleep: 'Close all, then sleep the PC', shutdown: 'Close all, then shut down the PC' };
const st = { endsAt: null, action: null, timer: null };

function emit() { bus.emit('sleeptimer:update', status()); }

function start(minutes, action) {
  const m = Number(minutes);
  if (!(m >= 1 && m <= 24 * 60)) throw new Error('Choose between 1 minute and 24 hours.');
  if (!ACTIONS[action]) throw new Error('Unknown action');
  cancel(true);
  st.endsAt = Date.now() + m * 60_000; st.action = action;
  st.timer = setTimeout(fire, m * 60_000);
  settings.set('sleepTimer.lastMinutes', m); settings.set('sleepTimer.lastAction', action);
  log.info(`Sleep timer: ${ACTIONS[action]} in ${m} min`);
  emit();
  return status();
}

async function fire() {
  const action = st.action;
  st.endsAt = null; st.action = null; st.timer = null;
  emit();
  for (const s of sessions.listSessions()) if (['running', 'launching'].includes(s.status) && !s.external) sessions.setWatch(s.id, false);
  await sessions.closeAll();
  bus.emit('notify', { level: 'info', title: 'Sleep timer', message: ACTIONS[action], toast: true });
  if (process.platform !== 'win32') return;
  if (action === 'shutdown') setTimeout(() => exec('shutdown /s /t 60 /c "MultiMenu sleep timer: shutting down in 60 seconds. Run shutdown /a to cancel."', { windowsHide: true }), 8000);
  if (action === 'sleep') setTimeout(() => exec('rundll32.exe powrprof.dll,SetSuspendState 0,1,0', { windowsHide: true }), 8000);
}

function cancel(silent) {
  clearTimeout(st.timer);
  const was = !!st.endsAt;
  st.endsAt = null; st.action = null; st.timer = null;
  if (!silent) emit();
  return { cancelled: was };
}

function status() { return { endsAt: st.endsAt, action: st.action, actionText: st.action ? ACTIONS[st.action] : null, actions: ACTIONS, last: settings.get('sleepTimer') }; }

module.exports = { start, cancel, status, ACTIONS };
