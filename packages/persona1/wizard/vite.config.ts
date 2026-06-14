// Vite app for the Persona 1 wizard flavour. The compiled patch packs and all runtime assets (music
// under /ost, /banner.jpg, /background.jpg, and the vendored webPSX player under /webpsx) are staged
// into public/ by `wizard:packs`, so vite serves them in dev and ships them verbatim in `vite build`.

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  root: __dirname,
  plugins: [vue()],
  server: { port: 5175 },
});
