// The datatype-codec abstraction: how to read / edit (override-merge) / write back one CATEGORY of
// game content (scene text, a name table, a code patch, …). A datatype is the unit a patch's XML
// sources and the build pipeline are organised around. Models are plain data; an authoring *override*
// is a `Partial<M>` that merges onto a base model parsed from the disc.

import type { AssetSource } from "./assetSource.js";
import type { Profile } from "./profile.js";

/** Identifies one editable record within a datatype, e.g. "demon/024" or "e0/123". */
export type RecordKey = string;

export interface BuildCtx {
  /** Base game files to read original records from (disc image / loose folder). */
  source: AssetSource;
  /** Per-game constants (glyph maps, opcode table, table specs, code-patch anchors, …). */
  profile: Profile;
  /** Chosen value per patch setting (settingId → option value); tunes settings-aware datatypes. */
  settings?: Record<string, string>;
  log?: (msg: string) => void;
}

export interface Issue {
  level: "error" | "warn";
  message: string;
  key?: RecordKey;
  datatype?: string;
}

/** An override carried by a patch: a partial model for one record of one datatype. */
export interface Override<O = unknown> {
  datatype: string;
  key: RecordKey;
  value: O;
}

/**
 * Codec for one category of content. `M` is the per-record model; `O` is the override shape
 * (usually `Partial<M>`). Parsers MUST be structure-driven (follow the game's headers / pointer
 * tables / VM walks) — never a blind byte scan (the sole exception, overlay code-patch anchoring,
 * lives in its own datatype in @p1p/ps1).
 */
export interface Datatype<M, O = Partial<M>> {
  readonly id: string;

  /**
   * Folder/group these XML sources live under inside a patch, named for the *thing* it edits
   * ("overworld-locations", "overworld-dialogue", "scenes", "names"). Each record is one file at
   * `<patch>/<group>/<sourcePath(key)>`.
   */
  readonly group: string;

  /** Relative XML source path for a record within {@link group}, e.g. "demon/024.xml". */
  sourcePath(key: RecordKey): string;

  /** Inverse of {@link sourcePath}: the record key for a path relative to the group. */
  keyFromPath(relPath: string): RecordKey;

  /** Base model for one record (or undefined if the key doesn't exist). */
  read(key: RecordKey, ctx: BuildCtx): M | undefined;

  /**
   * Starting model for an *additive* datatype whose records have no disc base (e.g. a code-patch the
   * author introduces). When {@link read} returns undefined the merge falls back to this, so a patch
   * can supply a brand-new record. Omit for datatypes that only edit existing disc content.
   */
  emptyBase?(key: RecordKey, ctx: BuildCtx): M | undefined;

  /** Every record's base model — used by `extract` to dump all sources. */
  readAll(ctx: BuildCtx): Map<RecordKey, M>;

  /** Write the merged records into the host file(s); returns the changed ISO files (path → bytes). */
  apply(merged: Map<RecordKey, M>, ctx: BuildCtx): Map<string, Uint8Array>;

  /** Merge an override onto a base model (defines this datatype's override semantics). */
  merge(base: M, ov: O, ctx: BuildCtx): M;

  /** Model → XML source string (one file per record). */
  toXml(key: RecordKey, model: M): string;

  /** XML source → { key, override }. Validated against {@link xsd} by the caller. */
  fromXml(xml: string): { key: RecordKey; value: O };

  /**
   * How records map to source files. Returns relative-path → the record keys it holds. Default (when
   * omitted): one file per key at {@link sourcePath}. Override to bundle many records into one file
   * (e.g. all skills → "skills.xml"). When set, {@link serializeFile} + {@link parseFile} must be too.
   */
  layout?(keys: RecordKey[]): Map<string, RecordKey[]>;

  /** Serialize the records sharing one file (the {@link layout} bundle) to XML. */
  serializeFile?(relPath: string, records: Map<RecordKey, M>): string;

  /** Parse one bundled source file → its per-record overrides (inverse of {@link serializeFile}). */
  parseFile?(relPath: string, xml: string): Map<RecordKey, O>;

  /** Extra non-record source files this datatype maintains (e.g. a scene-archive naming manifest). */
  auxFiles?(ctx: BuildCtx): Map<string, string>;

  /**
   * Load this datatype's existing aux files (relative to its group) before reading — e.g. a manifest
   * that names scenes, so {@link sourcePath} / extract can use those names. `read(rel)` returns the
   * file's text or undefined if absent.
   */
  loadAux?(read: (relPath: string) => string | undefined): void;

  /** Optional content rules (e.g. textbox overflow). */
  validate?(key: RecordKey, model: M, ctx: BuildCtx): Issue[];

  /** XSD schema source for this datatype's XML (the published contract). */
  readonly xsd?: string;
}

/** Concrete datatypes have specific M/O; the registry erases them for dynamic dispatch. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDatatype = Datatype<any, any>;

/** A registry of datatypes by id (assembled by a profile). */
export class DatatypeRegistry {
  private readonly map = new Map<string, AnyDatatype>();
  constructor(datatypes: AnyDatatype[] = []) { for (const d of datatypes) this.add(d); }

  add(d: AnyDatatype): void { this.map.set(d.id, d); }
  get(id: string): AnyDatatype | undefined { return this.map.get(id); }
  require(id: string): AnyDatatype {
    const d = this.map.get(id);
    if (!d) throw new Error(`unknown datatype: ${id}`);
    return d;
  }

  get ids(): string[] { return [...this.map.keys()]; }
  [Symbol.iterator](): Iterator<AnyDatatype> { return this.map.values(); }
}
