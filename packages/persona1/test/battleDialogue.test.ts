// Full-pipeline parity for the battle-dialogue datatype: read the real US BTLP.BIN + its committed
// override, push every edited line through the datatype, and assert the rebuilt overlay's SHA-256
// equals the Python btl.repack output. Skips if the loose disc files aren't checked out.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryAssetSource, buildChanges, type Patch } from "@p1p/core";
import { persona1 } from "../src/profile.js";

const ROOT = resolve(process.cwd(), "..");
const BTLP = resolve(ROOT, "game/psx/us/btlp.bin");
const OVERRIDE = resolve(ROOT, "btl/override/text.txt");
const PY_SHA256 = "50532f1d276fe5a6a42e7e27284ac5b1d1d474f562920a465a75295ddf900962";
const LINE = /^\$([0-9a-fA-F]+)\s+\d+\s*\|\s?(.*)$/;

describe("battle-dialogue datatype (== py btl.repack)", () => {
  if (!existsSync(BTLP) || !existsSync(OVERRIDE)) {
    it.skip("disc not checked out", () => {});
    return;
  }
  const data = new Uint8Array(readFileSync(BTLP));
  const src = new MemoryAssetSource({ "/BTLP.BIN": data });

  const edits = new Map<string, string>();
  for (const raw of readFileSync(OVERRIDE, "utf8").split("\n")) {
    const m = LINE.exec(raw.replace(/\r$/, ""));
    if (m) edits.set(m[1], m[2]);
  }

  it("loads the committed override (60 lines)", () => {
    expect(edits.size).toBe(60);
  });

  it("reads a line + XML round-trips", () => {
    const [offHex] = [...edits.keys()];
    const rec = persona1.datatypes.require("battle-dialogue").read(offHex, { source: src, profile: persona1 });
    expect(rec).toBeDefined();
    const dt = persona1.datatypes.require("battle-dialogue");
    const { key } = dt.fromXml(dt.toXml(offHex, rec));
    expect(parseInt(key, 16)).toBe(parseInt(offHex, 16)); // canonical key is unpadded hex
    expect(persona1.datatypes.require("battle-dialogue").read(key, { source: src, profile: persona1 })).toBeDefined();
  });

  it("repacks US BTLP.BIN byte-identical to py", () => {
    const patch: Patch = {
      manifest: { id: "btl", name: "btl", game: "persona1" },
      overrides: [...edits].map(([offHex, text]) => ({ datatype: "battle-dialogue", key: offHex, value: { text } })),
    };
    const { changes, issues } = buildChanges(persona1, [patch], src);
    expect(issues.filter((x) => x.level === "error")).toEqual([]);
    expect(createHash("sha256").update(changes.get("/BTLP.BIN")!).digest("hex")).toBe(PY_SHA256);
  });
});
