// Pre-build step for the wizard: compile every patch directory under packages/persona1/patches into a
// distributable .bin pack under wizard/public/patches/, and stage the runtime assets (banner/desktop
// art, music) plus the vendored webPSX player into public/. Vite serves public/ at the site root in
// dev and ships it in `vite build`, so both dev and production can fetch /patches/<id>.bin,
// /banner.jpg, /background.jpg, /ost/** and /webpsx/**. Run via `pnpm wizard:packs`.

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@p1p/cli";
import { persona1 } from "../../src/profile.js";

const here = dirname(fileURLToPath(import.meta.url));
const patchesDir = join(here, "../../patches");
const assetsDir = join(here, "../../assets"); // packages/persona1/assets — single source of truth
const publicDir = join(here, "../public");
const outDir = join(publicDir, "patches");
mkdirSync(outDir, { recursive: true });

let n = 0;
for (const name of readdirSync(patchesDir).sort()) {
  const dir = join(patchesDir, name);
  if (!existsSync(join(dir, "patch.xml"))) continue;
  compile(persona1, dir, join(outDir, `${name}.bin`), (m) => console.log(`[${name}] ${m}`));
  n++;
}
console.log(`compiled ${n} patch pack(s) → ${outDir}`);

// Stage the served runtime assets so dev and `vite build` both have them under public/.
for (const asset of ["banner.jpg", "background.jpg", "ost"]) {
  const src = join(assetsDir, asset);
  if (existsSync(src)) cpSync(src, join(publicDir, asset), { recursive: true });
}

// Stage the vendored webPSX player (from @p1p/wizard) so production serves /webpsx/** too — in dev
// Vite's middleware would otherwise be the only source and the bundle would 404 on these files.
const webpsxDir = join(here, "../../../wizard/vendor/webpsx");
if (existsSync(webpsxDir)) cpSync(webpsxDir, join(publicDir, "webpsx"), { recursive: true });

console.log(`staged runtime assets → ${publicDir}`);
