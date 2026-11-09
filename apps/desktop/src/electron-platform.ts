/**
 * @module @kekenik/desktop/electron-platform
 * ElectronPlatform implementation of PlatformAPI.
 */

import {
  WebPlatform,
  type FileDialogOptions,
  type OpenFileResult,
  type PlatformAPI,
  type PlatformFetchResult,
  type RecentFileEntry,
} from "../../../packages/core/src/index.ts";
import "./ipc-types.ts";

export class ElectronPlatform implements PlatformAPI {
  public readonly kind = "electron" as const;
  private readonly fallback = new WebPlatform();

  public dataDir(): string {
    return "kpx://appdata";
  }

  public async readSetting<T>(key: string, fallbackValue: T): Promise<T> {
    if (typeof window !== "undefined" && window.kekenikElectron) {
      return window.kekenikElectron.readSetting(key, fallbackValue);
    }
    return this.fallback.readSetting(key, fallbackValue);
  }

  public async writeSetting<T>(key: string, value: T): Promise<void> {
    if (typeof window !== "undefined" && window.kekenikElectron) {
      await window.kekenikElectron.writeSetting(key, value);
      return;
    }
    await this.fallback.writeSetting(key, value);
  }

  public async getRecentFiles(): Promise<RecentFileEntry[]> {
    if (typeof window !== "undefined" && window.kekenikElectron) {
      return window.kekenikElectron.getRecentFiles();
    }
    return this.fallback.getRecentFiles();
  }

  public async addRecentFile(entry: RecentFileEntry): Promise<void> {
    if (typeof window !== "undefined" && window.kekenikElectron) {
      await window.kekenikElectron.addRecentFile(entry);
      return;
    }
    await this.fallback.addRecentFile(entry);
  }

  public async clearRecentFiles(): Promise<void> {
    if (typeof window !== "undefined" && window.kekenikElectron) {
      await window.kekenikElectron.clearRecentFiles();
      return;
    }
    await this.fallback.clearRecentFiles();
  }

  public async openFileDialog(options?: FileDialogOptions): Promise<OpenFileResult | null> {
    if (typeof window !== "undefined" && window.kekenikElectron) {
      return window.kekenikElectron.openFileDialog(options);
    }
    return this.fallback.openFileDialog(options);
  }

  public async saveFileDialog(
    data: Uint8Array | string,
    options?: FileDialogOptions
  ): Promise<{ saved: boolean; path?: string }> {
    if (typeof window !== "undefined" && window.kekenikElectron) {
      return window.kekenikElectron.saveFileDialog(data, options);
    }
    return this.fallback.saveFileDialog(data, options);
  }

  public async writeClipboardText(text: string): Promise<void> {
    if (typeof window !== "undefined" && window.kekenikElectron) {
      await window.kekenikElectron.writeClipboardText(text);
      return;
    }
    await this.fallback.writeClipboardText(text);
  }

  public async readClipboardText(): Promise<string> {
    if (typeof window !== "undefined" && window.kekenikElectron) {
      return window.kekenikElectron.readClipboardText();
    }
    return this.fallback.readClipboardText();
  }

  public async listFiles(dirPath: string): Promise<string[]> {
    return this.fallback.listFiles(dirPath);
  }

  public async readTextFile(filePath: string): Promise<string | null> {
    return this.fallback.readTextFile(filePath);
  }

  public async writeTextFile(filePath: string, content: string): Promise<void> {
    await this.fallback.writeTextFile(filePath, content);
  }

  public async deleteFile(filePath: string): Promise<boolean> {
    return this.fallback.deleteFile(filePath);
  }

  public async fetch(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ): Promise<PlatformFetchResult> {
    return this.fallback.fetch(url, init);
  }
}
