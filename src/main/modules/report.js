'use strict';
// Daily Discord report: once a day at your chosen time, a summary embed with each
// account's uptime, problems, rejoins and Robux (with the change since the last report).
const { JsonStore } = require('../store');
const paths = require('../paths');
const settings = require('./settings');
const stats = require('./stats');
const accounts = require('./accounts');
const bus = require('../bus');
const log = require('../logger').scope('report');

let store, timer = null;
function init() {
  store = new JsonStore(paths.file('report.json'), { lastSentDay: null, robux: {} });
  clearInterval(timer);
  timer = setInterval(() => { try { tick(); } catch (e) { log.error('tick', e); } }, 30_000);
}

const fmtH = (ms) => `${(ms / 3600000).toFixed(1)}h`;

/** Builds the report from a stats summary + accounts. Pure (exported for tests). */
function build(summary, accs, prevRobux = {}) {
  const today = summary.days.at(-1) || { uptimeMs: 0, crashes: 0, disconnects: 0, freezes: 0, rejoins: 0, launches: 0 };
  const rows = Object.entries(summary.accounts).sort((a, b) => b[1].uptimeMs - a[1].uptimeMs);
  const lines = rows.map(([id, a]) => {
    const acc = accs.find(x => x.id === id);
    const issues = a.crashes + a.disconnects + a.freezes;
    let robux = '';
    if (acc?.robux != null) {
      const d = prevRobux[id] != null ? acc.robux - prevRobux[id] : null;
      robux = ` · R$ ${acc.robux.toLocaleString('en-GB')}${d ? ` (${d > 0 ? '+' : ''}${d.toLocaleString('en-GB')})` : ''}`;
    }
    return `${issues === 0 ? '🟢' : issues < 4 ? '🟡' : '🔴'} **${a.label}** — ${fmtH(a.uptimeMs)} up · ${issues} issue${issues === 1 ? '' : 's'} · ${a.rejoins} rejoin${a.rejoins === 1 ? '' : 's'}${robux}`;
  });
  const problems = today.crashes + today.disconnects + today.freezes;
  return {
    description: lines.join('\n') || 'No account activity recorded today.',
    fields: [
      { name: 'Total uptime', value: fmtH(today.uptimeMs), inline: true },
      { name: 'Problems', value: `${problems} (${today.crashes} crash · ${today.disconnects} disconnect · ${today.freezes} freeze)`, inline: true },
      { name: 'Rejoins', value: String(today.rejoins), inline: true },
    ],
    summary: `${fmtH(today.uptimeMs)} uptime · ${problems} problems · ${today.rejoins} rejoins`,
  };
}

async function sendNow() {
  try { await accounts.detailsAll(); } catch { /* Robux is optional */ }
  const accs = accounts.getAll().accounts;
  const r = build(stats.summary(1), accs, store.get('robux'));
  const res = await require('./webhooks').send({ type: 'dailyReport', description: r.description, fields: r.fields }, { version: require('electron').app.getVersion(), force: true });
  store.set('robux', Object.fromEntries(accs.filter(a => a.robux != null).map(a => [a.id, a.robux])));
  store.set('lastSentDay', stats.dayKey());
  store.saveNow();
  bus.emit('event', { type: 'dailyReport', summary: r.summary, quiet: true });
  if (!res.sent) throw new Error(res.reason === 'no-webhooks' ? 'Add a Discord webhook first.' : `Not sent (${res.reason}).`);
  if (res.results.some(x => !x.ok)) throw new Error(res.results.find(x => !x.ok).error);
  return { sent: true, summary: r.summary };
}

function tick() {
  const cfg = settings.get('report');
  if (!cfg.enabled) return;
  const now = new Date();
  const [h, m] = String(cfg.time || '21:00').split(':').map(Number);
  if (store.get('lastSentDay') === stats.dayKey()) return;
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  sendNow().catch(e => log.warn('daily report failed', e.message));
}

function status() { return { lastSentDay: store.get('lastSentDay'), config: settings.get('report') }; }

module.exports = { init, build, sendNow, status };
