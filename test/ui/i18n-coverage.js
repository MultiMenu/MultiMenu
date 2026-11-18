// Finds interface text that has no translation: renders every page with a fake
// language where every known string is wrapped in ⟦…⟧, then lists visible text that isn't.
// Usage: node test/ui/i18n-coverage.js [lang]   (no lang = fake language)
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require(process.env.PW_PATH || 'playwright');

const root = path.join(__dirname, '..', '..', 'src', 'renderer');
const lang = process.argv[2];
const keys = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'i18n', 'keys.json'), 'utf8'));
const dict = lang ? JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'i18n', `${lang}.json`), 'utf8')) : Object.fromEntries(keys.map(k => [k, `⟦${k}⟧`]));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const COLLECT = (fake) => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const v = n.data.replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z]{2}/.test(v)) continue;
    let skip = false;
    for (let e = n.parentElement; e; e = e.parentElement) if (/^(SCRIPT|STYLE|CODE|PRE|KBD|TEXTAREA)$/.test(e.tagName) || (e.dataset && 'nt' in e.dataset)) { skip = true; break; }
    if (skip) continue;
    if (fake ? !v.includes('⟦') : true) out.push(v);
  }
  for (const el of document.querySelectorAll('[title],[placeholder]')) for (const a of ['title', 'placeholder']) { const v = el.getAttribute(a); if (v && /[A-Za-z]{2}/.test(v) && (fake ? !v.includes('⟦') : true)) out.push(`@${a}: ${v}`); }
  return out;
};

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(`window.__MM_LANG = ${JSON.stringify(lang || 'es')}; window.__MM_I18N = ${JSON.stringify({ lang: lang || 'xx', dict })};`);
  await page.addInitScript({ path: path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'demo', 'demo-data.js') });
  await page.addInitScript({ path: path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'demo', 'demo-api.js') });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForTimeout(2200);
  const seen = new Map();
  const grab = async (where) => { for (const v of await page.evaluate(COLLECT, !lang)) if (!seen.has(v)) seen.set(v, where); };
  const pages = await page.evaluate(() => Object.keys(MM.pages));
  for (const p of pages) {
    await page.evaluate(n => MM.go(n), p); await page.waitForTimeout(500); await grab(p);
    // scroll so lazy parts render
    await page.evaluate(() => { const m = document.getElementById('main'); if (m) m.scrollTop = 99999; }); await page.waitForTimeout(150); await grab(p);
  }
  // wizard, every step
  await page.evaluate(() => { MM.runWizard(); });
  for (let i = 0; i < 9; i++) { await page.waitForTimeout(350); await grab('wizard'); await page.click('.wizard [data-w="next"]').catch(() => {}); }
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  await page.evaluate(() => { MM.pickLanguage(); }); await page.waitForTimeout(300); await grab('language');
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  await page.evaluate(() => { MM.openRamImport(); }); await page.waitForTimeout(300); await grab('ramImport');
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  await page.click('#tb-bell').catch(() => {}); await page.waitForTimeout(300); await grab('drawer');
  // mini panel
  await page.goto(`http://localhost:${port}/mini.html`); await page.waitForTimeout(900); await grab('mini');
  await page.click('#m-compact').catch(() => {}); await page.waitForTimeout(300); await grab('mini-compact');
  const miss = [...seen.entries()];
  fs.writeFileSync('/tmp/i18n-miss.txt', miss.map(([v, w]) => `${w}\t${v}`).join('\n'));
  console.log(`${miss.length} untranslated strings on screen${errors.length ? `; errors: ${errors.join(' | ')}` : ''}`);
  await browser.close(); server.close();
})();
