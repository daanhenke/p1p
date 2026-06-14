import { describe, expect, it } from "vitest";
import { assembleMips } from "../src/mipsAsm.js";

describe("assembleMips", () => {
  it("nop → 0", () => expect(assembleMips("nop")).toBe(0));

  it("shift instructions", () => {
    // sll $s0, $s0, 1 — the exp-multiplier x2 patch
    expect(assembleMips("sll $s0, $s0, 1")).toBe(0x00108040);
    expect(assembleMips("sll $s0, $s0, 2")).toBe(0x00108080); // x4
    expect(assembleMips("sll $s0, $s0, 3")).toBe(0x001080c0); // x8
    expect(assembleMips("srl $t0, $t1, 4")).toBe(0x00094102);
    expect(assembleMips("sra $a0, $a0, 1")).toBe(0x00042043);
  });

  it("ori — exp-share-even patch", () => {
    // ori $s0, $zero, 1 — force per-member contribution to 1
    expect(assembleMips("ori $s0, $zero, 1")).toBe(0x34100001);
    expect(assembleMips("ori $v0, $v0, 0xff")).toBe(0x344200ff);
  });

  it("li pseudo (ori $rt, $zero, N)", () => {
    expect(assembleMips("li $s0, 1")).toBe(0x34100001);
  });

  it("move pseudo (or $rd, $rs, $zero)", () => {
    expect(assembleMips("move $a0, $s0")).toBe(0x02002025);
  });

  it("R-type ALU", () => {
    expect(assembleMips("addu $s0, $s0, $a0")).toBe(0x02048021);
    expect(assembleMips("or $v0, $a0, $a1")).toBe(0x00851025);
  });

  it("I-type ALU", () => {
    expect(assembleMips("addiu $sp, $sp, -8")).toBe(0x27bdfff8);
    expect(assembleMips("lui $at, 0x8000")).toBe(0x3c018000);
  });

  it("jr $ra (function return)", () => {
    expect(assembleMips("jr $ra")).toBe(0x03e00008);
  });

  it("accepts bare register numbers", () => {
    expect(assembleMips("sll $16, $16, 1")).toBe(0x00108040);
  });

  it("tolerates extra whitespace and mixed separators", () => {
    expect(assembleMips("  sll   $s0 ,  $s0 , 1  ")).toBe(0x00108040);
  });

  it("throws on unknown mnemonic", () => {
    expect(() => assembleMips("foo $s0, $s0")).toThrow("unsupported MIPS mnemonic");
  });

  it("throws on unknown register", () => {
    expect(() => assembleMips("sll $s99, $s0, 1")).toThrow("unknown MIPS register");
  });

  it("was the bug: wrong encoding that produced a NOP", () => {
    // The old patch value 0x00180040 = sll $zero, $t8, 1 (writes to $zero → discarded)
    const badEncoding = 0x00180040;
    const badDecoded = { rd: (badEncoding >> 11) & 0x1f, rt: (badEncoding >> 16) & 0x1f };
    expect(badDecoded.rd).toBe(0); // $zero — write discarded
    expect(badDecoded.rt).toBe(24); // $t8 — wrong source register
    // The correct encoding
    expect(assembleMips("sll $s0, $s0, 1")).toBe(0x00108040);
    expect(assembleMips("sll $s0, $s0, 1")).not.toBe(badEncoding);
  });
});
