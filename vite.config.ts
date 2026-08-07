import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";

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
  plugins: [react(), ...sentrySourceMaps],
  worker: { format: "es" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
