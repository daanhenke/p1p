// A patch = a self-contained feature/mod (base translation, an optional tweak, or a third-party mod):
// a manifest + a flat list of overrides across any datatypes. Patches are layered at build time in
// priority order; the base game record is the starting point and each enabled patch's override merges
// on top (last-writer-wins per field unless the datatype defines smarter merge).

import type { BuildCtx, Datatype, Issue, Override, RecordKey } from "./datatype.js";

export interface PatchManifest {
  /** Unique patch id, e.g. "persona1-en", "exp-multiplier". */
  id: string;
  name: string;
  description?: string;
  /** Target profile id, e.g. "persona1". */
  game: string;
  version?: string;
  /** Load order: lower priority applies first (so higher-priority patches win). Default 0. */
  priority?: number;
  requires?: string[];
  conflicts?: string[];
}

export interface Patch {
  manifest: PatchManifest;
  overrides: Override[];
}

export interface MergeResult {
  /** datatypeId → (recordKey → merged model). */
  models: Map<string, Map<RecordKey, unknown>>;
  issues: Issue[];
}

/**
 * Layer an ordered set of patches over the base game. For every (datatype, key) that any patch
 * touches, read the base model once and fold each patch's override on top in priority order.
 */
export function mergePatches(
  patches: Patch[],
  datatypeOf: (id: string) => Datatype<unknown, unknown>,
  ctx: BuildCtx,
): MergeResult {
  const ordered = [...patches].sort((a, b) => (a.manifest.priority ?? 0) - (b.manifest.priority ?? 0));
  const issues: Issue[] = [];

  // Collect overrides grouped by datatype then key, preserving patch order.
  const grouped = new Map<string, Map<RecordKey, unknown[]>>();
  for (const patch of ordered) {
    for (const ov of patch.overrides) {
      let byKey = grouped.get(ov.datatype);
      if (!byKey) {
        byKey = new Map();
        grouped.set(ov.datatype, byKey);
      }
      const list = byKey.get(ov.key) ?? [];
      list.push(ov.value);
      byKey.set(ov.key, list);
    }
  }

  const models = new Map<string, Map<RecordKey, unknown>>();
  for (const [dtId, byKey] of grouped) {
    const dt = datatypeOf(dtId);
    const out = new Map<RecordKey, unknown>();
    for (const [key, overrides] of byKey) {
      const base = dt.read(key, ctx) ?? dt.emptyBase?.(key, ctx);
      if (base === undefined) {
        issues.push({ level: "error", datatype: dtId, key, message: `record not found in base game` });
        continue;
      }
      let model: unknown = base;
      for (const ov of overrides) model = dt.merge(model, ov, ctx);
      out.set(key, model);
      if (dt.validate) issues.push(...dt.validate(key, model, ctx));
    }
    models.set(dtId, out);
  }
  return { models, issues };
}
