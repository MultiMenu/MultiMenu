'use strict';
// Things that must be decided before Electron is ready:
//  - Diet mode: fewer, smaller Chromium processes for 8 GB PCs (needs a restart).
//  - Safe mode: start with every background feature off, so a bad setting or a
//    misbehaving feature can't stop MultiMenu from opening. Entered with
//    --safe-mode, from Settings ("Restart in safe mode"), or automatically when
//    the last two starts died within a minute.
const fs = require('fs');
const paths = require('./paths');

const MARKER = () => paths.file('startup.json');
const HEALTHY_MS = 60_000;

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function writeJson(file, v) { try { fs.mkdirSync(paths.dataDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(v)); } catch { /* read-only folder: ignore */ } }

/** Reads a few settings straight from disk (the settings module isn't loaded yet). */
function early() {
  const s = readJson(paths.file('settings.json')) || {};
  return { diet: !!s.performance?.dietMode };
}

/** Decides whether this start is in safe mode, and records the start for crash-loop detection. */
function decideSafeMode(argv = process.argv) {
  const m = readJson(MARKER()) || {};
  let reason = null;
  if (argv.includes('--safe-mode')) reason = 'flag';
  else if (m.safeNext) reason = 'requested';
  else if ((m.unfinished || 0) >= 2) reason = 'crashLoop';
  // `open` stays true until MultiMenu closes normally: still true here means the last run ended by
  // itself (a crash, or Windows ending it), even after hours, which `unfinished` can't tell.
  lastEndedBadly = !!m.open && reason !== 'flag';
  writeJson(MARKER(), { unfinished: reason === 'crashLoop' ? 0 : (m.unfinished || 0) + 1, safeNext: false, at: Date.now(), open: true });
  return reason;
}
let lastEndedBadly = false;
/** True when the previous run didn't close normally. */
function endedBadly() { return lastEndedBadly; }
/** A normal close (quit, or Windows shutting down). */
function markClosed() { const m = readJson(MARKER()) || {}; writeJson(MARKER(), { ...m, unfinished: 0, open: false }); }

/** After a minute of running (or a normal quit) the start counts as healthy. */
function markHealthy() { const m = readJson(MARKER()) || {}; writeJson(MARKER(), { ...m, unfinished: 0 }); }
function requestSafeNext(on = true) { const m = readJson(MARKER()) || {}; writeJson(MARKER(), { ...m, safeNext: !!on, unfinished: 0 }); }

/** Chromium switches for diet mode. Applied before app 'ready'. */
function applyDiet(app) {
  // Graphics acceleration stays on: software rendering costs more CPU than it saves
  // in memory, and some drivers misbehave without it.
  // Smaller JavaScript heap and V8's low-memory mode for MultiMenu's own pages.
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=192 --lite-mode --optimize-for-size');
  app.commandLine.appendSwitch('disk-cache-size', String(8 * 1024 * 1024));
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,BackForwardCache,CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('renderer-process-limit', '3');
}

/** Memory MultiMenu itself is using (all of its processes), in MB. */
function ownMemoryMB(app) {
  try {
    const kb = app.getAppMetrics().reduce((a, m) => a + (m.memory?.workingSetSize || 0), 0);
    return Math.round(kb / 1024);
  } catch { return null; }
}

module.exports = { early, decideSafeMode, endedBadly, markClosed, markHealthy, requestSafeNext, applyDiet, ownMemoryMB, HEALTHY_MS };
