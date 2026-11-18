'use strict';
// Screenshots of Roblox windows (for watcher alerts and the Discord /mm screenshot
// command). Uses Electron's desktopCapturer, matched to the window handle. Recent
// shots are kept in <data>/screenshots (last 50).
const fs = require('fs');
const path = require('path');
const win32 = require('../native/win32');
const paths = require('../paths');

const dir = () => path.join(paths.dataDir, 'screenshots');

// Window pictures, one request at a time. The Alt Wall, the switcher, hatch alerts,
// the watcher and picture-in-picture all ask for them; asking Windows for several sets
// at once costs a lot with many clients open and can bring the whole app down. A request
// that comes in while one is running waits for it; identical ones share the answer.
let chain = Promise.resolve();
const inflight = new Map();
function sources(opts) {
  const key = JSON.stringify(opts);
  if (inflight.has(key)) return inflight.get(key);
  const run = () => require('electron').desktopCapturer.getSources({ types: ['window'], fetchWindowIcons: false, ...opts });
  const p = chain.then(run, run);
  inflight.set(key, p);
  chain = p.then(() => {}, () => {});
  p.then(() => inflight.delete(key), () => inflight.delete(key));
  return p;
}

/** Returns a PNG Buffer of the session's Roblox window, or null if it can't be captured. */
async function captureWindowOfPid(pid, maxWidth = 1280) {
  if (!win32.available || !pid) return null;
  const w = win32.robloxWindows([pid])[0];
  if (!w) return null;
  if (win32.isMinimized(w.hwnd)) return null; // minimised windows capture as blank
  const r = win32.windowRect(w.hwnd);
  const handle = String(require('koffi').address(w.hwnd));
  const scale = r && r.width > maxWidth ? maxWidth / r.width : 1;
  const size = { width: Math.max(320, Math.round((r?.width || 1280) * scale)), height: Math.max(180, Math.round((r?.height || 720) * scale)) };
  const list = await sources({ thumbnailSize: size });
  const src = list.find(s => s.id.split(':')[1] === handle);
  if (!src || src.thumbnail.isEmpty()) return null;
  return src.thumbnail.toPNG();
}

function save(png, label) {
  fs.mkdirSync(dir(), { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}_${String(label || 'roblox').replace(/[^\w-]/g, '').slice(0, 30)}.png`;
  fs.writeFileSync(path.join(dir(), name), png);
  const files = fs.readdirSync(dir()).filter(f => f.endsWith('.png')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 50))) { try { fs.unlinkSync(path.join(dir(), f)); } catch { /* ignore */ } }
  return name;
}

/** Reads a saved screenshot as a data URL for the UI (name is validated). */
function readDataUrl(name) {
  if (!/^[\w.-]+\.png$/.test(name)) throw new Error('Invalid screenshot name');
  return `data:image/png;base64,${fs.readFileSync(path.join(dir(), name)).toString('base64')}`;
}

module.exports = { captureWindowOfPid, sources, save, readDataUrl, dir };
