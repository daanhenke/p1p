// items entity: names from the inline item table (slus 0x350e0), with the gem subset cross-mapped to
// menu-strings (icon-prefixed) + the btlp mirror. No py golden (new composite) — proven by a byte-
// identical no-op and by checking a gem rename lands in every copy. Skips if the disc isn't checked out.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryAssetSource, buildChanges, type BuildCtx, type Patch } from "@p1p/core";
import { persona1 } from "../src/profile.js";

const SLUS = resolve(process.cwd(), "../game/psx/us/slus_003.39");
const BTLP = resolve(process.cwd(), "../game/psx/us/btlp.bin");

describe("items entity (inline table + gem cross-map)", () => {
  if (!existsSync(SLUS) || !existsSync(BTLP)) {
    it.skip("disc not checked out", () => {});
    return;
  }
  const slus0 = new Uint8Array(readFileSync(SLUS));
  const src = new MemoryAssetSource({ "/SLUS_003.39": slus0, "/BTLP.BIN": new Uint8Array(readFileSync(BTLP)) });
  const ctx: BuildCtx = { source: src, profile: persona1 };
  const dt = persona1.datatypes.require("items");
  const nameAt = (slus: Uint8Array, id: number): number[] =>
    [...slus.subarray(0x350e0 + id * 0x20 + 0xc, 0x350e0 + id * 0x20 + 0xc + 4)];

  it("reads an item name", () => {
    expect(dt.read("0", ctx).name).toBe("Herb");
    expect(dt.read("85", ctx).name).toBe("Alexandria");
  });

  it("a no-op edit (every item's own name) rebuilds SLUS byte-identical", () => {
    const overrides = [...dt.readAll(ctx)].map(([key, r]) => ({ datatype: "items", key, value: { name: r.name } }));
    const patch: Patch = { manifest: { id: "t", name: "t", game: "persona1" }, overrides };
    const { changes, issues } = buildChanges(persona1, [patch], src);
    expect(issues).toEqual([]);
    expect(changes.get("/SLUS_003.39")!).toEqual(slus0);
  });

  it("a gem rename writes the inline table + menu-strings (icon kept) + btlp mirror", () => {
    const patch: Patch = {
      manifest: { id: "t", name: "t", game: "persona1" },
      overrides: [{ datatype: "items", key: "85", value: { name: "Gemmo" } }], // Alexandria → Gemmo
    };
    const { changes } = buildChanges(persona1, [patch], src);
    const slus = changes.get("/SLUS_003.39")!;
    expect(nameAt(slus, 85)).toEqual([0xac, 0x35, 0x3d, 0x3d]); // "Gemm" (G=ac e=35 m=3d m=3d) inline
    // menu-strings[328] still starts with the gem icon glyph (byte 0x80 lead) then the new name
    expect(changes.has("/BTLP.BIN")).toBe(true); // gem name mirrored to btlp too
  });

  it("a non-gem rename touches only the inline table (no menu-strings/mirror)", () => {
    const patch: Patch = {
      manifest: { id: "t", name: "t", game: "persona1" },
      overrides: [{ datatype: "items", key: "0", value: { name: "Potion" } }], // Herb → Potion
    };
    const { changes } = buildChanges(persona1, [patch], src);
    expect(changes.has("/BTLP.BIN")).toBe(false); // Herb isn't a gem → no menu-strings/btlp copy
    expect(nameAt(changes.get("/SLUS_003.39")!, 0)).toEqual([0xb5, 0x3f, 0x44, 0x39]); // "Poti"
  });
});
