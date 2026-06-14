// Platform-neutral byte IO. No game/console constants live here (PSX RAM bases etc. belong to @p1p/ps1).

export function u16le(buf: Uint8Array, off: number): number {
  return (buf[off] | (buf[off + 1] << 8)) & 0xffff;
}

export function u32le(buf: Uint8Array, off: number): number {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

/** Little-endian unsigned int of width `w` (1..4) at `off`. */
export function uintLE(buf: Uint8Array, off: number, w: number): number {
  let v = 0;
  for (let i = 0; i < w; i++) v += buf[off + i] * 2 ** (8 * i);
  return v;
}

export function packU32le(val: number): Uint8Array {
  return Uint8Array.of(val & 0xff, (val >>> 8) & 0xff, (val >>> 16) & 0xff, (val >>> 24) & 0xff);
}

export function packU32be(val: number): Uint8Array {
  return Uint8Array.of((val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff);
}

/** `w`-byte little-endian encoding of `val` (masked to `w` bytes). */
export function toBytesLE(val: number, w: number): Uint8Array {
  const out = new Uint8Array(w);
  let v = val >>> 0;
  for (let i = 0; i < w; i++) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return out;
}

/** Write a `w`-byte little-endian value into `buf` at `off` in place. */
export function writeUintLE(buf: Uint8Array, off: number, val: number, w: number): void {
  let v = val >>> 0;
  for (let i = 0; i < w; i++) {
    buf[off + i] = v & 0xff;
    v = Math.floor(v / 256);
  }
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const toHex = (u: Uint8Array): string =>
  Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

export function fromHex(s: string): Uint8Array {
  const m = s.replace(/\s+/g, "").match(/../g);
  return m ? Uint8Array.from(m, (h) => parseInt(h, 16)) : new Uint8Array(0);
}

/** Forward-only little-endian reader over a byte slice. */
export class ByteReader {
  pos = 0;
  constructor(readonly data: Uint8Array, start = 0) { this.pos = start; }

  get remaining(): number { return this.data.length - this.pos; }
  u8(): number { return this.data[this.pos++]; }
  u16(): number { this.pos += 2; return u16le(this.data, this.pos - 2); }
  u32(): number { this.pos += 4; return u32le(this.data, this.pos - 4); }
  bytes(n: number): Uint8Array { this.pos += n; return this.data.subarray(this.pos - n, this.pos); }
  skip(n: number): this { this.pos += n; return this; }
}

/** Growable little-endian writer. */
export class ByteWriter {
  private buf: number[] = [];
  u8(v: number): this { this.buf.push(v & 0xff); return this; }
  u16(v: number): this { this.buf.push(v & 0xff, (v >>> 8) & 0xff); return this; }
  u32(v: number): this {
    const u = v >>> 0;
    this.buf.push(u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, (u >>> 24) & 0xff);
    return this;
  }

  bytes(b: Uint8Array): this { for (const x of b) this.buf.push(x); return this; }
  get length(): number { return this.buf.length; }
  toBytes(): Uint8Array { return Uint8Array.from(this.buf); }
}
