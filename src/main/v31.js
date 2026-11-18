'use strict';
// 3.1 features: their commands for the UI, the events they push, and start-up.
const bus = require('./bus');
const log = require('./logger').scope('v31');

const ids = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 200) : []);
const str = (v, n = 400) => String(v ?? '').slice(0, n);
const m = (name) => require(`./modules/${name}`);

// Events the UI listens to (also listed in preload.js).
const EVENTS = ['netmon:update', 'updateguard:update', 'checklist:update'];

function handlers() {
  return {
    // Items & security
    'items:status': () => m('accountcheck').status(),
    'items:security': (list) => m('accountcheck').checkSecurity(ids(list)),
    'items:wallets': (list) => m('accountcheck').checkWallets(ids(list)),
    'items:limiteds': (list) => m('accountcheck').checkItems(ids(list)),
    'items:game': (input, list) => m('accountcheck').checkGame(str(input), ids(list)),
    // Private servers and the smart server picker
    'privservers:status': () => m('privateservers').status(),
    'privservers:refresh': () => m('privateservers').refresh(),
    'privservers:launch': (id, list) => m('privateservers').launch(str(id, 40), ids(list)),
    'privservers:save': (id) => m('privateservers').save(str(id, 40)),
    'smartjoin:join': (list, input, o) => m('smartjoin').join(ids(list), str(input), {
      mode: ['ping', 'fewest', 'spread'].includes(o?.mode) ? o.mode : 'ping',
      perServer: Math.max(1, Math.min(50, Math.floor(Number(o?.perServer)) || 1)),
      by: o?.by === 'fewest' ? 'fewest' : 'ping',
    }),
    'servers:gameAccounts': (id, list) => require('./modules/servers').setGameAccounts(str(id, 60), ids(list)),
    // Update guard
    'updateguard:check': () => m('updateguard').check(),
    'updateguard:updateNow': () => m('updateguard').updateNow(),
    // Using less CPU and RAM (Settings → Performance)
    'lean:trimSelf': () => ({ freedMB: m('lean').trimSelf() }),
    'lean:lightest': () => {
      const { setSetting } = require('./ipc');
      const L = m('lean');
      for (const [k, v] of Object.entries(L.LIGHTEST)) setSetting(k, v);
      setSetting('performance.deepIdleMin', L.deepIdleFloor());
      return require('./modules/settings').all();
    },
    // Wallpaper Engine backgrounds (Theme studio)
    'theme:weList': () => m('themes').wallpaperEngine(),
    'theme:weUse': (id) => m('themes').useWallpaper(str(id, 10)),
    // Volume mixer
    'volume:view': () => m('volume').view(),
    'volume:set': (accountId, level) => m('volume').set(str(accountId, 60), Number(level)),
    'volume:setAll': (level, resetOwn) => m('volume').setAll(Number(level), { resetOwn: !!resetOwn }),
    'volume:reset': (accountId) => m('volume').reset(str(accountId, 60)),
    // Network monitor
    'netmon:view': () => m('netmon').view(),
    'netmon:restart': () => { m('netmon').start(); return m('netmon').view(); },
    // Fresh restarts
    'freshrestart:status': () => m('freshrestart').status(),
    'freshrestart:now': (id) => m('freshrestart').restartNow(str(id, 60)),
    // Logs
    'logs:files': () => m('logbrowser').files(),
    'logs:read': (name, o) => m('logbrowser').read(str(name, 200), { kind: str(o?.kind, 20), q: str(o?.q, 100) }),
    'logs:search': (o) => m('logbrowser').search({ kind: str(o?.kind, 20), q: str(o?.q, 100) }),
    'logs:summary': () => m('logbrowser').summary(),
    'logs:openFolder': () => { const d = m('robloxlogs').logsDir(); if (!d) throw new Error('Roblox logs folder not found.'); return require('electron').shell.openPath(d); },
    // Getting started
    'checklist:status': () => m('checklist').status(),
    'checklist:hide': (on) => m('checklist').hide(on !== false),
  };
}

/** Settings whose change needs a module to react. */
function onSetting(key) {
  if (key.startsWith('netmon.')) m('netmon').start();
  if (key === 'privateServers.warn' || key === 'privateServers.warnDays') { try { m('privateservers').init(); } catch { /* not started */ } }
  if (key.startsWith('checklist.')) bus.emit('checklist:update', m('checklist').status());
  if (key === 'updateGuard.hold') m('updateguard').applyHold();
  if (key === 'tiling.hideTitleBars') m('titlebars').apply();
  if (key === 'performance.endCrashHandlers') m('lean').applyCrashHandlers();
  if (key.startsWith('richPresence')) { m('richpresence').apply(); bus.emit('presence:update', m('richpresence').status()); }
}

function init() {
  for (const name of ['accountcheck', 'privateservers', 'volume', 'netmon', 'freshrestart', 'checklist', 'updateguard', 'serverhop', 'titlebars', 'lean']) {
    try { m(name).init(); } catch (e) { log.warn(`${name} did not start: ${e.message}`); }
  }
}

function stop() { try { m('netmon').stop(); } catch { /* not started */ } try { m('updateguard').stop(); } catch { /* not started */ } try { m('serverhop').stop(); m('titlebars').stop(); m('lean').stop(); } catch { /* not started */ } }

module.exports = { handlers, onSetting, init, stop, EVENTS };
