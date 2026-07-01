import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Standalone OPS CONSOLE — a second Vite app in this repo, built and deployed as
// its own Railway service ("ops"). It shares the @shared kernel and the
// @features/ops UI slice with the manager app, but boots from its own entry
// (ops.html → src/ops) with its own read-only auth (ops_viewer | manager) so a
// teammate handed this URL can see production health/logs without any other
// access. Hand out the URL, not the credentials.
//
// Output goes to dist-ops/ so it never collides with the manager build (dist/).
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@ops": fileURLToPath(new URL("./src/ops", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@features": fileURLToPath(new URL("./src/features", import.meta.url)),
    },
  },
  build: {
    outDir: "dist-ops",
    rollupOptions: {
      input: fileURLToPath(new URL("./ops.html", import.meta.url)),
    },
  },
  server: { port: 5174 },
});
