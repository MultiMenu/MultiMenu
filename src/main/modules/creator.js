'use strict';
// Account Creation Assistant. Generates a username/password, opens the official
// Roblox signup page and fills those two fields. The user picks their birthday,
// solves the CAPTCHA and presses Sign Up themselves. One window at a time; there
// is no automated submission and no CAPTCHA handling of any kind.
const crypto = require('crypto');
const accounts = require('./accounts');
const roblox = require('./roblox');

const ADJ = ['Swift', 'Neon', 'Violet', 'Lunar', 'Silent', 'Cosmic', 'Frost', 'Shadow', 'Pixel', 'Blaze', 'Echo', 'Nova', 'Velvet', 'Turbo', 'Mystic', 'Amber', 'Rapid', 'Crystal', 'Storm', 'Hyper'];
const NOUN = ['Falcon', 'Pixel', 'Comet', 'Wolf', 'Raven', 'Tiger', 'Orbit', 'Drift', 'Spark', 'Golem', 'Panda', 'Viper', 'Knight', 'Ember', 'Fox', 'Rocket', 'Lynx', 'Otter', 'Quartz', 'Phoenix'];

const pick = arr => arr[crypto.randomInt(arr.length)];

/** Roblox rules: 3–20 chars, letters/digits/underscore, max one underscore, not at start/end. */
function isValidUsername(u) {
  return /^[A-Za-z0-9_]{3,20}$/.test(u) && (u.match(/_/g) || []).length <= 1 && !u.startsWith('_') && !u.endsWith('_');
}

function generateUsername() {
  for (;;) {
    const sep = crypto.randomInt(3) === 0 ? '_' : '';
    const u = `${pick(ADJ)}${sep}${pick(NOUN)}${crypto.randomInt(10, 9999)}`;
    if (isValidUsername(u)) return u;
  }
}

function generatePassword(length = 18) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%^&*-_=+?'];
  const all = sets.join('');
  const chars = sets.map(s => s[crypto.randomInt(s.length)]);
  while (chars.length < length) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

async function checkUsername(u) {
  if (!isValidUsername(u)) return { checked: true, valid: false, message: 'Use 3–20 letters, numbers and at most one underscore (not at the start or end).' };
  return roblox.validateUsername(u);
}

// Fills React-controlled inputs the same way typing would (native value setter + input event).
function fillScript(username, password) {
  return `(() => {
    const set = (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    return { username: set('#signup-username', ${JSON.stringify(username)}), password: set('#signup-password', ${JSON.stringify(password)}) };
  })()`;
}

async function openSignup({ username, password, alias }) {
  if (!isValidUsername(username)) throw new Error('Username is not valid for Roblox.');
  if (typeof password !== 'string' || password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (password.toLowerCase().includes(username.toLowerCase())) throw new Error('Roblox does not allow the password to contain the username.');
  let filled = null;
  const account = await accounts.openRobloxWindow({
    url: 'https://www.roblox.com/CreateAccount',
    title: 'MultiMenu — Create a Roblox account (finish the form and CAPTCHA yourself)',
    extra: { password, alias },
    onLoaded: async (win) => {
      // The form renders after load; retry briefly.
      for (let i = 0; i < 10 && !win.isDestroyed(); i++) {
        filled = await win.webContents.executeJavaScript(fillScript(username, password)).catch(() => null);
        if (filled?.username && filled?.password) return;
        await new Promise(r => setTimeout(r, 700));
      }
    },
  });
  return account;
}

module.exports = { generateUsername, generatePassword, isValidUsername, checkUsername, openSignup };
