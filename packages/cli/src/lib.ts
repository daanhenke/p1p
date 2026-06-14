// Generic p1p CLI library. Call runCli(profiles) with the game profiles you want to expose;
// persona1 calls runCli([persona1]) from its own bin entry point. The generic `p1p` binary calls
// runCli([]) and shows a usage hint pointing to the game-specific binary.

import { readFileSync } from "node:fs";
import { DiscImage } from "@p1p/ps1";
import type { AssetSource, Profile } from "@p1p/core";
import { FolderAssetSource } from "./folderSource.js";
import { dump } from "./dump.js";
import { compile } from "./compile.js";
import { build } from "./build.js";
import { join } from "node:path";

export { dump } from "./dump.js";
export { compile } from "./compile.js";
export { build } from "./build.js";

interface Args { _: string[]; opts: Record<string, string> }
function parseArgs(argv: string[]): Args {
  const _: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      _.push(a);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      opts[a.slice(2)] = "true";
    } else {
      opts[a.slice(2)] = next; i++;
    }
  }
  return { _, opts };
}

function loadSource(opts: Record<string, string>): AssetSource {
  if (opts.disc) return new DiscImage(new Uint8Array(readFileSync(opts.disc)), opts.disc);
  if (opts.root) return new FolderAssetSource(opts.root);
  throw new Error("provide --root <folder> or --disc <us.bin>");
}

function getProfile(profiles: Profile[], opts: Record<string, string>): Profile {
  const id = opts.profile ?? profiles[0]?.id;
  const p = profiles.find((x) => x.id === id);
  if (!p) {
    const names = profiles.map((x) => x.id).join(", ");
    throw new Error(`unknown profile "${id ?? "(none)"}"${names ? ` (have: ${names})` : ""}`);
  }
  return p;
}

const USAGE = (profiles: Profile[]): string => `p1p / persona1 CLI

Commands:
  dump     --root <dir>|--disc <us.bin> --out <dir> [--profile <id>]
           Full extract: every datatype's XML sources + font atlas + TIM images.

  compile  <patch-dir> [--out <file.bin>] [--profile <id>]
           Compile a patch directory to a distributable .bin pack.

  build    --disc <us.bin> --patches <a.bin,b.bin,...> --out <patched.bin> [--jp <jp.bin>] [--profile <id>]
           Layer patch packs over a disc image and write the result. --jp supplies a secondary disc
           the profile sources some files from (P1: scene archives from the JP disc).

Options:
  --root <dir>     loose game files (e.g. game/psx/us)
  --disc <file>    .bin disc image
  --out <dir/file> output path
  --profile <id>   game profile${profiles.length ? ` (default: ${profiles[0].id}, have: ${profiles.map((p) => p.id).join(", ")})` : " (none registered)"}`;

export function runCli(profiles: Profile[], argv: string[] = process.argv.slice(2)): void {
  const { _, opts } = parseArgs(argv);
  const cmd = _[0];
  const log = (m: string): void => console.error(m);

  try {
    if (cmd === "dump") {
      const profile = getProfile(profiles, opts);
      const out = opts.out ?? "sources";
      const source = loadSource(opts);
      log(`dump: ${profile.name} from ${source.describe} → ${out}`);
      const r = dump(profile, source, out, log);
      log(`done: ${r.records} records in ${r.files} files, ${r.fonts} font atlas, ${r.tims} TIMs`);
      return;
    }

    if (cmd === "compile") {
      const profile = getProfile(profiles, opts);
      const patchDir = _[1];
      if (!patchDir) throw new Error("compile: provide <patch-dir>");
      const outFile = opts.out ?? join(patchDir, "patch.bin");
      log(`compile: ${patchDir} → ${outFile}`);
      compile(profile, patchDir, outFile, log);
      return;
    }

    if (cmd === "build") {
      const profile = getProfile(profiles, opts);
      if (!opts.disc) throw new Error("build: provide --disc <us.bin>");
      if (!opts.out) throw new Error("build: provide --out <patched.bin>");
      const packPaths = (opts.patches ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!packPaths.length) throw new Error("build: provide --patches <a.bin,...>");
      build(profile, opts.disc, packPaths, opts.out, log, opts.jp);
      return;
    }

    console.error(USAGE(profiles));
    process.exit(cmd ? 1 : 0);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  }
}
