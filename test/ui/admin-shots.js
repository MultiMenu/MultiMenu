// Screenshots of admin mode with the mock API, plus checks that a locked app shows nothing of it.
// Usage: PW_PATH=... node test/ui/admin-shots.js <outDir>
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require(process.env.PW_PATH || 'playwright');

const ROOT = path.join(__dirname, '..', '..');
const DEMO = path.join(ROOT, 'src', 'renderer', 'js', 'demo');
const out = process.argv[2] || path.join(__dirname, 'out-admin');
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
  const ap = app.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const errors = [];
  const fail = (m) => { errors.push(m); console.log(`FAIL ${m}`); };
  async function open(flags = {}, viewport = { width: 1440, height: 900 }) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|404|Admin mode is locked/.test(m.text())) errors.push(`console: ${m.text()}`); });
    await page.addInitScript((f) => { Object.assign(window, f); }, { __MM_LANG: 'en', __MM_I18N: { lang: 'en', dict: {} }, ...flags });
    await page.addInitScript({ path: path.join(DEMO, 'demo-data.js') });
    await page.addInitScript({ path: path.join(DEMO, 'demo-api.js') });
    await page.addInitScript({ path: path.join(__dirname, 'mock-admin.js') });
    await page.goto(`http://localhost:${ap}/index.html`);
    await page.waitForTimeout(1600);
    return page;
  }
  const shot = (page, name, opts) => page.screenshot({ path: path.join(out, `${name}.png`), ...opts });
  const go = async (page, id, wait = 800) => { await page.evaluate((x) => MM.go(x), id); await page.waitForTimeout(wait); };

  // ---- locked: no trace of admin mode ----
  const locked = await open();
  if (await locked.$('[data-page="adm"]')) fail('locked: Admin section visible');
  if (await locked.evaluate(() => MM.adminCommands().length)) fail('locked: admin palette commands present');
  await locked.keyboard.press('Control+k');
  await locked.waitForTimeout(400);
  await locked.keyboard.type('admin');
  await locked.waitForTimeout(300);
  if (await locked.$$eval('.p-item', els => els.some(e => /admin/i.test(e.textContent)))) fail('locked: palette shows admin items for "admin"');
  await locked.keyboard.press('Escape');
  // 7 clicks on the version opens the unlock box
  for (let i = 0; i < 7; i++) await locked.click('.side-foot[data-admin-tap]');
  await locked.waitForTimeout(500);
  if (!await locked.$('#adm-code')) fail('locked: 7 clicks did not open the unlock box');
  await locked.fill('#adm-code', 'MMA-nonsense');
  await locked.click('.modal .btn.primary');
  await locked.waitForTimeout(300);
  await shot(locked, 'unlock-error');
  if (!(await locked.textContent('#adm-err')).includes('damaged')) fail('locked: bad code not explained');
  await locked.keyboard.press('Escape');
  // pasting a code into Ctrl+K offers to unlock
  await locked.keyboard.press('Control+k');
  await locked.waitForTimeout(400);
  await locked.keyboard.type('MMA-abc.def');
  await locked.waitForTimeout(300);
  await shot(locked, 'palette-code');
  if (!await locked.$$eval('.p-item', els => els.some(e => /Unlock admin mode/.test(e.textContent)))) fail('locked: palette does not offer unlock for a code');
  await locked.close();

  // ---- unlocked ----
  const page = await open({ __MM_ADMIN: true });
  if (!await page.$('[data-page="adm"]')) fail('unlocked: Admin section missing');
  await go(page, 'admhome', 2600);
  await shot(page, 'overview');
  await go(page, 'admlive', 900);
  await shot(page, 'live-log');
  await page.evaluate(() => window.mm._adminFeed({ log: [{ at: Date.now(), level: 'WARN', scope: 'live', msg: 'A line that arrived live' }], bus: [], ipc: [{ at: Date.now(), channel: 'accounts:list', ms: 4.2, ok: true }], net: [] }));
  await page.waitForTimeout(500);
  if (!(await page.textContent('#lv-body')).includes('arrived live')) fail('live: pushed line not shown');
  for (const v of ['bus', 'ipc', 'net']) { await page.click(`#lv-view [data-v="${v}"]`); await page.waitForTimeout(250); await shot(page, `live-${v}`); }
  await page.click('#lv-view [data-v="ipc"]');
  await page.click('#lv-ipc [data-v="calls"]');
  await page.waitForTimeout(250);
  await shot(page, 'live-ipc-calls');
  await go(page, 'admdata', 900);
  await shot(page, 'data-settings');
  await page.fill('#st-q', 'tiling');
  await page.waitForTimeout(250);
  await shot(page, 'data-settings-filter');
  await page.click('#dt-view [data-v="files"]');
  await page.waitForTimeout(500);
  await page.click('[data-file="accounts.json"]');
  await page.waitForTimeout(400);
  await shot(page, 'data-files');
  if ((await page.textContent('#fv-body')).includes('enc:v1')) fail('data: secret visible');
  await page.click('#dt-view [data-v="snapshots"]');
  await page.waitForTimeout(500);
  await shot(page, 'data-snapshots');
  await page.click('#dt-view [data-v="achievements"]');
  await page.waitForTimeout(500);
  await shot(page, 'data-achievements');
  await page.click('#dt-view [data-v="settings"]');
  await page.waitForTimeout(500);
  if (!await page.$('#st-list')) fail('data: switching back to settings failed');
  await go(page, 'admwin', 900);
  await shot(page, 'windows');
  await page.click('[data-menu="2"]');
  await page.waitForTimeout(300);
  await shot(page, 'windows-menu');
  await page.keyboard.press('Escape');
  await go(page, 'admtools', 900);
  await shot(page, 'tools');
  await page.click('[data-act="releases"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('.adm-page').parentElement.scrollTo(0, 0));
  await shot(page, 'tools-releases');
  await page.evaluate(() => { const m = document.getElementById('main'); m.scrollTop = m.scrollHeight; });
  await page.waitForTimeout(300);
  await shot(page, 'tools-bottom');
  await go(page, 'admconsole', 900);
  await page.fill('#cs-ch', 'accounts:list');
  await page.click('[data-act="run"]');
  await page.waitForTimeout(500);
  await shot(page, 'console');
  // lab switches: FPS meter, outlines and inspector
  await page.evaluate(() => MM.adminSetFlags({ fps: true, outlines: true, inspector: true }));
  await go(page, 'dashboard', 1500);
  await page.mouse.move(700, 300);
  await page.waitForTimeout(600);
  await shot(page, 'lab-switches');
  if (!await page.$('#adm-fps')) fail('lab: FPS meter missing');
  await page.evaluate(() => MM.adminSetFlags({ fps: false, outlines: false, inspector: false }));
  await page.waitForTimeout(300);
  if (await page.$('#adm-fps') || await page.$('#adm-insp')) fail('lab: switches did not turn off');
  // palette lists admin commands when unlocked
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(400);
  await page.keyboard.type('admin');
  await page.waitForTimeout(300);
  await shot(page, 'palette-admin');
  await page.keyboard.press('Escape');
  await page.close();

  // light mode
  const light = await open({ __MM_ADMIN: true, __MM_MODE: 'light' });
  await go(light, 'admhome', 2400);
  await shot(light, 'overview-light');
  await go(light, 'admlive', 900);
  await shot(light, 'live-light');
  await light.close();

  await browser.close();
  app.close();
  const unique = [...new Set(errors)];
  console.log(unique.length ? `ERRORS:\n${unique.join('\n')}` : 'no page errors');
  process.exit(unique.length ? 1 : 0);
})();
