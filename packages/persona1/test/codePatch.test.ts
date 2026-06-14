// The code-patch datatype flowing through the full build pipeline: an *additive* patch (no disc base)
// whose one record's sites are scanned + written over the host file via buildChanges/merge/apply.
import { describe, expect, it } from "vitest";
import { MemoryAssetSource, buildChanges, type Patch } from "@p1p/core";
import { persona1 } from "../src/profile.js";

describe("code-patch through buildChanges (additive)", () => {
  it("scans the anchor and writes the LE value over the host file", () => {
    const host = new Uint8Array([0x00, 0x27, 0xbd, 0xff, 0xe0, 0x99]);
    const src = new MemoryAssetSource({ "/BTLP.BIN": host });
    const patch: Patch = {
      manifest: { id: "exp-x2", name: "EXP x2", game: "persona1" },
      overrides: [{
        datatype: "code-patch",
        key: "exp-multiplier-x2",
        value: {
          id: "exp-multiplier-x2", name: "EXP x2",
          sites: [{ file: "/BTLP.BIN", anchor: "27 bd ?? e0", offset: 2, width: 2, value: 0x40 }],
        },
      }],
    };
    const { changes, issues } = buildChanges(persona1, [patch], src);
    expect(issues).toEqual([]);
    expect([...changes.get("/BTLP.BIN")!]).toEqual([0x00, 0x27, 0xbd, 0x40, 0x00, 0x99]);
    expect([...host]).toEqual([0x00, 0x27, 0xbd, 0xff, 0xe0, 0x99]); // original buffer untouched
  });
});
