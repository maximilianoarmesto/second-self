/**
 * scripts/generate-favicon.ts
 *
 * Generates public/favicon-32x32.png and public/favicon.ico from the logo
 * mark definition: a 32×32 black rounded-square with white "SS" lettering —
 * matching the sidebar brand badge in src/components/layout/Sidebar.tsx.
 *
 * Run with:  npx tsx scripts/generate-favicon.ts
 *
 * No external image libraries are required — PNG and ICO are assembled from
 * raw bytes using Node's built-in `zlib` for DEFLATE compression.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

// ---------------------------------------------------------------------------
// Canvas — 32×32 RGBA pixel grid
// ---------------------------------------------------------------------------

const SIZE = 32;
type RGBA = [number, number, number, number]; // r, g, b, a  (0–255)

/** Flat RGBA pixel buffer, row-major, top-to-bottom. */
const pixels = new Uint8Array(SIZE * SIZE * 4); // initialised to 0 (transparent)

function setPixel(x: number, y: number, [r, g, b, a]: RGBA): void {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const idx = (y * SIZE + x) * 4;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
  pixels[idx + 3] = a;
}

/** Blend src over dst using standard Porter-Duff "src-over". */
function blendPixel(x: number, y: number, [sr, sg, sb, sa]: RGBA): void {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  if (sa === 0) return;
  if (sa === 255) {
    setPixel(x, y, [sr, sg, sb, sa]);
    return;
  }
  const idx = (y * SIZE + x) * 4;
  const dr = pixels[idx];
  const dg = pixels[idx + 1];
  const db = pixels[idx + 2];
  const da = pixels[idx + 3];
  const sA = sa / 255;
  const dA = da / 255;
  const outA = sA + dA * (1 - sA);
  if (outA === 0) return;
  pixels[idx] = Math.round((sr * sA + dr * dA * (1 - sA)) / outA);
  pixels[idx + 1] = Math.round((sg * sA + dg * dA * (1 - sA)) / outA);
  pixels[idx + 2] = Math.round((sb * sA + db * dA * (1 - sA)) / outA);
  pixels[idx + 3] = Math.round(outA * 255);
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

/**
 * Fill a rounded rectangle using a signed-distance-field approach so the
 * corners are smooth even at small sizes.
 *
 * @param radius  Corner radius in pixels.
 * @param color   Fill colour.
 * @param x0,y0   Top-left corner of the rect.
 * @param w,h     Width / height.
 */
function fillRoundedRect(
  x0: number, y0: number, w: number, h: number,
  radius: number, color: RGBA,
): void {
  const x1 = x0 + w - 1;
  const y1 = y0 + h - 1;

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      // Distance to nearest corner centre
      const cx = Math.max(x0 + radius, Math.min(x1 - radius, px));
      const cy = Math.max(y0 + radius, Math.min(y1 - radius, py));
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy); // distance from corner arc

      // SDF: negative = inside, positive = outside
      const sdf = dist - radius;

      if (sdf <= -0.5) {
        // Fully inside
        blendPixel(px, py, color);
      } else if (sdf < 0.5) {
        // Anti-aliased edge: interpolate coverage
        const coverage = 0.5 - sdf; // 0→1
        blendPixel(px, py, [color[0], color[1], color[2], Math.round(color[3] * coverage)]);
      }
      // else outside — skip
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal bitmap font — 5×7 pixel glyphs for "S"
// ---------------------------------------------------------------------------
// Each glyph is encoded as an array of 7 rows; each row is a 5-bit bitmask
// (bit 4 = leftmost column).

const GLYPH_S: number[] = [
  0b01110,
  0b10001,
  0b10000,
  0b01110,
  0b00001,
  0b10001,
  0b01110,
];

/** Render a single glyph at pixel (ox, oy) with the given colour. */
function drawGlyph(glyph: number[], ox: number, oy: number, color: RGBA): void {
  for (let row = 0; row < glyph.length; row++) {
    const bits = glyph[row];
    for (let col = 0; col < 5; col++) {
      if (bits & (1 << (4 - col))) {
        blendPixel(ox + col, oy + row, color);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Compose the 32×32 icon
// ---------------------------------------------------------------------------

// 1. Black rounded rectangle — 2 px margin on all sides, ~4 px radius
//    Matches the sidebar badge: "rounded-lg bg-primary" (black).
const MARGIN = 2;
const RECT_SIZE = SIZE - MARGIN * 2;   // 28
const RADIUS = 4;
const BLACK: RGBA = [0, 0, 0, 255];
const WHITE: RGBA = [255, 255, 255, 255];

fillRoundedRect(MARGIN, MARGIN, RECT_SIZE, RECT_SIZE, RADIUS, BLACK);

// 2. Two "S" glyphs side-by-side, centred in the rectangle.
//    Each glyph is 5 wide × 7 tall; gap between them = 2 px.
const GLYPH_W = 5;
const GLYPH_H = 7;
const GLYPH_GAP = 2;
const TOTAL_W = GLYPH_W * 2 + GLYPH_GAP; // 12
const TOTAL_H = GLYPH_H;                  //  7

// Centre within the full 32×32 canvas (rect starts at MARGIN but fills to
// SIZE-MARGIN, so its visual centre is SIZE/2 = 16).
const startX = Math.round((SIZE - TOTAL_W) / 2); // 10
const startY = Math.round((SIZE - TOTAL_H) / 2); // 12 (one pixel lower than 12.5)

drawGlyph(GLYPH_S, startX, startY, WHITE);
drawGlyph(GLYPH_S, startX + GLYPH_W + GLYPH_GAP, startY, WHITE);

// ---------------------------------------------------------------------------
// PNG encoder
// ---------------------------------------------------------------------------

/** Big-endian 32-bit unsigned integer → 4 bytes. */
function uint32BE(n: number): Buffer {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32BE(n >>> 0, 0);
  return buf;
}

/** CRC-32 table (IEEE polynomial). */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a PNG chunk: length + type + data + CRC. */
function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf = uint32BE(data.length);
  const payload = Buffer.concat([typeBytes, data]);
  const crcBuf = uint32BE(crc32(payload));
  return Buffer.concat([lenBuf, payload, crcBuf]);
}

/**
 * Encode a 32×32 RGBA pixel buffer as a PNG file.
 * Uses filter type 0 (None) per scanline for simplicity, then DEFLATE.
 */
function encodePNG(rgba: Uint8Array, width: number, height: number): Buffer {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.concat([
    uint32BE(width),
    uint32BE(height),
    Buffer.from([8, 6, 0, 0, 0]), // bit depth=8, colorType=6 (RGBA), compression/filter/interlace=0
  ]);

  // Raw image data: prepend filter byte 0x00 to each row
  const rawRows = Buffer.allocUnsafe(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawRows[rowOffset] = 0; // filter type: None
    // Copy row bytes from the Uint8Array into the Buffer
    const rowStart = y * width * 4;
    for (let i = 0; i < width * 4; i++) {
      rawRows[rowOffset + 1 + i] = rgba[rowStart + i];
    }
  }

  // Compress with DEFLATE (zlib)
  const compressed = zlib.deflateSync(rawRows, { level: 9 });

  // IEND
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', iend),
  ]);
}

// ---------------------------------------------------------------------------
// ICO encoder
// ---------------------------------------------------------------------------

/**
 * Build a minimal .ico file containing a single 32×32 RGBA image.
 *
 * ICO format reference:
 *   https://en.wikipedia.org/wiki/ICO_(file_format)
 *
 * We embed the image as a PNG (supported by all modern browsers/OS) rather
 * than a BMP — it is smaller and preserves full alpha transparency.
 */
function encodeICO(pngData: Buffer, width: number, height: number): Buffer {
  // ICO header (6 bytes)
  const header = Buffer.from([
    0x00, 0x00,       // Reserved — must be 0
    0x01, 0x00,       // Type: 1 = ICO
    0x01, 0x00,       // Number of images: 1
  ]);

  // Image data size and offset as little-endian uint32
  const imgSizeLE = Buffer.allocUnsafe(4);
  imgSizeLE.writeUInt32LE(pngData.length, 0);
  const imgOffsetLE = Buffer.allocUnsafe(4);
  imgOffsetLE.writeUInt32LE(6 + 16, 0); // 6-byte header + 16-byte dir entry

  // Directory entry (16 bytes per image)
  const entry = Buffer.concat([
    Buffer.from([
      width & 0xff,   // Width  (0 = 256)
      height & 0xff,  // Height (0 = 256)
      0x00,           // Colour count (0 = no palette)
      0x00,           // Reserved
      0x01, 0x00,     // Colour planes
      0x20, 0x00,     // Bits per pixel: 32
    ]),
    imgSizeLE,        // Image data size (little-endian)
    imgOffsetLE,      // Offset of image data (little-endian)
  ]);

  return Buffer.concat([header, entry, pngData]);
}

// ---------------------------------------------------------------------------
// Write files
// ---------------------------------------------------------------------------

const outDir = path.resolve(process.cwd(), 'public');

// Ensure the output directory exists (it always does in this project,
// but guard against edge cases).
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const pngBuffer = encodePNG(pixels as unknown as Buffer & Uint8Array, SIZE, SIZE);
const icoBuffer = encodeICO(pngBuffer, SIZE, SIZE);

const pngPath = path.join(outDir, 'favicon-32x32.png');
const icoPath = path.join(outDir, 'favicon.ico');

fs.writeFileSync(pngPath, pngBuffer);
fs.writeFileSync(icoPath, icoBuffer);

console.log(`✔  Written ${pngPath}  (${pngBuffer.length} bytes)`);
console.log(`✔  Written ${icoPath}   (${icoBuffer.length} bytes)`);
