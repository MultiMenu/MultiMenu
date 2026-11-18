'use strict';
// Insights: plain-English tips worked out from your own history on this PC.
// Nothing leaves your PC. Each tip can be dismissed for two weeks.
const settings = require('./settings');

const DAY = 86400000;
const hour = (h) => `${String(h).padStart(2, '0')}:00`;

/** Pure (unit-tested): builds the tips from plain data. */
function compute({ accounts = [], week = {}, events = [], overview = null, ramHistory = [], running = 0, cfg = {}, profiles = 0, now = Date.now() }) {
  const out = [];
  const name = (a) => a.alias || a.displayName || a.username;
  // 1. an alt that keeps crashing
  const crashy = accounts.map(a => ({ a, w: week[a.id] || {} })).filter(x => (x.w.crashes || 0) >= 3).sort((x, y) => y.w.crashes - x.w.crashes)[0];
  if (crashy) out.push({ id: `crashy:${crashy.a.id}`, icon: 'triangle-alert', level: 'warn', title: `${name(crashy.a)} crashed ${crashy.w.crashes} times this week`, text: 'Lower graphics at launch often helps (edit the account), or check whether the game itself is crashing.', action: { label: 'Open accounts', page: 'accounts' } });
  // 2. disconnects that bunch up at one hour of the day
  const dis = events.filter(e => e.type === 'disconnect' && now - e.at < 14 * DAY);
  if (dis.length >= 5) {
    const by = {};
    for (const e of dis) { const h = new Date(e.at).getHours(); by[h] = (by[h] || 0) + 1; }
    const [h, n] = Object.entries(by).sort((x, y) => y[1] - x[1])[0];
    if (n / dis.length >= 0.4) out.push({ id: `dishour:${h}`, icon: 'clock', level: 'info', title: `Disconnects bunch up around ${hour(+h)}`, text: 'Roblox servers often restart at the same time each day. Quiet hours can skip rejoins then.', action: { label: 'Quiet hours', page: 'watcher' } });
  }
  // 3. logins that expired
  const expired = accounts.filter(a => a.status === 'expired');
  if (expired.length) out.push({ id: `expired:${expired.length}`, icon: 'key-round', level: 'warn', title: expired.length === 1 ? `${name(expired[0])}'s login has expired` : `${expired.length} logins have expired`, text: 'Log in again to use them.', action: { label: 'Open accounts', page: 'accounts' } });
  // 4. accounts nobody uses
  const idle = accounts.filter(a => a.status !== 'expired' && now - (a.lastUsedAt || a.createdAt || now) > 30 * DAY && now - (a.createdAt || now) > 30 * DAY);
  if (idle.length >= 2) out.push({ id: `idle:${idle.length}`, icon: 'moon', level: 'info', title: `${idle.length} accounts haven't been used in a month`, text: 'Remove the ones you don\'t need, or tag them so they\'re easy to find.', action: { label: 'Open accounts', page: 'accounts' } });
  // 5. memory nearly full while alts run
  const recent = ramHistory.slice(-60).filter(x => x != null);
  if (running >= 3 && recent.length >= 20 && recent.reduce((s, x) => s + x, 0) / recent.length > 85) out.push({ id: 'ram', icon: 'memory-stick', level: 'warn', title: 'Your PC\'s memory is nearly full', text: 'Eco mode, the RAM Trimmer or auto-scale with a RAM budget keep it from running out.', action: { label: 'Rotation & Scaling', page: 'scaling' } });
  // 6. memory restarts
  const leaky = accounts.map(a => ({ a, n: (week[a.id] || {}).memRestarts || 0 })).filter(x => x.n >= 3).sort((x, y) => y.n - x.n)[0];
  if (leaky) out.push({ id: `leak:${leaky.a.id}`, icon: 'flame', level: 'info', title: `The memory guard restarted ${name(leaky.a)} ${leaky.n} times`, text: 'The game may be leaking memory. A game profile with lower graphics can help.', action: { label: 'Servers & Games', page: 'servers' } });
  // 7. watcher off while alts keep crashing
  const crashes = Object.values(week).reduce((s, w) => s + (w.crashes || 0) + (w.disconnects || 0), 0);
  if (!cfg.watcher && crashes >= 3) out.push({ id: 'watcher', icon: 'radar', level: 'info', title: `${crashes} crashes and disconnects this week`, text: 'The 24/7 Watcher would have rejoined them for you.', action: { label: '24/7 Watcher', page: 'watcher' } });
  // 8. a favourite game without a profile
  const top = overview?.topGames?.[0];
  if (top && top.hours >= 5 && !profiles) out.push({ id: `profile:${top.name}`, icon: 'sliders-horizontal', level: 'info', title: `You play ${top.name} the most`, text: 'Give it a game profile so graphics, layout and watcher limits are set for it automatically.', action: { label: 'Servers & Games', page: 'servers' } });
  // 9. no backups
  if (!cfg.backups && accounts.length >= 5) out.push({ id: 'backup', icon: 'archive', level: 'info', title: `${accounts.length} accounts and no automatic backup`, text: 'A daily encrypted backup to OneDrive or Google Drive means you never lose them.', action: { label: 'Settings', page: 'settings' } });
  // 10. good news
  if (overview?.streak?.current >= 7) out.push({ id: `streak:${overview.streak.current}`, icon: 'flame', level: 'good', title: `${overview.streak.current}-day streak`, text: 'Your alts have been on every day. Keep it going!' });
  if (overview?.mostStable && overview.mostStable.uptimeMs >= 24 * 3600000) out.push({ id: `stable:${overview.mostStable.id}`, icon: 'shield-check', level: 'good', title: `${overview.mostStable.label} is your most stable alt`, text: `${Math.round(overview.mostStable.uptimeMs / 3600000)} hours with the fewest problems.` });
  return out;
}

function list({ includeDismissed = false } = {}) {
  const accounts = require('./accounts').raw().accounts;
  const stats = require('./stats');
  let ramHistory = [];
  try { ramHistory = (require('./system').history() || []).map(h => h.ram); } catch { /* not started */ }
  let profiles = 0;
  try { profiles = require('./gameprofiles').list().length; } catch { /* none */ }
  const running = require('./sessions').listSessions().filter(s => s.status === 'running').length;
  const all = compute({
    accounts, week: stats.summary(7).accounts, events: stats.events(300), overview: stats.overview(), ramHistory, running, profiles,
    cfg: { watcher: settings.get('watcher.enabled'), backups: settings.get('autoBackup.enabled') },
  });
  const dismissed = settings.get('insights.dismissed') || {};
  return includeDismissed ? all : all.filter(i => !(dismissed[i.id] && Date.now() - dismissed[i.id] < 14 * DAY));
}

function dismiss(id) {
  const d = { ...(settings.get('insights.dismissed') || {}) };
  d[String(id).slice(0, 120)] = Date.now();
  // forget old dismissals
  for (const [k, t] of Object.entries(d)) if (Date.now() - t > 30 * DAY) delete d[k];
  settings.set('insights.dismissed', d);
  return list();
}

module.exports = { compute, list, dismiss };
