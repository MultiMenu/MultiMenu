'use strict';
// Language for the main process (tray menu, Windows notifications, dialogs) and
// the dictionary handed to each window. Dictionaries live in src/i18n/<id>.json.
const fs = require('fs');
const path = require('path');
const { LANGS, create } = require('../renderer/js/translate');

const DIR = path.join(__dirname, '..', 'i18n');
let lang = 'en';
let dict = {};
let t = create({});
let pseudo = null; // admin mode: { dict, t } with every known string marked ⟦like this⟧

function load(id) {
  lang = LANGS.some(l => l.id === id) ? id : 'en';
  dict = {};
  if (lang !== 'en') {
    try { dict = JSON.parse(fs.readFileSync(path.join(DIR, `${lang}.json`), 'utf8')); } catch { dict = {}; }
  }
  t = create(dict);
  return lang;
}

/** Best guess from the Windows display language, for the first-run picker. */
function suggest(locale) {
  const l = String(locale || '').toLowerCase();
  if (/^(nb|nn|no)\b/.test(l)) return 'nb';
  if (/^(fil|tl)\b/.test(l)) return 'fil';
  if (/^(id|in)\b/.test(l)) return 'id';
  const two = l.slice(0, 2);
  return LANGS.some(x => x.id === two) ? two : 'en';
}

// ---------- pseudo-language (admin mode) ----------
// Every string MultiMenu knows how to translate shows as ⟦Ŝéţţîñĝš⟧. Plain English
// left on screen is text the translation tools never saw.
const ACCENT = { a: 'à', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ö', p: 'þ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', w: 'ŵ', y: 'ý', z: 'ž',
  A: 'À', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', N: 'Ñ', O: 'Ö', P: 'Þ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', W: 'Ŵ', Y: 'Ý', Z: 'Ž' };
function pseudoText(s) {
  // Keep {0} placeholders as they are.
  return `⟦${String(s).split(/(\{\d+\})/).map((part, i) => (i % 2 ? part : part.replace(/[A-Za-z]/g, c => ACCENT[c] || c))).join('')}⟧`;
}
function knownKeys() {
  const keys = new Set();
  let files = [];
  try { files = fs.readdirSync(DIR).filter(f => /^[a-z]{2,3}\.json$/.test(f)); } catch { /* none */ }
  for (const f of files) {
    try { for (const k of Object.keys(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')))) keys.add(k); } catch { /* skip a bad file */ }
  }
  return keys;
}
function setPseudo(on) {
  if (!on) { pseudo = null; return false; }
  const d = {};
  for (const k of knownKeys()) d[k] = pseudoText(k);
  pseudo = { dict: d, t: create(d) };
  return true;
}

module.exports = {
  LANGS, load, suggest, setPseudo, pseudoText,
  get lang() { return lang; },
  get pseudo() { return !!pseudo; },
  t: (s) => (pseudo ? pseudo.t(s) : t(s)),
  payload: () => (pseudo ? { lang: 'en-XA', dict: pseudo.dict } : { lang, dict }),
};
