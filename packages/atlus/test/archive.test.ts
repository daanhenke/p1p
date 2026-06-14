// SectorArchive parity vs the authoritative Python output (golden fixtures).
import { describe, expect, it } from "vitest";
import { SectorArchive } from "../src/archive.js";
import fx from "./fixtures/archive.json";

const hex = (u: Uint8Array): string => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string): Uint8Array => {
  const m = s.match(/../g);
  return m ? Uint8Array.from(m, (h) => parseInt(h, 16)) : new Uint8Array(0);
};

describe("SectorArchive (== py)", () => {
  const records = fx.records.map(unhex);

  it("rebuild() -> same blob + table + exe table", () => {
    const arc = new SectorArchive([], records);
    const { blob, table } = arc.rebuild();
    expect(hex(blob)).toBe(fx.rebuilt);
    expect(table).toEqual(fx.table);
    expect(hex(arc.makeExeTableBytes())).toBe(fx.exe_table);
  });

  it("fromBytes() round-trips the rebuilt archive", () => {
    const parsed = SectorArchive.fromBytes(unhex(fx.rebuilt));
    expect(parsed.table).toEqual(fx.parsed_table);
    expect(parsed.records.map(hex)).toEqual(fx.parsed_records);
  });
});
