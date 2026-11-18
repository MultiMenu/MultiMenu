#!/usr/bin/env node
// Collects every piece of English text the app can show, for translation.
//   node scripts/i18n-extract.js            -> writes src/i18n/keys.json (+ keys-context.tsv)
//   node scripts/i18n-extract.js --check    -> lists keys missing from each language file
// Variable parts become {0}, {1}... so "3 accounts running" matches "{0} accounts running".
'use strict';
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const walk = require('acorn-walk');

const ROOT = path.join(__dirname, '..');
const RENDERER = ['src/renderer/js', 'src/renderer/js/pages', 'src/phone'];
const MAIN = ['src/main', 'src/main/modules'];
// Text that never reaches the UI: Discord-side messages, logs, the self-test, translation tooling.
const SKIP_FILES = new Set(['icons.js', 'translate.js', 'i18n.js', 'selftest.js', 'logger.js', 'remote.js', 'report.js', 'webhooks.js', 'preload.js']);
// Calls whose string arguments are code, not text.
const CODE_CALLEES = /^(log|logger|console)\.|(^|\.)(require|querySelector|querySelectorAll|getElementById|closest|matches|addEventListener|removeEventListener|setAttribute|getAttribute|removeAttribute|createElement|toggle|add|remove|contains|setProperty|getPropertyValue|on|off|once|emit|send|invoke|handle|api|call|setSetting|get|set|has|icon|go|setBadge|delegate|scope|split|join|replace|replaceAll|includes|startsWith|endsWith|indexOf|test|exec|match|matchAll|padStart|padEnd|toLocaleString|toLocaleDateString|toLocaleTimeString|execFile|spawn|fork|readFileSync|writeFileSync|existsSync|statSync|file|join|resolve|basename|dirname|extname|fromPartition|fetch|request|reg|query|dispatchEvent|CustomEvent|Event|Date|RegExp|Buffer|from|encrypt|decrypt|createHash|update|digest|randomUUID|normalize|localeCompare)$|^\$\$?$|^MM\.\$\$?$|^MM\.(icon|toggle|on|api|call|go|setSetting|avatar)$/;
const KEY_CODE = /^(id|key|type|cls|act|value|channel|event|name|icon|kind|state|status|mode|level|method|action|layout|color|tab|page|role|accept|filter|sort|code|field|unit|format|fmt|lang|dir|ext|path|file|url|href|src|style|class|className|selector)$/;
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', times: '×', rarr: '→', larr: '←', middot: '·', hellip: '…', mdash: '—', ndash: '–', copy: '©', bull: '•', check: '✓' };
const decode = s => s.replace(/&(#?\w+);/g, (m, e) => ENT[e] ?? (e.startsWith('#') ? String.fromCodePoint(parseInt(e.slice(1), 10)) : m));
const norm = s => s.replace(/\s+/g, ' ').trim();

function looksLikeText(s, html = false) {
  if (!/[A-Za-z]{2}/.test(s)) return false;
  if (/^\s*[<@]/.test(s) || /^(https?:|file:|data:|mailto:)/.test(s)) return false;
  if (/^[#.[@:]/.test(s) && !/\s/.test(s)) return false;
  if (/[{}]|=>|\$\(|^\w+\(|;\S/.test(s.replace(/\{\d+\}/g, ''))) return false;
  if (html) return !/^[A-Z0-9_]{2,}$/.test(s) && !/^[a-z]+(-[a-z]+)+$/.test(s);
  if (!/\s/.test(s)) {
    // single "word": only Capitalised words like "Running" or "Farm"
    if (!/^[A-Z][a-z]+[!?.:…]?$/.test(s) && !/^[A-Z][a-z]+(\s|-)?[A-Z]?[a-z]*[!?.…]?$/.test(s)) return false;
    if (/^(Content|Accept|User|Bearer|Mozilla|Roblox[A-Z]|Microsoft|Windows\.|System\.|Get-|Set-)/.test(s)) return false;
  }
  if (/^[a-z]+(-[a-z]+)+$/.test(s)) return false; // css / icon names
  if (/^[a-z][\w-]*(\s[a-z][\w-]*)+$/.test(s) && !/\s(a|an|the|to|of|in|is|and|or|for|with|on|at|your|this|it|be|by|you|no|not)\s/.test(` ${s} `)) return false; // class lists
  if (/\.(js|json|exe|png|jpg|html|css|txt|log|ps1|zip|dll|mp4)\b/i.test(s) && !/\s/.test(s)) return false;
  if (/^[A-Z0-9_]{3,}$/.test(s)) return false;
  return true;
}

const keys = new Map(); // key -> Set(file)
function add(text, file, html = false, force = false) {
  let k = norm(decode(text));
  // trim stray leading/trailing separators left by tags/placeholders
  k = k.replace(/^[·•|,:–—-]\s+/, '').replace(/\s+[·•|,–—-]$/, '').trim();
  if (!k || (!force && !looksLikeText(k, html))) return;
  if (/^default-src|^(Asc|Desc)$|^Roblox — \{0\} \(MultiMenu\)$/.test(k)) return;
  // renumber placeholders in order of appearance
  let n = 0; const map = {};
  k = k.replace(/\{(\d+)\}/g, (_, d) => `{${map[d] ?? (map[d] = n++)}}`);
  if (!/[A-Za-z]{2}/.test(k.replace(/\{\d+\}/g, ''))) return;
  if (!keys.has(k)) keys.set(k, new Set());
  keys.get(k).add(file);
}

const HTMLISH = /MM\.(icon|avatar|toggle|settingRow|empty|spark|chart|kbd|badge|pill)\(|\.join\(|\.map\(|innerHTML|<\w|`[^`]*</;

function templateParts(node, src) {
  // Returns the template as a string with placeholders: \u0001k\u0002 for text expressions and \u0003 for HTML expressions.
  let out = '';
  node.quasis.forEach((q, i) => {
    out += q.value.cooked ?? q.value.raw;
    if (i < node.expressions.length) {
      const e = node.expressions[i];
      const code = src.slice(e.start, e.end);
      const html = HTMLISH.test(code);
      out += html ? '\u0003' : `\u0001${i}\u0002`;
    }
  });
  return out;
}

function addTemplate(str, file) {
  // attributes first
  for (const m of str.matchAll(/\b(?:title|placeholder|aria-label|data-tip)="([^"]*)"/g)) add(m[1].replace(/\u0001(\d+)\u0002/g, '{$1}').replace(/\u0003/g, ''), file);
  const isHtml = /<\/?[a-z][^>]*>/i.test(str);
  const text = str.replace(/<[^>]*>/g, '\u0003');
  for (const seg of text.split('\u0003')) add(seg.replace(/\u0001(\d+)\u0002/g, '{$1}'), file, isHtml);
}

function calleeName(c) {
  if (!c) return '';
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression') return `${calleeName(c.object)}.${c.property.name || ''}`;
  return '';
}

function scanJs(file, isMain) {
  const src = fs.readFileSync(file, 'utf8');
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, allowReturnOutsideFunction: true }); } catch (e) { console.warn(`skip ${file}: ${e.message}`); return; }
  const rel = path.relative(ROOT, file);
  const codeContext = (ancestors, node) => {
    const parent = ancestors[ancestors.length - 2];
    if (!parent) return false;
    if (parent.type === 'CallExpression' || parent.type === 'NewExpression') {
      const name = calleeName(parent.callee);
      const last = name.split('.').pop();
      if (name === 'Error' || name === 'MM.toast' || name === 'MM.confirm' || name === 'MM.prompt' || last === 'notify') return false;
      if (CODE_CALLEES.test(name) || CODE_CALLEES.test(last)) return true;
    }
    if (parent.type === 'Property' && parent.key === node) return true;
    if (parent.type === 'Property' && KEY_CODE.test(parent.key.name || parent.key.value || '')) return true;
    if (parent.type === 'BinaryExpression' && ['===', '!==', '==', '!=', 'in', 'instanceof'].includes(parent.operator)) return true;
    if (parent.type === 'SwitchCase' || parent.type === 'ImportDeclaration' || parent.type === 'MemberExpression') return true;
    if (parent.type === 'ArrayExpression') {
      const gp = ancestors[ancestors.length - 3];
      if (gp && gp.type === 'CallExpression' && /includes|has|indexOf/.test(calleeName(gp.callee))) return true;
      if (gp && gp.type === 'MemberExpression' && /includes|indexOf/.test(gp.property?.name || '')) return true;
    }
    return false;
  };
  walk.ancestor(ast, {
    Literal(node, _s, anc) {
      if (typeof node.value !== 'string' || codeContext(anc, node)) return;
      if (/[<>]/.test(node.value)) addTemplate(node.value, rel);
      else if (/\b[\w-]+="/.test(node.value)) { for (const m of node.value.matchAll(/\b(?:title|placeholder|aria-label|data-tip)="([^"]*)"/g)) add(m[1], rel); }
      else add(node.value, rel);
    },
    TemplateLiteral(node, _s, anc) {
      const parent = anc[anc.length - 2];
      if (parent && parent.type === 'TaggedTemplateExpression') return;
      if (codeContext(anc, node)) return;
      const str = templateParts(node, src);
      addTemplate(str, rel);
    },
  });
}

function scanHtml(file) {
  const s = fs.readFileSync(file, 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<head>[\s\S]*?<\/head>/g, '');
  addTemplate(s, path.relative(ROOT, file));
  const title = /<title>([^<]*)<\/title>/.exec(fs.readFileSync(file, 'utf8'));
  if (title) add(title[1], path.relative(ROOT, file));
}

function collect() {
  for (const d of RENDERER) for (const f of fs.readdirSync(path.join(ROOT, d))) if (f.endsWith('.js') && !SKIP_FILES.has(f)) scanJs(path.join(ROOT, d, f), false);
  for (const d of MAIN) for (const f of fs.readdirSync(path.join(ROOT, d))) if (f.endsWith('.js') && !SKIP_FILES.has(f)) scanJs(path.join(ROOT, d, f), true);
  for (const f of ['index.html', 'mini.html']) scanHtml(path.join(ROOT, 'src/renderer', f));
  // Text that looks like UI but never is (code fragments, generator word lists).
  const ignore = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/ignore.json'), 'utf8')));
  for (const k of [...keys.keys()]) if (ignore.has(k)) keys.delete(k);
  // Status words and other text that only appears as data values.
  for (const k of JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/extra.json'), 'utf8'))) add(k, 'extra', true, true);
  return keys;
}

if (require.main === module) {
  collect();
  const sorted = [...keys.keys()].sort((a, b) => a.localeCompare(b));
  const dir = path.join(ROOT, 'src', 'i18n');
  if (process.argv.includes('--check')) {
    let bad = 0;
    for (const f of fs.readdirSync(dir).filter(x => /^[a-z]{2}\.json$/.test(x))) {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const miss = sorted.filter(k => !(k in d));
      // A translation may leave out a placeholder (e.g. an English plural "s") but must not invent one.
      const ph = Object.entries(d).filter(([k, v]) => (v.match(/\{\d\}/g) || []).some(p => !k.includes(p))).map(([k]) => k);
      console.log(`${f}: ${Object.keys(d).length} entries, ${miss.length} missing, ${ph.length} placeholder mismatches`);
      if (miss.length || ph.length) { bad++; miss.slice(0, 15).forEach(k => console.log(`  missing: ${k}`)); ph.slice(0, 15).forEach(k => console.log(`  placeholders: ${k}`)); }
    }
    process.exit(bad ? 1 : 0);
  }
  fs.writeFileSync(path.join(dir, 'keys.json'), `${JSON.stringify(sorted, null, 0).replace(/","/g, '",\n"')}\n`);
  fs.writeFileSync(path.join(dir, 'keys-context.tsv'), sorted.map(k => `${k}\t${[...keys.get(k)].join(',')}`).join('\n'));
  console.log(`${sorted.length} keys, ${sorted.join(' ').split(/\s+/).length} words`);
}

module.exports = { collect, looksLikeText };
