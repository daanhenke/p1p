// Atlus custom glyph codec (port of src/persona1/text/codec.py + web/src/core/text/codec.ts), but
// parameterized by glyph maps supplied from a profile (no hardcoded JSON). Two byte schemes share it:
//   • dialogue text: 2-byte scheme — byte B with B&0x80 set is a lead (0x80..0x87), index =
//     ((B&0x7F)<<8)|next; otherwise a 1-byte glyph, index = B.
//   • fixed-stride name fields: 1 byte per glyph = the glyph INDEX directly (Latin/kana are < 0x100).

export interface GlyphTable {
  /** index → display char (or multi-char token). */
  i2c: Record<number, string>;
  /** display char → index. */
  c2i: Record<string, number>;
}

export class Glyph {
  private readonly i2c: Map<number, string>;
  private readonly c2i: Map<string, number>;

  constructor(table: GlyphTable) {
    this.i2c = new Map(Object.entries(table.i2c).map(([k, v]) => [Number(k), v]));
    this.c2i = new Map(Object.entries(table.c2i));
  }

  /** Display token for an index, or the raw 〔hhh〕 escape if unmapped. */
  charFor(index: number): string {
    const ch = this.i2c.get(index);
    return ch ?? `〔${index.toString(16).padStart(3, "0")}〕`;
  }

  indexFor(char: string): number | undefined { return this.c2i.get(char); }

  /** 2-byte-scheme encoding of a glyph index. */
  encodeGlyph(index: number): Uint8Array {
    if (index < 0x80) return Uint8Array.of(index);
    return Uint8Array.of(0x80 | (index >> 8), index & 0xff);
  }

  /** Decode the glyph at `pos` → [index, byteLength], per the 2-byte scheme. */
  decodeGlyphAt(buf: Uint8Array, pos: number): [number, number] {
    const b = buf[pos];
    if (b & 0x80) return [((b & 0x7f) << 8) | (pos + 1 < buf.length ? buf[pos + 1] : 0), 2];
    return [b, 1];
  }
}
