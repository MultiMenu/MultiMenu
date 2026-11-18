'use strict';
// Which Roblox launcher to use: Roblox itself, or a bootstrapper such as
// Bloxstrap or Fishstrap (so their mods and settings apply to every client).
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const BOOTSTRAPPERS = {
  bloxstrap: { name: 'Bloxstrap', exe: 'Bloxstrap.exe', dir: 'Bloxstrap' },
  fishstrap: { name: 'Fishstrap', exe: 'Fishstrap.exe', dir: 'Fishstrap' },
};

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

function bootstrapperPath(id) {
  const b = BOOTSTRAPPERS[id];
  const local = process.env.LOCALAPPDATA;
  if (!b || !local) return null;
  const p = path.join(local, b.dir, b.exe);
  return exists(p) ? p : null;
}

function robloxPlayerPath() {
  const roots = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Roblox', 'Versions'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Roblox', 'Versions')].filter(Boolean);
  let best = null;
  for (const root of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { continue; }
    for (const d of dirs) {
      const exe = path.join(root, d.name, 'RobloxPlayerBeta.exe');
      try { const st = fs.statSync(exe); if (!best || st.mtimeMs > best.mtime) best = { exe, mtime: st.mtimeMs, version: d.name }; } catch { /* not here */ }
    }
  }
  return best;
}

/** Splits a registry command line into the program and its arguments. */
function parseCommand(cmd) {
  const parts = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(cmd || ''))) parts.push(m[1] ?? m[2]);
  return { exe: parts[0] || '', args: parts.slice(1) };
}

/** What Windows opens for roblox-player: links. */
function classifyHandler(cmd) {
  const exe = path.win32.basename(parseCommand(cmd).exe).toLowerCase();
  if (!exe) return null;
  if (exe === 'bloxstrap.exe') return 'bloxstrap';
  if (exe === 'fishstrap.exe') return 'fishstrap';
  if (/^roblox(playerbeta|playerlauncher)?\.exe$/.test(exe)) return 'roblox';
  return 'other';
}

function readHandler() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('');
    execFile('reg', ['query', 'HKCU\\Software\\Classes\\roblox-player\\shell\\open\\command', '/ve'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      if (err) return resolve('');
      const m = /REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(out || '');
      resolve(m ? m[1].trim() : '');
    });
  });
}

async function detect() {
  const handlerCmd = await readHandler();
  const player = robloxPlayerPath();
  return {
    roblox: { installed: !!player, version: player?.version || null },
    bloxstrap: { installed: !!bootstrapperPath('bloxstrap') },
    fishstrap: { installed: !!bootstrapperPath('fishstrap') },
    handler: classifyHandler(handlerCmd),
  };
}

/** Starts a roblox-player: launch URI through a bootstrapper. Uses the exact command the
 *  bootstrapper registered for itself when it is the current handler. */
async function launchVia(id, uri) {
  const exe = bootstrapperPath(id);
  if (!exe) throw new Error(`${BOOTSTRAPPERS[id]?.name || 'That launcher'} isn't installed. Pick another launcher in Settings → Accounts.`);
  const cmd = await readHandler();
  let args = ['-player', uri];
  if (classifyHandler(cmd) === id) {
    const reg = parseCommand(cmd).args;
    if (reg.some(a => a.includes('%1'))) args = reg.map(a => a.replace('%1', uri));
  }
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
  child.on('error', () => {});
  child.unref();
}

module.exports = { BOOTSTRAPPERS, detect, launchVia, parseCommand, classifyHandler, robloxPlayerPath, bootstrapperPath };
