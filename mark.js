/* FLOW's mark in any palette — the titlebar's four shapes (circle, quarter, square,
   half) on a rounded tile — as a multi-size PNG-compressed ICO, so the taskbar,
   tray and shortcuts can wear the current theme. Same geometry as build/icon.ico.
   No image libraries: shapes are sampled 4×4 per pixel and encoded by hand. */
'use strict';
const zlib = require('zlib');

const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

function inRound(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const cx = Math.min(Math.max(u, x0 + r), x1 - r), cy = Math.min(Math.max(v, y0 + r), y1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}
const disc = (u, v, cx, cy, r) => (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
// which of the four colours covers a point of the 32-unit square, or -1 for the tile.
// Two 11.5-unit columns with a 1-unit gap, centred (the first icon sat 1 unit low-right)
function shape(u, v) {
  if (disc(u, v, 9.75, 9.75, 5.75)) return 0;
  if (u >= 16.5 && v <= 15.5 && disc(u, v, 16.5, 15.5, 11.5)) return 1;
  if (inRound(u, v, 4, 16.5, 15.5, 28, 1.5)) return 2;
  if (v >= 16.5 && disc(u, v, 22.25, 16.5, 5.75)) return 3;
  return -1;
}

// bg: the tile; k: the four shape colours in titlebar order (--c1 --c2 --c3 --c5)
function draw(size, bg, k) {
  const cols = k.map(rgb), tile = rgb(bg), px = Buffer.alloc(size * size * 4), N = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let a = 0, r = 0, g = 0, b = 0;
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
      const u = (x + (sx + 0.5) / N) / size * 32, v = (y + (sy + 0.5) / N) / size * 32;
      if (!inRound(u, v, 0, 0, 32, 32, 8)) continue;
      const s = shape(u, v), c = s < 0 ? tile : cols[s];
      a++; r += c[0]; g += c[1]; b += c[2];
    }
    const i = (y * size + x) * 4;
    if (a) { px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a); }
    px[i + 3] = Math.round(a / (N * N) * 255);
  }
  return px;
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, bg, k) {
  const px = draw(size, bg, k), raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function ico(bg, k) {
  const pngs = SIZES.map(s => png(s, bg, k));
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(SIZES.length, 4);
  let offset = 6 + 16 * SIZES.length;
  const dir = SIZES.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...pngs]);
}

module.exports = { ico, png, SIZES };

// npm run icon: redraw build/icon.ico (the exe's own icon) in the default theme, with
// the colours taken from viz.js so the two cannot drift apart
if (require.main === module) {
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const w = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'viz.js'), 'utf8'), { window: w });
  const th = w.Viz.theme('bauhaus', 'darker');   // app.js defaults
  fs.writeFileSync(path.join(__dirname, 'build', 'icon.ico'), ico(th.bg, [th.c[0], th.c[1], th.c[2], th.c[4]]));
  console.log('build/icon.ico', th.bg, SIZES.join(' '));
}
