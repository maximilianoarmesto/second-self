/**
 * scripts/generate-favicon.ts
 *
 * Generates public/favicon-32x32.png and public/favicon.ico from the logo
 * mark definition in src/components/ui/Logo.tsx:
 *   • A rounded-square background with a deep blue → violet gradient
 *   • Three nodes in a triangular formation connected by diagonal strokes
 *   • A green accent ring on the top node
 *
 * Output sizes:
 *   favicon-32x32.png — 32×32 (used in <link rel="icon"> for PNG browsers)
 *   favicon.ico        — ICO containing a single 16×16 image (legacy / tab bar)
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
// Types & pixel buffer helpers
// ---------------------------------------------------------------------------

type RGBA = [number, number, number, number]; // r, g, b, a  (0–255)

function makeCanvas(size: number): Uint8Array {
  return new Uint8Array(size * size * 4); // transparent black
}

function getIdx(x: number, y: number, size: number): number {
  return (y * size + x) * 4;
}

function blendPixel(
  pixels: Uint8Array,
  size: number,
  x: number,
  y: number,
  [sr, sg, sb, sa]: RGBA,
): void {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  if (sa === 0) return;
  const idx = getIdx(x, y, size);
  if (sa === 255) {
    pixels[idx]     = sr;
    pixels[idx + 1] = sg;
    pixels[idx + 2] = sb;
    pixels[idx + 3] = 255;
    return;
  }
  const sA   = sa / 255;
  const dA   = pixels[idx + 3] / 255;
  const outA = sA + dA * (1 - sA);
  if (outA === 0) return;
  pixels[idx]     = Math.round((sr * sA + pixels[idx]     * dA * (1 - sA)) / outA);
  pixels[idx + 1] = Math.round((sg * sA + pixels[idx + 1] * dA * (1 - sA)) / outA);
  pixels[idx + 2] = Math.round((sb * sA + pixels[idx + 2] * dA * (1 - sA)) / outA);
  pixels[idx + 3] = Math.round(outA * 255);
}

// ---------------------------------------------------------------------------
// Gradient helpers
// ---------------------------------------------------------------------------

/** Linear interpolation between two values. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Sample a linear gradient that runs from (0,0) → (1,1) in normalised coords.
 * Matches the SVG linearGradient x1="0" y1="0" x2="1" y2="1".
 */
function sampleDiagonalGradient(
  x: number,
  y: number,
  size: number,
  colorA: [number, number, number],
  colorB: [number, number, number],
): [number, number, number] {
  const t = ((x / (size - 1)) + (y / (size - 1))) / 2; // 0 → 1 across diagonal
  return [
    Math.round(lerp(colorA[0], colorB[0], t)),
    Math.round(lerp(colorA[1], colorB[1], t)),
    Math.round(lerp(colorA[2], colorB[2], t)),
  ];
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

/**
 * Fill a rounded rectangle using a signed-distance-field approach so the
 * corners are smooth even at small sizes.
 */
function fillRoundedRect(
  pixels: Uint8Array,
  size: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  radius: number,
  colorFn: (px: number, py: number) => RGBA,
): void {
  const x1 = x0 + w - 1;
  const y1 = y0 + h - 1;
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const cx = Math.max(x0 + radius, Math.min(x1 - radius, px));
      const cy = Math.max(y0 + radius, Math.min(y1 - radius, py));
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const sdf = dist - radius; // < 0 inside, > 0 outside
      if (sdf <= -0.5) {
        blendPixel(pixels, size, px, py, colorFn(px, py));
      } else if (sdf < 0.5) {
        const [r, g, b, a] = colorFn(px, py);
        const coverage = 0.5 - sdf;
        blendPixel(pixels, size, px, py, [r, g, b, Math.round(a * coverage)]);
      }
    }
  }
}

/**
 * Fill a circle using a signed-distance-field approach.
 */
function fillCircle(
  pixels: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  radius: number,
  colorFn: (px: number, py: number) => RGBA,
): void {
  const x0 = Math.floor(cx - radius - 1);
  const y0 = Math.floor(cy - radius - 1);
  const x1 = Math.ceil(cx + radius + 1);
  const y1 = Math.ceil(cy + radius + 1);
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      const sdf = dist - radius;
      if (sdf <= -0.5) {
        blendPixel(pixels, size, px, py, colorFn(px, py));
      } else if (sdf < 0.5) {
        const [r, g, b, a] = colorFn(px, py);
        const coverage = 0.5 - sdf;
        blendPixel(pixels, size, px, py, [r, g, b, Math.round(a * coverage)]);
      }
    }
  }
}

/**
 * Stroke a circle outline.
 */
function strokeCircle(
  pixels: Uint8Array,
  size: number,
  cx: number,
  cy: number,
  radius: number,
  strokeWidth: number,
  color: RGBA,
): void {
  const half = strokeWidth / 2;
  const x0 = Math.floor(cx - radius - half - 1);
  const y0 = Math.floor(cy - radius - half - 1);
  const x1 = Math.ceil(cx + radius + half + 1);
  const y1 = Math.ceil(cy + radius + half + 1);
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      // Distance from the ring centre-line
      const ringDist = Math.abs(dist - radius);
      const sdf = ringDist - half;
      if (sdf <= -0.5) {
        blendPixel(pixels, size, px, py, color);
      } else if (sdf < 0.5) {
        const coverage = 0.5 - sdf;
        blendPixel(pixels, size, px, py, [
          color[0], color[1], color[2], Math.round(color[3] * coverage),
        ]);
      }
    }
  }
}

/**
 * Draw a line segment using Wu's anti-aliased line algorithm.
 */
function drawLine(
  pixels: Uint8Array,
  size: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  strokeWidth: number,
  color: RGBA,
): void {
  // Brute-force: iterate pixels in the bounding box and use distance-to-segment.
  const minX = Math.floor(Math.min(x0, x1) - strokeWidth) - 1;
  const minY = Math.floor(Math.min(y0, y1) - strokeWidth) - 1;
  const maxX = Math.ceil(Math.max(x0, x1) + strokeWidth) + 1;
  const maxY = Math.ceil(Math.max(y0, y1) + strokeWidth) + 1;
  const half = strokeWidth / 2;

  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      // Distance from pixel centre to the line segment
      let t = lenSq > 0
        ? ((px - x0) * dx + (py - y0) * dy) / lenSq
        : 0;
      t = Math.max(0, Math.min(1, t));
      const nearX = x0 + t * dx;
      const nearY = y0 + t * dy;
      const dist = Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2);
      const sdf = dist - half;
      if (sdf <= -0.5) {
        blendPixel(pixels, size, px, py, color);
      } else if (sdf < 0.5) {
        const coverage = 0.5 - sdf;
        blendPixel(pixels, size, px, py, [
          color[0], color[1], color[2], Math.round(color[3] * coverage),
        ]);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Logo renderer
// ---------------------------------------------------------------------------

/**
 * Render the Second Self logo mark into a SIZE×SIZE pixel buffer.
 *
 * The logo geometry is defined in a 32×32 coordinate space (matching the SVG
 * viewBox) and then scaled to the requested output size.
 *
 * Logo elements (matching src/components/ui/Logo.tsx):
 *   1. Rounded-square background with blue-900 → violet-700 gradient
 *   2. Three connecting strokes (white 30% alpha, strokeWidth 1.5)
 *   3. Bottom-left node  at (8.5, 22),  r=2.8, blue gradient + white ring
 *   4. Bottom-right node at (23.5, 22), r=2.8, blue gradient + white ring
 *   5. Top node          at (16, 8.5),  r=3.5, blue gradient + green ring
 */
function renderLogo(outputSize: number): Uint8Array {
  const pixels = makeCanvas(outputSize);

  // Scale factor from the 32×32 SVG viewBox to our output size
  const S = outputSize / 32;

  // --- Background gradient colours ---
  const bgA: [number, number, number] = [0x1e, 0x3a, 0x8a]; // blue-900  #1e3a8a
  const bgB: [number, number, number] = [0x6d, 0x28, 0xd9]; // violet-700 #6d28d9

  // --- Node gradient colours ---
  const nodeA: [number, number, number] = [0x60, 0xa5, 0xfa]; // blue-400  #60a5fa
  const nodeB: [number, number, number] = [0x81, 0x8c, 0xf8]; // indigo-400 #818cf8

  // 1. Rounded-square background (SVG: x=1 y=1 w=30 h=30 rx=6)
  fillRoundedRect(
    pixels, outputSize,
    Math.round(1 * S), Math.round(1 * S),
    Math.round(30 * S), Math.round(30 * S),
    Math.max(1, Math.round(6 * S)),
    (px, py) => {
      const [r, g, b] = sampleDiagonalGradient(px, py, outputSize, bgA, bgB);
      return [r, g, b, 255];
    },
  );

  // Node centres in output-pixel space
  const topCX    = 16   * S;
  const topCY    = 8.5  * S;
  const blCX     = 8.5  * S;
  const blCY     = 22   * S;
  const brCX     = 23.5 * S;
  const brCY     = 22   * S;

  // Stroke width: SVG uses 1.5 in 32px space → scale, minimum 0.5px
  const lineW    = Math.max(0.5, 1.5 * S);
  const lineAlpha = Math.round(0.30 * 255); // rgba(255,255,255,0.30)

  // 2. Connection strokes (drawn first, behind nodes)
  const lineColor: RGBA = [255, 255, 255, lineAlpha];
  drawLine(pixels, outputSize, topCX, topCY, blCX, blCY, lineW, lineColor);
  drawLine(pixels, outputSize, topCX, topCY, brCX, brCY, lineW, lineColor);
  drawLine(pixels, outputSize, blCX,  blCY,  brCX, brCY, lineW, lineColor);

  // Node fill gradient helper
  const nodeFill = (px: number, py: number): RGBA => {
    const [r, g, b] = sampleDiagonalGradient(px, py, outputSize, nodeA, nodeB);
    return [r, g, b, 255];
  };

  // White ring stroke width: SVG uses 0.6 in 32px space
  const nodeRingW = Math.max(0.4, 0.6 * S);
  const nodeRingColor: RGBA = [255, 255, 255, Math.round(0.45 * 255)];

  // 3. Bottom-left node (r=2.8 in SVG space)
  const blR = Math.max(1, 2.8 * S);
  fillCircle(pixels, outputSize, blCX, blCY, blR, nodeFill);
  strokeCircle(pixels, outputSize, blCX, blCY, blR, nodeRingW, nodeRingColor);

  // 4. Bottom-right node (r=2.8)
  const brR = Math.max(1, 2.8 * S);
  fillCircle(pixels, outputSize, brCX, brCY, brR, nodeFill);
  strokeCircle(pixels, outputSize, brCX, brCY, brR, nodeRingW, nodeRingColor);

  // 5. Top node (r=3.5, green accent ring — drawn last so it's on top)
  const topR = Math.max(1.2, 3.5 * S);
  fillCircle(pixels, outputSize, topCX, topCY, topR, nodeFill);
  // Green accent ring: SVG stroke="#4ade80" strokeWidth="1.2"
  const greenRingW = Math.max(0.5, 1.2 * S);
  const greenColor: RGBA = [0x4a, 0xde, 0x80, 255]; // #4ade80
  strokeCircle(pixels, outputSize, topCX, topCY, topR, greenRingW, greenColor);

  return pixels;
}

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
 * Encode a SIZE×SIZE RGBA pixel buffer as a PNG file.
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
    const rowStart = y * width * 4;
    for (let i = 0; i < width * 4; i++) {
      rawRows[rowOffset + 1 + i] = rgba[rowStart + i];
    }
  }

  // Compress with DEFLATE (zlib)
  const compressed = zlib.deflateSync(rawRows, { level: 9 });

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// ICO encoder
// ---------------------------------------------------------------------------

/**
 * Build a minimal .ico file containing a single 16×16 PNG-embedded image.
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

  const imgSizeLE   = Buffer.allocUnsafe(4);
  const imgOffsetLE = Buffer.allocUnsafe(4);
  imgSizeLE.writeUInt32LE(pngData.length, 0);
  imgOffsetLE.writeUInt32LE(6 + 16, 0); // 6-byte header + 16-byte dir entry

  // Directory entry (16 bytes)
  const entry = Buffer.concat([
    Buffer.from([
      width  & 0xff,  // Width  (0 = 256)
      height & 0xff,  // Height (0 = 256)
      0x00,           // Colour count (0 = no palette)
      0x00,           // Reserved
      0x01, 0x00,     // Colour planes
      0x20, 0x00,     // Bits per pixel: 32
    ]),
    imgSizeLE,
    imgOffsetLE,
  ]);

  return Buffer.concat([header, entry, pngData]);
}

// ---------------------------------------------------------------------------
// Write files
// ---------------------------------------------------------------------------

const outDir = path.resolve(process.cwd(), 'public');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// favicon-32x32.png — 32×32 logo mark
const pixels32  = renderLogo(32);
const png32     = encodePNG(pixels32, 32, 32);

// favicon.ico — 16×16 logo mark (traditional browser tab size)
const pixels16  = renderLogo(16);
const png16     = encodePNG(pixels16, 16, 16);
const ico16     = encodeICO(png16, 16, 16);

const png32Path = path.join(outDir, 'favicon-32x32.png');
const icoPath   = path.join(outDir, 'favicon.ico');

fs.writeFileSync(png32Path, png32);
fs.writeFileSync(icoPath,   ico16);

console.log(`✔  Written ${png32Path}  (${png32.length} bytes)`);
console.log(`✔  Written ${icoPath}    (${ico16.length} bytes)`);
