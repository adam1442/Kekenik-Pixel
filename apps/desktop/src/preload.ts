/**
 * @module @kekenik/desktop/preload
 * Secure Electron Preload script using `contextBridge.exposeInMainWorld` (contextIsolation: true,
 * sandbox: true, nodeIntegration: false). Never exposes raw `ipcRenderer` to the renderer.
 */

import type {
  FileDialogOptions,
  OpenFileResult,
  RecentFileEntry,
} from "../../../packages/core/src/index.ts";
import type { KekenikElectronBridge, WindowStateSnapshot } from "./ipc-types.ts";
import type { WindowBoundsState } from "./main/ipc.ts";

export function exposeKekenikPreload(electronPreload: {
  contextBridge: {
    exposeInMainWorld(apiKey: string, api: KekenikElectronBridge): void;
  };
  ipcRenderer: {
    invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
    on?(channel: string, listener: (_event: unknown, payload: unknown) => void): void;
    removeListener?(channel: string, listener: (_event: unknown, payload: unknown) => void): void;
  };
}): KekenikElectronBridge {
  const { contextBridge, ipcRenderer } = electronPreload;

  const api: KekenikElectronBridge = {
    readSetting: <T>(key: string, fallback: T) =>
      ipcRenderer.invoke<T>("kpx:readSetting", key, fallback),
    writeSetting: <T>(key: string, value: T) =>
      ipcRenderer.invoke<void>("kpx:writeSetting", key, value),
    getRecentFiles: () => ipcRenderer.invoke<RecentFileEntry[]>("kpx:getRecentFiles"),
    addRecentFile: (entry: RecentFileEntry) =>
      ipcRenderer.invoke<void>("kpx:addRecentFile", entry),
    clearRecentFiles: () => ipcRenderer.invoke<void>("kpx:clearRecentFiles"),
    openFileDialog: (options?: FileDialogOptions) =>
      ipcRenderer.invoke("kpx:openFileDialog", options),
    saveFileDialog: (data: Uint8Array | string, options?: FileDialogOptions) =>
      ipcRenderer.invoke("kpx:saveFileDialog", data, options),
    writeClipboardText: (text: string) =>
      ipcRenderer.invoke<void>("kpx:writeClipboardText", text),
    readClipboardText: () => ipcRenderer.invoke<string>("kpx:readClipboardText"),

    // B13 Typed Window Control IPC
    minimizeWindow: () =>
      ipcRenderer.invoke<{ minimized: boolean; isMaximized: boolean }>("window:minimize"),
    maximizeWindow: () => ipcRenderer.invoke<{ isMaximized: boolean }>("window:maximize"),
    restoreWindow: () => ipcRenderer.invoke<{ isMaximized: boolean }>("window:restore"),
    closeWindow: () => ipcRenderer.invoke<{ closed: boolean }>("window:close"),
    isWindowMaximized: () => ipcRenderer.invoke<boolean>("window:is-maximized"),
    toggleFullScreen: (flag?: boolean) =>
      ipcRenderer.invoke<{ isFullScreen: boolean }>("window:toggle-fullscreen", flag),
    isFullScreen: () => ipcRenderer.invoke<boolean>("window:is-fullscreen"),
    getWindowBounds: () => ipcRenderer.invoke<WindowBoundsState>("window:get-bounds"),
    setWindowBounds: (bounds: Partial<WindowBoundsState>) =>
      ipcRenderer.invoke<WindowBoundsState>("window:set-bounds", bounds),
    openLogsFolder: () =>
      ipcRenderer.invoke<{ opened: boolean; path: string }>("kpx:openLogsFolder"),
    openExternalUrl: (url: string) =>
      ipcRenderer.invoke<{ opened: boolean }>("kpx:openExternalUrl", url),

    onWindowStateChanged: (listener: (state: WindowStateSnapshot) => void) => {
      const wrapped = (_event: unknown, payload: unknown) => {
        const p = payload as Partial<WindowStateSnapshot> | undefined;
        listener({
          isMaximized: Boolean(p?.isMaximized),
          isFullScreen: Boolean(p?.isFullScreen),
        });
      };
      ipcRenderer.on?.("window:state-changed", wrapped);
      return () => {
        ipcRenderer.removeListener?.("window:state-changed", wrapped);
      };
    },

    onOpenExternalFile: (listener: (file: OpenFileResult) => void) => {
      const wrapped = (_event: unknown, payload: unknown) => {
        if (payload && typeof payload === "object") {
          listener(payload as OpenFileResult);
        }
      };
      ipcRenderer.on?.("kpx:open-external-file", wrapped);
      return () => {
        ipcRenderer.removeListener?.("kpx:open-external-file", wrapped);
      };
    },
  };

  contextBridge.exposeInMainWorld("kekenikElectron", api);
  return api;
}
