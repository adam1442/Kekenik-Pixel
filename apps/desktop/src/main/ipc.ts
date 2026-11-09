/**
 * @module @kekenik/desktop/main/ipc
 * Runtime-validated (zod) IPC handlers for custom frameless window controls (B13),
 * atomic file persistence, window state recovery/clamping, portable mode data redirection (B17),
 * and single-instance file-open handoff (B17).
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  FileDialogOptions,
  OpenFileResult,
  RecentFileEntry,
} from "../../../../packages/core/src/index.ts";

// ---- 1. Zod Schemas for Strict Runtime IPC Validation ----

export const WindowActionChannelSchema = z.enum([
  "window:minimize",
  "window:maximize",
  "window:restore",
  "window:close",
  "window:is-maximized",
  "window:toggle-fullscreen",
  "window:is-fullscreen",
  "window:get-bounds",
  "window:set-bounds",
]);

export const WindowBoundsSchema = z.object({
  x: z.number().int().finite(),
  y: z.number().int().finite(),
  width: z.number().int().min(320).max(16384),
  height: z.number().int().min(240).max(16384),
  isMaximized: z.boolean().optional(),
  isFullScreen: z.boolean().optional(),
});

export type WindowBoundsState = z.infer<typeof WindowBoundsSchema>;

export const SetWindowBoundsPayloadSchema = z.object({
  x: z.number().int().finite().optional(),
  y: z.number().int().finite().optional(),
  width: z.number().int().min(320).max(16384).optional(),
  height: z.number().int().min(240).max(16384).optional(),
});

export const SettingKeySchema = z.string().min(1).max(256);

export const RecentFileEntrySchema = z.object({
  path: z.string().min(1).max(4096),
  name: z.string().min(1).max(1024),
  openedAt: z.string().optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  colorMode: z.enum(["rgba", "grayscale", "indexed"]).optional(),
});

export const FileDialogOptionsSchema = z
  .object({
    title: z.string().max(256).optional(),
    defaultName: z.string().max(1024).optional(),
    extensions: z.array(z.string().max(32)).optional(),
  })
  .optional();

export const ClipboardTextSchema = z.string().max(10_000_000);

export const DEFAULT_WINDOW_BOUNDS: WindowBoundsState = {
  x: 100,
  y: 80,
  width: 1280,
  height: 800,
  isMaximized: false,
  isFullScreen: false,
};

// ---- 2. Atomic File Write & Portable Mode Resolution ----

/**
 * Serializes concurrent writes per target file. Window move/resize/close events can fire
 * several saves in the same millisecond; without a queue two saves would share the same
 * temporary file name and the second `rename()` would fail with ENOENT (which surfaced as a
 * modal "unexpected error" dialog at startup).
 */
const pendingWrites = new Map<string, Promise<unknown>>();
let tempFileCounter = 0;

/**
 * Atomically writes data to `targetPath` by writing to a unique temporary sibling file first
 * and renaming it into place (same-filesystem `rename` is atomic on Windows, macOS and Linux).
 */
export async function atomicWriteFile(
  targetPath: string,
  data: string | Uint8Array
): Promise<void> {
  const performWrite = async (): Promise<void> => {
    const dir = path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true });
    tempFileCounter += 1;
    const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${tempFileCounter}`;
    try {
      if (typeof data === "string") {
        await fs.writeFile(tempPath, data, "utf-8");
      } else {
        await fs.writeFile(tempPath, Buffer.from(data));
      }
      await fs.rename(tempPath, targetPath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  const previous = pendingWrites.get(targetPath) ?? Promise.resolve();
  const current = previous.then(performWrite, performWrite);
  // Keep the chain alive but never let a rejection leak as an unhandled rejection.
  pendingWrites.set(
    targetPath,
    current.catch(() => undefined)
  );
  try {
    await current;
  } finally {
    if (pendingWrites.get(targetPath) === current) {
      pendingWrites.delete(targetPath);
    }
  }
}

/**
 * Removes leftover `*.tmp.*` files from previous sessions (a hard kill or power loss can leave
 * a partially written temporary file next to the settings/window-state JSON).
 * Failures are ignored – cleanup must never block application start.
 * @param dir
 */
export async function cleanupStaleTempFiles(dir: string): Promise<number> {
  let removed = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.includes(".tmp.")) continue;
      const abs = path.join(dir, entry.name);
      try {
        const stat = await fs.stat(abs);
        // Only touch files that are clearly not being written right now.
        if (Date.now() - stat.mtimeMs < 60_000) continue;
        await fs.rm(abs, { force: true });
        removed += 1;
      } catch {
        // ignore individual failures
      }
    }
  } catch {
    // ignore unreadable directories
  }
  return removed;
}

/**
 * Resolves the userData directory, redirecting to `<PORTABLE_EXECUTABLE_DIR>/KekenikPixelData`
 * when running as a Windows portable executable (`process.env.PORTABLE_EXECUTABLE_DIR` set by electron-builder).
 */
export function resolveDesktopDataDir(
  defaultUserDataDir: string,
  env: Record<string, string | undefined> = process.env
): {
  userDataDir: string;
  settingsFilePath: string;
  windowStateFilePath: string;
  autosaveDir: string;
  logsDir: string;
  isPortable: boolean;
} {
  const portableBase = env.PORTABLE_EXECUTABLE_DIR?.trim();
  const isPortable = Boolean(portableBase && portableBase.length > 0);
  const userDataDir = isPortable
    ? path.join(portableBase!, "KekenikPixelData")
    : defaultUserDataDir;

  return {
    userDataDir,
    settingsFilePath: path.join(userDataDir, "kekenik-settings.json"),
    windowStateFilePath: path.join(userDataDir, "window-state.json"),
    autosaveDir: path.join(userDataDir, "autosave"),
    logsDir: path.join(userDataDir, "logs"),
    isPortable,
  };
}

// ---- 3. Display Clamping & Crash-Safe Window State Persistence ----

export interface DisplayWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Clamps saved window bounds so the window is guaranteed to be visible on at least one active monitor.
 * Handles multi-monitor setups and unplugged secondary displays gracefully.
 */
export function clampWindowBoundsToDisplays(
  saved: Partial<WindowBoundsState> | null | undefined,
  displays: readonly DisplayWorkArea[]
): WindowBoundsState {
  const list =
    displays.length > 0
      ? displays
      : [{ x: 0, y: 0, width: 1920, height: 1080 }];
  const primary = list[0];

  const rawW = typeof saved?.width === "number" && Number.isFinite(saved.width) ? saved.width : DEFAULT_WINDOW_BOUNDS.width;
  const rawH = typeof saved?.height === "number" && Number.isFinite(saved.height) ? saved.height : DEFAULT_WINDOW_BOUNDS.height;

  // Find a display whose workArea intersects the saved window by at least 100x60 px
  const rawX = typeof saved?.x === "number" && Number.isFinite(saved.x) ? saved.x : primary.x + Math.max(0, Math.floor((primary.width - rawW) / 2));
  const rawY = typeof saved?.y === "number" && Number.isFinite(saved.y) ? saved.y : primary.y + Math.max(0, Math.floor((primary.height - rawH) / 2));

  let targetDisplay = list.find((d) => {
    const overlapX = Math.min(rawX + rawW, d.x + d.width) - Math.max(rawX, d.x);
    const overlapY = Math.min(rawY + rawH, d.y + d.height) - Math.max(rawY, d.y);
    return overlapX >= 100 && overlapY >= 60;
  });

  if (!targetDisplay) {
    targetDisplay = primary;
  }

  const width = Math.max(640, Math.min(Math.round(rawW), targetDisplay.width));
  const height = Math.max(480, Math.min(Math.round(rawH), targetDisplay.height));

  const x = Math.max(
    targetDisplay.x,
    Math.min(Math.round(rawX), targetDisplay.x + targetDisplay.width - width)
  );
  const y = Math.max(
    targetDisplay.y,
    Math.min(Math.round(rawY), targetDisplay.y + targetDisplay.height - height)
  );

  return {
    x,
    y,
    width,
    height,
    isMaximized: Boolean(saved?.isMaximized),
    isFullScreen: Boolean(saved?.isFullScreen),
  };
}

/**
 * Crash-resilient WindowStateStore that persists window bounds atomically and recovers cleanly if corrupted.
 */
export class WindowStateStore {
  private readonly filePath: string;

  public constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, "window-state.json");
  }

  public async load(displays: readonly DisplayWorkArea[] = []): Promise<WindowBoundsState> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      const validated = WindowBoundsSchema.partial().safeParse(parsed);
      if (!validated.success) {
        return clampWindowBoundsToDisplays(DEFAULT_WINDOW_BOUNDS, displays);
      }
      return clampWindowBoundsToDisplays(validated.data, displays);
    } catch {
      return clampWindowBoundsToDisplays(DEFAULT_WINDOW_BOUNDS, displays);
    }
  }

  public async save(state: WindowBoundsState): Promise<void> {
    const validated = WindowBoundsSchema.parse(state);
    await atomicWriteFile(this.filePath, JSON.stringify(validated, null, 2));
  }
}

// ---- 4. Single-Instance CLI / Explorer File Argument Extraction (B17) ----

const SUPPORTED_OPEN_EXTENSIONS = new Set([
  ".kpx",
  ".kpx-snapshot",
  ".ase",
  ".aseprite",
  ".png",
  ".gif",
  ".apng",
  ".webp",
  ".jpg",
  ".jpeg",
  ".bmp",
  ".ico",
  ".tga",
  ".qoi",
  ".pcx",
  ".flc",
  ".fli",
]);

/**
 * Extracts supported sprite/project file paths from a process `argv` array (used on initial launch
 * and on `second-instance` handoff from Windows Explorer double-click / "Open with").
 */
export function extractFilePathsFromArgv(
  argv: readonly string[],
  workingDirectory: string = process.cwd()
): string[] {
  const results: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]?.trim();
    if (!arg || arg.startsWith("-")) continue;
    const ext = path.extname(arg).toLowerCase();
    if (!SUPPORTED_OPEN_EXTENSIONS.has(ext)) continue;
    const resolved = path.isAbsolute(arg) ? arg : path.resolve(workingDirectory, arg);
    if (!results.includes(resolved)) {
      results.push(resolved);
    }
  }
  return results;
}

// ---- 5. Window Control IPC Registration (B13) ----

export interface ControllableWindow {
  minimize(): void;
  maximize(): void;
  unmaximize?(): void;
  restore?(): void;
  close(): void;
  focus?(): void;
  isMaximized?(): boolean;
  isMinimized?(): boolean;
  isFullScreen?(): boolean;
  setFullScreen?(flag: boolean): void;
  getBounds?(): { x: number; y: number; width: number; height: number };
  setBounds?(bounds: { x?: number; y?: number; width?: number; height?: number }): void;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  webContents?: {
    send?(channel: string, ...args: unknown[]): void;
  };
}

/**
 * Registers the B13 typed window-control IPC handlers (`window:minimize`, `window:maximize`,
 * `window:restore`, `window:close`, `window:is-maximized`, `window:toggle-fullscreen`,
 * `window:get-bounds`, `window:set-bounds`) with runtime zod validation.
 */
export function registerWindowControlIpc(
  ipcMain: {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  },
  getWindow: () => ControllableWindow | null,
  windowStateStore?: WindowStateStore
): void {
  let maximizedFallback = false;
  let fullScreenFallback = false;
  let boundsFallback = { ...DEFAULT_WINDOW_BOUNDS };

  const readIsMaximized = (win: ControllableWindow | null): boolean => {
    if (!win) return false;
    if (typeof win.isMaximized === "function") {
      return Boolean(win.isMaximized());
    }
    return maximizedFallback;
  };

  const readIsFullScreen = (win: ControllableWindow | null): boolean => {
    if (!win) return false;
    if (typeof win.isFullScreen === "function") {
      return Boolean(win.isFullScreen());
    }
    return fullScreenFallback;
  };

  const persistCurrentBounds = async (win: ControllableWindow | null) => {
    if (!win || !windowStateStore) return;
    const b = typeof win.getBounds === "function" ? win.getBounds() : boundsFallback;
    await windowStateStore.save({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      isMaximized: readIsMaximized(win),
      isFullScreen: readIsFullScreen(win),
    });
  };

  ipcMain.handle("window:minimize", (_ev) => {
    WindowActionChannelSchema.parse("window:minimize");
    const win = getWindow();
    if (!win) return { minimized: false, isMaximized: false };
    win.minimize();
    return { minimized: true, isMaximized: readIsMaximized(win) };
  });

  ipcMain.handle("window:maximize", async (_ev) => {
    WindowActionChannelSchema.parse("window:maximize");
    const win = getWindow();
    if (!win) return { isMaximized: false };
    win.maximize();
    maximizedFallback = true;
    await persistCurrentBounds(win);
    win.webContents?.send?.("window:state-changed", {
      isMaximized: readIsMaximized(win),
      isFullScreen: readIsFullScreen(win),
    });
    return { isMaximized: readIsMaximized(win) };
  });

  ipcMain.handle("window:restore", async (_ev) => {
    WindowActionChannelSchema.parse("window:restore");
    const win = getWindow();
    if (!win) return { isMaximized: false };
    if (typeof win.isMinimized === "function" && win.isMinimized() && typeof win.restore === "function") {
      win.restore();
    } else if (typeof win.unmaximize === "function") {
      win.unmaximize();
    } else if (typeof win.restore === "function") {
      win.restore();
    }
    maximizedFallback = false;
    await persistCurrentBounds(win);
    win.webContents?.send?.("window:state-changed", {
      isMaximized: readIsMaximized(win),
      isFullScreen: readIsFullScreen(win),
    });
    return { isMaximized: readIsMaximized(win) };
  });

  ipcMain.handle("window:close", async (_ev) => {
    WindowActionChannelSchema.parse("window:close");
    const win = getWindow();
    if (!win) return { closed: false };
    await persistCurrentBounds(win);
    win.close();
    return { closed: true };
  });

  ipcMain.handle("window:is-maximized", (_ev) => {
    WindowActionChannelSchema.parse("window:is-maximized");
    const win = getWindow();
    return readIsMaximized(win);
  });

  ipcMain.handle("window:toggle-fullscreen", async (_ev, explicitFlag?: unknown) => {
    WindowActionChannelSchema.parse("window:toggle-fullscreen");
    const win = getWindow();
    if (!win) return { isFullScreen: false };
    const nextFlag =
      typeof explicitFlag === "boolean"
        ? z.boolean().parse(explicitFlag)
        : !readIsFullScreen(win);
    if (typeof win.setFullScreen === "function") {
      win.setFullScreen(nextFlag);
    }
    fullScreenFallback = nextFlag;
    await persistCurrentBounds(win);
    win.webContents?.send?.("window:state-changed", {
      isMaximized: readIsMaximized(win),
      isFullScreen: readIsFullScreen(win),
    });
    return { isFullScreen: readIsFullScreen(win) };
  });

  ipcMain.handle("window:is-fullscreen", (_ev) => {
    WindowActionChannelSchema.parse("window:is-fullscreen");
    const win = getWindow();
    return readIsFullScreen(win);
  });

  ipcMain.handle("window:get-bounds", (_ev) => {
    WindowActionChannelSchema.parse("window:get-bounds");
    const win = getWindow();
    const b = win && typeof win.getBounds === "function" ? win.getBounds() : boundsFallback;
    return {
      ...b,
      isMaximized: readIsMaximized(win),
      isFullScreen: readIsFullScreen(win),
    };
  });

  ipcMain.handle("window:set-bounds", async (_ev, rawBounds: unknown) => {
    WindowActionChannelSchema.parse("window:set-bounds");
    const parsed = SetWindowBoundsPayloadSchema.parse(rawBounds);
    const win = getWindow();
    const curr = win && typeof win.getBounds === "function" ? win.getBounds() : boundsFallback;
    const next = {
      x: parsed.x ?? curr.x,
      y: parsed.y ?? curr.y,
      width: parsed.width ?? curr.width,
      height: parsed.height ?? curr.height,
    };
    boundsFallback = { ...boundsFallback, ...next };
    if (win && typeof win.setBounds === "function") {
      win.setBounds(next);
    }
    await persistCurrentBounds(win);
    return {
      ...next,
      isMaximized: readIsMaximized(win),
      isFullScreen: readIsFullScreen(win),
    };
  });
}

// ---- 6. Resolve App Icon Path Across Platforms (B16) ----

export function resolveDesktopIconPath(
  rootDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  const iconDir = path.join(rootDir, "assets", "icon");
  if (platform === "win32") {
    return path.join(iconDir, "icon.ico");
  }
  if (platform === "darwin") {
    return path.join(iconDir, "icon.icns");
  }
  const png512 = path.join(iconDir, "icon.png");
  if (fsSync.existsSync(png512)) return png512;
  return path.join(iconDir, "png", "256x256.png");
}

// Re-export core types for convenience
export type { FileDialogOptions, OpenFileResult, RecentFileEntry };
