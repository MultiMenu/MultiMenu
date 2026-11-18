'use strict';
// Theme gallery: MultiMenu's built-in looks, plus more themes listed in
// themes/index.json in MultiMenu's GitHub repository. The list is downloaded
// only when you open the gallery, and kept for 6 hours. Every entry is a theme
// share code, checked and cleaned exactly like a code someone pastes, so an
// entry can only ever change colours, glow and glass.
const { JsonStore } = require('../store');
const paths = require('../paths');
const sharecodes = require('./sharecodes');
const log = require('../logger').scope('gallery');

const TTL = 6 * 3600_000;
const MAX_BYTES = 256 * 1024;
const MAX_ENTRIES = 120;
let store = null;
function init() { store = new JsonStore(paths.file('gallery.json'), { at: 0, entries: [] }); return store; }

/** Pure: the usable themes in an index file. Broken or non-theme entries are skipped. */
function parseIndex(json) {
  const list = Array.isArray(json?.themes) ? json.themes : [];
  const out = [], seen = new Set();
  for (const e of list.slice(0, MAX_ENTRIES * 2)) {
    if (!e || typeof e !== 'object' || typeof e.code !== 'string') continue;
    try {
      const { kind, code, data } = sharecodes.unpack(e.code);
      if (kind !== 'theme' || seen.has(code)) continue;
      seen.add(code);
      out.push({
        id: sharecodes.crc(code), code, theme: data,
        name: String(e.name || data.name || 'Theme').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40),
        author: String(e.author || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 30),
      });
    } catch { /* skip it */ }
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

function builtIn() {
  const { PRESETS } = require('./themes');
  return Object.entries(PRESETS).map(([id, p]) => {
    const code = sharecodes.pack('theme', sharecodes.CLEAN.theme({ ...p, name: p.label }));
    return { id: `builtin:${id}`, preset: id, code, name: p.label, author: 'MultiMenu', theme: sharecodes.CLEAN.theme({ ...p, name: p.label }) };
  });
}

function indexUrl() {
  const repo = require('./updater').repo();
  return repo ? `https://raw.githubusercontent.com/${repo}/main/themes/index.json` : null;
}

async function download() {
  const url = indexUrl();
  if (!url) throw new Error('No GitHub repository is set for MultiMenu.');
  const res = await fetch(url, { headers: { 'User-Agent': 'MultiMenu' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(res.status === 404 ? 'There are no extra themes yet.' : `GitHub answered ${res.status}.`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('The theme list is too big.');
  return parseIndex(JSON.parse(text));
}

/** Built-in themes plus the online ones (cached for 6 hours; refresh skips the cache). */
async function list(refresh = false) {
  if (!store) init();
  let error = null;
  if (refresh || Date.now() - (store.get('at') || 0) > TTL) {
    try { store.set('entries', await download()); store.set('at', Date.now()); }
    catch (e) { error = e.message; log.warn(`Theme list: ${e.message}`); }
  }
  return { builtIn: builtIn(), online: parseIndex({ themes: store.get('entries') || [] }), fetchedAt: store.get('at') || null, error };
}

module.exports = { init, list, parseIndex, builtIn, indexUrl };
