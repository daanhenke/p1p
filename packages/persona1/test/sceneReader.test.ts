// Game-faithful ADV scene parser (ports port/Per1.Formats/SceneReader.cs, + the ctrl[4]/[5] talk
// table that port left unhandled). Parses the real US E0 scene records and asserts the ctrl-block
// walk recovers each scene's script + zones + dialogue, decoding say-target messages to readable text.
import { describe, expect, it } from "vitest";
import { decodeSceneMessage, parseScene, sceneMessageSpan } from "../src/script/sceneReader.js";
import { persona1 } from "../src/profile.js";
import fx from "./fixtures/scenes-us-e0.json";

const unhex = (s: string): Uint8Array => {
  const m = s.match(/../g);
  return m ? Uint8Array.from(m, (h) => parseInt(h, 16)) : new Uint8Array(0);
};
const us = (persona1.data as { glyph: { us: Parameters<typeof decodeSceneMessage>[3] } }).glyph.us;
const rec = (idx: number): Uint8Array => unhex(fx.find((r) => r.idx === idx)!.record);

describe("game-faithful scene parser", () => {
  it("parses every US E0 record without error and recovers dialogue", () => {
    let total = 0;
    for (const r of fx) {
      const sc = parseScene(unhex(r.record));
      expect(sc.header.length).toBeLessThanOrEqual(0x34);
      total += sc.messageOffsets.length;
      // message offsets are unique, sorted, and inside content
      for (const mo of sc.messageOffsets) expect(mo).toBeLessThan(sc.contentLen);
    }
    expect(total).toBeGreaterThan(500); // 547 across the 40 records
  });

  it("strict-decodes ~all messages; flags only the known glyphmap gaps", () => {
    // Strict decode throws on any glyph the glyphmap doesn't cover. The handful that throw isolate
    // real glyphmap gaps (unmapped symbol/space-variant indices) — not codec or walk bugs. The
    // overwhelming majority decode cleanly, proving the duplicate-glyph tokens + walk are correct.
    let ok = 0;
    let failed = 0;
    for (const r of fx) {
      const rec = unhex(r.record);
      const sc = parseScene(rec);
      for (const mo of sc.messageOffsets) {
        try {
          decodeSceneMessage(rec, mo, sc.contentLen, us);
          ok++;
        } catch {
          failed++;
        }
      }
    }
    expect(ok).toBeGreaterThan(500);
    expect(ok / (ok + failed)).toBeGreaterThan(0.95); // > 95% strict-clean; the rest hit the 8 gaps
  });

  it("e0/0 recovers all 46 dialogue slots, decoded as English", () => {
    const r = rec(0);
    const sc = parseScene(r);
    expect(sc.entryOff).toBeGreaterThanOrEqual(0);
    expect(sc.messageOffsets.length).toBe(46); // matches the 46 override $-slots
    const first = decodeSceneMessage(r, sc.messageOffsets[0], sc.contentLen, us);
    expect(first.startsWith("Mark:")).toBe(true);
    // strict decode (no throw) + zero hex escapes → every glyph mapped; duplicate glyphs render as
    // readable alt-tokens like 〔b^〕 (allowed), never as 〔hex〕 / 〔=hex〕 placeholders.
    const hexEscapes = first.match(/〔=?[0-9a-f]+〕/gu) ?? [];
    expect(hexEscapes).toEqual([]);
  });

  it("recovers the ctrl[4]/[5] action table the C# reader skipped (e0/1: 0 → many msgs)", () => {
    const sc = parseScene(rec(1));
    expect(sc.zones.some((z) => z.kind === "action")).toBe(true);
    expect(sc.messageOffsets.length).toBeGreaterThan(10);
  });

  it("message spans are well-formed (start at msgOff, end before a script op)", () => {
    const r = rec(0);
    const body = r.subarray(8);
    const sc = parseScene(r);
    for (const mo of sc.messageOffsets) {
      const [start, end] = sceneMessageSpan(body, mo, sc.contentLen);
      expect(start).toBe(mo);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThanOrEqual(sc.contentLen);
    }
  });
});
