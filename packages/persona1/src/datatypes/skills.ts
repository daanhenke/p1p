// "skills" semantic entity: one skill = its display name (the description is NOT a skill field — the
// slus menu-strings pool isn't skill-indexed, so item/effect descriptions live in descriptions.xml).
// The name has two copies in the same 243-skill ordering: the btlp skill-names pointer table and an
// inline copy in the SLUS skill-menu table (the in-battle skill menu). skills.xml is one <skill id>:
//   <name>  → the canonical display name (btlp pointer table, any length).
//   <menu>  → the skill-menu copy; defaults to <name> (the two are linked). When <name> won't fit the
//             menu table's fixed 12-byte field, it's auto-abbreviated (strip spaces, then truncate);
//             set <menu> explicitly to override an abbreviation that reads badly (34 skills overflow).
// An override is partial. apply writes both copies: skill-names (btlp) + skill-menu (slus).

import type { BuildCtx, Datatype, RecordKey } from "@p1p/core";
import { buildXml, parseXml } from "@p1p/core";
import type { Glyph } from "../text/glyph.js";
import { readString, repackStringTable, type StringTableSpec } from "./stringTable.js";
import { encodeName, encodedNameLength, type NameSubTable } from "./nameTable.js";

export interface SkillsSpec {
  count: number;
  /** skill names (btlp pointer table). */
  names: StringTableSpec;
  /**
   * Inline display-name copies that must be rewritten in lock-step so the rename shows in every menu
   * (currently just the slus skill-menu table @+4). Each is written for skills `i < copy.count` with
   * the skill's `menu` name (which defaults to its `name`).
   */
  nameCopies?: NameSubTable[];
}

// `menu` is the skill-menu copy of the display name. It's normally identical to `name` (the two are
// linked) and only differs when `name` won't fit the menu table's fixed field — see file header.
export interface SkillRecord { id: number; name: string; menu?: string }
export type SkillOverride = Partial<Pick<SkillRecord, "name" | "menu">>;

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="skill">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="name" type="xs:string" minOccurs="0"/>
        <xs:element name="menu" type="xs:string" minOccurs="0"/>
      </xs:sequence>
      <xs:attribute name="id" type="xs:nonNegativeInteger" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

interface SkillXml { "@id": string; name?: string; menu?: string }

export class SkillsDatatype implements Datatype<SkillRecord, SkillOverride> {
  readonly id = "skills";
  readonly group = ""; // root → skills.xml
  readonly xsd = XSD;

  constructor(private readonly glyph: Glyph, private readonly spec: SkillsSpec) {}

  private host(file: string, ctx: BuildCtx): string {
    return file === "exe" ? (ctx.profile.data.bootExe as string) : file;
  }

  sourcePath(key: RecordKey): string { return `${key}.xml`; }
  keyFromPath(relPath: string): RecordKey { return relPath.replace(/.*\//, "").replace(/\.xml$/i, ""); }

  read(key: RecordKey, ctx: BuildCtx): SkillRecord | undefined {
    const id = Number(key);
    if (id < 0 || id >= this.spec.count) return undefined;
    const names = ctx.source.tryRead(this.host(this.spec.names.file, ctx));
    if (!names) return undefined;
    return { id, name: readString(this.glyph, names, this.spec.names, id) ?? "" };
  }

  readAll(ctx: BuildCtx): Map<RecordKey, SkillRecord> {
    const out = new Map<RecordKey, SkillRecord>();
    for (let i = 0; i < this.spec.count; i++) {
      const r = this.read(String(i), ctx);
      if (r) out.set(String(i), r);
    }
    return out;
  }

  apply(merged: Map<RecordKey, SkillRecord>, ctx: BuildCtx): Map<string, Uint8Array> {
    const nameEdits = new Map<number, string>();
    const menuEdits = new Map<number, string>();
    for (const r of merged.values()) {
      nameEdits.set(r.id, r.name);
      if (r.menu !== undefined) menuEdits.set(r.id, r.menu);
    }

    const changes = new Map<string, Uint8Array>();
    // 1) display names → the btlp skill-names pointer table.
    const namesHost = this.host(this.spec.names.file, ctx);
    changes.set(namesHost, repackStringTable(this.glyph, ctx.source.read(namesHost), nameEdits, this.spec.names));

    // 2) inline display-name copies (skill-menu) → sparse byte-patch into the copy's host buffer (read
    //    the layered source so this composes with other datatypes editing the same file, e.g. items /
    //    descriptions). The copy uses the skill's `menu` name, which defaults to `name`; a name that
    //    won't fit the fixed field and has no `menu` override throws from encodeName, naming the skill.
    for (const copy of this.spec.nameCopies ?? []) {
      const host = this.host(copy.file, ctx);
      const buf = changes.get(host) ?? ctx.source.read(host).slice();
      const wide = copy.wide ?? false;
      for (const [i, name] of nameEdits) {
        if (i >= copy.count) continue;
        const text = menuEdits.get(i) ?? this.fitMenu(name, copy.nameLen, wide);
        buf.set(encodeName(this.glyph, text, copy.nameLen, wide), copy.base + i * copy.stride + copy.nameOff);
      }
      changes.set(host, buf);
    }
    return changes;
  }

  /** A display name shrunk to fit a `len`-byte menu field: as-is if it fits, else spaces stripped,
   *  else truncated to the byte budget. `<menu>` overrides this for names that abbreviate badly. */
  private fitMenu(name: string, len: number, wide: boolean): string {
    if (encodedNameLength(this.glyph, name, wide) <= len) return name;
    const squashed = name.replace(/ /g, "");
    if (encodedNameLength(this.glyph, squashed, wide) <= len) return squashed;
    let out = "";
    for (const ch of squashed) {
      if (encodedNameLength(this.glyph, out + ch, wide) > len) break;
      out += ch;
    }
    return out;
  }

  merge(base: SkillRecord, ov: SkillOverride): SkillRecord { return { ...base, ...ov }; }

  layout(keys: RecordKey[]): Map<string, RecordKey[]> { return new Map([["skills.xml", keys]]); }

  serializeFile(_relPath: string, records: Map<RecordKey, SkillRecord>): string {
    const skill = [...records.values()].map((m) => this.xmlOf(m));
    return buildXml({ skills: { skill } });
  }

  parseFile(_relPath: string, xml: string): Map<RecordKey, SkillOverride> {
    const root = (parseXml(xml) as { skills?: { skill?: SkillXml | SkillXml[] } }).skills;
    const raw = root?.skill === undefined ? [] : Array.isArray(root.skill) ? root.skill : [root.skill];
    return new Map(raw.map((e) => [String(Number(e["@id"])), this.overrideOf(e)]));
  }

  private overrideOf(e: SkillXml): SkillOverride {
    const ov: SkillOverride = {};
    if (e.name !== undefined) ov.name = String(e.name);
    if (e.menu !== undefined) ov.menu = String(e.menu);
    return ov;
  }

  private xmlOf(m: SkillRecord): { "@id": number; name: string; menu?: string } {
    return { "@id": m.id, name: m.name, ...(m.menu !== undefined ? { menu: m.menu } : {}) };
  }

  toXml(_key: RecordKey, model: SkillRecord): string {
    return buildXml({ skill: this.xmlOf(model) });
  }

  fromXml(xml: string): { key: RecordKey; value: SkillOverride } {
    const e = (parseXml(xml) as { skill: SkillXml }).skill;
    return { key: String(Number(e["@id"])), value: this.overrideOf(e) };
  }
}
