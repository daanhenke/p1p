import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { createReadStream, statSync } from "fs";

const OST_DIR = path.resolve(__dirname, "dev/ost");
const WEBPSX_DIR = path.resolve(__dirname, "vendor/webpsx");

const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".psf": "application/octet-stream",
  ".psflib": "application/octet-stream",
};

// Serve a static directory at `base`, streaming files with a sensible content-type.
function serveDir(name: string, base: string, dir: string) {
  return {
    name,
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use(base, (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
        const file = path.join(dir, rel);
        try {
          const stat = statSync(file);
          if (stat.isFile()) {
            res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
            res.setHeader("Content-Length", stat.size);
            createReadStream(file).pipe(res);
            return;
          }
        } catch { /* fall through */ }
        next();
      });
    },
  };
}

export default defineConfig({
  root: ".",
  plugins: [
    vue(),
    serveDir("serve-ost", "/ost", OST_DIR),
    serveDir("serve-webpsx", "/webpsx", WEBPSX_DIR),
  ],
  server: { port: 5174 },
});
