import { ref, computed, watch } from "vue";
import type { WizardConfig, StepId, DestDir, RomStatus, PatchSettings } from "./types.js";
import { hashFileSha1 } from "./sha1.js";

const storageKey = (cfg: WizardConfig, ns: string): string =>
  `p1p-wizard:${ns}:${cfg.storageKey ?? cfg.title}`;

// Persist the user's optional-patch selection across sessions, keyed per wizard.
function loadEnabledPatches(cfg: WizardConfig): Set<string> {
  const valid = new Set((cfg.patches ?? []).map((p) => p.id));
  try {
    const saved = localStorage.getItem(storageKey(cfg, "patches"));
    if (saved) return new Set((JSON.parse(saved) as string[]).filter((id) => valid.has(id)));
  } catch { /* no/blocked storage — fall back to defaults */ }
  return new Set((cfg.patches ?? []).filter((p) => p.defaultOn).map((p) => p.id));
}

/** Each settings-bearing patch → its setting defaults; overlaid with any valid persisted choices. */
function loadPatchSettings(cfg: WizardConfig): PatchSettings {
  const out: PatchSettings = {};
  for (const p of cfg.patches ?? []) {
    if (p.settings?.length) out[p.id] = Object.fromEntries(p.settings.map((s) => [s.id, s.default]));
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(cfg, "settings")) ?? "{}");
    for (const p of cfg.patches ?? []) {
      for (const s of p.settings ?? []) {
        const v = saved?.[p.id]?.[s.id];
        if (typeof v === "string" && s.options.some((o) => o.value === v)) out[p.id][s.id] = v;
      }
    }
  } catch { /* no/blocked storage — keep defaults */ }
  return out;
}

function buildSteps(cfg: WizardConfig): StepId[] {
  const steps: StepId[] = ["welcome"];
  if (cfg.changelog?.length) steps.push("changelog");
  if (cfg.mode === "build" && cfg.roms?.length) steps.push("roms");
  if (cfg.patches?.length || cfg.allowCustomBins) steps.push("patches");
  if (cfg.mode === "build") steps.push("destination");
  steps.push("installing");
  steps.push("finish");
  return steps;
}

export function useWizard(cfg: WizardConfig) {
  const steps = buildSteps(cfg);
  const stepIdx = ref(0);
  const step = computed<StepId>(() => steps[stepIdx.value] ?? "welcome");

  const romFiles = ref<Record<string, File | null>>(
    Object.fromEntries((cfg.roms ?? []).map((r) => [r.id, null])),
  );

  // Per-ROM hash verification. Each newly-selected file with declared hashes is checked once against
  // its spec's known-good SHA-1s; a mismatch warns but never blocks (dumps legitimately vary).
  const romStatus = ref<Record<string, RomStatus>>(
    Object.fromEntries((cfg.roms ?? []).map((r) => [r.id, "unknown" as RomStatus])),
  );
  // 0→1 hashing progress per ROM while its status is "checking" (a ~700 MB hash isn't instant).
  const romProgress = ref<Record<string, number>>({});
  const setStatus = (id: string, s: RomStatus) => { romStatus.value = { ...romStatus.value, [id]: s }; };
  const setProgress = (id: string, p: number) => { romProgress.value = { ...romProgress.value, [id]: p }; };
  const checked = new Map<string, File | null>();
  watch(romFiles, (files) => {
    for (const spec of cfg.roms ?? []) {
      const file = files[spec.id] ?? null;
      if (checked.get(spec.id) === file) continue; // already verified this exact file
      checked.set(spec.id, file);
      if (!file || !spec.hashes?.length) {
        setStatus(spec.id, "unknown");
        continue;
      }
      const accepted = new Set(spec.hashes.map((h) => h.toLowerCase()));
      setStatus(spec.id, "checking");
      setProgress(spec.id, 0);
      hashFileSha1(file, (frac) => {
        if (romFiles.value[spec.id] === file) setProgress(spec.id, frac);
      }).then((hex) => {
        if (romFiles.value[spec.id] !== file) return; // superseded by a newer pick
        setStatus(spec.id, accepted.has(hex.toLowerCase()) ? "ok" : "mismatch");
      }).catch(() => {
        // Hashing failed (e.g. read error) — don't leave it stuck "checking"; just don't vouch for it.
        if (romFiles.value[spec.id] === file) setStatus(spec.id, "unknown");
      });
    }
  }, { deep: true });

  const enabledPatches = ref<Set<string>>(loadEnabledPatches(cfg));
  // PatchesPane replaces the Set on each toggle, so a shallow watch persists every change.
  watch(enabledPatches, (s) => {
    try { localStorage.setItem(storageKey(cfg, "patches"), JSON.stringify([...s])); } catch { /* ignore */ }
  });

  const patchSettings = ref<PatchSettings>(loadPatchSettings(cfg));
  watch(patchSettings, (s) => {
    try { localStorage.setItem(storageKey(cfg, "settings"), JSON.stringify(s)); } catch { /* ignore */ }
  }, { deep: true });

  const customBins = ref<File[]>([]);
  const dest = ref<DestDir | null>(null);
  const log = ref<string[]>([]);
  const buildError = ref<string | null>(null);
  const buildDone = ref<string | null>(null);
  const building = ref(false);
  const confirmCancel = ref(false);

  // Optional ROMs don't gate progress; only the required ones must be supplied.
  const allRomsFilled = computed(() =>
    (cfg.roms ?? []).every((r) => r.optional || !!romFiles.value[r.id]),
  );

  // Downloading to the browser's Downloads folder is the default; picking a folder is an optional
  // override (only offered where the File System Access API exists).
  const destLabel = computed(() =>
    dest.value ? `…\\${dest.value.name}` : "Downloads (browser default)",
  );

  const canBack = computed(() => {
    const i = stepIdx.value;
    const s = step.value;
    if (s === "welcome" || s === "finish") return false;
    if (s === "installing") return !building.value && !!buildError.value;
    return i > 0;
  });

  const canNext = computed(() => {
    const s = step.value;
    if (s === "roms") return allRomsFilled.value;
    // Destination never gates: download-to-Downloads is the default; a picked folder is optional.
    if (s === "installing") return false;
    return true;
  });

  const nextLabel = computed(() => {
    const s = step.value;
    if (s === "destination") return "Install >";
    if (s === "patches" && cfg.mode === "download") return "Download >";
    if (s === "finish") return "Finish";
    return "Next >";
  });

  function back() {
    if (!canBack.value) return;
    if (step.value === "installing") {
      stepIdx.value = steps.indexOf("destination");
      return;
    }
    stepIdx.value = Math.max(0, stepIdx.value - 1);
  }

  async function next() {
    if (!canNext.value) return;
    const s = step.value;
    if (s === "destination" || (s === "patches" && cfg.mode === "download")) {
      await startBuild();
      return;
    }
    if (s === "finish") {
      restart();
      return;
    }
    stepIdx.value = Math.min(steps.length - 1, stepIdx.value + 1);
  }

  async function startBuild() {
    stepIdx.value = steps.indexOf("installing");
    building.value = true;
    buildError.value = null;
    buildDone.value = null;
    log.value = [];
    try {
      if (cfg.mode === "download" && cfg.downloadUrl) {
        const a = document.createElement("a");
        a.href = cfg.downloadUrl;
        if (cfg.downloadFilename) a.download = cfg.downloadFilename;
        a.click();
        buildDone.value = `Download started: ${cfg.downloadFilename ?? "patch"}`;
      } else if (cfg.mode === "build" && cfg.build) {
        // Pass only the ROMs the user actually supplied (optional ones may be absent).
        const roms = Object.fromEntries(
          (cfg.roms ?? []).map((r) => [r.id, romFiles.value[r.id]]).filter(([, f]) => !!f),
        ) as Record<string, File>;
        // Forward only the enabled patches' chosen settings.
        const enabled = enabledPatches.value;
        const chosen: PatchSettings = {};
        for (const [pid, vals] of Object.entries(patchSettings.value)) {
          if (enabled.has(pid)) chosen[pid] = vals;
        }
        const res = await cfg.build(roms, [...enabled], dest.value, (m) => log.value.push(m), chosen);
        buildDone.value = res.summary;
      } else {
        throw new Error("No build function configured");
      }
      stepIdx.value = steps.indexOf("finish");
    } catch (e) {
      buildError.value = (e as Error)?.message ?? String(e);
    } finally {
      building.value = false;
    }
  }

  function restart() {
    stepIdx.value = 0;
    buildDone.value = null;
    buildError.value = null;
    log.value = [];
  }

  async function pickDest() {
    // Request read-write up front (matching the old web/ app) so writing the .bin/.cue afterwards
    // doesn't need a second permission prompt. `startIn` opens at the Downloads folder.
    type Picker = {
      showDirectoryPicker(o?: { id?: string; mode?: "read" | "readwrite"; startIn?: string }): Promise<FileSystemDirectoryHandle>;
    };
    try {
      const handle = await (window as unknown as Picker).showDirectoryPicker({
        id: "p1p-wizard-out",
        mode: "readwrite",
        startIn: "downloads",
      });
      dest.value = { name: handle.name, handle };
    } catch (e) {
      // The user cancelling the dialog throws AbortError — a no-op. Surface anything else (a real
      // failure) to the console rather than swallowing it silently, but keep the download fallback.
      if ((e as Error)?.name !== "AbortError") console.error("Folder picker failed:", e);
    }
  }

  const progress = computed(() =>
    buildDone.value ? 100 : building.value ? Math.min(95, log.value.length * 7) : 0,
  );

  return {
    step, steps, stepIdx,
    romFiles, romStatus, romProgress, enabledPatches, patchSettings, customBins, dest, destLabel,
    log, buildError, buildDone, building, confirmCancel,
    canBack, canNext, nextLabel, progress,
    back, next, pickDest, restart,
  };
}
