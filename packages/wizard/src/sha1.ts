// Streaming SHA-1 (FIPS 180-1) so a ~700 MB disc can be hashed in bounded memory and with progress.
// Web Crypto's subtle.digest() is one-shot (whole file in RAM, no progress); this reads the file in
// big slices, folding each into an incremental digest and reporting how far along it is.

export class Sha1 {
  private h = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  private readonly block = new Uint8Array(64);
  private blockLen = 0;
  private len = 0; // total bytes fed
  private readonly w = new Int32Array(80);

  private process(data: Uint8Array, off: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const o = off + i * 4;
      w[i] = (data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3];
    }
    for (let i = 16; i < 80; i++) {
      const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (n << 1) | (n >>> 31);
    }
    let a = this.h[0];
    let b = this.h[1];
    let c = this.h[2];
    let d = this.h[3];
    let e = this.h[4];
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    this.h[0] = (this.h[0] + a) | 0;
    this.h[1] = (this.h[1] + b) | 0;
    this.h[2] = (this.h[2] + c) | 0;
    this.h[3] = (this.h[3] + d) | 0;
    this.h[4] = (this.h[4] + e) | 0;
  }

  update(data: Uint8Array): void {
    this.len += data.length;
    let i = 0;
    if (this.blockLen > 0) {
      while (i < data.length && this.blockLen < 64) this.block[this.blockLen++] = data[i++];
      if (this.blockLen === 64) {
        this.process(this.block, 0);
        this.blockLen = 0;
      }
    }
    while (i + 64 <= data.length) {
      this.process(data, i);
      i += 64;
    }
    while (i < data.length) this.block[this.blockLen++] = data[i++];
  }

  digest(): string {
    const bits = this.len * 8; // exact up to 2^53 bytes — far beyond any disc image
    this.block[this.blockLen++] = 0x80;
    if (this.blockLen > 56) {
      while (this.blockLen < 64) this.block[this.blockLen++] = 0;
      this.process(this.block, 0);
      this.blockLen = 0;
    }
    while (this.blockLen < 56) this.block[this.blockLen++] = 0;
    const dv = new DataView(this.block.buffer);
    dv.setUint32(56, Math.floor(bits / 0x100000000));
    dv.setUint32(60, bits >>> 0);
    this.process(this.block, 0);
    let out = "";
    for (let i = 0; i < 5; i++) out += (this.h[i] >>> 0).toString(16).padStart(8, "0");
    return out;
  }
}

const CHUNK = 16 * 1024 * 1024;

/** SHA-1 of a File as lowercase hex, read in 16 MB slices (bounded memory) with progress 0→1. */
export async function hashFileSha1(file: File, onProgress?: (fraction: number) => void): Promise<string> {
  const sha = new Sha1();
  for (let off = 0; off < file.size; off += CHUNK) {
    const end = Math.min(off + CHUNK, file.size);
    sha.update(new Uint8Array(await file.slice(off, end).arrayBuffer()));
    onProgress?.(end / file.size);
  }
  if (file.size === 0) onProgress?.(1);
  return sha.digest();
}
