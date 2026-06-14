/// <reference types="vite/client" />

// Theme stylesheets imported as URLs (Vite `?url` suffix). The bare-specifier `?url` imports
// (98.css?url, xp.css?url, 7.css?url) aren't covered by vite/client's relative-path globs.
declare module "*?url" {
  const src: string;
  export default src;
}
