'use strict';
// Resolves where MultiMenu keeps its data.
// Installed build -> %APPDATA%\MultiMenu
// Portable build  -> <folder containing MultiMenu.exe>\MultiMenu-Data
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const exeDir = path.dirname(process.execPath);

function detectPortable() {
  if (process.env.MULTIMENU_PORTABLE === '1') return true;
  if (process.env.MULTIMENU_PORTABLE === '0') return false;
  if (!app.isPackaged) return false;
  // electron-builder's NSIS installer always places this uninstaller next to the exe.
  return !fs.existsSync(path.join(exeDir, 'Uninstall MultiMenu.exe'));
}

const isPortable = detectPortable();
const dataDir = isPortable ? path.join(exeDir, 'MultiMenu-Data') : app.getPath('userData');

function ensureDirs() {
  for (const d of [dataDir, logsDir(), macrosDir(), updatesDir(), backupsDir()]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
function logsDir() { return path.join(dataDir, 'logs'); }
function macrosDir() { return path.join(dataDir, 'macros'); }
function updatesDir() { return path.join(dataDir, 'updates'); }
function backupsDir() { return path.join(dataDir, 'backups'); }
function file(name) { return path.join(dataDir, name); }

module.exports = { isPortable, dataDir, exeDir, ensureDirs, logsDir, macrosDir, updatesDir, backupsDir, file };
