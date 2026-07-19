import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// https://vite.dev/config/
// `base` is "/" for local dev, the normal build, and the Railway web service
// (served at its own root domain). Kept env-driven via VITE_BASE so the app can
// still be hosted under a subpath if ever needed — nothing changes by default.
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  // Agent sessions run in .claude/worktrees/ inside the repo; without this the
  // dev-server watcher sees their file churn and force-reloads the page every
  // few seconds, making local dev unusable while an agent works.
  server: { watch: { ignored: ["**/.claude/**"] } },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
      // The ops console is built by vite.ops.config.js; the alias is mirrored
      // here so Vitest (which loads this config) can resolve @ops in tests.
      "@ops": fileURLToPath(new URL("./src/ops", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@features": fileURLToPath(new URL("./src/features", import.meta.url)),
    },
  },
});
