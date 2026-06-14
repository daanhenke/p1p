// Game-faithful ADV scene parser — ports port/Per1.Formats/SceneReader.cs. It reads a scene record
// the way Persona.exe's loader/VM does (NOT a heuristic scan):
//   • record = [u32 ptr0][u32 ptr1][body]; the loader skips the 8-byte envelope, so body maps to PSX
//     0x80100000 (a pointer P → body offset P − 0x80100000). ptr1 = end-of-data.
//   • body[0..0x34) = a 0x34-byte u16 header; the control block sits at body+0x34.
//   • ctrl[0..8] = zone-table {count,entries} pointer pairs, ctrl[9] = scene-type byte,
//     ctrl[0xb] = script entry (-1 = none).
//   • the script is decoded by walking the bytecode from the real entry points (script entry + each
//     zone's script), following jumps/branches/fall-through and relocating pointers — Adv_RunScript.
// say (0x55) targets point to message TEXT (not code); every other ptr-field op targets code.

import { u32le } from "@p1p/core";
import type { Glyph } from "../text/glyph.js";
import { decodeResource } from "../text/resource.js";
import { MNEMONIC_TO_OP, opLength, ptrSlot } from "./opcodes.js";

export const SCENE_PSX_BASE = 0x80100000;
export const SCENE_HEADER_SIZE = 0x34; // ctrl = (bodyBase + 0x37) & ~3 = bodyBase + 0x34
const MARKER = 0xff;
const OP_JMP = MNEMONIC_TO_OP.get("jmp") ?? 0x22;
const OP_SAY = MNEMONIC_TO_OP.get("say") ?? 0x55;
// Opcodes after which the VM (Adv_RunScript) ends the script slice and never falls through, so the
// walk must stop (the bytes after are padding/data): end, jmp, and the yields that set a yield code
// and leave the scene — sel_yield (0x28), scene_goto (0x2b), msg_win (0x2c) and yield6 (0x2d).
const TERMINATORS = new Set<number>([
  OP_JMP,
  MNEMONIC_TO_OP.get("end") ?? 0x21,
  MNEMONIC_TO_OP.get("sel_yield") ?? 0x28,
  MNEMONIC_TO_OP.get("scene_goto") ?? 0x2b,
  MNEMONIC_TO_OP.get("msg_win") ?? 0x2c,
  MNEMONIC_TO_OP.get("yield6") ?? 0x2d,
]);

export type ZoneKind = "auto" | "hotspot" | "action" | "button";
export interface SceneZone { kind: ZoneKind; tileX: number; tileY: number; scriptOff: number; button: number }
export interface SceneInstr { off: number; op: number; operands: Uint8Array; targetOff: number } // targetOff: body offset or -1

export interface ParsedScene {
  /** Raw 0x34-byte header (kept opaque until the fields are reversed). */
  header: Uint8Array;
  sceneType: number;
  /** End-of-data within body (ptr1 − PSX_BASE, clamped). */
  contentLen: number;
  /** Decoded instructions, keyed + ordered by body offset. */
  instrs: Map<number, SceneInstr>;
  /** Script-entry body offset (ctrl[0xb]) or -1. */
  entryOff: number;
  /** Sorted say-target offsets — where each dialogue message's text begins. */
  messageOffsets: number[];
  /** Every say instruction → its message offset (so an editor can repoint the pointer). */
  sayRefs: SayRef[];
  zones: SceneZone[];
}

/** A say instruction at body offset `instrOff` whose +4 pointer targets the message at `msgOff`. */
export interface SayRef { instrOff: number; msgOff: number }

/** Thrown when a scene record can't be parsed as a valid script (bad entry / target / sizing). */
export class SceneParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneParseError";
  }
}

/** Parse a scene record into the game-faithful model (script + zones + message offsets). */
export function parseScene(record: Uint8Array): ParsedScene {
  const empty: ParsedScene = {
    header: new Uint8Array(0), sceneType: 0, contentLen: 0,
    instrs: new Map(), entryOff: -1, messageOffsets: [], sayRefs: [], zones: [],
  };
  if (record.length < 12) return empty;

  const body = record.subarray(8); // skip the [ptr0][ptr1] envelope
  const ptr1 = u32le(record, 4);
  let contentLen = Math.max(0, Math.min(ptr1 - SCENE_PSX_BASE, body.length));
  if (contentLen === 0) contentLen = body.length;

  const u32 = (off: number): number => (off + 4 <= body.length ? u32le(body, off) : 0);
  const deref = (off: number): number => { // PSX pointer → body offset, or -1
    const v = u32(off);
    if (v >>> 24 === 0x80) {
      const t = (v - SCENE_PSX_BASE) >>> 0;
      if (t < body.length) return t;
    }
    return -1;
  };
  const ctrl = (i: number): number => deref(SCENE_HEADER_SIZE + i * 4);

  const header = body.slice(0, Math.min(SCENE_HEADER_SIZE, body.length));
  const sceneType = u32(SCENE_HEADER_SIZE + 9 * 4) & 0xff; // ctrl[9] low byte

  // ---- entry points: the script entry (ctrl[0xb]) + every zone's script ----
  const entries: number[] = [];
  const entryOff = ctrl(0xb);
  if (entryOff >= 0) entries.push(entryOff);

  const zones: SceneZone[] = [];
  const table = (kind: ZoneKind, countIdx: number, entriesIdx: number, stride: number, scriptField: number): void => {
    const countOff = ctrl(countIdx);
    const entriesOff = ctrl(entriesIdx);
    if (countOff < 0 || entriesOff < 0 || countOff >= body.length) return;
    const count = body[countOff];
    for (let i = 0; i < count; i++) {
      const e = entriesOff + i * stride;
      if (e + stride > body.length) break;
      const scriptOff = scriptField >= 0 ? deref(e + scriptField) : -1;
      if (scriptOff >= 0) entries.push(scriptOff);
      zones.push({ kind, tileX: body[e], tileY: body[e + 1], scriptOff, button: kind === "button" ? body[e + 2] : 0 });
    }
  };
  // The control block holds FOUR tile-keyed zone tables (Ghidra: Adv_Find{AutoEvent,Hotspot,
  // ActionTrigger,ButtonTrigger}At). The action table at ctrl[4]/[5] is the one the original docs /
  // SceneReader.cs missed — it's the "talk/examine in front of you" trigger (entry+2 facing-dir mask,
  // entry+3 selector), same shape as auto-event (stride 8, script@+4). Confirmed @Persona.exe 0x4363e0.
  table("auto", 0, 1, 8, 4); // entry+4 = script
  table("hotspot", 2, 3, 0xc, 8); // entry+8 = script
  table("action", 4, 5, 8, 4); // ctrl[4]/[5] action trigger — entry+4 = script
  table("button", 6, 7, 0xe, -1); // entry+2 = button mask; entry has no relocated script pointer

  // ---- decode reachable instructions (game-faithful walk) ----
  const instrs = new Map<number, SceneInstr>();
  const messages = new Set<number>();
  const sayRefs: SayRef[] = [];

  // Walk every reachable instruction from `starts`, collecting say-message offsets. `lenient` drops a
  // bad target (not an FF op / overrun) instead of throwing — used for the actor-table entries below,
  // whose pointer list can include a false positive; authoritative entries surface bad targets.
  const walkFrom = (starts: number[], lenient: boolean): void => {
    const queue = [...starts];
    while (queue.length) {
      let off = queue.pop()!;
      while (off >= 0 && off + 1 < contentLen && !instrs.has(off)) {
        if (body[off] !== MARKER) {
          if (lenient) break;
          throw new SceneParseError(`@0x${off.toString(16)} is not an FF instruction (byte 0x${(body[off] ?? 0).toString(16)})`);
        }
        const op = body[off + 1];
        const len = opLength(op);
        if (off + len > contentLen) {
          if (lenient) break;
          throw new SceneParseError(`op 0x${op.toString(16)} @0x${off.toString(16)} (len ${len}) overruns content end 0x${contentLen.toString(16)}`);
        }
        let targetOff = -1;
        const pf = ptrSlot(op);
        if (pf !== null) {
          const t = deref(off + pf);
          if (t >= 0) {
            if (op === OP_SAY) { // say → text (not code)
              messages.add(t);
              sayRefs.push({ instrOff: off, msgOff: t });
            } else {
              targetOff = t;
              queue.push(t);
            }
          }
        }
        instrs.set(off, { off, op, operands: body.slice(off + 2, off + len), targetOff });
        if (TERMINATORS.has(op)) break; // end/jmp/scene_goto/msg_win/yield6: no fall-through
        off += len;
      }
    }
  };

  // 1) The on-enter script (ctrl[0xb]) + zone-trigger scripts — authoritative.
  walkFrom(entries.filter((e) => e >= 0), false);
  // 2) Actor/object talk-scripts (the NPCs/objects you can interact with), in ADDITION to the
  //    cutscene. The PC port (Persona.exe FUN_004385a0) walks 8 actor entries (stride 0x24, script at
  //    +4 or +0x14) and 8 object entries (stride 0x1c, +4/+0x10), loaded into scratch buffers; the
  //    script pointers sit in the scene body. Follow every aligned word that points at an instruction
  //    (the same pointers the game does — not a message scan). A false pointer just drops its path.
  const actorEntries: number[] = [];
  for (let off = 0; off + 4 <= contentLen; off += 4) {
    const t = deref(off);
    if (t >= 0 && t < contentLen && body[t] === MARKER && !instrs.has(t)) actorEntries.push(t);
  }
  walkFrom(actorEntries, true);

  const ordered = new Map([...instrs.entries()].sort((a, b) => a[0] - b[0]));
  return {
    header, sceneType, contentLen, instrs: ordered, entryOff,
    messageOffsets: [...messages].sort((a, b) => a - b), sayRefs, zones,
  };
}

/**
 * Byte span [start, end) of the message text at `msgOff`: glyphs + text-control ops (op < 0x20),
 * terminated by {ret} (0xFF 0x01, included — the message's own end-of-text) or stopped before the
 * next script op (op ≥ 0x20, e.g. {end}, the following instruction). Scene messages are packed
 * back-to-back separated only by {ret}, so stopping at the script op alone would swallow the rest.
 */
export function sceneMessageSpan(body: Uint8Array, msgOff: number, contentLen: number): [number, number] {
  let pos = msgOff;
  while (pos < contentLen) {
    const b = body[pos];
    if (b === MARKER) {
      const sub = pos + 1 < contentLen ? body[pos + 1] : 0x21;
      if (sub >= 0x20) break; // a script op (incl. {end} 0x21) — the next instruction, not text
      pos += opLength(sub);
      if (sub === 0x01) break; // {ret} ends this message (included)
    } else {
      pos += b & 0x80 ? 2 : 1;
    }
  }
  return [msgOff, Math.min(pos, contentLen)];
}

/**
 * Decode the message text at a say-target offset (within a record's body) via the glyph codec.
 * Strict by default: a say target is real, fully-mappable text, so an unencodable glyph (wrong
 * offset or wrong font) throws instead of silently round-tripping a 〔hex〕 placeholder.
 */
export function decodeSceneMessage(
  record: Uint8Array, msgOff: number, contentLen: number, glyph: Glyph, strict = true,
): string {
  const body = record.subarray(8);
  const [start, end] = sceneMessageSpan(body, msgOff, contentLen);
  return decodeResource(body.subarray(start, end), glyph, { strict });
}
