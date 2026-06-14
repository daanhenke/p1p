// "dungeon-text" datatype: the D##.BIN dungeon dialogue container (Snow Queen quest). The file is a
// u32 pointer table (sector 0 sizes itself) followed by FF-op resource records; each translatable
// message is framed ({say|msgbox_open}…{end}) and language-detected. Editing replaces a message's
// middle body in place (prefix/suffix kept) and rebuilds the file end-to-end. Ports src/persona1/
// dungeon.py / web/src/core/dungeon.ts; reuses the atlus resource codec + textbox validator.
//
// A record key is "<floor>/<slot>" (e.g. "d18/12") where slot is the pointer-table index; one XML per
// message. apply() groups edits by floor and repacks each floor's host file.

import type { BuildCtx, Datatype, Issue, RecordKey } from "@p1p/core";
import { u32le, packU32le, concat, buildXml, parseXml } from "@p1p/core";
import type { Glyph } from "../text/glyph.js";
import { decodeResource, encodeResource, fromMultiline, toMultiline, TOK } from "../text/resource.js";
import { overflows, TEXTBOX_WIDTHS } from "../text/textbox.js";

interface Table { table: number[]; bounds: number[] }

function parseTable(data: Uint8Array): Table {
  const n = Math.floor(u32le(data, 0) / 4);
  const table: number[] = [];
  for (let i = 0; i < n; i++) table.push(u32le(data, i * 4));
  const set = new Set<number>();
  for (const v of table) if (v > 0 && v <= data.length) set.add(v);
  const bounds = [...set].sort((a, b) => a - b);
  bounds.push(data.length);
  return { table, bounds };
}

const extentEnd = (bounds: number[], off: number, total: number): number => {
  let best = total;
  for (const b of bounds) if (b > off && b < best) best = b;
  return best;
};

const framed = (t: string): boolean => (t.includes("{say") || t.includes("{msgbox_open")) && t.includes("{end");

function isEnglish(text: string): boolean {
  const plain = text.replace(/\{[^}]*\}|〔[^〕]*〕/gu, "");
  const letters = [...plain].filter((c) => /[a-zA-Z]/.test(c)).map((c) => c.toLowerCase());
  if (letters.length < 10) return false;
  const vowels = letters.filter((c) => "aeiou".includes(c)).length / letters.length;
  return vowels >= 0.26 && vowels <= 0.6;
}

function isJapanese(text: string): boolean {
  const plain = text.replace(/\{[^}]*\}|〔[^〕]*〕/gu, "");
  const kanji = plain.match(/[㐀-鿿]/gu)?.length ?? 0;
  return kanji >= 3 && kanji <= 300;
}

/** Split a decoded message into [leading controls, body, trailing] around the first {ret}-ended run. */
export function splitMessage(text: string): [string, string, string] {
  const toks = [...text.matchAll(TOK)].map((m) => m[0]);
  let p = 0;
  while (p < toks.length && toks[p].startsWith("{")) p++;
  let end = toks.length;
  for (let j = p; j < toks.length; j++) if (toks[j].startsWith("{ret")) end = j + 1;
  return [toks.slice(0, p).join(""), toks.slice(p, end).join(""), toks.slice(end).join("")];
}

export interface DungeonRecord { floor: string; index: number; text: string }
export type DungeonOverride = { text: string };

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="message">
    <xs:complexType>
      <xs:simpleContent>
        <xs:extension base="xs:string">
          <xs:attribute name="floor" type="xs:string" use="required"/>
          <xs:attribute name="index" type="xs:nonNegativeInteger" use="required"/>
        </xs:extension>
      </xs:simpleContent>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

export class DungeonTextDatatype implements Datatype<DungeonRecord, DungeonOverride> {
  readonly id = "dungeon-text";
  readonly group = "dungeon";
  readonly xsd = XSD;

  /** us + jp glyphs (jp only for language detection of original records). */
  constructor(private readonly us: Glyph, private readonly jp: Glyph) {}

  sourcePath(key: RecordKey): string { return `${key}.xml`; }
  keyFromPath(relPath: string): RecordKey { return relPath.replace(/\.xml$/i, ""); }

  /** Resolve "d18" → the ISO path whose basename is D18.BIN, by scanning the source's file list. */
  private hostFor(floor: string, ctx: BuildCtx): string | undefined {
    const want = `/${floor.toUpperCase()}.BIN`;
    return ctx.source.list().find((p) => p.toUpperCase().endsWith(want));
  }

  /** Detect a record's language + decoded text, or null if it isn't a framed message. */
  private detect(blob: Uint8Array): { glyph: Glyph; text: string } | null {
    const us = decodeResource(blob, this.us);
    if (!framed(us)) return null;
    if (isEnglish(us)) return { glyph: this.us, text: us };
    const jp = decodeResource(blob, this.jp);
    return isJapanese(jp) ? { glyph: this.jp, text: jp } : null;
  }

  read(key: RecordKey, ctx: BuildCtx): DungeonRecord | undefined {
    const [floor, idxStr] = key.split("/");
    const index = Number(idxStr);
    const host = this.hostFor(floor, ctx);
    if (!host || !Number.isInteger(index)) return undefined;
    const data = ctx.source.read(host);
    const { table, bounds } = parseTable(data);
    const off = table[index];
    if (!off || off <= 0 || off > data.length) return undefined;
    const blob = data.subarray(off, extentEnd(bounds, off, data.length));
    const det = this.detect(blob);
    if (!det) return undefined;
    const [, body] = splitMessage(det.text);
    return { floor, index, text: body };
  }

  readAll(ctx: BuildCtx): Map<RecordKey, DungeonRecord> {
    const out = new Map<RecordKey, DungeonRecord>();
    const floors = new Set<string>();
    for (const p of ctx.source.list()) {
      const m = /\/(D[0-9A-F]{2})\.BIN$/i.exec(p);
      if (m && /\/D0\d\//i.test(p)) floors.add(m[1].toLowerCase());
    }
    for (const floor of floors) {
      const host = this.hostFor(floor, ctx)!;
      const data = ctx.source.read(host);
      const { table, bounds } = parseTable(data);
      const seen = new Set<number>();
      table.forEach((off, index) => {
        if (!off || off <= 0 || off > data.length || seen.has(off)) return;
        seen.add(off);
        const blob = data.subarray(off, extentEnd(bounds, off, data.length));
        const det = this.detect(blob);
        if (det) out.set(`${floor}/${index}`, { floor, index, text: splitMessage(det.text)[1] });
      });
    }
    return out;
  }

  apply(merged: Map<RecordKey, DungeonRecord>, ctx: BuildCtx): Map<string, Uint8Array> {
    const byFloor = new Map<string, Map<number, string>>();
    for (const r of merged.values()) {
      let edits = byFloor.get(r.floor);
      if (!edits) {
        edits = new Map();
        byFloor.set(r.floor, edits);
      }
      edits.set(r.index, r.text);
    }
    const changes = new Map<string, Uint8Array>();
    for (const [floor, edits] of byFloor) {
      const host = this.hostFor(floor, ctx);
      if (!host) continue;
      changes.set(host, this.repack(ctx.source.read(host), edits));
    }
    return changes;
  }

  /** Rebuild a dungeon file with each edited slot's body replaced (prefix/suffix preserved). */
  private repack(data: Uint8Array, edits: Map<number, string>): Uint8Array {
    const { table, bounds } = parseTable(data);
    const tblSize = table[0];
    const newOff = new Map<number, number>();
    const blobFor = new Map<number, Uint8Array>();
    let cursor = tblSize;
    for (const off of bounds.slice(0, -1)) {
      const idxs: number[] = [];
      table.forEach((v, i) => { if (v === off) idxs.push(i); });
      let blob: Uint8Array = data.subarray(off, extentEnd(bounds, off, data.length));
      const editIdx = idxs.find((i) => edits.has(i));
      if (editIdx !== undefined) {
        const det = this.detect(blob);
        const glyph = det ? det.glyph : this.us;
        const decoded = det ? det.text : decodeResource(blob, glyph);
        const [prefix, , suffix] = splitMessage(decoded);
        try {
          const a = encodeResource(prefix, glyph).length; // bytes of prefix (controls before the body)
          const b = blob.length - encodeResource(suffix, glyph).length; // body ends where suffix begins
          blob = concat([blob.subarray(0, a), encodeResource(edits.get(editIdx)!, this.us), blob.subarray(b)]);
        } catch (e) {
          const hex = Array.from(blob.subarray(0, 16), (x) => x.toString(16).padStart(2, "0")).join(" ");
          throw new Error(
            `dungeon repack: slot ${editIdx} @0x${off.toString(16)} — ${(e as Error).message}\n`
            + `  blob[0..16]: ${hex}\n  decoded: ${JSON.stringify(decoded)}\n`
            + `  prefix: ${JSON.stringify(prefix)}  suffix: ${JSON.stringify(suffix)}`,
          );
        }
      }
      newOff.set(off, cursor);
      blobFor.set(off, blob);
      cursor += blob.length;
    }
    const out = new Uint8Array(cursor);
    for (const [off, blob] of blobFor) out.set(blob, newOff.get(off)!);
    table.forEach((v, i) => out.set(packU32le(v ? newOff.get(v) ?? v : 0), i * 4));
    return out;
  }

  merge(base: DungeonRecord, ov: DungeonOverride): DungeonRecord { return { ...base, text: ov.text }; }

  validate(key: RecordKey, model: DungeonRecord): Issue[] {
    const ov = overflows(model.text, TEXTBOX_WIDTHS.us);
    return ov.length
      ? [{ level: "warn", datatype: this.id, key, message: `textbox overflow: ${JSON.stringify(ov)}` }]
      : [];
  }

  toXml(_key: RecordKey, model: DungeonRecord): string {
    return buildXml({ message: { "@floor": model.floor, "@index": model.index, "#text": model.text } });
  }

  fromXml(xml: string): { key: RecordKey; value: DungeonOverride } {
    const e = (parseXml(xml) as { message: { "@floor": string; "@index": string; "#text"?: string } }).message;
    return { key: `${e["@floor"]}/${Number(e["@index"])}`, value: { text: String(e["#text"] ?? "") } };
  }

  // one file per floor: dungeon/<floor>.xml, multiline messages
  layout(keys: RecordKey[]): Map<string, RecordKey[]> {
    const out = new Map<string, RecordKey[]>();
    for (const k of keys) {
      const file = `${k.split("/")[0]}.xml`;
      const list = out.get(file) ?? [];
      list.push(k);
      out.set(file, list);
    }
    return out;
  }

  serializeFile(_relPath: string, records: Map<RecordKey, DungeonRecord>): string {
    const recs = [...records.values()];
    const message = recs.map((m) => ({ "@index": m.index, "#text": toMultiline(m.text) }));
    return buildXml({ messages: { "@floor": recs[0]?.floor ?? "", message } });
  }

  parseFile(_relPath: string, xml: string): Map<RecordKey, DungeonOverride> {
    const root = (parseXml(xml) as { messages: { "@floor": string; message?: DngMsgXml | DngMsgXml[] } }).messages;
    const raw = root.message === undefined ? [] : Array.isArray(root.message) ? root.message : [root.message];
    return new Map(raw.map((e) => [`${root["@floor"]}/${Number(e["@index"])}`, { text: fromMultiline(String(e["#text"] ?? "")) }]));
  }
}

interface DngMsgXml { "@index": string; "#text"?: string }
