'use strict';
// Outfit switcher and "friend my alts".
//  Outfits: list an account's saved outfits, wear one, or copy one onto other
//  accounts (each account must own the items; ones it doesn't own are skipped
//  and listed).
//  Friend alts: makes every selected account friends with every other one
//  (account A sends, account B accepts). If Roblox asks for a CAPTCHA, that
//  pair is left for you to finish on the website - nothing is bypassed.
const accounts = require('./accounts');
const roblox = require('./roblox');
const bus = require('../bus');
const log = require('../logger').scope('avatars');

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const nameOf = (a) => a.alias || a.displayName || a.username;

async function listOutfits(accountId) {
  const a = accounts.find(accountId);
  if (!a) throw new Error('Account not found');
  return roblox.getOutfits(a.userId, accounts.getCookie(accountId));
}

async function wear(accountId, outfitId) {
  if (!Number.isInteger(Number(outfitId))) throw new Error('Invalid outfit');
  const r = await roblox.wearOwnOutfit(Number(outfitId), accounts.getCookie(accountId));
  accounts.refreshAvatar?.(accountId);
  return r;
}

/** Copies outfit `outfitId` (owned by `fromId`) onto each account in `toIds`. */
async function copy(fromId, outfitId, toIds) {
  const details = await roblox.getOutfitDetails(Number(outfitId), accounts.getCookie(fromId));
  const results = [];
  for (const id of toIds) {
    const a = accounts.find(id);
    if (!a) continue;
    try {
      const r = id === fromId ? await roblox.wearOwnOutfit(Number(outfitId), accounts.getCookie(id)) : await roblox.applyOutfit(details, accounts.getCookie(id));
      results.push({ account: nameOf(a), ok: true, skipped: r.skipped });
      accounts.refreshAvatar?.(id);
    } catch (e) { results.push({ account: nameOf(a), ok: false, error: e.message }); }
    await wait(800);
  }
  return { outfit: details.name, results };
}

/** Every pair among `ids` becomes friends. Emits 'alts:progress'. */
async function friendAlts(ids) {
  const accs = ids.map(id => accounts.find(id)).filter(a => a && a.status !== 'expired');
  if (accs.length < 2) throw new Error('Pick at least two accounts with valid logins.');
  if (accs.length > 25) throw new Error('Pick at most 25 accounts at a time.');
  const pairs = [];
  for (let i = 0; i < accs.length; i++) for (let j = i + 1; j < accs.length; j++) pairs.push([accs[i], accs[j]]);
  const results = [];
  let challenges = 0;
  const progress = (done) => bus.emit('alts:progress', { done, total: pairs.length, results });
  for (let k = 0; k < pairs.length; k++) {
    const [a, b] = pairs[k];
    const pair = `${nameOf(a)} ↔ ${nameOf(b)}`;
    if (challenges >= 2) { results.push({ pair, state: 'skipped', detail: 'Paused: Roblox keeps asking for CAPTCHAs. Send this request from the website.' }); progress(k + 1); continue; }
    try {
      const status = (await roblox.getFriendStatuses(a.userId, [b.userId], accounts.getCookie(a.id)))[b.userId];
      if (status === 'Friends') { results.push({ pair, state: 'already', detail: 'Already friends' }); }
      else if (status === 'RequestReceived') { await roblox.acceptFriendRequest(b.userId, accounts.getCookie(a.id)); results.push({ pair, state: 'done', detail: 'Accepted existing request' }); }
      else {
        if (status !== 'RequestSent') { await roblox.sendFriendRequest(b.userId, accounts.getCookie(a.id)); await wait(1200); }
        await roblox.acceptFriendRequest(a.userId, accounts.getCookie(b.id));
        results.push({ pair, state: 'done', detail: 'Now friends' });
      }
      challenges = 0;
    } catch (e) {
      if (e.code === 'CHALLENGE') { challenges++; results.push({ pair, state: 'captcha', detail: `Roblox asked for a CAPTCHA. Log in as ${nameOf(a)} on roblox.com and send the request to @${b.username} yourself.` }); }
      else results.push({ pair, state: 'failed', detail: e.message });
    }
    progress(k + 1);
    await wait(1500);
  }
  log.info(`Friend alts: ${results.filter(r => r.state === 'done').length} new, ${results.filter(r => r.state === 'already').length} already`);
  return { results };
}

module.exports = { listOutfits, wear, copy, friendAlts };
