import { describe, it, expect } from "vitest";
import { ByteReader, ByteWriter, concat, fromHex, toBytesLE, toHex, u32le, writeUintLE } from "../src/bytes.js";
import { decodePack, encodePack } from "../src/pack.js";
import type { Patch } from "../src/patch.js";

describe("bytes", () => {
  it("round-trips LE ints and hex", () => {
    const b = toBytesLE(0x12345678, 4);
    expect(toHex(b)).toBe("78563412");
    expect(u32le(b, 0)).toBe(0x12345678);
    expect([...fromHex("de ad be ef")]).toEqual([0xde, 0xad, 0xbe, 0xef]);
    const buf = new Uint8Array(4);
    writeUintLE(buf, 0, 0x0a0b, 2);
    expect(toHex(buf)).toBe("0b0a0000");
  });

  it("reader/writer agree", () => {
    const w = new ByteWriter().u8(1).u16(0x0203).u32(0x04050607).bytes(Uint8Array.of(9, 10));
    const r = new ByteReader(w.toBytes());
    expect(r.u8()).toBe(1);
    expect(r.u16()).toBe(0x0203);
    expect(r.u32()).toBe(0x04050607);
    expect([...r.bytes(2)]).toEqual([9, 10]);
    expect(toHex(concat([Uint8Array.of(1), Uint8Array.of(2, 3)]))).toBe("010203");
  });
});

describe("patch pack", () => {
  it("encode/decode round-trips a patch", () => {
    const patch: Patch = {
      manifest: { id: "exp-multiplier", name: "EXP ×2", game: "persona1", priority: 10 },
      overrides: [
        { datatype: "code-patch", key: "exp-multiplier", value: { enabled: true, factor: 2 } },
        { datatype: "name-table", key: "demon/024", value: { name: "Jack Frost" } },
      ],
    };
    const round = decodePack(encodePack(patch));
    expect(round).toEqual(patch);
  });
});
