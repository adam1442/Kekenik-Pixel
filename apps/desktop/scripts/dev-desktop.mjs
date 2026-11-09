#!/usr/bin/env node
/**
 * @module apps/desktop/scripts/dev-desktop
 * Development launcher for the Electron app:
 *
 *   1. bundles `electron-main.ts` / `electron-preload.ts` -> `dist-electron/`
 *   2. starts the Vite dev server for the desktop renderer (`desktop.html`)
 *   3. launches Electron pointed at the dev server (hot reload for the renderer)
 *
 * Usage: `npm run dev:desktop`
 */

import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEV_PORT = Number(process.env.KP_DEV_PORT ?? 5173);
const DEV_URL = `http://localhost:${DEV_PORT}/desktop.html`;
const IS_WINDOWS = process.platform === "win32";

let closing = false;

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {string} label
 */
function forwardOutput(child, label) {
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
}

/**
 * Waits until the Vite dev server answers, then resolves.
 * @param {string} url
 * @param {number} timeoutMs
 */
function waitForDevServer(url, timeoutMs = 60_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve(undefined);
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.setTimeout(2000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Vite dev server did not respond at ${url} within ${timeoutMs}ms.`));
        return;
      }
      setTimeout(poll, 300);
    };
    poll();
  });
}

async function main() {
  console.info("[dev:desktop] Bundling Electron main + preload...");
  const bundle = spawnSync(
    process.execPath,
    [path.join(ROOT_DIR, "scripts", "build-desktop.mjs"), "--electron"],
    { cwd: ROOT_DIR, stdio: "inherit" }
  );
  if (bundle.status !== 0) {
    throw new Error("Failed to bundle the Electron main/preload scripts.");
  }

  console.info(`[dev:desktop] Starting Vite dev server on port ${DEV_PORT}...`);
  const vite = spawn(
    "npx",
    ["vite", "--port", String(DEV_PORT), "--strictPort"],
    { cwd: ROOT_DIR, stdio: "pipe", shell: IS_WINDOWS }
  );
  forwardOutput(vite, "vite");

  await waitForDevServer(`http://localhost:${DEV_PORT}/`);

  console.info(`[dev:desktop] Launching Electron -> ${DEV_URL}`);
  const electron = spawn("npx", ["electron", "."], {
    cwd: ROOT_DIR,
    stdio: "inherit",
    shell: IS_WINDOWS,
    env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL, NODE_ENV: "development" },
  });

  /** @param {number} code */
  const shutdown = (code = 0) => {
    if (closing) return;
    closing = true;
    if (!vite.killed) vite.kill();
    process.exit(code);
  };

  electron.on("close", (code) => shutdown(code ?? 0));
  vite.on("close", (code) => {
    if (!closing) {
      console.error(`[dev:desktop] Vite exited unexpectedly (code ${code ?? 0}).`);
      shutdown(1);
    }
  });

  process.on("SIGINT", () => {
    electron.kill();
    shutdown(0);
  });
}

main().catch((error) => {
  console.error(`[dev:desktop] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
