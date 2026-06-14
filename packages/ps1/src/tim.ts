// PSX TIM image: span scanner + pixel decode to RGBA. Used to splice ending sprites (span only) and to
// dump every TIM in the sprite/portrait archives as PNG. Ports web/src/core/tim.ts + the decode half of
// src/persona1/image.py. TIM has no index table — a bare concatenation of image blocks — so the scan is
// a structure-driven walk block by block. CLUT colour 0 is transparent (PSX convention).

import { decompressRle } from "./rle.js";

const rd32 = (d: Uint8Array, o: number): number => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const rd16 = (d: Uint8Array, o: number): number => d[o] | (d[o + 1] << 8);
const exp5 = (c5: number): number => ((c5 << 3) | (c5 >> 2)) & 0xff; // 5-bit → 8-bit, reversible via >>3

export interface TimSpan { start: number; end: number }

/** A fully decoded TIM: RGBA pixels at the renderer's pixel width (4bpp packs 4 px/halfword). */
export interface TimImage { width: number; height: number; rgba: Uint8Array }

function parseTim(d: Uint8Array, o: number): TimSpan | null {
  if (o + 8 > d.length || d[o] !== 0x10 || d[o + 1] || d[o + 2] || d[o + 3]) return null;
  const flags = rd32(d, o + 4);
  if ((flags & 7) > 3) return null;
  let p = o + 8;
  if (flags & 8) { // CLUT block
    if (p + 12 > d.length) return null;
    const blen = rd32(d, p);
    if (blen < 12 || p + blen > d.length) return null;
    p += blen;
  }
  if (p + 12 > d.length) return null;
  const blen = rd32(d, p);
  const w = rd16(d, p + 8);
  const h = rd16(d, p + 10);
  // reject absurd dims (a stray 0x10 byte can otherwise look like a TIM): VRAM is 1024x512
  if (blen < 12 || p + blen > d.length || !(w > 0 && w <= 1024 && h > 0 && h <= 512)) return null;
  return { start: o, end: p + blen };
}

export function iterTims(d: Uint8Array): TimSpan[] {
  const out: TimSpan[] = [];
  let o = 0;
  while (o + 8 <= d.length) {
    const t = parseTim(d, o);
    if (t) {
      out.push(t);
      o = Math.max(t.end, o + 4);
    } else {
      o += 4;
    }
  }
  return out;
}

interface TimBlocks { pmode: number; clut: Uint8Array | null; vw: number; vh: number; pix: Uint8Array; end: number }

/** Parse the TIM at `o` into its CLUT + pixel blocks (or null if it isn't a valid TIM). */
function parseTimBlocks(d: Uint8Array, o: number): TimBlocks | null {
  if (o + 8 > d.length || d[o] !== 0x10 || d[o + 1] || d[o + 2] || d[o + 3]) return null;
  const flags = rd32(d, o + 4);
  const pmode = flags & 7;
  if (pmode > 3) return null;
  let p = o + 8;
  let clut: Uint8Array | null = null;
  if (flags & 8) {
    if (p + 12 > d.length) return null;
    const blen = rd32(d, p);
    if (blen < 12 || p + blen > d.length) return null;
    clut = d.subarray(p + 12, p + blen);
    p += blen;
  }
  if (p + 12 > d.length) return null;
  const blen = rd32(d, p);
  const vw = rd16(d, p + 8);
  const vh = rd16(d, p + 10);
  if (blen < 12 || p + blen > d.length || !(vw > 0 && vw <= 1024 && vh > 0 && vh <= 512)) return null;
  return { pmode, clut, vw, vh, pix: d.subarray(p + 12, p + blen), end: p + blen };
}

function palette(clut: Uint8Array | null): Uint8Array {
  const pal = new Uint8Array(256 * 3);
  const n = clut ? clut.length >> 1 : 0;
  for (let i = 0; i < 256; i++) {
    const c = i < n ? clut![i * 2] | (clut![i * 2 + 1] << 8) : 0;
    pal[i * 3] = exp5(c & 0x1f);
    pal[i * 3 + 1] = exp5((c >> 5) & 0x1f);
    pal[i * 3 + 2] = exp5((c >> 10) & 0x1f);
  }
  return pal;
}

/** Decode the TIM at offset `o` to RGBA (pixel width = renderer width: 4bpp→4×, 8bpp→2×, 16bpp→1× vw). */
export function decodeTimAt(d: Uint8Array, o: number): TimImage | null {
  const t = parseTimBlocks(d, o);
  if (!t) return null;
  const { pmode, clut, vw, vh, pix } = t;
  if (pmode === 2) { // 16-bpp direct colour
    const rgba = new Uint8Array(vw * vh * 4);
    for (let i = 0; i < vw * vh && i * 2 + 1 < pix.length; i++) {
      const c = pix[i * 2] | (pix[i * 2 + 1] << 8);
      rgba[i * 4] = exp5(c & 0x1f);
      rgba[i * 4 + 1] = exp5((c >> 5) & 0x1f);
      rgba[i * 4 + 2] = exp5((c >> 10) & 0x1f);
      rgba[i * 4 + 3] = c === 0 ? 0 : 255;
    }
    return { width: vw, height: vh, rgba };
  }
  const w = vw * (pmode === 0 ? 4 : 2); // indexed: unpack to one index per pixel
  const pal = palette(clut);
  const rgba = new Uint8Array(w * vh * 4);
  for (let i = 0; i < w * vh; i++) {
    let idx: number;
    if (pmode === 0) {
      const b = (i >> 1) < pix.length ? pix[i >> 1] : 0;
      idx = i & 1 ? b >> 4 : b & 0xf;
    } else {
      idx = i < pix.length ? pix[i] : 0;
    }
    rgba[i * 4] = pal[idx * 3];
    rgba[i * 4 + 1] = pal[idx * 3 + 1];
    rgba[i * 4 + 2] = pal[idx * 3 + 2];
    rgba[i * 4 + 3] = idx === 0 ? 0 : 255; // CLUT index 0 = transparent
  }
  return { width: w, height: vh, rgba };
}

/**
 * Bytes to scan for TIMs: `d` as-is, unless it has none but RLE-decompresses to some (ADVCHR-style
 * compressed sprite archives). Lets the gfx dump transparently handle compressed archives.
 */
export function timBlob(d: Uint8Array): Uint8Array {
  if (iterTims(d).length > 0) return d;
  try {
    const dec = decompressRle(d);
    if (iterTims(dec).length > 0) return dec;
  } catch { /* not RLE */ }
  return d;
}

/** Decode every TIM in a file (RLE-decompressing first if needed) to RGBA images, in order. */
export function decodeAllTims(file: Uint8Array): TimImage[] {
  const blob = timBlob(file);
  return iterTims(blob).map((s) => decodeTimAt(blob, s.start)).filter((t): t is TimImage => t !== null);
}

/**
 * Replace the TIMs at `indices` in `us` with the same-indexed TIMs from `jp`. Both files must share
 * the TIM layout (same offsets/sizes) — true for the ending images the US only recoloured in place —
 * so this is a byte-exact in-place splice.
 */
export function spliceTimsFromJp(us: Uint8Array, jp: Uint8Array, indices: number[]): Uint8Array {
  const ut = iterTims(us);
  const jt = iterTims(jp);
  const out = us.slice();
  for (const i of indices) {
    const u = ut[i];
    const j = jt[i];
    if (!u || !j) throw new Error(`TIM #${i} not found (us has ${ut.length}, jp has ${jt.length})`);
    if (u.end - u.start !== j.end - j.start) {
      throw new Error(`TIM #${i} size mismatch (us ${u.end - u.start}B, jp ${j.end - j.start}B)`);
    }
    out.set(jp.subarray(j.start, j.end), u.start);
  }
  return out;
}
