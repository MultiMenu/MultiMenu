// CI helper: builds small block patches for big files (e.g. MultiMenu.exe) from the
// PREVIOUS release's zip to this one, so users one version behind download a few
// hundred KB instead of ~100 MB. Writes <out>/patch-*.mmpatch and <out>/patches.json.
// Usage: node scripts/make-patches.js <previous.zip> <new.zip> <outDir>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zd = require(path.resolve('src/main/modules/zipdelta.js'));

const [prevZip, newZip, out] = process.argv.slice(2);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function entries(zip) {
  const buf = fs.readFileSync(zip);
  const tailStart = Math.max(0, buf.length - 131072);
  const end = zd.parseEnd(buf.subarray(tailStart), tailStart);
  const map = new Map();
  for (const en of zd.parseCentral(buf.subarray(end.cdOffset, end.cdOffset + end.cdSize))) map.set(en.name, () => zd.extractFrom(buf, 0, en));
  return map;
}
if (!prevZip || !fs.existsSync(prevZip)) { console.log('No previous release zip; no patches.'); fs.writeFileSync(path.join(out, 'patches.json'), '{}'); process.exit(0); }
const prev = entries(prevZip), next = entries(newZip);
const patches = {};
for (const [name, get] of next) {
  if (!prev.has(name)) continue;
  const b = get();
  if (b.length < 4 * 1024 * 1024) continue; // small files are cheap to fetch whole
  const a = prev.get(name)();
  if (a.equals(b)) continue;
  const { patch, changedBlocks, totalBlocks } = zd.makePatch(a, b);
  if (patch.length > b.length * 0.3) { console.log(`${name}: too different for a patch (${changedBlocks}/${totalBlocks} blocks)`); continue; }
  const file = `patch-${name.replace(/[^\w.-]/g, '_')}.mmpatch`;
  fs.writeFileSync(path.join(out, file), patch);
  patches[name] = { from: sha(a), file, sha256: sha(patch) };
  console.log(`${name}: ${changedBlocks}/${totalBlocks} blocks changed → ${(patch.length / 1024).toFixed(0)} KB patch`);
}
fs.writeFileSync(path.join(out, 'patches.json'), JSON.stringify(patches, null, 1));
