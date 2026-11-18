'use strict';
// The only bridge between the UI and the main process. Exposes two functions:
// invoke(channel, ...args) for an allow-listed set of commands, and on(event, cb)
// for an allow-listed set of push events. No Node APIs reach the page.
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set([
  'netmon:update', 'updateguard:update', 'checklist:update',
  'admin:feed', 'system:sample', 'sessions:changed', 'sessions:stats', 'accounts:changed', 'notifications:new', 'trimmer:update', 'hatch:new', 'presence:update', 'launchqueue:changed',
  'clicker:update', 'macros:update', 'macros:changed', 'antiafk:update', 'updater:update', 'updater:available', 'fps:update',
  'nav', 'tiler:update', 'watcher:update', 'limiter:update', 'presets:changed', 'schedule:changed', 'remote:update', 'system:idle', 'alts:progress', 'follow:update', 'autobackup:update',
  'guards:update', 'sleeptimer:update', 'clipboard:link', 'capacity:update', 'theme:changed',
  'pip:update', 'pip:target', 'phone:update', 'logincheck:update', 'api:update', 'overlay:labels', 'overlay:update', 'wall:update', 'switcher:show', 'rotation:update', 'autoscale:update', 'gameprofiles:changed', 'automations:changed', 'automations:ran', 'achievements:update', 'perf:changed',
]);

contextBridge.exposeInMainWorld('mm', {
  invoke: (channel, ...args) => {
    if (typeof channel !== 'string' || !/^[a-z]+:[a-zA-Z0-9]+$/.test(channel)) return Promise.reject(new Error('Bad channel'));
    return ipcRenderer.invoke('mm', channel, ...args).then(r => {
      if (r && r.__error) { const e = new Error(r.message); e.code = r.code; throw e; }
      return r;
    });
  },
  on: (event, cb) => {
    if (!EVENTS.has(event)) throw new Error(`Unknown event ${event}`);
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(`evt:${event}`, fn);
    return () => ipcRenderer.removeListener(`evt:${event}`, fn);
  },
});
