'use strict';
// Server hop: when an account is sent to one particular server (a server link, the server
// browser, "join this server") and it can't get in, because the server is full, closing,
// or Roblox says the account is already in it, it joins a different server of the same
// game instead of sitting on an error screen. Once per launch; private server links are
// left alone (there is no other server to go to).
const settings = require('./settings');
const bus = require('../bus');
const log = require('../logger').scope('serverhop');

const GIVE_UP_MS = 60_000; // after the join starts, this long without getting in counts as failed
const CONNECTED = /\[FLog::Network\] serverId:/i;
const JOINING = /! Joining game '([0-9a-f-]{36})'/i;
const FAILED = /Time to disconnect replication data|Disconnection Notification|Sending disconnect with reason|Lost connection with reason|GameJoinStatus.*(full|fail)|Game is full|already in/i;

const watch = new Map(); // session id -> { jobId, joiningAt, done }
let timer = null;

/** Pure: should this session be looked after? A public server picked by its job ID. */
function wanted(s) {
  return !!(s && !s.external && s.target && s.target.jobId && !s.target.linkCode && s.target.placeId && s.accountId);
}

/** Pure: what the log lines say about the join: 'in', 'failed' or null (not yet). */
function verdict(lines, state) {
  for (const line of lines) {
    if (JOINING.test(line)) state.joiningAt = state.joiningAt || state.now;
    if (CONNECTED.test(line)) return 'in';
    if (FAILED.test(line)) return 'failed';
  }
  return null;
}

function hop(s, why) {
  const w = watch.get(s.id);
  if (!w || w.done) return;
  w.done = true;
  const sessions = require('./sessions');
  const raw = sessions.getRaw(s.id);
  if (!raw || raw.status !== 'running') return;
  log.info(`${s.label}: ${why}. Joining another server of place ${raw.target.placeId}`);
  bus.emit('event', { type: 'serverHop', account: s.label, detail: `${s.label} couldn't get into that server (${why}), so it's joining another server of the same game.` });
  sessions.endForRestart(s.id, 'Couldn\'t join that server: joining another one');
  setTimeout(() => sessions.launch(raw.accountId, null, { label: raw.label, watch: raw.watch, target: { placeId: raw.target.placeId } }), 3000);
}

function onLines({ session, lines } = {}) {
  if (!session || !settings.get('launch.hopIfJoinFails')) return;
  let w = watch.get(session.id);
  if (!w) {
    const raw = require('./sessions').getRaw(session.id);
    if (!wanted(raw)) return;
    w = { jobId: raw.target.jobId, joiningAt: null, done: false };
    watch.set(session.id, w);
  }
  if (w.done) return;
  const st = { joiningAt: w.joiningAt, now: Date.now() };
  const v = verdict(lines || [], st);
  w.joiningAt = st.joiningAt;
  if (v === 'in') w.done = true;
  else if (v === 'failed') hop(session, 'the server turned it away');
}

function sweep() {
  const now = Date.now();
  const sessions = require('./sessions');
  for (const [id, w] of watch) {
    const s = sessions.getRaw(id);
    if (!s || s.status !== 'running') { watch.delete(id); continue; }
    if (!w.done && w.joiningAt && now - w.joiningAt > GIVE_UP_MS && settings.get('launch.hopIfJoinFails')) hop(s, 'it wasn\'t let in within a minute');
  }
}

function init() {
  bus.on('robloxlog:lines', onLines);
  timer = setInterval(require('./lean').paced(sweep), 5000);
}
function stop() { clearInterval(timer); timer = null; watch.clear(); }

module.exports = { init, stop, wanted, verdict, GIVE_UP_MS };
