'use strict';
// OpenMulti window tiling. Arranges Roblox client windows on a chosen monitor
// using a layout, remembers where each window was so it can be put back, and
// can auto-tile whenever a new client starts.
const win32 = require('../native/win32');
const settings = require('./settings');
const sessions = require('./sessions');
const processes = require('./processes');
const bus = require('../bus');
const tinykeep = require('./tinykeep');
const log = require('../logger').scope('tiler');

const LAYOUTS = {
  auto: 'Smart grid', columns: 'Side by side', rows: 'Stacked', grid2: '2 × 2', grid3: '3 × 3', grid4: '4 × 4',
  main: 'Main + side', cascade: 'Cascade', fixed: 'Fixed size', tiny: 'Tiny windows',
};

/** Same-size cells left to right, top to bottom; once the screen is full the next ones start
 *  over at the top, a little offset so every window still shows (pure). */
function cellGrid(n, a, w, h, gap) {
  const cols = Math.max(1, Math.floor((a.width + gap) / (w + gap)));
  const rows = Math.max(1, Math.floor((a.height + gap) / (h + gap)));
  return Array.from({ length: n }, (_, i) => {
    const slot = i % (cols * rows), wrap = Math.floor(i / (cols * rows));
    return { x: a.x + (slot % cols) * (w + gap) + wrap * 28, y: a.y + Math.floor(slot / cols) * (h + gap) + wrap * 28, width: w, height: h };
  });
}

// ---------- pure layout maths (unit-tested) ----------
function gridRects(n, cols, rows, area, gap, centerLastRow) {
  const cw = (area.width - gap * (cols - 1)) / cols;
  const ch = (area.height - gap * (rows - 1)) / rows;
  const out = [];
  for (let i = 0; i < n; i++) {
    const slot = i % (cols * rows);
    const wrap = Math.floor(i / (cols * rows)); // overflow beyond capacity is offset, not lost
    const r = Math.floor(slot / cols), c = slot % cols;
    let x = area.x + c * (cw + gap);
    const itemsInRow = Math.min(cols, n - r * cols - wrap * cols * rows);
    if (centerLastRow && wrap === 0 && itemsInRow < cols && itemsInRow > 0 && r === Math.ceil(Math.min(n, cols * rows) / cols) - 1) {
      x += ((cols - itemsInRow) * (cw + gap)) / 2;
    }
    out.push({ x: x + wrap * 28, y: area.y + r * (ch + gap) + wrap * 28, width: cw, height: ch });
  }
  return out;
}

/** Picks columns/rows so each cell is as close to 16:9 as possible with little empty space. */
function bestGrid(n, area) {
  let best = { cols: 1, rows: n, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const aspect = (area.width / cols) / (area.height / rows);
    const empty = cols * rows - n;
    const score = Math.abs(Math.log(aspect / (16 / 9))) + empty * 0.25 - cols * 0.001; // ties -> side by side
    if (score < best.score) best = { cols, rows, score };
  }
  return best;
}

/**
 * @param layout one of LAYOUTS
 * @param n number of windows
 * @param area work area {x,y,width,height}
 * @param o { gap, padding, mainRatio, cellWidth, cellHeight, centerLastRow }
 */
function computeLayout(layout, n, area, o = {}) {
  if (n <= 0) return [];
  const gap = Math.max(0, o.gap ?? 4), pad = Math.max(0, o.padding ?? 0);
  const a = { x: area.x + pad, y: area.y + pad, width: Math.max(100, area.width - pad * 2), height: Math.max(100, area.height - pad * 2) };
  const center = o.centerLastRow !== false;
  switch (layout) {
    case 'columns': return gridRects(n, n, 1, a, gap, false);
    case 'rows': return gridRects(n, 1, n, a, gap, false);
    case 'grid2': return gridRects(n, 2, 2, a, gap, center);
    case 'grid3': return gridRects(n, 3, 3, a, gap, center);
    case 'grid4': return gridRects(n, 4, 4, a, gap, center);
    case 'main': {
      if (n === 1) return [{ ...a }];
      const ratio = Math.min(0.85, Math.max(0.3, o.mainRatio ?? 0.62));
      const mw = (a.width - gap) * ratio;
      const side = { x: a.x + mw + gap, y: a.y, width: a.width - mw - gap, height: a.height };
      return [{ x: a.x, y: a.y, width: mw, height: a.height }, ...gridRects(n - 1, 1, n - 1, side, gap, false)];
    }
    case 'cascade': {
      const step = 34;
      const w = Math.max(400, a.width * 0.62), h = Math.max(300, a.height * 0.62);
      const fit = Math.max(1, Math.floor(Math.min((a.width - w) / step, (a.height - h) / step)) + 1);
      return Array.from({ length: n }, (_, i) => ({ x: a.x + (i % fit) * step, y: a.y + (i % fit) * step, width: w, height: h }));
    }
    case 'fixed': {
      // Any size: windows smaller than Roblox allows are made so the RoALT way (see placeOne).
      const w = Math.min(a.width, Math.max(16, o.cellWidth || 800)), h = Math.min(a.height, Math.max(16, o.cellHeight || 600));
      return cellGrid(n, a, w, h, gap);
    }
    case 'tiny': {
      // Cells sized so each window's game picture is the tiny size (o.tinyCell, from tinyCell()).
      const c = o.tinyCell || { width: 256, height: 219 };
      return cellGrid(n, a, Math.min(a.width, Math.max(16, c.width)), Math.min(a.height, Math.max(16, c.height)), gap);
    }
    case 'custom': {
      // Zones you drew (customlayouts.js), as fractions of the work area.
      const zones = o.customZones && o.customZones.length ? o.customZones : [{ x: 0, y: 0, w: 1, h: 1 }];
      return require('./customlayouts').rects(zones, n, a, gap);
    }
    case 'auto':
    default: {
      const g = bestGrid(n, a);
      return gridRects(n, g.cols, g.rows, a, gap, center);
    }
  }
}

// ---------- displays ----------
function electronScreen() { return require('electron').screen; }

function listDisplays() {
  const scr = electronScreen();
  const primary = scr.getPrimaryDisplay().id;
  return scr.getAllDisplays().map((d, i) => ({
    id: String(d.id), label: `Monitor ${i + 1}${d.id === primary ? ' (main)' : ''} — ${Math.round(d.size.width * d.scaleFactor)}×${Math.round(d.size.height * d.scaleFactor)}`,
    primary: d.id === primary, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor,
  }));
}

function targetDisplay() {
  const want = settings.get('tiling.display');
  const all = listDisplays();
  return all.find(d => d.id === want) || all.find(d => d.primary) || all[0];
}

/** How many windows go on each monitor, in proportion to its usable area (largest remainder, pure). */
function splitCounts(n, areas) {
  if (!areas.length) return [];
  const total = areas.reduce((s, a) => s + a, 0) || 1;
  const exact = areas.map(a => (n * a) / total);
  const out = exact.map(Math.floor);
  let left = n - out.reduce((s, x) => s + x, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i]).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out;
}

/** 'All monitors': every monitor, left to right. Null when that isn't chosen or there is only one. */
function spreadDisplays() {
  if (settings.get('tiling.display') !== 'all') return null;
  const all = listDisplays();
  if (all.length < 2) return null;
  return all.slice().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
}

/** Rects for a list spread over several monitors (global screen DIPs). */
function spreadRects(disps, list, layout) {
  const counts = splitCounts(list.length, disps.map(d => d.workArea.width * d.workArea.height));
  const rects = [];
  let i = 0, client = null;
  disps.forEach((d, k) => {
    const slice = list.slice(i, i + counts[k]);
    i += counts[k];
    if (!slice.length) return;
    const o = layoutOptions(d, slice, layout);
    if (layout === 'tiny') client = o.tinyCell.client;
    rects.push(...computeLayout(kind(layout), slice.length, d.workArea, o));
  });
  return { rects, client };
}

// ---------- targets ----------
let order = []; // session ids in the user's chosen order
const saved = new Map(); // hwndKey -> original outer rect
const topmost = new Set();

function targets() {
  const includeExternal = settings.get('tiling.includeExternal');
  const list = sessions.listSessions().filter(s => s.status === 'running' && s.pid && (includeExternal || !s.external));
  list.sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
    return a.startedAt - b.startedAt;
  });
  return list;
}

function windowFor(pid) {
  const wins = win32.robloxWindows([pid]);
  if (!wins.length) return null;
  // The game window is the largest WINDOWSCLIENT window of the process.
  return wins.map(w => ({ ...w, rect: win32.windowRect(w.hwnd) })).sort((a, b) => (b.rect?.width * b.rect?.height || 0) - (a.rect?.width * a.rect?.height || 0))[0];
}

const hwndKey = (hwnd) => String(require('koffi').address(hwnd));

function layoutOptions(disp, list, layout = settings.get('tiling.layout')) {
  const t = settings.get('tiling');
  const custom = require('./customlayouts').fromKey(layout);
  return { gap: t.gap, padding: t.padding, mainRatio: t.mainRatio, cellWidth: t.cellWidth, cellHeight: t.cellHeight, centerLastRow: t.centerLastRow, tinyCell: tinyCell(disp, list), customZones: custom?.zones || null };
}

/** 'custom:<id>' layouts compute as 'custom' (with their zones in the options). */
const kind = (layout) => (String(layout || '').startsWith('custom:') ? 'custom' : layout);

/** The tiny size (Alt performance → tiny window size) is the game picture. A tiny cell is that
 *  plus the title bar and borders, in screen units (DIPs) on that monitor. */
function tinyCell(disp, list = []) {
  const p = settings.get('perf') || {};
  const scale = disp?.scaleFactor || 1;
  let fr = null, b = null;
  if (win32.available) {
    for (const s of list) {
      if (!s?.pid) continue;
      const w = windowFor(s.pid);
      if (!w || win32.isMinimized(w.hwnd)) continue;
      fr = win32.frameSize(w.hwnd); b = win32.invisibleBorders(w.hwnd);
      if (fr) break;
    }
  }
  fr = fr || { w: Math.round(16 * scale), h: Math.round(39 * scale) };
  b = b || { left: Math.round(7 * scale), top: 0, right: Math.round(7 * scale), bottom: Math.round(7 * scale) };
  return {
    width: ((p.tinyW || 240) + fr.w - b.left - b.right) / scale,
    height: ((p.tinyH || 180) + fr.h - b.top - b.bottom) / scale,
    client: { w: p.tinyW || 240, h: p.tinyH || 180 },
  };
}

/** What the UI box shows: cell fractions on the chosen monitor plus labels. */
function preview(overrides = {}) {
  const disp = targetDisplay();
  const t = { ...settings.get('tiling'), ...overrides };
  const fOn = focusState.on && !overrides.layout;
  const list = fOn ? focusOrder(targets()) : targets();
  const n = Math.max(list.length, overrides.sampleCount || 0);
  const wa = disp.workArea;
  let b = disp.bounds;
  const f = settings.get('focus') || {};
  const opts = { ...layoutOptions(disp, list, t.layout), ...overrides };
  if (overrides.zones) opts.customZones = overrides.zones; // the editor previews unsaved zones
  let rects = fOn ? focusRects(n, wa, { ...layoutOptions(disp, list), ratio: f.ratio, side: f.stripSide }) : computeLayout(overrides.zones ? 'custom' : kind(t.layout), n, wa, opts);
  let shown = { id: disp.id, width: b.width, height: b.height, workArea: { x: wa.x - b.x, y: wa.y - b.y, width: wa.width, height: wa.height } };
  const spread = !fOn && !overrides.zones ? spreadDisplays() : null;
  if (spread) {
    // One picture of every monitor side by side.
    const minX = Math.min(...spread.map(d => d.bounds.x)), minY = Math.min(...spread.map(d => d.bounds.y));
    const maxX = Math.max(...spread.map(d => d.bounds.x + d.bounds.width)), maxY = Math.max(...spread.map(d => d.bounds.y + d.bounds.height));
    const fill = Array.from({ length: n }, (_, i) => list[i] || { id: null });
    rects = spreadRects(spread, fill, t.layout).rects;
    b = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    shown = { id: 'all', width: b.width, height: b.height, workArea: { x: 0, y: 0, width: b.width, height: b.height }, monitors: spread.map(d => ({ x: (d.bounds.x - minX) / b.width, y: (d.bounds.y - minY) / b.height, w: d.bounds.width / b.width, h: d.bounds.height / b.height })) };
  }
  const displays = listDisplays().map(d => ({ id: d.id, label: d.label }));
  if (displays.length > 1) displays.push({ id: 'all', label: 'All monitors (spread out)' });
  return {
    display: shown,
    displays,
    layouts: { ...LAYOUTS, ...require('./customlayouts').names() },
    cells: rects.map((r, i) => ({
      x: (r.x - b.x) / b.width, y: (r.y - b.y) / b.height, w: r.width / b.width, h: r.height / b.height,
      sessionId: list[i]?.id || null, label: list[i]?.label || `Window ${i + 1}`, avatarUrl: list[i]?.avatarUrl || '', placeholder: !list[i],
    })),
    windows: list.map(s => ({ id: s.id, label: s.label, pid: s.pid, external: s.external, topmost: [...topmost].some(k => k.startsWith(`${s.pid}:`)), tiny: tinykeep.has(s.pid) })),
    tinySize: { w: settings.get('perf.tinyW'), h: settings.get('perf.tinyH') },
    savedCount: saved.size,
    autoTile: t.autoTile,
    focus: focusStatus(),
  };
}

// ---------- focus mode: one big window, the rest in a side strip ----------
const focusState = { on: false, sessionId: null };

/** Focus layout: the focused window takes `ratio` of the width, the others stack in a strip. */
function focusRects(n, area, o = {}) {
  const rects = computeLayout('main', n, area, { ...o, mainRatio: Math.min(0.85, Math.max(0.5, o.ratio ?? 0.78)) });
  if (o.side !== 'left') return rects;
  // mirror horizontally so the strip is on the left
  return rects.map(r => ({ ...r, x: area.x + area.width - (r.x - area.x) - r.width }));
}

function focusOrder(list) {
  const i = list.findIndex(s => s.id === focusState.sessionId);
  if (i <= 0) return list;
  return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}

/** Puts one window so its visible part fills `phys` (physical pixels). A window smaller than
 *  Roblox allows is resized the RoALT way and kept that small; others the normal way.
 *  When MultiMenu tiles by itself (auto), a window kept tiny (Alt performance → start alts
 *  tiny, or made tiny on the Tiling page) stays tiny in a layout with bigger cells: it moves
 *  to its cell and keeps its size, so auto-tile and tiny windows don't undo each other. */
async function placeOne(s, w, phys, client, auto = false) {
  const hwnd = w.hwnd;
  await win32.unhideAsync(hwnd);
  const b = win32.invisibleBorders(hwnd);
  const fr = win32.frameSize(hwnd) || { w: 16, h: 39 };
  const outer = { x: phys.x - b.left, y: phys.y - b.top, width: phys.width + b.left + b.right, height: phys.height + b.top + b.bottom };
  const kept = auto && !client && tinykeep.sizeOf(s.pid);
  if (kept && kept.w + fr.w <= outer.width && kept.h + fr.h <= outer.height) {
    const ok = await win32.freeResize(hwnd, { x: outer.x, y: outer.y, width: kept.w + fr.w, height: kept.h + fr.h });
    if (ok) tinykeep.keep(s.pid, kept.w, kept.h);
    return ok;
  }
  const want = client || { w: outer.width - fr.w, h: outer.height - fr.h };
  if (want.w >= tinykeep.ROBLOX_MIN.w && want.h >= tinykeep.ROBLOX_MIN.h) {
    const ok = await win32.placeWindowAsync(hwnd, phys);
    const now = win32.windowRect(hwnd);
    if (!ok || !now || (now.width <= outer.width + 2 && now.height <= outer.height + 2)) { tinykeep.release(s.pid); return ok; }
    // Bigger than asked: at this display scaling Roblox's minimum is bigger. Go past it.
  }
  const ok = await win32.freeResize(hwnd, outer);
  if (ok) tinykeep.keep(s.pid, want.w, want.h);
  return ok;
}

let tiling = null, queued = null;
/** Arranges the windows, one tiling at a time. Asked again meanwhile (a client that just
 *  opened, say), it tiles once more when this one is done, so no window is left out.
 *  auto: started by MultiMenu itself (a launch, a client reaching a game, a monitor change),
 *  not by you. Then windows you minimised stay minimised and are left out of the layout. */
function tile({ auto = false } = {}) {
  if (!win32.available) return Promise.reject(new Error('Window tiling needs Windows.'));
  if (!tiling) {
    tiling = tileNow({ auto }).finally(() => { tiling = null; });
    return tiling;
  }
  if (queued) { queued.auto = queued.auto && auto; return queued.promise; }
  const q = { auto };
  q.promise = tiling.catch(() => {}).then(() => { queued = null; return tile({ auto: q.auto }); });
  queued = q;
  return q.promise;
}

async function tileNow({ auto = false } = {}) {
  // Only windows that are there to arrange: a client still opening has no window yet, and
  // leaving it a cell would put a gap in the layout. MultiMenu's own re-tiles skip minimised ones.
  let list = targets().filter((s) => {
    try { const w = windowFor(s.pid); return !!w && !(auto && win32.isMinimized(w.hwnd)); } catch { return false; }
  });
  if (!list.length) {
    if (auto) return { placed: 0, total: 0, missing: [] };
    throw new Error(targets().length ? 'The Roblox windows are still opening. Try again in a moment.' : 'No running Roblox windows to tile.');
  }
  const disp = targetDisplay();
  let rects, client = null;
  if (focusState.on) {
    if (!list.some(s => s.id === focusState.sessionId)) focusState.sessionId = list[0].id;
    list = focusOrder(list);
    const f = settings.get('focus') || {};
    rects = focusRects(list.length, disp.workArea, { ...layoutOptions(disp, list), ratio: f.ratio, side: f.stripSide });
  } else {
    // A game profile's layout wins when every window is in that game.
    let layout = settings.get('tiling.layout');
    try { layout = require('./gameprofiles').layoutFor(list) || layout; } catch { /* no profiles */ }
    if (String(layout).startsWith('custom:') && !require('./customlayouts').isKey(layout)) layout = 'auto'; // that layout was removed
    const spread = spreadDisplays();
    if (spread) ({ rects, client } = spreadRects(spread, list, layout));
    else {
      const o = layoutOptions(disp, list, layout);
      if (layout === 'tiny') client = o.tinyCell.client;
      rects = computeLayout(kind(layout), list.length, disp.workArea, o);
    }
  }
  const scr = electronScreen();
  const missing = [];
  const results = await Promise.all(list.map(async (s, i) => {
    const w = windowFor(s.pid);
    if (!w) { missing.push(s.label); return false; }
    const key = hwndKey(w.hwnd);
    if (!saved.has(key) && w.rect && !win32.isMinimized(w.hwnd)) saved.set(key, { pid: s.pid, rect: w.rect });
    // Electron work areas are in DIPs; SetWindowPos needs physical pixels.
    const phys = process.platform === 'win32' ? scr.dipToScreenRect(null, rects[i]) : rects[i];
    try { return await placeOne(s, w, phys, client, auto); } catch (e) { log.warn(`${s.label}: ${e.message}`); return false; }
  }));
  const placed = results.filter(Boolean).length;
  if (placed) bus.emit('tiled', { placed });
  log.info(`Tiled ${placed}/${list.length} windows (${focusState.on ? 'focus mode' : settings.get('tiling.layout')}${auto ? ', automatic' : ''})`);
  if (!focusState.on) try { require('./layouts').remember(); } catch { /* optional */ }
  bus.emit('tiler:update', preview());
  return { placed, total: list.length, missing };
}

function restore() {
  if (!win32.available) throw new Error('Needs Windows.');
  let restored = 0;
  const alive = new Map();
  for (const p of processes.robloxProcesses()) for (const w of win32.robloxWindows([p.pid])) alive.set(hwndKey(w.hwnd), w.hwnd);
  for (const [key, v] of saved) {
    const h = alive.get(key);
    tinykeep.release(v.pid);
    if (h && win32.setOuterRect(h, v.rect)) restored++;
  }
  saved.clear();
  bus.emit('tiler:update', preview());
  return { restored };
}

function forEachWindow(fn) {
  let n = 0;
  for (const s of targets()) { const w = windowFor(s.pid); if (w) { fn(w, s); n++; } }
  return n;
}

function minimizeAll() { return { count: forEachWindow(w => win32.minimizeWindow(w.hwnd)) }; }
function showAll() { return { count: forEachWindow(w => win32.restoreWindow(w.hwnd)) }; }

function sessionWindow(id) {
  const s = sessions.listSessions().find(x => x.id === id);
  if (!s?.pid) throw new Error('That session is not running.');
  const w = windowFor(s.pid);
  if (!w) throw new Error('Its Roblox window was not found (it may still be loading).');
  return { s, w };
}

function focus(id) { const { w } = sessionWindow(id); win32.focusWindow(w.hwnd); return true; }

/** One window tiny (the tiny size from Alt performance) or back to its normal size. */
async function setTiny(id, on) {
  const { s, w } = sessionWindow(id);
  const key = hwndKey(w.hwnd);
  if (on) {
    if (!saved.has(key) && w.rect && !win32.isMinimized(w.hwnd)) saved.set(key, { pid: s.pid, rect: w.rect });
    const p = settings.get('perf');
    const ok = await tinykeep.makeTiny(s.pid, w.hwnd, p.tinyW, p.tinyH);
    if (!ok) throw new Error('That window is busy or not responding. Try again in a moment.');
  } else {
    tinykeep.release(s.pid);
    const before = saved.get(key);
    saved.delete(key);
    await win32.unhideAsync(w.hwnd);
    const fr = win32.frameSize(w.hwnd) || { w: 16, h: 39 };
    const r = win32.windowRect(w.hwnd) || { x: 100, y: 100 };
    // Back where it was before, or a normal 1280 × 720 game picture where it is now.
    win32.setOuterRect(w.hwnd, before?.rect || { x: r.x, y: r.y, width: 1280 + fr.w, height: 720 + fr.h });
  }
  bus.emit('tiler:update', preview());
  return { tiny: tinykeep.has(s.pid) };
}
function minimize(id) { const { w } = sessionWindow(id); win32.minimizeWindow(w.hwnd); return true; }
function toggleTopmost(id, want) {
  const { s, w } = sessionWindow(id);
  const key = `${s.pid}:${hwndKey(w.hwnd)}`;
  const on = typeof want === 'boolean' ? want : !topmost.has(key);
  win32.setTopmost(w.hwnd, on);
  if (on) topmost.add(key); else topmost.delete(key);
  // Remember it for the account, so the window is pinned again after a rejoin or relaunch.
  if (s.accountId) {
    const pinned = new Set(settings.get('tiling.pinned') || []);
    if (on) pinned.add(s.accountId); else pinned.delete(s.accountId);
    settings.set('tiling.pinned', [...pinned].slice(0, 100));
  }
  bus.emit('tiler:update', preview());
  return { topmost: on, label: s.label };
}

/** Pins (or unpins) the Roblox window in front: for the "Pin the window in front" hotkey. */
function pinFront() {
  if (!win32.available) throw new Error('Needs Windows.');
  const fg = win32.foregroundWindow();
  const key = fg ? hwndKey(fg) : null;
  for (const s of sessions.allRaw()) {
    if (!s.pid || ['closed', 'failed', 'ended'].includes(s.status)) continue;
    const w = windowFor(s.pid);
    if (w && hwndKey(w.hwnd) === key) return toggleTopmost(s.id);
  }
  throw new Error('The window in front is not a Roblox client.');
}

/** Pins a new client's window when its account was pinned before. */
function repin(sessionId, tries = 6) {
  const s = sessions.getRaw(sessionId);
  if (!s?.accountId || !(settings.get('tiling.pinned') || []).includes(s.accountId)) return;
  const w = s.pid ? windowFor(s.pid) : null;
  if (!w) { if (tries > 0) setTimeout(() => repin(sessionId, tries - 1), 5000); return; }
  const key = `${s.pid}:${hwndKey(w.hwnd)}`;
  if (topmost.has(key)) return;
  win32.setTopmost(w.hwnd, true);
  topmost.add(key);
  bus.emit('tiler:update', preview());
}

function setOrder(ids) { order = (Array.isArray(ids) ? ids : []).filter(x => typeof x === 'string').slice(0, 200); bus.emit('tiler:update', preview()); return preview(); }

function swap(a, b) {
  const ids = targets().map(s => s.id);
  const i = ids.indexOf(a), j = ids.indexOf(b);
  if (i < 0 || j < 0) return preview();
  [ids[i], ids[j]] = [ids[j], ids[i]];
  order = ids;
  const res = preview();
  bus.emit('tiler:update', res);
  return res;
}

/** Turns focus mode on (optionally on one session) or off. */
function setFocus(on, sessionId) {
  if (!win32.available) throw new Error('Focus mode needs Windows.');
  const list = targets();
  if (on && !list.length) throw new Error('No running Roblox windows.');
  focusState.on = !!on;
  if (on) {
    let id = sessionId;
    if (!id) { const fg = win32.foregroundPid?.(); id = list.find(s => s.pid === fg)?.id || focusState.sessionId || list[0].id; }
    focusState.sessionId = id;
  }
  return tile().then((r) => {
    if (on) { try { focus(focusState.sessionId); } catch { /* window still loading */ } }
    bus.emit('tiler:update', preview());
    return { ...focusStatus(), placed: r.placed };
  });
}
function toggleFocus() { return setFocus(!focusState.on); }
/** Moves the big spot to the next (or previous) window. */
function focusNext(step = 1) {
  const list = targets();
  if (!list.length) throw new Error('No running Roblox windows.');
  if (!focusState.on) return setFocus(true);
  const i = list.findIndex(s => s.id === focusState.sessionId);
  focusState.sessionId = list[((i < 0 ? 0 : i) + step + list.length) % list.length].id;
  return setFocus(true, focusState.sessionId);
}
function focusStatus() {
  const s = focusState.on ? sessions.listSessions().find(x => x.id === focusState.sessionId) : null;
  return { on: focusState.on, sessionId: focusState.sessionId, label: s?.label || null };
}

// ---------- auto-tile ----------
let autoTimers = [];
function scheduleAutoTile(times = [3000, 10000]) {
  if (!settings.get('tiling.autoTile') || !win32.available) return;
  autoTimers.forEach(clearTimeout);
  // Once when the window appears, again after Roblox finishes resizing itself while loading.
  autoTimers = times.map(ms => setTimeout(() => { tile({ auto: true }).catch(e => log.warn('auto-tile', e.message)); }, ms));
}

function init() {
  bus.on('session:joined', ({ id } = {}) => {
    if (id && win32.available) { try { repin(id); } catch (e) { log.warn(`Pin again: ${e.message}`); } }
    // A slow client's window may not have been there for the launch's tiling. Once it's in a
    // game (and made tiny or minimised if Alt performance says so), tile again.
    scheduleAutoTile([4000]);
  });
  bus.on('event', e => { if (e.type === 'accountLaunched' && !e.test) scheduleAutoTile(); });
  bus.on('sessions:changed', () => bus.emit('tiler:update', preview()));
  bus.on('tiny:update', () => bus.emit('tiler:update', preview()));
}

module.exports = {
  splitCounts,
  pinFront, repin, LAYOUTS, computeLayout, cellGrid, tinyCell, setTiny, bestGrid, focusRects, setFocus, toggleFocus, focusNext, focusStatus, windowFor, targets, targetDisplay, init, preview, tile, restore, minimizeAll, showAll, focus, minimize, toggleTopmost, setOrder, swap, listDisplays,
};
