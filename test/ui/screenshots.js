// Renders every page with the mock API in headless Chrome and saves screenshots.
// Usage: node test/ui/screenshots.js <outDir>
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require(process.env.PW_PATH || 'playwright');

const root = path.join(__dirname, '..', '..', 'src', 'renderer');
const out = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text() + (m.location().url || ''))) errors.push(`console: ${m.text()}`); });
  await page.addInitScript({ path: path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'demo', 'demo-api.js') });
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, '00-loading.png') });
  await page.waitForTimeout(1500);
  const pages = ['dashboard', 'accounts', 'creator', 'sessions', 'performance', 'trimmer', 'automation', 'discord', 'updates', 'settings', 'watcher', 'presets', 'servers'];
  let i = 1;
  for (const p of pages) {
    await page.evaluate(n => MM.go(n), p);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, `${String(i++).padStart(2, '0')}-${p}.png`), fullPage: false });
  }
  // servers: load browser + friends
  await page.evaluate(() => MM.go('servers'));
  await page.waitForTimeout(500);
  await page.click('.chip');
  await page.fill('#sv-input', '920587237');
  await page.click('[data-act="load"]');
  await page.click('[data-act="friends"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '17-servers-loaded.png') });
  await page.evaluate(() => MM.go('performance'));
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('p-lim-card').scrollIntoView());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '18-limiter.png') });
  await page.evaluate(() => { MM.go('presets'); });
  await page.waitForTimeout(500);
  await page.click('[data-act="edit"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '19-preset-editor.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { MM.showSessionLog('s1', 'Main'); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '20-log-viewer.png') });
  await page.keyboard.press('Escape');
  // Discord page cards
  await page.evaluate(() => MM.go('discord'));
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('rc-card').scrollIntoView());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '22-discord-remote.png') });
  // watcher memory guard + outfits
  await page.evaluate(() => MM.go('watcher'));
  await page.waitForTimeout(700);
  await page.evaluate(() => document.getElementById('w-mem').scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, '25-memguard.png') });
  await page.evaluate(() => MM.go('accounts'));
  await page.waitForTimeout(500);
  await page.click('[data-act="outfits"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, '26-outfits.png') });
  await page.keyboard.press('Escape');
  // stats page + resume prompt
  await page.evaluate(() => MM.go('stats'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, '27-stats.png') });
  await page.evaluate(() => document.getElementById('st-heat').scrollIntoView());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '28-stats-heat.png') });
  await page.evaluate(() => { MM.go('servers'); });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, '29-follow.png') });
  await page.evaluate(() => { window.__showResume = true; MM.offerResume(); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, '30-resume.png') });
  await page.keyboard.press('Escape');
  // v1.6 screens
  for (const [n, file] of [['card', '40-profile-card'], ['capacity', '41-capacity'], ['theme', '42-theme']]) {
    await page.evaluate(x => MM.go(x), n);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, `${file}.png`) });
  }
  await page.evaluate(() => MM.go('watcher'));
  await page.waitForTimeout(700);
  await page.evaluate(() => document.getElementById('w-guards').scrollIntoView());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '43-guards.png') });
  await page.evaluate(() => MM.go('accounts'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, '44-accounts-v16.png') });
  await page.click('[data-act="edit"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, '45-account-edit.png') });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(500);
  await page.keyboard.type('farm');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '46-palette.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.mm._emit('clipboard:link', { url: 'https://www.roblox.com/share?code=abc123DEF&type=Server', target: { shareCode: 'abc123DEF', shareType: 'Server' } }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, '47-copied-link.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { MM.openSleepTimer(); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '48-sleep-timer.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { MM.state.settings.appearance.accentHue = 220; MM.state.settings.appearance.theme = { ...MM.state.settings.appearance.theme, secondaryHue: 180, glow: 160 }; MM.applyAppearance(); MM.go('dashboard'); });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, '49-theme-ocean.png') });
  await page.evaluate(() => { MM.state.settings.appearance.accentHue = 270; MM.state.settings.appearance.theme = { ...MM.state.settings.appearance.theme, secondaryHue: 295, glow: 100 }; MM.applyAppearance(); });
  await page.evaluate(() => { window.__showResume = false; MM.go('settings'); });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('lc-card').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '50-settings-ports.png') });
  await page.evaluate(() => { MM.go('sessions'); });
  await page.waitForTimeout(500);
  await page.evaluate(() => MM.go('settings'));
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById('ab-card').scrollIntoView());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '31-autobackup.png') });
  // wizard
  await page.evaluate(() => { MM.runWizard(); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '23-wizard-welcome.png') });
  await page.click('[data-w="next"]');
  await page.waitForTimeout(500);
  await page.click('[data-w="next"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '24-wizard-windows.png') });
  await page.click('[data-w="skip"]');
  await page.waitForTimeout(400);
  // mini panel
  const mini = await browser.newPage({ viewport: { width: 340, height: 540 } });
  mini.on('pageerror', e => errors.push(`mini pageerror: ${e.message}`));
  await mini.addInitScript({ path: path.join(__dirname, '..', '..', 'src', 'renderer', 'js', 'demo', 'demo-api.js') });
  await mini.goto(`http://localhost:${port}/mini.html`);
  await mini.waitForTimeout(800);
  await mini.screenshot({ path: path.join(out, '21-mini.png') });
  // OpenMulti tiling box, scrolled into view
  await page.evaluate(() => MM.go('sessions'));
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getElementById('tile-card').scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, '15-tiling.png') });
  await page.click('.tile-cell[data-cell="s1"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('#om-list').scrollIntoView());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, '16-sessions-table.png') });
  // Extra states
  await page.evaluate(() => MM.go('automation', { tab: 'macros' }));
  await page.waitForTimeout(300);
  await page.click('[data-act="select"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '11-macros.png') });
  await page.evaluate(() => MM.go('automation', { tab: 'afk' }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, '12-antiafk.png') });
  await page.evaluate(() => { MM.showUpdatePopup({ current: '1.0.0', latest: { version: '2.0.0', notes: 'x' } }); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, '13-update-popup.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.body.classList.add('collapsed'); MM.go('dashboard'); });
  await page.click('#tb-bell');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, '14-collapsed-notifications.png') });
  await browser.close();
  server.close();
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'No page errors');
  process.exit(errors.length ? 1 : 0);
})();
