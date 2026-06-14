// Minimal MIPS R3000 (PSX) assembler for code-patch `asm=` attributes.
// Handles only single-instruction encodings — partial-word patches (width 1 or 2) still use `value`.
// Follows GAS/GNU syntax: destination register first, fields separated by commas or whitespace.
//
// Only produces one 32-bit word. Pseudo-instructions that expand to more than one instruction
// (e.g. `li` with a value > 0xffff) are deliberately omitted.

const REG: Record<string, number> = {
  zero: 0, at: 1, v0: 2, v1: 3, a0: 4, a1: 5, a2: 6, a3: 7,
  t0: 8, t1: 9, t2: 10, t3: 11, t4: 12, t5: 13, t6: 14, t7: 15,
  s0: 16, s1: 17, s2: 18, s3: 19, s4: 20, s5: 21, s6: 22, s7: 23,
  t8: 24, t9: 25, k0: 26, k1: 27, gp: 28, sp: 29, fp: 30, s8: 30, ra: 31,
};

function reg(s: string): number {
  const name = s.trim().replace(/^\$/, "").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(REG, name)) return REG[name];
  const n = parseInt(name, 10);
  if (!isNaN(n) && n >= 0 && n <= 31) return n;
  throw new Error(`unknown MIPS register: $${s.trim()}`);
}

function imm(s: string): number {
  const t = s.trim();
  const v = /^0[xX]/.test(t) ? parseInt(t, 16) : parseInt(t, 10);
  if (isNaN(v)) throw new Error(`invalid immediate: ${s}`);
  return v;
}

// R-type: funct rs rt rd sa
const R = (fn: number, rs: number, rt: number, rd: number, sa: number): number =>
  ((rs & 0x1f) << 21) | ((rt & 0x1f) << 16) | ((rd & 0x1f) << 11) | ((sa & 0x1f) << 6) | (fn & 0x3f);

// I-type: op rs rt imm
const I = (op: number, rs: number, rt: number, i: number): number =>
  ((op & 0x3f) << 26) | ((rs & 0x1f) << 21) | ((rt & 0x1f) << 16) | (i & 0xffff);

/**
 * Assemble one MIPS R3000 instruction text to a 32-bit word.
 * Throws on unsupported mnemonics, unknown registers, or out-of-range values.
 *
 * @example
 * assembleMips("sll $s0, $s0, 1")   // → 0x00108040  (x2 EXP shift)
 * assembleMips("ori $s0, $zero, 1") // → 0x34100001  (force contribution = 1)
 * assembleMips("nop")               // → 0x00000000
 */
export function assembleMips(text: string): number {
  const tokens = text.trim().split(/[\s,]+/).filter(Boolean);
  const mnem = tokens[0].toLowerCase();
  const a = tokens.slice(1);

  switch (mnem) {
    // Special
    case "nop": return 0;
    case "break": return R(0x0d, 0, 0, 0, 0);
    case "syscall": return R(0x0c, 0, 0, 0, 0);

    // Shifts: sll rd, rt, sa
    case "sll": return R(0x00, 0, reg(a[1]), reg(a[0]), imm(a[2]));
    case "srl": return R(0x02, 0, reg(a[1]), reg(a[0]), imm(a[2]));
    case "sra": return R(0x03, 0, reg(a[1]), reg(a[0]), imm(a[2]));

    // Variable shifts: sllv rd, rt, rs
    case "sllv": return R(0x04, reg(a[2]), reg(a[1]), reg(a[0]), 0);
    case "srlv": return R(0x06, reg(a[2]), reg(a[1]), reg(a[0]), 0);
    case "srav": return R(0x07, reg(a[2]), reg(a[1]), reg(a[0]), 0);

    // ALU R-type: op rd, rs, rt
    case "add": return R(0x20, reg(a[1]), reg(a[2]), reg(a[0]), 0);
    case "addu": return R(0x21, reg(a[1]), reg(a[2]), reg(a[0]), 0);
    case "sub": return R(0x22, reg(a[1]), reg(a[2]), reg(a[0]), 0);
    case "subu": return R(0x23, reg(a[1]), reg(a[2]), reg(a[0]), 0);
    case "and": return R(0x24, reg(a[1]), reg(a[2]), reg(a[0]), 0);
    case "or": return R(0x25, reg(a[1]), reg(a[2]), reg(a[0]), 0);
    case "xor": return R(0x26, reg(a[1]), reg(a[2]), reg(a[0]), 0);
    case "nor": return R(0x27, reg(a[1]), reg(a[2]), reg(a[0]), 0);
    case "slt": return R(0x2a, reg(a[1]), reg(a[2]), reg(a[0]), 0);
    case "sltu": return R(0x2b, reg(a[1]), reg(a[2]), reg(a[0]), 0);

    // Multiply/divide (no rd)
    case "mult": return R(0x18, reg(a[0]), reg(a[1]), 0, 0);
    case "multu": return R(0x19, reg(a[0]), reg(a[1]), 0, 0);
    case "div": return R(0x1a, reg(a[0]), reg(a[1]), 0, 0);
    case "divu": return R(0x1b, reg(a[0]), reg(a[1]), 0, 0);

    // HI/LO moves: mfhi/mflo rd
    case "mfhi": return R(0x10, 0, 0, reg(a[0]), 0);
    case "mflo": return R(0x12, 0, 0, reg(a[0]), 0);
    case "mthi": return R(0x11, reg(a[0]), 0, 0, 0);
    case "mtlo": return R(0x13, reg(a[0]), 0, 0, 0);

    // Jumps
    case "jr": return R(0x08, reg(a[0]), 0, 0, 0);
    case "jalr": return a.length === 1
      ? R(0x09, reg(a[0]), 0, 31, 0) // jalr rs  (rd defaults to $ra)
      : R(0x09, reg(a[1]), 0, reg(a[0]), 0); // jalr rd, rs

    // I-type ALU: op rt, rs, imm
    case "addi": return I(0x08, reg(a[1]), reg(a[0]), imm(a[2]));
    case "addiu": return I(0x09, reg(a[1]), reg(a[0]), imm(a[2]));
    case "slti": return I(0x0a, reg(a[1]), reg(a[0]), imm(a[2]));
    case "sltiu": return I(0x0b, reg(a[1]), reg(a[0]), imm(a[2]));
    case "andi": return I(0x0c, reg(a[1]), reg(a[0]), imm(a[2]));
    case "ori": return I(0x0d, reg(a[1]), reg(a[0]), imm(a[2]));
    case "xori": return I(0x0e, reg(a[1]), reg(a[0]), imm(a[2]));
    case "lui": return I(0x0f, 0, reg(a[0]), imm(a[1]));

    // Pseudos that fit in one word
    case "nop2": return R(0x00, 0, 0, 0, 0); // same as nop, alias
    case "move": return R(0x25, reg(a[1]), 0, reg(a[0]), 0); // or rd, rs, $zero
    case "li": return I(0x0d, 0, reg(a[0]), imm(a[1])); // ori rt, $zero, N (N ≤ 0xffff)
    case "not": return R(0x27, reg(a[1]), 0, reg(a[0]), 0); // nor rd, rs, $zero

    default: throw new Error(`unsupported MIPS mnemonic: ${mnem}`);
  }
}
