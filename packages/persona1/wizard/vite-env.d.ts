/// <reference types="vite/client" />

// Build-time env baked into the wizard bundle (see the wizard Containerfile build args).
interface ImportMetaEnv {
  readonly VITE_UMAMI_SRC?: string; // umami tracker URL, e.g. /stats/script.js (empty = analytics off)
  readonly VITE_UMAMI_ID?: string; // umami website id
  readonly VITE_WIZARD_VERSION?: string; // release shown/reported (defaults to the changelog head)
  readonly VITE_GIT_COMMIT?: string; // source commit the build was produced from
}
