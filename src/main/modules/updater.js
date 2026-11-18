'use strict';
// Auto-updater for both the installed and the portable build, backed by GitHub Releases.
//
// Each release must contain:
//   MultiMenu-Setup.exe      (installer build)
//   MultiMenu-Portable.zip   (portable build)
//   SHA256SUMS.txt           ("<sha256>  <filename>" lines)
// The GitHub Actions workflow in .github/workflows/release.yml produces all three.
//
// Every download is verified against SHA256SUMS.txt before anything is run.
// Installed: runs the new installer silently (/S) and relaunches; data in %APPDATA% is untouched.
// Portable:  extracts the zip to a staging folder, then a small script copies the new
//            files over the app folder (skipping MultiMenu-Data) after MultiMenu exits.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { app } = require('electron');
const settings = require('./settings');
const paths = require('../paths');
const bus = require('../bus');
const log = require('../logger').scope('updater');
const pkg = require('../../../package.json');

const ASSET = { installer: 'MultiMenu-Setup.exe', portable: 'MultiMenu-Portable.zip', sums: 'SHA256SUMS.txt', manifest: 'MultiMenu-files.json' };
const zipdelta = require('./zipdelta');
const state = { status: 'idle', message: '', latest: null, progress: 0, downloaded: null, error: null, checkedAt: null };
let timer = null;
let pretend = null; // admin mode: act as if this version were installed (until restart)

// ---------- version helpers ----------
function parseVer(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}
function compareVer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  if (!x || !y) return 0;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1;
  if (!x.pre.length && !y.pre.length) return 0;
  if (!x.pre.length) return 1;
  if (!y.pre.length) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn && +p !== +q) return +p > +q ? 1 : -1;
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p > q ? 1 : -1;
  }
  return 0;
}

function parseSums(text) {
  const map = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (m) map[m[2].trim()] = m[1].toLowerCase();
  }
  return map;
}

function repo() {
  const r = (settings.get('updates.repoOverride') || pkg.multimenu?.updateRepo || '').trim();
  return /^[\w.-]+\/[\w.-]+$/.test(r) && !r.startsWith('YOUR_GITHUB_USERNAME') ? r : null;
}

function realVersion() { return app.getVersion(); }
function currentVersion() { return pretend || realVersion(); }
function kind() { return paths.isPortable ? 'portable' : 'installer'; }

/** Picks the newest release for the channel from a GitHub releases list. */
function pickRelease(releases, channel) {
  const usable = releases.filter(r => !r.draft && (channel === 'beta' || !r.prerelease) && parseVer(r.tag_name));
  usable.sort((a, b) => compareVer(b.tag_name, a.tag_name));
  return usable[0] || null;
}

function set(patch) { Object.assign(state, patch); bus.emit('updater:update', status()); }

/** What the updater needs to know about one GitHub release. */
function describe(rel) {
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const asset = assets.find(a => a.name === ASSET[kind()]);
  const sums = assets.find(a => a.name === ASSET.sums);
  const zip = assets.find(a => a.name === ASSET.portable);
  const manifest = assets.find(a => a.name === ASSET.manifest);
  return {
    version: String(rel.tag_name).replace(/^v/i, ''), name: rel.name || rel.tag_name, notes: String(rel.body || '').slice(0, 20000),
    publishedAt: rel.published_at, prerelease: rel.prerelease, url: rel.html_url,
    assetUrl: asset?.browser_download_url || null, assetSize: asset?.size || 0, sumsUrl: sums?.browser_download_url || null,
    zipUrl: zip?.browser_download_url || null, zipSize: zip?.size || 0, manifestUrl: manifest?.browser_download_url || null,
    patchUrls: Object.fromEntries(assets.filter(a => a.name.endsWith('.mmpatch')).map(a => [a.name, a.browser_download_url])),
  };
}

async function fetchReleases(perPage = 20) {
  const r = repo();
  if (!r) throw new Error('Updates are not set up yet: set your GitHub repository in Settings → Updates (or in package.json).');
  const res = await fetch(`https://api.github.com/repos/${r}/releases?per_page=${perPage}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `MultiMenu/${realVersion()}` }, signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) throw new Error(`Repository ${r} was not found or has no public releases.`);
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}.`);
  const list = await res.json();
  return Array.isArray(list) ? list : [];
}

async function check({ manual = false } = {}) {
  // A download in progress, or one ready to install, must not be replaced by a new check.
  if (['downloading', 'installing', 'ready'].includes(state.status)) return status();
  const r = repo();
  if (!r) { set({ status: 'unconfigured', message: 'Updates are not set up yet: set your GitHub repository in Settings → Updates (or in package.json).' }); return status(); }
  set({ status: 'checking', message: 'Checking for updates…', error: null });
  try {
    const rel = pickRelease(await fetchReleases(), settings.get('updates.channel'));
    const checkedAt = Date.now();
    if (!rel || compareVer(rel.tag_name, currentVersion()) <= 0) {
      set({ status: 'current', message: `You're on the latest version (v${currentVersion()}).`, latest: null, checkedAt });
      return status();
    }
    const latest = describe(rel);
    if (!latest.assetUrl || !latest.sumsUrl) {
      set({ status: 'error', message: `v${latest.version} is missing ${!latest.assetUrl ? ASSET[kind()] : ASSET.sums}, so it can't be installed automatically.`, latest, checkedAt });
      return status();
    }
    const snoozed = (settings.get('updates.remindUntil') || {})[latest.version];
    set({ status: 'available', message: `MultiMenu v${latest.version} is ready!`, latest, checkedAt, snoozed: !manual && snoozed && snoozed > Date.now() });
    if (!state.snoozed) bus.emit('updater:available', status());
    bus.emit('event', { type: 'updates', detail: `MultiMenu v${latest.version} is available (you have v${currentVersion()}).` });
  } catch (e) {
    set({ status: 'error', message: e.message, error: e.message });
    log.warn('Update check failed', e.message);
  }
  return status();
}

async function downloadTo(url, dest, onProgress) {
  const res = await fetch(url, { headers: { 'User-Agent': `MultiMenu/${currentVersion()}` }, signal: AbortSignal.timeout(30 * 60_000) });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);
  let got = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
      if (total) onProgress?.(got / total);
    }
  } catch (e) {
    // Connection dropped: close the half file (and free it) before reporting.
    out.destroy();
    try { fs.rmSync(dest, { force: true }); } catch { /* ignore */ }
    throw new Error(`The download was interrupted (${e.message}). Try again.`);
  }
  await new Promise((r, j) => out.end(err => (err ? j(err) : r())));
  return hash.digest('hex');
}

function authenticode(file) {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve({ status: 'Unknown' });
    const ps = `(Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}') | Select-Object -Property Status,@{n='Signer';e={$_.SignerCertificate.Subject}} | ConvertTo-Json -Compress`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      if (err) return resolve({ status: 'Unknown' });
      try { const j = JSON.parse(stdout); resolve({ status: String(j.Status), signer: j.Signer || null }); } catch { resolve({ status: 'Unknown' }); }
    });
  });
}

async function download() {
  if (state.status !== 'available' || !state.latest) throw new Error('No update is ready to download.');
  const l = state.latest;
  const dir = paths.updatesDir();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  set({ status: 'downloading', progress: 0, message: `Downloading v${l.version}…` });
  try {
    const sumsRes = await fetch(l.sumsUrl, { signal: AbortSignal.timeout(30000) });
    if (!sumsRes.ok) throw new Error('Could not download SHA256SUMS.txt.');
    const sums = parseSums(await sumsRes.text());
    // 1) Try a delta update: only the files that changed.
    if (l.manifestUrl && l.zipUrl && sums[ASSET.manifest] && sums[ASSET.portable]) {
      try {
        set({ message: 'Checking which files changed…' });
        const mres = await fetch(l.manifestUrl, { signal: AbortSignal.timeout(30000) });
        const mtext = Buffer.from(await mres.arrayBuffer());
        if (crypto.createHash('sha256').update(mtext).digest('hex') !== sums[ASSET.manifest]) throw new Error('File list checksum mismatch.');
        const manifest = JSON.parse(mtext.toString('utf8'));
        if (manifest.version !== l.version) throw new Error('File list is for a different version.');
        const staging = path.join(dir, 'staging');
        const r = await zipdelta.downloadDelta({
          zipUrl: l.zipUrl, zipSize: l.zipSize, manifest, appDir: paths.exeDir, staging, ua: `MultiMenu/${currentVersion()}`, assetUrls: l.patchUrls || {},
          onProgress: p => set({ progress: p, message: `Downloading changed files… ${Math.round(p * 100)}%` }),
        });
        if (r.nothing) throw new Error('no files differ');
        const mb = (r.bytes / 1048576).toFixed(1);
        set({ status: 'ready', progress: 1, downloaded: { mode: 'delta', staging, files: r.files, bytes: r.bytes, sha256: sums[ASSET.manifest], signature: { status: 'NotApplicable' } },
          message: `v${l.version} ready: ${r.files} changed file${r.files === 1 ? '' : 's'} (${mb} MB instead of ${(l.zipSize / 1048576).toFixed(0)} MB), each verified.` });
        return status();
      } catch (e) {
        log.info(`Delta update not possible (${e.message}); falling back to full download`);
        set({ message: `Full download needed (${e.message})` });
      }
    }
    // 2) Full download.
    const expected = sums[ASSET[kind()]];
    if (!expected) throw new Error(`SHA256SUMS.txt has no entry for ${ASSET[kind()]}.`);
    const dest = path.join(dir, ASSET[kind()]);
    const actual = await downloadTo(l.assetUrl, dest, p => set({ progress: p }));
    if (actual !== expected) { fs.rmSync(dest, { force: true }); throw new Error('Checksum mismatch: the download was corrupted or tampered with, so it was deleted.'); }
    let signature = { status: 'NotApplicable' };
    if (kind() === 'installer') {
      signature = await authenticode(dest);
      if (settings.get('updates.requireSignature') && signature.status !== 'Valid') {
        fs.rmSync(dest, { force: true });
        throw new Error(`The installer is not validly signed (${signature.status}) and your settings require a signature.`);
      }
    }
    set({ status: 'ready', progress: 1, downloaded: { file: dest, sha256: actual, signature }, message: `v${l.version} downloaded and verified. Ready to install.` });
    return status();
  } catch (e) {
    set({ status: 'error', message: e.message, error: e.message });
    throw e;
  }
}

function recordHistory(from, to) {
  const h = settings.get('updates.history') || [];
  h.unshift({ from, to, at: Date.now(), kind: kind() });
  settings.set('updates.history', h.slice(0, 50));
  settings.store.saveNow();
}

async function install() {
  if (state.status !== 'ready' || !state.downloaded) throw new Error('Download the update first.');
  const { file } = state.downloaded;
  recordHistory(realVersion(), state.latest.version);
  if (state.downloaded.mode === 'delta') return applyStaging(state.downloaded.staging);
  if (kind() === 'installer') {
    // electron-builder's NSIS installer: /S = silent, --force-run = relaunch when done.
    spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.exit(0), 500);
    return { ok: true };
  }
  // Portable: extract, then hand off to a script that waits for us to exit.
  const staging = path.join(paths.updatesDir(), 'staging');
  fs.rmSync(staging, { recursive: true, force: true });
  set({ status: 'installing', message: 'Extracting update…' });
  await new Promise((resolve, reject) => {
    const ps = `Expand-Archive -LiteralPath '${file.replace(/'/g, "''")}' -DestinationPath '${staging.replace(/'/g, "''")}' -Force`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 300000 }, err => (err ? reject(new Error('Could not extract the update.')) : resolve()));
  });
  let src = staging;
  const entries = fs.readdirSync(staging);
  if (entries.length === 1 && fs.statSync(path.join(staging, entries[0])).isDirectory()) src = path.join(staging, entries[0]);
  if (!fs.existsSync(path.join(src, path.basename(process.execPath)))) throw new Error('The update package does not contain MultiMenu.exe.');
  return applyStaging(src);
}

/** Copies staged files over the app folder after MultiMenu exits, then relaunches.
 *  The data folder is never touched. Installed builds also get their version
 *  number updated in Apps & Features. */
function applyStaging(src) {
  const ver = state.latest.version.replace(/[^\w.-]/g, '');
  const regUpdate = kind() === 'installer'
    ? `powershell -NoProfile -NonInteractive -Command "Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Where-Object { (Get-ItemProperty $_.PSPath).DisplayName -eq 'MultiMenu' } | ForEach-Object { Set-ItemProperty $_.PSPath -Name DisplayVersion -Value '${ver}' }" >nul 2>&1`
    : 'rem portable';
  const script = path.join(paths.updatesDir(), 'apply-update.cmd');
  // Batch files are read in the old OEM code page, so a folder name with é, ğ or ж written
  // into the script would come out garbled. The folders travel as environment variables
  // instead, which cmd.exe keeps in full Unicode.
  fs.writeFileSync(script, [
    '@echo off',
    'setlocal',
    ':wait',
    `tasklist /FI "PID eq ${process.pid}" | find "${process.pid}" >nul && (timeout /t 1 /nobreak >nul & goto wait)`,
    'robocopy "%MM_SRC%" "%MM_DST%" /E /XD "MultiMenu-Data" /R:5 /W:1 /NFL /NDL /NJH /NJS >nul',
    regUpdate,
    'start "" "%MM_EXE%"',
    'endlocal',
  ].join('\r\n'));
  spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, MM_SRC: src, MM_DST: paths.exeDir, MM_EXE: process.execPath } }).unref();
  setTimeout(() => app.exit(0), 500);
  return { ok: true };
}

function remindLater(hours = 24) {
  if (!state.latest) return status();
  const r = settings.get('updates.remindUntil') || {};
  r[state.latest.version] = Date.now() + hours * 3600_000;
  settings.set('updates.remindUntil', r);
  set({ snoozed: true });
  return status();
}

function status() {
  return { ...state, current: currentVersion(), pretend: pretend || null, kind: kind(), repo: repo(), channel: settings.get('updates.channel'), history: settings.get('updates.history') || [] };
}

// ---------- admin mode ----------
/** Act as if another version were installed, so the normal update flow can be tried (until restart). */
function setPretend(v) {
  const clean = v ? String(v).trim().replace(/^v/i, '') : null;
  if (clean && !parseVer(clean)) throw new Error('Use a version like 1.6.0.');
  if (['downloading', 'installing'].includes(state.status)) throw new Error('Wait for the download to finish first.');
  pretend = clean;
  set({ status: 'idle', message: clean ? `Acting as v${clean} until MultiMenu restarts.` : '', latest: null, downloaded: null, error: null });
  return status();
}

/** Every release, newest first, for the admin version picker. */
async function releases() {
  const list = await fetchReleases(100);
  return list.filter(r => parseVer(r.tag_name)).sort((a, b) => compareVer(b.tag_name, a.tag_name)).map((r) => {
    const d = describe(r);
    return {
      tag: r.tag_name, version: d.version, name: d.name, publishedAt: r.published_at, prerelease: !!r.prerelease, draft: !!r.draft, url: r.html_url,
      installable: !!(d.assetUrl && d.sumsUrl), current: compareVer(r.tag_name, realVersion()) === 0,
      downloads: (r.assets || []).reduce((n, a) => n + (a.download_count || 0), 0),
      assets: (r.assets || []).map(a => ({ name: a.name, size: a.size, downloads: a.download_count || 0 })),
    };
  });
}

/** Offers one exact release (older, newer or the same) through the normal download and install steps. */
async function offer(tag) {
  if (['downloading', 'installing'].includes(state.status)) throw new Error('Wait for the download to finish first.');
  const want = String(tag || '').trim().replace(/^v/i, '');
  const rel = (await fetchReleases(100)).find(r => String(r.tag_name).replace(/^v/i, '') === want);
  if (!rel) throw new Error(`No release v${want} was found.`);
  const latest = describe(rel);
  if (!latest.assetUrl || !latest.sumsUrl) throw new Error(`v${latest.version} is missing ${!latest.assetUrl ? ASSET[kind()] : ASSET.sums}, so it can't be installed automatically.`);
  set({ status: 'available', message: `v${latest.version} is ready to download (chosen in admin mode).`, latest, downloaded: null, error: null, checkedAt: Date.now(), snoozed: false });
  return status();
}

/** Clears a stuck update and the downloaded files. */
function reset() {
  if (state.status === 'installing') throw new Error('An update is being installed.');
  try { fs.rmSync(paths.updatesDir(), { recursive: true, force: true }); fs.mkdirSync(paths.updatesDir(), { recursive: true }); } catch { /* in use */ }
  set({ status: 'idle', message: '', latest: null, progress: 0, downloaded: null, error: null });
  return status();
}

function start() {
  clearInterval(timer);
  if (!settings.get('updates.autoCheck')) return;
  setTimeout(() => check(), 15_000);
  timer = setInterval(() => check(), 6 * 3600_000);
}

/** Called on startup: if the version changed, note it so the UI can show "updated to vX". */
function afterLaunch() {
  const last = settings.get('lastSeenVersion');
  settings.set('lastSeenVersion', realVersion());
  try { fs.rmSync(path.join(paths.updatesDir(), 'staging'), { recursive: true, force: true }); } catch { /* fine */ }
  return last && last !== realVersion() ? { from: last, to: realVersion() } : null;
}

module.exports = { check, download, install, remindLater, status, start, afterLaunch, compareVer, parseVer, parseSums, pickRelease, repo, describe, setPretend, releases, offer, reset };
