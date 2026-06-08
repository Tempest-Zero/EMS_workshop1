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
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      "@features": fileURLToPath(new URL("./src/features", import.meta.url)),
    },
  },
});
