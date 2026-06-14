// The dialogue "resource" stream codec: a byte stream of 2-byte glyphs interleaved with FF op-codes
// (control codes + script ops). Decodes to readable text with {mnemonic[:hex]} markers; duplicate
// glyphs decode to their glyphmap token (e.g. the alternate "b" → 〔b^〕, still showing the letter),
// and 〔hex〕 / 〔=hex〕 escape genuinely-unmapped indices / non-canonical storage. Encodes back
// byte-exact. Ports src/persona1/dungeon.py, parameterized by a Glyph (+ optional cross-font fallback).

import { toHex } from "@p1p/core";
import type { Glyph } from "./glyph.js";
import { mnemonic, opcodeFor, schemaLen, schema, FIELD } from "../script/opcodes.js";

// {mnem[:op[:op…]]} op | 〔inner〕 glyph token (alt-glyph token / =rawbytes / rawindexhex) | any char.
// Operands are ":"-joined readable values (see renderOperands); an "x"-prefixed operand is a raw-hex
// fallback for codes whose stored width doesn't match the field schema. Exported so other codecs
// (e.g. dungeon splitMessage) tokenise markers identically.
export const TOK = /\{([a-z0-9_]+)((?::[-0-9a-fA-Fx]+)*)\}|〔([^〕]*)〕|[\s\S]/gu;

/** Little-endian read of an operand chunk to its integer value (bytes are stored LE on PSX). */
function leValue(b: Uint8Array): number {
  let v = 0;
  for (let i = b.length - 1; i >= 0; i--) v = v * 256 + b[i];
  return v;
}

/**
 * Render an op's operand bytes as a ":"-prefixed, ":"-joined list of readable values — decimal for
 * count/signed fields, big-endian hex (no leading zeros) otherwise. Only when the field schema
 * exactly covers the stored bytes; else a single "x<rawhex>" operand keeps the encode a byte-exact
 * inverse. Returns "" for no operands.
 */
function renderOperands(op: number, args: Uint8Array): string {
  if (!args.length) return "";
  const fields = schema(op);
  const total = fields.reduce((s, [, , w]) => s + w, 0);
  if (total !== args.length) return ":x" + toHex(args); // schema/width mismatch → raw, guaranteed inverse
  let off = 0;
  const parts = fields.map(([, ftype, w]) => {
    const style = FIELD[ftype]?.[2] ?? "hex";
    let v = leValue(args.subarray(off, off + w));
    off += w;
    if (style === "signed" && v >= 2 ** (8 * w - 1)) v -= 2 ** (8 * w);
    return style === "dec" || style === "signed" ? String(v) : v.toString(16);
  });
  return ":" + parts.join(":");
}

/** Inverse of {@link renderOperands}: push an op's operand bytes (LE) from its ":"-list string. */
function encodeOperands(op: number, argStr: string, out: number[]): void {
  if (!argStr) return;
  const fields = schema(op);
  argStr.split(":").filter((s) => s.length).forEach((tok, i) => {
    if (tok.startsWith("x")) { // raw-hex fallback operand
      const h = tok.slice(1);
      for (let j = 0; j < h.length; j += 2) out.push(parseInt(h.slice(j, j + 2), 16));
      return;
    }
    const [, ftype, w] = fields[i] ?? ["", "u8", 1];
    const style = FIELD[ftype]?.[2] ?? "hex";
    let v = style === "dec" || style === "signed" ? parseInt(tok, 10) : parseInt(tok, 16);
    if (v < 0) v += 2 ** (8 * w);
    for (let j = 0; j < w; j++) out.push((v >>> (8 * j)) & 0xff); // little-endian store
  });
}

export interface DecodeOptions {
  /** Opcode operand length (defaults to the schema length). */
  opLen?: (op: number) => number;
  /**
   * Throw on a glyph with no clean char mapping instead of emitting a 〔hex〕 escape. Use when the
   * blob is KNOWN to be real, fully-mappable text (e.g. a say-target message decoded with the right
   * font) so a wrong offset / font gap fails loudly instead of round-tripping placeholder hex.
   */
  strict?: boolean;
}

/**
 * Lay a {nl}-marked dialogue string out as a multiline source block (like the script listing): the
 * content starts on its own line after the opening tag, and every {nl} keeps its explicit marker AND
 * is followed by a real newline. The newlines are purely decorative — {nl} carries the line breaks —
 * so the parser's whitespace handling never matters.
 */
export const toMultiline = (s: string): string => "\n" + s.replace(/\{nl\}/gu, "{nl}\n") + "\n";

/** Inverse of {@link toMultiline}: drop the decorative newlines (the explicit {nl} markers remain). */
export const fromMultiline = (s: string): string => s.replace(/\n/gu, "");

/** Decode a resource blob to text. */
export function decodeResource(blob: Uint8Array, glyph: Glyph, opts: DecodeOptions = {}): string {
  const opLen = opts.opLen ?? schemaLen;
  const out: string[] = [];
  let pos = 0;
  while (pos < blob.length) {
    const b = blob[pos];
    if (b === 0xff && pos + 1 < blob.length) {
      const op = blob[pos + 1];
      const ln = opLen(op);
      const args = blob.subarray(pos + 2, pos + 2 + ln);
      out.push("{" + mnemonic(op) + renderOperands(op, args) + "}");
      pos += 2 + ln;
      continue;
    }
    const [idx, nb] = glyph.decodeGlyphAt(blob, pos);
    const raw = blob.subarray(pos, pos + nb);
    pos += nb;
    if (toHex(glyph.encodeGlyph(idx)) !== toHex(raw)) {
      out.push(`〔=${toHex(raw)}〕`); // non-canonical storage (round-trips byte-exact)
      continue;
    }
    const ch = glyph.charFor(idx);
    if (glyph.indexFor(ch) !== idx) {
      // idx isn't a clean glyphmap entry (charFor returned a 〔hex〕 fallback) — genuinely unencodable
      if (opts.strict) throw new Error(`unencodable glyph 0x${idx.toString(16)} at offset ${pos - nb} (not in font)`);
      out.push(`〔${idx.toString(16)}〕`);
    } else if (!ch.startsWith("〔") && /[{}〔〕]/u.test(ch)) {
      out.push(`〔${idx.toString(16)}〕`); // literal {, }, 〔 or 〕 glyph — escape so it isn't re-parsed as syntax
    } else {
      out.push(ch); // a bare char, or a glyphmap alt-token like 〔b^〕
    }
  }
  return out.join("");
}

/** Encode text back to a resource blob (byte-exact inverse of {@link decodeResource}). */
export function encodeResource(text: string, glyph: Glyph, fallback?: Glyph): Uint8Array {
  const out: number[] = [];
  for (const m of text.matchAll(TOK)) {
    const [, mnem, args, inner] = m;
    if (mnem !== undefined) {
      const op = opcodeFor(mnem);
      out.push(0xff, op);
      encodeOperands(op, args, out);
    } else if (inner !== undefined) {
      const token = `〔${inner}〕`;
      const tokIdx = glyph.indexFor(token) ?? fallback?.indexFor(token); // alt-glyph token, e.g. 〔b^〕
      if (tokIdx !== undefined) {
        for (const x of glyph.encodeGlyph(tokIdx)) out.push(x);
      } else if (inner.startsWith("=")) {
        const h = inner.slice(1); // 〔=hex〕 raw stored bytes
        for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
      } else if (/^[0-9a-fA-F]+$/u.test(inner)) {
        for (const x of glyph.encodeGlyph(parseInt(inner, 16))) out.push(x); // 〔hex〕 raw glyph index
      } else {
        throw new Error(`unknown glyph token 〔${inner}〕`);
      }
    } else {
      const ch = m[0];
      const idx = glyph.indexFor(ch) ?? fallback?.indexFor(ch);
      if (idx === undefined) throw new Error(`char ${JSON.stringify(ch)} not in font`);
      for (const x of glyph.encodeGlyph(idx)) out.push(x);
    }
  }
  return Uint8Array.from(out);
}
