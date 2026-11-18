'use strict';
// Presets: a saved setup (accounts + game/server + tiling layout + graphics +
// watcher + limiter) that launches with one click.
const crypto = require('crypto');
const { JsonStore } = require('../store');
const paths = require('../paths');
const settings = require('./settings');
const sessions = require('./sessions');
const accounts = require('./accounts');
const roblox = require('./roblox');
const bus = require('../bus');
const log = require('../logger').scope('presets');

let store;
const LAYOUTS = ['auto', 'columns', 'rows', 'grid2', 'grid3', 'grid4', 'main', 'cascade', 'fixed'];

function init() { store = new JsonStore(paths.file('presets.json'), { presets: [] }); }
const list = () => store.get('presets');

function validate(p) {
  const name = String(p.name || '').trim().slice(0, 50);
  if (!name) throw new Error('Give the preset a name.');
  const accountIds = (Array.isArray(p.accountIds) ? p.accountIds : []).filter(id => typeof id === 'string' && accounts.find(id)).slice(0, 100);
  // A preset can follow a tag instead: whoever has the tag when it runs.
  const tag = accounts.cleanTags([p.tag || ''])[0] || '';
  if (!accountIds.length && !tag) throw new Error('Pick at least one account.');
  const game = String(p.game || '').trim().slice(0, 400);
  if (game && !roblox.parseTarget(game)) throw new Error('The game must be a place ID or a roblox.com game / private server link.');
  const g = p.graphics || {};
  return {
    name, accountIds: tag ? [] : accountIds, tag, game,
    mode: ['default', 'sameServer'].includes(p.mode) ? p.mode : 'default',
    layout: LAYOUTS.includes(p.layout) || require('./customlayouts').isKey(p.layout) ? p.layout : '',
    tile: !!p.tile, watch: p.watch !== false, limiter: !!p.limiter, antiAfk: !!p.antiAfk,
    graphics: { enabled: !!g.enabled, quality: Number.isInteger(g.quality) && g.quality >= 0 && g.quality <= 10 ? g.quality : 1, fpsCap: [30, 60, 75, 120, 144, 165, 240, -1].includes(g.fpsCap) ? g.fpsCap : 60 },
    closeAfterHours: Math.max(0, Math.min(168, Number(p.closeAfterHours) || 0)),
  };
}

function save(p) {
  const v = validate(p);
  const arr = list();
  const existing = p.id && arr.find(x => x.id === p.id);
  if (existing) Object.assign(existing, v, { updatedAt: Date.now() });
  else arr.push({ id: crypto.randomUUID(), createdAt: Date.now(), lastRunAt: null, ...v });
  store.saveSoon();
  bus.emit('presets:changed');
  return existing || arr.at(-1);
}

function remove(id) { store.set('presets', list().filter(p => p.id !== id)); bus.emit('presets:changed'); return true; }
function get(id) { return list().find(p => p.id === id) || null; }

const closeTimers = new Map();

/** Launches a preset. Returns a summary of the steps taken. */
async function run(id) {
  const p = get(id);
  if (!p) throw new Error('Preset not found');
  const steps = [];
  if (p.graphics.enabled) {
    try { require('./fps').writeGraphics({ quality: p.graphics.quality, fpsCap: p.graphics.fpsCap }); steps.push('Graphics applied'); }
    catch (e) { steps.push(`Graphics: ${e.message}`); }
  }
  if (p.layout) { settings.set('tiling.layout', p.layout); steps.push(`Layout: ${p.layout}`); }
  if (p.tile) { settings.set('tiling.autoTile', true); steps.push('Auto-tile on'); }
  if (p.watch) { settings.set('watcher.enabled', true); steps.push('24/7 Watcher on'); }
  if (p.limiter) { try { require('./limiter').start(); steps.push('Background limiter on'); } catch (e) { steps.push(`Limiter: ${e.message}`); } }
  if (p.antiAfk) { try { require('./antiafk').start(); steps.push('Anti-AFK on'); } catch (e) { steps.push(`Anti-AFK: ${e.message}`); } }
  if (!settings.get('openMulti.enabled') || !sessions.openMultiStatus().active) {
    if (p.accountIds.length > 1) { sessions.enableOpenMulti(); settings.set('openMulti.enabled', true); }
  }
  // Login warnings: check the preset's logins first so expired ones are named instead of failing silently.
  const members = idsOf(p);
  if (!members.length) throw new Error(p.tag ? `No accounts have the tag “${p.tag}”.` : 'This preset has no accounts left.');
  let ids = members;
  try { ids = (await require('./logincheck').preflight(members, p.name)).ok; } catch { /* launch anyway */ }
  ids = accounts.byTier(ids);
  const valid = ids.map(a => accounts.find(a)).filter(a => a && a.status !== 'expired');
  const target = p.game ? roblox.parseTarget(p.game) : null;
  valid.forEach((a, i) => {
    let t = target;
    // "Same server": everyone after the first follows the first account into its server.
    if (p.mode === 'sameServer' && i > 0 && valid[0].userId) t = { followUserId: String(valid[0].userId), placeId: target?.placeId };
    sessions.launch(a.id, null, { watch: p.watch, target: t });
  });
  steps.push(`Launching ${valid.length} account${valid.length === 1 ? '' : 's'}${valid.length < members.length ? ` (${members.length - valid.length} skipped: login expired)` : ''}`);
  p.lastRunAt = Date.now();
  store.saveSoon();
  if (p.closeAfterHours > 0) {
    clearTimeout(closeTimers.get(p.id));
    closeTimers.set(p.id, setTimeout(() => closePreset(p.id, 'Preset time limit reached'), p.closeAfterHours * 3600_000));
    steps.push(`Closes automatically after ${p.closeAfterHours}h`);
  }
  log.info(`Ran preset ${p.name}: ${steps.join('; ')}`);
  bus.emit('notify', { level: 'success', title: `Preset “${p.name}” started`, message: steps.join(' · ') });
  return { steps };
}

/** The preset's accounts right now (a tag preset follows the tag). */
function idsOf(p) {
  if (p.tag) return accounts.resolve(`tag:${p.tag}`).map(a => a.id);
  return (p.accountIds || []).filter(id => accounts.find(id));
}

/** Closes every running session belonging to the preset's accounts and stops watching them. */
function closePreset(id, reason = 'Closed by preset') {
  const p = get(id);
  if (!p) return { closed: 0 };
  let closed = 0;
  const members = idsOf(p);
  for (const s of sessions.listSessions()) {
    if (members.includes(s.accountId) && ['running', 'launching'].includes(s.status)) { sessions.setWatch(s.id, false); sessions.close(s.id); closed++; }
  }
  bus.emit('notify', { level: 'info', title: `Preset “${p.name}” closed`, message: `${closed} session${closed === 1 ? '' : 's'} · ${reason}` });
  return { closed };
}

module.exports = { init, list, get, save, remove, run, closePreset, validate, idsOf };
