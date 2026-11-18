'use strict';
// In-app notification centre + optional Windows toasts. Also routes app events
// (bus 'event') to Discord webhooks.
const { Notification } = require('electron');
const bus = require('../bus');
const webhooks = require('./webhooks');
const settings = require('./settings');

const items = [];
let version = '0.0.0';

const LEVEL = {
  accountLaunched: 'success', accountClosed: 'info', accountCrashed: 'error', launchFailed: 'error', sessionError: 'warn',
  highUsage: 'warn', trimmer: 'info', appError: 'error', updates: 'info', appStarted: 'info', appClosed: 'info',
  watcherProblem: 'warn', watcherRejoin: 'success', watcherGaveUp: 'error', scheduleRan: 'info', dailyReport: 'info', accountHealth: 'warn', memoryRestart: 'info',
  privateServerExpiring: 'warn', freshRestart: 'info', dataCap: 'warn', robloxUpdate: 'info', robloxUpdateHeld: 'info', serverHop: 'info',
  internetBack: 'success', robloxOutage: 'error', gameUpdated: 'info', highPing: 'warn', inbox: 'info', loginWarning: 'warn', achievement: 'success', secretHatched: 'success',
};

function describe(e) {
  switch (e.type) {
    case 'accountLaunched': return { title: 'Session running', message: e.account };
    case 'accountClosed': return { title: 'Session closed', message: e.account };
    case 'accountCrashed': return { title: 'Session ended unexpectedly', message: `${e.account}: ${e.error}` };
    case 'launchFailed': return { title: 'Launch failed', message: `${e.account}: ${e.error}` };
    case 'sessionError': return { title: 'Session error', message: e.error };
    case 'highUsage': return { title: 'High resource usage', message: e.detail };
    case 'trimmer': return { title: `RAM Trimmer ${e.status}`, message: e.error || '' };
    case 'appError': return { title: 'Application error', message: e.error };
    case 'updates': return { title: 'Update available', message: e.detail };
    case 'watcherProblem': return { title: `Watcher: ${e.status}`, message: `${e.account}: ${e.detail}` };
    case 'watcherRejoin': return { title: 'Watcher: rejoining', message: `${e.account}: ${e.detail}` };
    case 'watcherGaveUp': return { title: 'Watcher stopped retrying', message: `${e.account}: ${e.detail}` };
    case 'scheduleRan': return { title: 'Scheduled task', message: e.detail };
    case 'internetBack': return { title: 'Internet is back', message: e.detail };
    case 'robloxOutage': return { title: 'Roblox outage', message: e.detail };
    case 'gameUpdated': return { title: 'Game updated', message: e.detail };
    case 'highPing': return { title: 'High ping', message: `${e.account}: ${e.detail}` };
    case 'inbox': return { title: 'New in your inbox', message: `${e.account}: ${e.detail}` };
    case 'memoryRestart': return { title: 'Memory guard restart', message: `${e.account}: ${e.detail}` };
    case 'dailyReport': return { title: 'Daily report sent', message: e.summary || '' };
    case 'loginWarning': return { title: 'Logins need refreshing', message: e.detail };
    case 'accountHealth': return { title: 'Account needs attention', message: `${e.account}: ${e.detail}` };
    case 'achievement': return { title: 'Achievement unlocked', message: e.detail || '' };
    case 'privateServerExpiring': return { title: 'Private server running out', message: `${e.account}: ${e.detail}` };
    case 'freshRestart': return { title: 'Fresh restart', message: `${e.account}: ${e.detail}` };
    case 'dataCap': return { title: 'Data cap', message: e.detail || '' };
    case 'robloxUpdate': return { title: 'Roblox is updating', message: e.detail || '' };
    case 'robloxUpdateHeld': return { title: 'Roblox update held', message: e.detail || '' };
    case 'serverHop': return { title: 'Joining another server', message: e.detail || '' };
    case 'secretHatched': return { title: 'Secret hatched!', message: e.detail || '' };
    default: return { title: e.type, message: e.detail || '' };
  }
}

function push(n) {
  const item = { id: Date.now() + Math.random(), at: Date.now(), read: false, level: n.level || 'info', title: n.title, message: n.message || '' };
  items.unshift(item);
  if (items.length > 100) items.length = 100;
  bus.emit('notifications:new', item);
  if (n.toast && Notification.isSupported()) { const { t } = require('../i18n'); new Notification({ title: t(n.title), body: t(n.message || ''), silent: false }).show(); }
}

function init(appVersion) {
  version = appVersion;
  bus.on('notify', push);
  bus.on('event', (e) => {
    const d = describe(e);
    const toast = ['accountCrashed', 'launchFailed', 'highUsage', 'watcherGaveUp', 'accountHealth', 'loginWarning', 'privateServerExpiring', 'dataCap', 'secretHatched'].includes(e.type) && settings.get('notifications.toasts');
    push({ level: LEVEL[e.type] || 'info', ...d, toast });
    const { image, ...plain } = e;
    if (!e.quiet) {
      webhooks.send(plain, { version, image }).catch(() => {});
      require('./alertapps').send(plain).catch(() => {});
    }
  });
}

module.exports = {
  init,
  list: () => items,
  markAllRead: () => { items.forEach(i => { i.read = true; }); return items; },
  clear: () => { items.length = 0; return items; },
};
