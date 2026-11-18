#!/usr/bin/env node
// Merges translated text into src/i18n/<lang>.json.
//   node scripts/i18n-merge.js <list.tsv> <batch.txt> [more batches...]
// list.tsv: "<n>\t<English text>" lines (the numbered list that was translated).
// batch.txt: blocks like
//   #12
//   de: Deutscher Text mit {0}
//   es: Texto en español con {0}
// Every {0}, {1}... in the English text must appear in the translation (checked here).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const [listFile, ...batches] = process.argv.slice(2);
if (!listFile || !batches.length) { console.error('Usage: node scripts/i18n-merge.js <list.tsv> <batch.txt>…'); process.exit(1); }

const list = new Map(fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean).map(l => { const i = l.indexOf('\t'); return [Number(l.slice(0, i)), l.slice(i + 1)]; }));
const LANGS = new Set(require('../src/renderer/js/translate').LANGS.map(l => l.id).filter(id => id !== 'en'));
const holes = (s) => (String(s).match(/\{\d\}/g) || []).sort().join(',');
// A placeholder stuck to a word ("alt{1}") is an English plural "s": translations may leave it out.
const needed = (s) => (String(s).match(/(?<![A-Za-z])\{\d\}/g) || []);
const fits = (key, t) => {
  const have = String(t).match(/\{\d\}/g) || [];
  return needed(key).every(h => have.includes(h)) && have.every(h => key.includes(h));
};

const out = {}; const problems = [];
for (const file of batches) {
  let n = null;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const head = /^#(\d+)\s*$/.exec(line);
    if (head) { n = Number(head[1]); continue; }
    const m = /^([a-z]{2,3}):\s?(.*)$/.exec(line);
    if (!m || n == null) { problems.push(`${path.basename(file)}: can't read "${line.slice(0, 60)}"`); continue; }
    const [, lang, text] = m;
    const key = list.get(n);
    if (!LANGS.has(lang)) { problems.push(`#${n}: unknown language ${lang}`); continue; }
    if (key == null) { problems.push(`#${n}: not in the list`); continue; }
    const t = text.trim();
    if (!t) { problems.push(`#${n} ${lang}: empty`); continue; }
    if (!fits(key, t)) { problems.push(`#${n} ${lang}: placeholders ${holes(key) || 'none'} ≠ ${holes(t) || 'none'} in "${t.slice(0, 70)}"`); continue; }
    (out[lang] ||= {})[key] = t;
  }
}

for (const [lang, add] of Object.entries(out)) {
  const file = path.join(ROOT, 'src', 'i18n', `${lang}.json`);
  const dict = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  Object.assign(dict, add);
  const sorted = Object.fromEntries(Object.keys(dict).sort((a, b) => a.localeCompare(b)).map(k => [k, dict[k]]));
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 1)}\n`);
  console.log(`${lang}: +${Object.keys(add).length} (${Object.keys(sorted).length} total)`);
}
if (problems.length) { console.log(`\n${problems.length} problem(s):`); for (const p of problems) console.log(`  ${p}`); process.exitCode = 1; }
