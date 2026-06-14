// Code-patch mechanism (mirrors py tests/test_code_patch.py + web codePatch.test.ts) and the
// datatype's XML round-trip.
import { describe, expect, it } from "vitest";
import {
  CodePatchDatatype, applySite, findUnique, parseAnchor, resolveSiteValue,
  type CodePatchRecord, type PatchSite,
} from "../src/codePatch.js";

describe("code-patch mechanism", () => {
  it("parses wildcards and writes LE values", () => {
    const { pat, mask } = parseAnchor("1f ?? 80");
    expect([...pat]).toEqual([0x1f, 0, 0x80]);
    expect([...mask]).toEqual([0xff, 0, 0xff]);
    const data = new Uint8Array([0xaa, 0x27, 0xbd, 0xff, 0xe0, 0xbb]);
    const site: PatchSite = { file: "x", anchor: "27 bd ?? e0", offset: 2, width: 2, value: 0x40 };
    const log = applySite(data, site);
    expect([...data]).toEqual([0xaa, 0x27, 0xbd, 0x40, 0x00, 0xbb]);
    expect(log).toContain("-> 64");
  });

  it("refuses not-found and ambiguous", () => {
    expect(applySite(new Uint8Array([0, 1, 2]), { file: "x", anchor: "de ad", offset: 0, width: 1, value: 9 }))
      .toContain("not found");
    const amb = new Uint8Array([0x10, 0, 0x10, 0]);
    expect(applySite(amb, { file: "x", anchor: "10 00", offset: 0, width: 1, value: 9 })).toContain("ambiguous");
    expect([...amb]).toEqual([0x10, 0, 0x10, 0]); // unchanged
    expect(findUnique(amb, parseAnchor("10 00").pat, parseAnchor("10 00").mask)).toBe(-2);
  });
});

describe("code-patch datatype XML round-trip", () => {
  const dt = new CodePatchDatatype();

  it("toXml -> fromXml is identity", () => {
    const model: CodePatchRecord = {
      id: "exp-multiplier-x2",
      name: "EXP ×2",
      description: "Double battle EXP",
      sites: [
        { file: "/BTLP.BIN", anchor: "27 bd ?? e0", offset: 2, width: 2, value: 0x40 },
        { file: "/BTLP.BIN", anchor: "de ad be ef", offset: 0, width: 1, value: 3 },
      ],
    };
    const { key, value } = dt.fromXml(dt.toXml("exp-multiplier-x2", model));
    expect(key).toBe("exp-multiplier-x2");
    expect(value).toEqual(model);
  });

  it("parses a single-site patch (one <site>, not an array)", () => {
    const xml = dt.toXml("k", { id: "k", name: "k", sites: [
      { file: "/A.BIN", anchor: "00 11", offset: 0, width: 1, value: 1 },
    ] });
    const { value } = dt.fromXml(xml);
    expect(value.sites).toHaveLength(1);
    expect(value.sites?.[0]).toEqual({ file: "/A.BIN", anchor: "00 11", offset: 0, width: 1, value: 1 });
  });

  it("round-trips embedded settings + tuned sites and defaults the site value to the default option", () => {
    const model: CodePatchRecord = {
      id: "exp-multiplier",
      name: "EXP multiplier",
      settings: [{
        id: "exp-multiplier", label: "EXP multiplier", default: "x2",
        options: [{ value: "x2", label: "2×" }, { value: "x4", label: "4×" }],
      }],
      sites: [
        { file: "/BTLP.BIN", anchor: "00 11", offset: 0, width: 4, value: 2, setting: "exp-multiplier", cases: { x2: 2, x4: 4 } },
      ],
    };
    const { value } = dt.fromXml(dt.toXml("exp-multiplier", model));
    expect(value).toEqual(model);
    const site = value.sites![0];
    expect(resolveSiteValue(site)).toBe(2); // no selection → default option
    expect(resolveSiteValue(site, { "exp-multiplier": "x4" })).toBe(4);
    expect(resolveSiteValue(site, { "exp-multiplier": "nope" })).toBe(2); // unknown → default
  });
});
