// "s2d-dialogue" datatype: overworld-map NPC dialogue in the S2D overlay, reached via the 2D event
// VM's FF55 ("show dialogue") op whose +4 operand points to a {ret}-terminated message. Several ops
// can target one message; an edit that still fits is rewritten in place (0x00-padded), else appended
// to EOF and EVERY referencing op is repointed. Ports the ff55 half of src/persona1/strtab.py.
//
// S2D.BIN is a compiled overlay with no table pointing at the messages, so they're located by scanning
// for FF55 ops (the sanctioned overlay exception) — each candidate is validated as a real terminated
// string. Records are keyed by dialogue index (op order). One instance per host overlay.

import type { BuildCtx, Datatype, Issue, RecordKey } from "@p1p/core";
import { u32le, buildXml, parseXml } from "@p1p/core";
import type { Glyph } from "../text/glyph.js";
import { decodeResource, encodeResource, fromMultiline, toMultiline } from "../text/resource.js";
import { schemaLen } from "../script/opcodes.js";
import { overflows, TEXTBOX_WIDTHS } from "../text/textbox.js";

const RET = [0xff, 0x01]; // {ret} — the s2d dialogue terminator

/** Length of the string at `off` incl. its FF01 terminator, or -1 if it doesn't terminate in `limit`. */
function stringBytes(glyph: Glyph, data: Uint8Array, off: number, limit = 0x400): number {
  let p = off;
  while (p < data.length && p - off < limit) {
    const b = data[p];
    if (b === 0xff) {
      if (p + 1 >= data.length) return -1;
      const op = data[p + 1];
      if (op === 0x01) return p + 2 - off;
      p += 2 + schemaLen(op);
      continue;
    }
    const [, n] = glyph.decodeGlyphAt(data, p);
    p += n;
  }
  return -1;
}

function isJapanese(text: string): boolean {
  const plain = text.replace(/\{[^}]*\}|〔[^〕]*〕/gu, "");
  const kanji = plain.match(/[㐀-鿿]/gu)?.length ?? 0;
  return kanji >= 3 && kanji <= 300;
}

/** Scan for FF55 dialogue ops → [ordered message offsets, msgOff → referencing op offsets]. */
function ff55Messages(glyph: Glyph, data: Uint8Array, ram: number): [number[], Map<number, number[]>] {
  const targets = new Map<number, number[]>();
  for (let i = 0; i < data.length - 8; i++) {
    if (data[i] === 0xff && data[i + 1] === 0x55) {
      const t = u32le(data, i + 4) - ram;
      if (t >= 0 && t < data.length && stringBytes(glyph, data, t) > 0) {
        const list = targets.get(t) ?? [];
        list.push(i);
        targets.set(t, list);
      }
    }
  }
  const order = [...targets.keys()].sort((a, b) => targets.get(a)![0] - targets.get(b)![0]); // by first op
  return [order, targets];
}

export interface S2dDialogueRecord { index: number; lang: "us" | "jp"; text: string }
export type S2dDialogueOverride = { text: string };

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="dialogue">
    <xs:complexType>
      <xs:simpleContent>
        <xs:extension base="xs:string">
          <xs:attribute name="index" type="xs:nonNegativeInteger" use="required"/>
        </xs:extension>
      </xs:simpleContent>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

export class S2dDialogueDatatype implements Datatype<S2dDialogueRecord, S2dDialogueOverride> {
  readonly id = "s2d-dialogue";
  readonly group = "overworld";
  readonly xsd = XSD;

  constructor(
    private readonly us: Glyph,
    private readonly jp: Glyph,
    private readonly host = "/S2D.BIN",
    private readonly ram = 0x80065a84,
  ) {}

  sourcePath(key: RecordKey): string { return `${key}.xml`; }
  keyFromPath(relPath: string): RecordKey { return relPath.replace(/.*\//, "").replace(/\.xml$/i, ""); }

  private decodeAt(data: Uint8Array, off: number): { lang: "us" | "jp"; text: string } {
    const body = data.subarray(off, off + stringBytes(this.us, data, off) - RET.length);
    const jp = decodeResource(body, this.jp);
    return isJapanese(jp) ? { lang: "jp", text: jp } : { lang: "us", text: decodeResource(body, this.us) };
  }

  read(key: RecordKey, ctx: BuildCtx): S2dDialogueRecord | undefined {
    const index = Number(key);
    const data = ctx.source.tryRead(this.host);
    if (!data || !Number.isInteger(index)) return undefined;
    const [order] = ff55Messages(this.us, data, this.ram);
    if (index < 0 || index >= order.length) return undefined;
    return { index, ...this.decodeAt(data, order[index]) };
  }

  readAll(ctx: BuildCtx): Map<RecordKey, S2dDialogueRecord> {
    const out = new Map<RecordKey, S2dDialogueRecord>();
    const data = ctx.source.tryRead(this.host);
    if (!data) return out;
    const [order] = ff55Messages(this.us, data, this.ram);
    order.forEach((off, index) => out.set(String(index), { index, ...this.decodeAt(data, off) }));
    return out;
  }

  apply(merged: Map<RecordKey, S2dDialogueRecord>, ctx: BuildCtx): Map<string, Uint8Array> {
    const edits = new Map<number, string>();
    for (const r of merged.values()) edits.set(r.index, r.text);
    return new Map([[this.host, this.repack(ctx.source.read(this.host), edits)]]);
  }

  /** Rewrite edited messages: in place when they fit, else append + repoint every referencing op. */
  private repack(data: Uint8Array, edits: Map<number, string>): Uint8Array {
    const out = Array.from(data);
    const [order, targets] = ff55Messages(this.us, data, this.ram);
    for (const [index, text] of edits) {
      if (index < 0 || index >= order.length) throw new Error(`s2d dialogue index ${index} out of range`);
      const off = order[index];
      const neu = [...encodeResource(text, this.us), ...RET];
      const orig = stringBytes(this.us, data, off);
      if (neu.length <= orig) {
        for (let i = 0; i < neu.length; i++) out[off + i] = neu[i];
        for (let p = off + neu.length; p < off + orig; p++) out[p] = 0;
      } else {
        const at = out.length;
        for (const b of neu) out.push(b);
        for (const op of targets.get(off)!) writeU32(out, op + 4, at + this.ram);
      }
    }
    return Uint8Array.from(out);
  }

  merge(base: S2dDialogueRecord, ov: S2dDialogueOverride): S2dDialogueRecord { return { ...base, text: ov.text }; }

  validate(key: RecordKey, model: S2dDialogueRecord): Issue[] {
    const ov = overflows(model.text, TEXTBOX_WIDTHS.us);
    return ov.length
      ? [{ level: "warn", datatype: this.id, key, message: `textbox overflow: ${JSON.stringify(ov)}` }]
      : [];
  }

  toXml(_key: RecordKey, model: S2dDialogueRecord): string {
    return buildXml({ dialogue: { "@index": model.index, "#text": model.text } });
  }

  fromXml(xml: string): { key: RecordKey; value: S2dDialogueOverride } {
    const e = (parseXml(xml) as { dialogue: { "@index": string; "#text"?: string } }).dialogue;
    return { key: String(Number(e["@index"])), value: { text: String(e["#text"] ?? "") } };
  }

  // all overworld dialogue bundles into one file: overworld/dialogue.xml
  layout(keys: RecordKey[]): Map<string, RecordKey[]> { return new Map([["dialogue.xml", keys]]); }

  serializeFile(_relPath: string, records: Map<RecordKey, S2dDialogueRecord>): string {
    const dialogue = [...records.values()].map((m) => ({ "@index": m.index, "#text": toMultiline(m.text) }));
    return buildXml({ dialogues: { dialogue } });
  }

  parseFile(_relPath: string, xml: string): Map<RecordKey, S2dDialogueOverride> {
    const root = (parseXml(xml) as { dialogues?: { dialogue?: DialogueXml | DialogueXml[] } }).dialogues;
    const raw = root?.dialogue === undefined ? [] : Array.isArray(root.dialogue) ? root.dialogue : [root.dialogue];
    return new Map(raw.map((e) => [String(Number(e["@index"])), { text: fromMultiline(String(e["#text"] ?? "")) }]));
  }
}

interface DialogueXml { "@index": string; "#text"?: string }

function writeU32(buf: number[], off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
  buf[off + 2] = (v >>> 16) & 0xff;
  buf[off + 3] = (v >>> 24) & 0xff;
}
