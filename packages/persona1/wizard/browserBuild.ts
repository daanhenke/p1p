// The in-browser build for the Persona 1 wizard: the same pipeline as the `persona1 build` CLI command,
// but driven by the user's uploaded disc images and the pre-compiled patch packs (shipped under
// /patches/). Everything is Uint8Array work — @p1p/core + @p1p/ps1 carry no Node dependencies — so it
// runs entirely client-side; the discs never leave the browser.
//
// Memory: like the old web/ build, it avoids holding "three images in RAM". The JP disc is read only
// to lift the scene archives it provides, then dropped before the US disc loads; and when a folder is
// picked the patched image streams straight to disk (never buffered whole). Only the download fallback
// holds the output in memory.

import { buildChanges, decodePack, MemoryAssetSource, RoutingAssetSource, type AssetSource } from "@p1p/core";
import { DiscImage, BufferSink, RAW, readIsoFiles, type DiscSink } from "@p1p/ps1";
import type { BuildFn } from "@p1p/wizard";
import { persona1 } from "../src/profile.js";

const OUT_BIN = "Persona (USA) [EN].bin";
const OUT_CUE = "Persona (USA) [EN].cue";
const CUE = `FILE "${OUT_BIN}" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n`;

const packUrl = (id: string): string => `${import.meta.env.BASE_URL}patches/${id}.bin`;

async function loadPack(id: string): Promise<Uint8Array> {
  const res = await fetch(packUrl(id));
  if (!res.ok) throw new Error(`patch pack "${id}" could not be loaded (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

// A Uint8Array over an ArrayBufferLike isn't structurally a DOM BlobPart (the lib types exclude
// SharedArrayBuffer); the bytes are plain, so wrap them once here.
const toBlob = (data: Uint8Array | string): Blob => new Blob([data as BlobPart]);

async function writeInto(dir: FileSystemDirectoryHandle, name: string, data: Uint8Array | string): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(toBlob(data));
  await w.close();
}

// Random-access writes straight to a chosen file on disk — the patched image is written as it's
// produced, never held whole in RAM.
class StreamSink implements DiscSink {
  constructor(private readonly stream: FileSystemWritableFileStream) {}
  async write(offset: number, data: Uint8Array): Promise<void> {
    await this.stream.write({ type: "write", position: offset, data: data as BufferSource });
  }
}

// Trigger one file download. The anchor must be in the DOM for Firefox, and we pause afterwards so
// the next call isn't coalesced/blocked — browsers drop back-to-back programmatic downloads.
async function triggerDownload(name: string, data: Uint8Array | string): Promise<void> {
  const url = URL.createObjectURL(toBlob(data));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  await new Promise((resolve) => setTimeout(resolve, 700));
}

export const buildPersona1: BuildFn = async (roms, enabledPatches, dest, onLog, patchSettings) => {
  const us = roms.us;
  const jp = roms.jp;
  if (!us) throw new Error("The US disc image is required — it's the base being rebuilt.");
  if (!jp) throw new Error("The Japanese disc image is required — the scene text is sourced from it.");

  // P1 is a dual-disc build: scene archives (E0–E3) come from the JP disc, everything else from US.
  const scenePaths = (persona1.data.secondaryPaths as string[] | undefined) ?? [];

  // Lift only the scene archives off the JP disc, reading their extents straight from the file (a few
  // MB) instead of loading the whole ~700 MB image — and never holding the JP disc in memory at all.
  onLog("Reading scene archives from the Japanese disc…");
  const jpRead = (off: number, len: number): Promise<Uint8Array> =>
    jp.slice(off, off + len).arrayBuffer().then((b) => new Uint8Array(b));
  const scenes = await readIsoFiles(jpRead, scenePaths);
  const jpScenes = new MemoryAssetSource(Object.fromEntries(scenes), "jp-scenes");
  const sceneMb = [...scenes.values()].reduce((n, d) => n + d.length, 0) / (1024 * 1024);
  onLog(`Lifted ${scenes.size} scene archive(s) (${sceneMb.toFixed(1)} MB) from the JP disc.`);

  onLog("Reading US disc…");
  const usDisc = new DiscImage(new Uint8Array(await us.arrayBuffer()), us.name);
  const source: AssetSource = new RoutingAssetSource(usDisc, jpScenes, scenePaths);

  // The base translation is always applied; the optional tweaks are whatever the user enabled.
  const ids = ["persona1-en", ...enabledPatches];
  const packs = [];
  for (const id of ids) {
    onLog(`Loading patch: ${id}…`);
    packs.push(decodePack(await loadPack(id)));
  }

  // Flatten the per-patch setting choices into the global settingId → option map the code-patch
  // datatype resolves against (setting ids are unique across packs).
  const settings: Record<string, string> = {};
  for (const vals of Object.values(patchSettings ?? {})) Object.assign(settings, vals);

  onLog("Applying patches…");
  const { changes, issues } = buildChanges(persona1, packs, source, onLog, settings);
  const errors = issues.filter((x) => x.level === "error");
  if (errors.length) throw new Error(`build failed: ${errors.map((e) => e.message).join("; ")}`);

  const outBytes = usDisc.planLayout(changes).endLba * RAW;
  const buildLog: string[] = [];

  onLog("Rebuilding the ISO (file table + EDC/ECC)…");
  if (dest?.handle) {
    onLog(`Streaming ${OUT_BIN} to "${dest.name}"…`);
    const binHandle = await dest.handle.getFileHandle(OUT_BIN, { create: true });
    const writable = await binHandle.createWritable();
    try {
      await usDisc.buildPatchedTo(changes, new StreamSink(writable), buildLog);
    } finally {
      await writable.close();
    }
    for (const l of buildLog) onLog(l);
    onLog(`Writing ${OUT_CUE}…`);
    await writeInto(dest.handle, OUT_CUE, CUE);
  } else {
    // Download fallback: build into a buffer (output held in RAM), then emit both files. Pre-size to
    // the final length so the appended sectors never trigger a reallocation.
    const sink = new BufferSink(outBytes);
    await usDisc.buildPatchedTo(changes, sink, buildLog);
    for (const l of buildLog) onLog(l);
    onLog(`Downloading ${OUT_CUE} + ${OUT_BIN}…`);
    await triggerDownload(OUT_CUE, CUE); // tiny .cue first, then the large .bin
    await triggerDownload(OUT_BIN, sink.bytes());
  }

  const mb = (outBytes / (1024 * 1024)).toFixed(0);
  return { summary: `Built ${OUT_BIN} (${mb} MB) + ${OUT_CUE} — ${changes.size} file(s) changed.` };
};
