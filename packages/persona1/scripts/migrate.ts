#!/usr/bin/env tsx
// One-time migration: converts legacy override files to packages/persona1/patches/ XML format.
//
// Usage (from app/): npx tsx packages/persona1/scripts/migrate.ts [--root <game-loose-files-dir>]
//   --root <dir>  path containing ADV/E0.BIN etc., required for scene migration.
//
// Without --root, all formats except ADV scenes are migrated.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildXml } from "@p1p/core";
import { SectorArchive } from "@p1p/atlus";
import { parseScene } from "../src/script/sceneReader.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(PKG_DIR, "../../..");
const EN_DIR = join(PKG_DIR, "patches/persona1-en");

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf("--root");
const rootDir: string | undefined = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : undefined;

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  console.log("  wrote", path.replace(REPO_ROOT + "/", "").replace(/\\/g, "/"));
}

/** Convert text to multiline display format (same as resource.ts toMultiline). */
const toMultiline = (s: string): string => "\n" + s.replace(/\{nl\}/gu, "{nl}\n") + "\n";

// ─────────────────────────────────────────────────────────────────────────────
// Parse helpers for the old text.txt formats
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a block text file with `$N` slot markers. Returns an ordered [index, lines[]] array. */
function parseSlotFile(text: string): Array<[number, string[]]> {
  const blocks: Array<[number, string[]]> = [];
  let cur: [number, string[]] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith("#")) continue;
    const slot = /^\$(\d+)\s*$/.exec(line.trim());
    if (slot) {
      if (cur) blocks.push(cur);
      cur = [parseInt(slot[1], 10), []];
    } else if (cur && line.trim()) {
      cur[1].push(line);
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Battle dialogue → persona1-en/battle/dialogue.xml
// ─────────────────────────────────────────────────────────────────────────────
function migrateBattle(): void {
  const src = join(REPO_ROOT, "btl/override/text.txt");
  if (!existsSync(src)) {
    console.log("  skip: btl/override/text.txt not found"); return;
  }

  const ENTRY = /^\$([0-9a-fA-F]+)\s+(\d+)\s*\|\s*(.+)$/;
  const lines: Array<{ "@offset": string; "@portrait": number; "#text": string }> = [];

  for (const raw of readFileSync(src, "utf8").split(/\r?\n/)) {
    if (raw.startsWith("#") || !raw.trim()) continue;
    const m = ENTRY.exec(raw);
    if (m) {
      const offset = m[1].replace(/^0+(?=.)/, ""); // strip leading zeros
      lines.push({ "@offset": offset, "@portrait": parseInt(m[2], 10), "#text": toMultiline(m[3].trim()) });
    }
  }

  write(join(EN_DIR, "battle/dialogue.xml"), buildXml({ lines: { line: lines } }));
  console.log(`  battle: ${lines.length} lines`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Dungeon text → persona1-en/dungeon/<floor>.xml
// ─────────────────────────────────────────────────────────────────────────────
function migrateDungeon(): void {
  const dngDir = join(REPO_ROOT, "dng/override");
  if (!existsSync(dngDir)) {
    console.log("  skip: dng/override not found"); return;
  }

  for (const floor of readdirSync(dngDir)) {
    if (!statSync(join(dngDir, floor)).isDirectory()) continue;
    const src = join(dngDir, floor, "text.txt");
    if (!existsSync(src)) continue;

    const blocks = parseSlotFile(readFileSync(src, "utf8"));
    // Dungeon text already has {nl} inline; lines within a slot are joined without separator.
    const messages = blocks.map(([index, msgLines]) => ({
      "@index": index, "#text": toMultiline(msgLines.join("")),
    }));

    write(
      join(EN_DIR, `dungeon/${floor}.xml`),
      buildXml({ messages: { "@floor": floor, message: messages } }),
    );
    console.log(`  dungeon ${floor}: ${messages.length} messages`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Demon names → persona1-en/names/demons.xml
// 4. Persona names → persona1-en/names/personas.xml
// ─────────────────────────────────────────────────────────────────────────────
function migrateNames(subdir: string, table: string, outFile: string): void {
  const srcDir = join(REPO_ROOT, `tables/override/${subdir}`);
  if (!existsSync(srcDir)) {
    console.log(`  skip: tables/override/${subdir} not found`); return;
  }

  const entries: Array<{ "@index": number; "#text": string }> = [];
  for (const file of readdirSync(srcDir).sort()) {
    if (!file.endsWith(".toml")) continue;
    const toml = readFileSync(join(srcDir, file), "utf8");
    const idM = /^id\s*=\s*(\d+)/m.exec(toml);
    const nameM = /^name\s*=\s*"([^"]*)"/m.exec(toml);
    if (idM && nameM) entries.push({ "@index": parseInt(idM[1], 10), "#text": nameM[1] });
  }

  write(join(EN_DIR, outFile), buildXml({ names: { "@table": table, entry: entries } }));
  console.log(`  ${table}: ${entries.length} entries`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Skill names → persona1-en/skills.xml
// ─────────────────────────────────────────────────────────────────────────────
function migrateSkills(): void {
  const src = join(REPO_ROOT, "tables/override/skill_names/text.txt");
  if (!existsSync(src)) {
    console.log("  skip: tables/override/skill_names/text.txt not found"); return;
  }

  const skills: Array<{ "@id": number; name: string }> = [];
  for (const raw of readFileSync(src, "utf8").split(/\r?\n/)) {
    if (raw.startsWith("#") || !raw.trim()) continue;
    const m = /^\$(\d+)\t(.+)$/.exec(raw);
    if (m) skills.push({ "@id": parseInt(m[1], 10), name: m[2].trim() });
  }

  write(join(EN_DIR, "skills.xml"), buildXml({ skills: { skill: skills } }));
  console.log(`  skills: ${skills.length} entries`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. S2D overworld dialogue → persona1-en/overworld/dialogue.xml
// ─────────────────────────────────────────────────────────────────────────────
function migrateS2d(): void {
  const src = join(REPO_ROOT, "tables/override/s2d_dialogue/text.txt");
  if (!existsSync(src)) {
    console.log("  skip: tables/override/s2d_dialogue/text.txt not found"); return;
  }

  const blocks = parseSlotFile(readFileSync(src, "utf8"));
  // S2D text: real newlines in the file = {nl} line breaks in the game.
  const dialogues = blocks.map(([index, lines]) => ({
    "@index": index, "#text": toMultiline(lines.join("{nl}")),
  }));

  write(join(EN_DIR, "overworld/dialogue.xml"), buildXml({ dialogues: { dialogue: dialogues } }));
  console.log(`  s2d: ${dialogues.length} dialogues`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Code patches → patches/<dir>/code-patches/<id>.xml
// ─────────────────────────────────────────────────────────────────────────────
interface CodePatchSite { file: string; anchor: string; offset: number; width: number; value: number }
interface CodePatchEntry { id: string; name: string; description: string; sites: CodePatchSite[] }

const CODE_PATCH_DIRS: Record<string, string> = {
  "lower-encounter-rate": "lower-encounters",
  "faster-text": "faster-text",
  "faster-dungeon-movement": "faster-movement",
  "exp-multiplier": "exp-multiplier",
  "exp-share-even": "exp-share-even",
};

function migrateCodePatches(): void {
  const src = join(REPO_ROOT, "scn/code-patches.json");
  if (!existsSync(src)) {
    console.log("  skip: scn/code-patches.json not found"); return;
  }

  const patches = JSON.parse(readFileSync(src, "utf8")) as CodePatchEntry[];

  for (const patch of patches) {
    const dirName = CODE_PATCH_DIRS[patch.id] ?? patch.id;
    const patchDir = join(PKG_DIR, "patches", dirName);

    // Create patch.xml manifest if directory doesn't exist yet.
    const manifestPath = join(patchDir, "patch.xml");
    if (!existsSync(manifestPath)) {
      write(
        manifestPath,
        buildXml({
          patch: {
            "@id": dirName,
            "@version": "0.1.0",
            "@game": "persona1",
            "@priority": "10",
            name: patch.name,
            description: patch.description,
          },
        }),
      );
    }

    const site = patch.sites.map((s) => ({
      "@file": s.file,
      "@anchor": s.anchor,
      "@offset": s.offset,
      "@width": s.width,
      "@value": s.value,
    }));
    const xml = buildXml({
      "code-patch": {
        "@id": patch.id,
        "@name": patch.name,
        description: patch.description,
        site,
      },
    });

    write(join(patchDir, "code-patches", `${patch.id}.xml`), xml);
    console.log(`  code-patch ${patch.id}: ${patch.sites.length} site(s)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. ADV scenes → persona1-en/scenes/<archive>/<index>.xml
// ─────────────────────────────────────────────────────────────────────────────

/** Parse scene text.txt: slot-indexed format where real newlines = {nl} breaks. */
function parseSceneTxt(text: string): Array<[number, string]> {
  const blocks = parseSlotFile(text);
  return blocks.map(([slot, lines]) => [slot, lines.join("{nl}")]);
}

/**
 * Convert legacy ADV-decompiler markers to the new resource-codec syntax:
 *  - drop `{@name}` / `{@name:delta}` inline labels — zero-width pointer-relocation markers the new
 *    flat codec doesn't model (a later pass can reintroduce them as a scene attribute);
 *  - rewrite space-separated operands to ":"-separated ({wait_fr 88} → {wait_fr:88}, {say 0 1d8} →
 *    {say:0:1d8}). Operand VALUES are unchanged: the opcode tables and field render styles are
 *    identical between the old and new codecs, so only the separator differs.
 */
function convertMarkers(text: string): string {
  return text
    .replace(/\{@[^}]*\}/gu, "")
    .replace(/\{([a-z0-9_]+) ([^}]*)\}/gu, (_m, mnem: string, args: string) => `{${mnem}:${args.trim().replace(/ +/gu, ":")}}`);
}

function migrateScenes(): void {
  if (!rootDir) {
    console.log("  skip scenes: provide --root <game-dir> (needs ADV/E0.BIN…E3.BIN)");
    return;
  }

  const scnDir = join(REPO_ROOT, "scn/override");
  if (!existsSync(scnDir)) {
    console.log("  skip: scn/override not found"); return;
  }

  let total = 0;
  let missing = 0;

  for (const archive of ["e0", "e1", "e2", "e3"]) {
    const archiveDir = join(scnDir, archive);
    if (!existsSync(archiveDir) || !statSync(archiveDir).isDirectory()) continue;

    const binPath = join(rootDir, "ADV", `${archive.toUpperCase()}.BIN`);
    if (!existsSync(binPath)) {
      console.log(`  skip ${archive}: ${binPath} not found`);
      missing++;
      continue;
    }

    const arcBytes = new Uint8Array(readFileSync(binPath));
    const arc = SectorArchive.fromBytes(arcBytes);

    for (const sceneDirName of readdirSync(archiveDir).sort((a, b) => parseInt(a) - parseInt(b))) {
      const scenePath = join(archiveDir, sceneDirName);
      if (!statSync(scenePath).isDirectory()) continue;
      const sceneIndex = parseInt(sceneDirName, 10);
      if (isNaN(sceneIndex)) continue;

      const txtPath = join(scenePath, "text.txt");
      if (!existsSync(txtPath)) continue;

      const record = arc.records[sceneIndex];
      if (!record) {
        console.warn(`  warn: ${archive}/${sceneIndex} — record not in archive (index out of range)`);
        continue;
      }

      const sc = parseScene(record);
      const slots = parseSceneTxt(readFileSync(txtPath, "utf8"));

      const messages = slots
        .filter(([slot]) => slot < sc.messageOffsets.length)
        .map(([slot, text]) => ({
          "@offset": sc.messageOffsets[slot].toString(16),
          "#text": toMultiline(convertMarkers(text)),
        }));

      if (messages.length === 0) continue;

      write(
        join(EN_DIR, `scenes/${archive}/${sceneIndex}.xml`),
        buildXml({ scene: { "@archive": archive, "@scene": sceneIndex, message: messages } }),
      );
      total++;
    }
    console.log(`  ${archive}: done`);
  }

  console.log(`  scenes: ${total} scene file(s)${missing ? ` (${missing} archive(s) not found)` : ""}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
console.log("migrating legacy overrides → packages/persona1/patches/\n");

console.log("battle dialogue:");
migrateBattle();

console.log("\ndungeon text:");
migrateDungeon();

console.log("\nname tables:");
migrateNames("demon", "demon", "names/demons.xml");
migrateNames("persona", "persona", "names/personas.xml");

console.log("\nskill names:");
migrateSkills();

console.log("\ns2d dialogue:");
migrateS2d();

console.log("\ncode patches:");
migrateCodePatches();

console.log("\nADV scenes:");
migrateScenes();

console.log("\ndone.");
