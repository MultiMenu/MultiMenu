'use strict';
// Health score: 0–100 for each account, from its login, ban and moderation checks,
// and how often it crashed, disconnected or froze over the last 7 days.
const DAY = 86400000;

/** Pure (unit-tested). a: stored account; w: its 7-day totals from stats. */
function compute(a, w = {}, now = Date.now()) {
  const reasons = [];
  const hit = (points, text) => { if (points > 0) reasons.push({ points, text }); return points; };
  let score = 100;
  if (a.status === 'expired') score -= hit(70, 'Login expired');
  else if (a.status === 'error') score -= hit(20, 'The last login check failed');
  const h = a.health?.state;
  if (h === 'banned') score -= hit(80, 'Banned');
  else if (h === 'moderated') score -= hit(40, 'Moderation notice');
  const days = Math.max(1, (w.uptimeMs || 0) / DAY);
  const crashes = w.crashes || 0, dropped = (w.disconnects || 0) + (w.freezes || 0);
  if (crashes) score -= hit(Math.min(30, Math.round((crashes / days) * 10)), `${crashes} crash${crashes === 1 ? '' : 'es'} this week`);
  if (dropped) score -= hit(Math.min(20, Math.round((dropped / days) * 5)), `${dropped} disconnect${dropped === 1 ? '' : 's'} or freeze${dropped === 1 ? '' : 's'} this week`);
  if (w.memRestarts) score -= hit(Math.min(10, w.memRestarts * 3), `Restarted ${w.memRestarts} time${w.memRestarts === 1 ? '' : 's'} for memory`);
  const checked = a.health?.checkedAt || a.checkedAt;
  if (a.status !== 'expired' && (!checked || now - checked > 7 * DAY)) score -= hit(5, 'Login not checked for a week');
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, grade: score >= 85 ? 'great' : score >= 60 ? 'ok' : score >= 30 ? 'poor' : 'bad', reasons };
}

let cache = { at: 0, week: null };
function week() {
  if (cache.week && Date.now() - cache.at < 60_000) return cache.week;
  try { cache = { at: Date.now(), week: require('./stats').summary(7).accounts }; } catch { cache = { at: Date.now(), week: {} }; }
  return cache.week;
}
function forAccount(id) {
  const a = require('./accounts').find(id);
  return a ? compute(a, week()[id]) : null;
}
function all() {
  const w = week();
  return Object.fromEntries(require('./accounts').raw().accounts.map(a => [a.id, compute(a, w[a.id])]));
}

module.exports = { compute, forAccount, all };
