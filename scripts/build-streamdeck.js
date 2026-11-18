#!/usr/bin/env node
// Packs streamdeck/com.multimenu.app.sdPlugin into MultiMenu.streamDeckPlugin (a zip
// whose top folder is the .sdPlugin folder). Double-clicking it installs the plugin.
//   node scripts/build-streamdeck.js [outDir]
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'streamdeck', 'com.multimenu.app.sdPlugin');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'streamdeck', 'dist'));

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

function files(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(d => {
    const rel = base ? `${base}/${d.name}` : d.name;
    return d.isDirectory() ? files(path.join(dir, d.name), rel) : [rel];
  });
}

function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  const dosTime = 0, dosDate = (2026 - 1980) << 9 | 1 << 5 | 1; // fixed date: reproducible output
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(dosTime, 10); h.writeUInt16LE(dosDate, 12); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += h.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
manifest.Version = `${version}.0`;
const entries = files(SRC).map(rel => ({
  name: `com.multimenu.app.sdPlugin/${rel}`,
  data: rel === 'manifest.json' ? Buffer.from(JSON.stringify(manifest, null, 2)) : fs.readFileSync(path.join(SRC, rel)),
}));
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, 'MultiMenu.streamDeckPlugin');
fs.writeFileSync(file, zip(entries));
console.log(`wrote ${path.relative(ROOT, file)} (${entries.length} files, ${Math.round(fs.statSync(file).size / 1024)} KB)`);
module.exports = { zip, crc32 };
