// Full-pipeline parity for the name-table datatype: read the loose US SLUS, run it through
// parse → model → XML round-trip → patch-merge → build, and assert the output matches the existing
// Python `tables.repack` (golden SHA from src/persona1/tables.py). Skips if the disc isn't checked out.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryAssetSource, buildChanges, type BuildCtx, type Patch } from "@p1p/core";
import { persona1 } from "../src/profile.js";

const SLUS = resolve(process.cwd(), "../game/psx/us/slus_003.39");
const GOLDEN_DEMON24_FROST = "2e0d2440af8fd3e7c206fba21e786a0502f308ea853d9932a20a38d24c4bdf4b";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("name-table datatype (== py tables.repack)", () => {
  if (!existsSync(SLUS)) {
    it.skip("disc not checked out", () => {});
    return;
  }
  const src = new MemoryAssetSource({ "/SLUS_003.39": new Uint8Array(readFileSync(SLUS)) });
  const ctx: BuildCtx = { source: src, profile: persona1 };
  const dt = persona1.datatypes.require("name-table");

  it("reads a record game-faithfully (name + stats)", () => {
    const rec = dt.read("demon/024", ctx);
    expect(rec.name).toBe("JackFrost");
    expect(rec.stats).toMatchObject({ level: 8, strength: 5, vitality: 9, dexterity: 10, agility: 20, luck: 16 });
  });

  it("round-trips toXml → fromXml", () => {
    const rec = dt.read("demon/024", ctx);
    const { key, value } = dt.fromXml(dt.toXml("demon/024", rec));
    expect(key).toBe("demon/024");
    expect(value).toEqual({ name: "JackFrost" });
  });

  it("flags a name that overflows the field", () => {
    const rec = dt.read("demon/024", ctx);
    expect(dt.validate("demon/024", { ...rec, name: "WayTooLongName" }, ctx)).toHaveLength(1);
  });

  it("builds a renamed SLUS byte-identical to py", () => {
    const patch: Patch = {
      manifest: { id: "t", name: "t", game: "persona1" },
      overrides: [{ datatype: "name-table", key: "demon/024", value: { name: "Frost" } }],
    };
    const { changes, issues } = buildChanges(persona1, [patch], src);
    expect(issues).toEqual([]);
    expect(sha(changes.get("/SLUS_003.39")!)).toBe(GOLDEN_DEMON24_FROST);
  });
});
