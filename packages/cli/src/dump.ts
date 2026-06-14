// `dump`: a full extract of a game's editable content into the XML source tree, plus the font atlas.
// Walks every datatype the profile registers (readAll → one XML file per record under its group), so
// the output is the complete authorable source for the disc (names, all string tables, dungeon / battle
// / overworld dialogue, every scene message, …). Additive datatypes (code-patch, exe-text) have no base
// records and contribute nothing here.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AssetSource, BuildCtx, Profile } from "@p1p/core";
import { decodeAllTims } from "@p1p/ps1";
import { SectorArchive } from "@p1p/atlus";
import { renderFontAtlas, writeRgbaPng } from "./png.js";

export interface DumpResult { records: number; files: number; fonts: number; tims: number }

export function dump(profile: Profile, source: AssetSource, outDir: string, log: (m: string) => void): DumpResult {
  const ctx: BuildCtx = { source, profile, log };
  let records = 0;
  let files = 0;
  let tims = 0;

  const write = (rel: string, content: string | Uint8Array): void => {
    const path = join(outDir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    files++;
  };

  for (const dt of profile.datatypes) {
    // let the datatype load any existing aux files (e.g. scene manifests) so naming carries over
    dt.loadAux?.((rel) => {
      const p = join(outDir, dt.group, rel);
      return existsSync(p) ? readFileSync(p, "utf8") : undefined;
    });
    let all;
    try {
      all = dt.readAll(ctx);
    } catch (e) {
      log(`  ${dt.id} (${dt.group}): skipped — ${(e as Error).message}`);
      continue;
    }
    // group records into files: a datatype's own layout (bundled), else one file per record
    const keys = [...all.keys()];
    const layout = dt.layout ? dt.layout(keys) : new Map(keys.map((k) => [dt.sourcePath(k), [k]]));
    for (const [rel, fileKeys] of layout) {
      const recs = new Map(fileKeys.map((k) => [k, all.get(k)!]));
      const content = dt.serializeFile ? dt.serializeFile(rel, recs) : dt.toXml(fileKeys[0], recs.get(fileKeys[0])!);
      write(join(dt.group, rel), content);
    }
    for (const [rel, content] of dt.auxFiles?.(ctx) ?? []) write(join(dt.group, rel), content);
    records += all.size;
    log(`  ${dt.id} (${dt.group}): ${all.size} record(s) → ${layout.size} file(s)`);
  }

  // font atlas (1bpp → PNG) under gfx/, if the source has it
  let fonts = 0;
  const font = source.tryRead("/FONT.BIN");
  if (font) {
    write(join("gfx", "font.png"), renderFontAtlas(font));
    log(`  gfx: font.png (${font.length}B → atlas)`);
    fonts++;
  }

  // gfx: every TIM in each known image archive → gfx/<isoPath>/<index>.png. Files are scanned directly
  // (RLE-expanded if needed); MES-style sector archives of (packed) TIM records fall back to per-record.
  for (const isoPath of (profile.data.gfx as string[] | undefined) ?? []) {
    const blob = source.tryRead(isoPath);
    if (!blob) continue;
    let imgs = decodeAllTims(blob);
    if (imgs.length === 0) {
      try {
        imgs = SectorArchive.fromBytes(blob).records.flatMap((r) => decodeAllTims(r));
      } catch { /* not a sector archive */ }
    }
    const dir = "gfx" + isoPath.toUpperCase(); // /ADV/ADVCMD.BIN → gfx/ADV/ADVCMD.BIN
    imgs.forEach((t, i) => write(join(dir, `${i}.png`), writeRgbaPng(t.width, t.height, t.rgba)));
    if (imgs.length) log(`  gfx ${isoPath}: ${imgs.length} TIM(s)`);
    tims += imgs.length;
  }

  return { records, files, fonts, tims };
}
