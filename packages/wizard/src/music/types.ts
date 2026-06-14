export type MusicBackendId = "webaudio" | "psf";

export interface MusicBackend {
  readonly id: MusicBackendId;
  readonly label: string;
  play(track: MusicTrack): Promise<void>;
  stop(): void;
  setVolume(vol: number): void;
  /** Register a callback fired when the current track reaches its natural end (drives looping and
      playlist advancement). Backends do not loop internally — the owner decides what comes next. */
  setOnEnded(cb: () => void): void;
  dispose(): void;
}

export interface MusicTrack {
  id: string;
  label: string;
  /** Relative URL served from the dev server, e.g. "/ost/p1/116 Dungeon ~ Black Market.psf" */
  url: string;
  /** For minipsf: the .psflib this track depends on */
  psflib?: string;
  /** If omitted, inferred from file extension */
  backend?: MusicBackendId;
}
