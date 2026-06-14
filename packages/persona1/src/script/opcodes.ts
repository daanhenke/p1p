// Script bytecode opcode model + operand schemas. Port of src/persona1/adv/opcodes.py.

// g_scriptOpcodeLenTable (raw, indexed by opcode byte; includes the FF prefix). 0x00..0x8F.
// prettier-ignore
export const OPLEN = Uint8Array.of(
  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
  4, 4, 8, 8, 4, 4, 8, 4, 4, 8, 4, 4, 8, 4, 8, 8, 8, 4, 4, 4, 8, 4, 8, 8, 12, 4, 8, 8, 8, 8, 12, 8,
  8, 4, 4, 4, 8, 8, 8, 8, 8, 12, 8, 4, 4, 4, 8, 4, 8, 8, 4, 4, 8, 8, 4, 4, 8, 8, 8, 4, 4, 4, 4, 4,
  4, 4, 4, 4, 12, 12, 4, 4, 4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 8, 4, 4, 8, 4, 4, 4,
  4, 4, 4, 4, 4, 4, 4, 8, 4, 4, 4, 4, 4, 4, 4, 4,
);

// Text-formatting control codes (0xFF nn, nn < 0x20) -> total length incl. 0xFF.
export const TEXT_CTRL_LEN: Record<number, number> = {
  0x01: 2, 0x02: 2, 0x03: 2, 0x04: 2, 0x05: 4, 0x06: 3, 0x07: 3, 0x08: 4,
  0x09: 4, 0x0a: 3, 0x0b: 3, 0x0c: 3, 0x0e: 3, 0x0f: 3, 0x10: 3,
};
export const TEXT_CTRL_LEN_DEFAULT = 2;
export const LINE_BREAKS = new Set<number>([0x01, 0x02, 0x03, 0x04, 0x21]);
export const END_CODES = new Set<number>([0x01, 0x21]);

// ftype -> [byte width, define namespace | null, render style]
export const FIELD: Record<string, [number, string | null, string]> = {
  u8: [1, null, "dec"], s8: [1, null, "signed"], u16: [2, null, "dec"], s16: [2, null, "signed"],
  u32: [4, null, "dec"], s32: [4, null, "signed"], addr: [4, null, "addr"], ptr: [4, null, "label"],
  flag: [2, "flag", "symhex"], actor: [1, "actor", "sym"], sys: [1, "syscmd", "sym"],
  port: [1, "portrait", "sym"], trans: [1, "transition", "sym"],
};

type Field = [string, string]; // [name, ftype]
export const SPEC: Record<number, [string, Field[]]> = {
  0x01: ["ret", []], 0x02: ["waitkey", []], 0x03: ["nl", []], 0x04: ["clearbox", []],
  0x05: ["wait_fr", [["frames", "u16"]]], 0x06: ["color", [["color", "u8"]]],
  0x07: ["ctl07", [["a", "u8"]]], 0x08: ["ctl08", [["a", "u16"]]], 0x09: ["ctl09", [["a", "u16"]]],
  0x0a: ["ctl0a", [["a", "u8"]]], 0x0b: ["ctl0b", [["a", "u8"]]], 0x0c: ["ctl0c", [["a", "u8"]]],
  0x0e: ["ctl0e", [["a", "u8"]]], 0x0f: ["ctl0f", [["a", "u8"]]], 0x10: ["ctl10", [["a", "u8"]]],
  0x11: ["ctl11", []], 0x12: ["ctl12", []], 0x20: ["nop", []], 0x21: ["end", []],
  0x22: ["jmp", [["_", "u16"], ["dst", "ptr"]]],
  0x23: ["rand_jmp", [["chance", "u8"], ["_", "u8"], ["dst", "ptr"]]],
  0x24: ["flag_set", [["flag", "flag"]]], 0x25: ["flag_clr", [["flag", "flag"]]],
  0x26: ["flag_jmp", [["flag", "flag"], ["dst", "ptr"]]],
  0x27: ["syscmd", [["cmd", "sys"], ["arg", "u8"]]],
  0x28: ["sel_yield", [["arg", "u8"], ["_", "u8"]]],
  0x29: ["msg", [["msg", "u16"], ["face", "port"], ["p1", "u8"], ["p2", "u8"], ["_", "u8"]]],
  0x2a: ["menu", []], 0x2b: ["scene_goto", [["scene", "u16"]]], // yield 1 -> Adv_StartSceneLoad(global scene idx)
  0x2c: ["msg_win", [["face", "port"], ["p1", "u8"], ["p2", "u8"], ["p3", "u8"], ["p4", "u8"], ["p5", "u8"]]],
  0x2d: ["yield6", [["arg", "u8"], ["_", "u8"]]],
  0x2e: ["var_jmp", [["val", "u8"], ["_", "u8"], ["dst", "ptr"]]],
  0x2f: ["actor_stat_jmp", [["actor", "actor"], ["thresh", "u8"], ["dst", "ptr"]]],
  0x30: ["actor_gone_jmp", [["actor", "actor"], ["_", "u8"], ["dst", "ptr"]]],
  0x31: ["actor_spawn", [["actor", "actor"]]], 0x32: ["actor_free", [["actor", "actor"]]],
  0x33: ["actor33", []], 0x34: ["actor_chk_jmp", [["_", "u16"], ["dst", "addr"]]],
  0x35: ["actor35", []], 0x36: ["actor_slot_jmp", [["actor", "actor"], ["_", "u8"], ["dst", "addr"]]],
  0x37: ["actor_hp_jmp", [["actor", "actor"], ["thresh", "u8"], ["dst", "addr"]]],
  0x38: ["actor_cmp_jmp", [["actor", "actor"], ["_", "u8"], ["val", "u32"], ["dst", "ptr"]]],
  0x39: ["actor_kill", [["actor", "actor"]]], 0x3a: ["stock_absent_jmp", [["_", "u16"], ["dst", "addr"]]],
  0x3b: ["stock_full_jmp", [["_", "u16"], ["dst", "addr"]]], 0x3c: ["stock_add", []], 0x3d: ["stock_set", []],
  0x3e: ["money_jmp", [["_", "u16"], ["val", "u32"], ["dst", "addr"]]],
  0x3f: ["money", [["sub", "u8"], ["_", "u8"], ["amount", "u32"]]],
  0x40: ["var40_jmp", [["val", "u8"], ["_", "u8"], ["dst", "addr"]]],
  0x41: ["var41_set", [["idx", "u8"], ["val", "u8"]]],
  0x42: ["actor_addexp", [["actor", "actor"], ["scale", "u8"]]],
  0x43: ["actor_addexp2", [["actor", "actor"], ["scale", "u8"]]],
  0x44: ["actor_fld_jmp", [["actor", "actor"], ["_", "u8"], ["dst", "addr"]]],
  0x45: ["actor_fld8_jmp", [["actor", "actor"], ["_", "u8"], ["dst", "addr"]]],
  0x46: ["actor_fld_jmp46", [["actor", "actor"], ["val", "u8"], ["dst", "ptr"]]],
  0x47: ["actor_fld_set_jmp", [["actor", "actor"], ["val", "u8"], ["dst", "addr"]]],
  0x48: ["actor_fld_clr_jmp", [["actor", "actor"], ["val", "u8"], ["dst", "addr"]]],
  0x49: ["actor_cmp2_jmp", [["actor", "actor"], ["_", "u8"], ["val", "u32"], ["dst", "ptr"]]],
  0x4a: ["actor_color", [["actor", "actor"], ["channel", "u8"], ["delta", "s8"], ["sub", "u8"]]],
  0x4b: ["menu4b", []], 0x4c: ["scene_init", []], 0x4d: ["wait", [["frames", "u16"]]],
  0x4e: ["slot_jmp4e", [["_", "u8"]]], 0x4f: ["actor_attach", []],
  0x50: ["slot_jmp50", [["_", "u16"], ["dst", "addr"]]], 0x51: ["slot_jmp51", [["_", "u16"], ["dst", "addr"]]],
  0x52: ["actor_remove", [["actor", "actor"]]], 0x53: ["actor_reset", []],
  0x54: ["var54_jmp", [["val", "u8"], ["_", "u8"], ["dst", "ptr"]]],
  0x55: ["say", [["_", "u16"], ["text", "ptr"]]], 0x56: ["flag2_set", [["bit", "u8"]]],
  0x57: ["actor_expr", [["actor", "actor"], ["expr", "u8"]]],
  0x58: ["sfx", [["_", "u16"], ["id", "u8"], ["mode", "u8"]]], 0x59: ["cam_reset", []],
  0x5a: ["wait_busy", [["_", "u16"]]], 0x60: ["msgbox_open", []], 0x61: ["msgbox_close", []],
  0x63: ["transition", [["type", "trans"]]],
  0x64: ["actor_sprite", [["idx", "u8"], ["kind", "u8"], ["x", "u8"], ["y", "u8"], ["a", "u8"], ["b", "u8"], ["c", "u8"], ["d", "u8"], ["e", "u8"]]],
  0x65: ["actor_sprite2", [["idx", "u8"], ["kind", "u8"], ["x", "u8"], ["y", "u8"], ["a", "u8"], ["b", "u8"], ["c", "u8"], ["d", "u8"], ["e", "u8"]]],
  0x66: ["progress_jmp", [["major", "u8"], ["minor", "u8"]]],
  0x67: ["progress_set0", [["a", "u8"], ["b", "u8"]]], 0x68: ["progress_set1", []],
  0x69: ["progress_reset", [["a", "u8"], ["b", "u8"]]], 0x6c: ["screen_fx", [["mode", "u8"]]],
  0x6d: ["screen_fx_reset", []], 0x6e: ["wait6e", [["_", "u16"], ["a", "u8"], ["b", "u8"]]],
  0x71: ["fx71", []], 0x72: ["sprite_off", [["idx", "u8"]]], 0x73: ["actor_flag_set", [["idx", "u8"]]],
  0x74: ["actor_flag_clr", [["idx", "u8"]]], 0x75: ["actor_show", [["idx", "u8"]]],
  0x76: ["actor_showb", [["idx", "u8"]]], 0x77: ["actor_hide", [["idx", "u8"]]],
  0x78: ["campan", [["x", "s16"]]], 0x79: ["sfx79", [["_", "u16"], ["id", "u8"], ["mode", "u8"]]],
  0x7a: ["cam_reset7a", []], 0x7b: ["wait_anim", []],
  0x7c: ["actor_move7c", [["idx", "u8"], ["x", "u8"], ["y", "u8"], ["z", "u8"], ["w", "u8"]]],
  0x80: ["snd_play", [["id", "u8"]]], 0x81: ["snd_voice", []],
  0x87: ["progress_cmp_jmp", [["_", "u16"], ["dst", "addr"]]],
  0x88: ["progress88", []], 0x89: ["progress89", []], 0x8a: ["progress8a", []],
};

export function opLength(opcode: number): number {
  if (opcode < 0x20) return TEXT_CTRL_LEN[opcode] ?? TEXT_CTRL_LEN_DEFAULT;
  return opcode < OPLEN.length ? OPLEN[opcode] : 4;
}

export function mnemonic(opcode: number): string {
  const spec = SPEC[opcode];
  return spec ? spec[0] : `op_${opcode.toString(16).padStart(2, "0")}`;
}

export const MNEMONIC_TO_OP = new Map<string, number>();
for (const op of Object.keys(SPEC).map(Number).sort((x, y) => x - y)) {
  const name = SPEC[op][0];
  if (!MNEMONIC_TO_OP.has(name)) MNEMONIC_TO_OP.set(name, op);
}

// Full operand field list covering exactly (op_length-2) bytes; trailing -> ("extra","raw",n).
export function schema(opcode: number): Array<[string, string, number]> {
  const nbytes = Math.max(0, opLength(opcode) - 2);
  const spec = SPEC[opcode];
  const fields: Array<[string, string, number]> = [];
  let used = 0;
  if (spec) {
    for (const [name, ftype] of spec[1]) {
      const w = FIELD[ftype][0];
      fields.push([name, ftype, w]);
      used += w;
    }
  }
  if (used < nbytes) fields.push(["extra", "raw", nbytes - used]);
  return fields;
}

// Byte offset (from instruction start) of this opcode's relocatable pointer, or null.
export function ptrSlot(opcode: number): number | null {
  let off = 2;
  for (const [, ftype, w] of schema(opcode)) {
    if (ftype === "ptr") return off;
    off += w;
  }
  return null;
}

// Operand byte count of an opcode (= opLength − 2), summed from its schema.
export const schemaLen = (opcode: number): number => schema(opcode).reduce((a, [, , w]) => a + w, 0);

// Opcode for a mnemonic ("op_2b" hex form or a named mnemonic).
export const opcodeFor = (mnem: string): number =>
  mnem.startsWith("op_") ? parseInt(mnem.slice(3), 16) : MNEMONIC_TO_OP.get(mnem) ?? 0;
