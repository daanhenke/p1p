// "adv-scene" datatype: one source file PER SCENE in the ADV archives (E0–E3.BIN, each a SectorArchive
// of scene records). Discovery is game-faithful (parseScene walks the control block — no scanning). A
// scene file holds the whole scene: every dialogue message (by say-target offset) plus a read-only
// disassembly of its script for context. An override is a PARTIAL scene — just the messages you change
// — merged onto the base by offset.
//
// Rebuild is a text SPLICE, not a recompile: an edited message is rewritten in place when it fits, else
// appended to the record's data tail with its say pointer(s) repointed (old bytes go dead). Unedited
// messages re-encode identically, so untouched scenes stay byte-for-byte the same.
//
// Naming: each archive has a manifest (e0.manifest.json: sceneIndex → name); a named scene is dumped as
// "e0/<name>.xml" instead of "e0/<index>.xml". Key is always "<archive>/<sceneIndex>".

import type { BuildCtx, Datatype, Issue, RecordKey } from "@p1p/core";
import { buildXml, parseXml, uintLE } from "@p1p/core";
import type { Glyph } from "../text/glyph.js";
import { SectorArchive } from "@p1p/atlus";
import { encodeResource, fromMultiline, toMultiline } from "../text/resource.js";
import { FIELD, mnemonic, schema } from "../script/opcodes.js";
import {
  decodeSceneMessage, parseScene, sceneMessageSpan, SCENE_PSX_BASE, type ParsedScene,
} from "../script/sceneReader.js";
import { overflows, TEXTBOX_WIDTHS } from "../text/textbox.js";

/** One scene archive: a short name (used in keys/paths) and its ISO path. */
export interface SceneArchive { name: string; file: string }

export interface SceneMessage { offset: number; text: string }
export interface SceneRecord { archive: string; scene: number; messages: SceneMessage[]; script: string[] }
export type SceneOverride = { messages: SceneMessage[] };

const toHex = (u: Uint8Array): string => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

function writeU32(buf: Uint8Array | number[], off: number, v: number): void {
  buf[off] = v & 0xff;
  buf[off + 1] = (v >>> 8) & 0xff;
  buf[off + 2] = (v >>> 16) & 0xff;
  buf[off + 3] = (v >>> 24) & 0xff;
}

function findBytes(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const eq = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

const label = (off: number): string => `loc_${off.toString(16)}`;

/** Render one operand value by its field style (decimal/signed/address/hex) — mirrors decompile.py. */
function renderVal(value: number, style: string, w: number): string {
  if (style === "signed" && value >= 2 ** (8 * w - 1)) return String(value - 2 ** (8 * w));
  if (style === "addr") return "0x" + value.toString(16).padStart(8, "0");
  if (style === "symhex") return "0x" + value.toString(16).padStart(2 * w, "0");
  return String(value); // dec / sym (no symbol tables here) → plain number
}

/** Operand tokens for one instruction (ptr → label / text ref, others by field style); trailing zeros dropped. */
function opTokens(op: number, operands: Uint8Array, targetOff: number, msgOff: number | undefined): string[] {
  const toks: string[] = [];
  let off = 0;
  for (const [name, ftype, w] of schema(op)) {
    const chunk = operands.subarray(off, off + w);
    if (ftype === "ptr") {
      toks.push(msgOff !== undefined ? `text_${msgOff.toString(16)}` : targetOff >= 0 ? label(targetOff) : "0x" + toHex(chunk));
    } else if (ftype === "raw") {
      toks.push("$" + toHex(chunk));
    } else if (name.startsWith("_")) {
      toks.push(chunk.some((x) => x) ? "$" + toHex(chunk) : ".");
    } else {
      toks.push(renderVal(uintLE(chunk, 0, w), FIELD[ftype][2], w));
    }
    off += w;
  }
  while (toks.length && (toks[toks.length - 1] === "." || /^\$0+$/.test(toks[toks.length - 1]))) toks.pop();
  return toks;
}

/**
 * Disassemble a parsed scene to a readable listing close to decompile.py: a `loc_xxxx:` label before
 * any jump target, then `mnemonic args` per instruction (no per-line address; clean operands). The say
 * op references its message by `text_<off>`. Reference only — not parsed back.
 */
function scriptLines(sc: ParsedScene): string[] {
  const sayAt = new Map(sc.sayRefs.map((r) => [r.instrOff, r.msgOff]));
  const targets = new Set([...sc.instrs.values()].filter((i) => i.targetOff >= 0).map((i) => i.targetOff));
  const lines: string[] = [];
  for (const i of sc.instrs.values()) {
    if (targets.has(i.off)) lines.push(`${label(i.off)}:`);
    const toks = opTokens(i.op, i.operands, i.targetOff, sayAt.get(i.off));
    lines.push(`  ${mnemonic(i.op)}${toks.length ? " " + toks.join(" ") : ""}`);
  }
  return lines;
}

/** Splice edited messages into one scene record (in place if they fit, else append + repoint). */
export function spliceScene(record: Uint8Array, edits: Map<number, string>, glyph: Glyph): Uint8Array {
  const sc = parseScene(record);
  const body = record.subarray(8);
  const known = new Set(sc.messageOffsets);
  const sayByMsg = new Map<number, number[]>();
  for (const { instrOff, msgOff } of sc.sayRefs) {
    const list = sayByMsg.get(msgOff) ?? [];
    list.push(instrOff);
    sayByMsg.set(msgOff, list);
  }
  const out = Array.from(record);
  const appended: number[] = [];
  for (const [msgOff, text] of edits) {
    if (!known.has(msgOff)) continue;
    const [start, end] = sceneMessageSpan(body, msgOff, sc.contentLen);
    const bytes = encodeResource(text, glyph);
    if (bytes.length <= end - start) {
      for (let i = 0; i < bytes.length; i++) out[8 + start + i] = bytes[i];
      for (let p = 8 + start + bytes.length; p < 8 + end; p++) out[p] = 0;
    } else {
      const newOff = sc.contentLen + appended.length;
      for (const b of bytes) appended.push(b);
      for (const io of sayByMsg.get(msgOff) ?? []) writeU32(out, 8 + io + 4, (SCENE_PSX_BASE + newOff) >>> 0);
    }
  }
  if (appended.length === 0) return Uint8Array.from(out);
  const full = out.slice(0, 8 + sc.contentLen).concat(appended);
  writeU32(full, 4, (SCENE_PSX_BASE + sc.contentLen + appended.length) >>> 0);
  return Uint8Array.from(full);
}

export class AdvSceneDatatype implements Datatype<SceneRecord, SceneOverride> {
  readonly id = "adv-scene";
  readonly group = "scenes";
  private readonly byName: Map<string, string>;

  constructor(private readonly glyph: Glyph, private readonly archives: SceneArchive[]) {
    this.byName = new Map(archives.map((a) => [a.name, a.file]));
  }

  // The default file path is "<archive>/<index>.xml", but the filename is pure FLAIR — the build reads
  // the archive + scene from the XML attributes, so a scene can be renamed freely (no manifest needed).
  sourcePath(key: RecordKey): string {
    const [archive, scene] = key.split("/");
    return `${archive}/${scene}.xml`;
  }

  keyFromPath(relPath: string): RecordKey { return relPath.replace(/\.xml$/i, ""); } // best-effort; fromXml is authoritative

  private archiveOf(name: string, ctx: BuildCtx): SectorArchive | undefined {
    const file = this.byName.get(name);
    const bytes = file ? ctx.source.tryRead(file) : undefined;
    return bytes ? SectorArchive.fromBytes(bytes) : undefined;
  }

  private readScene(archive: string, scene: number, record: Uint8Array): SceneRecord {
    const sc = parseScene(record);
    const messages = sc.messageOffsets.map((mo) => ({
      offset: mo, text: decodeSceneMessage(record, mo, sc.contentLen, this.glyph, false),
    }));
    return { archive, scene, messages, script: scriptLines(sc) };
  }

  read(key: RecordKey, ctx: BuildCtx): SceneRecord | undefined {
    const [archive, sceneStr] = key.split("/");
    const scene = Number(sceneStr);
    const record = this.archiveOf(archive, ctx)?.records[scene];
    return record ? this.readScene(archive, scene, record) : undefined;
  }

  readAll(ctx: BuildCtx): Map<RecordKey, SceneRecord> {
    const out = new Map<RecordKey, SceneRecord>();
    for (const { name } of this.archives) {
      const arc = this.archiveOf(name, ctx);
      if (!arc) continue;
      arc.records.forEach((record, scene) => out.set(`${name}/${scene}`, this.readScene(name, scene, record)));
    }
    return out;
  }

  apply(merged: Map<RecordKey, SceneRecord>, ctx: BuildCtx): Map<string, Uint8Array> {
    const byArchive = new Map<string, Map<number, Map<number, string>>>();
    for (const r of merged.values()) {
      const scenes = byArchive.get(r.archive) ?? new Map();
      byArchive.set(r.archive, scenes);
      scenes.set(r.scene, new Map(r.messages.map((m) => [m.offset, m.text])));
    }

    const changes = new Map<string, Uint8Array>();
    const bootExe = ctx.profile.data.bootExe as string | undefined;
    for (const [name, scenes] of byArchive) {
      const file = this.byName.get(name);
      const original = file ? ctx.source.tryRead(file) : undefined;
      if (!file || !original) continue;
      const arc = SectorArchive.fromBytes(original);
      for (const [scene, msgs] of scenes) {
        const record = arc.records[scene];
        if (record) arc.records[scene] = spliceScene(record, msgs, this.glyph);
      }
      const rebuilt = arc.rebuild().blob;
      changes.set(file, rebuilt);

      // Patch the EXE-embedded copy of this archive's sector table. The boot exe lives on the PRIMARY
      // disc, so the needle is the primary disc's original table — not `original`, which for a routed
      // (multi-disc) build is the SECONDARY disc's archive and whose table differs from the one baked
      // into the primary's boot exe (that mismatch left E0's table stale → broken scene packing).
      const base = ctx.source.unrouted?.(file) ?? original;
      const oldTable = base.subarray(0, (SectorArchive.fromBytes(base).count + 1) * 2);
      const newTable = SectorArchive.fromBytes(rebuilt).makeExeTableBytes();
      if (bootExe && !eq(oldTable, newTable)) {
        const exe = ctx.source.tryRead(bootExe);
        const at = exe ? findBytes(exe, oldTable) : -1;
        if (exe && at >= 0) {
          const patched = changes.get(bootExe) ?? Uint8Array.from(exe);
          patched.set(newTable, at);
          changes.set(bootExe, patched);
        } else if (exe) {
          throw new Error(`adv-scene: ${file} sector table not found in ${bootExe} (EXE mirror unpatched → broken scene offsets)`);
        }
      }
    }
    return changes;
  }

  /** Merge a partial scene override (some messages) onto the base scene (all messages), by offset. */
  merge(base: SceneRecord, ov: SceneOverride): SceneRecord {
    const byOff = new Map(base.messages.map((m) => [m.offset, m.text]));
    for (const m of ov.messages) byOff.set(m.offset, m.text);
    const messages = [...byOff].map(([offset, text]) => ({ offset, text })).sort((a, b) => a.offset - b.offset);
    return { ...base, messages };
  }

  validate(key: RecordKey, model: SceneRecord): Issue[] {
    const out: Issue[] = [];
    for (const m of model.messages) {
      const ov = overflows(m.text, TEXTBOX_WIDTHS.us);
      if (ov.length) out.push({ level: "warn", datatype: this.id, key, message: `msg @${m.offset.toString(16)} overflow: ${JSON.stringify(ov)}` });
    }
    return out;
  }

  toXml(_key: RecordKey, model: SceneRecord): string {
    const scene: Record<string, unknown> = { "@archive": model.archive, "@scene": model.scene };
    if (model.script.length) scene.script = { "#text": "\n" + model.script.join("\n") + "\n" }; // script first
    scene.message = model.messages.map((m) => ({ "@offset": m.offset.toString(16), "#text": toMultiline(m.text) }));
    return buildXml({ scene });
  }

  fromXml(xml: string): { key: RecordKey; value: SceneOverride } {
    const e = (parseXml(xml) as {
      scene: { "@archive": string; "@scene": string; message?: SceneMsgXml | SceneMsgXml[] };
    }).scene;
    const raw = e.message === undefined ? [] : Array.isArray(e.message) ? e.message : [e.message];
    const messages = raw.map((m) => ({ offset: parseInt(m["@offset"], 16), text: fromMultiline(String(m["#text"] ?? "")) }));
    return { key: `${e["@archive"]}/${Number(e["@scene"])}`, value: { messages } };
  }
}

interface SceneMsgXml { "@offset": string; "#text"?: string }
