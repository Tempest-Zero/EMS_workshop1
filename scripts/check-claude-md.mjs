#!/usr/bin/env node
// Fails if CLAUDE.md's stated ground-truth drifts from the code.
//
// CLAUDE.md is the authoritative, auto-loaded context for AI agents. It is only
// trustworthy if it stays in sync with reality, so this guard pins the two facts
// most prone to silent rot — the Alembic migration head and the Expo SDK major —
// and fails CI when CLAUDE.md and the code disagree. Extend it as new
// rot-prone facts earn a line in CLAUDE.md.
//
// No dependencies: plain Node, runnable as `node scripts/check-claude-md.mjs`.

import { readFileSync, readdirSync } from "node:fs";

const claude = readFileSync("CLAUDE.md", "utf8");
const errors = [];
const ok = [];

// ── 1. Alembic head: "...migrations (head = **0016**)" ──────────────────────
const headMatch = claude.match(/head\s*=\s*\*{0,2}(\d{4})\*{0,2}/i);
if (!headMatch) {
  errors.push("CLAUDE.md: could not find the Alembic head (expected `head = NNNN`).");
} else {
  const stated = headMatch[1];
  const actual = readdirSync("backend/alembic/versions")
    .filter((f) => /^\d{4}_.*\.py$/.test(f))
    .map((f) => f.slice(0, 4))
    .sort()
    .at(-1);
  if (stated !== actual) {
    errors.push(`Alembic head drift: CLAUDE.md says ${stated}, latest migration is ${actual}.`);
  } else {
    ok.push(`Alembic head = ${actual}`);
  }
}

// ── 2. Expo SDK major: "Expo **SDK 52**" vs technician-app/package.json ──────
const sdkMatch = claude.match(/Expo\s+\*{0,2}SDK\s+(\d{2})/i);
const expoRange = JSON.parse(readFileSync("technician-app/package.json", "utf8")).dependencies?.expo ?? "";
const expoMajor = (expoRange.match(/(\d+)\./) || [])[1];
if (!sdkMatch) {
  errors.push("CLAUDE.md: could not find the Expo SDK version (expected `Expo SDK NN`).");
} else if (!expoMajor) {
  errors.push("technician-app/package.json: could not parse the `expo` version.");
} else if (sdkMatch[1] !== expoMajor) {
  errors.push(`Expo SDK drift: CLAUDE.md says ${sdkMatch[1]}, package.json has expo ${expoRange}.`);
} else {
  ok.push(`Expo SDK = ${expoMajor}`);
}

if (errors.length) {
  console.error("CLAUDE.md ground-truth check FAILED:");
  for (const e of errors) console.error("  - " + e);
  console.error("\nUpdate CLAUDE.md (or the code) so they agree, then re-run.");
  process.exit(1);
}
console.log("CLAUDE.md ground-truth check passed: " + ok.join(", ") + ".");
