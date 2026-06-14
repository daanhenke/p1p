// "string-table" datatype: a u32 pointer array (in a host file) where each slot points to an
// FF-terminated string in the 2-byte dialogue encoding. Used for SLUS skill/item descriptions +
// item names, the btlp skill names, and the s2d location names. Each grown translation relocates
// into host slack (boot exe) or appends to EOF (overlay files the build resizes) and the pointer is
// rewritten; strings that still fit are rewritten in place. Ports src/persona1/strtab.py / strtab.ts.
// One datatype instance per table spec, so each "thing" (item-names, skill-names, …) is its own group.

import type { BuildCtx, Datatype, RecordKey } from "@p1p/core";
import { buildXml, parseXml, u32le } from "@p1p/core";
import type { Glyph } from "../text/glyph.js";
import { decodeResource, encodeResource } from "../text/resource.js";
import { schemaLen } from "../script/opcodes.js";

export interface StringTableMirror {
  file: string;
  ram: number;
  ptrBase: number;
  count: number;
  term?: number;
  grow?: "slack" | "append";
  /** Only mirror edits with index >= this (e.g. btlp item-name copy starts at 328). */
  fromIndex: number;
}

export interface StringTableSpec {
  /** Datatype id (unique), e.g. "item-names". */
  id: string;
  /** Source folder/group. */
  group: string;
  /** Host file: "exe" (→ profile bootExe) or an ISO path. */
  file: string;
  /** PSX RAM base so pointer → file offset = ptr − ram. */
  ram: number;
  ptrBase: number;
  count: number;
  /** Terminator op after the FF (0x01 = {ret} for SLUS, 0xf5 = {op_f5} for the btlp copy). */
  term?: number;
  /** How a grown string is placed: into host slack runs, or appended to EOF. */
  grow?: "slack" | "append";
  slack?: [number, number][];
  /** A true-dupe copy patched in lock-step (the btlp item-name mirror). */
  mirror?: StringTableMirror;
  /** If set, all records bundle into this one source file (e.g. "locations.xml") instead of one each. */
  bundle?: string;
  /** If set, only these indices are this datatype's records (e.g. the description slots of a shared
   *  pointer table whose other slots belong to other entities). Defaults to 0..count-1. */
  indices?: number[];
}

export interface StringRecord { index: number; text: string }
export type StringOverride = { text: string };

/** Length of the FF<term>-terminated string at `off`, or -1 if it doesn't terminate within `limit`. */
function stringBytes(glyph: Glyph, data: Uint8Array, off: number, term: number, limit = 0x400): number {
  let p = off;
  while (p < data.length && p - off < limit) {
    const b = data[p];
    if (b === 0xff) {
      if (p + 1 >= data.length) return -1;
      const op = data[p + 1];
      if (op === term) return p + 2 - off;
      p += 2 + schemaLen(op);
      continue;
    }
    const [, n] = glyph.decodeGlyphAt(data, p);
    p += n;
  }
  return -1;
}

/** Bump allocator over a host file's free runs (for relocated strings). */
class Slack {
  private runs: [number, number][];
  private i = 0;
  constructor(runs: [number, number][]) { this.runs = runs.map(([o, n]) => [o, o + n]); }
  take(n: number): number {
    while (this.i < this.runs.length) {
      const [o, end] = this.runs[this.i];
      if (o + n <= end) {
        this.runs[this.i][0] = o + n;
        return o;
      }
      this.i++;
    }
    throw new Error(`out of slack for a ${n}-byte string`);
  }
}

interface PtrTable {
  ptrBase: number; count: number; ram: number;
  term?: number; grow?: string; slack?: [number, number][];
}

/** Read the string at table index `index` (decoded), or undefined if its pointer is out of range. */
export function readString(
  glyph: Glyph, data: Uint8Array, t: { ptrBase: number; ram: number; term?: number }, index: number,
): string | undefined {
  const off = u32le(data, t.ptrBase + index * 4) - t.ram;
  if (off < 0 || off >= data.length) return undefined;
  const ln = stringBytes(glyph, data, off, t.term ?? 0x01);
  if (ln < 0) return undefined;
  return decodeResource(data.subarray(off, off + ln - 2), glyph);
}

/** Rewrite edited strings into a host file (in place if they fit, else relocate + repoint). */
export function repackStringTable(glyph: Glyph, data: Uint8Array, edits: Map<number, string>, t: PtrTable): Uint8Array {
  const term = t.term ?? 0x01;
  const termBytes = [0xff, term];
  const out: number[] = Array.from(data);
  const slack = new Slack(t.slack ?? []);
  for (const [k, text] of edits) {
    if (k < 0 || k >= t.count) throw new Error(`string-table index ${k} out of range`);
    const off = u32le(data, t.ptrBase + k * 4) - t.ram;
    const origLen = stringBytes(glyph, data, off, term);
    if (origLen < 0) continue;
    const body = encodeResource(text, glyph);
    const neu = [...body, ...termBytes];
    if (neu.length <= origLen) {
      for (let i = 0; i < neu.length; i++) out[off + i] = neu[i];
      for (let p = off + neu.length; p < off + origLen; p++) out[p] = 0;
    } else {
      let at: number;
      if (t.grow === "append") {
        at = out.length;
        for (const b of neu) out.push(b);
      } else {
        at = slack.take(neu.length);
        for (let i = 0; i < neu.length; i++) out[at + i] = neu[i];
      }
      const pb = t.ptrBase + k * 4;
      const v = at + t.ram;
      for (let i = 0; i < 4; i++) out[pb + i] = (v >>> (i * 8)) & 0xff;
    }
  }
  return Uint8Array.from(out);
}

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="string">
    <xs:complexType>
      <xs:simpleContent>
        <xs:extension base="xs:string">
          <xs:attribute name="index" type="xs:nonNegativeInteger" use="required"/>
        </xs:extension>
      </xs:simpleContent>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

export class StringTableDatatype implements Datatype<StringRecord, StringOverride> {
  readonly id: string;
  readonly group: string;
  readonly xsd = XSD;

  constructor(private readonly spec: StringTableSpec, private readonly glyph: Glyph) {
    this.id = spec.id;
    this.group = spec.group;
  }

  sourcePath(key: RecordKey): string { return `${key}.xml`; }
  keyFromPath(relPath: string): RecordKey { return relPath.replace(/.*\//, "").replace(/\.xml$/i, ""); }

  private hostPath(ctx: BuildCtx): string {
    return this.spec.file === "exe" ? (ctx.profile.data.bootExe as string) : this.spec.file;
  }

  read(key: RecordKey, ctx: BuildCtx): StringRecord | undefined {
    const index = Number(key);
    if (index < 0 || index >= this.spec.count) return undefined;
    const data = ctx.source.read(this.hostPath(ctx));
    const off = u32le(data, this.spec.ptrBase + index * 4) - this.spec.ram;
    if (off < 0 || off >= data.length) return undefined;
    const ln = stringBytes(this.glyph, data, off, this.spec.term ?? 0x01);
    if (ln < 0) return undefined;
    return { index, text: decodeResource(data.subarray(off, off + ln - 2), this.glyph) };
  }

  readAll(ctx: BuildCtx): Map<RecordKey, StringRecord> {
    const out = new Map<RecordKey, StringRecord>();
    const idxs = this.spec.indices ?? Array.from({ length: this.spec.count }, (_, i) => i);
    for (const i of idxs) {
      const r = this.read(String(i), ctx);
      if (r) out.set(String(i), r);
    }
    return out;
  }

  apply(merged: Map<RecordKey, StringRecord>, ctx: BuildCtx): Map<string, Uint8Array> {
    const edits = new Map<number, string>();
    for (const r of merged.values()) edits.set(r.index, r.text);
    const changes = new Map<string, Uint8Array>();
    const host = this.hostPath(ctx);
    changes.set(host, repackStringTable(this.glyph, ctx.source.read(host), edits, this.spec));

    const mir = this.spec.mirror;
    if (mir) {
      const sub = new Map([...edits].filter(([k]) => k >= mir.fromIndex && k < mir.count));
      if (sub.size) changes.set(mir.file, repackStringTable(this.glyph, ctx.source.read(mir.file), sub, mir));
    }
    return changes;
  }

  merge(base: StringRecord, ov: StringOverride): StringRecord { return { ...base, text: ov.text }; }

  toXml(_key: RecordKey, model: StringRecord): string {
    return buildXml({ string: { "@index": model.index, "#text": model.text } });
  }

  fromXml(xml: string): { key: RecordKey; value: StringOverride } {
    const e = (parseXml(xml) as { string: { "@index": string; "#text"?: string } }).string;
    return { key: String(Number(e["@index"])), value: { text: String(e["#text"] ?? "") } };
  }

  // ---- optional single-file bundling (spec.bundle = the one filename to hold every string) ----
  layout(keys: RecordKey[]): Map<string, RecordKey[]> {
    if (this.spec.bundle) return new Map([[this.spec.bundle, keys]]);
    return new Map(keys.map((k) => [this.sourcePath(k), [k]]));
  }

  serializeFile(_relPath: string, records: Map<RecordKey, StringRecord>): string {
    const string = [...records.values()].map((m) => ({ "@index": m.index, "#text": m.text }));
    return buildXml({ strings: { string } });
  }

  parseFile(_relPath: string, xml: string): Map<RecordKey, StringOverride> {
    const root = (parseXml(xml) as { strings?: { string?: StringXml | StringXml[] } }).strings;
    const raw = root?.string === undefined ? [] : Array.isArray(root.string) ? root.string : [root.string];
    return new Map(raw.map((e) => [String(Number(e["@index"])), { text: String(e["#text"] ?? "") }]));
  }
}

interface StringXml { "@index": string; "#text"?: string }
