'use strict';
// Lighter rendering for alts: Roblox reads Fast Flags from
// <version folder>\ClientSettings\ClientAppSettings.json once, as a client starts.
// Roblox only honours flags on its allowlist ("Allowlist for local client
// configuration via Fast Flags"), so only those are used. Before an alt launches,
// these flags are merged into your own file; once the client has started, your
// file is put back exactly as it was. A copy waits beside the file, so a crash
// or quit in between loses nothing (it is put back at the next start).
// Bloxstrap and Fishstrap copy their own file over this one at every launch, so
// with those, use their own Fast Flag editor instead.
// (Approach informed by RoALT, MIT licence; see NOTICE.md.)
const fs = require('fs');
const path = require('path');
const log = require('../logger').scope('rflags');

const MODES = ['FFlagDebugGraphicsPreferD3D11', 'FFlagDebugGraphicsPreferVulkan', 'FFlagDebugGraphicsPreferOpenGL'];
const SAVED = 'ClientAppSettings.json.multimenu-before';
const OPTIONS = {
  msaa: ['default', 'x1', 'x2', 'x4'],
  texture: ['default', 'lowest', 'low', 'medium', 'high'],
  mode: ['default', 'd3d11', 'vulkan', 'opengl'],
};

/** Pure: the allowlisted flags for the chosen options, as [name, value] strings like Bloxstrap writes them. */
function flagsOf(o = {}) {
  const f = [
    // Lowest detail for distant geometry: always part of lighter rendering.
    ['DFIntCSGLevelOfDetailSwitchingDistance', '0'], ['DFIntCSGLevelOfDetailSwitchingDistanceL12', '0'],
    ['DFIntCSGLevelOfDetailSwitchingDistanceL23', '0'], ['DFIntCSGLevelOfDetailSwitchingDistanceL34', '0'],
  ];
  const msaa = { x1: '1', x2: '2', x4: '4' }[o.msaa];
  if (msaa) f.push(['FIntDebugForceMSAASamples', msaa]);
  const tex = { lowest: '0', low: '1', medium: '2', high: '3' }[o.texture];
  if (tex) f.push(['DFFlagTextureQualityOverrideEnabled', 'True'], ['DFIntTextureQualityOverride', tex]);
  const mode = { d3d11: MODES[0], vulkan: MODES[1], opengl: MODES[2] }[o.mode];
  if (mode) f.push([mode, 'True']);
  if (o.graySky) f.push(['FFlagDebugSkyGray', 'True']);
  if (o.noGrass) f.push(['FIntFRMMinGrassDistance', '0'], ['FIntFRMMaxGrassDistance', '0']);
  if (o.lowestQuality) f.push(['DFIntDebugFRMQualityLevelOverride', '1']);
  if (o.pauseLighting) f.push(['DFFlagDebugPauseVoxelizer', 'True']);
  return f;
}

/** Pure: your file's text with `set` added (your other flags kept). null when the file isn't a JSON object. */
function merge(text, set) {
  let flags;
  const t = String(text ?? '').trim();
  if (!t) flags = {};
  else {
    try { flags = JSON.parse(t); } catch { return null; }
    if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return null;
  }
  for (const [k, v] of set) {
    // Only one rendering mode can be on.
    if (MODES.includes(k)) for (const m of MODES) delete flags[m];
    flags[k] = v;
  }
  return JSON.stringify(flags, null, 2);
}

function fileFor(exeDir) { return path.join(exeDir, 'ClientSettings', 'ClientAppSettings.json'); }

/** Puts back the copy kept beside `file`. False if it is still there (couldn't be put back). */
function putBackAt(file) {
  const saved = path.join(path.dirname(file), SAVED);
  let kept;
  try { kept = fs.readFileSync(saved); } catch { return true; }
  try {
    if (kept[0] === 0x31) fs.writeFileSync(file, kept.subarray(1));
    else fs.rmSync(file, { force: true });
    fs.rmSync(saved, { force: true });
    return true;
  } catch (e) { log.warn(`Couldn't put ${file} back: ${e.message}`); return false; }
}

/** Writes the flags next to the client in `exeDir`. Returns an undo function, or null when nothing was written. */
function apply(exeDir, set) {
  if (!exeDir || !set.length) return null;
  const file = fileFor(exeDir);
  if (!putBackAt(file)) return null; // a cut-short launch first, or its flags would pass for yours
  let before = null;
  try { before = fs.readFileSync(file); } catch (e) { if (e.code !== 'ENOENT') { log.warn(`Lighter rendering skipped: ${e.message}`); return null; } }
  const text = merge(before ? before.toString('utf8') : '', set);
  if (text == null) { log.warn('Lighter rendering skipped: your ClientAppSettings.json isn\'t a JSON object'); return null; }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(path.join(path.dirname(file), SAVED), before ? Buffer.concat([Buffer.from('1'), before]) : Buffer.from('0'));
    const tmp = `${file}.multimenu-tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    log.warn(`Lighter rendering not written: ${e.message}`);
    try { fs.rmSync(path.join(path.dirname(file), SAVED), { force: true }); } catch { /* ignore */ }
    return null;
  }
  let done = false;
  return () => { if (!done) { done = true; putBackAt(file); } };
}

/** At start and quit: put back anything a cut-short launch left in any Roblox version folder. */
function restoreAll() {
  const local = process.env.LOCALAPPDATA;
  if (!local) return 0;
  let n = 0;
  for (const root of ['Roblox', 'Bloxstrap', 'Fishstrap'].map(d => path.join(local, d, 'Versions'))) {
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { continue; }
    for (const d of dirs) {
      const file = fileFor(path.join(root, d.name));
      if (fs.existsSync(path.join(path.dirname(file), SAVED))) { if (putBackAt(file)) n++; }
    }
  }
  if (n) log.info(`Put back ${n} Fast Flag file(s) from a launch that was cut short`);
  return n;
}

module.exports = { flagsOf, merge, apply, putBackAt, restoreAll, fileFor, OPTIONS, MODES, SAVED };
