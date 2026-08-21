import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import type { Plugin } from "vite";

/**
 * Emit lerc-wasm.wasm into dist/assets/ at build time.
 *
 * The `lerc` package resolves its WASM file via `new URL("lerc-wasm.wasm",
 * import.meta.url)` at runtime. After bundling, import.meta.url points to the
 * JS bundle in /assets/, so the browser requests /assets/lerc-wasm.wasm.
 * Vite's static-asset transformation of new URL(…) only fires in project
 * source, not inside node_modules, so the file is never copied during build.
 * This plugin emits it explicitly so LERC-compressed COGs decode correctly.
 */
function lercWasmPlugin(): Plugin {
  return {
    name: "lerc-wasm",
    apply: "build",
    generateBundle() {
      const geotiffRequire = createRequire(
        fileURLToPath(
          new URL(
            "./node_modules/@developmentseed/geotiff/package.json",
            import.meta.url,
          ),
        ),
      );
      const lercMain = geotiffRequire.resolve("lerc");
      const lercWasmPath = path.join(path.dirname(lercMain), "lerc-wasm.wasm");
      this.emitFile({
        type: "asset",
        fileName: "assets/lerc-wasm.wasm",
        source: fs.readFileSync(lercWasmPath),
      });
    },
  };
}

// Upload source maps to Sentry only when an auth token is present (CI). Local
// `pnpm build` skips upload, and the plugin deletes the emitted `.map` files
// after upload so they aren't published to the public GitHub Pages site. The
// base path needs no special handling — the plugin matches maps by injected
// debug IDs, not URL paths.
const sentrySourceMaps = process.env.SENTRY_AUTH_TOKEN
  ? [
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        telemetry: false,
        release: { name: process.env.VITE_SENTRY_RELEASE },
        sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
      }),
    ]
  : [];

export default defineConfig({
  // GitHub Pages serves this repo under /cog-viewer/, so deploy.yml sets
  // BASE_PATH. Every other host — dev server, `vite preview`, Cloudflare Pages
  // PR previews — serves from the root.
  base: process.env.BASE_PATH ?? "/",
  // Emit source maps so Sentry can de-minify production stack traces; the
  // sentry plugin deletes them from dist after upload (see sentrySourceMaps).
  build: { sourcemap: true },
  plugins: [react(), lercWasmPlugin(), ...sentrySourceMaps],
  worker: { format: "es" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
