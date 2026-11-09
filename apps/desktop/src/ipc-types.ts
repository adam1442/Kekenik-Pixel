/**
 * @module @kekenik/desktop/ipc-types
 * Strongly-typed IPC contract between Electron Main, Preload, and Renderer (B13, B16, B17).
 * The renderer never sees raw `ipcRenderer`.
 */

import type {
  FileDialogOptions,
  OpenFileResult,
  RecentFileEntry,
} from "../../../packages/core/src/index.ts";
import type { WindowBoundsState } from "./main/ipc.ts";

export interface WindowStateSnapshot {
  isMaximized: boolean;
  isFullScreen: boolean;
}

export interface KekenikElectronBridge {
  // PlatformAPI settings & files
  readSetting<T>(key: string, fallback: T): Promise<T>;
  writeSetting<T>(key: string, value: T): Promise<void>;
  getRecentFiles(): Promise<RecentFileEntry[]>;
  addRecentFile(entry: RecentFileEntry): Promise<void>;
  clearRecentFiles(): Promise<void>;
  openFileDialog(options?: FileDialogOptions): Promise<OpenFileResult | null>;
  saveFileDialog(
    data: Uint8Array | string,
    options?: FileDialogOptions
  ): Promise<{ saved: boolean; path?: string }>;
  writeClipboardText(text: string): Promise<void>;
  readClipboardText(): Promise<string>;

  // B13 Custom Window Chrome Controls (Typed IPC)
  minimizeWindow(): Promise<{ minimized: boolean; isMaximized: boolean }>;
  maximizeWindow(): Promise<{ isMaximized: boolean }>;
  restoreWindow(): Promise<{ isMaximized: boolean }>;
  closeWindow(): Promise<{ closed: boolean }>;
  isWindowMaximized(): Promise<boolean>;
  toggleFullScreen(flag?: boolean): Promise<{ isFullScreen: boolean }>;
  isFullScreen(): Promise<boolean>;
  getWindowBounds(): Promise<WindowBoundsState>;
  setWindowBounds(bounds: Partial<WindowBoundsState>): Promise<WindowBoundsState>;
  openLogsFolder(): Promise<{ opened: boolean; path: string }>;
  /** Hands an http(s) URL to the OS default browser (never navigates the app window). */
  openExternalUrl(url: string): Promise<{ opened: boolean }>;

  // Event subscriptions (sanitized in preload; never passes raw IpcRendererEvent)
  onWindowStateChanged(listener: (state: WindowStateSnapshot) => void): () => void;
  onOpenExternalFile(listener: (file: OpenFileResult) => void): () => void;
}

declare global {
  interface Window {
    kekenikElectron?: KekenikElectronBridge;
  }
}
