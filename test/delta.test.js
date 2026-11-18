'use strict';
// End-to-end test of delta updates against a local HTTP server with Range support.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const zipdelta = require('../src/main/modules/zipdelta');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-delta-'));
const hasZip = (() => { try { execFileSync('zip', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function serve(file) {
  return new Promise((resolve) => {
    const stats = { requests: 0, bytes: 0 };
    const srv = http.createServer((req, res) => {
      const size = fs.statSync(file).size;
      const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
      stats.requests++;
      if (!m) { res.writeHead(200, { 'Content-Length': size }); fs.createReadStream(file).pipe(res); stats.bytes += size; return; }
      const start = +m[1], end = Math.min(+m[2], size - 1);
      res.writeHead(206, { 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
      fs.createReadStream(file, { start, end }).pipe(res);
      stats.bytes += end - start + 1;
    });
    srv.listen(0, () => resolve({ url: `http://127.0.0.1:${srv.address().port}/x.zip`, srv, stats }));
  });
}

function manifestOf(dir) {
  const files = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const b = fs.readFileSync(p); files[path.relative(dir, p).split(path.sep).join('/')] = { sha256: sha(b), size: b.length }; } } };
  walk(dir);
  return { version: '2.0.0', files };
}

function makeVersions() {
  const v1 = path.join(tmp, 'v1'), v2 = path.join(tmp, 'v2');
  for (const d of [v1, v2]) { fs.mkdirSync(path.join(d, 'resources'), { recursive: true }); fs.mkdirSync(path.join(d, 'locales'), { recursive: true }); }
  const big = crypto.randomBytes(3 * 1024 * 1024);
  for (const d of [v1, v2]) {
    fs.writeFileSync(path.join(d, 'MultiMenu.exe'), big);
    fs.writeFileSync(path.join(d, 'locales', 'en-GB.pak'), 'english strings '.repeat(5000));
  }
  fs.writeFileSync(path.join(v1, 'resources', 'app.asar'), 'old app '.repeat(20000));
  fs.writeFileSync(path.join(v2, 'resources', 'app.asar'), 'NEW app v2 '.repeat(20000));
  fs.writeFileSync(path.join(v2, 'resources', 'new-file.txt'), 'added in v2');
  return { v1, v2 };
}

async function runDelta(zipFile, v1, v2, label) {
  const { url, srv, stats } = await serve(zipFile);
  try {
    const staging = path.join(tmp, `staging-${label}`);
    const r = await zipdelta.downloadDelta({ zipUrl: url, zipSize: fs.statSync(zipFile).size, manifest: manifestOf(v2), appDir: v1, staging });
    assert.equal(r.files, 2, `${label}: only app.asar and new-file.txt should change`);
    assert.equal(fs.readFileSync(path.join(staging, 'resources', 'app.asar'), 'utf8'), fs.readFileSync(path.join(v2, 'resources', 'app.asar'), 'utf8'));
    assert.equal(fs.readFileSync(path.join(staging, 'resources', 'new-file.txt'), 'utf8'), 'added in v2');
    assert.ok(!fs.existsSync(path.join(staging, 'MultiMenu.exe')), 'unchanged exe not downloaded');
    assert.ok(stats.bytes < fs.statSync(zipFile).size / 4, `${label}: downloaded ${stats.bytes} of ${fs.statSync(zipFile).size}`);
    return stats;
  } finally { srv.close(); }
}

test('delta update: standard zip (deflate)', { skip: !hasZip && 'zip CLI not installed' }, async () => {
  const { v1, v2 } = makeVersions();
  const zip = path.join(tmp, 'std.zip');
  execFileSync('zip', ['-qr', zip, '.'], { cwd: v2 });
  await runDelta(zip, v1, v2, 'std');
});

test('delta update: zip64 archive', { skip: !hasZip && 'zip CLI not installed' }, async () => {
  const { v1, v2 } = makeVersions();
  const zip = path.join(tmp, 'z64.zip');
  execFileSync('zip', ['-qr', '-fz', zip, '.'], { cwd: v2 });
  await runDelta(zip, v1, v2, 'zip64');
});

test('delta update: tampered file is rejected', { skip: !hasZip && 'zip CLI not installed' }, async () => {
  const { v1, v2 } = makeVersions();
  const zip = path.join(tmp, 'tamper.zip');
  execFileSync('zip', ['-qr', zip, '.'], { cwd: v2 });
  const m = manifestOf(v2);
  m.files['resources/app.asar'].sha256 = '0'.repeat(64);
  const { url, srv } = await serve(zip);
  try {
    await assert.rejects(zipdelta.downloadDelta({ zipUrl: url, zipSize: fs.statSync(zip).size, manifest: m, appDir: v1, staging: path.join(tmp, 'st-t') }), /Checksum mismatch/);
  } finally { srv.close(); }
});

test('delta update: unsafe manifest paths are refused', async () => {
  await assert.rejects(zipdelta.changedFiles({ files: { '../evil.dll': { sha256: 'x', size: 1 } } }, tmp), /Unsafe path/);
});

test('delta update: nothing to do when already current', async () => {
  const { v2 } = makeVersions();
  const r = await zipdelta.downloadDelta({ zipUrl: 'http://127.0.0.1:1/none', zipSize: 1, manifest: manifestOf(v2), appDir: v2, staging: path.join(tmp, 'st-n') });
  assert.equal(r.nothing, true);
});

test('delta update: real electron-builder zip parses', { skip: !fs.existsSync(path.join(__dirname, '..', 'dist', 'MultiMenu-Portable.zip')) }, () => {
  const zip = path.join(__dirname, '..', 'dist', 'MultiMenu-Portable.zip');
  const size = fs.statSync(zip).size;
  const fd = fs.openSync(zip, 'r');
  const tailLen = Math.min(size, 128 * 1024);
  const tail = Buffer.alloc(tailLen);
  fs.readSync(fd, tail, 0, tailLen, size - tailLen);
  const end = zipdelta.parseEnd(tail, size - tailLen);
  const cd = Buffer.alloc(end.cdSize);
  fs.readSync(fd, cd, 0, end.cdSize, end.cdOffset);
  const entries = zipdelta.parseCentral(cd);
  assert.ok(entries.some(e => e.name === 'resources/app.asar'));
  assert.ok(entries.some(e => e.name === 'MultiMenu.exe'));
  // extract app.asar and compare with the unpacked build
  const en = entries.find(e => e.name === 'resources/app.asar');
  const buf = Buffer.alloc(30 + Buffer.byteLength(en.name) + 1024 + en.compSize);
  fs.readSync(fd, buf, 0, buf.length, en.offset);
  fs.closeSync(fd);
  const data = zipdelta.extractFrom(buf, en.offset, en);
  const unpacked = fs.readFileSync(path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app.asar'));
  assert.equal(sha(data), sha(unpacked));
});

test('block patches: tiny patch for in-place changes, exact round-trip, size changes', () => {
  const a = crypto.randomBytes(5 * 1024 * 1024);
  const b = Buffer.from(a); b.write('version 1.3.0', 4_000_000); b.write('asar hash ffff', 100);
  const { patch, changedBlocks } = zipdelta.makePatch(a, b);
  assert.equal(changedBlocks, 2);
  assert.ok(patch.length < 200 * 1024, `patch is ${patch.length} bytes`);
  assert.ok(zipdelta.applyPatch(a, patch).equals(b));
  const grown = Buffer.concat([b, crypto.randomBytes(1000)]);
  assert.ok(zipdelta.applyPatch(a, zipdelta.makePatch(a, grown).patch).equals(grown));
  const shrunk = b.subarray(0, 3_000_000);
  assert.ok(zipdelta.applyPatch(a, zipdelta.makePatch(a, shrunk).patch).equals(shrunk));
  assert.throws(() => zipdelta.applyPatch(a, require('zlib').gzipSync(Buffer.from('nope'))), /Not a MultiMenu patch/);
});

test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
