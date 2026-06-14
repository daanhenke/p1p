// Disc integration: parse the real US .bin, build a patched image with one in-place file change,
// re-open it, and assert the change round-trips while an untouched file and the ISO structure
// (PVD/dir records, re-parseable) survive the EDC/ECC rewrite. Skips if the disc isn't checked out.
// Drop the copyrighted disc image under packages/persona1/assets/disk/ (git-ignored) to run locally.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DiscImage, readIsoFiles } from "../src/disc.js";
import { BufferSink } from "../src/sink.js";

const here = dirname(fileURLToPath(import.meta.url));
const DISC = resolve(here, "../../persona1/assets/disk/psx_us/Persona (USA).bin");

describe("DiscImage build round-trip (real US disc)", () => {
  if (!existsSync(DISC)) {
    it.skip("disc not checked out", () => {});
    return;
  }

  it("patches a file in place and re-parses byte-correctly", { timeout: 120_000 }, () => {
    const disc = new DiscImage(new Uint8Array(readFileSync(DISC)), "us");
    const fsect = disc.read("/FSECT.DAT");
    const slusHead = disc.read("/SLUS_003.39").subarray(0, 64);

    const changed = Uint8Array.from(fsect);
    changed[0] ^= 0xff; // flip a byte (still 1 sector → stays in place)

    const { image } = disc.buildPatched(new Map([["/FSECT.DAT", changed]]));
    const rebuilt = new DiscImage(image, "us-patched");

    expect(rebuilt.nSectors).toBe(disc.nSectors); // in-place, no growth
    expect([...rebuilt.read("/FSECT.DAT")]).toEqual([...changed]);
    expect([...rebuilt.read("/SLUS_003.39").subarray(0, 64)]).toEqual([...slusHead]); // untouched file intact
  });

  it("buildPatchedTo streams byte-identical output to buildPatched (incl. append/grow)", { timeout: 120_000 }, async () => {
    const disc = new DiscImage(new Uint8Array(readFileSync(DISC)), "us");
    const fsect = disc.read("/FSECT.DAT");
    const grown = new Uint8Array(fsect.length + 4096); // grows past its extent → relocates + image grows
    grown.set(fsect, 0);
    const changes = new Map([["/FSECT.DAT", grown]]);

    const { image } = disc.buildPatched(changes);
    const sink = new BufferSink(disc.image.length);
    await disc.buildPatchedTo(changes, sink, []);

    expect(sink.bytes().length).toBe(image.length);
    expect(Buffer.compare(Buffer.from(sink.bytes()), Buffer.from(image))).toBe(0);
  });

  it("readIsoFiles lifts specific files via range reads, matching DiscImage.read", { timeout: 120_000 }, async () => {
    const img = new Uint8Array(readFileSync(DISC));
    const disc = new DiscImage(img, "us");
    // a couple of real files, including one in a subdirectory if present
    const wanted = ["/FSECT.DAT", "/SLUS_003.39"].filter((p) => disc.has(p));
    let bytesRead = 0;
    const read = async (off: number, len: number): Promise<Uint8Array> => {
      bytesRead += len;
      return img.subarray(off, off + len);
    };
    const got = await readIsoFiles(read, wanted);
    expect([...got.keys()].sort()).toEqual(wanted.map((p) => p.toUpperCase()).sort());
    for (const p of wanted) expect([...got.get(p.toUpperCase())!]).toEqual([...disc.read(p)]);
    expect(bytesRead).toBeLessThan(img.length / 4); // read only what's needed, not the whole disc
  });
});
