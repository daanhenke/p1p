// "exe-text" datatype: glyph-encoded strings hard-coded in a PSX executable/overlay (menu/select
// options like "Bet on Brad" that aren't in any string table). An edit find-uniques the old encoded
// string and rewrites it in place, absorbing the length delta into the entry's trailing NUL pad — so
// nothing after it shifts and no relocation is needed. Ports src/persona1/text/exe_patch.py.
//
// Additive (the replacements are authored, not read from the disc) and glyph-find-replace, so — like
// code-patch — it's an allowed overlay scan. One record = a named group of replacements in one file.

import type { BuildCtx, Datatype, RecordKey } from "@p1p/core";
import { buildXml, parseXml } from "@p1p/core";
import type { Glyph } from "../text/glyph.js";
import { encodeResource } from "../text/resource.js";

export interface ExeReplace { from: string; to: string }
export interface ExeTextRecord { id: string; name: string; file: string; replacements: ExeReplace[] }
export type ExeTextOverride = Partial<ExeTextRecord>;

const toHex = (u: Uint8Array): string => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

function findBytes(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Replace `oldb` with `newb` in place, absorbing the delta into trailing NUL pad. Returns a log line. */
function patchOne(exe: Uint8Array, oldb: Uint8Array, newb: Uint8Array): string {
  const m = findBytes(exe, oldb);
  if (m < 0) return `  not found: ${toHex(oldb)}`;
  if (findBytes(exe, oldb, m + 1) >= 0) return `  ambiguous (>1 match) @${m}; refusing`;
  const delta = newb.length - oldb.length;
  let j = m + oldb.length;
  if (j < exe.length && exe[j] === 0xff) j += 2; // keep the FF<code> option terminator in place
  let k = j;
  while (k < exe.length && exe[k] === 0x00) k++; // trailing NUL pad run (entry slack)
  const pad = k - j;
  if (delta > pad) return `  @${m} needs +${delta} but only ${pad} pad byte(s) — relocation required, skipped`;
  const head = exe.slice(m + oldb.length, j); // the FF terminator (unchanged)
  exe.set(newb, m);
  exe.set(head, m + newb.length);
  for (let p = m + newb.length + head.length; p < k; p++) exe[p] = 0; // re-zero the remaining pad
  return `  @${m} ${delta >= 0 ? "+" : ""}${delta}B absorbed into pad`;
}

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="exe-text">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="replace" minOccurs="1" maxOccurs="unbounded">
          <xs:complexType>
            <xs:attribute name="from" type="xs:string" use="required"/>
            <xs:attribute name="to" type="xs:string" use="required"/>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
      <xs:attribute name="id" type="xs:string" use="required"/>
      <xs:attribute name="name" type="xs:string" use="required"/>
      <xs:attribute name="file" type="xs:string" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

interface ReplaceXml { "@from": string; "@to": string }

export class ExeTextDatatype implements Datatype<ExeTextRecord, ExeTextOverride> {
  readonly id = "exe-text";
  readonly group = "exe-text";
  readonly xsd = XSD;

  /** `glyph` encodes the strings; "exe" in a record's `file` resolves to the profile boot exe. */
  constructor(private readonly glyph: Glyph) {}

  sourcePath(key: RecordKey): string { return `${key}.xml`; }
  keyFromPath(relPath: string): RecordKey { return relPath.replace(/.*\//, "").replace(/\.xml$/i, ""); }

  read(): undefined { return undefined; }
  readAll(): Map<RecordKey, ExeTextRecord> { return new Map(); }
  emptyBase(key: RecordKey): ExeTextRecord { return { id: key, name: key, file: "exe", replacements: [] }; }

  merge(base: ExeTextRecord, ov: ExeTextOverride): ExeTextRecord { return { ...base, ...ov }; }

  apply(merged: Map<RecordKey, ExeTextRecord>, ctx: BuildCtx): Map<string, Uint8Array> {
    const hosts = new Map<string, Uint8Array>();
    const bootExe = ctx.profile.data.bootExe as string;
    for (const rec of merged.values()) {
      const path = rec.file === "exe" ? bootExe : rec.file;
      let data = hosts.get(path);
      if (!data) {
        const src = ctx.source.tryRead(path);
        if (!src) {
          ctx.log?.(`  exe-text ${rec.id}: ${path} not loaded`);
          continue;
        }
        data = Uint8Array.from(src);
        hosts.set(path, data);
      }
      for (const r of rec.replacements) {
        const log = patchOne(data, encodeResource(r.from, this.glyph), encodeResource(r.to, this.glyph));
        ctx.log?.(`exe-text ${rec.id} '${r.from}'->'${r.to}':${log}`);
      }
    }
    return hosts;
  }

  toXml(_key: RecordKey, model: ExeTextRecord): string {
    return buildXml({
      "exe-text": {
        "@id": model.id, "@name": model.name, "@file": model.file,
        replace: model.replacements.map((r) => ({ "@from": r.from, "@to": r.to })),
      },
    });
  }

  fromXml(xml: string): { key: RecordKey; value: ExeTextOverride } {
    const e = (parseXml(xml) as {
      "exe-text": { "@id": string; "@name": string; "@file": string; replace?: ReplaceXml | ReplaceXml[] };
    })["exe-text"];
    const raw = e.replace === undefined ? [] : Array.isArray(e.replace) ? e.replace : [e.replace];
    const replacements = raw.map((r) => ({ from: r["@from"], to: r["@to"] }));
    return { key: String(e["@id"]), value: { id: e["@id"], name: e["@name"], file: e["@file"], replacements } };
  }
}
