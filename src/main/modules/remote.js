'use strict';
// Discord remote control. Connects your own Discord bot to the Discord Gateway and
// registers a /mm slash command with subcommands:
//   /mm status · /mm start preset · /mm stop preset · /mm rejoin account
//   /mm close account|all · /mm screenshot account · /mm tile · /mm watcher on|off
// Only Discord user IDs on your allow-list can run commands; everyone else gets a
// private "not allowed" reply. The bot token is stored encrypted (DPAPI).
const { JsonStore } = require('../store');
const paths = require('../paths');
const secure = require('../secure');
const settings = require('./settings');
const bus = require('../bus');
const log = require('../logger').scope('remote');

const API = 'https://discord.com/api/v10';
const INTENTS = 1; // GUILDS only - slash commands arrive as interactions, no message content needed
let store;
const st = { status: 'off', message: 'Not connected', ws: null, hb: null, seq: null, sessionId: null, resumeUrl: null, appId: null, botName: null, retry: 0, acked: true, stopping: false, lastCommand: null };

function init() { store = new JsonStore(paths.file('remote.json'), { tokenEnc: null, live: null }); }
const token = () => (store.get('tokenEnc') ? secure.decrypt(store.get('tokenEnc')) : null);

function setToken(t) {
  const v = String(t || '').trim();
  if (v && !/^[\w-]{20,40}\.[\w-]{4,10}\.[\w-]{20,60}$/.test(v)) throw new Error('That doesn\'t look like a Discord bot token. Copy it from Developer Portal → your app → Bot → Reset Token.');
  store.set('tokenEnc', v ? secure.encrypt(v) : null);
  store.saveNow();
  return status();
}

async function api(method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method, headers: { Authorization: `Bot ${token()}`, 'Content-Type': 'application/json', 'User-Agent': 'MultiMenu (https://github.com, 1.3)' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) throw new Error('Discord rejected the bot token. Reset it in the Developer Portal and paste the new one.');
  if (!res.ok && res.status !== 204) throw new Error(`Discord API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

const COMMANDS = [{
  name: 'mm', description: 'Control MultiMenu', type: 1,
  options: [
    { type: 1, name: 'status', description: 'Running accounts, uptime and watcher state' },
    { type: 1, name: 'panel', description: 'Buttons and menus to control your alts' },
    { type: 1, name: 'live', description: 'A status message here that updates itself every minute', options: [{ type: 3, name: 'state', description: 'on or off', required: true, choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }] }] },
    { type: 1, name: 'start', description: 'Start a preset', options: [{ type: 3, name: 'preset', description: 'Preset name', required: true, autocomplete: true }] },
    { type: 1, name: 'stop', description: 'Close a preset\'s sessions', options: [{ type: 3, name: 'preset', description: 'Preset name', required: true, autocomplete: true }] },
    { type: 1, name: 'launch', description: 'Launch an account, a tag (tag:farm) or all', options: [{ type: 3, name: 'account', description: 'Account name, tag:x or all', required: true, autocomplete: true }] },
    { type: 1, name: 'rejoin', description: 'Restart an account into its game', options: [{ type: 3, name: 'account', description: 'Account name / nickname', required: true, autocomplete: true }] },
    { type: 1, name: 'close', description: 'Close an account, or "all"', options: [{ type: 3, name: 'account', description: 'Account name or all', required: true, autocomplete: true }] },
    { type: 1, name: 'screenshot', description: 'Screenshot an account\'s Roblox window', options: [{ type: 3, name: 'account', description: 'Account name / nickname', required: true, autocomplete: true }] },
    { type: 1, name: 'screenshots', description: 'Screenshots of every running alt (up to 10)' },
    { type: 1, name: 'tile', description: 'Tile all Roblox windows' },
    { type: 1, name: 'hatches', description: 'Recent secret hatches and totals per account' },
    { type: 1, name: 'watcher', description: 'Turn the 24/7 Watcher on or off', options: [{ type: 3, name: 'state', description: 'on or off', required: true, choices: [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }] }] },
  ],
}];

function set(patch) { Object.assign(st, patch); bus.emit('remote:update', status()); }

let connecting = null;
/** One connection attempt at a time: two would mean two sessions, and every button pressed twice. */
function connect() {
  if (!connecting) connecting = connectNow().finally(() => { connecting = null; });
  return connecting;
}
async function connectNow() {
  if (!token()) { set({ status: 'off', message: 'Add your bot token first.' }); return status(); }
  st.stopping = false;
  set({ status: 'connecting', message: 'Connecting to Discord…' });
  try {
    const me = await api('GET', '/users/@me');
    const app = await api('GET', '/oauth2/applications/@me');
    st.appId = app.id; st.botName = me.username;
    const guild = (settings.get('remote.guildId') || '').trim();
    // Guild commands appear instantly; global ones can take up to an hour.
    if (/^\d{15,22}$/.test(guild)) await api('PUT', `/applications/${app.id}/guilds/${guild}/commands`, COMMANDS);
    else await api('PUT', `/applications/${app.id}/commands`, COMMANDS);
    const gw = await api('GET', '/gateway/bot');
    if (st.stopping) return status(); // turned off while connecting
    openSocket(`${gw.url}/?v=10&encoding=json`);
  } catch (e) { set({ status: 'error', message: e.message }); scheduleReconnect(); }
  return status();
}

function openSocket(url, resume = false) {
  const ws = new WebSocket(url);
  // Close the previous connection first (its close handler sees it is no longer current and stays quiet).
  const old = st.ws;
  st.ws = ws;
  if (old) { try { old.close(1000); } catch { /* already closed */ } }
  ws.onmessage = (m) => { try { onPacket(JSON.parse(m.data), resume); } catch (e) { log.warn('packet', e.message); } };
  ws.onclose = (e) => {
    clearInterval(st.hb);
    if (st.ws !== ws) return;
    st.ws = null;
    if (st.stopping) return set({ status: 'off', message: 'Disconnected' });
    if ([4004, 4010, 4011, 4012, 4013, 4014].includes(e.code)) return set({ status: 'error', message: `Discord closed the connection (${e.code}). Check the token and bot settings.` });
    set({ status: 'connecting', message: 'Connection dropped — reconnecting…' });
    scheduleReconnect(true);
  };
  ws.onerror = () => {};
}

function scheduleReconnect(tryResume) {
  if (st.stopping) return;
  const delay = Math.min(60000, 2000 * 2 ** st.retry++);
  setTimeout(() => {
    if (st.stopping) return;
    if (tryResume && st.resumeUrl && st.sessionId) openSocket(`${st.resumeUrl}/?v=10&encoding=json`, true);
    else connect();
  }, delay);
}

function send(op, d) { if (st.ws?.readyState === 1) st.ws.send(JSON.stringify({ op, d })); }

function onPacket(p, resume) {
  if (p.s != null) st.seq = p.s;
  switch (p.op) {
    case 10: { // Hello
      clearInterval(st.hb);
      st.acked = true;
      st.hb = setInterval(() => {
        if (!st.acked) { try { st.ws?.close(4000); } catch { /* ignore */ } return; }
        st.acked = false; send(1, st.seq);
      }, p.d.heartbeat_interval);
      if (resume) send(6, { token: token(), session_id: st.sessionId, seq: st.seq });
      else send(2, { token: token(), intents: INTENTS, properties: { os: 'windows', browser: 'MultiMenu', device: 'MultiMenu' } });
      break;
    }
    case 11: st.acked = true; break;
    case 1: send(1, st.seq); break;
    case 7: try { st.ws?.close(4000); } catch { /* reconnect */ } break;
    // Invalid session: closing reconnects through scheduleReconnect (a fresh login, since there's no session to resume).
    case 9: st.sessionId = null; try { st.ws?.close(4000); } catch { /* ignore */ } break;
    case 0:
      if (p.t === 'READY') { st.sessionId = p.d.session_id; st.resumeUrl = p.d.resume_gateway_url; st.retry = 0; set({ status: 'online', message: `Online as ${st.botName}. Use /mm in your server.` }); startLive(); }
      if (p.t === 'RESUMED') { st.retry = 0; set({ status: 'online', message: `Online as ${st.botName}.` }); }
      if (p.t === 'INTERACTION_CREATE') handleInteraction(p.d).catch(e => log.warn('interaction', e.message));
      break;
    default: break;
  }
}

function allowed(userId) { return (settings.get('remote.allowedUserIds') || []).includes(String(userId)); }

async function reply(i, data, image) {
  const url = `${API}/interactions/${i.id}/${i.token}/callback`;
  const payload = { type: 4, data: { flags: settings.get('remote.private') ? 64 : 0, allowed_mentions: { parse: [] }, ...data } };
  if (image) {
    const form = new FormData();
    payload.data.attachments = [{ id: 0, filename: 'screenshot.png' }];
    form.append('payload_json', JSON.stringify(payload));
    form.append('files[0]', new Blob([image], { type: 'image/png' }), 'screenshot.png');
    await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  } else {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  }
}

const PURPLE = 0x8b5cf6;
const embed = (title, description, extra = {}) => ({ embeds: [{ title, description, color: PURPLE, timestamp: new Date().toISOString(), footer: { text: 'MultiMenu remote' }, ...extra }] });

function findSession(name) {
  const q = String(name || '').toLowerCase().trim();
  const list = require('./sessions').listSessions().filter(s => ['running', 'launching'].includes(s.status));
  return list.find(s => s.label.toLowerCase() === q || (s.username || '').toLowerCase() === q) || list.find(s => s.label.toLowerCase().includes(q) || (s.username || '').toLowerCase().includes(q));
}
function findPreset(name) {
  const q = String(name || '').toLowerCase().trim();
  const list = require('./presets').list();
  return list.find(p => p.name.toLowerCase() === q) || list.find(p => p.name.toLowerCase().includes(q));
}

async function handleInteraction(i) {
  if (i.type === 4) return autocomplete(i);
  if (i.type === 3) return component(i);
  if (i.type !== 2 || i.data?.name !== 'mm') return;
  const user = i.member?.user || i.user;
  if (!allowed(user?.id)) {
    log.warn(`Blocked /mm from Discord user ${user?.id}`);
    return reply(i, { flags: 64, content: '⛔ You are not allowed to control this MultiMenu. Add your Discord user ID in MultiMenu → Discord → Remote control.' });
  }
  const sub = i.data.options?.[0];
  const opt = (n) => sub?.options?.find(o => o.name === n)?.value;
  st.lastCommand = { at: Date.now(), user: user.username, command: sub?.name };
  bus.emit('remote:update', status());
  const sessions = require('./sessions');
  try {
    switch (sub?.name) {
      case 'status': {
        const list = sessions.listSessions().filter(s => ['running', 'launching'].includes(s.status));
        const w = require('./watcher').status();
        const sys = require('./system').latest();
        const lines = list.map(s => `${s.status === 'running' ? (s.watchState === 'not responding' ? '🔴' : '🟢') : '🟡'} **${s.label}** — ${s.placeName || s.placeId || '—'} · ${s.status === 'running' ? fmtDur(Date.now() - s.startedAt) : s.status}${s.watch ? ' · 🛰️' : ''}`);
        return reply(i, embed(`MultiMenu status — ${list.length} session${list.length === 1 ? '' : 's'}`, lines.join('\n') || 'Nothing running.', {
          fields: [
            { name: '24/7 Watcher', value: w.enabled ? `On${w.pending.length ? ` · ${w.pending.length} rejoin(s) queued` : ''}${w.quiet ? ' · quiet hours' : ''}` : 'Off', inline: true },
            { name: 'PC', value: sys ? `CPU ${Math.round(sys.cpu)}% · RAM ${Math.round(sys.ramPercent)}%` : '—', inline: true },
          ],
        }));
      }
      case 'start': {
        const p = findPreset(opt('preset'));
        if (!p) return reply(i, { content: `No preset matches “${opt('preset')}”.` });
        const r = await require('./presets').run(p.id);
        return reply(i, embed(`▶️ Started “${p.name}”`, r.steps.join('\n')));
      }
      case 'stop': {
        const p = findPreset(opt('preset'));
        if (!p) return reply(i, { content: `No preset matches “${opt('preset')}”.` });
        const r = require('./presets').closePreset(p.id, 'Closed from Discord');
        return reply(i, embed(`⏹️ Closed “${p.name}”`, `${r.closed} session(s) closed.`));
      }
      case 'rejoin': {
        const s = findSession(opt('account'));
        if (!s) return reply(i, { content: `No running account matches “${opt('account')}”.` });
        const raw = sessions.getRaw(s.id);
        sessions.endForRestart(s.id, 'Rejoin requested from Discord');
        setTimeout(() => sessions.launch(s.accountId, null, { label: s.label, watch: raw?.watch, target: raw?.target || null }), 3000);
        return reply(i, embed(`🔁 Rejoining ${s.label}`, 'Closing the client and launching it again.'));
      }
      case 'close': {
        if (String(opt('account')).toLowerCase() === 'all') { await sessions.closeAll(); return reply(i, embed('⏹️ Closing all sessions', 'Every Roblox client started by MultiMenu is closing.')); }
        const s = findSession(opt('account'));
        if (!s) return reply(i, { content: `No running account matches “${opt('account')}”.` });
        sessions.setWatch(s.id, false);
        await sessions.close(s.id);
        return reply(i, embed(`⏹️ Closing ${s.label}`, 'The 24/7 Watcher will not rejoin it.'));
      }
      case 'screenshot': {
        const s = findSession(opt('account'));
        if (!s) return reply(i, { content: `No running account matches “${opt('account')}”.` });
        const png = await require('./capture').captureWindowOfPid(s.pid);
        if (!png) return reply(i, { content: `Couldn't capture ${s.label}'s window (it may be minimised).` });
        return reply(i, embed(`📸 ${s.label}`, s.placeName || '', { image: { url: 'attachment://screenshot.png' } }), png);
      }
      case 'tile': { const n = require('./tiler').targets().length; if (!n) throw new Error('No running Roblox windows to tile.'); require('./tiler').tile().catch(() => {}); return reply(i, embed('🪟 Tiling windows', `Arranging ${n} window${n === 1 ? '' : 's'}.`)); }
      case 'panel': return respond(i, 4, panel());
      case 'live': {
        if (opt('state') === 'off') { await stopLive(true); return reply(i, { flags: 64, content: '⏹️ Live status stopped.' }); }
        await respond(i, 4, { flags: 64, content: '📡 Live status is on. It updates here every minute.' });
        return startLive(i.channel_id);
      }
      case 'launch': {
        const r = await require('./commands').run('launch', { who: opt('account') }, { source: 'discord' });
        return reply(i, embed('▶️ Launch', r.message));
      }
      case 'screenshots': {
        await respond(i, 5, {});
        const live = sessions.listSessions().filter(s => s.status === 'running' && s.pid).slice(0, 10);
        const files = [];
        for (const s of live) {
          try {
            const png = await require('./capture').captureWindowOfPid(s.pid, 960);
            if (png) files.push({ name: `alt${files.length + 1}.jpg`, label: s.label, data: require('electron').nativeImage.createFromBuffer(png).toJPEG(75) });
          } catch { /* skip that window */ }
        }
        if (!files.length) return editOriginal(i, { content: live.length ? 'Couldn\'t capture any window (they may be minimised).' : 'Nothing is running.' });
        return editOriginal(i, { embeds: files.map(f => ({ title: `📸 ${f.label}`, color: PURPLE, image: { url: `attachment://${f.name}` } })), attachments: files.map((f, n) => ({ id: n, filename: f.name })) }, files);
      }
      case 'hatches': {
        const h = require('./hatch').status();
        const recentLines = h.log.filter(x => !x.test).slice(0, 10).map(x => `<t:${Math.floor(x.at / 1000)}:R> **${x.label}**: ${x.pet || x.rarity || 'secret'}`);
        const totals = h.counts.slice(0, 15).map(c => `${c.label}: ${c.n}`).join(' · ');
        return reply(i, embed(`🥚 Secret hatches${h.enabled ? '' : ' (alerts are off)'}`, recentLines.join('\n') || 'No secret hatches seen yet.', totals ? { fields: [{ name: 'Totals', value: totals.slice(0, 1000) }] } : {}));
      }
      case 'watcher': { const r = require('./watcher').setEnabled(opt('state') === 'on'); return reply(i, embed(`🛰️ 24/7 Watcher ${r.enabled ? 'on' : 'off'}`, '')); }
      default: return reply(i, { content: 'Unknown command.' });
    }
  } catch (e) {
    return reply(i, { content: `⚠️ ${e.message}` });
  }
}

// ---------- 2.0: buttons, menus, live status, autocomplete ----------
async function respond(i, type, data, files) {
  const url = `${API}/interactions/${i.id}/${i.token}/callback`;
  const payload = { type, data: type === 5 || type === 6 ? (data || {}) : { allowed_mentions: { parse: [] }, ...data } };
  if (files?.length) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));
    files.forEach((f, n) => form.append(`files[${n}]`, new Blob([f.data], { type: 'image/jpeg' }), f.name));
    return fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
  }
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
}
async function editOriginal(i, data, files) {
  const url = `${API}/webhooks/${st.appId}/${i.token}/messages/@original`;
  const body = { allowed_mentions: { parse: [] }, ...data };
  if (files?.length) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(body));
    files.forEach((f, n) => form.append(`files[${n}]`, new Blob([f.data], { type: 'image/jpeg' }), f.name));
    return fetch(url, { method: 'PATCH', body: form, signal: AbortSignal.timeout(60000) });
  }
  return fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
}

const short = (s, n) => String(s || '').slice(0, n);
/** Status embed + controls. `picked`: a session id to show that alt's own buttons. Pure apart from reading state. */
function panel(picked, note) {
  const sessions = require('./sessions');
  const list = sessions.listSessions().filter(s => ['running', 'launching'].includes(s.status));
  const w = require('./watcher').status();
  const sys = require('./system').latest();
  const lines = list.map(s => `${s.status === 'running' ? (s.watchState === 'not responding' ? '🔴' : '🟢') : '🟡'} **${short(s.label, 40)}** — ${short(s.placeName || s.placeId || '—', 40)} · ${s.status === 'running' ? fmtDur(Date.now() - s.startedAt) : s.status}`);
  const pickedS = picked ? list.find(s => s.id === picked) : null;
  const presets = require('./presets').list().slice(0, 25);
  const rows = [];
  if (list.length) rows.push({ type: 1, components: [{ type: 3, custom_id: 'mm:pick', placeholder: 'Pick an alt…', options: list.slice(0, 25).map(s => ({ label: short(s.label, 100), value: s.id, description: short(s.placeName || s.status, 100), default: s.id === picked })) }] });
  if (pickedS) rows.push({ type: 1, components: [
    { type: 2, style: 1, label: 'Rejoin', emoji: { name: '🔁' }, custom_id: `mm:rejoin:${pickedS.id}`, disabled: !pickedS.accountId },
    { type: 2, style: 2, label: 'Screenshot', emoji: { name: '📸' }, custom_id: `mm:shot:${pickedS.id}` },
    { type: 2, style: 2, label: 'Bring to front', emoji: { name: '🪟' }, custom_id: `mm:focus:${pickedS.id}` },
    { type: 2, style: 4, label: 'Close', emoji: { name: '⏹️' }, custom_id: `mm:close:${pickedS.id}` },
  ] });
  rows.push({ type: 1, components: [
    { type: 2, style: 2, label: 'Refresh', emoji: { name: '🔄' }, custom_id: 'mm:refresh' },
    { type: 2, style: 2, label: 'Tile', emoji: { name: '🪟' }, custom_id: 'mm:tile' },
    { type: 2, style: w.enabled ? 3 : 2, label: w.enabled ? 'Watcher on' : 'Watcher off', emoji: { name: '🛰️' }, custom_id: 'mm:watcher' },
    { type: 2, style: 4, label: 'Close all', emoji: { name: '⛔' }, custom_id: 'mm:closeAll', disabled: !list.length },
  ] });
  if (presets.length) rows.push({ type: 1, components: [{ type: 3, custom_id: 'mm:preset', placeholder: 'Start a preset…', options: presets.map(p => ({ label: short(p.name, 100), value: p.id })) }] });
  const fields = [
    { name: '24/7 Watcher', value: w.enabled ? `On${w.pending.length ? ` · ${w.pending.length} rejoin(s) queued` : ''}` : 'Off', inline: true },
    { name: 'PC', value: sys ? `CPU ${Math.round(sys.cpu)}% · RAM ${Math.round(sys.ramPercent)}%` : '—', inline: true },
  ];
  if (note) fields.push({ name: 'Last action', value: short(note, 200) });
  return { embeds: [{ title: `MultiMenu — ${list.length} running`, description: lines.join('\n').slice(0, 3900) || 'Nothing running.', color: PURPLE, fields, timestamp: new Date().toISOString(), footer: { text: 'MultiMenu remote · updates when you press a button' } }], components: rows };
}

async function component(i) {
  const user = i.member?.user || i.user;
  if (!allowed(user?.id)) return respond(i, 4, { flags: 64, content: '⛔ You are not allowed to control this MultiMenu.' });
  const sessions = require('./sessions');
  const [, what, id] = String(i.data?.custom_id || '').split(':');
  const value = i.data?.values?.[0];
  st.lastCommand = { at: Date.now(), user: user.username, command: `button ${what}` };
  bus.emit('remote:update', status());
  const find = (sid) => sessions.listSessions().find(s => s.id === sid);
  try {
    switch (what) {
      case 'refresh': return respond(i, 7, panel());
      case 'pick': return respond(i, 7, panel(value));
      case 'tile': { const n = require('./tiler').targets().length; if (!n) throw new Error('No running Roblox windows to tile.'); require('./tiler').tile().catch(() => {}); return respond(i, 7, panel(null, `🪟 Tiling ${n} window${n === 1 ? '' : 's'}`)); }
      case 'watcher': { const r = require('./watcher').setEnabled(!require('./watcher').status().enabled); return respond(i, 7, panel(null, `🛰️ 24/7 Watcher ${r.enabled ? 'on' : 'off'}`)); }
      case 'closeAll': return respond(i, 4, { flags: 64, content: 'Close every alt MultiMenu started?', components: [{ type: 1, components: [{ type: 2, style: 4, label: 'Yes, close all', custom_id: 'mm:closeAllYes' }] }] });
      case 'closeAllYes': await sessions.closeAll(); return respond(i, 7, { content: '⏹️ Closing all sessions.', components: [] });
      case 'preset': { const p = require('./presets').get(value); if (!p) return respond(i, 4, { flags: 64, content: 'That preset is gone.' }); const r = await require('./presets').run(p.id); return respond(i, 7, panel(null, `▶️ Started “${p.name}”: ${r.steps.join(' · ')}`)); }
      case 'rejoin': {
        const s = find(id); if (!s?.accountId) return respond(i, 7, panel(null, 'That alt isn\'t running any more.'));
        const raw = sessions.getRaw(s.id);
        sessions.endForRestart(s.id, 'Rejoin requested from Discord');
        setTimeout(() => sessions.launch(s.accountId, null, { label: s.label, watch: raw?.watch, target: raw?.target || null }), 3000);
        return respond(i, 7, panel(null, `🔁 Rejoining ${s.label}`));
      }
      case 'again': {
        // From a "closed unexpectedly" DM: launch the account again, into the same game.
        const [, , accountId, placeId] = String(i.data?.custom_id || '').split(':');
        const acc = require('./accounts').find(accountId);
        if (!acc) return respond(i, 4, { flags: 64, content: 'That account isn\'t in MultiMenu any more.' });
        const label = acc.alias || acc.displayName || acc.username || 'Account';
        if (sessions.listSessions().some(x => x.accountId === accountId && ['launching', 'running', 'rejoining'].includes(x.status))) return respond(i, 7, { content: `✅ ${short(label, 80)} is already running again.`, components: [] });
        sessions.launch(accountId, null, /^\d{1,15}$/.test(placeId || '') ? { target: { placeId } } : {});
        return respond(i, 7, { content: `🔁 Launching ${short(label, 80)} again.`, components: [] });
      }
      case 'close': { const s = find(id); if (!s) return respond(i, 7, panel(null, 'That alt isn\'t running any more.')); sessions.setWatch(s.id, false); await sessions.close(s.id); return respond(i, 7, panel(null, `⏹️ Closing ${s.label}`)); }
      case 'focus': { const s = find(id); if (!s) return respond(i, 7, panel(null, 'That alt isn\'t running any more.')); require('./tiler').focus(s.id); return respond(i, 7, panel(s.id, `🪟 ${s.label} is in front`)); }
      case 'shot': {
        const s = find(id); if (!s) return respond(i, 4, { flags: 64, content: 'That alt isn\'t running any more.' });
        await respond(i, 5, { flags: settings.get('remote.private') ? 64 : 0 });
        const png = await require('./capture').captureWindowOfPid(s.pid, 1280);
        if (!png) return editOriginal(i, { content: `Couldn't capture ${s.label}'s window (it may be minimised).` });
        const f = { name: 'shot.jpg', data: require('electron').nativeImage.createFromBuffer(png).toJPEG(80) };
        return editOriginal(i, { embeds: [{ title: `📸 ${s.label}`, color: PURPLE, image: { url: 'attachment://shot.jpg' } }], attachments: [{ id: 0, filename: f.name }] }, [f]);
      }
      default: return respond(i, 4, { flags: 64, content: 'Unknown button.' });
    }
  } catch (e) { return respond(i, 4, { flags: 64, content: `⚠️ ${e.message}` }); }
}

/** Suggestions while typing an account or preset name (only for allowed users). */
async function autocomplete(i) {
  const user = i.member?.user || i.user;
  const sub = i.data?.options?.[0];
  const focused = sub?.options?.find(o => o.focused);
  let choices = [];
  if (allowed(user?.id) && focused) {
    const q = String(focused.value || '').toLowerCase();
    if (focused.name === 'preset') choices = require('./presets').list().map(p => p.name);
    else {
      const acc = require('./accounts');
      const names = acc.raw().accounts.map(a => a.alias || a.displayName || a.username);
      const tags = acc.allTags().map(t => `tag:${t.tag}`);
      choices = ['close', 'launch'].includes(sub.name) ? ['all', ...names, ...tags] : names;
    }
    choices = choices.filter(c => c.toLowerCase().includes(q)).slice(0, 25);
  }
  return respond(i, 8, { choices: choices.map(c => ({ name: short(c, 100), value: short(c, 100) })) });
}

// Live status: one message in a channel, edited every minute.
let liveTimer = null;
async function botApi(method, route, body) {
  const res = await fetch(`${API}${route}`, { method, headers: { Authorization: `Bot ${token()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (!res.ok && res.status !== 204) { const e = new Error(`Discord ${res.status}`); e.status = res.status; throw e; }
  return res.status === 204 ? null : res.json();
}
function livePayload() { const p = panel(); p.embeds[0].footer = { text: 'MultiMenu live status · updates every minute' }; return p; }
async function startLive(channelId) {
  clearInterval(liveTimer);
  if (channelId) {
    const old = store.get('live');
    if (old?.messageId) { try { await botApi('DELETE', `/channels/${old.channelId}/messages/${old.messageId}`); } catch { /* already gone */ } }
    try {
      const m = await botApi('POST', `/channels/${channelId}/messages`, livePayload());
      store.set('live', { channelId, messageId: m.id }); store.saveNow();
    } catch (e) {
      log.warn(`Live status: ${e.message}`);
      bus.emit('notify', { level: 'warn', title: 'Discord live status', message: e.status === 403 ? 'The bot can\'t post in that channel. Give it Send Messages and Embed Links there.' : e.message });
      return;
    }
  }
  if (!store.get('live')) return;
  liveTimer = setInterval(async () => {
    const live = store.get('live');
    if (!live || st.status !== 'online') return;
    try { await botApi('PATCH', `/channels/${live.channelId}/messages/${live.messageId}`, livePayload()); }
    catch (e) { if (e.status === 404 || e.status === 403) { log.warn('Live status message is gone: stopping'); stopLive(false); } }
  }, 60_000);
}
async function stopLive(edit) {
  clearInterval(liveTimer); liveTimer = null;
  const live = store.get('live');
  store.set('live', null); store.saveNow();
  if (edit && live) { try { await botApi('PATCH', `/channels/${live.channelId}/messages/${live.messageId}`, { embeds: [{ title: 'MultiMenu live status', description: 'Stopped. Use /mm live on to start it again.', color: PURPLE }], components: [] }); } catch { /* gone */ } }
}

function fmtDur(ms) { const m = Math.floor(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; }

function disconnect() {
  clearInterval(liveTimer); liveTimer = null;
  st.stopping = true;
  clearInterval(st.hb);
  try { st.ws?.close(1000); } catch { /* ignore */ }
  st.ws = null;
  set({ status: 'off', message: 'Disconnected' });
  return status();
}

// View Channel, Send Messages, Embed Links and Attach Files (for the live status and screenshots).
function inviteUrl() { return st.appId ? `https://discord.com/oauth2/authorize?client_id=${st.appId}&scope=bot%20applications.commands&permissions=52224` : null; }

// ---- direct messages (hatch alerts) ----
/** Who would get a DM: the people allowed to use the bot, when a bot token is saved. */
function canDm() {
  const ids = (settings.get('remote.allowedUserIds') || []).filter(id => /^\d{15,22}$/.test(id));
  return { ready: !!store?.get('tokenEnc') && ids.length > 0, hasToken: !!store?.get('tokenEnc'), users: ids.length };
}

/** Sends a DM (with an optional PNG and buttons) to every allowed user. Only text MultiMenu wrote goes in; never logins. */
async function dm(text, image, components) {
  const { ready } = canDm();
  if (!ready) return { sent: 0, reason: 'not-set-up' };
  let sent = 0;
  for (const id of settings.get('remote.allowedUserIds').filter(x => /^\d{15,22}$/.test(x)).slice(0, 5)) {
    try {
      const ch = await api('POST', '/users/@me/channels', { recipient_id: id });
      const payload = { content: String(text).slice(0, 1900), allowed_mentions: { parse: [] }, ...(components ? { components } : {}) };
      if (image) {
        const form = new FormData();
        form.append('payload_json', JSON.stringify({ ...payload, attachments: [{ id: 0, filename: 'screenshot.png' }] }));
        form.append('files[0]', new Blob([image], { type: 'image/png' }), 'screenshot.png');
        const res = await fetch(`${API}/channels/${ch.id}/messages`, { method: 'POST', headers: { Authorization: `Bot ${token()}`, 'User-Agent': 'MultiMenu' }, body: form, signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`Discord API ${res.status}`);
      } else await api('POST', `/channels/${ch.id}/messages`, payload);
      sent++;
    } catch (e) { log.warn(`DM to an allowed user failed: ${e.message}`); }
  }
  return { sent };
}

// ---- "an alt closed" DMs with a Rejoin button (Discord page → Remote control) ----
function onEnded(s) {
  if (!s || s.external || !s.accountId || !settings.get('remote.alertClosed') || !canDm().ready) return;
  let rejoining = false;
  try { rejoining = !!s.watch && require('./watcher').status().enabled; } catch { /* no watcher */ }
  const place = s.placeName ? ` in ${short(s.placeName, 80)}` : '';
  const text = `💥 **${short(s.label, 80)}** closed unexpectedly${place}.${rejoining ? ' The 24/7 Watcher is rejoining it.' : ''}`;
  const placeId = /^\d{1,15}$/.test(String(s.placeId || '')) ? s.placeId : '';
  const components = rejoining ? null : [{ type: 1, components: [{ type: 2, style: 1, label: 'Rejoin', emoji: { name: '🔁' }, custom_id: `mm:again:${s.accountId}:${placeId}`.slice(0, 100) }] }];
  dm(text, null, components).catch(e => log.warn(`Closed-alt DM failed: ${e.message}`));
}
bus.on('session:ended', onEnded);

function status() {
  return { status: st.status, message: st.message, hasToken: !!store?.get('tokenEnc'), botName: st.botName, appId: st.appId, inviteUrl: inviteUrl(), lastCommand: st.lastCommand, config: settings.get('remote'), live: !!store?.get('live') };
}

module.exports = { init, setToken, connect, disconnect, status, COMMANDS, allowed, handleInteraction, panel, stopLive, dm, canDm };
