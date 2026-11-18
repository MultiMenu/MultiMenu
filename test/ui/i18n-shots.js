// Screenshots of key screens in a language: node test/ui/i18n-shots.js <lang> <outDir>
const path = require('path'); const http = require('http'); const fs = require('fs');
const { chromium } = require(process.env.PW_PATH || 'playwright');
const root = path.join(__dirname, '..', '..', 'src', 'renderer');
const lang = process.argv[2] || 'en'; const out = process.argv[3] || '/tmp/i18n-shots'; fs.mkdirSync(out, { recursive: true });
const dict = lang === 'en' ? {} : JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'i18n', `${lang}.json`), 'utf8'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => { const p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
(async () => {
  await new Promise(r => server.listen(0, r)); const port = server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(`window.__MM_LANG = ${JSON.stringify(lang)}; window.__MM_I18N = ${JSON.stringify({ lang, dict })};`);
  await page.addInitScript({ path: path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'demo', 'demo-api.js') });
  await page.goto(`http://localhost:${port}/index.html`); await page.waitForTimeout(2300);
  const shot = async (n) => page.screenshot({ path: path.join(out, `${lang}-${n}.png`) });
  for (const p of ['dashboard', 'accounts', 'sessions', 'watcher', 'settings', 'performance']) { await page.evaluate(n => MM.go(n), p); await page.waitForTimeout(600); await shot(p); }
  await page.evaluate(() => { MM.runWizard(); }); await page.waitForTimeout(400); await page.click('.wizard [data-w="next"]'); await page.waitForTimeout(500); await shot('wizard-roblox');
  await page.click('.wizard [data-w="next"]'); await page.waitForTimeout(500); await shot('wizard-accounts');
  await page.click('.wizard [data-w="next"]'); await page.waitForTimeout(500); await shot('wizard-pc');
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  await page.evaluate(() => { MM.pickLanguage({ first: true }); }); await page.waitForTimeout(400); await shot('language');
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  await page.evaluate(() => { MM.openRamImport(); }); await page.waitForTimeout(400); await shot('ramimport');
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(m => m.remove()));
  await page.setViewportSize({ width: 340, height: 540 }); await page.goto(`http://localhost:${port}/mini.html`); await page.waitForTimeout(900); await shot('mini');
  await page.click('#m-compact'); await page.setViewportSize({ width: 300, height: 92 }); await page.waitForTimeout(400); await shot('mini-compact');
  console.log(lang, 'done', errors.length ? `errors: ${errors.join(' | ')}` : '');
  await browser.close(); server.close();
})();
