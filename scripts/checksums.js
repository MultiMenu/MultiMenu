// Writes dist/MultiMenu-files.json (SHA-256 of every app file, used for delta
// updates) and dist/SHA256SUMS.txt (covers the installer, the zip and the file
// list). The in-app updater refuses anything that doesn't match.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = process.argv[2] || 'dist';
const version = require(path.resolve('package.json')).version;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Build the file list from the zip itself so it matches exactly what the delta updater can fetch.
const zd = require(path.resolve('src/main/modules/zipdelta.js'));
const zipFile = path.join(dir, 'MultiMenu-Portable.zip');
if (!fs.existsSync(zipFile)) { console.error(`Missing ${zipFile}`); process.exit(1); }
const zbuf = fs.readFileSync(zipFile);
const end = zd.parseEnd(zbuf.subarray(Math.max(0, zbuf.length - 131072)), Math.max(0, zbuf.length - 131072));
const files = {};
for (const en of zd.parseCentral(zbuf.subarray(end.cdOffset, end.cdOffset + end.cdSize))) {
  const data = zd.extractFrom(zbuf, 0, en);
  files[en.name] = { sha256: sha(data), size: data.length };
}
const patchesFile = path.join(dir, 'patches.json');
const patches = fs.existsSync(patchesFile) ? JSON.parse(fs.readFileSync(patchesFile, 'utf8')) : {};
const manifest = { format: 'multimenu-files', version, files, patches };
fs.writeFileSync(path.join(dir, 'MultiMenu-files.json'), JSON.stringify(manifest));
console.log(`MultiMenu-files.json: ${Object.keys(files).length} files (from the zip), ${Object.keys(patches).length} patch(es)`);

const lines = [];
for (const f of ['MultiMenu-Setup.exe', 'MultiMenu-Portable.zip', 'MultiMenu-files.json']) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) { console.error(`Missing ${p}`); process.exit(1); }
  const h = sha(fs.readFileSync(p));
  lines.push(`${h}  ${f}`);
  console.log(`${h}  ${f}`);
}
// Optional extras (the Stream Deck plugin), when they are in the release folder.
for (const f of ['MultiMenu.streamDeckPlugin']) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) continue;
  const h = sha(fs.readFileSync(p));
  lines.push(`${h}  ${f}`);
  console.log(`${h}  ${f}`);
}
fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
