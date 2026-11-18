'use strict';
// FPS Centre.
//  * FPS cap and graphics quality: edits Roblox's own settings file
//    (%LOCALAPPDATA%\Roblox\GlobalBasicSettings_*.xml), the same values the
//    in-game Settings menu writes. A backup is made before every change.
//  * FPS monitoring: Roblox does not expose its frame rate to other programs.
//    Real measurement needs PresentMon (Intel's free, open-source frame-timing
//    tool). If the user points MultiMenu at PresentMon, we run it and read its
//    per-frame output. Without it, FPS shows as unavailable rather than faked.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const settings = require('./settings');
const processes = require('./processes');
const paths = require('../paths');
const bus = require('../bus');
const log = require('../logger').scope('fps');

const FPS_CAPS = [30, 60, 75, 120, 144, 165, 240, -1];

function settingsFile() {
  const dir = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Roblox') : null;
  if (!dir) return null;
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /^GlobalBasicSettings_\d+\.xml$/i.test(f)); } catch { return null; }
  files.sort((a, b) => parseInt(b.match(/\d+/)[0], 10) - parseInt(a.match(/\d+/)[0], 10));
  return files.length ? path.join(dir, files[0]) : null;
}

const RX = {
  fpsCap: /(<int name="FramerateCap">)(-?\d+)(<\/int>)/,
  savedQuality: /(<token name="SavedQualityLevel">)(\d+)(<\/token>)/,
  qualityLevel: /(<int name="GraphicsQualityLevel">)(\d+)(<\/int>)/,
  reducedMotion: /(<bool name="ReducedMotion">)(true|false)(<\/bool>)/,
};
/** The client takes any cap, not only the menu's: 5–360, or -1 for no cap. */
const validCap = (v) => v === -1 || (Number.isInteger(v) && v >= 5 && v <= 360);

function readGraphics() {
  const file = settingsFile();
  if (!file) return { available: false, message: 'Roblox settings file not found. Open Roblox once so it creates it.' };
  const xml = fs.readFileSync(file, 'utf8');
  const fc = xml.match(RX.fpsCap), sq = xml.match(RX.savedQuality);
  return {
    available: true, file,
    fpsCap: fc ? parseInt(fc[2], 10) : null,
    quality: sq ? parseInt(sq[2], 10) : null, // 0 = Automatic, 1..10 manual
    robloxRunning: processes.robloxProcesses().length > 0,
  };
}

/** patch: { fpsCap?: number, quality?: 0..10 } */
function writeGraphics(patch) {
  const file = settingsFile();
  if (!file) throw new Error('Roblox settings file not found. Open Roblox once so it creates it.');
  let xml = fs.readFileSync(file, 'utf8');
  const original = xml;
  if (patch.fpsCap !== undefined) {
    const v = Number(patch.fpsCap);
    if (!validCap(v)) throw new Error('The FPS cap must be 5–360, or unlimited.');
    if (RX.fpsCap.test(xml)) xml = xml.replace(RX.fpsCap, `$1${v}$3`);
    else if (/<Properties>/.test(xml)) xml = xml.replace('<Properties>', `<Properties>\n\t\t\t<int name="FramerateCap">${v}</int>`);
    else throw new Error('Unexpected settings file format; nothing was changed.');
  }
  if (patch.quality !== undefined) {
    const q = Number(patch.quality);
    if (!(Number.isInteger(q) && q >= 0 && q <= 10)) throw new Error('Quality must be 0 (Automatic) to 10.');
    if (!RX.savedQuality.test(xml)) throw new Error('Graphics quality setting not found. Change graphics once in Roblox\'s own settings first.');
    xml = xml.replace(RX.savedQuality, `$1${q}$3`);
    // Lowest graphics: the engine's own level (1–21) goes to its lowest too.
    if (q === 1 && RX.qualityLevel.test(xml)) xml = xml.replace(RX.qualityLevel, (_, a, _v, c) => `${a}1${c}`);
  }
  // Roblox's own "Reduce motion" setting (fewer camera and interface animations). Only
  // changed when the file has it; an older settings file just doesn't get it.
  if (patch.reducedMotion !== undefined && RX.reducedMotion.test(xml)) xml = xml.replace(RX.reducedMotion, (_, a, _v, c) => `${a}${patch.reducedMotion ? 'true' : 'false'}${c}`);
  if (xml === original) return readGraphics();
  const backup = path.join(paths.backupsDir(), `${path.basename(file)}.${Date.now()}.bak`);
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, xml);
  log.info('Updated Roblox graphics settings', patch);
  const res = readGraphics();
  res.note = res.robloxRunning ? 'Saved. Roblox is open: restart the Roblox clients for this to apply (a client that is closed afterwards may overwrite it with its own settings).' : 'Saved. Applies the next time Roblox starts.';
  return res;
}

// ---------- PresentMon ----------
let pm = { proc: null, status: 'off', message: 'Set the PresentMon path to enable FPS monitoring.', fps: {} };
let frames = new Map();
let fpsTimer = null;

function presentMonStatus() { return { status: pm.status, message: pm.message, fps: pm.fps, path: settings.get('fps.presentMonPath') }; }

function startPresentMon() {
  stopPresentMon();
  const exe = settings.get('fps.presentMonPath');
  if (!exe || !fs.existsSync(exe) || !/\.exe$/i.test(exe)) {
    pm.status = 'off'; pm.message = 'PresentMon not found. Download it from github.com/GameTechDev/PresentMon and pick the .exe.';
    return presentMonStatus();
  }
  const args = ['--output_stdout', '--process_name', processes.ROBLOX_EXE, '--stop_existing_session', '--session_name', 'MultiMenuFPS'];
  const p = spawn(exe, args, { windowsHide: true });
  pm = { proc: p, status: 'starting', message: 'Starting PresentMon…', fps: {} };
  frames = new Map();
  let header = null, idxPid = -1, idxMs = -1, buf = '', errText = '';
  p.stdout.on('data', d => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/); buf = lines.pop();
    for (const line of lines) {
      if (!line) continue;
      const cols = line.split(',');
      if (!header) {
        if (!cols.includes('ProcessID')) continue;
        header = cols; idxPid = cols.indexOf('ProcessID');
        idxMs = ['MsBetweenPresents', 'FrameTime', 'MsBetweenDisplayChange'].map(c => cols.indexOf(c)).find(i => i >= 0) ?? -1;
        if (idxMs < 0) { pm.status = 'error'; pm.message = 'This PresentMon version\'s output format is not recognised.'; }
        else { pm.status = 'ok'; pm.message = 'Measuring frame rate of Roblox clients.'; }
        continue;
      }
      if (idxMs < 0) continue;
      const pid = parseInt(cols[idxPid], 10), ms = parseFloat(cols[idxMs]);
      if (!pid || !(ms > 0)) continue;
      const f = frames.get(pid) || []; f.push(ms); frames.set(pid, f);
    }
  });
  p.stderr.on('data', d => { errText += d.toString(); });
  p.on('exit', code => {
    if (pm.proc !== p) return;
    pm.proc = null; pm.status = 'error';
    pm.message = /access|privilege|administrator|elevat/i.test(errText) || code === 5
      ? 'PresentMon needs to run as administrator (or your user must be in the "Performance Log Users" group).'
      : `PresentMon stopped (code ${code}). ${errText.split('\n')[0] || ''}`.trim();
    bus.emit('fps:update', presentMonStatus());
  });
  p.on('error', e => { pm.status = 'error'; pm.message = `Could not start PresentMon: ${e.message}`; });
  fpsTimer = setInterval(() => {
    const out = {};
    for (const [pid, f] of frames) {
      if (!f.length) continue;
      const avgMs = f.reduce((a, b) => a + b, 0) / f.length;
      out[pid] = { fps: Math.round(1000 / avgMs), frameMs: +avgMs.toFixed(2), low1: Math.round(1000 / percentile(f, 0.99)) };
    }
    frames = new Map();
    pm.fps = out;
    bus.emit('fps:update', presentMonStatus());
  }, 1000);
  return presentMonStatus();
}

function percentile(arr, p) { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

function stopPresentMon() {
  clearInterval(fpsTimer); fpsTimer = null;
  if (pm.proc) { const pr = pm.proc; pm.proc = null; try { pr.kill(); } catch { /* gone */ } }
  pm = { proc: null, status: 'off', message: 'FPS monitoring is stopped.', fps: {} };
  return presentMonStatus();
}

// ---------- Profiles ----------
const PROFILES = {
  balanced: { label: 'Balanced', quality: 0, fpsCap: 60, trimmer: false, lowResource: false },
  maxfps: { label: 'Max FPS', quality: 1, fpsCap: -1, trimmer: true, lowResource: false },
  multi: { label: 'Many clients', quality: 1, fpsCap: 30, trimmer: true, lowResource: true },
  quality: { label: 'Best quality', quality: 10, fpsCap: 144, trimmer: false, lowResource: false },
};

// ---------- per-launch graphics, then your own settings back ----------
// Roblox reads its settings file once, when a client starts. For an account
// with its own launch graphics we save your file, write that account's
// values, and put your file back ~25s later (and again whenever such a client
// closes, because Roblox saves its settings on exit). A copy is kept on disk
// so it can still be put back if MultiMenu was closed in between.
let userOriginal = null;
let restoreTimer = null;
const originalCopy = () => path.join(paths.dataDir, 'roblox-settings-original.xml');

function applyForLaunch(g) {
  const file = settingsFile();
  if (!file) throw new Error('Roblox settings file not found. Open Roblox once so it creates it.');
  if (settings.get('openMulti.restoreGraphics') !== false && userOriginal == null) {
    userOriginal = fs.readFileSync(file, 'utf8');
    try { fs.writeFileSync(originalCopy(), userOriginal); } catch { /* best effort */ }
  }
  clearTimeout(restoreTimer);
  const r = writeGraphics(g);
  if (userOriginal != null) restoreTimer = setTimeout(() => restoreUser(false), 25_000);
  return r;
}

/** Puts your own Roblox settings back. final=true forgets the saved copy. */
function restoreUser(final = false) {
  clearTimeout(restoreTimer);
  if (userOriginal == null) return false;
  const file = settingsFile();
  if (file) { try { fs.writeFileSync(file, userOriginal); } catch (e) { log.warn('Could not restore Roblox settings', e.message); return false; } }
  if (final) { userOriginal = null; fs.rmSync(originalCopy(), { force: true }); log.info('Restored your own Roblox graphics settings'); }
  return true;
}

/** Your own client closed and saved new settings: keep those as "yours". */
function adoptCurrentAsUser() {
  if (userOriginal == null) return;
  const file = settingsFile();
  try { if (file) { userOriginal = fs.readFileSync(file, 'utf8'); fs.writeFileSync(originalCopy(), userOriginal); } } catch { /* ignore */ }
}

function holdingUserSettings() { return userOriginal != null; }

/** At start-up: put back a copy left over from last time (only with Roblox closed). */
function recoverOnStart() {
  try {
    if (!fs.existsSync(originalCopy())) return;
    if (processes.robloxProcesses().length) { userOriginal = fs.readFileSync(originalCopy(), 'utf8'); return; }
    const file = settingsFile();
    if (file) fs.writeFileSync(file, fs.readFileSync(originalCopy(), 'utf8'));
    fs.rmSync(originalCopy(), { force: true });
    log.info('Put back your Roblox graphics settings from the last session');
  } catch (e) { log.warn('recoverOnStart', e.message); }
}

module.exports = { validCap, applyForLaunch, restoreUser, adoptCurrentAsUser, holdingUserSettings, recoverOnStart, FPS_CAPS, PROFILES, readGraphics, writeGraphics, startPresentMon, stopPresentMon, presentMonStatus, settingsFile };
