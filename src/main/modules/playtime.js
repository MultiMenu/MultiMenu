'use strict';
// Playtime reminders: a gentle "you've been on for 3 hours" for each account,
// repeated every interval, and optionally closing the session at the limit.
// Sessions with the 24/7 Watcher on are treated as unattended and skipped.
const settings = require('./settings');
const sessions = require('./sessions');
const bus = require('../bus');

const reminded = new Map(); // sessionId -> number of reminders sent
let timer = null;

/** How many reminders a session should have had by now. Pure (exported for tests). */
function due(startedAt, now, remindMin) {
  if (!(remindMin > 0)) return 0;
  return Math.floor((now - startedAt) / (remindMin * 60_000));
}

function tick() {
  const cfg = settings.get('playtime');
  if (!cfg.enabled) return;
  const now = Date.now();
  for (const s of sessions.listSessions()) {
    if (s.status !== 'running' || s.external || s.watch) continue;
    const n = due(s.startedAt, now, cfg.remindMin);
    if (n > (reminded.get(s.id) || 0)) {
      reminded.set(s.id, n);
      const hours = ((now - s.startedAt) / 3600000).toFixed(1);
      if (cfg.closeAtLimit) {
        bus.emit('notify', { level: 'info', title: 'Playtime limit reached', message: `${s.label} has been on for ${hours} hours, so it's being closed.`, toast: true });
        sessions.close(s.id);
      } else {
        bus.emit('notify', { level: 'info', title: 'Time for a break?', message: `${s.label} has been on for ${hours} hours.`, toast: true });
      }
    }
  }
  for (const id of reminded.keys()) if (!sessions.getRaw(id)) reminded.delete(id);
}

function start() { clearInterval(timer); timer = setInterval(tick, 60_000); }

module.exports = { start, tick, due };
