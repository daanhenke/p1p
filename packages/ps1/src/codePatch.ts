// Parameterized binary code patches for the PSX executables/overlays — the ONE datatype allowed to
// byte-scan (there's no structure to follow inside compiled overlay code). Each site anchors on a
// unique byte pattern (`??`/`**` = wildcard) in a target file and writes a little-endian `value` at an
// offset within the match. Ports web/src/core/codePatch.ts / src/persona1/code_patch.py.
//
// A code-patch is *additive*: its records have no disc base, so the whole record comes from a patch's
// XML (one `<code-patch>` per file); the build scans + writes its sites over the (possibly already
// edited) host file via the layered source.
//
// A record may also declare `<setting>`s — user-tunable knobs the wizard renders. A site bound to a
// setting carries a `<case>` per option; at build time the selected option (passed through BuildCtx)
// picks which value the site writes. With no selection the site uses its default-option value, so a
// settings-aware pack still builds correctly headless.

import type { BuildCtx, Datatype, RecordKey } from "@p1p/core";
import { buildXml, parseXml } from "@p1p/core";
import { assembleMips } from "./mipsAsm.js";

export type SiteWidth = 1 | 2 | 4;

export interface CodePatchSettingOption { value: string; label: string }
export interface CodePatchSetting {
  id: string;
  label: string;
  description?: string;
  /** Option `value` selected when the user makes no choice. */
  default: string;
  options: CodePatchSettingOption[];
}

export interface PatchSite {
  file: string;
  anchor: string;
  offset: number;
  width: SiteWidth;
  /** Value written when the site has no setting, or for the setting's default option. */
  value: number;
  /** Id of the {@link CodePatchSetting} that tunes this site (omitted = constant). */
  setting?: string;
  /** Per-option value for a tuned site (option value → little-endian number). */
  cases?: Record<string, number>;
}

export interface CodePatchRecord {
  id: string;
  name: string;
  description?: string;
  settings?: CodePatchSetting[];
  sites: PatchSite[];
}
export type CodePatchOverride = Partial<CodePatchRecord>;

// ---- low-level anchored write (reusable + directly tested) ----

export function parseAnchor(anchor: string): { pat: Uint8Array; mask: Uint8Array } {
  const toks = anchor.includes(" ") ? anchor.trim().split(/\s+/) : anchor.match(/../g) ?? [];
  const pat = new Uint8Array(toks.length);
  const mask = new Uint8Array(toks.length);
  toks.forEach((t, i) => {
    const wild = t === "??" || t === "**";
    pat[i] = wild ? 0 : parseInt(t, 16);
    mask[i] = wild ? 0 : 0xff;
  });
  return { pat, mask };
}

/** -1 = not found, -2 = ambiguous (>1 match), else the single match offset. */
export function findUnique(data: Uint8Array, pat: Uint8Array, mask: Uint8Array): number {
  const n = data.length;
  const m = pat.length;
  let hit = -1;
  outer: for (let i = 0; i <= n - m; i++) {
    for (let j = 0; j < m; j++) if ((data[i + j] & mask[j]) !== pat[j]) continue outer;
    if (hit >= 0) return -2;
    hit = i;
  }
  return hit;
}

/** Apply one site in place to `data`; returns a human log line (and never throws on a miss). */
export function applySite(data: Uint8Array, site: PatchSite): string {
  const { pat, mask } = parseAnchor(site.anchor);
  const m = findUnique(data, pat, mask);
  if (m === -1) return `  anchor not found: ${site.anchor}`;
  if (m === -2) return `  ambiguous anchor (>1 match): ${site.anchor}; refusing`;
  const at = m + site.offset;
  const w = site.width;
  if (at < 0 || at + w > data.length) return `  site out of range @${at}`;
  let old = 0;
  for (let k = 0; k < w; k++) old |= data[at + k] << (8 * k);
  for (let k = 0; k < w; k++) data[at + k] = (site.value >>> (8 * k)) & 0xff;
  return `  @0x${at.toString(16)} ${old >>> 0} -> ${site.value} (${w}B)`;
}

/** The value a site writes given the selected options (settingId → chosen option value). */
export function resolveSiteValue(site: PatchSite, selections?: Record<string, string>): number {
  if (!site.setting || !site.cases) return site.value;
  const chosen = selections?.[site.setting];
  if (chosen !== undefined && site.cases[chosen] !== undefined) return site.cases[chosen];
  return site.value;
}

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="code-patch">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="description" type="xs:string" minOccurs="0"/>
        <xs:element name="setting" minOccurs="0" maxOccurs="unbounded">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="option" minOccurs="1" maxOccurs="unbounded">
                <xs:complexType>
                  <xs:attribute name="value" type="xs:string" use="required"/>
                  <xs:attribute name="label" type="xs:string" use="required"/>
                </xs:complexType>
              </xs:element>
            </xs:sequence>
            <xs:attribute name="id" type="xs:string" use="required"/>
            <xs:attribute name="label" type="xs:string" use="required"/>
            <xs:attribute name="description" type="xs:string"/>
            <xs:attribute name="default" type="xs:string" use="required"/>
          </xs:complexType>
        </xs:element>
        <xs:element name="site" minOccurs="1" maxOccurs="unbounded">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="case" minOccurs="0" maxOccurs="unbounded">
                <xs:complexType>
                  <xs:attribute name="option" type="xs:string" use="required"/>
                  <xs:attribute name="value" type="xs:integer"/>
                  <xs:attribute name="asm" type="xs:string"/>
                </xs:complexType>
              </xs:element>
            </xs:sequence>
            <xs:attribute name="file" type="xs:string" use="required"/>
            <xs:attribute name="anchor" type="xs:string" use="required"/>
            <xs:attribute name="offset" type="xs:integer" use="required"/>
            <xs:attribute name="width" type="xs:integer"/>
            <xs:attribute name="value" type="xs:integer"/>
            <xs:attribute name="asm" type="xs:string"/>
            <xs:attribute name="setting" type="xs:string"/>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
      <xs:attribute name="id" type="xs:string" use="required"/>
      <xs:attribute name="name" type="xs:string" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

interface CaseXml { "@option": string; "@value"?: string; "@asm"?: string }
interface SiteXml {
  "@file": string; "@anchor": string; "@offset": string; "@width"?: string;
  "@value"?: string; "@asm"?: string; "@setting"?: string; case?: CaseXml | CaseXml[];
}
interface OptionXml { "@value": string; "@label": string }
interface SettingXml { "@id": string; "@label": string; "@description"?: string; "@default": string; option?: OptionXml | OptionXml[] }

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** A `value=`/`asm=` pair → a concrete little-endian number (asm assembles to one instruction). */
function encodeValue(value: string | undefined, asm: string | undefined, where: string): number {
  if (asm !== undefined) return assembleMips(String(asm));
  if (value !== undefined) return Number(value);
  throw new Error(`code-patch ${where} requires either value= or asm=`);
}

export class CodePatchDatatype implements Datatype<CodePatchRecord, CodePatchOverride> {
  readonly id = "code-patch";
  readonly group = "code-patches";
  readonly xsd = XSD;

  sourcePath(key: RecordKey): string { return `${key}.xml`; }
  keyFromPath(relPath: string): RecordKey { return relPath.replace(/.*\//, "").replace(/\.xml$/i, ""); }

  /** Additive: nothing to read from the disc. */
  read(): undefined { return undefined; }
  readAll(): Map<RecordKey, CodePatchRecord> { return new Map(); }
  emptyBase(key: RecordKey): CodePatchRecord { return { id: key, name: key, sites: [] }; }

  merge(base: CodePatchRecord, ov: CodePatchOverride): CodePatchRecord { return { ...base, ...ov }; }

  apply(merged: Map<RecordKey, CodePatchRecord>, ctx: BuildCtx): Map<string, Uint8Array> {
    const hosts = new Map<string, Uint8Array>(); // host path → working copy (mutated in place)
    for (const rec of merged.values()) {
      ctx.log?.(`${rec.id}:`);
      for (const site of rec.sites) {
        let data = hosts.get(site.file);
        if (!data) {
          const src = ctx.source.tryRead(site.file);
          if (!src) {
            ctx.log?.(`  ${site.file}: not loaded, skipped`);
            continue;
          }
          data = Uint8Array.from(src);
          hosts.set(site.file, data);
        }
        // Resolve the tuned value (if any) before applying — must not be gated behind ctx.log?.().
        const effective = { ...site, value: resolveSiteValue(site, ctx.settings) };
        const msg = applySite(data, effective);
        ctx.log?.(site.file + msg);
      }
    }
    return hosts;
  }

  toXml(_key: RecordKey, model: CodePatchRecord): string {
    return buildXml({
      "code-patch": {
        "@id": model.id,
        "@name": model.name,
        ...(model.description ? { description: model.description } : {}),
        ...(model.settings?.length
          ? {
              setting: model.settings.map((s) => ({
                "@id": s.id,
                "@label": s.label,
                ...(s.description ? { "@description": s.description } : {}),
                "@default": s.default,
                option: s.options.map((o) => ({ "@value": o.value, "@label": o.label })),
              })),
            }
          : {}),
        site: model.sites.map((s) => ({
          "@file": s.file, "@anchor": s.anchor, "@offset": s.offset, "@width": s.width,
          ...(s.setting
            ? {
                "@setting": s.setting,
                case: Object.entries(s.cases ?? {}).map(([option, value]) => ({ "@option": option, "@value": value })),
              }
            : { "@value": s.value }),
        })),
      },
    });
  }

  fromXml(xml: string): { key: RecordKey; value: CodePatchOverride } {
    const e = (parseXml(xml) as {
      "code-patch": {
        "@id": string; "@name": string; description?: string;
        setting?: SettingXml | SettingXml[]; site?: SiteXml | SiteXml[];
      };
    })["code-patch"];

    const settings: CodePatchSetting[] = asArray(e.setting).map((s) => ({
      id: String(s["@id"]),
      label: String(s["@label"]),
      description: s["@description"] !== undefined ? String(s["@description"]) : undefined,
      default: String(s["@default"]),
      options: asArray(s.option).map((o) => ({ value: String(o["@value"]), label: String(o["@label"]) })),
    }));
    const defaultOf = new Map(settings.map((s) => [s.id, s.default]));

    const sites: PatchSite[] = asArray(e.site).map((s) => {
      const width = Number(s["@width"] ?? (s["@asm"] !== undefined ? 4 : 1)) as SiteWidth;
      const setting = s["@setting"];
      if (setting === undefined) {
        return {
          file: s["@file"], anchor: s["@anchor"], offset: Number(s["@offset"]), width,
          value: encodeValue(s["@value"], s["@asm"], `site (${s["@file"]})`),
        };
      }
      const cases: Record<string, number> = {};
      for (const c of asArray(s.case)) {
        cases[String(c["@option"])] = encodeValue(c["@value"], c["@asm"], `case (${s["@file"]} / ${c["@option"]})`);
      }
      const dflt = defaultOf.get(String(setting));
      const value = dflt !== undefined && cases[dflt] !== undefined ? cases[dflt] : Object.values(cases)[0] ?? 0;
      return { file: s["@file"], anchor: s["@anchor"], offset: Number(s["@offset"]), width, value, setting: String(setting), cases };
    });

    return {
      key: String(e["@id"]),
      value: { id: e["@id"], name: e["@name"], description: e.description, settings: settings.length ? settings : undefined, sites },
    };
  }
}
