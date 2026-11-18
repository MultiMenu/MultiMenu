'use strict';
// Encrypted vault backup. Exports accounts (logins + saved passwords), groups,
// presets, saved games and webhooks into one file protected by a password you
// choose: scrypt key derivation + AES-256-GCM. Unlike DPAPI, the file can be
// restored on any PC / Windows user that knows the password.
const crypto = require('crypto');
const secure = require('../secure');
const accountsMod = require('./accounts');

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const FORMAT = 'multimenu-vault';

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new Error('Use a backup password of at least 8 characters.');
}

function encryptJson(obj, password) {
  checkPassword(password);
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32, SCRYPT);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return JSON.stringify({ format: FORMAT, version: 1, kdf: 'scrypt', n: SCRYPT.N, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}

function decryptJson(text, password) {
  let f;
  try { f = JSON.parse(text); } catch { throw new Error('That is not a MultiMenu backup file.'); }
  if (f?.format !== FORMAT || f.version !== 1) throw new Error('That is not a MultiMenu backup file.');
  if (f.n !== SCRYPT.N) throw new Error('Unsupported backup settings.');
  const key = crypto.scryptSync(String(password || ''), Buffer.from(f.salt, 'base64'), 32, SCRYPT);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(f.iv, 'base64'));
  d.setAuthTag(Buffer.from(f.tag, 'base64'));
  try { return JSON.parse(Buffer.concat([d.update(Buffer.from(f.data, 'base64')), d.final()]).toString('utf8')); }
  catch { throw new Error('Wrong password, or the backup file is damaged.'); }
}

/** Decrypts one secret; an unreadable one is left out instead of failing the whole backup. */
const open = (enc) => { if (!enc) return null; try { return secure.decrypt(enc); } catch { return null; } };

function buildVault() {
  const acc = accountsMod.raw();
  const hooks = { hooks: require('./webhooks').rawHooks() };
  return {
    exportedAt: new Date().toISOString(),
    groups: acc.groups,
    accounts: acc.accounts.map(a => ({
      userId: a.userId, username: a.username, alias: a.alias || '', group: a.group, favourite: !!a.favourite, notes: a.notes || '', defaultPlace: a.defaultPlace || '',
      // 2.0 fields, so moving to a new PC keeps tiers, tags, colours, launch graphics and hotkey slots.
      tier: a.tier || null, tags: Array.isArray(a.tags) ? a.tags : [], color: a.color || null, launchGraphics: a.launchGraphics || null, slot: a.slot || null,
      cookie: open(a.cookieEnc), password: open(a.passwordEnc),
    })),
    presets: require('./presets').list(),
    games: require('./servers').listGames(),
    webhooks: hooks.hooks.map(h => ({ name: h.name, enabled: h.enabled, url: open(h.urlEnc) })).filter(h => h.url),
  };
}

/** Restores a vault. Accounts are re-checked with Roblox; existing ones are updated, not duplicated. */
async function restoreVault(v, { onProgress } = {}) {
  const res = { accounts: 0, failed: 0, presets: 0, games: 0, webhooks: 0, errors: [] };
  for (const g of v.groups || []) { try { accountsMod.addGroup(g); } catch { /* ignore */ } }
  const idMap = {};
  for (const a of v.accounts || []) {
    onProgress?.(`Restoring ${a.username}…`);
    if (!a.cookie) { res.failed++; continue; }
    try {
      const acc = await accountsMod.importCookie(a.cookie, { alias: a.alias, group: a.group, password: a.password || undefined, quiet: true });
      accountsMod.update(acc.id, { favourite: !!a.favourite, notes: a.notes || '', defaultPlace: a.defaultPlace || '' });
      // Each extra field on its own, so one odd value from an older backup can't lose the rest.
      for (const [k, v] of [['tier', a.tier], ['tags', a.tags], ['color', a.color], ['launchGraphics', a.launchGraphics], ['slot', a.slot]]) {
        if (v == null || (Array.isArray(v) && !v.length)) continue;
        try { accountsMod.update(acc.id, { [k]: v }); } catch { /* skip that field */ }
      }
      idMap[a.userId] = acc.id;
      res.accounts++;
    } catch (e) { res.failed++; res.errors.push(`${a.username}: ${e.message}`); }
  }
  // Restoring the same backup twice must not double presets, games or webhooks.
  const presets = require('./presets');
  const presetNames = new Set(presets.list().map(p => String(p.name).toLowerCase()));
  for (const p of v.presets || []) {
    // Presets store account IDs from the old PC: map old ID -> Roblox user ID -> new ID.
    const remapped = (p.accountIds || []).map(oid => idMap[(v._accountIds || {})[oid]]).filter(Boolean);
    if (!remapped.length || presetNames.has(String(p.name).toLowerCase())) continue;
    try { presets.save({ ...p, id: undefined, accountIds: remapped }); presetNames.add(String(p.name).toLowerCase()); res.presets++; } catch { /* skip invalid */ }
  }
  const servers = require('./servers');
  const links = new Set(servers.listGames().map(g => g.link));
  for (const g of v.games || []) {
    if (links.has(g.link)) continue;
    try { await servers.addGame({ name: g.name, link: g.link }); links.add(g.link); res.games++; } catch { /* skip */ }
  }
  const webhooks = require('./webhooks');
  const urls = new Set(webhooks.rawHooks().map(h => open(h.urlEnc)).filter(Boolean));
  for (const h of v.webhooks || []) {
    if (!h.url || urls.has(h.url)) continue;
    try { webhooks.addHook(h.name, h.url); urls.add(h.url); res.webhooks++; } catch { /* skip */ }
  }
  return res;
}

function exportVault(password) {
  const v = buildVault();
  // Keep a map from this PC's account IDs to Roblox user IDs so presets can be remapped on restore.
  const acc = accountsMod.raw();
  v._accountIds = Object.fromEntries(acc.accounts.map(a => [a.id, a.userId]));
  return { text: encryptJson(v, password), count: v.accounts.length };
}

module.exports = { encryptJson, decryptJson, exportVault, restoreVault, buildVault };
