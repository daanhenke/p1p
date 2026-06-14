# webPSX (vendored)

PSF/PSF2 PlayStation music playback — a WebAudio/WASM port of Highly Experimental.

- **Upstream:** https://github.com/wothke/webpsx (and the live build at https://www.wothke.ch/webPSX/)
- **Author:** Jürgen Wothke. Based on Highly Experimental by Chris Moeller / Neill Corlett.
- **License:** GPL v2 (see upstream). These prebuilt files are interned here because webPSX is not
  published to any package manager; vendoring avoids a runtime CDN dependency.

## Files
- `stdlib/scriptprocessor_player.min.js` — the `ScriptNodePlayer` engine + WebAudio graph.
- `backend_psx.js` — the emscripten glue that defines `PSXBackendAdapter`.
- `psx.wasm` — the emulator core (located at runtime via `window.WASM_SEARCH_PATH`).

These are served verbatim at the `/webpsx/` path (the wasm filename is hardcoded in the glue, so the
directory must not be content-hashed). The wizard dev server serves them via a middleware; a consumer
app must serve this directory at the same base (configurable via `setWebpsxBasePath`).

To update: re-download the three files from https://www.wothke.ch/webPSX/ .
