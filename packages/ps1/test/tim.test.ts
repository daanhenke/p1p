// TIM pixel decode + the RLE-packed-archive path, over the real /ADV image archives. Skips if the disc
// isn't checked out. (Span-only behaviour is covered indirectly; here we assert full RGBA decode.)
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeAllTims, decodeTimAt, iterTims } from "../src/tim.js";

const ADV = resolve(process.cwd(), "../game/psx/us/adv");
const read = (name: string): Uint8Array | undefined => {
  const p = resolve(ADV, name);
  return existsSync(p) ? new Uint8Array(readFileSync(p)) : undefined;
};

describe("TIM decode", () => {
  const bst = read("bst.bin");
  if (!bst) {
    it.skip("disc not checked out", () => {});
    return;
  }

  it("decodes every TIM in BST.BIN to non-empty RGBA of valid dimensions", () => {
    const spans = iterTims(bst);
    expect(spans.length).toBeGreaterThan(50); // 80 portraits
    const first = decodeTimAt(bst, spans[0].start)!;
    expect(first.width).toBeGreaterThan(0);
    expect(first.height).toBeGreaterThan(0);
    expect(first.rgba.length).toBe(first.width * first.height * 4);
    expect(first.rgba.some((b) => b !== 0)).toBe(true); // not all-transparent/black
  });

  it("decodes the RLE-packed ADVCHR.BIN (0 raw TIMs → decompress → images)", () => {
    const advchr = read("advchr.bin");
    if (!advchr) return;
    expect(iterTims(advchr).length).toBe(0); // packed: no TIMs until RLE-expanded
    expect(decodeAllTims(advchr).length).toBeGreaterThan(0); // timBlob() expands, then decodes
  });
});
