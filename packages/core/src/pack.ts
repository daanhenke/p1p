// The compiled `.bin` patch pack: one self-contained, distributable file per patch that the wizard
// reads (instead of shipping ~1.2 MB of JSON). Container is binary; override payloads are compact
// JSON of the override models (so the wizard never parses XML and no per-datatype binary serializer
// is needed). Layout:
//   "RKPK" | u16 version | u32 manifestLen | manifest(JSON) | u32 overrideCount | override[]
//   override: u8 datatypeLen | datatype | u16 keyLen | key | u32 valueLen | value(JSON)

import { ByteReader, ByteWriter } from "./bytes.js";
import type { Override } from "./datatype.js";
import type { Patch } from "./patch.js";

const MAGIC = [0x52, 0x4b, 0x50, 0x4b]; // "RKPK"
const VERSION = 1;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodePack(patch: Patch): Uint8Array {
  const w = new ByteWriter();
  for (const b of MAGIC) w.u8(b);
  w.u16(VERSION);
  const manifest = enc.encode(JSON.stringify(patch.manifest));
  w.u32(manifest.length).bytes(manifest);
  w.u32(patch.overrides.length);
  for (const ov of patch.overrides) {
    const dt = enc.encode(ov.datatype);
    const key = enc.encode(ov.key);
    const val = enc.encode(JSON.stringify(ov.value));
    w.u8(dt.length).bytes(dt);
    w.u16(key.length).bytes(key);
    w.u32(val.length).bytes(val);
  }
  return w.toBytes();
}

export function decodePack(data: Uint8Array): Patch {
  const r = new ByteReader(data);
  for (const b of MAGIC) if (r.u8() !== b) throw new Error("not a RKPK patch pack");
  const version = r.u16();
  if (version !== VERSION) throw new Error(`unsupported pack version ${version}`);
  const manifest = JSON.parse(dec.decode(r.bytes(r.u32())));
  const count = r.u32();
  const overrides: Override[] = [];
  for (let i = 0; i < count; i++) {
    const datatype = dec.decode(r.bytes(r.u8()));
    const key = dec.decode(r.bytes(r.u16()));
    const value = JSON.parse(dec.decode(r.bytes(r.u32())));
    overrides.push({ datatype, key, value });
  }
  return { manifest, overrides };
}
