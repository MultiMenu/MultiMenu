// Screenshots of pages in light mode / compact / high contrast.
// Usage: PW_PATH=... node test/ui/look-shots.js <outDir> <mode> <density> <contrast> [pages]
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require(process.env.PW_PATH || 'playwright');

const ROOT = path.join(__dirname, '..', '..');
const [out = '/tmp/look', mode = 'light', density = 'comfortable', contrast = 'normal', list] = process.argv.slice(2);
const pages = (list || 'dashboard,accounts,sessions,settings,perf,wall,rules,stats,gallery,watcher').split(',');
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };

(async () => {
  const dir = path.join(ROOT, 'src', 'renderer');
  const app = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => app.listen(0, r));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.addInitScript((f) => { Object.assign(window, f); }, { __MM_LANG: 'en', __MM_I18N: { lang: 'en', dict: {} }, __MM_MODE: mode, __MM_DENSITY: density, __MM_CONTRAST: contrast });
  await page.addInitScript({ path: path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'demo', 'demo-data.js') });
  await page.addInitScript({ path: path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'demo', 'demo-api.js') });
  await page.goto(`http://localhost:${app.address().port}/index.html`);
  await page.waitForTimeout(1600);
  const tag = [mode, density === 'compact' ? 'compact' : '', contrast === 'high' ? 'hc' : ''].filter(Boolean).join('-');
  for (const id of pages) {
    await page.evaluate((x) => MM.go(x), id);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, `${tag}-${id}.png`) });
  }
  await browser.close(); app.close();
  console.log(errors.length ? [...new Set(errors)].join('\n') : 'no errors');
})().catch(e => { console.error(e); process.exit(1); });
