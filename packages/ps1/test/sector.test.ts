// Disc EDC/ECC parity vs the authoritative Python output (golden fixtures from tools/gen_web_fixtures.py).
import { describe, expect, it } from "vitest";
import { edcCompute, lbaToMsfBcd, makeMode1Sector, makeMode2Form1Sector } from "../src/sector.js";
import fx from "./fixtures/ecc.json";

const hex = (u: Uint8Array): string => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string): Uint8Array => {
  const m = s.match(/../g);
  return m ? Uint8Array.from(m, (h) => parseInt(h, 16)) : new Uint8Array(0);
};

describe("disc EDC/ECC (== py)", () => {
  it("edcCompute", () => {
    for (const c of fx.edc) expect(edcCompute(unhex(c.data))).toBe(c.edc);
  });

  it("lbaToMsfBcd", () => {
    for (const c of fx.msf) expect(hex(lbaToMsfBcd(c.lba))).toBe(c.bcd);
  });

  it("full sectors (mode1 + mode2/form1)", () => {
    for (const c of fx.sectors) {
      const sec = c.mode === 1
        ? makeMode1Sector(c.lba, unhex(c.data))
        : makeMode2Form1Sector(c.lba, unhex(c.data), c.last);
      expect(hex(sec)).toBe(c.sector);
    }
  });
});
