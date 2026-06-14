// The string-table mechanism is now exercised through the `skills` entity (name = btlp skill-names +
// the slus skill-menu copy @0x38a00). Renaming two skills must reproduce the same BTLP bytes as the
// Python skill-names repack (the golden), proving the pointer-table repack is intact.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryAssetSource, buildChanges, type BuildCtx, type Patch } from "@p1p/core";
import { persona1 } from "../src/profile.js";
import { encodeName } from "../src/datatypes/nameTable.js";

const glyph = (persona1.data as { glyph: { us: import("../src/text/glyph.js").Glyph } }).glyph.us;
const field = (name: string): number[] => [...encodeName(glyph, name, 0xc, false)]; // a 12B menu field

const BTLP = resolve(process.cwd(), "../game/psx/us/btlp.bin");
const SLUS = resolve(process.cwd(), "../game/psx/us/slus_003.39");
const GOLDEN = "d6c60f42c2de3e55556c4af811f5807840a392767adcdfba05c730993f58bef4";
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const MENU = 0x38a00; // slus skill-menu table: stride 0x14, name @+4, 12B field
const menuName = (slus: Uint8Array, i: number): number[] =>
  [...slus.subarray(MENU + i * 0x14 + 4, MENU + i * 0x14 + 4 + 0xc)];

describe("skills entity (string-table repack == py)", () => {
  if (!existsSync(BTLP) || !existsSync(SLUS)) {
    it.skip("disc not checked out", () => {});
    return;
  }
  const src = new MemoryAssetSource({
    "/BTLP.BIN": new Uint8Array(readFileSync(BTLP)),
    "/SLUS_003.39": new Uint8Array(readFileSync(SLUS)),
  });
  const ctx: BuildCtx = { source: src, profile: persona1 };
  const dt = persona1.datatypes.require("skills");

  it("reads a skill's name (no description — skills are name-only)", () => {
    const rec = dt.read("1", ctx);
    expect(rec.name).toBe("Fire");
    const { key, value } = dt.fromXml(dt.toXml("1", rec));
    expect(key).toBe("1");
    expect(value).toEqual({ name: "Fire" }); // no menu (it fits) and no desc
  });

  it("renaming two skills rebuilds BTLP byte-identical to py", () => {
    const patch: Patch = {
      manifest: { id: "t", name: "t", game: "persona1" },
      overrides: [
        { datatype: "skills", key: "1", value: { name: "Agi" } },
        { datatype: "skills", key: "25", value: { name: "Frei" } },
      ],
    };
    const { changes, issues } = buildChanges(persona1, [patch], src);
    expect(issues).toEqual([]);
    expect(sha(changes.get("/BTLP.BIN")!)).toBe(GOLDEN); // BTLP skill-names == the original py repack
    // the inline skill-name copy (slus skill-menu table @0x38a00, name @+4) is patched too
    const slus = changes.get("/SLUS_003.39")!;
    expect(menuName(slus, 1).slice(0, 4)).toEqual([0xa6, 0x37, 0x39, 0xff]); // "Agi" + FF terminator
  });

  it("auto-abbreviates a too-long menu name; <menu> overrides it", () => {
    const auto: Patch = {
      manifest: { id: "a", name: "a", game: "persona1" },
      overrides: [{ datatype: "skills", key: "1", value: { name: "Omega Cluster" } }], // 13B > 12B field
    };
    const slusAuto = buildChanges(persona1, [auto], src).changes.get("/SLUS_003.39")!;
    // skill-menu holds the space-stripped form "OmegaCluster" (12 chars, exactly fills the field)
    expect(menuName(slusAuto, 1)).toEqual(field("OmegaCluster"));

    const override: Patch = {
      manifest: { id: "o", name: "o", game: "persona1" },
      overrides: [{ datatype: "skills", key: "1", value: { name: "Omega Cluster", menu: "Omega" } }],
    };
    const slusOv = buildChanges(persona1, [override], src).changes.get("/SLUS_003.39")!;
    expect(menuName(slusOv, 1)).toEqual(field("Omega")); // <menu> override wins
  });
});
