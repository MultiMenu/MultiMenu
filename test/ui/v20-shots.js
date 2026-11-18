// Screenshots of the 2.0 pages with the mock API.
// Usage: PW_PATH=... node test/ui/v20-shots.js <outDir> [only,these,names]
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require(process.env.PW_PATH || 'playwright');

const ROOT = path.join(__dirname, '..', '..');
const out = process.argv[2] || path.join(__dirname, 'out20');
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
const LANG = process.env.MM_LANG || 'en';
const dict = LANG === 'en' ? {} : JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'i18n', `${LANG}.json`), 'utf8'));

(async () => {
  const dir = path.join(ROOT, 'src', 'renderer');
  const app = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => app.listen(0, r));
  const ap = app.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const errors = [];
  async function open(flags = {}, viewport = { width: 1440, height: 900 }) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
    await page.addInitScript((f) => { Object.assign(window, f); }, { __MM_LANG: LANG, __MM_I18N: { lang: LANG, dict }, ...flags });
    await page.addInitScript({ path: path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'demo', 'demo-data.js') });
    await page.addInitScript({ path: path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'demo', 'demo-api.js') });
    await page.goto(`http://localhost:${ap}/${flags.__PAGE || 'index.html'}`);
    await page.waitForTimeout(1600);
    return page;
  }
  const shot = (page, name, opts) => (!only || only.has(name)) && page.screenshot({ path: path.join(out, `${name}.png`), ...opts });
  const go = async (page, id, wait = 700) => { await page.evaluate((x) => MM.go(x), id); await page.waitForTimeout(wait); };

  const page = await open();
  await go(page, 'dashboard', 1200);
  await shot(page, 'dashboard');
  await page.click('[data-act="customise"]');
  await page.waitForTimeout(1000);
  await shot(page, 'dashboard-edit');
  await page.click('[data-act="wDone"]');
  await page.waitForTimeout(600);
  await page.keyboard.press('Shift+Slash');
  await page.waitForTimeout(500);
  await shot(page, 'shortcuts');
  await page.keyboard.press('Escape');
  await go(page, 'perf');
  await shot(page, 'perf-top');
  await page.evaluate(() => document.querySelector('.pf-tune').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  await shot(page, 'perf-tune');
  await page.click('[data-act="measure"]');
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('#pf-pc').scrollIntoView({ block: 'center' }));
  await shot(page, 'perf-measured');
  await page.click('[data-preset="maxAlts"]');
  await page.waitForTimeout(500);
  await shot(page, 'perf-review');
  await page.keyboard.press('Escape');

  await go(page, 'wall', 1200);
  await shot(page, 'wall');
  await go(page, 'scaling');
  await shot(page, 'scaling');
  await go(page, 'rules');
  await shot(page, 'rules');
  await page.click('[data-act="edit"]');
  await page.waitForTimeout(500);
  await shot(page, 'rules-editor');
  await page.keyboard.press('Escape');
  await go(page, 'timeline');
  await shot(page, 'timeline');
  await go(page, 'achievements');
  await shot(page, 'achievements');
  await go(page, 'doctor', 1000);
  await shot(page, 'doctor');
  await go(page, 'accounts', 900);
  await shot(page, 'accounts');
  await page.click('[data-act="bin"]');
  await page.waitForTimeout(500);
  await shot(page, 'accounts-bin');
  await page.keyboard.press('Escape');
  await go(page, 'stats', 900);
  await shot(page, 'stats-insights');
  await page.evaluate(() => MM.playWrapped('month'));
  await page.waitForTimeout(1500);
  await shot(page, 'wrapped-1');
  for (let i = 0; i < 8; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150); }
  await page.waitForTimeout(700);
  await shot(page, 'wrapped-card');
  await page.keyboard.press('Escape');
  await go(page, 'settings', 900);
  await page.evaluate(() => document.getElementById('api-card').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  await shot(page, 'settings-api');
  await page.evaluate(() => document.getElementById('ph-card').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  await shot(page, 'settings-phone');
  await page.click('[data-act="phCheck"]');
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('.ph-check').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await shot(page, 'settings-phone-check');
  await go(page, 'gallery', 900);
  await shot(page, 'gallery');
  await page.click('#gal-online [data-act="try"]');
  await page.waitForTimeout(500);
  await shot(page, 'gallery-trying');
  await page.click('[data-act="back"]');
  await go(page, 'presets', 900);
  await page.click('[data-act="share"]');
  await page.waitForTimeout(600);
  await shot(page, 'share-preset');
  await page.keyboard.press('Escape');
  await page.click('[data-act="importCode"]');
  await page.waitForTimeout(900);
  await shot(page, 'import-rule');
  await page.keyboard.press('Escape');
  await go(page, 'theme', 700);
  await shot(page, 'theme-head', { clip: { x: 236, y: 0, width: 1204, height: 260 } });
  await go(page, 'sessions', 900);
  await page.evaluate(() => document.querySelector('.tile-actions').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await shot(page, 'sessions-share');
  await page.click('[data-layout="tiny"]');
  await page.waitForTimeout(700);
  await page.evaluate(() => document.getElementById('tile-tiny-f').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await shot(page, 'sessions-tiny');
  await page.close();

  const sw = await open({ __PAGE: 'switcher.html' }, { width: 1040, height: 460 });
  await sw.waitForTimeout(600);
  await shot(sw, 'switcher');
  await sw.close();

  await browser.close(); app.close();
  console.log(errors.length ? [...new Set(errors)].join('\n') : 'no errors');
})().catch(e => { console.error(e); process.exit(1); });
