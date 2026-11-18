'use strict';
// One command table for the command line, the local API, the Stream Deck plugin
// and automations. Every command takes named arguments and returns
// { ok, message, data }. Replies never contain logins, cookies, passwords or keys.
const bus = require('../bus');
const log = require('../logger').scope('commands');

const live = (s) => ['running', 'launching'].includes(s.status);
const fmtDur = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
const onOff = (v) => {
  const s = String(v ?? '').toLowerCase();
  if (['on', 'true', '1', 'yes', 'start'].includes(s)) return true;
  if (['off', 'false', '0', 'no', 'stop'].includes(s)) return false;
  if (s === 'toggle' || s === '') return null;
  throw Object.assign(new Error('Use on, off or toggle.'), { status: 400 });
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function sessionsOf(spec) {
  const sessions = require('./sessions');
  const list = sessions.listSessions().filter(live);
  const q = String(spec || '').trim();
  if (/^all$/i.test(q)) return list;
  const ids = new Set(require('./accounts').resolve(q).map(a => a.id));
  let out = list.filter(s => ids.has(s.accountId));
  if (!out.length && q && !/^(tag|group|tier|id):/i.test(q)) {
    const l = q.toLowerCase();
    out = list.filter(s => s.label.toLowerCase() === l || (s.username || '').toLowerCase() === l);
    if (!out.length) out = list.filter(s => s.label.toLowerCase().includes(l)).slice(0, 1);
  }
  return out;
}
function presetOf(name) {
  const q = String(name || '').toLowerCase().trim();
  if (!q) throw fail('Name a preset.');
  const list = require('./presets').list();
  const p = list.find(x => x.name.toLowerCase() === q) || list.find(x => x.name.toLowerCase().includes(q));
  if (!p) throw fail(`No preset matches “${name}”.`, 404);
  return p;
}
function toggled(current, want) { return want === null ? !current : want; }

const COMMANDS = {
  help: {
    params: [], desc: 'List the commands',
    run: () => ({ message: Object.entries(COMMANDS).map(([k, c]) => `  ${(`${k} ${c.usage || ''}`).padEnd(38)} ${c.desc}`).join('\n'), data: { commands: Object.keys(COMMANDS) } }),
  },
  status: {
    params: [], desc: 'Running accounts and how the PC is doing',
    run: () => {
      const sessions = require('./sessions').listSessions().filter(live);
      const sys = require('./system').latest();
      const w = require('./watcher').status();
      const rows = sessions.map(s => ({
        id: s.id, label: s.label, username: s.username || null, status: s.status, state: s.watchState || s.status, game: s.placeName || s.placeId || null,
        startedAt: s.startedAt, uptimeMs: s.status === 'running' ? Date.now() - s.startedAt : 0, memMB: s.memMB || 0, ping: s.ping ?? null, watched: !!s.watch, external: !!s.external,
      }));
      const lines = rows.map(r => `  ${r.status === 'running' ? (r.state === 'not responding' ? '!' : '●') : '…'} ${r.label.padEnd(22).slice(0, 22)} ${String(r.game || '—').padEnd(26).slice(0, 26)} ${r.status === 'running' ? fmtDur(r.uptimeMs) : r.status}`);
      const pc = sys ? { cpu: Math.round(sys.cpu), ram: Math.round(sys.ramPercent), robloxMB: sys.roblox?.memMB || 0 } : null;
      return {
        message: `${rows.length} running\n${lines.join('\n')}${lines.length ? '\n' : ''}PC: ${pc ? `CPU ${pc.cpu}% · RAM ${pc.ram}%` : '—'} · Watcher ${w.enabled ? 'on' : 'off'}`,
        data: { sessions: rows, pc, watcher: { enabled: !!w.enabled, queued: w.pending.length } },
      };
    },
  },
  accounts: {
    params: ['filter'], usage: '[tag:x|group:x|tier:x]', desc: 'List saved accounts (no logins)',
    run: ({ filter }) => {
      const acc = require('./accounts');
      const list = filter ? acc.resolve(filter) : acc.raw().accounts.slice().sort((x, y) => (acc.tierRank(x) - acc.tierRank(y)) || ((x.order ?? 0) - (y.order ?? 0)));
      const running = new Set(require('./sessions').listSessions().filter(live).map(s => s.accountId));
      const rows = list.map(a => ({ id: a.id, name: a.alias || a.displayName || a.username, username: a.username, tier: acc.publicView(a).tier, tags: a.tags || [], group: a.group, status: a.status || 'unknown', slot: a.slot || null, running: running.has(a.id) }));
      return { message: rows.map(r => `  ${r.running ? '●' : ' '} ${String(r.slot || ' ')} ${r.name.padEnd(22).slice(0, 22)} ${r.tier.padEnd(9)} ${r.status.padEnd(8)} ${r.tags.map(t => `#${t}`).join(' ')}`).join('\n') || 'No accounts.', data: { accounts: rows } };
    },
  },
  launch: {
    params: ['who', 'game'], usage: '<account|tag:x|group:x|all> [game]', desc: 'Launch accounts',
    run: ({ who, game }) => {
      const acc = require('./accounts');
      const list = acc.resolve(who).filter(a => a.status !== 'expired');
      if (!list.length) throw fail(`No account matches “${who || ''}”.`, 404);
      const sessions = require('./sessions');
      const runningIds = new Set(sessions.listSessions().filter(live).map(s => s.accountId));
      const todo = list.filter(a => !runningIds.has(a.id));
      for (const a of todo) sessions.launch(a.id, game ? String(game).slice(0, 400) : null);
      const skipped = list.length - todo.length;
      return { message: `Launching ${todo.length} account${todo.length === 1 ? '' : 's'}${skipped ? ` (${skipped} already running)` : ''}`, data: { launched: todo.map(a => a.id), skipped } };
    },
  },
  close: {
    params: ['who'], usage: '<account|tag:x|all>', desc: 'Close accounts (the watcher leaves them closed)',
    run: async ({ who }) => {
      const sessions = require('./sessions');
      const list = sessionsOf(who || 'all').filter(s => !s.external || /^all$/i.test(String(who || 'all')));
      if (!list.length) throw fail(`Nothing running matches “${who || 'all'}”.`, 404);
      for (const s of list) { sessions.setWatch(s.id, false); await sessions.close(s.id); }
      return { message: `Closing ${list.length} session${list.length === 1 ? '' : 's'}`, data: { closed: list.map(s => s.id) } };
    },
  },
  rejoin: {
    params: ['who'], usage: '<account|tag:x>', desc: 'Restart accounts into the same game',
    run: ({ who }) => {
      const sessions = require('./sessions');
      const list = sessionsOf(who).filter(s => s.accountId);
      if (!list.length) throw fail(`No running account matches “${who || ''}”.`, 404);
      for (const s of list) {
        const raw = sessions.getRaw(s.id);
        sessions.endForRestart(s.id, 'Rejoin requested');
        setTimeout(() => sessions.launch(s.accountId, null, { label: s.label, watch: raw?.watch, target: raw?.target || null }), 3000);
      }
      return { message: `Rejoining ${list.map(s => s.label).join(', ')}`, data: { rejoined: list.map(s => s.id) } };
    },
  },
  presets: {
    params: [], desc: 'List presets',
    run: () => {
      const pr = require('./presets');
      const rows = pr.list().map(p => ({ id: p.id, name: p.name, accounts: pr.idsOf(p).length, tag: p.tag || null }));
      return { message: rows.map(r => `  ${r.name}  (${r.accounts})`).join('\n') || 'No presets.', data: { presets: rows } };
    },
  },
  preset: {
    params: ['name', 'action'], usage: '<name> [start|stop]', desc: 'Start or close a preset',
    run: async ({ name, action }) => {
      const p = presetOf(name);
      const pr = require('./presets');
      if (/^(stop|close)$/i.test(action || '')) { const r = pr.closePreset(p.id); return { message: `Closed “${p.name}” (${r.closed})`, data: r }; }
      const r = await pr.run(p.id);
      return { message: `Started “${p.name}”: ${r.steps.join(' · ')}`, data: r };
    },
  },
  tile: { params: [], desc: 'Tile the Roblox windows', run: async () => { const r = await require('./tiler').tile(); return { message: `${r.placed} window${r.placed === 1 ? '' : 's'} tiled`, data: r }; } },
  focus: {
    params: ['who'], usage: '<account|slot 1-9>', desc: 'Bring an account’s window to the front',
    run: ({ who }) => {
      if (/^[1-9]$/.test(String(who))) { const r = require('./hotkeys').focusSlot(Number(who)); return { message: r.message, data: r }; }
      const s = sessionsOf(who).find(x => x.status === 'running');
      if (!s) throw fail(`No running account matches “${who || ''}”.`, 404);
      require('./tiler').focus(s.id);
      return { message: `${s.label} is in front`, data: { id: s.id } };
    },
  },
  watcher: {
    params: ['state'], usage: '<on|off|toggle>', desc: '24/7 Watcher',
    run: ({ state }) => { const w = require('./watcher'); const r = w.setEnabled(toggled(w.status().enabled, onOff(state))); return { message: `24/7 Watcher ${r.enabled ? 'on' : 'off'}`, data: { enabled: r.enabled } }; },
  },
  eco: {
    params: ['state'], usage: '<on|off|toggle>', desc: 'Eco mode for background alts',
    run: ({ state }) => { const r = require('./limiter').setEco(toggled(require('./settings').get('limiter.eco') && require('./limiter').status().running, onOff(state))); return { message: `Eco mode ${r.eco ? 'on' : 'off'}`, data: r }; },
  },
  limiter: {
    params: ['state'], usage: '<on|off|toggle>', desc: 'Background limiter',
    run: ({ state }) => { const l = require('./limiter'); const on = toggled(l.status().running, onOff(state)); const r = on ? l.start() : l.stop(); return { message: `Background limiter ${r.running ? 'on' : 'off'}`, data: { running: r.running } }; },
  },
  rotation: {
    params: ['state'], usage: '<on|off|toggle|next>', desc: 'Rotation mode',
    run: async ({ state }) => {
      const rot = require('./rotation');
      if (/^(next|now)$/i.test(state || '')) { const r = await rot.rotateNow(); return { message: r.message, data: r }; }
      const r = rot.setEnabled(toggled(rot.status().enabled, onOff(state)));
      return { message: `Rotation ${r.enabled ? 'on' : 'off'}`, data: r };
    },
  },
  scale: {
    params: ['state'], usage: '<on|off|toggle>', desc: 'Auto-scale',
    run: ({ state }) => { const a = require('./autoscale'); const r = a.setEnabled(toggled(a.status().enabled, onOff(state))); return { message: `Auto-scale ${r.enabled ? 'on' : 'off'}`, data: r }; },
  },
  overlay: {
    params: ['state'], usage: '<on|off|toggle>', desc: 'Name labels over Roblox windows',
    run: ({ state }) => { const o = require('./overlay'); const r = o.setEnabled(toggled(o.status().enabled, onOff(state))); return { message: `Overlay labels ${r.enabled ? 'on' : 'off'}`, data: r }; },
  },
  wall: { params: [], desc: 'Open the alt switcher', run: () => { require('../main-windows').openSwitcher(); return { message: 'Switcher open' }; } },
  trim: { params: [], desc: 'Trim RAM now', run: async () => { const r = await require('./ramtrimmer').trimNow('manual'); return { message: `Freed ${r.lastFreedMB} MB`, data: { freedMB: r.lastFreedMB } }; } },
  doctor: {
    params: [], desc: 'Check MultiMenu for problems',
    run: async () => {
      const r = await require('./doctor').run();
      const sym = { ok: '✓', warn: '!', fail: '✗', info: 'i' };
      return { message: `${r.checks.map(c => `  ${sym[c.status] || '·'} ${c.title}${c.status === 'ok' ? '' : ` — ${c.detail}`}`).join('\n')}\n${r.summary}`, data: r };
    },
  },
  thumb: {
    params: ['who'], usage: '<account>', desc: 'Small picture of an account’s window',
    run: async ({ who }) => {
      const s = sessionsOf(who).find(x => x.status === 'running');
      if (!s) throw fail(`No running account matches “${who || ''}”.`, 404);
      const shots = await require('./wall').thumbs([s.id], 144);
      return { message: shots[s.id] ? 'ok' : 'The window is minimised or hidden.', data: { image: shots[s.id] || null, label: s.label } };
    },
  },
};

/** Turns command-line words into named arguments: positional words fill `params` in order; --name value or --name=value set by name. */
function parseArgs(name, words) {
  const c = COMMANDS[name];
  const out = {};
  const pos = [];
  for (let i = 0; i < words.length; i++) {
    const w = String(words[i]);
    const m = /^--([a-z]+)(?:=(.*))?$/i.exec(w);
    if (m) { out[m[1]] = m[2] !== undefined ? m[2] : (words[i + 1] && !String(words[i + 1]).startsWith('--') ? words[++i] : true); continue; }
    pos.push(w);
  }
  (c?.params || []).forEach((p, i) => { if (pos[i] !== undefined && out[p] === undefined) out[p] = i === c.params.length - 1 ? pos.slice(i).join(' ') : pos[i]; });
  return out;
}

const recent = [];
/** Runs a command. args: named arguments (object) or command-line words (array). */
async function run(name, args = {}, { source = 'cli' } = {}) {
  const c = COMMANDS[String(name || '').toLowerCase()];
  if (!c) throw fail(`Unknown command “${name}”. Try: help`, 404);
  const named = Array.isArray(args) ? parseArgs(String(name).toLowerCase(), args) : Object.fromEntries(Object.entries(args || {}).filter(([k]) => /^[a-z]{1,20}$/i.test(k)).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 400) : v]));
  const r = await c.run(named);
  recent.unshift({ at: Date.now(), source, command: name });
  if (recent.length > 50) recent.length = 50;
  if (name !== 'status' && name !== 'help' && name !== 'thumb') log.info(`${source}: ${name}`);
  bus.emit('command:run', { name, source });
  return { ok: true, message: r.message || 'Done', data: r.data ?? null };
}

module.exports = { COMMANDS, run, parseArgs, onOff, sessionsOf, recent: () => recent.slice() };
