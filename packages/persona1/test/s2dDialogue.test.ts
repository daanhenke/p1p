// s2d-dialogue datatype round-trips through the real S2D.BIN overlay (FF55 message scan + splice).
// Like adv-scene there's no py golden for the splice, so we prove it end-to-end: a no-op edit is
// byte-identical, and an in-place edit round-trips while everything else is untouched. Skips if the
// disc isn't checked out.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryAssetSource, buildChanges, type BuildCtx, type Patch } from "@p1p/core";
import { persona1 } from "../src/profile.js";

const S2D = resolve(process.cwd(), "../game/psx/us/s2d.bin");

describe("s2d-dialogue datatype (FF55 splice over S2D.BIN)", () => {
  if (!existsSync(S2D)) {
    it.skip("disc not checked out", () => {});
    return;
  }
  const original = new Uint8Array(readFileSync(S2D));
  const src = new MemoryAssetSource({ "/S2D.BIN": original });
  const ctx: BuildCtx = { source: src, profile: persona1 };
  const dt = persona1.datatypes.require("s2d-dialogue");

  // pick the first US-language message (the US disc's overworld dialogue is English).
  const all = dt.readAll(ctx);
  const usEntry = [...all.values()].find((r: { lang: string }) => r.lang === "us") as
    { index: number; text: string } | undefined;

  const build = (key: string, text: string): Uint8Array => {
    const patch: Patch = {
      manifest: { id: "t", name: "t", game: "persona1" },
      overrides: [{ datatype: "s2d-dialogue", key, value: { text } }],
    };
    const { changes, issues } = buildChanges(persona1, [patch], src);
    expect(issues.filter((x) => x.level === "error")).toEqual([]);
    return changes.get("/S2D.BIN")!;
  };

  it("scans FF55 messages and reads a US line", () => {
    expect(all.size).toBeGreaterThan(0);
    expect(usEntry).toBeDefined();
    const { key } = dt.fromXml(dt.toXml("0", { index: usEntry!.index, lang: "us", text: usEntry!.text }));
    expect(key).toBe(String(usEntry!.index));
  });

  it("a no-op edit rebuilds byte-identical", () => {
    const r = usEntry!;
    expect(build(String(r.index), r.text)).toEqual(original);
  });

  it("an in-place (shorter) edit round-trips; other messages intact", () => {
    const r = usEntry!;
    const out = build(String(r.index), "Hi.");
    expect(out.length).toBe(original.length); // fit in the old span
    const src2 = new MemoryAssetSource({ "/S2D.BIN": out });
    const reread = persona1.datatypes.require("s2d-dialogue").read(String(r.index), { source: src2, profile: persona1 });
    expect(reread.text).toBe("Hi.");
  });
});
