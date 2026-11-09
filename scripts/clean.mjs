#!/usr/bin/env node
/**
 * @module scripts/clean
 * Removes every generated build output so a fresh build can be reproduced from scratch.
 *
 *   node scripts/clean.mjs          # dist/, dist-electron/, release/, caches
 *   node scripts/clean.mjs --all    # also removes node_modules/
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const withNodeModules = process.argv.includes("--all");

const targets = [
  "dist",
  "dist-electron",
  "release",
  "node_modules/.vite",
  "node_modules/.cache",
  ...(withNodeModules ? ["node_modules"] : []),
];

for (const relative of targets) {
  const abs = path.join(ROOT_DIR, relative);
  if (!fs.existsSync(abs)) continue;
  fs.rmSync(abs, { recursive: true, force: true });
  console.info(`[clean] removed ${relative}`);
}

console.info("[clean] done.");
