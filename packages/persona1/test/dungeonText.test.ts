// Full-pipeline parity for the dungeon-text datatype: take the real D18.BIN + the legacy text.txt
// override, run every edited slot through read → merge → apply, and assert the rebuilt file is
// byte-identical to the Python `dungeon.repack` golden output.
import { describe, expect, it } from "vitest";
import { MemoryAssetSource, buildChanges, type BuildCtx, type Patch } from "@p1p/core";
import { persona1 } from "../src/profile.js";
import fx from "./fixtures/dungeon-d18.json";

const unhex = (s: string): Uint8Array => {
  const m = s.match(/../g);
  return m ? Uint8Array.from(m, (h) => parseInt(h, 16)) : new Uint8Array(0);
};
const hex = (u: Uint8Array): string => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

// The legacy "$N\n<lines>" override format (migration input) → Map<slot, text>.
function loadTextFile(txt: string): Map<number, string> {
  const res = new Map<number, string>();
  let cur: number | null = null;
  let buf: string[] = [];
  const flush = (): void => {
    if (cur === null) return;
    const lines = buf.slice();
    while (lines.length && lines[0] === "") lines.shift();
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    res.set(cur, lines.map((ln) => (ln.trim() === "{nl}" ? "" : ln)).join("{nl}"));
  };
  for (const raw of txt.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const m = /^\$(\d+)\b/.exec(line.trim());
    if (m) {
      flush();
      cur = Number(m[1]);
      buf = [];
    } else if (cur !== null) { buf.push(line); }
  }
  flush();
  return res;
}

const HOST = "/D03/D18.BIN";

describe("dungeon-text datatype (== py dungeon.repack)", () => {
  const d18 = fx.d18;
  const src = new MemoryAssetSource({ [HOST]: unhex(d18.original) });
  const ctx: BuildCtx = { source: src, profile: persona1 };
  const dt = persona1.datatypes.require("dungeon-text");
  const edits = loadTextFile(d18.override);

  it("reads a slot body + XML round-trips", () => {
    const [firstIdx] = [...edits.keys()];
    const rec = dt.read(`d18/${firstIdx}`, ctx);
    expect(rec).toBeDefined();
    const { key, value } = dt.fromXml(dt.toXml(`d18/${firstIdx}`, rec));
    expect(key).toBe(`d18/${firstIdx}`);
    expect(typeof value.text).toBe("string");
  });

  it("builds a translated D18.BIN byte-identical to py", () => {
    const patch: Patch = {
      manifest: { id: "dng", name: "dng", game: "persona1" },
      overrides: [...edits].map(([i, text]) => ({ datatype: "dungeon-text", key: `d18/${i}`, value: { text } })),
    };
    const { changes, issues } = buildChanges(persona1, [patch], src);
    expect(issues.filter((x) => x.level === "error")).toEqual([]);
    expect(hex(changes.get(HOST)!)).toBe(d18.edited);
  });
});
