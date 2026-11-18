'use strict';
// Copied-link detection. When you copy a Roblox game, private server or share
// link anywhere, MultiMenu offers to launch accounts into it. Only Roblox links
// are looked at; nothing else from your clipboard is stored or sent anywhere.
const { clipboard } = require('electron');
const settings = require('./settings');
const roblox = require('./roblox');
const bus = require('../bus');

let timer = null, last = '';

/** Finds a Roblox link inside copied text. Pure (exported for tests). */
function findLink(text) {
  const m = String(text || '').slice(0, 2000).match(/https:\/\/(?:www\.|web\.)?roblox\.com\/(?:games\/\d+[^\s"'<>]*|share\?[^\s"'<>]+)/i);
  if (!m) return null;
  const target = roblox.parseTarget(m[0]);
  return target ? { url: m[0], target } : null;
}

function tick() {
  if (!settings.get('clipboard.enabled')) return;
  let text = '';
  try { text = clipboard.readText(); } catch { return; }
  if (!text || text === last) return;
  last = text;
  const found = findLink(text);
  if (found) bus.emit('clipboard:link', found);
}

function start() {
  clearInterval(timer);
  try { last = clipboard.readText(); } catch { last = ''; } // ignore whatever was already copied
  timer = setInterval(require('./lean').paced(tick), 1500);
}

module.exports = { start, findLink };
