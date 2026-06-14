// Smoke test for `dump`: run it over a small in-memory source (SLUS + FONT.BIN) and assert it writes
// the expected XML source tree + a font atlas. Uses the real loose files (skips if absent) but only
// the two small ones, so the heavy scene parse doesn't run.
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { MemoryAssetSource } from "@p1p/core";
import { persona1 } from "../src/profile.js";
import { dump } from "@p1p/cli";

const SLUS = resolve(process.cwd(), "../game/psx/us/slus_003.39");
const FONT = resolve(process.cwd(), "../game/psx/us/font.bin");

describe("cli dump", () => {
  if (!existsSync(SLUS) || !existsSync(FONT)) {
    it.skip("disc not checked out", () => {});
    return;
  }
  it("extracts name/menu records + a font atlas", () => {
    const out = resolve(tmpdir(), "p1p-dump-smoke");
    rmSync(out, { recursive: true, force: true });
    const src = new MemoryAssetSource({
      "/SLUS_003.39": new Uint8Array(readFileSync(SLUS)),
      "/FONT.BIN": new Uint8Array(readFileSync(FONT)),
    });
    const r = dump(persona1, src, out, () => {});
    expect(r.records).toBeGreaterThan(200); // 186 demons + 57 personas (skills need BTLP, absent here)
    expect(r.fonts).toBe(1);
    expect(existsSync(resolve(out, "names/demons.xml"))).toBe(true); // bundled single file
    expect(existsSync(resolve(out, "names/personas.xml"))).toBe(true);
    expect(statSync(resolve(out, "gfx/font.png")).size).toBeGreaterThan(1000);
    rmSync(out, { recursive: true, force: true });
  });
});
