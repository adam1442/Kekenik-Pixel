/**
 * @module @kekenik/desktop/main
 * Production Electron Main process (B13, B16, B17):
 *  - Frameless custom window chrome (`frame: false`, `thickFrame: true`, `resizable: true`, `Menu.setApplicationMenu(null)`)
 *  - macOS `titleBarStyle: 'hidden'` traffic-light positioning
 *  - Persistent window bounds & maximized state clamped across displays (`WindowStateStore`)
 *  - Single-instance lock (`app.requestSingleInstanceLock()`) + `second-instance` file-open handoff
 *  - Portable mode (`process.env.PORTABLE_EXECUTABLE_DIR` -> `KekenikPixelData/`)
 *  - Strict security (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, CSP, zod-validated IPC)
 *  - Atomic file writes & user-friendly uncaught error dialog with "Open Logs Folder" button
 */

import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  FileDialogOptions,
  OpenFileResult,
  RecentFileEntry,
} from "../../../packages/core/src/index.ts";
import {
  atomicWriteFile,
  cleanupStaleTempFiles,
  ClipboardTextSchema,
  ControllableWindow,
  DisplayWorkArea,
  extractFilePathsFromArgv,
  FileDialogOptionsSchema,
  RecentFileEntrySchema,
  registerWindowControlIpc,
  resolveDesktopDataDir,
  resolveDesktopIconPath,
  SettingKeySchema,
  WindowStateStore,
} from "./main/ipc.ts";

export interface ElectronMainConfig {
  readonly customTitleBar: boolean;
  readonly width: number;
  readonly height: number;
  readonly devServerUrl?: string;
  readonly platform?: NodeJS.Platform;
  readonly env?: Record<string, string | undefined>;
  readonly argv?: readonly string[];
  readonly onOpenFileRequest?: (file: OpenFileResult) => void;
}

export const DEFAULT_MAIN_CONFIG: ElectronMainConfig = {
  customTitleBar: true,
  width: 1280,
  height: 800,
  devServerUrl: process.env.VITE_DEV_SERVER_URL,
};

export const STRICT_DESKTOP_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self';";


/**
 * Directory of the currently executing module, derived with `fileURLToPath` so that Windows
 * drive letters and spaces in the installation path are handled correctly (a plain
 * `new URL(import.meta.url).pathname` yields `/C:/Program%20Files/...` on Windows).
 */
function currentModuleDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

/**
 * Resolves the application root (the folder that contains `package.json`, `dist/` and
 * `dist-electron/`) both when running from source and when running from inside an
 * `app.asar` archive, walking up until a `package.json` with the expected product name
 * is found.
 */
export function resolveAppRoot(startDir: string = currentModuleDir()): string {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 8; depth++) {
    if (fsSync.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir, "..");
}

/**
 * Resolves the renderer HTML entry that ships inside the packaged application.
 * The Electron renderer bundle is emitted as `dist/desktop.html`; `dist/index.html`
 * (browser build) is used as a fallback for older bundles.
 */
export function resolveRendererIndexHtml(repoRoot: string): string {
  const desktopHtml = path.join(repoRoot, "dist", "desktop.html");
  if (fsSync.existsSync(desktopHtml)) return desktopHtml;
  return path.join(repoRoot, "dist", "index.html");
}

/**
 * Absolute path of the bundled preload script (`dist-electron/preload.cjs`).
 */
export function resolvePreloadScriptPath(moduleDir: string = currentModuleDir()): string {
  return path.join(moduleDir, "preload.cjs");
}

/**
 * Persists and retrieves settings JSON atomically in the userData (or portable `KekenikPixelData`) directory.
 */
export class DesktopSettingsStore {
  private readonly filePath: string;
  // Serialize the whole read-modify-write, not just the atomic rename: otherwise writes
  // to different settings race and silently discard each other.
  private writes: Promise<void> = Promise.resolve();

  public constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, "kekenik-settings.json");
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public async readAll(): Promise<Record<string, unknown>> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  public async read<T>(key: string, fallback: T): Promise<T> {
    const validKey = SettingKeySchema.parse(key);
    const all = await this.readAll();
    return (all[validKey] as T | undefined) ?? fallback;
  }

  /** Wait for all writes already accepted by the main process. */
  public async flush(): Promise<void> {
    await this.writes;
  }

  public async write<T>(key: string, value: T): Promise<void> {
    const validKey = SettingKeySchema.parse(key);
    const write = this.writes.then(async () => {
      const all = await this.readAll();
      all[validKey] = value;
      await atomicWriteFile(this.filePath, JSON.stringify(all, null, 2));
    });
    // A failed write must not poison the queue; return the original rejection to its caller.
    this.writes = write.catch(() => undefined);
    await write;
  }
}

/**
 * Handles an uncaught main-process error by logging atomically to `logs/main-error.log`
 * and presenting a user-friendly dialog with an "Open Logs Folder" button.
 */
export async function handleMainProcessError(
  error: unknown,
  logsDir: string,
  dialogApi?: {
    showMessageBox?(options: {
      type: string;
      title: string;
      message: string;
      detail: string;
      buttons: string[];
    }): Promise<{ response: number }>;
  },
  shellApi?: {
    openPath?(targetPath: string): Promise<string>;
  }
): Promise<{ loggedPath: string; openedLogs: boolean }> {
  const errMsg = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  const logFile = path.join(logsDir, "main-error.log");
  await atomicWriteFile(
    logFile,
    `[${new Date().toISOString()}] Uncaught Main Process Error:\n${errMsg}\n`
  );

  let openedLogs = false;
  if (dialogApi?.showMessageBox) {
    const res = await dialogApi.showMessageBox({
      type: "error",
      title: "Kekenik Pixel — Unexpected Error",
      message: "An unexpected error occurred in the desktop background process.",
      detail: `${errMsg.slice(0, 600)}\n\nYour recovery snapshots are preserved.`,
      buttons: ["Open Logs Folder", "Close"],
    });
    if (res.response === 0 && shellApi?.openPath) {
      await shellApi.openPath(logsDir);
      openedLogs = true;
    }
  }
  return { loggedPath: logFile, openedLogs };
}

/**
 * Bootstraps the Electron Main process, enforces single-instance lock + second-instance file handoff,
 * redirects portable `userData` when `PORTABLE_EXECUTABLE_DIR` is set, configures custom frameless
 * window chrome (`frame: false`, `Menu.setApplicationMenu(null)`), and registers zod-validated IPC.
 */
export async function bootstrapElectronMain(
  electronModule: {
    app: {
      getPath(name: string): string;
      setPath?(name: string, targetPath: string): void;
      whenReady(): Promise<void>;
      on(event: string, listener: (...args: unknown[]) => void): void;
      quit(): void;
      requestSingleInstanceLock?(): boolean;
    };
    BrowserWindow: new (options: Record<string, unknown>) => ControllableWindow & {
      loadURL(url: string): Promise<void>;
      loadFile(filePath: string): Promise<void>;
      maximize(): void;
    };
    Menu?: {
      setApplicationMenu(menu: null): void;
    };
    screen?: {
      getAllDisplays(): Array<{ workArea: DisplayWorkArea }>;
    };
    session?: {
      defaultSession?: {
        webRequest?: {
          onHeadersReceived(
            listener: (
              details: { responseHeaders?: Record<string, string[]> },
              callback: (resp: { responseHeaders: Record<string, string[]> }) => void
            ) => void
          ): void;
        };
      };
    };
    ipcMain: {
      handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
    };
    dialog: {
      showOpenDialog(
        options: Record<string, unknown>
      ): Promise<{ canceled: boolean; filePaths: string[] }>;
      showSaveDialog(
        options: Record<string, unknown>
      ): Promise<{ canceled: boolean; filePath?: string }>;
      showMessageBox?(options: {
        type: string;
        title: string;
        message: string;
        detail: string;
        buttons: string[];
      }): Promise<{ response: number }>;
    };
    shell?: {
      openPath?(targetPath: string): Promise<string>;
      openExternal?(url: string): Promise<void>;
    };
    clipboard: {
      writeText(text: string): void;
      readText(): string;
    };
  },
  configOverrides: Partial<ElectronMainConfig> = {}
): Promise<{
  locked: boolean;
  userDataDir: string;
  isPortable: boolean;
  windowStateStore: WindowStateStore;
}> {
  const { app, BrowserWindow, Menu, screen, session, ipcMain, dialog, shell, clipboard } =
    electronModule;
  const cfg: ElectronMainConfig = { ...DEFAULT_MAIN_CONFIG, ...configOverrides };
  const platform = cfg.platform ?? process.platform;
  const env = cfg.env ?? process.env;

  // 1. Portable Mode Data Redirection (B17)
  const resolvedDirs = resolveDesktopDataDir(app.getPath("userData"), env);
  if (resolvedDirs.isPortable && typeof app.setPath === "function") {
    app.setPath("userData", resolvedDirs.userDataDir);
  }
  await fs.mkdir(resolvedDirs.userDataDir, { recursive: true });
  await fs.mkdir(resolvedDirs.logsDir, { recursive: true });
  await cleanupStaleTempFiles(resolvedDirs.userDataDir);

  const windowStateStore = new WindowStateStore(resolvedDirs.userDataDir);

  // 2. Single-Instance Lock & Second-Instance File Handoff (B17)
  if (typeof app.requestSingleInstanceLock === "function") {
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
      app.quit();
      return {
        locked: false,
        userDataDir: resolvedDirs.userDataDir,
        isPortable: resolvedDirs.isPortable,
        windowStateStore,
      };
    }
  }

  let mainWindow: (ControllableWindow & {
    loadURL(url: string): Promise<void>;
    loadFile(filePath: string): Promise<void>;
  }) | null = null;

  const openExternalFileInWindow = async (filePath: string) => {
    try {
      const buf = await fs.readFile(filePath);
      const payload: OpenFileResult = {
        path: filePath,
        name: path.basename(filePath),
        data: new Uint8Array(buf),
        text: buf.toString("utf-8"),
      };
      mainWindow?.webContents?.send?.("kpx:open-external-file", payload);
      cfg.onOpenFileRequest?.(payload);
    } catch {
      // Ignore unreadable external paths
    }
  };

  app.on("second-instance", (_event: unknown, secondArgv: unknown, workingDir: unknown) => {
    if (mainWindow) {
      if (typeof mainWindow.isMinimized === "function" && mainWindow.isMinimized()) {
        mainWindow.restore?.();
      }
      mainWindow.focus?.();
    }
    const argvList = Array.isArray(secondArgv) ? (secondArgv as string[]) : [];
    const cwd = typeof workingDir === "string" ? workingDir : process.cwd();
    const filesToOpen = extractFilePathsFromArgv(argvList, cwd);
    for (const fp of filesToOpen) {
      void openExternalFileInWindow(fp);
    }
  });

  await app.whenReady();

  // 3. Remove Native Application Menu Bar for Custom Embedded MenuBar (B13)
  Menu?.setApplicationMenu(null);

  // 4. Strict Content-Security-Policy (CSP)
  session?.defaultSession?.webRequest?.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...(details.responseHeaders ?? {}),
        "Content-Security-Policy": [STRICT_DESKTOP_CSP],
      },
    });
  });

  const store = new DesktopSettingsStore(resolvedDirs.userDataDir);
  const customTitleBar = await store.read("customTitleBar", cfg.customTitleBar);

  // 5. Load & Clamp Saved Window Bounds Across Displays (B13)
  const displays: DisplayWorkArea[] =
    screen?.getAllDisplays().map((d) => d.workArea) ?? [
      { x: 0, y: 0, width: 1920, height: 1080 },
    ];
  const initialBounds = await windowStateStore.load(displays);

  // 6. Register PlatformAPI IPC Handlers (with zod validation & atomic writes).
  //    Registration happens exactly once per process: re-entering `bootstrapElectronMain`
  //    (macOS dock `activate` after the last window was closed) must not double-register
  //    ipcMain channels, which Electron rejects at runtime.
  const ipcRegistry = ipcMain as unknown as {
    __kekenikPixelIpcRegistered?: boolean;
    __kekenikPixelGetWindow?: () => ControllableWindow | null;
  };
  ipcRegistry.__kekenikPixelGetWindow = () => mainWindow;

  const registerPlatformIpcHandlers = () => {
  ipcMain.handle("kpx:readSetting", async (_ev, key: unknown, fallback: unknown) => {
    const validKey = SettingKeySchema.parse(String(key));
    return store.read(validKey, fallback);
  });

  ipcMain.handle("kpx:writeSetting", async (_ev, key: unknown, value: unknown) => {
    const validKey = SettingKeySchema.parse(String(key));
    await store.write(validKey, value);
  });

  ipcMain.handle("kpx:getRecentFiles", async () => {
    return store.read<RecentFileEntry[]>("recent_files", []);
  });

  ipcMain.handle("kpx:addRecentFile", async (_ev, entry: unknown) => {
    const typed = RecentFileEntrySchema.parse(entry) as RecentFileEntry;
    const list = await store.read<RecentFileEntry[]>("recent_files", []);
    const next = [typed, ...list.filter((i) => i.path !== typed.path)].slice(0, 12);
    await store.write("recent_files", next);
  });

  ipcMain.handle("kpx:clearRecentFiles", async () => {
    await store.write("recent_files", []);
  });

  ipcMain.handle(
    "kpx:openFileDialog",
    async (_ev, rawOpts: unknown): Promise<OpenFileResult | null> => {
      const opts = (FileDialogOptionsSchema.parse(rawOpts) as FileDialogOptions | undefined) ?? {};
      const res = await dialog.showOpenDialog({
        title: opts.title ?? "Open Sprite",
        properties: ["openFile"],
        filters: opts.extensions?.length
          ? [{ name: "Supported Sprite Files", extensions: opts.extensions }]
          : undefined,
      });
      if (res.canceled || res.filePaths.length === 0) return null;
      const fp = res.filePaths[0];
      const buf = await fs.readFile(fp);
      return {
        path: fp,
        name: path.basename(fp),
        data: new Uint8Array(buf),
        text: buf.toString("utf-8"),
      };
    }
  );

  ipcMain.handle(
    "kpx:saveFileDialog",
    async (_ev, data: unknown, rawOpts: unknown): Promise<{ saved: boolean; path?: string }> => {
      const opts = (FileDialogOptionsSchema.parse(rawOpts) as FileDialogOptions | undefined) ?? {};
      const res = await dialog.showSaveDialog({
        title: opts.title ?? "Save Sprite",
        defaultPath: opts.defaultName ?? "sprite.kpx",
      });
      if (res.canceled || !res.filePath) return { saved: false };
      if (typeof data === "string") {
        await atomicWriteFile(res.filePath, data);
      } else if (data instanceof Uint8Array) {
        await atomicWriteFile(res.filePath, data);
      }
      return { saved: true, path: res.filePath };
    }
  );

  ipcMain.handle("kpx:writeClipboardText", (_ev, text: unknown) => {
    const valid = ClipboardTextSchema.parse(String(text ?? ""));
    clipboard.writeText(valid);
  });

  ipcMain.handle("kpx:readClipboardText", () => {
    return clipboard.readText();
  });

  ipcMain.handle("kpx:openLogsFolder", async () => {
    if (shell?.openPath) {
      await shell.openPath(resolvedDirs.logsDir);
      return { opened: true, path: resolvedDirs.logsDir };
    }
    return { opened: false, path: resolvedDirs.logsDir };
  });

  // Opens an http(s) link in the OS default browser (About dialog + Home tab repository link).
  ipcMain.handle("kpx:openExternalUrl", async (_ev, rawUrl: unknown) => {
    const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
    if (!/^https?:\/\//i.test(url)) return { opened: false };
    const opener = shell as { openExternal?(url: string): Promise<void> } | undefined;
    if (!opener?.openExternal) return { opened: false };
    try {
      await opener.openExternal(url);
      return { opened: true };
    } catch {
      return { opened: false };
    }
  });

  // 7. Register B13 Window Control IPC Handlers (`window:minimize`, `window:maximize`, `window:restore`, `window:close`, `window:is-maximized`)
  registerWindowControlIpc(
    ipcMain,
    () => ipcRegistry.__kekenikPixelGetWindow?.() ?? mainWindow,
    windowStateStore
  );
  };

  if (!ipcRegistry.__kekenikPixelIpcRegistered) {
    ipcRegistry.__kekenikPixelIpcRegistered = true;
    registerPlatformIpcHandlers();
    // Closing the last window can otherwise terminate Electron while an accepted settings
    // write is still queued. Only install this once, alongside the IPC handlers.
    let quitAfterSettingsFlush = false;
    app.on("before-quit", (event: unknown) => {
      if (quitAfterSettingsFlush) return;
      const quitEvent = event as { preventDefault?: () => void } | undefined;
      if (!quitEvent?.preventDefault) return;
      quitEvent.preventDefault();
      quitAfterSettingsFlush = true;
      void store.flush().finally(() => app.quit());
    });
  }

  // 8. Construct Frameless BrowserWindow with B13 Chrome & B16 Icon
  const repoRoot = process.env.KPX_APP_ROOT
    ? path.resolve(process.env.KPX_APP_ROOT)
    : resolveAppRoot();
  const iconPath = resolveDesktopIconPath(repoRoot, platform);

  const windowOptions: Record<string, unknown> = {
    x: initialBounds.x,
    y: initialBounds.y,
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: 640,
    minHeight: 480,
    frame: !customTitleBar,
    thickFrame: true,
    resizable: true,
    icon: iconPath,
    backgroundColor: "#49434d",
    ...(platform === "darwin" && customTitleBar
      ? {
          titleBarStyle: "hidden",
          trafficLightPosition: { x: 12, y: 8 },
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: resolvePreloadScriptPath(),
    },
  };

  mainWindow = new BrowserWindow(windowOptions);

  if (initialBounds.isMaximized) {
    mainWindow.maximize();
  }

  // Persist window bounds when moved/resized/closed
  const saveBoundsFromWindow = () => {
    if (!mainWindow || typeof mainWindow.getBounds !== "function") return;
    const b = mainWindow.getBounds();
    void windowStateStore.save({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      isMaximized: Boolean(mainWindow.isMaximized?.()),
      isFullScreen: Boolean(mainWindow.isFullScreen?.()),
    });
  };
  mainWindow.on?.("resize", saveBoundsFromWindow);
  mainWindow.on?.("move", saveBoundsFromWindow);
  mainWindow.on?.("close", saveBoundsFromWindow);

  if (cfg.devServerUrl) {
    await mainWindow.loadURL(cfg.devServerUrl);
  } else {
    const indexHtml = resolveRendererIndexHtml(repoRoot);
    await mainWindow.loadFile(indexHtml);
  }

  // Open any file passed on initial startup `argv` (e.g. double-clicking a `.kpx` file when app was not running)
  const initialFiles = extractFilePathsFromArgv(cfg.argv ?? process.argv);
  for (const fp of initialFiles) {
    await openExternalFileInWindow(fp);
  }

  return {
    locked: true,
    userDataDir: resolvedDirs.userDataDir,
    isPortable: resolvedDirs.isPortable,
    windowStateStore,
  };
}
