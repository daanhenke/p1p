// The Persona 1 flavour of the generic setup wizard: branding, the US+JP disc inputs, the optional
// gameplay tweaks (each a shipped patch pack), background music, and the in-browser build. The wizard
// package knows nothing about Persona — it just renders this config.

import type { WizardConfig, ChangelogEntry, PatchSettingSpec } from "@p1p/wizard";
import { decodePack } from "@p1p/core";
import type { CodePatchSetting } from "@p1p/ps1";
import { buildPersona1 } from "./browserBuild.js";

const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.1.0",
    date: "2026-06-14",
    notes: [
      "Mostly finished initial machine translation of the story, cutscenes and dialogue.",
      "English names for Personas, demons, skills and items.",
      "Translated dungeon, battle and shop/overworld text.",
      "Optional: faster text speed for snappier dialogue.",
      "Optional: faster dungeon walking and turning — pick 2×, 3× or 4×.",
      "Optional: lower random-encounter rate for less grinding.",
      "Optional: bigger EXP rewards — pick ×2, ×4 or ×8.",
      "Optional: split EXP evenly across your whole party (only humans for now).",
    ],
  },
];

export const PERSONA1_CONFIG: WizardConfig = {
  title: "Megami Ibunroku Persona — English Setup",
  storageKey: "persona1-en-wizard",
  welcomeTitle: "Welcome to the Persona Retranslation Setup Wizard",
  welcomeBody: `<p>This wizard builds an English-retranslated <b>Megami Ibunroku Persona</b> disc from your own
copies of the US and Japanese PlayStation releases.</p>
<p>Everything runs in your browser — your disc images never leave your computer.</p>`,
  finishBody: "Open the patched .cue file in your emulator (DuckStation, Beetle PSX, …) and enjoy.",

  bannerImage: "/banner.jpg",
  bgImage: "/background.jpg",
  bgColor: "#0a7a52",

  bgMusic: {
    autoplay: true,
    tracks: [
      { url: "/ost/p1/207 Dungeon ~ Ice Castle.psf", label: "Dungeon ~ Ice Castle", backend: "psf" },
    ],
  },

  mode: "build",
  roms: [
    {
      id: "us",
      label: "Revelations: Persona (US)",
      sublabel: "the disc we rebuild in English",
      hint: "Persona (USA).bin",
      accept: ".bin,.img,.iso",
      hashes: ["3e7d8019a3191a29a48bb9d574cf05b1bc998c06"],
    },
    {
      id: "jp",
      label: "Megami Ibunroku Persona (JP)",
      sublabel: "the original Japanese release",
      hint: "…(Japan).bin",
      accept: ".bin,.img,.iso",
      hashes: ["1c42967cc4f7daadea81bbd2b00fba33052224b0"],
    },
  ],

  // The optional tweaks (the base translation is applied automatically). Ids match the patch packs;
  // the EXP-multiplier and movement-speed knobs are hydrated from the packs by hydratePatchSettings().
  patches: [
    { id: "faster-text", name: "Faster Text", description: "ADV dialogue scrolls noticeably faster.", defaultOn: true },
    { id: "faster-movement", name: "Faster Movement", description: "Snappier walking and turning in dungeons." },
    { id: "lower-encounters", name: "Lower Encounter Rate", description: "Random battles trigger less often." },
    { id: "exp-multiplier", name: "EXP Multiplier", description: "Awards extra EXP after each battle.", defaultOn: false },
    { id: "exp-share-even", name: "Even EXP Split", description: "Every party member shares EXP equally." },
  ],

  allowCustomBins: false,
  changelog: CHANGELOG,
  build: buildPersona1,

  // Optional self-hosted analytics; baked from env at build time (empty ⇒ off). Version/commit ride
  // along with the per-build event so we can tell which release produced a given disc.
  analytics: {
    umamiSrc: import.meta.env.VITE_UMAMI_SRC,
    umamiId: import.meta.env.VITE_UMAMI_ID,
  },
  version: import.meta.env.VITE_WIZARD_VERSION || CHANGELOG[0].version,
  commit: import.meta.env.VITE_GIT_COMMIT || "dev",
};

// Settings live in the compiled patch packs (authored in each patch's code-patch XML). Before the
// wizard mounts we fetch the small optional packs, decode them, and copy any embedded settings onto
// the matching PatchSpec so the UI can render the knobs — a single source of truth, the .bin.
export async function hydratePatchSettings(config: WizardConfig): Promise<void> {
  await Promise.all((config.patches ?? []).map(async (patch) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}patches/${patch.id}.bin`);
      if (!res.ok) return;
      const pack = decodePack(new Uint8Array(await res.arrayBuffer()));
      const settings: PatchSettingSpec[] = [];
      for (const ov of pack.overrides) {
        if (ov.datatype !== "code-patch") continue;
        const embedded = (ov.value as { settings?: CodePatchSetting[] }).settings;
        if (embedded?.length) settings.push(...embedded);
      }
      if (settings.length) patch.settings = settings;
    } catch { /* offline / pack missing — patch stays a plain toggle */ }
  }));
}
