'use strict';
// Desktop shortcuts and taskbar jump list.
//  - "Create desktop shortcut" for a preset or account makes a .lnk that runs
//    MultiMenu.exe --preset=<id> / --account=<id>.
//  - Right-clicking MultiMenu on the taskbar lists your presets.
// If MultiMenu is already open, the second launch hands its arguments over
// (single-instance) instead of opening another copy.
const path = require('path');
const { app, shell } = require('electron');
const presets = require('./presets');
const accounts = require('./accounts');
const sessions = require('./sessions');
const bus = require('../bus');
const log = require('../logger').scope('shortcuts');

const safeName = (s) => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || 'MultiMenu';

function create(kind, id) {
  if (process.platform !== 'win32') throw new Error('Desktop shortcuts need Windows.');
  let name, arg;
  if (kind === 'preset') { const p = presets.get(id); if (!p) throw new Error('Preset not found'); name = `MultiMenu - ${p.name}`; arg = `--preset=${p.id}`; }
  else if (kind === 'account') { const a = accounts.find(id); if (!a) throw new Error('Account not found'); name = `MultiMenu - ${a.alias || a.username}`; arg = `--account=${a.id}`; }
  else throw new Error('Unknown shortcut type');
  const file = path.join(app.getPath('desktop'), `${safeName(name)}.lnk`);
  const ok = shell.writeShortcutLink(file, 'create', { target: process.execPath, args: arg, description: name, icon: process.execPath, iconIndex: 0 });
  if (!ok) throw new Error('Windows refused to create the shortcut.');
  log.info(`Created shortcut ${file}`);
  return file;
}

function updateJumpList() {
  if (process.platform !== 'win32') return;
  try {
    const tasks = presets.list().slice(0, 8).map(p => ({ program: process.execPath, arguments: `--preset=${p.id}`, title: `Start “${p.name}”`, description: `Launch the ${p.name} preset`, iconPath: process.execPath, iconIndex: 0 }));
    app.setUserTasks(tasks);
  } catch (e) { log.warn('jump list', e.message); }
}

/** Handles --preset= / --account= from the command line (first start or a second launch). */
function handleArgs(argv) {
  const get = (k) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const presetId = get('preset'), accountId = get('account');
  if (presetId && presets.get(presetId)) { presets.run(presetId).catch(e => bus.emit('notify', { level: 'error', title: 'Preset', message: e.message })); return true; }
  if (accountId && accounts.find(accountId)) { sessions.launch(accountId, null, {}); bus.emit('notify', { level: 'info', title: 'Launching from shortcut', message: accounts.find(accountId).username }); return true; }
  return false;
}

function init() { updateJumpList(); bus.on('presets:changed', updateJumpList); }

module.exports = { init, create, handleArgs, updateJumpList };
