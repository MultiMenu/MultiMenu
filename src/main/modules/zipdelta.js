'use strict';
// Delta updates. The release contains MultiMenu-Portable.zip plus
// MultiMenu-files.json (a SHA-256 for every app file; itself verified through
// SHA256SUMS.txt). We hash the installed files, then fetch ONLY the changed files
// out of the remote zip using HTTP Range requests, decompress them, and check each
// one against its SHA-256 before it can be installed.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

// ---------- zip parsing (pure) ----------
function findEocd(tail) {
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) return i;
  return -1;
}

/** Parses the end-of-central-directory from the last bytes of the zip. tailStart = absolute offset of `tail`. */
function parseEnd(tail, tailStart) {
  const i = findEocd(tail);
  if (i < 0) throw new Error('Not a zip file (no end record).');
  let entries = tail.readUInt16LE(i + 10), cdSize = tail.readUInt32LE(i + 12), cdOffset = tail.readUInt32LE(i + 16);
  const loc = i - 20;
  if (loc >= 0 && tail.readUInt32LE(loc) === 0x07064b50) {
    const z64Abs = Number(tail.readBigUInt64LE(loc + 8));
    const z = z64Abs - tailStart;
    if (z < 0 || tail.readUInt32LE(z) !== 0x06064b50) throw new Error('Zip64 record outside the fetched range.');
    entries = Number(tail.readBigUInt64LE(z + 32)); cdSize = Number(tail.readBigUInt64LE(z + 40)); cdOffset = Number(tail.readBigUInt64LE(z + 48));
  }
  return { entries, cdSize, cdOffset };
}

function parseCentral(cd) {
  const out = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const method = cd.readUInt16LE(p + 10);
    let compSize = cd.readUInt32LE(p + 20), size = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
    let offset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');
    // zip64 extra field
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = cd.readUInt16LE(e), len = cd.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (compSize === 0xffffffff) { compSize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
      e += 4 + len;
    }
    if (!name.endsWith('/')) out.push({ name, method, compSize, size, offset });
    p = eEnd + commentLen;
  }
  return out;
}

/** Groups entries into as few HTTP ranges as possible (joins neighbours closer than maxGap). */
function planRanges(entries, maxGap = 256 * 1024) {
  const sorted = entries.slice().sort((a, b) => a.offset - b.offset);
  const ranges = [];
  for (const en of sorted) {
    const start = en.offset, end = en.offset + 30 + Buffer.byteLength(en.name) + 1024 + en.compSize; // 1 KB slack for the local extra field
    const last = ranges.at(-1);
    if (last && start - last.end <= maxGap) { last.end = Math.max(last.end, end); last.entries.push(en); }
    else ranges.push({ start, end, entries: [en] });
  }
  return ranges;
}

/** Extracts one entry from a buffer that starts at absolute offset `base`. */
function extractFrom(buf, base, en) {
  const p = en.offset - base;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`Bad local header for ${en.name}`);
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + en.compSize);
  if (data.length !== en.compSize) throw new Error(`Truncated data for ${en.name}`);
  if (en.method === 0) return Buffer.from(data);
  if (en.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`Unsupported compression (${en.method}) for ${en.name}`);
}

// ---------- block patches (for big files that change in place, e.g. MultiMenu.exe) ----------
// Format: 'MMPATCH1' | u32 blockSize | f64 newSize | u32 count | count × (u32 blockIndex | u32 len | bytes), gzipped.
const PATCH_MAGIC = 'MMPATCH1';

function makePatch(oldBuf, newBuf, blockSize = 65536) {
  const parts = [];
  const n = Math.ceil(newBuf.length / blockSize);
  for (let i = 0; i < n; i++) {
    const a = oldBuf.subarray(i * blockSize, (i + 1) * blockSize), b = newBuf.subarray(i * blockSize, (i + 1) * blockSize);
    if (!a.equals(b)) parts.push([i, b]);
  }
  const head = Buffer.alloc(8 + 4 + 8 + 4);
  head.write(PATCH_MAGIC, 0, 'ascii'); head.writeUInt32LE(blockSize, 8); head.writeDoubleLE(newBuf.length, 12); head.writeUInt32LE(parts.length, 20);
  const chunks = [head];
  for (const [i, b] of parts) { const h = Buffer.alloc(8); h.writeUInt32LE(i, 0); h.writeUInt32LE(b.length, 4); chunks.push(h, b); }
  return { patch: zlib.gzipSync(Buffer.concat(chunks), { level: 9 }), changedBlocks: parts.length, totalBlocks: n };
}

function applyPatch(oldBuf, patchGz) {
  const p = zlib.gunzipSync(patchGz);
  if (p.toString('ascii', 0, 8) !== PATCH_MAGIC) throw new Error('Not a MultiMenu patch.');
  const bs = p.readUInt32LE(8), size = p.readDoubleLE(12), count = p.readUInt32LE(20);
  const out = Buffer.alloc(size);
  oldBuf.copy(out, 0, 0, Math.min(oldBuf.length, size));
  let o = 24;
  for (let k = 0; k < count; k++) {
    const i = p.readUInt32LE(o), len = p.readUInt32LE(o + 4);
    p.copy(out, i * bs, o + 8, o + 8 + len);
    o += 8 + len;
  }
  return out;
}

// ---------- local hashing ----------
function sha256File(file) {
  return new Promise((resolve) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', d => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', () => resolve(null));
  });
}

/** Returns manifest entries whose local copy is missing or different. */
async function changedFiles(manifest, appDir) {
  const changed = [];
  for (const [rel, info] of Object.entries(manifest.files)) {
    if (rel.includes('..') || path.isAbsolute(rel)) throw new Error(`Unsafe path in manifest: ${rel}`);
    const local = path.join(appDir, ...rel.split('/'));
    let same = false;
    try { const st = fs.statSync(local); same = st.size === info.size && (await sha256File(local)) === info.sha256; } catch { same = false; }
    if (!same) changed.push({ rel, ...info });
  }
  return changed;
}

// ---------- network ----------
async function fetchRange(url, start, end, ua) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}`, 'User-Agent': ua }, signal: AbortSignal.timeout(120000) });
  if (res.status !== 206) throw new Error(`Server does not support partial downloads (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Downloads only the changed files into `staging`.
 * @returns {{ files: number, bytes: number }}
 */
async function downloadDelta({ zipUrl, zipSize, manifest, appDir, staging, ua = 'MultiMenu', onProgress, assetUrls = {} }) {
  let changed = await changedFiles(manifest, appDir);
  if (!changed.length) return { files: 0, bytes: 0, nothing: true };
  fs.rmSync(staging, { recursive: true, force: true });
  // Big files with a published patch from the version you have: apply the patch instead.
  let patchedBytes = 0, patched = 0;
  for (const c of changed.slice()) {
    const pt = manifest.patches?.[c.rel];
    const url = pt && assetUrls[pt.file];
    if (!pt || !url) continue;
    const local = path.join(appDir, ...c.rel.split('/'));
    if ((await sha256File(local)) !== pt.from) continue;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const gz = Buffer.from(await res.arrayBuffer());
      if (crypto.createHash('sha256').update(gz).digest('hex') !== pt.sha256) throw new Error('patch checksum mismatch');
      const out = applyPatch(fs.readFileSync(local), gz);
      if (crypto.createHash('sha256').update(out).digest('hex') !== c.sha256) throw new Error('patched file checksum mismatch');
      const dest = path.join(staging, ...c.rel.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, out);
      patchedBytes += gz.length; patched++;
      changed = changed.filter(x => x !== c);
    } catch { /* fall back to fetching the whole file from the zip */ }
  }
  if (!changed.length) return { files: patched, bytes: patchedBytes, patched };
  const tailLen = Math.min(zipSize, 128 * 1024);
  const tail = await fetchRange(zipUrl, zipSize - tailLen, zipSize - 1, ua);
  const end = parseEnd(tail, zipSize - tailLen);
  const cd = end.cdOffset >= zipSize - tailLen
    ? tail.subarray(end.cdOffset - (zipSize - tailLen), end.cdOffset - (zipSize - tailLen) + end.cdSize)
    : await fetchRange(zipUrl, end.cdOffset, end.cdOffset + end.cdSize - 1, ua);
  const byName = new Map(parseCentral(cd).map(e => [e.name, e]));
  const wanted = changed.map(c => { const e = byName.get(c.rel); if (!e) throw new Error(`${c.rel} is missing from the update package.`); return { ...e, want: c }; });
  const total = wanted.reduce((a, e) => a + e.compSize, 0);
  if (total > zipSize * 0.7) { const err = new Error('Most files changed; a full download is faster.'); err.code = 'TOO_BIG'; throw err; }
  let got = 0;
  for (const r of planRanges(wanted)) {
    const buf = await fetchRange(zipUrl, r.start, Math.min(zipSize, r.end) - 1, ua);
    for (const en of r.entries) {
      const data = extractFrom(buf, r.start, en);
      const hash = crypto.createHash('sha256').update(data).digest('hex');
      if (hash !== en.want.sha256) throw new Error(`Checksum mismatch for ${en.name}; update discarded.`);
      const dest = path.join(staging, ...en.name.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
      got += en.compSize;
      onProgress?.(Math.min(1, got / Math.max(1, total)));
    }
  }
  return { files: wanted.length + patched, bytes: got + patchedBytes, patched };
}

module.exports = { makePatch, applyPatch, parseEnd, parseCentral, planRanges, extractFrom, changedFiles, sha256File, downloadDelta, fetchRange };
