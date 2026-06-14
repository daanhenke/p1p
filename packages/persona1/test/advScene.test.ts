// adv-scene round-trips through the real E0.BIN as ONE record per scene with partial overrides. No py
// golden exists for the text-splice, so we prove it against the game-faithful parser: a no-op (re-apply
// the scene's own messages) is byte-identical, a partial override (one message) edits in place / grows,
// and other messages stay intact. Skips if the disc isn't checked out.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryAssetSource, buildChanges, type BuildCtx, type Patch } from "@p1p/core";
import { SectorArchive } from "@p1p/atlus";
import { decodeSceneMessage, parseScene } from "../src/script/sceneReader.js";
import { persona1 } from "../src/profile.js";

const E0 = resolve(process.cwd(), "../game/psx/us/adv/e0.bin");

describe("adv-scene datatype (one file per scene, partial overrides)", () => {
  if (!existsSync(E0)) {
    it.skip("disc not checked out", () => {});
    return;
  }
  const original = new Uint8Array(readFileSync(E0));
  const src = new MemoryAssetSource({ "/ADV/E0.BIN": original });
  const ctx: BuildCtx = { source: src, profile: persona1 };
  const dt = persona1.datatypes.require("adv-scene");
  const glyph = (persona1.data as { glyph: { us: Parameters<typeof decodeSceneMessage>[3] } }).glyph.us;

  const sc0 = parseScene(SectorArchive.fromBytes(original).records[0]);
  const [msg0, msg1] = sc0.messageOffsets;

  const sceneTexts = (e0: Uint8Array): string[] => {
    const rec = SectorArchive.fromBytes(e0).records[0];
    const sc = parseScene(rec);
    return sc.messageOffsets.map((mo) => decodeSceneMessage(rec, mo, sc.contentLen, glyph, false));
  };
  const buildPartial = (messages: { offset: number; text: string }[]): Uint8Array => {
    const patch: Patch = {
      manifest: { id: "t", name: "t", game: "persona1" },
      overrides: [{ datatype: "adv-scene", key: "e0/0", value: { messages } }],
    };
    const { changes, issues } = buildChanges(persona1, [patch], src);
    expect(issues.filter((x) => x.level === "error")).toEqual([]);
    return changes.get("/ADV/E0.BIN")!;
  };

  it("reads a whole scene (all messages + a script listing) and XML round-trips the key", () => {
    const rec = dt.read("e0/0", ctx);
    expect(rec.messages.length).toBe(sc0.messageOffsets.length);
    expect(rec.messages[0].text.startsWith("Mark:")).toBe(true);
    expect(rec.script.length).toBeGreaterThan(0);
    const { key, value } = dt.fromXml(dt.toXml("e0/0", rec));
    expect(key).toBe("e0/0");
    // every message round-trips through the multiline source format byte-for-byte (explicit {nl} kept)
    expect(value.messages).toEqual(rec.messages.map((m) => ({ offset: m.offset, text: m.text })));
  });

  it("a no-op override (the scene's own messages) rebuilds byte-identical", () => {
    const own = dt.read("e0/0", ctx).messages;
    expect(buildPartial(own)).toEqual(original);
  });

  it("a partial override (one shorter message) edits in place; others intact", () => {
    const out = buildPartial([{ offset: msg0, text: "Test.{ret}" }]);
    expect(out.length).toBe(original.length);
    const after = sceneTexts(out);
    expect(after).toContain("Test.{ret}");
    expect(after).toContain(decodeSceneMessage(SectorArchive.fromBytes(original).records[0], msg1, sc0.contentLen, glyph, false));
  });

  it("a partial override (one grown message) appends + repoints, others intact", () => {
    const long = "Mark:  " + "a much longer rewritten line that cannot fit in place. ".repeat(80) + "{ret}";
    const msg1Text = decodeSceneMessage(SectorArchive.fromBytes(original).records[0], msg1, sc0.contentLen, glyph, false);
    const out = buildPartial([{ offset: msg0, text: long }]);
    expect(out.length).toBeGreaterThan(original.length);
    const after = sceneTexts(out);
    expect(after).toContain(long);
    expect(after).toContain(msg1Text);
  });
});
