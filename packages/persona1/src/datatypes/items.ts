// "items" semantic entity: one item = its name (descriptions are effect-shared, so they live in their
// own group, not here). The PRIMARY item-name store is the SLUS inline item table (0x350e0, stride 0x20,
// name @+0xc, ID order — Herb, Ripobitan, …, gems, quest items). A small subset (the 13 gems) ALSO have
// a copy in the SLUS menu-strings pointer table (with a leading icon glyph) which mirrors to BTLP. A
// rename writes every copy: the inline table, and — for an item whose name matches a menu-strings entry
// — the menu-strings string (icon prefix preserved) + the btlp mirror.

import type { BuildCtx, Datatype, RecordKey } from "@p1p/core";
import { buildXml, parseXml } from "@p1p/core";
import type { Glyph } from "../text/glyph.js";
import { readString, repackStringTable, type StringTableSpec } from "./stringTable.js";
import { type NameSubTable } from "./nameTable.js";

const GLY = /〔([^〕]+)〕|[\s\S]/gu; // 〔alt-token / hex〕 glyph, or any char

export interface ItemsSpec {
  /** inline item table (slus 0x350e0): the primary name store, ID order. */
  table: NameSubTable;
  /** menu-strings pointer table (slus): holds a few item names (gems) + mirrors to btlp. */
  menuNames: StringTableSpec;
  /** menu-strings index range to scan for item-name copies (the gem block), [from, to). */
  menuRange: [number, number];
}

export interface ItemRecord { id: number; name: string }
export type ItemOverride = { name: string };

const stripIcon = (s: string): string => s.replace(/^(?:〔[^〕]*〕)+/u, ""); // drop leading icon glyph token(s)
const iconOf = (s: string): string => s.slice(0, s.length - stripIcon(s).length);

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="item">
    <xs:complexType>
      <xs:simpleContent>
        <xs:extension base="xs:string">
          <xs:attribute name="id" type="xs:nonNegativeInteger" use="required"/>
        </xs:extension>
      </xs:simpleContent>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

interface ItemXml { "@id": string; "#text"?: string }

export class ItemsDatatype implements Datatype<ItemRecord, ItemOverride> {
  readonly id = "items";
  readonly group = ""; // root → items.xml
  readonly xsd = XSD;

  constructor(private readonly glyph: Glyph, private readonly spec: ItemsSpec) {}

  private host(file: string, ctx: BuildCtx): string {
    return file === "exe" ? (ctx.profile.data.bootExe as string) : file;
  }

  sourcePath(key: RecordKey): string { return `${key}.xml`; }
  keyFromPath(relPath: string): RecordKey { return relPath.replace(/.*\//, "").replace(/\.xml$/i, ""); }

  // Item names embed spaces (0x00) — e.g. "9mm gun" — so the field is read until 0xFF only (not 0x00),
  // up to nameLen, with 0x00 → space. (decodeName breaks on 0x00, which would truncate spaced names.)
  private nameAt(slus: Uint8Array, id: number): string {
    const t = this.spec.table;
    const off = t.base + id * t.stride + t.nameOff;
    let s = "";
    for (let p = 0; p < t.nameLen; p++) {
      const b = slus[off + p];
      if (b === 0xff) break;
      s += this.glyph.charFor(b);
    }
    return s;
  }

  /** Encode a name into the inline `len`-byte field — FF-terminated + zero-padded, but a name that
   *  exactly FILLS the field has no terminator (the item table allows full-width names). */
  private encodeFieldName(name: string, len: number): Uint8Array {
    const body: number[] = [];
    for (const m of name.matchAll(GLY)) {
      let idx: number | undefined;
      if (m[1] !== undefined) {
        idx = this.glyph.indexFor(`〔${m[1]}〕`); // alt-glyph token (e.g. 〔b^〕)
        if (idx === undefined && /^[0-9a-fA-F]+$/u.test(m[1])) idx = parseInt(m[1], 16); // raw 〔hex〕
      } else {
        idx = this.glyph.indexFor(m[0]);
      }
      if (idx === undefined) throw new Error(`char ${JSON.stringify(m[1] ?? m[0])} not in font`);
      if (idx > 0xff) throw new Error(`glyph ${idx} for ${JSON.stringify(m[0])} needs a wide field`);
      body.push(idx);
    }
    if (body.length > len) throw new Error(`item name ${JSON.stringify(name)} = ${body.length}B > ${len}B field`);
    const out = new Uint8Array(len); // zero-filled
    out.set(body, 0);
    if (body.length < len) out[body.length] = 0xff; // terminator only when it fits
    return out;
  }

  read(key: RecordKey, ctx: BuildCtx): ItemRecord | undefined {
    const id = Number(key);
    const slus = ctx.source.tryRead(this.host(this.spec.table.file, ctx));
    if (!slus || id < 0 || id >= this.spec.table.count) return undefined;
    return { id, name: this.nameAt(slus, id) };
  }

  readAll(ctx: BuildCtx): Map<RecordKey, ItemRecord> {
    const out = new Map<RecordKey, ItemRecord>();
    const slus = ctx.source.tryRead(this.host(this.spec.table.file, ctx));
    if (!slus) return out;
    for (let i = 0; i < this.spec.table.count; i++) out.set(String(i), { id: i, name: this.nameAt(slus, i) });
    return out;
  }

  /** Map an item NAME (no icon) → its menu-strings index + original icon prefix (the gem cross-map). */
  private crossMap(slus: Uint8Array): Map<string, { idx: number; icon: string }> {
    const map = new Map<string, { idx: number; icon: string }>();
    for (let i = this.spec.menuRange[0]; i < this.spec.menuRange[1]; i++) {
      const s = readString(this.glyph, slus, this.spec.menuNames, i);
      if (s) map.set(stripIcon(s), { idx: i, icon: iconOf(s) });
    }
    return map;
  }

  apply(merged: Map<RecordKey, ItemRecord>, ctx: BuildCtx): Map<string, Uint8Array> {
    const t = this.spec.table;
    const slusHost = this.host(t.file, ctx);
    const original = ctx.source.read(slusHost);
    const cross = this.crossMap(original);

    const menuEdits = new Map<number, string>(); // menu-strings idx → icon+newName (for matched gems)
    const tableEdits: Array<[number, string]> = [];
    for (const r of merged.values()) {
      tableEdits.push([r.id, r.name]);
      const hit = cross.get(this.nameAt(original, r.id)); // match on the ORIGINAL name
      if (hit) menuEdits.set(hit.idx, hit.icon + r.name);
    }

    // menu-strings repack + inline item-table writes share the SLUS buffer
    const slus = repackStringTable(this.glyph, original, menuEdits, this.spec.menuNames);
    for (const [id, name] of tableEdits) {
      slus.set(this.encodeFieldName(name, t.nameLen), t.base + id * t.stride + t.nameOff);
    }
    const changes = new Map<string, Uint8Array>([[slusHost, slus]]);

    // btlp mirror of the menu-strings item names
    const mir = this.spec.menuNames.mirror;
    if (mir) {
      const sub = new Map([...menuEdits].filter(([k]) => k >= mir.fromIndex && k < mir.count));
      if (sub.size) changes.set(mir.file, repackStringTable(this.glyph, ctx.source.read(mir.file), sub, mir));
    }
    return changes;
  }

  merge(base: ItemRecord, ov: ItemOverride): ItemRecord { return { ...base, name: ov.name }; }

  layout(keys: RecordKey[]): Map<string, RecordKey[]> { return new Map([["items.xml", keys]]); }

  serializeFile(_relPath: string, records: Map<RecordKey, ItemRecord>): string {
    const item = [...records.values()].map((m) => ({ "@id": m.id, "#text": m.name }));
    return buildXml({ items: { item } });
  }

  parseFile(_relPath: string, xml: string): Map<RecordKey, ItemOverride> {
    const root = (parseXml(xml) as { items?: { item?: ItemXml | ItemXml[] } }).items;
    const raw = root?.item === undefined ? [] : Array.isArray(root.item) ? root.item : [root.item];
    return new Map(raw.map((e) => [String(Number(e["@id"])), { name: String(e["#text"] ?? "") }]));
  }

  toXml(_key: RecordKey, model: ItemRecord): string {
    return buildXml({ item: { "@id": model.id, "#text": model.name } });
  }

  fromXml(xml: string): { key: RecordKey; value: ItemOverride } {
    const e = (parseXml(xml) as { item: ItemXml }).item;
    return { key: String(Number(e["@id"])), value: { name: String(e["#text"] ?? "") } };
  }
}
