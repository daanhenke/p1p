// PSX .bin disc image: ISO9660 parse, file read, layout planning, patched-disc writer, and the
// boot-loader FNAME/FSECT/FSIZE file table. Ports web/src/core/disc/{iso,build}.ts but synchronous +
// in-memory (the CLI loads the whole .bin; the browser-streaming variant stays in the wizard). A
// DiscImage *is* an AssetSource, so the build pipeline reads ISO files straight from it.

import type { AssetSource } from "@p1p/core";
import { u32le, packU32le, packU32be } from "@p1p/core";
import { RAW, DATA, makeSector, fixSectorEcc } from "./sector.js";
import type { DiscSink } from "./sink.js";

export interface FileEntry {
  lba: number;
  size: number;
  dirOff: number; // absolute image byte offset of this file's ISO directory record
  name: string;
}

const norm = (p: string): string => "/" + p.replace(/\\/g, "/").replace(/^\/+/, "").split(";")[0].toUpperCase();

export class DiscImage implements AssetSource {
  readonly files = new Map<string, FileEntry>(); // key = normalised ISO path
  readonly nSectors: number;
  sectorMode = 1;
  pvdVolSectors = 0;

  constructor(readonly image: Uint8Array, readonly describe = "disc") {
    if (image.length % RAW !== 0) throw new Error(`not a ${RAW}-byte/sector image (${image.length} bytes)`);
    this.nSectors = Math.floor(image.length / RAW);
    this.sectorMode = this.readRaw(16)[15];
    this.parseIso();
  }

  private dataOff(raw: Uint8Array): number { return raw[15] === 2 ? 24 : 16; }
  readRaw(lba: number): Uint8Array { return this.image.subarray(lba * RAW, lba * RAW + RAW); }
  readSectorData(lba: number): Uint8Array {
    const s = this.readRaw(lba);
    const o = this.dataOff(s);
    return s.subarray(o, o + DATA);
  }

  readExtent(lba: number, size: number): Uint8Array {
    const nsec = Math.ceil(size / DATA);
    const out = new Uint8Array(nsec * DATA);
    for (let k = 0; k < nsec; k++) out.set(this.readSectorData(lba + k), k * DATA);
    return out.subarray(0, size);
  }

  // ---- AssetSource ----
  has(path: string): boolean { return this.files.has(norm(path)); }
  tryRead(path: string): Uint8Array | undefined {
    const e = this.files.get(norm(path));
    return e ? this.readExtent(e.lba, e.size) : undefined;
  }

  read(path: string): Uint8Array {
    const d = this.tryRead(path);
    if (!d) throw new Error(`file not found: ${path}`);
    return d;
  }

  list(): string[] { return [...this.files.keys()]; }

  private parseIso(): void {
    const pvd = this.readSectorData(16);
    if (String.fromCharCode(...pvd.subarray(1, 6)) !== "CD001") throw new Error("no ISO9660 PVD at LBA 16");
    this.pvdVolSectors = u32le(pvd, 80);
    const rootLba = u32le(pvd, 158); // root dir record extent (offset 156 + 2)
    this.walkDir(rootLba, "");
  }

  private walkDir(lba: number, prefix: string): void {
    const data = this.readSectorData(lba);
    const dataOff = this.dataOff(this.readRaw(lba));
    let i = 0;
    while (i < data.length) {
      const L = data[i];
      if (L === 0) break;
      const entLba = u32le(data, i + 2);
      const entSz = u32le(data, i + 10);
      const flags = data[i + 25];
      const nlen = data[i + 32];
      const name = data.subarray(i + 33, i + 33 + nlen);
      const dirOff = lba * RAW + dataOff + i;
      if (!(nlen === 1 && (name[0] === 0 || name[0] === 1))) {
        const nm = String.fromCharCode(...name);
        const path = prefix + "/" + nm.split(";")[0];
        if (flags & 0x02) this.walkDir(entLba, path);
        else this.files.set(norm(path), { lba: entLba, size: entSz, dirOff, name: nm });
      }
      i += L;
    }
  }

  /**
   * Assign a final LBA to each changed file: kept in place if it still fits its extent, else
   * appended after the image end. Insertion order of `changes` drives the append order.
   */
  planLayout(changes: Map<string, Uint8Array>): { plan: Map<string, number>; endLba: number } {
    const plan = new Map<string, number>();
    let end = this.nSectors;
    for (const [path, data] of changes) {
      const e = this.files.get(norm(path));
      if (!e) throw new Error(`changed file not on disc: ${path}`);
      const need = Math.ceil(data.length / DATA);
      if (need <= Math.ceil(e.size / DATA)) { plan.set(path, e.lba); } else {
        plan.set(path, end);
        end += need;
      }
    }
    return { plan, endLba: end };
  }

  /**
   * Produce a new patched .bin: the original image with each changed file re-framed at its planned
   * LBA, the ISO directory records / PVD volume size patched, and every touched metadata sector's
   * EDC/ECC fixed. Returns the new image bytes and a per-file log.
   */
  buildPatched(changes: Map<string, Uint8Array>, log: string[] = []): { image: Uint8Array; log: string[] } {
    const { plan, endLba } = this.planLayout(changes);
    const out = new Uint8Array(endLba * RAW);
    out.set(this.image, 0);

    const metaPatch = new Map<number, Array<{ off: number; bytes: Uint8Array }>>(); // sector -> user-data patches
    const addPatch = (absOff: number, bytes: Uint8Array): void => {
      const sec = Math.floor(absOff / RAW);
      if (!metaPatch.has(sec)) metaPatch.set(sec, []);
      metaPatch.get(sec)!.push({ off: absOff - sec * RAW, bytes });
    };

    for (const [path, data] of changes) {
      const e = this.files.get(norm(path))!;
      const lba = plan.get(path)!;
      const need = Math.ceil(data.length / DATA);
      for (let k = 0; k < need; k++) {
        const slice = data.subarray(k * DATA, (k + 1) * DATA);
        out.set(makeSector(this.sectorMode, lba + k, slice, k === need - 1), (lba + k) * RAW);
      }
      // patch the ISO directory record: extent LBA (LE@+2, BE@+6) + size (LE@+10, BE@+14)
      addPatch(e.dirOff + 2, packU32le(lba));
      addPatch(e.dirOff + 6, packU32be(lba));
      addPatch(e.dirOff + 10, packU32le(data.length));
      addPatch(e.dirOff + 14, packU32be(data.length));
      const where = lba === e.lba ? "in place" : `relocated -> LBA ${lba} (+${need} sec)`;
      log.push(`  ${path}: ${data.length} bytes, ${need} sec, ${where}`);
    }

    if (endLba > this.nSectors) {
      const pvdRaw = this.readRaw(16);
      const pvdDataOff = pvdRaw[15] === 2 ? 24 : 16;
      addPatch(16 * RAW + pvdDataOff + 80, packU32le(endLba));
      addPatch(16 * RAW + pvdDataOff + 84, packU32be(endLba));
      log.push(`  image grew ${this.nSectors} -> ${endLba} sectors; PVD updated`);
    }

    for (const sec of [...metaPatch.keys()].sort((a, b) => a - b)) {
      const raw = out.subarray(sec * RAW, sec * RAW + RAW);
      for (const { off, bytes } of metaPatch.get(sec)!) raw.set(bytes, off);
      fixSectorEcc(raw);
    }
    return { image: out, log };
  }

  /**
   * Streaming variant of {@link buildPatched}: write the patched image to a {@link DiscSink} (a chosen
   * folder handle, an in-memory buffer, …) without ever allocating the whole output. The source image
   * is copied to the sink in chunks, each changed file's sectors are framed + written at their planned
   * LBA, and every touched metadata sector is rebuilt from the source + patches with fixed EDC/ECC.
   * Produces byte-identical output to {@link buildPatched} (covered by a round-trip test).
   */
  async buildPatchedTo(changes: Map<string, Uint8Array>, sink: DiscSink, log: string[] = []): Promise<string[]> {
    const { plan, endLba } = this.planLayout(changes);

    // 1. stream-copy the original image to the sink (8 MB chunks — output is never held whole in RAM)
    const COPY_CHUNK = 8 * 1024 * 1024;
    for (let off = 0; off < this.image.length; off += COPY_CHUNK) {
      await sink.write(off, this.image.subarray(off, Math.min(off + COPY_CHUNK, this.image.length)));
    }

    const metaPatch = new Map<number, Array<{ off: number; bytes: Uint8Array }>>();
    const addPatch = (absOff: number, bytes: Uint8Array): void => {
      const sec = Math.floor(absOff / RAW);
      if (!metaPatch.has(sec)) metaPatch.set(sec, []);
      metaPatch.get(sec)!.push({ off: absOff - sec * RAW, bytes });
    };

    // 2. write each changed file's sectors at its planned LBA + record its dir-record patch. Frame
    //    the whole file into one buffer and write it in a single call — thousands of per-sector writes
    //    would be slow on a streamed sink (and quadratic on a growing buffer).
    for (const [path, data] of changes) {
      const e = this.files.get(norm(path))!;
      const lba = plan.get(path)!;
      const need = Math.ceil(data.length / DATA);
      const framed = new Uint8Array(need * RAW);
      for (let k = 0; k < need; k++) {
        const slice = data.subarray(k * DATA, (k + 1) * DATA);
        framed.set(makeSector(this.sectorMode, lba + k, slice, k === need - 1), k * RAW);
      }
      await sink.write(lba * RAW, framed);
      addPatch(e.dirOff + 2, packU32le(lba));
      addPatch(e.dirOff + 6, packU32be(lba));
      addPatch(e.dirOff + 10, packU32le(data.length));
      addPatch(e.dirOff + 14, packU32be(data.length));
      const where = lba === e.lba ? "in place" : `relocated -> LBA ${lba} (+${need} sec)`;
      log.push(`  ${path}: ${data.length} bytes, ${need} sec, ${where}`);
    }

    // 3. grow the PVD volume size if files were appended past the original end
    if (endLba > this.nSectors) {
      const pvdDataOff = this.readRaw(16)[15] === 2 ? 24 : 16;
      addPatch(16 * RAW + pvdDataOff + 80, packU32le(endLba));
      addPatch(16 * RAW + pvdDataOff + 84, packU32be(endLba));
      log.push(`  image grew ${this.nSectors} -> ${endLba} sectors; PVD updated`);
    }

    // 4. rebuild each touched metadata sector from the source + patches, fix its EDC/ECC, write back
    for (const sec of [...metaPatch.keys()].sort((a, b) => a - b)) {
      const raw = Uint8Array.from(this.readRaw(sec));
      for (const { off, bytes } of metaPatch.get(sec)!) raw.set(bytes, off);
      fixSectorEcc(raw);
      await sink.write(sec * RAW, raw);
    }
    return log;
  }
}

export type ByteRangeReader = (offset: number, length: number) => Promise<Uint8Array>;

/**
 * Read just the requested ISO9660 files from a disc via on-demand range reads, parsing only the
 * volume descriptor and the directories on the path to those files. Lets the browser lift a few small
 * files (e.g. the ~6 MB of scene archives) off a multi-hundred-MB disc without loading the whole image.
 */
export async function readIsoFiles(read: ByteRangeReader, wanted: Iterable<string>): Promise<Map<string, Uint8Array>> {
  const want = new Set([...wanted].map(norm));
  const deframe = (raw: Uint8Array, nsec: number): Uint8Array => {
    const out = new Uint8Array(nsec * DATA);
    for (let k = 0; k < nsec; k++) {
      const o = raw[k * RAW + 15] === 2 ? 24 : 16;
      out.set(raw.subarray(k * RAW + o, k * RAW + o + DATA), k * DATA);
    }
    return out;
  };
  const readExtent = async (lba: number, size: number): Promise<Uint8Array> => {
    const nsec = Math.ceil(size / DATA);
    return deframe(await read(lba * RAW, nsec * RAW), nsec).subarray(0, size);
  };

  const pvd = deframe(await read(16 * RAW, RAW), 1);
  if (String.fromCharCode(...pvd.subarray(1, 6)) !== "CD001") throw new Error("no ISO9660 PVD at LBA 16");
  const rootLba = u32le(pvd, 158); // root dir record extent (offset 156 + 2)
  const rootSize = u32le(pvd, 166); // root dir record data length (offset 156 + 10)

  const out = new Map<string, Uint8Array>();
  const stack: Array<{ lba: number; size: number; prefix: string }> = [{ lba: rootLba, size: rootSize, prefix: "" }];
  while (stack.length) {
    const dir = stack.pop()!;
    const nsec = Math.ceil(dir.size / DATA);
    const logical = deframe(await read(dir.lba * RAW, nsec * RAW), nsec);
    for (let s = 0; s < nsec; s++) {
      let i = s * DATA;
      while (i < (s + 1) * DATA) {
        const L = logical[i];
        if (L === 0) break; // padding to the end of this sector
        const entLba = u32le(logical, i + 2);
        const entSz = u32le(logical, i + 10);
        const flags = logical[i + 25];
        const nlen = logical[i + 32];
        const name = logical.subarray(i + 33, i + 33 + nlen);
        i += L;
        if (nlen === 1 && (name[0] === 0 || name[0] === 1)) continue; // "." and ".."
        const path = norm(dir.prefix + "/" + String.fromCharCode(...name).split(";")[0]);
        if (flags & 0x02) {
          if ([...want].some((w) => w.startsWith(path + "/"))) stack.push({ lba: entLba, size: entSz, prefix: path });
        } else if (want.has(path)) {
          out.set(path, await readExtent(entLba, entSz));
        }
      }
    }
  }
  return out;
}

/** The PSX boot-loader's name->LBA->size table (FNAME/FSECT/FSIZE). Ports FileTable. */
export class FileTable {
  fsect: Uint8Array;
  fsize: Uint8Array;
  private idx = new Map<string, number>();

  constructor(public names: string[], fsect: Uint8Array, fsize: Uint8Array) {
    this.fsect = Uint8Array.from(fsect);
    this.fsize = Uint8Array.from(fsize);
    names.forEach((nm, i) => {
      const key = nm.toUpperCase().replace(/\\/g, "/").split(";")[0];
      if (key) this.idx.set(key, i);
    });
  }

  static fromSource(src: AssetSource): FileTable {
    const fsect = src.read("/FSECT.DAT");
    const fsize = src.read("/FSIZE.DAT");
    const fname = src.read("/FNAME.DAT");
    const n = Math.floor(fsect.length / 4);
    const names: string[] = [];
    let start = 0;
    for (let i = 0; i < fname.length && names.length < n; i++) {
      if (fname[i] === 0) {
        names.push(String.fromCharCode(...fname.subarray(start, i)));
        start = i + 1;
      }
    }
    while (names.length < n) names.push("");
    return new FileTable(names, fsect, fsize);
  }

  indexOf(isoPath: string): number | undefined { return this.idx.get(isoPath.toUpperCase()); }

  /** Apply { isoPath: [lba, byteSize] }; FSIZE stores the sector-padded size. */
  patch(updates: Map<string, [number, number]>): { "/FSECT.DAT": Uint8Array; "/FSIZE.DAT": Uint8Array } {
    for (const [path, [lba, size]] of updates) {
      const i = this.indexOf(path);
      if (i === undefined) continue;
      this.fsect.set(packU32le(lba), i * 4);
      this.fsize.set(packU32le(Math.ceil(size / DATA) * DATA), i * 4);
    }
    return { "/FSECT.DAT": this.fsect, "/FSIZE.DAT": this.fsize };
  }
}
