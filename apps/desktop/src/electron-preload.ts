/**
 * @module @kekenik/desktop/electron-preload
 * Real preload bundle entry point (`dist-electron/preload.cjs`).
 *
 * Bundled to CommonJS because it runs inside a sandboxed preload context
 * (`webPreferences.sandbox: true`), where only `require("electron")` is available.
 * The exposed surface is built by `preload.ts` via `contextBridge` – raw `ipcRenderer`
 * is never leaked to the renderer.
 */

import { contextBridge, ipcRenderer } from "electron";
import { exposeKekenikPreload } from "./preload.ts";

type PreloadBridge = Parameters<typeof exposeKekenikPreload>[0];

exposeKekenikPreload({ contextBridge, ipcRenderer } as unknown as PreloadBridge);
