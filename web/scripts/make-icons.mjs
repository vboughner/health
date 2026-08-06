/**
 * Generate the PWA icons.
 *
 *   node scripts/make-icons.mjs
 *
 * Written as raw PNG rather than converted from SVG so it needs no image tooling —
 * there is no ImageMagick or librsvg on the machine this was built on, and adding a
 * build dependency for three static files is not worth it.
 *
 * The mark is a progress ring: dark green field, bright green arc broken at the top.
 * Everything meaningful sits inside the middle 60%, so the maskable variant survives
 * whatever shape Android crops it to.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const FIELD = [20, 45, 30]; // dark green
const RING = [74, 222, 128]; // --accent
const GAP_START = -Math.PI / 2 - 0.42; // arc break centred on top
const GAP_END = -Math.PI / 2 + 0.42;

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const centre = size / 2;
  const radius = size * 0.3;
  const halfStroke = size * 0.05;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - centre;
      const dy = y + 0.5 - centre;
      const dist = Math.hypot(dx, dy);

      let colour = FIELD;

      // Antialias the ring edge over one pixel so it doesn't look chewed.
      const edge = Math.abs(dist - radius);
      if (edge <= halfStroke + 1) {
        let angle = Math.atan2(dy, dx);
        if (angle < -Math.PI / 2) angle += 2 * Math.PI; // put the gap in one continuous span
        const inGap = angle > GAP_START + 2 * Math.PI || (angle > GAP_START && angle < GAP_END);

        if (!inGap) {
          const coverage = Math.min(1, Math.max(0, halfStroke + 0.5 - edge));
          colour = mix(FIELD, RING, coverage);
        }
      }

      const i = (y * size + x) * 4;
      pixels[i] = colour[0];
      pixels[i + 1] = colour[1];
      pixels[i + 2] = colour[2];
      pixels[i + 3] = 255;
    }
  }

  return encodePng(size, size, pixels);
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// ---------------------------------------------------------------- PNG encoding

function encodePng(width, height, rgba) {
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ----------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  writeFileSync(join(OUT_DIR, name), renderIcon(size));
  console.log(`wrote ${name} (${size}×${size})`);
}
