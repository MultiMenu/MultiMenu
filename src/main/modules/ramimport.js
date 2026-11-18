'use strict';
// "Switching from Roblox Account Manager": brings over the list of accounts
// (username, alias, group, description) so each can be signed in once.
// Saved logins, cookies and passwords are never read into MultiMenu: from
// Roblox Account Manager's file only the name fields are kept, and in a pasted
// list anything after "username:" is dropped.
const roblox = require('./roblox');
const accounts = require('./accounts');

const USER = /^[A-Za-z0-9_]{3,20}$/;
const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** Roblox Account Manager's AccountData.json. Throws { code: 'ENCRYPTED' } for protected files. */
function parseRamFile(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) throw new Error('That file is empty.');
  if (!raw.startsWith('[')) {
    throw Object.assign(new Error('This file is encrypted by Roblox Account Manager, so MultiMenu can\'t read the names in it. Paste your usernames instead.'), { code: 'ENCRYPTED' });
  }
  let arr;
  try { arr = JSON.parse(raw); } catch { throw new Error('That file could not be read. Is it Roblox Account Manager\'s AccountData.json?'); }
  if (!Array.isArray(arr)) throw new Error('That file could not be read. Is it Roblox Account Manager\'s AccountData.json?');
  const out = [];
  for (const a of arr) {
    if (!a || typeof a !== 'object') continue;
    const username = clip(a.Username, 20);
    if (!USER.test(username)) continue;
    const group = clip(a.Group, 30);
    out.push({
      username,
      userId: Number.isSafeInteger(a.UserID) && a.UserID > 0 ? a.UserID : null,
      alias: clip(a.Alias, 40),
      group: group && group !== 'Default' ? group : '',
      notes: clip(a.Description, 500),
      source: 'ram',
    });
  }
  if (!out.length) throw new Error('No accounts were found in that file.');
  return { entries: out, ignoredSecrets: false };
}

/** A pasted list: one account per line, "username" or "username, alias, group".
 *  "username:password" lines are accepted but the password part is thrown away. */
function parseList(text) {
  const out = [];
  let ignoredSecrets = false, bad = 0;
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.includes(':')) { ignoredSecrets = true; line = line.split(':')[0].trim(); }
    const [u, alias, group] = line.split(/\t|,|;/).map(x => x.trim());
    const username = (u || '').replace(/^@/, '');
    if (!USER.test(username)) { bad++; continue; }
    out.push({ username, alias: clip(alias, 40), group: clip(group, 30), source: 'list' });
  }
  if (!out.length) throw new Error('No usernames were found. Put one username on each line.');
  if (out.length > 500) throw new Error('Import is limited to 500 accounts at a time.');
  return { entries: out, ignoredSecrets, bad };
}

async function resolveIds(entries) {
  const need = entries.filter(e => !e.userId);
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    try {
      const found = await roblox.getUsersByUsernames(chunk.map(e => e.username));
      for (const e of chunk) {
        const u = found[e.username.toLowerCase()];
        if (u) { e.userId = u.id; e.username = u.name; e.displayName = u.displayName; }
      }
    } catch { /* names still import without IDs */ }
  }
  return entries;
}

async function run(parsed) {
  await resolveIds(parsed.entries);
  const r = accounts.addPending(parsed.entries);
  return { ...r, found: parsed.entries.length, ignoredSecrets: !!parsed.ignoredSecrets, bad: parsed.bad || 0, pending: accounts.pendingList() };
}

module.exports = {
  parseRamFile, parseList,
  importRamFile: (text) => run(parseRamFile(text)),
  importList: (text) => run(parseList(text)),
};
