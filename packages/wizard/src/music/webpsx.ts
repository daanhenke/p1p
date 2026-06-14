/**
 * webPSX backend — real PSF/PSF2 playback via Jürgen Wothke's WebAudio port of Highly Experimental
 * (https://github.com/wothke/webpsx). It emulates the PSX R3000 + SPU to render the original audio
 * hardware, so .psf / .minipsf play natively in the browser.
 *
 * webPSX isn't on any package manager, so the prebuilt files are *vendored* under
 * `vendor/webpsx/` (see its README) and served verbatim at `/webpsx/` (the wasm filename is
 * hardcoded in the glue, so the directory must not be content-hashed). The three pieces:
 *   - stdlib/scriptprocessor_player.min.js → the global `ScriptNodePlayer` (engine + WebAudio graph)
 *   - backend_psx.js                       → the global `PSXBackendAdapter` (emscripten glue)
 *   - psx.wasm                             → the emulator core (located via `window.WASM_SEARCH_PATH`)
 *
 * The vendored build needs no BIOS (it synthesises one internally) and resolves a song's sample
 * libraries (`_lib`/`_lib2` in its [TAG] block) on demand — we just point dependency names at the
 * song's directory via the adapter's `mapBackendFilename` hook.
 *
 * ScriptNodePlayer is a singleton that owns its own AudioContext; we wrap it as a MusicBackend.
 */
import type { MusicBackend, MusicTrack } from "./types.js";

// Base path where the vendored webPSX files are served. A consumer can override this (e.g. if it
// hosts the files elsewhere) before the first PSF track plays.
let BASE = "/webpsx/";
export function setWebpsxBasePath(base: string): void {
  BASE = base.endsWith("/") ? base : base + "/";
}

interface ScriptNodePlayerInstance {
  loadMusicFromURL(url: string, options: Record<string, unknown>): Promise<unknown>;
  play(): void;
  pause(): void;
  setVolume(v: number): void;
}
interface ScriptNodePlayerStatic {
  initialize(
    backend: unknown,
    onTrackEnd: () => void,
    preload: string[],
    enableSpectrum: boolean,
    arg5: unknown,
  ): Promise<unknown>;
  getInstance(): ScriptNodePlayerInstance;
}
interface PSXAdapter { mapBackendFilename(name: string): string }
type PSXAdapterCtor = new (presetBIOS: boolean) => PSXAdapter;
declare global {
  interface Window { WASM_SEARCH_PATH?: string }
}

// webPSX exposes `ScriptNodePlayer` (a `var`) and `PSXBackendAdapter` (an ES6 `class`). Class
// declarations in a classic <script> live in the global *lexical* environment — they are NOT
// properties of `window` — so we resolve both by name from global scope via the Function ctor.
function getGlobal<T>(name: string): T | undefined {
  try {
    return new Function(`return typeof ${name}!=="undefined"?${name}:undefined`)() as T;
  } catch {
    return undefined;
  }
}

let scriptsLoaded: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = false; // ScriptNodePlayer must exist before backend_psx.js registers against it
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

function ensureScripts(): Promise<void> {
  if (!scriptsLoaded) {
    // Tell the emscripten glue where to fetch psx.wasm, then load the player + backend in order.
    window.WASM_SEARCH_PATH = BASE;
    scriptsLoaded = loadScript(`${BASE}stdlib/scriptprocessor_player.min.js`)
      .then(() => loadScript(`${BASE}backend_psx.js`));
  }
  return scriptsLoaded;
}

/** Directory portion of a URL, e.g. "/ost/p1/116 foo.psf" → "/ost/p1/". */
function dirOf(url: string): string {
  const i = url.lastIndexOf("/");
  return i < 0 ? "" : url.slice(0, i + 1);
}

export function createWebpsxBackend(): MusicBackend {
  let ready: Promise<ScriptNodePlayerInstance> | null = null;
  let volume = 0.7;
  let onEnded: (() => void) | null = null;
  // Directory of the track currently loading — used to resolve its on-demand _lib dependencies.
  let currentDir = "";

  function init(): Promise<ScriptNodePlayerInstance> {
    if (ready) return ready;
    ready = ensureScripts().then(async () => {
      const SNP = getGlobal<ScriptNodePlayerStatic>("ScriptNodePlayer");
      const Adapter = getGlobal<PSXAdapterCtor>("PSXBackendAdapter");
      if (!SNP || !Adapter) throw new Error("webPSX failed to initialise (globals missing)");

      // `false` => no BIOS upload required (the vendored build synthesises one).
      const adapter = new Adapter(false);
      // Resolve dependency names (e.g. "p1.psflib") against the current track's directory.
      adapter.mapBackendFilename = (name: string) =>
        name.startsWith("/") || name.startsWith("http") ? name : currentDir + name;

      await SNP.initialize(adapter, () => { onEnded?.(); }, [], true, undefined);
      const inst = SNP.getInstance();
      inst.setVolume(volume);
      return inst;
    });
    return ready;
  }

  return {
    id: "psf",
    label: "PSF / webPSX (PlayStation hardware emulation)",

    async play(track: MusicTrack) {
      const player = await init();
      currentDir = dirOf(track.url);
      await player.loadMusicFromURL(track.url, {});
      player.setVolume(volume);
      player.play();
    },

    stop() {
      ready?.then((p) => p.pause()).catch(() => { /* not initialised */ });
    },

    setVolume(v: number) {
      volume = Math.max(0, Math.min(1, v));
      ready?.then((p) => p.setVolume(volume)).catch(() => { /* not initialised */ });
    },

    setOnEnded(cb: () => void) {
      onEnded = cb;
    },

    dispose() {
      ready?.then((p) => p.pause()).catch(() => { /* not initialised */ });
    },
  };
}
