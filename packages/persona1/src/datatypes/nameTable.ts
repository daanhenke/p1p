// "name-table" datatype: fixed-stride record arrays in a host file (the boot exe / an overlay) where
// one fixed-width field holds the displayed name (1 byte per glyph = the glyph index directly,
// FF-terminated, zero-padded). Ports src/persona1/tables.py + web/src/core/tables.ts. The per-game
// sub-table specs (base/stride/count/name field) are supplied by the profile, never hardcoded here.

import type { BuildCtx, Datatype, Issue, RecordKey } from "@p1p/core";
import { toHex } from "@p1p/core";
import { Glyph } from "../text/glyph.js";
import { buildXml, parseXml } from "@p1p/core";

export interface NameTableField { off: number; name: string; width: number }

export interface NameSubTable {
  /** logical name, e.g. "demon" (becomes the record-key prefix). */
  table: string;
  /** host file: "exe" (resolved to the profile's bootExe) or an ISO path like "/BTLP.BIN". */
  file: string;
  stride: number;
  nameOff: number;
  nameLen: number;
  /** 2-byte glyph scheme for the name field (party names); default 1 byte/glyph. */
  wide?: boolean;
  base: number;
  count: number;
  fields?: NameTableField[];
  /** If set, this sub-table's entries bundle into one source file (e.g. "demons.xml"). */
  bundle?: string;
}

export interface NameRecord {
  table: string;
  index: number;
  name: string;
  /** decoded stat fields (read-only reference). */
  stats: Record<string, number>;
  /** full record hex (read-only reference). */
  raw: string;
}

export type NameOverride = { name: string };

const GLY = /〔([0-9a-fA-F]+)〕|[\s\S]/gu;

export function decodeName(glyph: Glyph, buf: Uint8Array, off: number, length: number, wide: boolean): string {
  const out: string[] = [];
  let pos = 0;
  while (pos < length) {
    const b = buf[off + pos];
    if (b === 0xff || b === 0x00) break;
    let idx: number;
    let n: number;
    if (wide) [idx, n] = glyph.decodeGlyphAt(buf.subarray(off), pos);
    else { idx = b; n = 1; }
    out.push(glyph.charFor(idx));
    pos += n;
  }
  return out.join("");
}

/** Encoded byte length of `name` in the given field width (no terminator) — to test if it fits. */
export function encodedNameLength(glyph: Glyph, name: string, wide: boolean): number {
  let n = 0;
  for (const m of name.matchAll(GLY)) {
    const idx = m[1] !== undefined ? parseInt(m[1], 16) : glyph.indexFor(m[0]);
    if (idx === undefined) throw new Error(`char ${JSON.stringify(m[0])} not in font`);
    n += wide ? glyph.encodeGlyph(idx).length : 1;
  }
  return n;
}

export function encodeName(glyph: Glyph, name: string, length: number, wide: boolean): Uint8Array {
  const body: number[] = [];
  for (const m of name.matchAll(GLY)) {
    const idx = m[1] !== undefined ? parseInt(m[1], 16) : glyph.indexFor(m[0]);
    if (idx === undefined) throw new Error(`char ${JSON.stringify(m[0])} not in font`);
    if (wide) for (const x of glyph.encodeGlyph(idx)) body.push(x);
    else {
      if (idx > 0xff) throw new Error(`glyph ${idx} needs the wide (2-byte) field`);
      body.push(idx);
    }
  }
  if (body.length > length) {
    throw new Error(`name ${JSON.stringify(name)} = ${body.length}B > ${length}B field`);
  }
  const out = new Uint8Array(length);
  out.set(body);
  // A name shorter than the field gets an FF terminator (rest stays 0x00); a name that exactly fills
  // the fixed-stride field needs none — the stride delimits it (matches how decodeName reads it).
  if (body.length < length) out[body.length] = 0xff;
  return out;
}

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="name-entry">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="name" type="xs:string"/>
      </xs:sequence>
      <xs:attribute name="table" type="xs:string" use="required"/>
      <xs:attribute name="index" type="xs:nonNegativeInteger" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

export class NameTableDatatype implements Datatype<NameRecord, NameOverride> {
  readonly id = "name-table";
  readonly group = "names";
  readonly xsd = XSD;

  constructor(private readonly subtables: NameSubTable[], private readonly glyph: Glyph) {}

  sourcePath(key: RecordKey): string { return `${key}.xml`; } // "demon/024" -> "demon/024.xml"
  keyFromPath(relPath: string): RecordKey { return relPath.replace(/\\/g, "/").replace(/\.xml$/i, ""); }

  private spec(table: string): NameSubTable {
    const s = this.subtables.find((t) => t.table === table);
    if (!s) throw new Error(`unknown name sub-table: ${table}`);
    return s;
  }

  private hostPath(spec: NameSubTable, ctx: BuildCtx): string {
    return spec.file === "exe" ? (ctx.profile.data.bootExe as string) : spec.file;
  }

  private parseKey(key: RecordKey): { table: string; index: number } {
    const [table, idx] = key.split("/");
    return { table, index: Number(idx) };
  }

  static keyOf(table: string, index: number): RecordKey {
    return `${table}/${index.toString().padStart(3, "0")}`;
  }

  private decode(spec: NameSubTable, data: Uint8Array, index: number): NameRecord {
    const rec = spec.base + index * spec.stride;
    const name = decodeName(this.glyph, data, rec + spec.nameOff, spec.nameLen, spec.wide ?? false);
    const stats: Record<string, number> = {};
    for (const f of spec.fields ?? []) {
      let v = 0;
      for (let i = 0; i < f.width; i++) v |= data[rec + f.off + i] << (8 * i);
      stats[f.name] = v >>> 0;
    }
    return { table: spec.table, index, name, stats, raw: toHex(data.subarray(rec, rec + spec.stride)) };
  }

  read(key: RecordKey, ctx: BuildCtx): NameRecord | undefined {
    const { table, index } = this.parseKey(key);
    const spec = this.spec(table);
    if (index < 0 || index >= spec.count) return undefined;
    const data = ctx.source.read(this.hostPath(spec, ctx));
    return this.decode(spec, data, index);
  }

  readAll(ctx: BuildCtx): Map<RecordKey, NameRecord> {
    const out = new Map<RecordKey, NameRecord>();
    for (const spec of this.subtables) {
      const data = ctx.source.read(this.hostPath(spec, ctx));
      for (let i = 0; i < spec.count; i++) {
        if (spec.base + (i + 1) * spec.stride > data.length) break;
        out.set(NameTableDatatype.keyOf(spec.table, i), this.decode(spec, data, i));
      }
    }
    return out;
  }

  apply(merged: Map<RecordKey, NameRecord>, ctx: BuildCtx): Map<string, Uint8Array> {
    const byHost = new Map<string, Uint8Array>();
    for (const [key, model] of merged) {
      const spec = this.spec(this.parseKey(key).table);
      const path = this.hostPath(spec, ctx);
      let bytes = byHost.get(path);
      if (!bytes) {
        bytes = Uint8Array.from(ctx.source.read(path));
        byHost.set(path, bytes);
      }
      const field = encodeName(this.glyph, model.name, spec.nameLen, spec.wide ?? false);
      bytes.set(field, spec.base + model.index * spec.stride + spec.nameOff);
    }
    return byHost;
  }

  merge(base: NameRecord, ov: NameOverride): NameRecord {
    return { ...base, name: ov.name };
  }

  validate(key: RecordKey, model: NameRecord, _ctx: BuildCtx): Issue[] {
    const spec = this.spec(this.parseKey(key).table);
    try {
      encodeName(this.glyph, model.name, spec.nameLen, spec.wide ?? false);
      return [];
    } catch (e) {
      return [{ level: "error", datatype: this.id, key, message: (e as Error).message }];
    }
  }

  toXml(key: RecordKey, model: NameRecord): string {
    const { table, index } = this.parseKey(key);
    return buildXml({ "name-entry": { "@table": table, "@index": index, name: model.name } });
  }

  fromXml(xml: string): { key: RecordKey; value: NameOverride } {
    const tree = parseXml(xml) as { "name-entry": { "@table": string; "@index": string; name: string } };
    const e = tree["name-entry"];
    return { key: NameTableDatatype.keyOf(e["@table"], Number(e["@index"])), value: { name: String(e.name) } };
  }

  // ---- single-file bundling: each sub-table → one file (spec.bundle), one <entry> per record ----
  layout(keys: RecordKey[]): Map<string, RecordKey[]> {
    const out = new Map<string, RecordKey[]>();
    for (const k of keys) {
      const spec = this.spec(this.parseKey(k).table);
      const file = spec.bundle ?? this.sourcePath(k);
      const list = out.get(file) ?? [];
      list.push(k);
      out.set(file, list);
    }
    return out;
  }

  serializeFile(_relPath: string, records: Map<RecordKey, NameRecord>): string {
    const recs = [...records.values()];
    const entry = recs.map((r) => ({
      "@index": r.index,
      ...Object.fromEntries(Object.entries(r.stats).map(([k, v]) => [`@${k}`, v])), // stats = read-only reference
      "#text": r.name,
    }));
    return buildXml({ names: { "@table": recs[0]?.table ?? "", entry } });
  }

  parseFile(_relPath: string, xml: string): Map<RecordKey, NameOverride> {
    const root = (parseXml(xml) as { names: { "@table": string; entry?: EntryXml | EntryXml[] } }).names;
    const raw = root.entry === undefined ? [] : Array.isArray(root.entry) ? root.entry : [root.entry];
    return new Map(raw.map((e) => [NameTableDatatype.keyOf(root["@table"], Number(e["@index"])), { name: String(e["#text"] ?? "") }]));
  }
}

interface EntryXml { "@index": string; "#text"?: string }
