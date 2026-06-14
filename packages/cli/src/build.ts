// `build`: load a disc image + one or more compiled patch packs, layer them with the build engine,
// and write a patched .bin disc image. The inverse of manual patching the old way.
//
// Multi-disc: when the profile declares `data.secondaryPaths` and a `--jp` (secondary) disc is given,
// those ISO paths are read from the secondary disc (e.g. P1's scene archives come from the JP disc)
// while the primary `--disc` is the image actually rebuilt.

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { buildChanges, decodePack, RoutingAssetSource, type AssetSource, type Profile } from "@p1p/core";
import { DiscImage } from "@p1p/ps1";

export function build(
  profile: Profile,
  discPath: string,
  packPaths: string[],
  outPath: string,
  log: (m: string) => void,
  jpPath?: string,
): void {
  const disc = new DiscImage(new Uint8Array(readFileSync(discPath)), discPath);
  log(`build: ${profile.name} — disc ${discPath} (${disc.nSectors} sectors)`);

  // Route the profile's secondary-disc paths (scenes) to the JP disc when supplied.
  let source: AssetSource = disc;
  const secondaryPaths = (profile.data.secondaryPaths as string[] | undefined) ?? [];
  if (jpPath && secondaryPaths.length) {
    const jp = new DiscImage(new Uint8Array(readFileSync(jpPath)), jpPath);
    source = new RoutingAssetSource(disc, jp, secondaryPaths);
    log(`  secondary: ${jpPath} (${jp.nSectors} sectors) — ${secondaryPaths.length} path(s) routed: ${secondaryPaths.join(", ")}`);
  } else if (secondaryPaths.length) {
    log(`  note: profile expects a secondary disc (--jp) for ${secondaryPaths.join(", ")}; using --disc for those too`);
  }

  const patches = packPaths.map((p) => {
    const pack = decodePack(new Uint8Array(readFileSync(p)));
    log(`  patch: ${pack.manifest.id} v${pack.manifest.version ?? "?"} (${pack.overrides.length} overrides)`);
    return pack;
  });

  const { changes, issues } = buildChanges(profile, patches, source, log);

  const errors = issues.filter((x) => x.level === "error");
  if (errors.length) {
    for (const e of errors) log(`  ERROR [${e.datatype ?? "?"}/${e.key ?? "?"}]: ${e.message}`);
    throw new Error(`build failed: ${errors.length} error(s)`);
  }
  for (const w of issues.filter((x) => x.level === "warn")) {
    log(`  WARN [${w.datatype ?? "?"}/${w.key ?? "?"}]: ${w.message}`);
  }

  const buildLog: string[] = [];
  const { image } = disc.buildPatched(changes, buildLog);
  for (const l of buildLog) log(l);

  writeFileSync(outPath, image);

  // Emit the matching .cue sheet so the output is a complete cue+bin image (single MODE2/2352 data
  // track, like the source disc). The FILE line points at the .bin's basename (same directory).
  const binName = basename(outPath);
  const cuePath = outPath.replace(/\.[^./\\]+$/, "") + ".cue";
  writeFileSync(cuePath, `FILE "${binName}" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n`);

  log(`done: ${outPath} (${image.length}B, ${changes.size} file(s) changed) + ${basename(cuePath)}`);
}
