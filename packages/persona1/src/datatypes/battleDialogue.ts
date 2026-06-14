// "battle-dialogue" datatype: scripted boss/intro lines in the PSX battle overlay (/BTLP.BIN). Ports
// src/persona1/btl.py. Messages are the shared 2-byte glyph stream terminated by FF F5 (FF F6 = newline,
// FF FC = page); Table A is 8-byte {u32 msgPtr, u32 portrait} records grouped per formation
// ({0,0}-terminated); Table B is a run of u32 pointers (formation → group). The tables have no header
// pointing at them, so they're located by a scored scan of the overlay — the sanctioned "nothing
// better inside an overlay" exception. Repack appends each edited message at EOF and repoints every
// Table-A entry that referenced it; unedited entries stay byte-exact.
//
// A record key is the message's file offset in hex ("1a2b"); apply() repacks /BTLP.BIN once.

import type { BuildCtx, Datatype, RecordKey } from "@p1p/core";
import { u32le, packU32le, concat, buildXml, parseXml } from "@p1p/core";
import type { Glyph } from "../text/glyph.js";
import { fromMultiline, toMultiline } from "../text/resource.js";

const PLO = 0x80000000;
const PHI = 0x80100000;
const CTRL_DEC: Record<number, string> = { 0xf6: "{nl}", 0xfc: "{wait}" };
const CTRL_ENC: Record<string, number[]> = { nl: [0xff, 0xf6], wait: [0xff, 0xfc] };
const TOKEN = /\{(nl|wait|ff([0-9a-fA-F]{2}))\}|〔([0-9a-fA-F]{1,3})〕|([\s\S])/gu;

export function decodeMessage(data: Uint8Array, off: number, glyph: Glyph): string {
  const out: string[] = [];
  let pos = off;
  while (pos >= 0 && pos < data.length) {
    const b = data[pos];
    if (b === 0xff) {
      const c = pos + 1 < data.length ? data[pos + 1] : 0xf5;
      pos += 2;
      if (c === 0xf5) break;
      out.push(CTRL_DEC[c] ?? `{ff${c.toString(16).padStart(2, "0")}}`);
      continue;
    }
    const [idx, n] = glyph.decodeGlyphAt(data, pos);
    out.push(glyph.charFor(idx));
    pos += n;
  }
  return out.join("");
}

export function encodeMessage(text: string, glyph: Glyph): Uint8Array {
  const out: number[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const [, ctrl, ffhex, rawIdx, ch] = m;
    if (ffhex !== undefined) {
      out.push(0xff, parseInt(ffhex, 16));
    } else if (ctrl) {
      out.push(...CTRL_ENC[ctrl]);
    } else if (rawIdx !== undefined) {
      out.push(...glyph.encodeGlyph(parseInt(rawIdx, 16)));
    } else {
      const idx = glyph.indexFor(ch);
      if (idx === undefined) throw new Error(`char ${JSON.stringify(ch)} not in font map`);
      out.push(...glyph.encodeGlyph(idx));
    }
  }
  out.push(0xff, 0xf5);
  return Uint8Array.from(out);
}

function records(d: Uint8Array, start: number): [Array<[number, number]>, number] {
  let o = start;
  const recs: Array<[number, number]> = [];
  while (o < d.length - 8) {
    const a = u32le(d, o);
    const b = u32le(d, o + 4);
    if ((a === 0 || (PLO <= a && a < PHI)) && b < 0x100) {
      recs.push([a, b]);
      o += 8;
    } else { break; }
  }
  return [recs, o];
}

function ptrRun(d: Uint8Array, start: number): [number, number[]] {
  let o = start;
  while (o < d.length - 4 && !(PLO <= u32le(d, o) && u32le(d, o) < PHI)) o += 4;
  const s = o;
  const vals: number[] = [];
  while (o < d.length - 4 && PLO <= u32le(d, o) && u32le(d, o) < PHI) {
    vals.push(u32le(d, o));
    o += 4;
  }
  return [s, vals];
}

export interface BtlTables { tableA: number; tableB: number; tb: number[]; base: number }

export function findTables(data: Uint8Array, glyph: Glyph): BtlTables {
  let best: { score: number; ta: number; tbo: number; tb: number[]; base: number } | null = null;
  let o = 0;
  while (o < data.length - 8) {
    const a = u32le(data, o);
    const b = u32le(data, o + 4);
    if (!((a === 0 || (PLO <= a && a < PHI)) && b < 0x100)) {
      o += 4;
      continue;
    }
    const [recs, end] = records(data, o);
    if (recs.length < 16 || recs.filter(([p]) => p).length < 16) {
      o = end;
      continue;
    }
    const [tbo, tb] = ptrRun(data, end);
    if (!(tb.length >= 8 && tb.length <= 64)) {
      o = end;
      continue;
    }
    const base = tb[0] - o;
    let good = 0;
    let tot = 0;
    let msgs = 0;
    for (const [p] of recs) {
      const fo = p - base;
      if (p === 0 || fo < 0 || fo >= data.length) continue;
      msgs++;
      for (const ch of decodeMessage(data, fo, glyph)) {
        tot++;
        if (!(ch.startsWith("〔") || ch.startsWith("{ff"))) good++;
      }
    }
    const score = tot ? good / tot : 0;
    if (msgs >= 10 && score > 0.6 && (!best || score > best.score)) best = { score, ta: o, tbo, tb, base };
    o = end;
  }
  if (!best) throw new Error("battle dialogue tables not found");
  return { tableA: best.ta, tableB: best.tbo, tb: best.tb, base: best.base };
}

/** Per formation: [tableEntryOff, msgOff, portrait] lines ({0,0}-terminated). */
function formations(data: Uint8Array, base: number, tb: number[]): Array<Array<[number, number, number]>> {
  return tb.map((head) => {
    let o = head - base;
    const lines: Array<[number, number, number]> = [];
    while (o >= 0 && o < data.length - 8) {
      const mp = u32le(data, o);
      if (mp === 0) break;
      lines.push([o, mp - base, u32le(data, o + 4)]);
      o += 8;
    }
    return lines;
  });
}

export interface BattleRecord { offset: number; portrait: number; text: string }
export type BattleOverride = { text: string };

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="line">
    <xs:complexType>
      <xs:simpleContent>
        <xs:extension base="xs:string">
          <xs:attribute name="offset" type="xs:string" use="required"/>
          <xs:attribute name="portrait" type="xs:integer"/>
        </xs:extension>
      </xs:simpleContent>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

export class BattleDialogueDatatype implements Datatype<BattleRecord, BattleOverride> {
  readonly id = "battle-dialogue";
  readonly group = "battle";
  readonly xsd = XSD;

  constructor(private readonly glyph: Glyph, private readonly host = "/BTLP.BIN") {}

  sourcePath(key: RecordKey): string { return `${key}.xml`; }
  keyFromPath(relPath: string): RecordKey { return relPath.replace(/.*\//, "").replace(/\.xml$/i, ""); }

  read(key: RecordKey, ctx: BuildCtx): BattleRecord | undefined {
    const offset = parseInt(key, 16);
    const data = ctx.source.tryRead(this.host);
    if (!data || !Number.isInteger(offset) || offset <= 0 || offset >= data.length) return undefined;
    const { tb, base } = findTables(data, this.glyph);
    let portrait = 0;
    for (const lines of formations(data, base, tb)) {
      const hit = lines.find(([, mo]) => mo === offset);
      if (hit) {
        portrait = hit[2];
        break;
      }
    }
    return { offset, portrait, text: decodeMessage(data, offset, this.glyph) };
  }

  readAll(ctx: BuildCtx): Map<RecordKey, BattleRecord> {
    const out = new Map<RecordKey, BattleRecord>();
    const data = ctx.source.tryRead(this.host);
    if (!data) return out;
    const { tb, base } = findTables(data, this.glyph);
    for (const lines of formations(data, base, tb)) {
      for (const [, mo, portrait] of lines) {
        const key = mo.toString(16);
        if (mo > 0 && mo < data.length && !out.has(key)) {
          out.set(key, { offset: mo, portrait, text: decodeMessage(data, mo, this.glyph) });
        }
      }
    }
    return out;
  }

  apply(merged: Map<RecordKey, BattleRecord>, ctx: BuildCtx): Map<string, Uint8Array> {
    const edits = new Map<number, string>();
    for (const r of merged.values()) edits.set(r.offset, r.text);
    return new Map([[this.host, this.repack(ctx.source.read(this.host), edits)]]);
  }

  /** Append each edited message at EOF, repointing every Table-A entry that referenced it. */
  private repack(data: Uint8Array, edits: Map<number, string>): Uint8Array {
    const { tb, base } = findTables(data, this.glyph);
    const parts: Uint8Array[] = [data];
    let total = data.length;
    const refs = new Map<number, number[]>(); // msgOff → table-A entry offsets pointing at it
    for (const lines of formations(data, base, tb)) {
      for (const [eo, mo] of lines) {
        const list = refs.get(mo) ?? [];
        list.push(eo);
        refs.set(mo, list);
      }
    }
    const repoint: Array<[number, number]> = [];
    for (const [mo, text] of edits) {
      const eos = refs.get(mo);
      if (!eos) continue;
      const newPtr = base + total;
      const enc = encodeMessage(text, this.glyph);
      parts.push(enc);
      total += enc.length;
      for (const eo of eos) repoint.push([eo, newPtr]);
    }
    const out = concat(parts);
    for (const [eo, newPtr] of repoint) out.set(packU32le(newPtr), eo);
    return out;
  }

  merge(base: BattleRecord, ov: BattleOverride): BattleRecord { return { ...base, text: ov.text }; }

  toXml(_key: RecordKey, model: BattleRecord): string {
    return buildXml({ line: { "@offset": model.offset.toString(16), "@portrait": model.portrait, "#text": model.text } });
  }

  fromXml(xml: string): { key: RecordKey; value: BattleOverride } {
    const e = (parseXml(xml) as { line: { "@offset": string; "#text"?: string } }).line;
    return { key: String(e["@offset"]), value: { text: String(e["#text"] ?? "") } };
  }

  // all battle lines bundle into one multiline file: battle/dialogue.xml
  layout(keys: RecordKey[]): Map<string, RecordKey[]> { return new Map([["dialogue.xml", keys]]); }

  serializeFile(_relPath: string, records: Map<RecordKey, BattleRecord>): string {
    const line = [...records.values()].map((m) => ({
      "@offset": m.offset.toString(16), "@portrait": m.portrait, "#text": toMultiline(m.text),
    }));
    return buildXml({ lines: { line } });
  }

  parseFile(_relPath: string, xml: string): Map<RecordKey, BattleOverride> {
    const root = (parseXml(xml) as { lines?: { line?: LineXml | LineXml[] } }).lines;
    const raw = root?.line === undefined ? [] : Array.isArray(root.line) ? root.line : [root.line];
    return new Map(raw.map((e) => [String(e["@offset"]), { text: fromMultiline(String(e["#text"] ?? "")) }]));
  }
}

interface LineXml { "@offset": string; "#text"?: string }
