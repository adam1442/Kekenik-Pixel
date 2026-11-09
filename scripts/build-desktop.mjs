#!/usr/bin/env node
/**
 * @module scripts/build-desktop
 * Compiles the Electron side of Kekenik Pixel into real, runnable JavaScript:
 *
 *   1. `apps/desktop/src/electron-main.ts`     -> `dist-electron/main.mjs`     (ESM, main process)
 *   2. `apps/desktop/src/electron-preload.ts`  -> `dist-electron/preload.cjs`  (CJS, sandboxed preload)
 *   3. `desktop.html` + `electron-renderer.tsx` -> `dist/desktop.html`         (single-file renderer)
 *
 * Flag it needs to run before packaging:
 *   ✗ none — `npm run build:desktop` builds all three artifacts.
 *
 * Usage:
 *   node scripts/build-desktop.mjs             # main + preload + renderer
 *   node scripts/build-desktop.mjs --electron  # main + preload only
 *   node scripts/build-desktop.mjs --renderer  # renderer only
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ELECTRON_OUT_DIR = path.join(ROOT_DIR, "dist-electron");

process.chdir(ROOT_DIR);

const NODE_BUILTINS = /^node:/;

/**
 * Bundles an Electron entry point.
 * @param {{ entry: string; fileName: string; format: "es" | "cjs"; emptyOutDir: boolean }} options
 */
async function bundleElectronEntry(options) {
  await build({
    configFile: false,
    root: ROOT_DIR,
    logLevel: "info",
    build: {
      outDir: "dist-electron",
      emptyOutDir: options.emptyOutDir,
      minify: false,
      sourcemap: false,
      target: "node20",
      reportCompressedSize: false,
      lib: {
        entry: path.resolve(ROOT_DIR, options.entry),
        formats: [options.format],
        fileName: () => options.fileName,
      },
      rollupOptions: {
        external: ["electron", NODE_BUILTINS],
        output: {
          // Keep a single predictable file name (no hashes) – electron-builder and
          // `BrowserWindow#webPreferences.preload` reference these paths directly.
          entryFileNames: options.fileName,
          inlineDynamicImports: true,
        },
      },
    },
  });
}

/**
 * Builds the Electron main process and preload bundles.
 */
export async function buildElectronBundles() {
  fs.mkdirSync(ELECTRON_OUT_DIR, { recursive: true });

  console.info("[build-desktop] Bundling Electron main process -> dist-electron/main.mjs");
  await bundleElectronEntry({
    entry: "apps/desktop/src/electron-main.ts",
    fileName: "main.mjs",
    format: "es",
    emptyOutDir: true,
  });

  console.info("[build-desktop] Bundling Electron preload -> dist-electron/preload.cjs");
  await bundleElectronEntry({
    entry: "apps/desktop/src/electron-preload.ts",
    fileName: "preload.cjs",
    format: "cjs",
    emptyOutDir: false,
  });

  for (const file of ["main.mjs", "preload.cjs"]) {
    const abs = path.join(ELECTRON_OUT_DIR, file);
    if (!fs.existsSync(abs)) {
      throw new Error(`[build-desktop] Expected bundle ${file} was not produced.`);
    }
  }
  console.info("[build-desktop] Electron bundles ready.");
}

/**
 * Builds the Electron renderer bundle (`dist/desktop.html`) with the desktop platform installed.
 */
export async function buildDesktopRenderer() {
  console.info("[build-desktop] Bundling Electron renderer -> dist/desktop.html");
  process.env.KP_TARGET = "desktop";
  try {
    await build({
      configFile: path.join(ROOT_DIR, "vite.config.ts"),
      root: ROOT_DIR,
      logLevel: "info",
    });
  } finally {
    delete process.env.KP_TARGET;
  }

  const htmlOut = path.join(ROOT_DIR, "dist", "desktop.html");
  if (!fs.existsSync(htmlOut)) {
    throw new Error("[build-desktop] dist/desktop.html was not produced by the renderer build.");
  }
  console.info("[build-desktop] Electron renderer ready.");
}

async function main() {
  const args = process.argv.slice(2);
  const onlyElectron = args.includes("--electron");
  const onlyRenderer = args.includes("--renderer");

  if (!onlyRenderer) {
    await buildElectronBundles();
  }
  if (!onlyElectron) {
    await buildDesktopRenderer();
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error("[build-desktop] FAILED:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
