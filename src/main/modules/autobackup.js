'use strict';
// Automatic encrypted backups. Every day at the chosen time, writes a
// password-protected .mmvault (same format as the manual backup) to a folder you
// pick - e.g. your OneDrive or Google Drive folder - and keeps the newest N.
// The backup password is stored encrypted with DPAPI so it can run unattended.
const fs = require('fs');
const path = require('path');
const { JsonStore } = require('../store');
const paths = require('../paths');
const secure = require('../secure');
const settings = require('./settings');
const backup = require('./backup');
const stats = require('./stats');
const bus = require('../bus');
const log = require('../logger').scope('autobackup');

let store, timer = null;
const PATTERN = /^MultiMenu-auto-\d{4}-\d{2}-\d{2}\.mmvault$/;

function init() {
  store = new JsonStore(paths.file('autobackup.json'), { passwordEnc: null, lastRunDay: null, lastRun: null, lastFile: null, lastError: null });
  clearInterval(timer);
  timer = setInterval(() => { try { tick(); } catch (e) { log.error('tick', e); } }, 60_000);
}

function setPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new Error('Use a backup password of at least 8 characters.');
  store.set('passwordEnc', secure.encrypt(pw));
  store.saveNow();
  return status();
}

/** Keeps the newest `keep` automatic backups in `dir`; returns removed names. Exported for tests. */
function prune(dir, keep) {
  const files = fs.readdirSync(dir).filter(f => PATTERN.test(f)).sort();
  const remove = files.slice(0, Math.max(0, files.length - Math.max(1, keep)));
  for (const f of remove) fs.unlinkSync(path.join(dir, f));
  return remove;
}

function runNow() {
  const cfg = settings.get('autoBackup');
  if (!cfg.folder) throw new Error('Choose a backup folder first.');
  if (!store.get('passwordEnc')) throw new Error('Set a backup password first.');
  if (!fs.existsSync(cfg.folder)) throw new Error('The backup folder no longer exists.');
  try {
    const { text, count } = backup.exportVault(secure.decrypt(store.get('passwordEnc')));
    const name = `MultiMenu-auto-${stats.dayKey()}.mmvault`;
    const tmp = path.join(cfg.folder, `${name}.tmp`);
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, path.join(cfg.folder, name));
    const removed = prune(cfg.folder, cfg.keep);
    Object.assign(store.data, { lastRunDay: stats.dayKey(), lastRun: Date.now(), lastFile: name, lastError: null });
    store.saveNow();
    log.info(`Automatic backup ${name}: ${count} accounts, removed ${removed.length} old`);
    bus.emit('autobackup:update', status());
    return { file: name, count, removed: removed.length };
  } catch (e) {
    store.set('lastError', e.message); store.saveNow();
    bus.emit('event', { type: 'appError', error: `Automatic backup failed: ${e.message}` });
    throw e;
  }
}

function tick() {
  const cfg = settings.get('autoBackup');
  if (!cfg.enabled || store.get('lastRunDay') === stats.dayKey()) return;
  const [h, m] = String(cfg.time || '03:00').split(':').map(Number);
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  try { runNow(); } catch { /* reported */ }
}

function status() {
  const s = store.get();
  let files = [];
  const folder = settings.get('autoBackup.folder');
  try { if (folder) files = fs.readdirSync(folder).filter(f => PATTERN.test(f)).sort().reverse(); } catch { /* folder gone */ }
  return { hasPassword: !!s.passwordEnc, lastRun: s.lastRun, lastFile: s.lastFile, lastError: s.lastError, files, config: settings.get('autoBackup') };
}

module.exports = { init, setPassword, runNow, status, prune, PATTERN };
