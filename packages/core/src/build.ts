// Profile-driven build: layer enabled patches over the base game and emit the changed host files.
// Disc-level packaging (ISO file table, EDC/ECC) is the platform's job (@p1p/ps1) — this returns
// the changed ISO files (path → bytes) for the platform to write into the image.

import { LayeredAssetSource, type AssetSource } from "./assetSource.js";
import type { BuildCtx, Issue } from "./datatype.js";
import { mergePatches, type Patch } from "./patch.js";
import type { Profile } from "./profile.js";

export interface BuildResult {
  /** ISO path → new file bytes, for every host file an enabled patch changed. */
  changes: Map<string, Uint8Array>;
  issues: Issue[];
}

export function buildChanges(
  profile: Profile,
  patches: Patch[],
  source: AssetSource,
  log?: (msg: string) => void,
  settings?: Record<string, string>,
): BuildResult {
  for (const p of patches) {
    if (p.manifest.game !== profile.id) {
      throw new Error(`patch "${p.manifest.id}" targets game "${p.manifest.game}", not "${profile.id}"`);
    }
  }
  const layered = new LayeredAssetSource(source);
  const ctx: BuildCtx = { source: layered, profile, settings, log };

  const { models, issues } = mergePatches(patches, (id) => profile.datatypes.require(id), ctx);

  // Apply each datatype's merged records, composing edits to shared host files via the layered source.
  for (const dt of profile.datatypes) {
    const recs = models.get(dt.id);
    if (!recs || recs.size === 0) continue;
    for (const [path, bytes] of dt.apply(recs, ctx)) layered.put(path, bytes);
    log?.(`  ${dt.id}: ${recs.size} record(s)`);
  }

  return { changes: layered.changedFiles(), issues };
}
