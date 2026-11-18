'use strict';
// The phone page on a bad connection: a relay between the phone and MultiMenu cuts every
// connection every 2.5 s, then goes away for a while, then comes back. The page should keep
// updating without error pop-ups, show "Can't reach your PC" only while the PC is gone, and
// not redraw under a finger.
// Usage: PW_PATH=/path/to/playwright node test/ui/phone-drop.js [screenshot-dir]
require('../helpers/electron-stub');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { chromium, devices } = require(process.env.PW_PATH || 'playwright');

const paths = require('../../src/main/paths');
paths.ensureDirs();
const settings = require('../../src/main/modules/settings');
settings.init();
require('../../src/main/modules/accounts').init();
require('../../src/main/modules/presets').init();
const ph = require('../../src/main/modules/phone');

const out = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  ph.setPin('604213');
  settings.set('phone.allowControl', true);
  settings.set('phone.port', 43891);
  await ph.start();

  // The relay: phone -> 43892 -> MultiMenu (43891). It can cut connections or go away.
  const socks = new Set();
  let up = true;
  const relay = net.createServer((c) => {
    if (!up) { c.destroy(); return; }
    const s = net.connect(43891, '127.0.0.1');
    socks.add(c); socks.add(s);
    c.pipe(s); s.pipe(c);
    const end = () => { c.destroy(); s.destroy(); socks.delete(c); socks.delete(s); };
    c.on('error', end); s.on('error', end); c.on('close', end); s.on('close', end);
  });
  await new Promise(r => relay.listen(43892, '127.0.0.1', r));
  const cutAll = () => { for (const x of socks) x.destroy(); socks.clear(); };

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const toasts = [];
  await page.exposeFunction('__toast', (t) => toasts.push(t));
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => { const el = document.getElementById('toast'); if (el && el.classList.contains('on')) window.__toast(el.textContent); })
        .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
  });

  await page.goto('http://127.0.0.1:43892/');
  await page.fill('#pin', '604213');
  await page.click('button[type=submit]');
  await page.waitForSelector('.stats', { timeout: 10000 });
  const stamp = () => page.$eval('.foot:last-of-type', el => el.textContent).catch(() => '');
  const banner = () => page.$eval('#net', el => !el.classList.contains('hidden')).catch(() => false);

  // 1) Flaky: every connection is cut every 2.5 s for 25 s.
  const first = await stamp();
  const cutter = setInterval(cutAll, 2500);
  let bannerSeen = false;
  for (let i = 0; i < 25; i++) { await sleep(1000); if (await banner()) bannerSeen = true; }
  clearInterval(cutter);
  const afterFlaky = await stamp();
  const flakyToasts = toasts.length;

  // 2) Gone: the PC can't be reached for 12 s.
  up = false; cutAll();
  await sleep(12000);
  const goneBanner = await banner();
  await page.screenshot({ path: path.join(out, 'phone-offline.png') });

  // 3) Back.
  up = true;
  await sleep(8000);
  const backBanner = await banner();

  // 4) No redraw under a finger: hold a button, force a refresh, the button is the same element.
  const held = await page.evaluate(async () => {
    const b = document.querySelector('[data-act]');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    window.dispatchEvent(new Event('online')); // asks for a refresh now
    await new Promise(r => setTimeout(r, 1500));
    const same = document.contains(b);
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await new Promise(r => setTimeout(r, 900));
    return { same, replacedAfter: !document.contains(b) };
  });
  await page.screenshot({ path: path.join(out, 'phone-ok.png') });

  const res = {
    toastTexts: [...new Set(toasts)].slice(0, 5),
    updatedWhileFlaky: afterFlaky !== first, flakyBanner: bannerSeen, flakyToasts,
    offlineBanner: goneBanner, bannerGoneWhenBack: !backBanner,
    heldButtonKept: held.same, redrawnAfterRelease: held.replacedAfter, pageErrors: errors,
  };
  console.log(JSON.stringify(res, null, 1));
  await browser.close(); relay.close(); ph.stop();
  const ok = res.updatedWhileFlaky && !res.flakyBanner && res.flakyToasts === 0 && res.offlineBanner && res.bannerGoneWhenBack && res.heldButtonKept && res.redrawnAfterRelease && !errors.length;
  console.log(ok ? 'PHONE DROP TEST PASSED' : 'PHONE DROP TEST FAILED');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
