'use strict';
// Per-account session history: uptime, launches, crashes, disconnects, freezes
// and rejoins per day (kept for 30 days), plus a rolling watcher event log.
const { JsonStore } = require('../store');
const paths = require('../paths');

let store;
const FIELDS = ['uptimeMs', 'launches', 'crashes', 'disconnects', 'freezes', 'rejoins', 'memRestarts'];

function init() { store = new JsonStore(paths.file('stats.json'), { days: {}, labels: {}, events: [], games: {} }); prune(); }

const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function bucket(accountId, label) {
  const days = store.get('days');
  const k = dayKey();
  days[k] = days[k] || {};
  days[k][accountId] = days[k][accountId] || Object.fromEntries(FIELDS.map(f => [f, 0]));
  if (label) store.get('labels')[accountId] = label;
  return days[k][accountId];
}

function add(accountId, field, amount = 1, label) {
  if (!store || !accountId || !FIELDS.includes(field)) return;
  bucket(accountId, label)[field] += amount;
  store.saveSoon();
}

function event(e) {
  if (!store) return;
  const ev = store.get('events');
  ev.unshift({ at: Date.now(), ...e });
  if (ev.length > 300) ev.length = 300;
  store.saveSoon();
}

function prune() {
  const days = store.get('days');
  const cutoff = dayKey(Date.now() - 400 * 86400000);
  for (const k of Object.keys(days)) if (k < cutoff) delete days[k];
  const games = store.get('games') || {};
  for (const k of Object.keys(games)) if (k < cutoff) delete games[k];
}

/** Summary for the last N days: per-day totals and per-account totals. */
function summary(n = 7) {
  const days = store.get('days'), labels = store.get('labels');
  const out = { days: [], accounts: {} };
  for (let i = n - 1; i >= 0; i--) {
    const k = dayKey(Date.now() - i * 86400000);
    const totals = Object.fromEntries(FIELDS.map(f => [f, 0]));
    for (const [acc, v] of Object.entries(days[k] || {})) {
      FIELDS.forEach(f => { totals[f] += v[f] || 0; });
      const a = (out.accounts[acc] = out.accounts[acc] || { label: labels[acc] || acc, ...Object.fromEntries(FIELDS.map(f => [f, 0])) });
      FIELDS.forEach(f => { a[f] += v[f] || 0; });
    }
    out.days.push({ day: k, ...totals });
  }
  return out;
}

function addGame(name, ms) {
  if (!store || !name || !(ms > 0)) return;
  const games = store.get('games') || (store.data.games = {});
  const k = dayKey();
  games[k] = games[k] || {};
  const n = String(name).slice(0, 80);
  games[k][n] = (games[k][n] || 0) + ms;
  store.saveSoon();
}

const shift = (key, d) => { const [y, m, dd] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, dd + d, 12).getTime()); };

/** Everything the Stats page shows. Pure: exported for tests. */
function compute({ days, games = {}, labels = {} }, today = dayKey()) {
  const zero = () => Object.fromEntries(FIELDS.map(f => [f, 0]));
  const totals = zero(), perAcc = {}, perDay = {};
  for (const [k, accs] of Object.entries(days)) {
    perDay[k] = zero();
    for (const [acc, v] of Object.entries(accs)) {
      perAcc[acc] = perAcc[acc] || { label: labels[acc] || acc, ...zero(), activeDays: 0 };
      FIELDS.forEach(f => { totals[f] += v[f] || 0; perAcc[acc][f] += v[f] || 0; perDay[k][f] += v[f] || 0; });
      if ((v.uptimeMs || 0) > 0) perAcc[acc].activeDays++;
    }
  }
  const active = (k) => (perDay[k]?.uptimeMs || 0) > 0;
  // streaks
  let current = 0;
  for (let k = active(today) ? today : shift(today, -1); active(k); k = shift(k, -1)) current++;
  let longest = 0, run = 0;
  const keys = Object.keys(perDay).sort();
  if (keys.length) for (let k = keys[0]; k <= today; k = shift(k, 1)) { run = active(k) ? run + 1 : 0; longest = Math.max(longest, run); }
  // heatmap: 26 full weeks ending today
  const heat = [];
  for (let i = 181; i >= 0; i--) { const k = shift(today, -i); heat.push({ day: k, hours: +(((perDay[k]?.uptimeMs) || 0) / 3600000).toFixed(2) }); }
  // accounts ranked; stability = problems per 24h of uptime
  const accounts = Object.entries(perAcc).map(([id, a]) => {
    const problems = a.crashes + a.disconnects + a.freezes;
    return { id, ...a, problems, perDay: a.uptimeMs ? problems / (a.uptimeMs / 86400000) : 0 };
  }).sort((x, y) => y.uptimeMs - x.uptimeMs);
  const stable = accounts.filter(a => a.uptimeMs >= 3 * 3600000).sort((x, y) => x.perDay - y.perDay || y.uptimeMs - x.uptimeMs)[0] || null;
  // games
  const gameTotals = {};
  for (const g of Object.values(games)) for (const [n, ms] of Object.entries(g)) gameTotals[n] = (gameTotals[n] || 0) + ms;
  const topGames = Object.entries(gameTotals).map(([name, ms]) => ({ name, hours: +(ms / 3600000).toFixed(1) })).sort((a, b) => b.hours - a.hours).slice(0, 8);
  // wrapped for a month 'YYYY-MM'
  const wrapped = (month) => {
    const mk = Object.keys(days).filter(k => k.startsWith(month));
    const w = zero(); const accH = {}; const gameH = {}; let best = null;
    for (const k of mk) {
      for (const [acc, v] of Object.entries(days[k])) { FIELDS.forEach(f => { w[f] += v[f] || 0; }); accH[acc] = (accH[acc] || 0) + (v.uptimeMs || 0); }
      if (!best || perDay[k].uptimeMs > best.ms) best = { day: k, ms: perDay[k].uptimeMs };
      for (const [n, ms] of Object.entries(games[k] || {})) gameH[n] = (gameH[n] || 0) + ms;
    }
    const accs = Object.entries(accH).filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1]);
    const gms = Object.entries(gameH).sort((a, b) => b[1] - a[1]);
    const topAcc = accs[0], topGame = gms[0];
    const out = {
      month, hours: +(w.uptimeMs / 3600000).toFixed(1), launches: w.launches, rejoins: w.rejoins, problems: w.crashes + w.disconnects + w.freezes,
      memRestarts: w.memRestarts, activeDays: mk.filter(active).length, accountsUsed: accs.length,
      topAccount: topAcc ? { label: labels[topAcc[0]] || topAcc[0], hours: +(topAcc[1] / 3600000).toFixed(1) } : null,
      topGame: topGame ? { name: topGame[0], hours: +(topGame[1] / 3600000).toFixed(1) } : null,
      topAccounts: accs.slice(0, 3).map(([id, ms]) => ({ label: labels[id] || id, hours: +(ms / 3600000).toFixed(1) })),
      topGames: gms.slice(0, 3).map(([n, ms]) => ({ name: n, hours: +(ms / 3600000).toFixed(1) })),
      bestDay: best && best.ms > 0 ? { day: best.day, hours: +(best.ms / 3600000).toFixed(1) } : null,
    };
    out.personality = personality(out);
    return out;
  };
  return {
    year: wrapped(today.slice(0, 4)),
    totals: { ...totals, hours: +(totals.uptimeMs / 3600000).toFixed(1), problems: totals.crashes + totals.disconnects + totals.freezes, activeDays: keys.filter(active).length, since: keys[0] || null },
    streak: { current, longest }, heat, accounts, mostStable: stable, topGames,
    wrapped: wrapped(today.slice(0, 7)), lastMonth: wrapped(shift(`${today.slice(0, 7)}-01`, -1).slice(0, 7)),
  };
}

/** Wrapped "personality" from a period's numbers (pure). */
function personality(w) {
  const perDay = w.hours ? w.problems / (w.hours / 24) : 0;
  if (w.accountsUsed >= 8) return { icon: 'layers', title: 'Farm Tycoon', text: 'You run alts like a business.' };
  if (w.rejoins >= 50) return { icon: 'repeat', title: 'Comeback Kid', text: 'Knocked out, rejoined, every single time.' };
  if (w.hours >= 300) return { icon: 'timer', title: 'Marathon Runner', text: 'Your alts barely sleep.' };
  if (w.activeDays >= 25) return { icon: 'calendar-clock', title: 'Every-Day Player', text: 'Hardly a day off all month.' };
  if (w.hours >= 50 && perDay < 0.5) return { icon: 'shield-check', title: 'Smooth Operator', text: 'Hours of play and hardly a hiccup.' };
  return { icon: 'sparkles', title: 'Rising Star', text: 'Just getting started.' };
}

function overview() { return compute({ days: store.get('days'), games: store.get('games') || {}, labels: store.get('labels') }); }

function events(limit = 100) { return store.get('events').slice(0, limit); }
function clear() { store.replace({ days: {}, labels: {}, events: [], games: {} }); store.saveNow(); }

module.exports = { init, add, addGame, event, summary, overview, compute, personality, events, clear, dayKey, FIELDS };
