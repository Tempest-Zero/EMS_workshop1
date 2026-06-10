import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // Each sibling runtime owns its own quality gates. This config covers only
  // the web manager app at the repo root.
  globalIgnores(["dist", "backend", "technician-app"]),
  {
    files: ["**/*.{js,jsx}"],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // ── Layer boundaries (ARCHITECTURE.md, enforced) ──────────────────────────
  // The codebase imports exclusively via the @app/@shared/@features aliases,
  // so guarding the aliases guards the graph.
  {
    // shared/ is the pure kernel: it may not import anything internal.
    files: ["src/shared/**/*.{js,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@app/*", "@features/*"],
              message: "shared/ is the dependency-free kernel — it imports nothing internal.",
            },
          ],
        },
      ],
    },
  },
  {
    // features/ may use shared/, other features' public surfaces, and the app
    // providers (the composition root's contexts) — but never app layouts,
    // pages, or the router.
    files: ["src/features/**/*.{js,jsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@app/*", "!@app/providers", "!@app/providers/*"],
              message:
                "features/ may import only @app/providers from the app layer — layouts, pages and the router belong to the composition root.",
            },
          ],
        },
      ],
    },
  },
]);
