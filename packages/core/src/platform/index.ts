/**
 * @module @kekenik/core/platform
 * Platform abstraction layer (PlatformAPI) decoupling core/UI from Electron vs Browser.
 */

import { EventBus } from "../events/index.ts";

export interface RecentFileEntry {
  readonly path: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly colorMode: string;
  readonly openedAt: string;
  readonly snapshotJson?: string;
}

export interface FileDialogOptions {
  readonly title?: string;
  readonly defaultName?: string;
  readonly extensions?: readonly string[];
}

export interface OpenFileResult {
  readonly path: string;
  readonly name: string;
  readonly data: Uint8Array;
  readonly text?: string;
}

export interface PlatformFetchResult {
  readonly status: number;
  readonly ok: boolean;
  readonly text: string;
}

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  readonly id: number;
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly source: string;
  readonly message: string;
}

export interface LoggerEvents extends Record<string, unknown> {
  logged: LogEntry;
  cleared: undefined;
}

/**
 * 500-line ring-buffer logger backing `Help > Log Viewer`.
 */
export class AppLogger {
  public readonly events = new EventBus<LoggerEvents>();
  private readonly maxLines = 500;
  private entries: LogEntry[] = [];
  private seq = 1;

  /**
   * Appends a log entry, pruning the oldest entry when exceeding 500 lines.
   */
  public log(level: LogLevel, source: string, message: string): LogEntry {
    const entry: LogEntry = {
      id: this.seq++,
      timestamp: new Date().toISOString().slice(11, 23),
      level,
      source,
      message,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxLines) {
      this.entries.shift();
    }
    this.events.emit("logged", entry);
    return entry;
  }

  public info(source: string, message: string): LogEntry {
    return this.log("info", source, message);
  }

  public warn(source: string, message: string): LogEntry {
    return this.log("warn", source, message);
  }

  public error(source: string, message: string): LogEntry {
    return this.log("error", source, message);
  }

  /**
   * Returns up to 500 most recent log lines.
   */
  public getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Clears the log viewer buffer.
   */
  public clear(): void {
    this.entries = [];
    this.events.emit("cleared", undefined);
  }
}

export const appLogger = new AppLogger();

export interface PlatformAPI {
  readonly kind: "web" | "electron";
  dataDir(): string;
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
  listFiles(dirPath: string): Promise<string[]>;
  readTextFile(filePath: string): Promise<string | null>;
  writeTextFile(filePath: string, content: string): Promise<void>;
  deleteFile(filePath: string): Promise<boolean>;
  fetch(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ): Promise<PlatformFetchResult>;
}

/**
 * Browser / Sandbox implementation of PlatformAPI using localStorage + virtual FS + Blob downloads.
 */
export class WebPlatform implements PlatformAPI {
  public readonly kind = "web" as const;
  private readonly memoryStore = new Map<string, string>();
  private readonly virtualFs = new Map<string, string>();
  private clipboardBuffer = "";

  public dataDir(): string {
    return "kpx://appdata";
  }

  private getStorageKey(key: string): string {
    return `kekenik_pixel_${key}`;
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
  }

  public async readSetting<T>(key: string, fallback: T): Promise<T> {
    const sk = this.getStorageKey(key);
    try {
      const raw =
        typeof globalThis.localStorage !== "undefined"
          ? globalThis.localStorage.getItem(sk)
          : this.memoryStore.get(sk) ?? null;
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  public async writeSetting<T>(key: string, value: T): Promise<void> {
    const sk = this.getStorageKey(key);
    const serialized = JSON.stringify(value);
    this.memoryStore.set(sk, serialized);
    try {
      if (typeof globalThis.localStorage !== "undefined") {
        globalThis.localStorage.setItem(sk, serialized);
      }
    } catch {
      // Fallback to in-memory store when storage quota is restricted
    }
  }

  public async getRecentFiles(): Promise<RecentFileEntry[]> {
    return this.readSetting<RecentFileEntry[]>("recent_files", [
      {
        path: "demo://antihero.kpx-snapshot",
        name: "antihero.ase",
        width: 48,
        height: 48,
        colorMode: "rgba",
        openedAt: "2026-02-20 14:30",
      },
      {
        path: "demo://slime_bounce.kpx-snapshot",
        name: "slime_bounce.ase",
        width: 32,
        height: 32,
        colorMode: "indexed",
        openedAt: "2026-02-20 11:15",
      },
      {
        path: "demo://dungeon_tiles.kpx-snapshot",
        name: "dungeon_tiles.ase",
        width: 64,
        height: 64,
        colorMode: "rgba",
        openedAt: "2026-02-19 19:05",
      },
    ]);
  }

  public async addRecentFile(entry: RecentFileEntry): Promise<void> {
    const list = await this.getRecentFiles();
    const filtered = list.filter((item) => item.name !== entry.name);
    filtered.unshift(entry);
    await this.writeSetting("recent_files", filtered.slice(0, 12));
  }

  public async clearRecentFiles(): Promise<void> {
    await this.writeSetting("recent_files", []);
  }

  public async openFileDialog(options?: FileDialogOptions): Promise<OpenFileResult | null> {
    if (typeof document === "undefined") return null;
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept =
        options?.extensions?.map((ext) => (ext.startsWith(".") ? ext : `.${ext}`)).join(",") ??
        ".kpx-snapshot,.json,.ase,.aseprite,.png,.kpext,.gpl,.pal,.hex,.ts,.js";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const buf = await file.arrayBuffer();
        const text = await file.text();
        resolve({
          path: file.name,
          name: file.name,
          data: new Uint8Array(buf),
          text,
        });
      };
      input.click();
    });
  }

  public async saveFileDialog(
    data: Uint8Array | string,
    options?: FileDialogOptions
  ): Promise<{ saved: boolean; path?: string }> {
    const fileName = options?.defaultName ?? "sprite.kpx-snapshot";
    if (typeof document !== "undefined") {
      const blob =
        typeof data === "string"
          ? new Blob([data], { type: "application/json;charset=utf-8" })
          : new Blob([new Uint8Array(data)], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    appLogger.info("Platform", `Saved file ${fileName}`);
    return { saved: true, path: fileName };
  }

  public async writeClipboardText(text: string): Promise<void> {
    this.clipboardBuffer = text;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // Fallback to internal clipboard buffer
    }
  }

  public async readClipboardText(): Promise<string> {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        return await navigator.clipboard.readText();
      }
    } catch {
      // Fallback
    }
    return this.clipboardBuffer;
  }

  private async syncVirtualFsFromStorage(): Promise<void> {
    const stored = await this.readSetting<Record<string, string>>("virtual_fs", {});
    for (const [k, v] of Object.entries(stored)) {
      if (!this.virtualFs.has(k)) {
        this.virtualFs.set(k, v);
      }
    }
  }

  private async flushVirtualFsToStorage(): Promise<void> {
    const obj: Record<string, string> = {};
    for (const [k, v] of this.virtualFs.entries()) {
      obj[k] = v;
    }
    await this.writeSetting("virtual_fs", obj);
  }

  public async listFiles(dirPath: string): Promise<string[]> {
    await this.syncVirtualFsFromStorage();
    const norm = this.normalizePath(dirPath);
    const prefix = norm + "/";
    const out: string[] = [];
    for (const key of this.virtualFs.keys()) {
      if (key.startsWith(prefix)) {
        out.push(key.slice(prefix.length));
      }
    }
    return out.sort();
  }

  public async readTextFile(filePath: string): Promise<string | null> {
    await this.syncVirtualFsFromStorage();
    const norm = this.normalizePath(filePath);
    return this.virtualFs.get(norm) ?? null;
  }

  public async writeTextFile(filePath: string, content: string): Promise<void> {
    await this.syncVirtualFsFromStorage();
    const norm = this.normalizePath(filePath);
    this.virtualFs.set(norm, content);
    await this.flushVirtualFsToStorage();
  }

  public async deleteFile(filePath: string): Promise<boolean> {
    await this.syncVirtualFsFromStorage();
    const norm = this.normalizePath(filePath);
    const deleted = this.virtualFs.delete(norm);
    if (deleted) {
      await this.flushVirtualFsToStorage();
    }
    return deleted;
  }

  public async fetch(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ): Promise<PlatformFetchResult> {
    if (typeof globalThis.fetch === "function" && (url.startsWith("http://") || url.startsWith("https://"))) {
      try {
        const res = await globalThis.fetch(url, {
          method: init?.method ?? "GET",
          headers: init?.headers,
          body: init?.body,
        });
        const text = await res.text();
        return { status: res.status, ok: res.ok, text };
      } catch (err) {
        return {
          status: 503,
          ok: false,
          text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        };
      }
    }
    // Simulated local/sandbox endpoint for deterministic tests
    return {
      status: 200,
      ok: true,
      text: JSON.stringify({ url, method: init?.method ?? "GET", sandbox: true }),
    };
  }
}

let activePlatform: PlatformAPI = new WebPlatform();

/**
 * Returns the active PlatformAPI instance.
 */
export function getPlatform(): PlatformAPI {
  return activePlatform;
}

/**
 * Sets the active PlatformAPI instance (used by Electron preload/renderer initialization).
 */
export function setPlatform(platform: PlatformAPI): void {
  activePlatform = platform;
}
