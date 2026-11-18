'use strict';
// Theme studio: preset looks, a second accent colour, glow and glass strength,
// and a custom background (gradient, plain, your own image or a short looping
// video). Themes can be saved to a .mmtheme file and shared.
const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const paths = require('../paths');
const bus = require('../bus');

const PRESETS = {
  midnight: { label: 'Midnight', accentHue: 270, particles: true, theme: { secondaryHue: 295, glow: 100, blur: 20, bgType: 'gradient', bgDim: 55 } },
  amethyst: { label: 'Amethyst', accentHue: 285, particles: true, theme: { secondaryHue: 325, glow: 120, blur: 24, bgType: 'gradient', bgDim: 55 } },
  neon: { label: 'Neon', accentHue: 300, particles: true, theme: { secondaryHue: 190, glow: 190, blur: 16, bgType: 'gradient', bgDim: 55 } },
  ember: { label: 'Ember', accentHue: 345, particles: true, theme: { secondaryHue: 25, glow: 110, blur: 20, bgType: 'gradient', bgDim: 55 } },
  ocean: { label: 'Ocean', accentHue: 220, particles: true, theme: { secondaryHue: 180, glow: 100, blur: 20, bgType: 'gradient', bgDim: 55 } },
  minimal: { label: 'Minimal', accentHue: 265, particles: false, theme: { secondaryHue: 265, glow: 0, blur: 0, bgType: 'solid', bgDim: 55 } },
};
const IMG = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const VID = { '.mp4': 'video/mp4', '.webm': 'video/webm' };
const MAX_IMG = 12 * 1024 * 1024, MAX_VID = 30 * 1024 * 1024;

const themeDir = () => path.join(paths.dataDir, 'theme');
const clamp = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);

function current() { return { accentHue: settings.get('appearance.accentHue'), particles: settings.get('appearance.particles'), theme: settings.get('appearance.theme') }; }

/** Validates a theme object from a file or the UI. Pure (exported for tests). */
function clean(t) {
  const th = t?.theme || {};
  return {
    accentHue: clamp(t?.accentHue, 0, 360, 270),
    particles: typeof t?.particles === 'boolean' ? t.particles : true,
    theme: {
      secondaryHue: clamp(th.secondaryHue, 0, 360, 295), glow: clamp(th.glow, 0, 200, 100), blur: clamp(th.blur, 0, 40, 20),
      bgType: ['gradient', 'solid', 'image', 'video'].includes(th.bgType) ? th.bgType : 'gradient', bgDim: clamp(th.bgDim, 0, 90, 55),
    },
  };
}

function apply(t, presetId = 'custom') {
  const c = clean(t);
  const keepFile = ['image', 'video'].includes(c.theme.bgType) ? settings.get('appearance.theme.bgFile') : '';
  if (['image', 'video'].includes(c.theme.bgType) && !keepFile) c.theme.bgType = 'gradient';
  settings.set('appearance.accentHue', c.accentHue);
  settings.set('appearance.particles', c.particles);
  settings.set('appearance.theme', { ...c.theme, preset: presetId, bgFile: keepFile });
  return current();
}

/** Puts a theme back exactly as it was, background picture included (the gallery's "Go back"). */
function restore(prev) {
  const c = clean(prev);
  const preset = PRESETS[prev?.theme?.preset] ? prev.theme.preset : 'custom';
  const file = String(prev?.theme?.bgFile || '');
  const ok = /^background\.(png|jpe?g|webp|gif|mp4|webm)$/i.test(file) && fs.existsSync(path.join(themeDir(), file));
  if (['image', 'video'].includes(c.theme.bgType) && !ok) c.theme.bgType = 'gradient';
  settings.set('appearance.accentHue', c.accentHue);
  settings.set('appearance.particles', c.particles);
  settings.set('appearance.theme', { ...c.theme, preset, bgFile: ok ? file : '' });
  bus.emit('theme:changed', current());
  return current();
}

function applyPreset(id) {
  const p = PRESETS[id];
  if (!p) throw new Error('Unknown theme');
  return apply(p, id);
}

function storeBackground(srcPath) {
  const ext = path.extname(srcPath).toLowerCase();
  const isVid = !!VID[ext];
  if (!IMG[ext] && !isVid) throw new Error('Use a PNG, JPG, WebP or GIF image, or an MP4/WebM video.');
  const size = fs.statSync(srcPath).size;
  if (size > (isVid ? MAX_VID : MAX_IMG)) throw new Error(isVid ? 'Videos must be under 30 MB — a short loop works best.' : 'Images must be under 12 MB.');
  fs.mkdirSync(themeDir(), { recursive: true });
  for (const f of fs.readdirSync(themeDir())) if (f.startsWith('background.')) fs.rmSync(path.join(themeDir(), f), { force: true });
  const name = `background${ext}`;
  fs.copyFileSync(srcPath, path.join(themeDir(), name));
  settings.set('appearance.theme', { ...settings.get('appearance.theme'), bgType: isVid ? 'video' : 'image', bgFile: name, preset: 'custom' });
  return current();
}

/** The custom background as base64 so the sandboxed page can turn it into a blob: URL. */
function background() {
  const t = settings.get('appearance.theme');
  if (!['image', 'video'].includes(t.bgType) || !t.bgFile || /[\\/]/.test(t.bgFile)) return null;
  const file = path.join(themeDir(), t.bgFile);
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(file).toLowerCase();
  return { kind: VID[ext] ? 'video' : 'image', mime: VID[ext] || IMG[ext], base64: fs.readFileSync(file).toString('base64') };
}

// ---------- Wallpaper Engine (3.1.1) ----------
// Lists the video wallpapers you already have in Wallpaper Engine (Steam Workshop items and
// your own projects) so one can be the background. Scene and web wallpapers can't play
// outside Wallpaper Engine, so only video ones are listed. Nothing is downloaded.
const WE_APP = '431960';

/** Steam library folders: the default install plus those listed in libraryfolders.vdf. */
function steamLibraries(env = process.env, fsx = fs) {
  const roots = [env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Steam'), env.ProgramFiles && path.join(env.ProgramFiles, 'Steam')].filter(Boolean);
  const out = new Set();
  for (const r of roots) {
    if (!fsx.existsSync(path.join(r, 'steamapps'))) continue;
    out.add(r);
    try {
      const vdf = fsx.readFileSync(path.join(r, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) out.add(m[1].replace(/\\\\/g, '\\'));
    } catch { /* no list */ }
  }
  return [...out];
}

/** Pure: a wallpaper from its project.json, or null if it isn't a video one. */
function weProject(json, dir) {
  if (!json || String(json.type || '').toLowerCase() !== 'video' || typeof json.file !== 'string') return null;
  const file = path.join(dir, path.basename(json.file));
  if (!VID[path.extname(file).toLowerCase()]) return null;
  return { title: String(json.title || path.basename(dir)).slice(0, 120), file, preview: typeof json.preview === 'string' ? path.join(dir, path.basename(json.preview)) : null };
}

let weCache = null;
function wallpaperEngine(fsx = fs) {
  const list = [];
  for (const lib of steamLibraries(process.env, fsx)) {
    const dirs = [path.join(lib, 'steamapps', 'workshop', 'content', WE_APP), path.join(lib, 'steamapps', 'common', 'wallpaper_engine', 'projects', 'myprojects')];
    for (const base of dirs) {
      let items = [];
      try { items = fsx.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { continue; }
      for (const d of items.slice(0, 2000)) {
        const dir = path.join(base, d.name);
        let w = null;
        try { w = weProject(JSON.parse(fsx.readFileSync(path.join(dir, 'project.json'), 'utf8')), dir); } catch { continue; }
        if (!w) continue;
        let size = 0;
        try { size = fsx.statSync(w.file).size; } catch { continue; }
        let preview = null;
        try {
          const ext = path.extname(w.preview || '').toLowerCase();
          if (w.preview && IMG[ext] && fsx.statSync(w.preview).size < 1_500_000) preview = `data:${IMG[ext]};base64,${fsx.readFileSync(w.preview).toString('base64')}`;
        } catch { /* no preview */ }
        list.push({ id: String(list.length), title: w.title, file: w.file, sizeMB: Math.round(size / 1048576), fits: size <= MAX_VID, preview });
      }
    }
  }
  weCache = list;
  // The page gets names, sizes and previews, never paths.
  return list.map(({ file, ...rest }) => rest);
}

/** Uses the wallpaper the page picked (by its place in the last list, never a path from the page). */
function useWallpaper(id) {
  const w = (weCache || []).find(x => x.id === String(id));
  if (!w) throw new Error('That wallpaper isn\'t in the list any more. Open the list again.');
  if (!w.fits) throw new Error('Videos must be under 30 MB — a short loop works best.');
  return storeBackground(w.file);
}

function clearBackground() {
  fs.rmSync(themeDir(), { recursive: true, force: true });
  settings.set('appearance.theme', { ...settings.get('appearance.theme'), bgType: 'gradient', bgFile: '' });
  return current();
}

function exportText() {
  const c = current();
  const out = { format: 'multimenu-theme', version: 1, name: c.theme.preset === 'custom' ? 'My theme' : (PRESETS[c.theme.preset]?.label || 'Theme'), ...clean(c) };
  const bg = c.theme.bgType === 'image' ? background() : null;
  if (bg && bg.base64.length < 8 * 1024 * 1024) out.background = { mime: bg.mime, base64: bg.base64 };
  else if (['image', 'video'].includes(out.theme.bgType)) out.theme.bgType = 'gradient';
  return JSON.stringify(out, null, 2);
}

function importText(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('That file is not a MultiMenu theme.'); }
  if (j?.format !== 'multimenu-theme') throw new Error('That file is not a MultiMenu theme.');
  const c = clean(j);
  if (j.background && typeof j.background.base64 === 'string') {
    const ext = Object.entries(IMG).find(([, m]) => m === j.background.mime)?.[0];
    if (ext) {
      const buf = Buffer.from(j.background.base64, 'base64');
      if (buf.length <= MAX_IMG) {
        fs.mkdirSync(themeDir(), { recursive: true });
        for (const f of fs.readdirSync(themeDir())) if (f.startsWith('background.')) fs.rmSync(path.join(themeDir(), f), { force: true });
        fs.writeFileSync(path.join(themeDir(), `background${ext}`), buf);
        settings.set('appearance.theme', { ...settings.get('appearance.theme'), bgFile: `background${ext}` });
        c.theme.bgType = 'image';
      }
    }
  } else if (['image', 'video'].includes(c.theme.bgType)) c.theme.bgType = 'gradient';
  const out = apply(c, 'custom');
  bus.emit('theme:changed', out);
  return out;
}

module.exports = { PRESETS, current, clean, apply, restore, applyPreset, storeBackground, background, clearBackground, steamLibraries, weProject, wallpaperEngine, useWallpaper, exportText, importText, MAX_IMG, MAX_VID };
