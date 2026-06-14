// ADV-archive RLE (mirror of decompress_rle @ ADV.BIN 0x800b2054). Some sprite archives (e.g.
// ADVCHR.BIN) store their TIM blob RLE-compressed, so they show 0 TIMs until expanded. Tag byte:
//   <0x80      back-reference (10-bit sliding-window offset, 2..33 bytes)
//   0x80..0x9f literal run (1..32 bytes)
//   0xa0..0xbf 0x00/byte interleave (4bpp expand)
//   0xc0..0xdf byte repeat (2..33×)
//   0xe0..0xff zero run (0xff = next byte + 0x20, else 1..32)
// `7f ff` ends the stream. Ports src/persona1/image.py decompress_rle.

export function decompressRle(src: Uint8Array, maxOut = 1 << 24): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (out.length < maxOut && i < src.length) {
    const tag = src[i];
    if (tag === 0x7f && i + 1 < src.length && src[i + 1] === 0xff) break; // EOF
    i++;
    if (tag < 0x80) {
      const lo = src[i++];
      const off = ((0xfc00 | (tag << 8) | lo) - 0x10000); // 10-bit negative offset
      const n = ((tag >> 2) & 0x1f) + 2;
      for (let k = 0; k < n; k++) out.push(out[out.length + off]);
    } else if (tag < 0xa0) {
      const n = (tag & 0x1f) + 1;
      for (let k = 0; k < n; k++) out.push(src[i++]);
    } else if (tag < 0xc0) {
      const n = (tag & 0x1f) + 1;
      for (let k = 0; k < n; k++) {
        out.push(0, src[i++]);
      }
    } else if (tag < 0xe0) {
      const b = src[i++];
      const n = (tag & 0x1f) + 2;
      for (let k = 0; k < n; k++) out.push(b);
    } else {
      const n = tag === 0xff ? src[i++] + 0x20 : (tag & 0x1f) + 1;
      for (let k = 0; k < n; k++) out.push(0);
    }
  }
  return Uint8Array.from(out);
}
