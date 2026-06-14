// Persona 1 (Megami Ibunroku Persona, US — SLUS_003.39) build profile. For now this assembles the
// Profile inline in code; the data here (bootExe, glyph maps, table specs) is exactly the content
// that P3 will externalise into a generated GameManifest the build-once wizard loads at runtime.

import { DatatypeRegistry, type Profile } from "@p1p/core";
import { CodePatchDatatype } from "@p1p/ps1";
import { Glyph, type GlyphTable } from "./text/glyph.js";
import { NameTableDatatype, type NameSubTable } from "./datatypes/nameTable.js";
import { StringTableDatatype, type StringTableSpec } from "./datatypes/stringTable.js";
import { DungeonTextDatatype } from "./datatypes/dungeonText.js";
import { BattleDialogueDatatype } from "./datatypes/battleDialogue.js";
import { AdvSceneDatatype, type SceneArchive } from "./datatypes/advScene.js";
import { S2dDialogueDatatype } from "./datatypes/s2dDialogue.js";
import { ExeTextDatatype } from "./datatypes/exeText.js";
import { SkillsDatatype, type SkillsSpec } from "./datatypes/skills.js";
import { ItemsDatatype, type ItemsSpec } from "./datatypes/items.js";
import usGlyphMap from "./data/glyphmap.us.json";
import jpGlyphMap from "./data/glyphmap.jp.json";

const EXE_RAM = 0x8000f800; // SLUS boot exe: RAM = file_off + EXE_RAM
const SLOT_RAM = 0x80065a84; // overlay slot (btlp/s2d/dng/adv)
const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, i) => a + i);

const usGlyph = new Glyph(usGlyphMap as GlyphTable);
const jpGlyph = new Glyph(jpGlyphMap as GlyphTable);

/** Fixed-stride name tables in the US boot exe (stats kept as read-only reference fields). */
const nameSubtables: NameSubTable[] = [
  {
    table: "demon", file: "exe", stride: 0x38, nameOff: 0x00, nameLen: 0x0a, base: 0x32498, count: 186,
    bundle: "demons.xml",
    fields: [
      { off: 0x0a, name: "level", width: 1 }, { off: 0x0b, name: "order", width: 1 },
      { off: 0x0c, name: "strength", width: 1 }, { off: 0x0d, name: "vitality", width: 1 },
      { off: 0x0e, name: "dexterity", width: 1 }, { off: 0x0f, name: "agility", width: 1 },
      { off: 0x10, name: "luck", width: 1 },
    ],
  },
  { table: "persona", file: "exe", stride: 0x2c, nameOff: 0x0c, nameLen: 0x0a, base: 0x3c640, count: 57, bundle: "personas.xml" },
];

// The skill display name's second inline copy: the SLUS skill-menu table (all 243 skills, name @+4 —
// Fire/Blaze/Inferno…, used by the battle skill menu), aligned 1:1 with the btlp pointer table. It's
// the skill <menu> tag (defaults to <name>; set explicitly only when the full name won't fit its 12B
// field, e.g. "Omega Cluster"). NOT skill_data @0x396dc — that's a SEPARATE 78-entry physical-skill
// record array (ParaBite/ViriNail/Tackle) with its own ordering; it is not a copy of the display
// names and is left untouched (its own name table, if ever translated, like demon/persona).
const skillMenuNames: NameSubTable = {
  table: "skill_menu", file: "exe", stride: 0x14, nameOff: 0x04, nameLen: 0x0c, base: 0x38a00, count: 243,
};

// skill names (btlp pointer table). Skill descriptions are NOT a skills field — the slus menu-strings
// pool isn't skill-indexed; item/effect descriptions are owned by descriptions.xml (see below).
const skillNamesSpec: StringTableSpec = {
  id: "skill-names", group: "skills", file: "/BTLP.BIN", ram: SLOT_RAM, ptrBase: 0x73794, count: 243, term: 0xf5, grow: "append",
};
const menuStringsSpec: StringTableSpec = {
  id: "menu-strings", group: "menu-strings", file: "exe", ram: EXE_RAM, ptrBase: 0x3b860, count: 405,
  grow: "slack", slack: [[0x40858, 0x1070], [0x47801, 0x7ff]],
  mirror: { file: "/BTLP.BIN", ram: SLOT_RAM, ptrBase: 0x73794, count: 347, term: 0xf5, grow: "append", fromIndex: 328 },
};

const skillsSpec: SkillsSpec = {
  count: 243, names: skillNamesSpec, nameCopies: [skillMenuNames],
};

// items: the primary names live in the slus inline item table (0x350e0, stride 0x20, name @+0xc, ID
// order). The 13 gems (menu-strings 328..343, icon-prefixed) also copy to btlp via the menu-strings
// mirror. Effect descriptions are shared, so they live in their own group (not items.xml).
const itemTable: NameSubTable = {
  table: "item", file: "exe", stride: 0x20, nameOff: 0x0c, nameLen: 0x0a, base: 0x350e0, count: 396,
};
const itemsSpec: ItemsSpec = { table: itemTable, menuNames: menuStringsSpec, menuRange: [328, 344] };

/** ADV scene archives (E0–E3.BIN): each a SectorArchive of scene records, keyed by a short name. */
const sceneArchives: SceneArchive[] = [
  { name: "e0", file: "/ADV/E0.BIN" }, { name: "e1", file: "/ADV/E1.BIN" },
  { name: "e2", file: "/ADV/E2.BIN" }, { name: "e3", file: "/ADV/E3.BIN" },
];

/** Standalone pointer-array string tables (overworld locations; skill/item strings live in entities). */
const stringTables: StringTableSpec[] = [
  // overworld location names (Lunarvale, St.Hermelin, …) in the s2d overlay → overworld/locations.xml.
  {
    id: "overworld-locations", group: "overworld", file: "/S2D.BIN", ram: SLOT_RAM,
    ptrBase: 0x407e4, count: 47, grow: "append", bundle: "locations.xml",
  },
  // item/effect descriptions: the menu-strings slots that aren't skill descs (0..242, in skills.xml)
  // or gem names (328..343, in items.xml). Effect-shared (non-unique), so their own group.
  {
    id: "descriptions", group: "", file: "exe", ram: EXE_RAM, ptrBase: 0x3b860, count: 405,
    grow: "slack", slack: [[0x40858, 0x1070], [0x47801, 0x7ff]], bundle: "descriptions.xml",
    indices: [...range(243, 328), ...range(344, 405)],
  },
];

export const persona1: Profile = {
  id: "persona1",
  name: "Megami Ibunroku Persona (US)",
  data: {
    bootExe: "/SLUS_003.39",
    glyph: { us: usGlyph, jp: jpGlyph },
    // Multi-disc build: the scene archives (whose English text overlays the JP scene/script/art) are
    // sourced from the JP disc (`build --jp`); everything else comes from the US disc, which is the
    // image actually rebuilt.
    secondaryPaths: sceneArchives.map((a) => a.file),
    // image archives the `dump` gfx step decodes (TIM concatenations; ADVCHR is RLE-packed, MES is a
    // sector archive of TIM records). The dump skips any that hold no images, so the list can be broad.
    gfx: [
      "/ADV/ADVCMD.BIN", "/ADV/ADVCMD0.BIN", "/ADV/ADVCHR.BIN", "/ADV/BST.BIN", "/ADV/PER.BIN",
      "/ADV/TYNCHR.BIN", "/ADV/MES.BIN", "/ADV/P00.BIN", "/ADV/KAGE.BIN", "/ADV/DVL.BIN",
      "/ADV/TYN01.BIN", "/ADV/TYNSE.BIN",
      "/2D/2DMDL00.BIN", "/2D/2DMDL01.BIN", "/2D/2DMDL02.BIN", "/2D/2DMDL03.BIN", "/2D/2DMDL04.BIN",
      "/2D/2DMDL05.BIN", "/2D/2DMDL06.BIN",
      "/2D/2DLTS00.BIN", "/2D/2DLTS01.BIN", "/2D/2DLTS02.BIN", "/2D/2DLTS03.BIN",
      "/B/BF.BIN", "/B/D.BIN", "/B/G.BIN", "/B/M.BIN", "/B/P.BIN",
      "/EXE/END.BIN",
    ],
  },
  datatypes: new DatatypeRegistry([
    new NameTableDatatype(nameSubtables, usGlyph),
    ...stringTables.map((spec) => new StringTableDatatype(spec, usGlyph)),
    new DungeonTextDatatype(usGlyph, jpGlyph),
    new BattleDialogueDatatype(usGlyph),
    new AdvSceneDatatype(usGlyph, sceneArchives),
    new S2dDialogueDatatype(usGlyph, jpGlyph, "/S2D.BIN", SLOT_RAM),
    new SkillsDatatype(usGlyph, skillsSpec),
    new ItemsDatatype(usGlyph, itemsSpec),
    new ExeTextDatatype(usGlyph),
    new CodePatchDatatype(),
  ]),
};
