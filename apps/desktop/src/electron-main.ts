/**
 * @module @kekenik/desktop/electron-main
 * Real Electron bootstrap entry point – the file referenced by the `main` field of
 * `package.json` (`dist-electron/main.mjs`).
 *
 * `main.ts` exposes the testable, dependency-injected `bootstrapElectronMain()` function;
 * this module is the thin, side-effectful shell that hands the real `electron` module to it
 * and adds the platform lifecycle handlers Electron expects (single-instance handoff is
 * handled inside `bootstrapElectronMain`).
 */

import path from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
} from "electron";
import { bootstrapElectronMain, handleMainProcessError } from "./main.ts";

type ElectronModuleForBootstrap = Parameters<typeof bootstrapElectronMain>[0];

const electronModule = {
  app,
  BrowserWindow,
  Menu,
  screen,
  session,
  ipcMain,
  dialog,
  shell,
  clipboard,
} as unknown as ElectronModuleForBootstrap;

let logsDir: string | null = null;

/**
 * Creates (or re-creates) the main window through `bootstrapElectronMain`.
 * Safe to call more than once: the IPC registry inside `main.ts` is idempotent.
 */
async function launch(): Promise<void> {
  try {
    const result = await bootstrapElectronMain(electronModule, {
      devServerUrl: process.env.VITE_DEV_SERVER_URL,
      argv: process.argv,
    });
    logsDir = path.join(result.userDataDir, "logs");
    if (!result.locked) {
      // Another instance already owns the single-instance lock and was focused instead.
      return;
    }
  } catch (error) {
    await reportFatalError(error);
  }
}

async function reportFatalError(error: unknown): Promise<void> {
  const target = logsDir ?? path.join(app.getPath("userData"), "logs");
  try {
    await handleMainProcessError(
      error,
      target,
      dialog as unknown as Parameters<typeof handleMainProcessError>[2],
      shell as unknown as Parameters<typeof handleMainProcessError>[3]
    );
  } catch {
    // Last-resort: never let error reporting crash the boot sequence.
    console.error("[kekenik] Fatal error before the error dialog could be shown:", error);
  } finally {
    app.quit();
  }
}

// Windows taskbar grouping, jump list and toast notifications rely on a stable AppUserModelID.
if (process.platform === "win32") {
  app.setAppUserModelId("com.kekenik.pixel");
}

process.on("uncaughtException", (error) => {
  void reportFatalError(error);
});
process.on("unhandledRejection", (reason) => {
  void reportFatalError(reason);
});

// Keep the classic desktop lifecycle: quit on Windows/Linux when the last window closes,
// stay resident on macOS and re-create the window when the dock icon is clicked.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void launch();
  }
});

void launch();
