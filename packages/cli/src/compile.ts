// `compile`: read a patch directory (patch.xml manifest + per-datatype XML sources) and write a
// compiled `.bin` pack (RKPK format). The pack is self-contained and distributable; the wizard
// reads it instead of shipping the raw XML tree. Mirrors `dump` in reverse.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { encodePack, parseXml, type Override, type Profile } from "@p1p/core";
import type { PatchManifest } from "@p1p/core";

interface ManifestXml {
  patch: {
    "@id": string; "@version"?: string; "@game": string;
    name?: { "#text"?: string };
    description?: { "#text"?: string };
    "@priority"?: string;
  };
}

/** List all .xml files under a directory (recursive), relative to that directory. */
function listXml(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const ent of readdirSync(d)) {
      const full = join(d, ent);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (ent.endsWith(".xml")) {
        out.push(relative(dir, full).replace(/\\/g, "/"));
      }
    }
  };
  try { walk(dir); } catch { /* dir may not exist */ }
  return out;
}

export function compile(
  profile: Profile,
  patchDir: string,
  outFile: string,
  log: (m: string) => void,
): void {
  // Parse patch.xml manifest.
  const manifestPath = join(patchDir, "patch.xml");
  const manifestXml = (parseXml(readFileSync(manifestPath, "utf8")) as unknown as ManifestXml).patch;
  const manifest: PatchManifest = {
    id: manifestXml["@id"],
    game: manifestXml["@game"],
    name: String(manifestXml.name?.["#text"] ?? manifestXml["@id"]),
    description: manifestXml.description?.["#text"],
    version: manifestXml["@version"],
    priority: manifestXml["@priority"] !== undefined ? Number(manifestXml["@priority"]) : undefined,
  };
  if (manifest.game !== profile.id) {
    throw new Error(`patch targets game "${manifest.game}", this profile is "${profile.id}"`);
  }

  // Collect all source .xml files, excluding the manifest itself.
  const allFiles = listXml(patchDir).filter((f) => f !== "patch.xml");

  const overrides: Override[] = [];
  for (const dt of profile.datatypes) {
    const mine = sourcesIn(dt, allFiles);
    for (const rel of mine) {
      const xml = readFileSync(join(patchDir, rel), "utf8");
      if (dt.parseFile) {
        // bundled: one file → many records
        const relToGroup = dt.group ? rel.slice(dt.group.length + 1) : rel;
        for (const [key, value] of dt.parseFile(relToGroup, xml)) {
          overrides.push({ datatype: dt.id, key, value });
        }
      } else {
        // per-record: one file → one record
        const { key, value } = dt.fromXml(xml);
        overrides.push({ datatype: dt.id, key, value });
      }
    }
    if (mine.length > 0) log(`  ${dt.id}: ${mine.length} source file(s)`);
  }

  const pack = encodePack({ manifest, overrides });
  writeFileSync(outFile, pack);
  log(`compiled ${overrides.length} override(s) → ${outFile} (${pack.length}B)`);
}

/**
 * Return the relPaths (relative to patch root) that a given datatype owns.
 * If the datatype exposes sourcesIn() we call that; otherwise we derive it from group + bundle shape.
 */
interface DtShape { id: string; group: string; parseFile?: unknown; sourcesIn?: (f: string[]) => string[] }
function sourcesIn(dt: DtShape, allFiles: string[]): string[] {
  if (dt.sourcesIn) return dt.sourcesIn(allFiles);
  const prefix = dt.group ? dt.group + "/" : "";
  if (dt.parseFile) {
    // Bundled: files directly inside the group (not recursive), excluding sub-paths.
    return allFiles.filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/"));
  }
  // Per-record: all xml under the group tree.
  return allFiles.filter((f) => f.startsWith(prefix) && f.endsWith(".xml"));
}

// Re-export so consumers can import only this file.
export { dirname, writeFileSync };
