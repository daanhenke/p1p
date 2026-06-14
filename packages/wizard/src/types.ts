import type { MusicBackendId } from "./music/types.js";

export type ThemeId = "98" | "xp" | "7";

export interface BgTrack {
  url: string;
  /** Display name shown in the footer "now playing" ticker. Defaults to the filename. */
  label?: string;
  /** Playback engine. Inferred from the file extension when omitted (.psf/.minipsf → webPSX). */
  backend?: MusicBackendId;
  /** For a minipsf, the sample library it depends on (usually resolved automatically). */
  psflib?: string;
}

export interface BgMusicConfig extends Partial<BgTrack> {
  /** A playlist. When present it takes precedence over the single `url`; one track loops, several
      play back-to-back. */
  tracks?: BgTrack[];
  /** Order across a multi-track playlist. Default "sequential". */
  order?: "sequential" | "shuffle";
  /** Start playing as soon as the wizard can — on load if the browser allows, otherwise on the
      first user interaction. Off by default (the mute button in the title bar always works). */
  autoplay?: boolean;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  notes: string[];
}

export interface RomSpec {
  id: string;
  label: string;
  sublabel?: string;
  hint: string;
  accept?: string;
  /** When true, the user may proceed without supplying this ROM. */
  optional?: boolean;
  /** Accepted SHA-1 digests (lowercase hex) of known-good images. Empty/absent ⇒ no verification. */
  hashes?: string[];
}

export interface PatchSettingOption {
  value: string;
  label: string;
}

/** A user-tunable knob on a patch (rendered as a dropdown when the patch is enabled). */
export interface PatchSettingSpec {
  id: string;
  label: string;
  description?: string;
  /** Option `value` selected by default. */
  default: string;
  options: PatchSettingOption[];
}

export interface PatchSpec {
  id: string;
  name: string;
  description?: string;
  defaultOn?: boolean;
  /** Optional knobs surfaced under the patch when it is enabled. */
  settings?: PatchSettingSpec[];
}

/** Chosen setting values: patchId → settingId → option value. */
export type PatchSettings = Record<string, Record<string, string>>;

/** Verification state of an uploaded ROM against its spec's known-good hashes. */
export type RomStatus = "unknown" | "checking" | "ok" | "mismatch";

export type BuildMode = "build" | "download";

export interface DestDir {
  name: string;
  handle: FileSystemDirectoryHandle | null;
}

export interface BuildResult {
  summary: string;
}

export type BuildFn = (
  roms: Record<string, File>,
  enabledPatches: string[],
  dest: DestDir | null,
  onLog: (msg: string) => void,
  /** Chosen setting values for the enabled patches (patchId → settingId → option value). */
  patchSettings: PatchSettings,
) => Promise<BuildResult>;

export interface WizardConfig {
  title: string;
  /** Stable key for persisting UI state (the optional-patch selection) to localStorage.
      Defaults to `title`; set it explicitly if the title may change. */
  storageKey?: string;
  welcomeTitle: string;
  welcomeBody: string;
  finishBody?: string;
  bannerImage?: string;
  /** Desktop backdrop image. Overrides the default teal desktop when set. */
  bgImage?: string;
  /** Desktop backdrop solid colour (CSS). Defaults to Win95 teal (#008080) when bgImage is unset. */
  bgColor?: string;
  /** Background music. A bare URL plays on the title-bar toggle; pass an object to set the engine,
      a psflib, and/or `autoplay`. */
  bgMusic?: string | BgMusicConfig;
  mode: BuildMode;
  downloadUrl?: string;
  downloadFilename?: string;
  roms?: RomSpec[];
  build?: BuildFn;
  patches?: PatchSpec[];
  allowCustomBins?: boolean;
  changelog?: ChangelogEntry[];
  /** Optional, privacy-friendly usage analytics. Off unless `umamiSrc` + `umamiId` are both set. */
  analytics?: AnalyticsConfig;
  /** App version, reported with the build analytics event (and free for consumers to display). */
  version?: string;
  /** Source commit the build was produced from, reported with the build analytics event. */
  commit?: string;
}

/** Self-hosted Umami analytics (cookieless). Both fields required to enable; either empty ⇒ off. */
export interface AnalyticsConfig {
  /** Umami tracker script URL (e.g. "/stats/script.js"). */
  umamiSrc?: string;
  /** Umami website id. */
  umamiId?: string;
}

export type StepId = "welcome" | "changelog" | "roms" | "patches" | "destination" | "installing" | "finish";
