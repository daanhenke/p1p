// Minimal PNG writer + 1bpp font-atlas renderer (TS port of tools/font_dump.py) so `dump` can emit
// the glyph atlases with no image dependency — just node:zlib for the IDAT deflate.

import { deflateSync } from "node:zlib";

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode rows (each `width*channels` bytes) as an 8-bit PNG (channels 3 = RGB, 4 = RGBA). */
export function writePng(width: number, height: number, rows: Uint8Array[], channels: 3 | 4 = 3): Uint8Array {
  const stride = 1 + width * channels;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) raw.set(rows[y], y * stride + 1); // filter byte 0 stays 0
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 4 ? 6 : 2; // colour type: 6 = RGBA, 2 = RGB
  const sig = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    png.set(p, o);
    o += p.length;
  }
  return png;
}

/** Encode a flat RGBA buffer (`width*height*4` bytes) as an RGBA PNG. */
export function writeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) rows.push(rgba.subarray(y * width * 4, (y + 1) * width * 4));
  return writePng(width, height, rows, 4);
}

export interface FontAtlasOptions { w?: number; h?: number; cols?: number; scale?: number }

/** Render a 1bpp glyph atlas (MSB-first) to a PNG (mirrors tools/font_dump.py defaults). */
export function renderFontAtlas(font: Uint8Array, opts: FontAtlasOptions = {}): Uint8Array {
  const w = opts.w ?? 16;
  const h = opts.h ?? 16;
  const cols = opts.cols ?? 16;
  const scale = opts.scale ?? 3;
  const bytesPerRow = (w + 7) >> 3;
  const glyphSz = bytesPerRow * h;
  const count = Math.floor(font.length / glyphSz);
  const rows = Math.ceil(count / cols);
  const cw = w + 1;
  const ch = h + 1; // 1px gutter
  const pw = cols * cw;
  const ph = rows * ch;
  const BG = [24, 24, 32];
  const FG = [235, 235, 210];
  const grid = new Uint8Array(ph * pw * 3);
  for (let i = 0; i < ph * pw; i++) grid.set(BG, i * 3);
  for (let gi = 0; gi < count; gi++) {
    const base = gi * glyphSz;
    const gx = (gi % cols) * cw;
    const gy = Math.floor(gi / cols) * ch;
    for (let ry = 0; ry < h; ry++) {
      for (let cx = 0; cx < w; cx++) {
        const byte = font[base + ry * bytesPerRow + (cx >> 3)];
        if ((byte >> (7 - (cx & 7))) & 1) grid.set(FG, ((gy + 1 + ry) * pw + gx + 1 + cx) * 3);
      }
    }
  }
  // scale up into RGB rows
  const outW = pw * scale;
  const outH = ph * scale;
  const out: Uint8Array[] = [];
  for (let y = 0; y < outH; y++) {
    const sy = Math.floor(y / scale);
    const row = new Uint8Array(outW * 3);
    for (let x = 0; x < outW; x++) {
      const sx = Math.floor(x / scale);
      row.set(grid.subarray((sy * pw + sx) * 3, (sy * pw + sx) * 3 + 3), x * 3);
    }
    out.push(row);
  }
  return writePng(outW, outH, out);
}
