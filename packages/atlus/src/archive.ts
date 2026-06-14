// Sector-table archive (ADV E*.BIN, MES.BIN). Ports web/src/core/archive.ts / src/persona1/archive.py.
// Sector 0 is a u16[] LE table of sector offsets; record i spans sectors [tab[i], tab[i+1]); the final
// table entry == total size in sectors. The same table is mirrored into the boot exe (EXE_SECTOR_TABLES).

export const SECTOR = 0x800;

/** EXE-embedded copies of the sector tables (virtual addr in Persona.exe, base 0x400000). */
export const EXE_SECTOR_TABLES: Record<string, number> = {
  "E0.BIN": 0x0057946c,
  "E1.BIN": 0x00579630,
  "E2.BIN": 0x005797f4,
  "E3.BIN": 0x005799d8,
  "MES.BIN": 0x005774a4,
};

function packU16Table(tab: number[]): Uint8Array {
  const out = new Uint8Array(tab.length * 2);
  for (let i = 0; i < tab.length; i++) {
    out[i * 2] = tab[i] & 0xff;
    out[i * 2 + 1] = (tab[i] >>> 8) & 0xff;
  }
  return out;
}

export class SectorArchive {
  constructor(public table: number[], public records: Uint8Array[]) {}

  static fromBytes(data: Uint8Array): SectorArchive {
    const tab: number[] = [];
    let i = 0;
    while (i * 2 + 1 < data.length) {
      const v = data[i * 2] | (data[i * 2 + 1] << 8);
      if (v === 0 || (tab.length && v < tab[tab.length - 1])) break;
      tab.push(v);
      i++;
    }
    const recs: Uint8Array[] = [];
    for (let k = 0; k < tab.length - 1; k++) recs.push(data.subarray(tab[k] * SECTOR, tab[k + 1] * SECTOR));
    return new SectorArchive(tab, recs);
  }

  get count(): number { return this.records.length; }

  /**
   * Recompute the table from current records and emit { blob, table }. Each record is padded up to
   * a sector boundary; sector 0 holds the table.
   */
  rebuild(): { blob: Uint8Array; table: number[] } {
    let total = SECTOR; // sector 0 reserved for the table
    const tab = [1]; // record 0 starts at sector 1
    const offsets: number[] = [];
    for (const rec of this.records) {
      const pad = (SECTOR - (rec.length % SECTOR)) % SECTOR;
      offsets.push(total);
      total += rec.length + pad;
      tab.push(total / SECTOR);
    }
    const out = new Uint8Array(total);
    this.records.forEach((rec, k) => out.set(rec, offsets[k]));
    out.set(packU16Table(tab), 0);
    return { blob: out, table: tab };
  }

  /** The raw bytes to write at the EXE-embedded sector table for this archive. */
  makeExeTableBytes(): Uint8Array { return packU16Table(this.rebuild().table); }
}
