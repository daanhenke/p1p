// CD-ROM sector framing + EDC/ECC. PSX .bin sectors are 2352 raw bytes (sync + header + 2048 user
// + EDC/ECC); Mode1 and Mode2/Form1 are both used by PSX discs. Neill Corlett's public-domain
// EDC/ECC. Ports web/src/core/disc/ecc.ts (itself a port of src/persona1/disc.py's sector half).

export const RAW = 2352; // raw .bin sector (sync+header+data+EDC+ECC)
export const DATA = 2048; // ISO logical sector / user data
const SYNC = Uint8Array.of(0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00);

// ---- look-up tables (Corlett) ----
const ECC_F = new Uint8Array(256);
const ECC_B = new Uint8Array(256);
const EDC_LUT = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  const j = ((i << 1) ^ (i & 0x80 ? 0x11d : 0)) & 0xff;
  ECC_F[i] = j;
  ECC_B[(i ^ j) & 0xff] = i;
  let e = i;
  for (let k = 0; k < 8; k++) e = ((e >>> 1) ^ (e & 1 ? 0xd8018001 : 0)) >>> 0;
  EDC_LUT[i] = e >>> 0;
}

export function edcCompute(data: Uint8Array): number {
  let e = 0;
  for (let i = 0; i < data.length; i++) {
    e = ((e >>> 8) ^ EDC_LUT[(e ^ data[i]) & 0xff]) >>> 0;
  }
  return e >>> 0;
}

function eccBlock(s: Uint8Array, majorCount: number, minorCount: number, majorMult: number, minorInc: number): void {
  const size = majorCount * minorCount;
  const base = 12 + size;
  for (let major = 0; major < majorCount; major++) {
    let idx = (major >> 1) * majorMult + (major & 1);
    let a = 0;
    let b = 0;
    for (let n = 0; n < minorCount; n++) {
      const t = s[12 + idx];
      idx += minorInc;
      if (idx >= size) idx -= size;
      a ^= t;
      b ^= t;
      a = ECC_F[a];
    }
    a = ECC_B[(ECC_F[a] ^ b) & 0xff];
    s[base + major] = a;
    s[base + major + majorCount] = (a ^ b) & 0xff;
  }
}

/** Regenerate Mode1 P+Q ECC over header+data+EDC (the address is part of the parity). */
export function eccGenerate(s: Uint8Array): void {
  eccBlock(s, 86, 24, 2, 86); // P parity -> offset 2076
  eccBlock(s, 52, 43, 86, 88); // Q parity -> offset 2248
}

const bcd = (n: number): number => ((Math.floor(n / 10) << 4) | n % 10) & 0xff;

export function lbaToMsfBcd(lba: number): Uint8Array {
  const a = lba + 150; // 2-second pregap
  const m = Math.floor(a / (75 * 60));
  const r = a % (75 * 60);
  const sec = Math.floor(r / 75);
  const fr = r % 75;
  return Uint8Array.of(bcd(m), bcd(sec), bcd(fr));
}

function setU32LE(buf: Uint8Array, off: number, val: number): void {
  buf[off] = val & 0xff;
  buf[off + 1] = (val >>> 8) & 0xff;
  buf[off + 2] = (val >>> 16) & 0xff;
  buf[off + 3] = (val >>> 24) & 0xff;
}

function placeData(s: Uint8Array, off: number, data: Uint8Array): void {
  s.set(data.subarray(0, Math.min(data.length, DATA)), off); // remaining bytes stay zero (ljust pad)
}

export function makeMode1Sector(lba: number, data2048: Uint8Array): Uint8Array {
  const s = new Uint8Array(RAW);
  s.set(SYNC, 0);
  s.set(lbaToMsfBcd(lba), 12);
  s[15] = 1;
  placeData(s, 16, data2048);
  setU32LE(s, 2064, edcCompute(s.subarray(0, 2064)));
  // s[2068:2076] stay zero (intermediate field)
  eccGenerate(s);
  return s;
}

// Mode2/Form1 subheaders (file=0, channel=0): 0x08 = data, 0x89 = data+EOF+EOR (last sector).
const SUB_DATA = Uint8Array.of(0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08, 0x00);
const SUB_EOF = Uint8Array.of(0x00, 0x00, 0x89, 0x00, 0x00, 0x00, 0x89, 0x00);

export function makeMode2Form1Sector(lba: number, data2048: Uint8Array, last = false): Uint8Array {
  const s = new Uint8Array(RAW);
  s.set(SYNC, 0);
  s.set(lbaToMsfBcd(lba), 12);
  s[15] = 2;
  s.set(last ? SUB_EOF : SUB_DATA, 16);
  placeData(s, 24, data2048);
  setU32LE(s, 2072, edcCompute(s.subarray(16, 2072)));
  s[12] = s[13] = s[14] = s[15] = 0; // Form1 ECC excludes the header address
  eccGenerate(s);
  s.set(lbaToMsfBcd(lba), 12);
  s[15] = 2;
  return s;
}

/** Recompute EDC/ECC in place for a sector whose user bytes were edited (mode from byte 15). */
export function fixSectorEcc(raw: Uint8Array): void {
  if (raw[15] === 2) {
    setU32LE(raw, 2072, edcCompute(raw.subarray(16, 2072)));
    const hdr = raw.slice(12, 16);
    raw[12] = raw[13] = raw[14] = raw[15] = 0;
    eccGenerate(raw);
    raw.set(hdr, 12);
  } else {
    setU32LE(raw, 2064, edcCompute(raw.subarray(0, 2064)));
    eccGenerate(raw);
  }
}

export function makeSector(mode: number, lba: number, data2048: Uint8Array, last = false): Uint8Array {
  return mode === 2 ? makeMode2Form1Sector(lba, data2048, last) : makeMode1Sector(lba, data2048);
}
