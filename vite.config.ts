import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  // Production builds are served from https://<org>.github.io/cog-viewer/
  // by the GitHub Pages deploy. The dev server still mounts at /.
  base: command === "build" ? "/cog-viewer/" : "/",
  plugins: [react()],
  worker: { format: "es" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
}));
