// Generates flat PNG app icons (no deps) — a warm ◐ mark for the home screen.
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(size) {
  const bg = [196, 100, 59];      // accent
  const cream = [245, 240, 235];
  const cx = size / 2, cy = size / 2, r = size * 0.29, stroke = size * 0.055;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter
    for (let x = 0; x < size; x++) {
      let col = bg;
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) {
        const ring = d >= r - stroke;
        if (x < cx || ring) col = cream;
      }
      raw[o++] = col[0]; raw[o++] = col[1]; raw[o++] = col[2]; raw[o++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [180, 512, 192]) fs.writeFileSync(path.join(outDir, `icon-${s}.png`), png(s));
console.log('icons written:', fs.readdirSync(outDir).filter(f => f.startsWith('icon-')));
