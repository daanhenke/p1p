// AssetSource backed by a loose folder of extracted game files (e.g. game/psx/us/), so the CLI can
// run datatypes without mounting the .bin. ISO paths ("/ADV/E0.BIN") map case-insensitively onto the
// folder (adv/e0.bin). For a full disc, a DiscImage from @p1p/ps1 is the alternative source.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { AssetSource } from "@p1p/core";

const norm = (p: string): string => "/" + p.replace(/\\/g, "/").replace(/^\/+/, "").split(";")[0].toUpperCase();

export class FolderAssetSource implements AssetSource {
  readonly describe: string;
  private readonly index = new Map<string, string>(); // normalised ISO path → absolute fs path

  constructor(private readonly root: string) {
    this.describe = `folder ${root}`;
    this.walk(root);
  }

  private walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { this.walk(full); } else {
        this.index.set(norm("/" + relative(this.root, full).split(sep).join("/")), full);
      }
    }
  }

  has(path: string): boolean { return this.index.has(norm(path)); }
  tryRead(path: string): Uint8Array | undefined {
    const fs = this.index.get(norm(path));
    return fs ? new Uint8Array(readFileSync(fs)) : undefined;
  }

  read(path: string): Uint8Array {
    const d = this.tryRead(path);
    if (!d) throw new Error(`asset not found: ${path}`);
    return d;
  }

  list(): string[] { return [...this.index.keys()]; }
}
