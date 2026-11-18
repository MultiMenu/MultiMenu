'use strict';
// Roblox update guard. When Roblox has a new version, launching many alts at
// once makes every one of them download it. Instead the first launch updates
// Roblox and the rest of the queue waits until the new version is installed.
//
// Holding updates (3.1.1): Roblox's installer closes every open client when it
// updates, which kicks alts that were farming for hours. While updates are held
// (always, or only while a client is open), MultiMenu starts the Roblox version
// that is already installed, skipping the updater, and ends the Roblox installer
// if anything else starts it. "Update Roblox now" lets one update through.
const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const bus = require('../bus');
const log = require('../logger').scope('updateguard');

let latest = null; // { version, at }
let letThroughUntil = 0; // "Update Roblox now" lets the installer run until then
let holdTimer = null, lastStopNotice = 0;
const INSTALLERS = ['robloxplayerinstaller.exe', 'robloxplayerlauncher.exe'];
let state = { phase: 'idle', since: null, version: null }; // idle | updating | done | timeout

/** Folders Roblox (or a bootstrapper) installs versions into. */
function versionRoots(env = process.env) {
  const local = env.LOCALAPPDATA, pf = env['ProgramFiles(x86)'];
  return [local && path.join(local, 'Roblox', 'Versions'), local && path.join(local, 'Bloxstrap', 'Versions'), local && path.join(local, 'Fishstrap', 'Versions'), pf && path.join(pf, 'Roblox', 'Versions')].filter(Boolean);
}

/** version-xxxx folders that contain a player. */
function installedVersions(roots = versionRoots(), fsx = fs) {
  const out = new Set();
  for (const root of roots) {
    let dirs = [];
    try { dirs = fsx.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { continue; }
    for (const d of dirs) {
      if (!/^version-[0-9a-f]{6,}$/i.test(d.name)) continue;
      try { if (fsx.statSync(path.join(root, d.name, 'RobloxPlayerBeta.exe')).isFile()) out.add(d.name.toLowerCase()); } catch { /* no player here */ }
    }
  }
  return [...out];
}

/** True when the latest version is installed, null when we can't tell (pure, unit-tested). */
function isUpToDate(latestVersion, installed) {
  if (!latestVersion || !/^version-[0-9a-f]+$/i.test(latestVersion)) return null;
  if (!installed.length) return null; // nothing found where we look: don't hold launches back
  return installed.includes(latestVersion.toLowerCase());
}

async function latestVersion() {
  if (latest && Date.now() - latest.at < 5 * 60_000) return latest.version;
  try {
    const res = await fetch('https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const v = String(j.clientVersionUpload || '').toLowerCase();
    if (!/^version-[0-9a-f]+$/.test(v)) throw new Error('unexpected answer');
    latest = { version: v, at: Date.now() };
    return v;
  } catch (e) { log.warn(`Latest Roblox version unknown: ${e.message}`); return latest?.version || null; }
}

async function check() {
  const v = await latestVersion();
  const installed = installedVersions();
  return { latest: v, installed, upToDate: isUpToDate(v, installed), state: { ...state }, config: settings.get('updateGuard'), holding: holding(), updatingNow: Date.now() < letThroughUntil };
}

/** Pure: are updates held right now? mode off | whileOpen | always. */
function isHolding(mode, clientsOpen, now = Date.now(), until = 0) {
  if (now < until) return false;
  return mode === 'always' || (mode === 'whileOpen' && clientsOpen > 0);
}
function holding() {
  const mode = settings.get('updateGuard.hold');
  if (mode !== 'always' && mode !== 'whileOpen') return false;
  let open = 0;
  try { open = require('./processes').robloxProcesses().length; } catch { /* unknown */ }
  return isHolding(mode, open, Date.now(), letThroughUntil);
}

/** While updates are held, ends Roblox's installer before it can close the open clients. */
function watchInstallers() {
  if (!holding()) return;
  let procs = [];
  try { procs = require('./processes').snapshot(800).filter(p => INSTALLERS.includes(String(p.name).toLowerCase())); } catch { return; }
  for (const p of procs) {
    let ok = false;
    try { ok = require('../native/win32').terminate(p.pid); } catch { /* no access */ }
    log.info(`Roblox update held: ${p.name} (${p.pid}) ${ok ? 'stopped' : 'could not be stopped'}`);
    if (ok && Date.now() - lastStopNotice > 10 * 60_000) {
      lastStopNotice = Date.now();
      bus.emit('event', { type: 'robloxUpdateHeld', detail: 'Stopped a Roblox update so your open clients stay in game. Update when you\'re ready: Sessions & Tiling → Roblox updates → Update Roblox now.' });
    }
  }
}

function applyHold() {
  clearInterval(holdTimer); holdTimer = null;
  const mode = settings.get('updateGuard.hold');
  if (process.platform === 'win32' && (mode === 'always' || mode === 'whileOpen')) holdTimer = setInterval(watchInstallers, 1000);
  bus.emit('updateguard:update', { ...state });
}

/** Lets one Roblox update through: opens Roblox the normal way so its installer runs.
 *  That closes the clients that are open (the UI asks first). */
async function updateNow() {
  letThroughUntil = Date.now() + 15 * 60_000;
  const uri = 'roblox-player:1+launchmode:app';
  const method = settings.get('openMulti.launchMethod');
  if (method === 'bloxstrap' || method === 'fishstrap') await require('./launchers').launchVia(method, uri);
  else await require('electron').shell.openExternal(uri);
  log.info('Roblox update let through for 15 minutes');
  bus.emit('updateguard:update', { ...state });
  return check();
}

/**
 * Called by the launch queue before each launch. Resolves when this launch may go ahead.
 * The first launch that finds Roblox out of date updates it; the ones after it wait.
 */
async function gate({ queued, onWait, stop = () => false }) {
  const cfg = settings.get('updateGuard');
  // Held: start the installed version directly, never through the updater.
  if (holding()) return { forceProtocol: false, direct: true };
  if (!cfg.enabled) return { forceProtocol: false };
  if (state.phase === 'updating') return waitForUpdate(cfg, onWait, stop);
  // A single alt updating Roblox by itself is fine; and with no Roblox found there's nothing to guard.
  if (queued < 2) return { forceProtocol: false };
  const installed = installedVersions();
  if (!installed.length) return { forceProtocol: false };
  const v = await latestVersion();
  if (isUpToDate(v, installed) !== false) return { forceProtocol: false };
  state = { phase: 'updating', since: Date.now(), version: v };
  bus.emit('event', { type: 'robloxUpdate', detail: `Roblox ${v} is out. The first alt updates Roblox; the others wait until it's installed.` });
  bus.emit('updateguard:update', { ...state });
  // A direct launch would start the old version: go through Roblox's launcher this once.
  return { forceProtocol: true };
}

async function waitForUpdate(cfg, onWait, stop) {
  const until = (state.since || Date.now()) + cfg.maxWaitSec * 1000;
  onWait?.();
  while (Date.now() < until && !stop()) {
    if (installedVersions().includes(String(state.version))) {
      log.info(`Roblox ${state.version} is installed: launches continue.`);
      state = { phase: 'done', since: Date.now(), version: state.version };
      bus.emit('updateguard:update', { ...state });
      return { forceProtocol: false, waited: true };
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!stop()) {
    log.warn('Roblox update took too long: launches continue anyway.');
    state = { phase: 'timeout', since: Date.now(), version: state.version };
    bus.emit('updateguard:update', { ...state });
  }
  return { forceProtocol: false, waited: true };
}

function reset() { state = { phase: 'idle', since: null, version: null }; }
function init() { applyHold(); }
function stop() { clearInterval(holdTimer); holdTimer = null; }

module.exports = { init, stop, applyHold, check, gate, reset, holding, isHolding, updateNow, isUpToDate, installedVersions, versionRoots, latestVersion, INSTALLERS };
