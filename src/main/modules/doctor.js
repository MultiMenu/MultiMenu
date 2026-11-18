'use strict';
// MultiMenu Doctor: checks the things that most often go wrong and fixes them in
// one click where it safely can. Fixes that open a page are done by the app window.
const fs = require('fs');
const os = require('os');
const path = require('path');
const settings = require('./settings');
const paths = require('../paths');
const bus = require('../bus');
const win32 = require('../native/win32');

const ok = (detail = '') => ({ status: 'ok', detail });
const warn = (detail, fix) => ({ status: 'warn', detail, fix });
const fail = (detail, fix) => ({ status: 'fail', detail, fix });
const info = (detail, fix) => ({ status: 'info', detail, fix });

const CHECKS = [
  ['windows', 'Windows features', () => (win32.available ? ok() : fail('MultiMenu\'s Windows features didn\'t load, so launching and window tools won\'t work. Reinstall MultiMenu.'))],
  ['secure', 'Encrypted storage', () => (require('../secure').available() ? ok() : fail('Windows encryption isn\'t available, so logins can\'t be saved.'))],
  ['roblox', 'Roblox is installed', () => {
    if (!win32.available) return info('Needs Windows.');
    return require('./sessions').findRobloxPlayer() ? ok() : warn('MultiMenu can\'t find Roblox. Install it from roblox.com.', { id: 'robloxDownload', label: 'Get Roblox' });
  }],
  ['openmulti', 'OpenMulti', () => {
    if (!settings.get('openMulti.enabled')) return info('Off: only one Roblox client can run.', { id: 'openMulti', label: 'Turn on' });
    const st = require('./sessions').openMultiStatus();
    return st.active ? ok() : warn(st.message, { id: 'openMulti', label: 'Try again' });
  }],
  ['launcher', 'Launch method', async () => {
    const m = settings.get('openMulti.launchMethod');
    if (m !== 'bloxstrap' && m !== 'fishstrap') return ok();
    const found = await require('./launchers').detect().catch(() => ({}));
    return found?.[m]?.installed ? ok() : warn(`Launching through ${m === 'bloxstrap' ? 'Bloxstrap' : 'Fishstrap'}, but it isn't installed.`, { id: 'launchProtocol', label: 'Use the normal method', safe: true });
  }],
  ['logins', 'Account logins', () => {
    const exp = require('./accounts').raw().accounts.filter(a => a.status === 'expired');
    return exp.length ? warn(`${exp.length} login${exp.length === 1 ? ' has' : 's have'} expired: ${exp.slice(0, 4).map(a => a.alias || a.username).join(', ')}${exp.length > 4 ? '…' : ''}`, { id: 'page:accounts', label: 'Open accounts' }) : ok();
  }],
  ['disk', 'Free disk space', () => {
    try {
      const s = fs.statfsSync(paths.dataDir);
      const gb = (s.bavail * s.bsize) / 1073741824;
      if (gb < 1) return fail(`Only ${gb.toFixed(1)} GB free. Roblox and MultiMenu need room to save.`);
      if (gb < 3) return warn(`Only ${gb.toFixed(1)} GB free.`);
      return ok(`${Math.round(gb)} GB free`);
    } catch { return info('Couldn\'t read the disk space.'); }
  }],
  ['logs', 'Roblox log files', () => {
    const st = require('./logcleaner').status();
    if (st.totalMB == null) return ok();
    return st.totalMB > 500 ? warn(`Roblox's logs take ${Math.round(st.totalMB)} MB.`, { id: 'cleanLogs', label: 'Clean them now', safe: true }) : ok(`${Math.round(st.totalMB)} MB`);
  }],
  ['hotkeys', 'Hotkeys', () => {
    const r = require('./hotkeys').lastResult();
    const bad = Object.entries(r || {}).filter(([, v]) => v !== 'ok').map(([k]) => k);
    return bad.length ? warn(`${bad.length} hotkey${bad.length === 1 ? ' is' : 's are'} used by another app: ${bad.slice(0, 4).join(', ')}`, { id: 'page:settings', label: 'Change hotkeys' }) : ok();
  }],
  ['graphics', 'Your Roblox graphics', () => {
    const fps = require('./fps');
    const running = require('./sessions').listSessions().some(s => ['running', 'launching'].includes(s.status));
    return fps.holdingUserSettings() && !running ? warn('Your Roblox graphics may still be an alt\'s low settings.', { id: 'restoreGraphics', label: 'Put mine back', safe: true }) : ok();
  }],
  ['presentmon', 'FPS counter', () => {
    const p = settings.get('fps.presentMonPath');
    return p && !fs.existsSync(p) ? warn('PresentMon was moved or deleted.', { id: 'clearPresentMon', label: 'Forget it', safe: true }) : ok();
  }],
  ['webhooks', 'Discord webhooks', () => {
    const h = require('./webhooks').history().slice(0, 10);
    const bad = h.filter(x => !x.ok);
    return bad.length >= 3 ? warn(`${bad.length} of the last ${h.length} Discord messages failed.`, { id: 'page:discord', label: 'Open Discord' }) : ok();
  }],
  ['phone', 'Phone dashboard', () => {
    if (!settings.get('phone.enabled')) return ok('Off');
    const st = require('./phone').status();
    return st.running ? ok() : warn(st.error || 'It\'s on but not running.', { id: 'restartPhone', label: 'Restart it', safe: true });
  }],
  ['api', 'Local API', () => {
    if (!settings.get('api.enabled')) return ok('Off');
    const st = require('./api').status();
    return st.running ? ok() : warn(st.error || 'It\'s on but not running.', { id: 'restartApi', label: 'Restart it', safe: true });
  }],
  ['backup', 'Automatic backups', () => {
    if (!settings.get('autoBackup.enabled')) return ok('Off');
    const f = settings.get('autoBackup.folder');
    try { if (!f) throw new Error(); fs.accessSync(f, fs.constants.W_OK); return ok(); } catch { return warn('The backup folder is missing or can\'t be written to.', { id: 'page:settings', label: 'Choose a folder' }); }
  }],
  ['memory', 'Memory for MultiMenu', () => {
    const gb = os.totalmem() / 1073741824;
    return gb < 8.5 && !settings.get('performance.dietMode') ? info(`This PC has ${Math.round(gb)} GB of RAM. Diet mode makes MultiMenu lighter.`, { id: 'dietOn', label: 'Turn on diet mode', safe: true }) : ok();
  }],
  ['damaged', 'Saved files', () => {
    const bad = fs.readdirSync(paths.dataDir).filter(f => /\.corrupt-\d+$/.test(f));
    return bad.length ? info(`${bad.length} damaged file${bad.length === 1 ? ' was' : 's were'} replaced with defaults (copies were kept).`, { id: 'openData', label: 'Open the folder' }) : ok();
  }],
  ['internet', 'Internet and Roblox', async () => {
    const g = require('./guards');
    try { await g.checkConnection(); } catch { /* use the last result */ }
    const st = g.status();
    if (st.online === false) return fail('No internet connection.');
    if (st.blocked) return warn(`Roblox reports a problem: ${st.roblox?.description || 'outage'}`);
    return ok();
  }],
  ['update', 'MultiMenu version', () => {
    const st = require('./updater').status();
    return st.status === 'available' ? info(`Version ${st.latest?.version} is ready to install.`, { id: 'page:updates', label: 'Update' }) : ok(`v${require('electron').app.getVersion()}`);
  }],
];

const FIXES = {
  robloxDownload: () => require('electron').shell.openExternal('https://www.roblox.com/download').then(() => 'Opened roblox.com'),
  openMulti: () => { settings.set('openMulti.enabled', true); const r = require('./sessions').enableOpenMulti(); return r.message; },
  launchProtocol: () => { settings.set('openMulti.launchMethod', 'protocol'); return 'Launching the normal way now.'; },
  cleanLogs: async () => { const s = await require('./logcleaner').run(true); return `Deleted ${s.lastDeleted || 0} old log files.`; },
  restoreGraphics: () => { require('./fps').restoreUser(true); return 'Your graphics settings are back.'; },
  clearPresentMon: () => { settings.set('fps.presentMonPath', ''); return 'Forgot the PresentMon location.'; },
  restartPhone: async () => { const ph = require('./phone'); ph.stop(); await ph.start(); return 'Phone dashboard restarted.'; },
  restartApi: async () => { const a = require('./api'); a.stop(); await a.start(); return 'Local API restarted.'; },
  dietOn: () => { settings.set('performance.dietMode', true); return 'Diet mode is on from the next start.'; },
  openData: () => require('electron').shell.openPath(paths.dataDir).then(() => 'Opened the data folder'),
};

let last = null;
async function run() {
  const checks = [];
  for (const [id, title, fn] of CHECKS) {
    let r;
    try { r = await fn(); } catch (e) { r = info(`Couldn't check: ${e.message}`); }
    checks.push({ id, title, ...r });
  }
  const problems = checks.filter(c => c.status === 'warn' || c.status === 'fail').length;
  const summary = problems ? `${problems} thing${problems === 1 ? '' : 's'} to look at.` : 'Everything looks good.';
  last = { at: Date.now(), checks, problems, summary };
  if (!problems) bus.emit('doctor:allOk');
  return last;
}
async function fix(id) {
  const f = FIXES[id];
  if (!f) throw new Error('That fix isn\'t available.');
  const message = await f();
  return { message, ...(await run()) };
}
async function fixAll() {
  const r = last || await run();
  const done = [];
  for (const c of r.checks) if (c.fix?.safe && (c.status === 'warn' || c.status === 'info') && FIXES[c.fix.id]) { try { done.push(await FIXES[c.fix.id]()); } catch (e) { done.push(e.message); } }
  return { fixed: done, ...(await run()) };
}

module.exports = { run, fix, fixAll, CHECKS, FIXES, last: () => last, path };
