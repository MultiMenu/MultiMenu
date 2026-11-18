'use strict';
// `MultiMenu.exe --self-test` runs every native and storage check, loads the UI
// in a hidden window, writes a report to <data>/selftest.json and exits.
// Exit code 0 = all passed, 1 = something failed.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

async function run({ mainWindowOptions } = {}) {
  const paths = require('./paths');
  paths.ensureDirs();
  const results = [];
  const progress = path.join(paths.dataDir, 'selftest-progress.log');
  fs.writeFileSync(progress, '');
  const check = async (name, fn) => {
    fs.appendFileSync(progress, `START ${name}\n`);
    try { const detail = await fn(); results.push({ name, ok: true, detail: detail ?? null }); }
    catch (e) { results.push({ name, ok: false, error: e.message }); }
    fs.appendFileSync(progress, `${results.at(-1).ok ? 'OK' : 'FAIL'} ${name} ${JSON.stringify(results.at(-1).detail ?? results.at(-1).error)}\n`);
  };
  const win32 = require('./native/win32');
  // Wine's input layer blocks without a display session, so input checks are skipped there.
  const wine = win32.available && win32.isWine();
  const WINE_SKIP = { skipped: 'Not testable under Wine; runs on real Windows' };
  const assert = (c, m) => { if (!c) throw new Error(m); };

  await check('koffi + Win32 bindings load', () => { assert(win32.available, 'win32 not available'); return win32.load().sizes; });
  await check('Struct sizes match Windows x64', () => { const s = win32.load().sizes; assert(s.INPUT === 40 && s.PMC === 72 && s.MEMSTATUS === 64, JSON.stringify(s)); return s; });
  await check('GlobalMemoryStatusEx', () => { const m = win32.memoryStatus(); assert(m && m.total > 0, 'no memory info'); return m; });
  await check('K32EnumProcesses', () => { const p = win32.listPids(); assert(p.length > 0, 'no processes'); return { count: p.length }; });
  await check('Process snapshot (names, memory, CPU time)', () => {
    const s = win32.snapshotProcesses();
    assert(s.length > 0, 'empty snapshot');
    const self = s.find(p => p.pid === process.pid);
    assert(self, 'own process not found');
    assert(self.workingSet > 0, 'no working set for own process');
    return { count: s.length, self: { name: self.name, workingSetMB: Math.round(self.workingSet / 1048576), cpuMs: Math.round(self.cpuMs) } };
  });
  await check('K32EmptyWorkingSet on own process', () => { const r = win32.trimWorkingSet(process.pid); assert(r.ok, 'trim failed'); return { beforeMB: Math.round(r.before / 1048576), afterMB: Math.round(r.after / 1048576) }; });
  await check('GetCursorPos', () => win32.getCursor());
  await check('GetAsyncKeyState', () => (wine ? WINE_SKIP : { shiftDown: win32.isKeyDown(0x10) }));
  await check('SendInput (mouse, harmless zero-scroll)', () => { if (wine) return WINE_SKIP; assert(win32.wheel(0), 'SendInput returned 0'); return 'ok'; });
  await check('SendInput (keyboard, F24 tap)', () => { if (wine) return WINE_SKIP; assert(win32.key(0x87, true) && win32.key(0x87, false), 'SendInput returned 0'); return 'ok'; });
  await check('EnumWindows callback', () => ({ windows: win32.robloxWindows([process.pid]).length }));
  await check('Named mutex create/close', () => { const m = win32.createMutex(`MultiMenu_selftest_${process.pid}`); assert(m.handle, 'no handle'); win32.closeHandle(m.handle); return { alreadyExisted: m.alreadyExisted }; });
  await check('DPAPI encryption round-trip', () => { const s = require('./secure'); const e = s.encrypt('selftest'); assert(s.decrypt(e) === 'selftest', 'mismatch'); return { available: s.available() }; });
  await check('Settings store write', () => { const st = require('./modules/settings'); st.init(); st.store.saveNow(); return { file: paths.file('settings.json') }; });
  await check('Roblox client detection', () => ({ player: require('./modules/sessions').findRobloxPlayer() }));
  await check('Languages load (12 languages)', () => {
    const i18n = require('./i18n');
    const out = {};
    for (const l of i18n.LANGS.map(x => x.id).filter(x => x !== 'en')) { i18n.load(l); const n = Object.keys(i18n.payload().dict).length; assert(n > 1500, `${l}: only ${n}`); out[l] = n; }
    i18n.load('en');
    return out;
  });
  await check('Launcher detection (Roblox / Bloxstrap / Fishstrap)', () => require('./modules/launchers').detect());
  await check('Window placement (SetWindowPos + DWM frame bounds)', async () => {
    const w = new BrowserWindow({ show: false, width: 300, height: 200 });
    try {
      const h = win32.hwndFromBuffer(w.getNativeWindowHandle());
      fs.appendFileSync(progress, `  hwnd decoded\n`);
      const before = win32.windowRect(h);
      fs.appendFileSync(progress, `  GetWindowRect ${JSON.stringify(before)}\n`);
      const borders = win32.invisibleBorders(h);
      fs.appendFileSync(progress, `  DWM borders ${JSON.stringify(borders)}\n`);
      if (wine) return { before, borders, move: 'Not testable under Wine (moving a window crashes Electron there); runs on real Windows' };
      assert(win32.setOuterRect(h, { x: 120, y: 90, width: 640, height: 400 }), 'SetWindowPos failed');
      const r = win32.windowRect(h);
      assert(r && r.x === 120 && r.y === 90 && r.width === 640 && r.height === 400, `rect mismatch ${JSON.stringify(r)}`);
      return { rect: r, borders };
    } finally { w.destroy(); }
  });
  await check('Freeze detection (IsHungAppWindow)', async () => {
    const w = new BrowserWindow({ show: false, width: 200, height: 100 });
    try { return { hung: win32.isHung(win32.hwndFromBuffer(w.getNativeWindowHandle())) }; } finally { w.destroy(); }
  });
  await check('Window rename without waiting, window order, title bars (3.1.1)', async () => {
    const w = new BrowserWindow({ show: false, width: 200, height: 100, title: 'MultiMenu self-test' });
    try {
      const h = win32.hwndFromBuffer(w.getNativeWindowHandle());
      const renamed = await win32.setWindowTitle(h, 'MultiMenu self-test renamed');
      assert(renamed, 'SendMessageTimeout(WM_SETTEXT) failed');
      const stack = win32.windowStack();
      assert(Array.isArray(stack), 'windowStack failed');
      // Restyling a window from a worker thread hangs under Wine (like moving one, above).
      if (wine) return { renamed, windowsInFront: stack.length, titleBar: 'Not testable under Wine; runs on real Windows' };
      const within = (p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('title bar change timed out')), 8000))]);
      const had = await within(win32.setTitleBar(h, false));
      const without = win32.windowStyle(h);
      await within(win32.setTitleBar(h, true, had));
      assert(without === win32.titlelessStyle(had) && win32.windowStyle(h) === had, 'title bar toggle failed');
      return { renamed, windowsInFront: stack.length, titleBar: 'hidden and back' };
    } finally { w.destroy(); }
  });
  await check('Process priority (get/set on own process)', () => {
    const before = win32.getPriority(process.pid);
    assert(win32.setPriority(process.pid, 'normal'), 'SetPriorityClass failed');
    return { before, after: win32.getPriority(process.pid) };
  });
  await check('CPU affinity (get/set on own process)', () => {
    const a = win32.getAffinity(process.pid);
    assert(a && a.system > 0, 'GetProcessAffinityMask failed');
    assert(win32.setAffinity(process.pid, a.process), 'SetProcessAffinityMask failed');
    return a;
  });
  await check('Audio mute helper (PowerShell + Core Audio)', async () => {
    if (wine) return WINE_SKIP;
    const audio = require('./modules/audio');
    try { return { sessionsChanged: await audio.setMute([process.pid], false) }; } finally { audio.stop(); }
  });
  await check('Window capture (screenshots)', async () => {
    if (wine) return WINE_SKIP;
    const { desktopCapturer } = require('electron');
    const s = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 16, height: 16 } });
    return { windowsVisible: s.length };
  });
  await check('Watcher, scheduler and backup logic', () => {
    const b = require('./modules/backup');
    assert(b.decryptJson(b.encryptJson({ ok: 1 }, 'selftest-pass'), 'selftest-pass').ok === 1, 'vault round-trip failed');
    const logs = require('./modules/robloxlogs');
    return { robloxLogs: logs.logsDir(), backoff: require('./modules/watcher').backoffMs(2, { baseDelaySec: 10, maxDelaySec: 600 }) };
  });
  await check('Tiling layouts', () => {
    const t = require('./modules/tiler');
    const r = t.computeLayout('auto', 4, { x: 0, y: 0, width: 1920, height: 1040 }, { gap: 0 });
    assert(r.length === 4 && Math.round(r[0].width) === 960, 'bad layout');
    return { displays: t.listDisplays().length };
  });
  await check('1.8: phone dashboard server (local only, PIN)', async () => {
    const ph = require('./modules/phone');
    assert(ph.isPrivate('192.168.1.5') && ph.isPrivate('::ffff:10.0.0.2') && !ph.isPrivate('8.8.8.8'), 'private IP check');
    assert(ph.hostAllowed('192.168.1.5:43821') && !ph.hostAllowed('evil.example:43821'), 'host check');
    const http = require('http');
    const srv = http.createServer((q, r) => { ph._handle(q, r); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const get = (p, opts = {}) => new Promise((res, rej) => { const q = http.request({ host: '127.0.0.1', port, path: p, method: opts.method || 'GET', headers: opts.headers || {} }, (r) => { let b = ''; r.on('data', c => { b += c; }); r.on('end', () => res({ status: r.statusCode, body: b })); }); q.on('error', rej); if (opts.body) q.write(opts.body); q.end(); });
    const page = await get('/'), status = await get('/api/status'), login = await get('/api/login', { method: 'POST', body: '{"pin":"000000"}', headers: { 'Content-Type': 'application/json' } });
    srv.close();
    assert(page.status === 200 && page.body.includes('phone.js'), `page ${page.status}`);
    assert(status.status === 401, `status without sign-in gave ${status.status}`);
    assert([401, 403].includes(login.status), `wrong PIN gave ${login.status}`);
    return { page: page.status, unauthenticated: status.status, wrongPin: login.status, lan: ph.lanAddresses().length };
  });
  await check('1.8: monitor-setup layouts, focus mode, PiP', async () => {
    const l = require('./modules/layouts'), t = require('./modules/tiler');
    const sig = l.signature(require('electron').screen.getAllDisplays());
    const f = t.focusRects(4, { x: 0, y: 0, width: 1920, height: 1040 }, { ratio: 0.75, gap: 0 });
    assert(f.length === 4 && Math.round(f[0].width) === 1440, 'focus layout');
    require('./modules/pip'); require('./modules/logincheck'); require('./startup');
    const { desktopCapturer } = require('electron');
    const n = wine ? 'skipped (Wine)' : (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })).length;
    return { setup: l.describe(sig), captureSources: n };
  });
  await check('2.0: share codes and theme gallery', () => {
    const sc = require('./modules/sharecodes');
    const built = require('./modules/gallery').builtIn();
    assert(built.length >= 4, `only ${built.length} built-in themes`);
    const back = sc.unpack(built[0].code);
    assert(back.kind === 'theme' && back.data.name === built[0].name, 'theme code round trip');
    let refused = false;
    try { sc.pack('preset', { name: 'x', notes: '_|WARNING:-DO-NOT-SHARE-THIS' }); } catch { refused = true; }
    assert(refused, 'a code carrying a sign-in cookie was made');
    let damaged = false;
    try { sc.unpack(`${built[0].code.slice(0, -1)}${built[0].code.endsWith('0') ? '1' : '0'}`); } catch { damaged = true; }
    assert(damaged, 'a damaged code was opened');
    return { builtIn: built.length, codeLength: built[0].code.length };
  });
  await check('2.0: local API refuses other hosts, browsers and missing keys', async () => {
    const api = require('./modules/api');
    const http = require('http');
    const srv = http.createServer((q, r) => { api._handle(q, r).catch(() => r.destroy()); });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const get = (p, headers) => new Promise((res, rej) => { const q = http.request({ host: '127.0.0.1', port, path: p, headers }, (r) => { r.resume(); r.on('end', () => res(r.statusCode)); }); q.on('error', rej); q.end(); });
    const ping = await get('/api/v1/ping', { Host: '127.0.0.1' });
    const noKey = await get('/api/v1/status', { Host: '127.0.0.1' });
    const badHost = await get('/api/v1/status', { Host: 'evil.example' });
    const browser = await get('/api/v1/status', { Host: '127.0.0.1', Origin: 'https://evil.example' });
    srv.close();
    assert(ping === 200 && noKey === 401 && badHost === 421 && browser === 403, `ping ${ping}, no key ${noKey}, other host ${badHost}, browser ${browser}`);
    return { ping, noKey, badHost, browser };
  });
  await check('2.0: command line (named pipe)', async () => {
    const cli = require('./cli');
    const dir = path.join(paths.dataDir, `selftest-cli-${process.pid}`);
    const srv = cli.startServer(dir);
    try {
      await new Promise((resolve, reject) => { if (srv.listening) resolve(); else { srv.once('listening', resolve); srv.once('error', reject); } });
      const r = await cli.send(dir, 'help', [], 10_000);
      assert(r.ok && Array.isArray(r.data?.commands) && r.data.commands.includes('status'), 'help did not answer');
      return { pipe: cli.pipePath(dir), commands: r.data.commands.length };
    } finally { cli.stopServer(); }
  });
  await check('2.0: eco mode (EcoQoS) on own process', () => {
    if (wine) return WINE_SKIP;
    if (!win32.ecoSupported()) return { supported: false };
    assert(win32.setEco(process.pid, true), 'turning eco mode on failed');
    assert(win32.setEco(process.pid, false), 'handing eco mode back to Windows failed');
    return { supported: true };
  });
  await check('2.0.1: tiny windows (resize past a minimum size)', async () => {
    // A window that insists on 800 × 600 (like Roblox's 816 × 638) goes to 300 × 200, and gets its frame back.
    // Wine freezes when one window's style is changed from another thread, so this runs on real Windows only.
    if (wine) return WINE_SKIP;
    const w = new BrowserWindow({ show: true, x: 40, y: 40, width: 900, height: 700, minWidth: 800, minHeight: 600, frame: true, skipTaskbar: true, focusable: false });
    try {
      await new Promise(r => setTimeout(r, 500));
      const hwnd = win32.hwndFromBuffer(w.getNativeWindowHandle());
      const style = win32.windowStyle(hwnd);
      const ok = await win32.freeResize(hwnd, { x: 60, y: 60, width: 300, height: 200 });
      await new Promise(r => setTimeout(r, 300));
      const after = win32.windowRect(hwnd);
      assert(ok, 'the resize call failed');
      assert(win32.windowStyle(hwnd) === style, 'the window did not get its frame back');
      assert(after && after.width === 300 && after.height === 200, `ended at ${after?.width}×${after?.height}`);
      return { size: `${after.width}×${after.height}`, style: (style >>> 0).toString(16) };
    } finally { w.destroy(); }
  });
  await check('3.0: Discord status, launch queue, custom layouts, game search, list export', async () => {
    const rp = require('./modules/richpresence');
    const f = rp.decode(rp.encode(1, { cmd: 'SET_ACTIVITY' }));
    assert(f[0]?.data?.cmd === 'SET_ACTIVITY', 'Discord frames do not round-trip');
    const a = rp.activityFor([{ status: 'running', label: 'Alt', placeName: 'Game', startedAt: Date.now() }]);
    assert(a.details === 'Running 1 alt' && !JSON.stringify(a).includes('"Alt"'), 'Discord status text is wrong');
    const q = require('./modules/sessions').queueView();
    assert(Array.isArray(q.items) && q.avgMs > 0, 'launch queue view is broken');
    const r = require('./modules/customlayouts').rects([{ x: 0, y: 0, w: 0.5, h: 1 }], 2, { x: 0, y: 0, width: 1000, height: 500 }, 0);
    assert(r.length === 2 && r[0].width === 500, 'custom layout maths is wrong');
    assert(typeof require('./modules/roblox').searchGames === 'function', 'game search is missing');
    assert(!Object.keys(require('./modules/accounts').EXPORT_COLUMNS).some(k => /pass|cookie/i.test(k)), 'the list export could include logins');
    return { discordApp: rp.CLIENT_ID, connected: rp.status().connected };
  });
  await check('3.1: hatch alerts and the hatch counter (any game)', async () => {
    const hatch = require('./modules/hatch');
    const c = { ...require('./modules/settings').get('hatch'), words: ['secret'], pets: ['Galaxy Dragon'] };
    assert(hatch.match('You hatched a SECRET Galaxy Dragon!', c), 'a rare hatch was not recognised');
    assert(hatch.match('You hatched a Galaxy Draqon', c), 'a screen-reading mistake broke matching');
    assert(!hatch.match('You hatched a Common Dog', c), 'a common pet matched');
    assert(hatch.status().log, 'no hatch status');
    return { ocr: require('./modules/ocr').available() };
  });
  await check('3.1: items & security, servers, update guard, monitors, volume, network, restarts, logs', async () => {
    const sec = require('./modules/accountcheck').summarizeSecurity({ twoStep: false, email: 'verified', phone: 'none', pin: true });
    assert(sec.issues[0]?.id === 'twoStep', 'security rating is wrong');
    const pick = require('./modules/smartjoin').assign([{ id: 'a', playing: 1, maxPlayers: 2, ping: 10 }, { id: 'b', playing: 0, maxPlayers: 9, ping: 90 }], [3], 'ping');
    assert(pick[0]?.id === 'b', 'smart join picked a full server');
    assert(require('./modules/tiler').splitCounts(7, [1, 1, 2]).reduce((x, y) => x + y, 0) === 7, 'monitor split loses windows');
    const ug = require('./modules/updateguard');
    const installed = ug.installedVersions();
    assert(require('./modules/netmon').parseNetstat('Bytes   10   20') !== null, 'netstat parsing is broken');
    let netstat = 'not run', audio = 'not run';
    if (process.platform === 'win32') {
      try { netstat = require('./modules/netmon').parseNetstat(require('child_process').execFileSync('netstat', ['-e'], { timeout: 8000, windowsHide: true }).toString()) ? 'ok' : 'unreadable'; } catch (e) { netstat = e.message.slice(0, 80); }
      // The audio helper compiles its C# (mute + volume) on first use (no PowerShell under Wine).
      if (win32.isWine && win32.isWine()) audio = 'skipped (Wine)';
      else try { await Promise.race([require('./modules/audio').setVolume([process.pid], 100), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000))]); audio = 'ok'; } catch (e) { audio = e.message.slice(0, 80); }
      finally { require('./modules/audio').stop(); }
    }
    const logs = require('./modules/logbrowser').files();
    return { robloxVersions: installed.length, netstat, audio, logs: logs.files.length };
  });
  await check('2.0.3: admin codes (Ed25519) and the admin lock', async () => {
    // Electron's crypto must sign and check Ed25519, or no admin code could ever work.
    const codes = require('./admin/codes');
    const kp = codes.generateKeyPair();
    const code = codes.sign(kp.privateKey, { name: 'self-test', days: 1 });
    assert(codes.verify(code, { keys: [kp.publicKey] }).ok, 'a fresh code did not verify');
    assert(!codes.verify(code.slice(0, -2) + (code.endsWith('A') ? 'BB' : 'AA'), { keys: [kp.publicKey] }).ok, 'a changed code verified');
    const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, 'admin', 'keys.json'), 'utf8')).keys;
    for (const k of shipped) require('crypto').createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' });
    assert(!codes.verify(code, { keys: shipped }).ok, 'a code from another key verified against the shipped key');
    const admin = require('./admin');
    assert(admin.blocked('admin:overview') === 'Admin mode is locked.', 'admin commands run while locked');
    return { shippedKeys: shipped.length, fingerprint: codes.fingerprint(shipped[0]) };
  });
  await check('UI loads in renderer', () => new Promise((resolve, reject) => {
    require('./modules/accounts').init(); require('./modules/webhooks').init();
    require('./ipc').register({ win: () => w, updatedFrom: null });
    // The real main window's options (text size, light mode, preload), so a mistake there fails here too.
    const w = new BrowserWindow(mainWindowOptions ? mainWindowOptions() : { show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true } });
    const timer = setTimeout(() => reject(new Error('UI did not finish loading in 30s')), 30000);
    w.webContents.on('did-finish-load', async () => {
      try {
        await new Promise(r => setTimeout(r, 3000));
        const r = await w.webContents.executeJavaScript(`(async () => ({ pages: Object.keys((window.MM||{}).pages||{}), current: window.MM && MM.currentPage && MM.currentPage(), loader: document.getElementById('loader-text').textContent, navItems: document.querySelectorAll('.nav-item[data-page]').length, i18n: await window.mm.invoke('app:i18n').then(x => !!x && typeof x.lang === 'string', e => e.message) }))()`);
        clearTimeout(timer);
        if (r.pages.length < 10 || r.current !== 'dashboard') return reject(new Error(`UI incomplete: ${JSON.stringify(r)}`));
        // The page must be able to fetch its language (a too-strict command filter once blocked this).
        if (r.i18n !== true) return reject(new Error(`The window could not load its language: ${r.i18n}`));
        resolve(r);
      } catch (e) { clearTimeout(timer); reject(e); } finally { w.destroy(); }
    });
    w.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }));

  const report = { version: app.getVersion(), portable: paths.isPortable, at: new Date().toISOString(), passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results };
  fs.writeFileSync(path.join(paths.dataDir, 'selftest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(report.failed ? 1 : 0);
}

module.exports = { run };
