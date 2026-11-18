'use strict';
// "Open roblox.com as this account". A private browser window already signed in
// as the chosen account, for settings, trades, messages, avatar edits - without
// logging out of anything. Each window has its own throwaway session that is
// wiped when it closes.
//
// Logging out from this window would kill the saved login MultiMenu uses, so the
// logout request is blocked and you're told why.
//
// "Lock purchases" (on by default): anything that spends Robux, and the pages
// for buying Robux or Premium, are blocked. Free items still work, because a
// free purchase tells Roblox it expects to pay 0.
const crypto = require('crypto');
const { BrowserWindow, session, dialog } = require('electron');
const accounts = require('./accounts');
const settings = require('./settings');
const log = require('../logger').scope('browseas');

const ROBLOX = /^https:\/\/([a-z0-9-]+\.)*roblox\.com(\/|$)/i;
const open = new Map(); // accountId -> window

const LOGOUT = /^https:\/\/([a-z0-9-]+\.)*roblox\.com\/.*logout/i;
const SPEND_API = /^https:\/\/(economy|apis|catalog|www|itemconfiguration|develop)\.roblox\.com\/.*(purchase|\/buy\b)/i;
const BUY_PAGES = /^https:\/\/www\.roblox\.com\/(upgrades(\/|$)|premium\/membership|robux(\/|\?|$)|giftcards|mobileapi\/.*robux|[a-z-]{2,5}\/upgrades)/i;

/** Pure: should this request be blocked? Returns 'logout', 'purchase' or null. Exported for tests. */
function blockReason(d, lockPurchases = true) {
  if (LOGOUT.test(d.url)) return 'logout';
  if (!lockPurchases) return null;
  if (d.resourceType === 'mainFrame' && BUY_PAGES.test(d.url)) return 'purchase';
  if (d.method === 'POST' && SPEND_API.test(d.url)) {
    try {
      const body = JSON.parse(Buffer.concat((d.uploadData || []).filter(x => x.bytes).map(x => x.bytes)).toString('utf8') || '{}');
      if (Number(body.expectedPrice) === 0) return null; // free item
    } catch { /* unreadable body: treat as paid */ }
    return 'purchase';
  }
  return null;
}

async function openAs(accountId, path = '/home') {
  const a = accounts.find(accountId);
  if (!a) throw new Error('Account not found');
  if (open.has(accountId) && !open.get(accountId).isDestroyed()) { open.get(accountId).focus(); return true; }
  const cookie = accounts.getCookie(accountId);
  const partition = `mm-browse-${crypto.randomUUID()}`;
  const ses = session.fromPartition(partition, { cache: false });
  await ses.cookies.set({ url: 'https://www.roblox.com', name: '.ROBLOSECURITY', value: cookie, domain: '.roblox.com', path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: Math.floor(Date.now() / 1000) + 86400 });
  let lastWarn = 0;
  ses.webRequest.onBeforeRequest({ urls: ['https://*.roblox.com/*'] }, (d, cb) => {
    const why = blockReason(d, settings.get('browse.lockPurchases') !== false);
    cb({ cancel: !!why });
    if (!why || win.isDestroyed() || Date.now() - lastWarn < 3000) return;
    lastWarn = Date.now();
    const { t } = require('../i18n');
    if (why === 'logout') dialog.showMessageBox(win, { type: 'info', title: 'MultiMenu', message: t('Logging out is blocked here'), detail: t('Logging out would end the saved login MultiMenu uses for this account. Just close this window when you\'re done.') });
    else { log.info('Blocked a purchase in the roblox.com window'); dialog.showMessageBox(win, { type: 'info', title: 'MultiMenu', message: t('Purchases are locked'), detail: t('MultiMenu blocks spending Robux and buying Robux or Premium in this window so nothing gets bought by accident. Free items still work. You can turn this off in Settings → Accounts ("Lock purchases").') }); }
  });
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  const name = a.alias || a.displayName || a.username;
  const win = new BrowserWindow({
    width: 1240, height: 860, title: `Roblox — ${name} (MultiMenu)`, backgroundColor: '#0b0612', autoHideMenuBar: true,
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.on('page-title-updated', (e) => { e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (ROBLOX.test(url)) { win.loadURL(url); }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!ROBLOX.test(url)) e.preventDefault(); });
  win.on('closed', () => { open.delete(accountId); ses.clearStorageData().catch(() => {}); });
  open.set(accountId, win);
  const safePath = /^\/[\w\-/?=&.%]*$/.test(path) ? path : '/home';
  win.loadURL(`https://www.roblox.com${safePath}`);
  log.info(`Opened roblox.com as account ${a.userId}`);
  return true;
}

module.exports = { openAs, blockReason };
