import type { WizardConfig, ChangelogEntry } from "../src/types.js";
import type { MusicTrack } from "../src/music/types.js";

export const DUMMY_CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.0.0",
    date: "2025-01-01",
    notes: [
      "Initial release of the generic setup wizard.",
      "Supports ROM upload, optional patches, and destination picking.",
      "Theme switcher: Windows 3.1, 98, XP, 7.",
    ],
  },
  {
    version: "0.9.0",
    date: "2024-12-15",
    notes: [
      "Added background music support with WebAudio and PSF backends.",
      "Separate banner and background image configuration.",
    ],
  },
];

export const DUMMY_CONFIG: WizardConfig = {
  title: "Generic Patcher — Setup",
  version: "1.0.0",
  commit: "devbuild",
  welcomeTitle: "Welcome to the Generic Patcher Setup Wizard",
  welcomeBody: `<p>This wizard applies your selected patches to the ROM images you supply.</p>
<p>Everything runs in your browser — your ROM images never leave your computer.</p>`,
  finishBody: "Open the patched .cue file in your emulator.",
  // Autoplay a shuffled webPSX playlist — starts on load, or the first click if the browser blocks it.
  // The two demo tracks ship in this package under dev/ost (served at /ost by the dev vite config).
  bgMusic: {
    autoplay: true,
    order: "shuffle",
    tracks: [
      { url: "/ost/p1/117 Bar Violated by the Harem Queen.psf", label: "Bar Violated by the Harem Queen", backend: "psf" },
      { url: "/ost/p1/331 Velvet Room.psf", label: "Velvet Room", backend: "psf" },
    ],
  },
  mode: "build",
  roms: [
    // Example known-good hashes — drop in a file whose SHA-1 matches to see the "verified" badge.
    { id: "rom1", label: "Primary ROM", sublabel: "code base", hint: "game_us.bin", accept: ".bin,.iso,.img", optional: true, hashes: ["da39a3ee5e6b4b0d3255bfef95601890afd80709"] },
    { id: "rom2", label: "Secondary ROM", sublabel: "scene data", hint: "game_jp.bin", accept: ".bin,.iso,.img", optional: true },
  ],
  patches: [
    {
      id: "faster-text", name: "Faster text speed", description: "Typewriter rendering speed.",
      settings: [{
        id: "text-speed", label: "Text speed", default: "2x",
        options: [{ value: "1x", label: "Normal" }, { value: "2x", label: "2× (fast)" }, { value: "instant", label: "Instant" }],
      }],
    },
    { id: "lower-encounters", name: "Lower random encounters", description: "Encounter rate roughly halved." },
    {
      id: "faster-movement", name: "Faster dungeon movement", description: "Walking and turning speed.",
      settings: [{
        id: "movement-speed", label: "Movement speed", description: "Per-frame step multiplier.", default: "2x",
        options: [{ value: "2x", label: "2× (smooth)" }, { value: "3x", label: "3× (fast)" }, { value: "4x", label: "4× (very fast)" }],
      }],
    },
    {
      id: "exp-x2", name: "EXP multiplier", description: "Extra EXP from all battles.", defaultOn: false,
      settings: [{
        id: "exp-multiplier", label: "EXP multiplier", default: "x2",
        options: [{ value: "x2", label: "2×" }, { value: "x4", label: "4×" }, { value: "x8", label: "8×" }],
      }],
    },
    { id: "exp-share-even", name: "Even EXP distribution", description: "All party members share EXP equally." },
  ],
  allowCustomBins: true,
  changelog: DUMMY_CHANGELOG,
  build: async (_roms, patches, _dest, onLog, patchSettings) => {
    onLog("Build started (dummy)…");
    await new Promise((r) => setTimeout(r, 600));
    onLog(`Applying ${patches.length} patch(es)…`);
    for (const [pid, vals] of Object.entries(patchSettings)) {
      onLog(`  ${pid}: ${Object.entries(vals).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
    await new Promise((r) => setTimeout(r, 800));
    onLog("Rebuilding ISO file table…");
    await new Promise((r) => setTimeout(r, 500));
    onLog("Done.");
    return { summary: "Saved dummy_patched.bin + .cue (dummy run)" };
  },
};

// The PSF demo tracks bundled in dev/ost (served at /ost by the dev vite config).
const P1 = (file: string, label: string): MusicTrack => ({
  id: `p1-${file}`, label: `P1 — ${label}`,
  url: `/ost/p1/${file}`, psflib: "/ost/p1/p1.psflib", backend: "psf",
});

export const DEMO_TRACKS: MusicTrack[] = [
  P1("117 Bar Violated by the Harem Queen.psf", "Bar Violated by the Harem Queen"),
  P1("331 Velvet Room.psf", "Velvet Room"),
];
