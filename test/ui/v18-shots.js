// Screenshots of the 1.8 features with the mock API (and a mock phone server).
// Usage: node test/ui/v18-shots.js <outDir>
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require(process.env.PW_PATH || 'playwright');

const ROOT = path.join(__dirname, '..', '..');
const out = process.argv[2] || path.join(__dirname, 'out18');
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
const LANG = process.env.MM_LANG || 'en';
const dict = LANG === 'en' ? {} : JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'i18n', `${LANG}.json`), 'utf8'));

function serve(dir, extra) {
  return http.createServer(async (req, res) => {
    if (extra && await extra(req, res)) return;
    const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
}

const now = Date.now();
const phoneData = {
  at: now, control: true, lang: LANG,
  sessions: [
    { id: 's1', label: 'Main', status: 'running', state: 'in game', game: 'Adopt Me!', since: now - 2400e3, watched: true, memMB: 1240 },
    { id: 's2', label: 'Farm 2', status: 'running', state: 'not responding', game: 'Adopt Me!', since: now - 900e3, watched: true, memMB: 980 },
    { id: 's5', label: 'Violet', status: 'launching', state: 'loading', game: 'Pet Simulator 99', since: now - 60e3, watched: true, memMB: 610 },
  ],
  presets: [{ id: 'pr1', name: 'Morning farm', count: 3 }, { id: 'pr2', name: 'Squad night', count: 5 }],
  pc: { cpu: 34, ram: 66 }, watcher: { enabled: true, queued: 1 },
};

(async () => {
  const qr = await require('qrcode').toString('http://192.168.1.42:43821', { type: 'svg', margin: 1, color: { dark: '#0d0717', light: '#ffffff' } });
  const app = serve(path.join(ROOT, 'src', 'renderer'));
  const phone = serve(path.join(ROOT, 'src', 'phone'), async (req, res) => {
    const u = req.url.split('?')[0];
    const json = (o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); return true; };
    if (u === '/translate.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(fs.readFileSync(path.join(ROOT, 'src/renderer/js/translate.js'))); return true; }
    if (u === '/icon.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(fs.readFileSync(path.join(ROOT, 'build/icon.png'))); return true; }
    if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(path.join(ROOT, 'src/phone/index.html'))); return true; }
    if (u === '/api/i18n') return json({ lang: LANG, dict });
    if (u === '/api/login') return json({ token: 'a'.repeat(64), expiresIn: 43200000 });
    if (u === '/api/status') return json(phoneData);
    return false;
  });
  await new Promise(r => app.listen(0, r));
  await new Promise(r => phone.listen(0, r));
  const ap = app.address().port, pp = phone.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const errors = [];

  async function open(flags = {}, viewport = { width: 1440, height: 900 }) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|404|getDisplayMedia/.test(m.text())) errors.push(`console: ${m.text()}`); });
    await page.addInitScript((f) => { Object.assign(window, f); }, { __MM_QR: qr, __MM_LANG: LANG, __MM_I18N: { lang: LANG, dict }, ...flags });
    await page.addInitScript({ path: path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'demo', 'demo-api.js') });
    return page;
  }
  const shot = (page, name, opts) => page.screenshot({ path: path.join(out, `${name}.png`), ...opts });

  // 1. Bulk edit
  let page = await open();
  await page.goto(`http://localhost:${ap}/index.html`);
  await page.waitForTimeout(1800);
  await page.evaluate(() => MM.go('accounts'));
  await page.waitForTimeout(700);
  for (const i of [1, 2, 3]) await page.locator('.acc [data-act="select"]').nth(i).click();
  await page.waitForTimeout(200);
  await shot(page, '01-accounts-selected');
  await page.click('[data-act="bulkEdit"]');
  await page.waitForTimeout(400);
  await page.selectOption('#b-group', 'Alts');
  await page.selectOption('#b-q', '1');
  await page.selectOption('#b-fps', '30');
  await page.fill('#b-notes', 'AFK farm alt');
  await page.waitForTimeout(250);
  await shot(page, '02-bulk-edit');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.getElementById('acc-health').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(250);
  const hb = await page.$('#acc-health');
  await hb.screenshot({ path: path.join(out, '03-login-warnings.png') });

  // 2. Tiling extras
  await page.evaluate(() => MM.go('sessions'));
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('.tile-extras').scrollIntoView({ block: 'end' }));
  await page.waitForTimeout(300);
  await shot(page, '04-focus-pip-monitors');
  await (await page.$('.tile-extras')).screenshot({ path: path.join(out, '05-tile-extras.png') });

  // 3. Watcher stuck loading
  await page.evaluate(() => MM.go('watcher'));
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelector('[data-setting="watcher.stuckMin"]').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(250);
  await shot(page, '06-watcher-stuck');

  // 4. Settings search + phone card
  await page.evaluate(() => MM.go('settings'));
  await page.waitForTimeout(700);
  await page.fill('#set-q', 'memory');
  await page.waitForTimeout(300);
  await shot(page, '07-settings-search');
  await page.fill('#set-q', 'watcher');
  await page.waitForTimeout(300);
  await shot(page, '08-settings-search-other');
  await page.fill('#set-q', '');
  await page.evaluate(() => document.getElementById('ph-card').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
  await (await page.$('#ph-card')).screenshot({ path: path.join(out, '09-phone-card.png') });
  await page.fill('#set-q', 'diet');
  await page.waitForTimeout(300);
  await shot(page, '10-diet');
  await page.close();

  // 5. Tour + safe mode
  page = await open({ __MM_TOUR: true, __MM_SAFE: 'crashLoop' });
  await page.goto(`http://localhost:${ap}/index.html`);
  await page.waitForTimeout(3200);
  await shot(page, '11-tour-dashboard');
  await page.click('.tour-tip [data-t="next"]');
  await page.waitForTimeout(500);
  await shot(page, '12-tour-step2');
  await page.keyboard.press('Escape');
  await page.evaluate(() => MM.go('sessions'));
  await page.waitForTimeout(2200);
  await shot(page, '13-tour-sessions');
  await page.close();

  // 6. PiP window (fake stream from a canvas)
  page = await open({}, { width: 420, height: 266 });
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
      const g = c.getContext('2d');
      const draw = (t) => {
        const sky = g.createLinearGradient(0, 0, 0, 720); sky.addColorStop(0, '#6ec3ff'); sky.addColorStop(1, '#bfe7ff'); g.fillStyle = sky; g.fillRect(0, 0, 1280, 720);
        g.fillStyle = '#4caf50'; g.fillRect(0, 470, 1280, 250);
        g.fillStyle = '#8d6e63'; g.fillRect(180, 300, 260, 170); g.fillStyle = '#c62828'; g.beginPath(); g.moveTo(160, 300); g.lineTo(310, 200); g.lineTo(460, 300); g.fill();
        g.fillStyle = '#ffeb3b'; g.fillRect(620 + Math.sin(t / 400) * 40, 380, 50, 90); g.fillStyle = '#ffcc80'; g.fillRect(625 + Math.sin(t / 400) * 40, 330, 40, 45);
        g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(20, 20, 300, 60); g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.fillText('Coins: 48,210', 40, 62);
        requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
      return c.captureStream(15);
    };
  });
  await page.goto(`http://localhost:${ap}/pip.html`);
  await page.evaluate(() => window.mm._emit('pip:target', { target: 's2', label: 'Farm 2', fps: 15, sessions: [{ id: 's1', label: 'Main' }, { id: 's2', label: 'Farm 2' }] }));
  await page.waitForTimeout(1200);
  await shot(page, '14-pip');
  await page.close();

  // 7. Phone dashboard
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => errors.push(`phone pageerror: ${e.message}`));
  await page.goto(`http://localhost:${pp}/`);
  await page.waitForTimeout(600);
  await page.fill('#pin', '4829');
  await shot(page, '15-phone-login');
  await page.fill('#pin', '482913');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(700);
  await shot(page, '16-phone-dashboard', { fullPage: true });
  await page.close();

  await browser.close(); app.close(); phone.close();
  console.log(errors.length ? errors.join('\n') : 'no errors');
})().catch(e => { console.error(e); process.exit(1); });
