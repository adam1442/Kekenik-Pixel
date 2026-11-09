import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bootstrapElectronMain,
  DEFAULT_MAIN_CONFIG,
  DesktopSettingsStore,
  handleMainProcessError,
} from "../../../../apps/desktop/src/main.ts";
import {
  clampWindowBoundsToDisplays,
  DEFAULT_WINDOW_BOUNDS,
  extractFilePathsFromArgv,
  resolveDesktopDataDir,
  WindowStateStore,
} from "../../../../apps/desktop/src/main/ipc.ts";
import { exposeKekenikPreload } from "../../../../apps/desktop/src/preload.ts";
import { formatWindowDocumentTitle } from "../shell/TitleBar.tsx";
import { KEKENIK_APP_VERSION } from "../skin/app-icon.tsx";
import {
  computeFileSha256,
  getExpectedArtifactNames,
} from "../../../../scripts/build.mjs";
import {
  scanContentForForbiddenStrings,
  verifyReleaseBundle,
} from "../../../../scripts/verify-release-bundle.mjs";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `kpx-7b-${prefix}-`));
}

describe("Agent 7B Regression & Verification Suite (B12, B13, B16, B17)", () => {
  it("B13 window controls minimize/maximize/restore/close/fullscreen IPC, frameless BrowserWindow, Menu.setApplicationMenu(null), and strict preload surface", async () => {
    const tmpDir = createTempDir("b13-ipc");
    const ipcHandlers = new Map<string, (ev: unknown, ...args: unknown[]) => unknown>();
    const appListeners = new Map<string, (...args: unknown[]) => void>();
    const sentToRenderer: Array<{ channel: string; payload: unknown }> = [];

    let menuSetToNull = false;
    let constructedWinOpts: Record<string, unknown> | null = null;
    let winMinimized = false;
    let winMaximized = false;
    let winFullScreen = false;
    let winClosed = false;
    let winBounds = { x: 120, y: 90, width: 1280, height: 800 };

    class MockBrowserWindow {
      public webContents = {
        send: (channel: string, payload: unknown) => {
          sentToRenderer.push({ channel, payload });
        },
      };
      public constructor(opts: Record<string, unknown>) {
        constructedWinOpts = opts;
      }
      public minimize() {
        winMinimized = true;
      }
      public maximize() {
        winMaximized = true;
      }
      public unmaximize() {
        winMaximized = false;
      }
      public restore() {
        winMinimized = false;
        winMaximized = false;
      }
      public close() {
        winClosed = true;
      }
      public focus() {}
      public isMaximized() {
        return winMaximized;
      }
      public isMinimized() {
        return winMinimized;
      }
      public isFullScreen() {
        return winFullScreen;
      }
      public setFullScreen(flag: boolean) {
        winFullScreen = flag;
      }
      public getBounds() {
        return { ...winBounds };
      }
      public setBounds(next: Partial<typeof winBounds>) {
        winBounds = { ...winBounds, ...next };
      }
      public on() {}
      public async loadURL() {}
      public async loadFile() {}
    }

    const res = await bootstrapElectronMain(
      {
        app: {
          getPath: () => tmpDir,
          whenReady: async () => {},
          on: (ev, fn) => {
            appListeners.set(ev, fn);
          },
          quit: () => {},
          requestSingleInstanceLock: () => true,
        },
        BrowserWindow: MockBrowserWindow as never,
        Menu: {
          setApplicationMenu: (m) => {
            if (m === null) menuSetToNull = true;
          },
        },
        screen: {
          getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
        },
        ipcMain: {
          handle: (ch, fn) => {
            ipcHandlers.set(ch, fn);
          },
        },
        dialog: {
          showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
          showSaveDialog: async () => ({ canceled: true }),
        },
        clipboard: {
          writeText: () => {},
          readText: () => "",
        },
      },
      { platform: "win32", env: {}, argv: ["electron"] }
    );

    expect(res.locked).toBe(true);
    expect(DEFAULT_MAIN_CONFIG.customTitleBar).toBe(true);
    expect(menuSetToNull).toBe(true);
    expect(constructedWinOpts).not.toBeNull();
    expect(constructedWinOpts!["frame"]).toBe(false);
    expect(constructedWinOpts!["thickFrame"]).toBe(true);
    expect(constructedWinOpts!["resizable"]).toBe(true);

    const webPrefs = constructedWinOpts!["webPreferences"] as Record<string, unknown>;
    expect(webPrefs["contextIsolation"]).toBe(true);
    expect(webPrefs["sandbox"]).toBe(true);
    expect(webPrefs["nodeIntegration"]).toBe(false);

    // Exercise window:minimize, window:maximize, window:is-maximized, window:restore, window:toggle-fullscreen, window:close
    await ipcHandlers.get("window:minimize")?.(null);
    expect(winMinimized).toBe(true);

    await ipcHandlers.get("window:maximize")?.(null);
    expect(winMaximized).toBe(true);
    expect(await ipcHandlers.get("window:is-maximized")?.(null)).toBe(true);

    await ipcHandlers.get("window:restore")?.(null);
    expect(winMaximized).toBe(false);
    expect(await ipcHandlers.get("window:is-maximized")?.(null)).toBe(false);

    await ipcHandlers.get("window:toggle-fullscreen")?.(null);
    expect(winFullScreen).toBe(true);
    expect(await ipcHandlers.get("window:is-fullscreen")?.(null)).toBe(true);

    await ipcHandlers.get("window:toggle-fullscreen")?.(null, false);
    expect(winFullScreen).toBe(false);

    await ipcHandlers.get("window:set-bounds")?.(null, { x: 200, y: 150, width: 1440, height: 900 });
    const boundsNow = (await ipcHandlers.get("window:get-bounds")?.(null)) as typeof winBounds;
    expect(boundsNow.width).toBe(1440);
    expect(boundsNow.height).toBe(900);

    await ipcHandlers.get("window:close")?.(null);
    expect(winClosed).toBe(true);
    expect(sentToRenderer.some((s) => s.channel === "window:state-changed")).toBe(true);

    // Verify preload surface never leaks raw ipcRenderer
    let exposedKey = "";
    let exposedApi: Record<string, unknown> = {};
    exposeKekenikPreload({
      contextBridge: {
        exposeInMainWorld: (key, api) => {
          exposedKey = key;
          exposedApi = api as unknown as Record<string, unknown>;
        },
      },
      ipcRenderer: {
        invoke: async (ch, ...args) => ipcHandlers.get(ch)?.(null, ...args) as never,
      },
    });
    expect(exposedKey).toBe("kekenikElectron");
    expect(typeof exposedApi["minimizeWindow"]).toBe("function");
    expect(typeof exposedApi["maximizeWindow"]).toBe("function");
    expect(typeof exposedApi["restoreWindow"]).toBe("function");
    expect(typeof exposedApi["closeWindow"]).toBe("function");
    expect(typeof exposedApi["isWindowMaximized"]).toBe("function");
    expect(exposedApi["ipcRenderer"]).toBeUndefined();
  });

  it("B13 window bounds persistence, crash recovery on corrupted window-state.json, multi-monitor clamping, and document title formatting", async () => {
    const tmpDir = createTempDir("b13-bounds");
    const store = new WindowStateStore(tmpDir);
    const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];

    // Save valid bounds and reload
    await store.save({
      x: 160,
      y: 120,
      width: 1360,
      height: 840,
      isMaximized: true,
      isFullScreen: false,
    });
    const loaded = await store.load(displays);
    expect(loaded.x).toBe(160);
    expect(loaded.y).toBe(120);
    expect(loaded.width).toBe(1360);
    expect(loaded.height).toBe(840);
    expect(loaded.isMaximized).toBe(true);

    // Off-screen bounds (e.g., unplugged secondary monitor at x=3800) clamp onto primary display
    const clamped = clampWindowBoundsToDisplays(
      { x: 3800, y: 2200, width: 1280, height: 800, isMaximized: false },
      displays
    );
    expect(clamped.x).toBeGreaterThanOrEqual(0);
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(1920);
    expect(clamped.y).toBeGreaterThanOrEqual(0);
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(1080);

    // Corrupt window-state.json and verify crash-safe fallback
    fs.writeFileSync(path.join(tmpDir, "window-state.json"), "{corrupted-json", "utf8");
    const recovered = await store.load(displays);
    expect(recovered.width).toBe(DEFAULT_WINDOW_BOUNDS.width);
    expect(recovered.height).toBe(DEFAULT_WINDOW_BOUNDS.height);

    // Verify B13 document title formatting
    expect(formatWindowDocumentTitle("hero.aseprite", true)).toBe(
      "● hero.aseprite — Kekenik Pixel"
    );
    expect(formatWindowDocumentTitle("hero.aseprite", false)).toBe(
      "hero.aseprite — Kekenik Pixel"
    );
    expect(formatWindowDocumentTitle(null, false)).toBe("Home — Kekenik Pixel");
  });

  it("B16 application icon generation (.ico 16..256, .icns, Linux PNG set 16..1024, tray/taskbar, NSIS BMPs) and version-pinned wiring", () => {
    const root = process.cwd();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      version: string;
    };
    expect(pkg.version).toBe(KEKENIK_APP_VERSION);

    // 1. Vector master `assets/icon/app.svg`
    const appSvg = fs.readFileSync(path.join(root, "assets/icon/app.svg"), "utf8");
    expect(appSvg).toContain(`data-version="${pkg.version}"`);
    expect(appSvg).toContain("<svg");

    // 2. Multi-size `assets/icon/icon.ico` (7 sizes: 16, 24, 32, 48, 64, 128, 256)
    const icoBuf = fs.readFileSync(path.join(root, "assets/icon/icon.ico"));
    expect(icoBuf.readUInt16LE(0)).toBe(0);
    expect(icoBuf.readUInt16LE(2)).toBe(1); // Type 1 = ICON
    expect(icoBuf.readUInt16LE(4)).toBe(7); // 7 embedded sizes

    // 3. Apple `assets/icon/icon.icns`
    const icnsBuf = fs.readFileSync(path.join(root, "assets/icon/icon.icns"));
    expect(icnsBuf.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(icnsBuf.readUInt32BE(4)).toBe(icnsBuf.length);

    // 4. Linux PNG set (16..1024) + tray/taskbar variants
    for (const sz of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
      const p = path.join(root, `assets/icon/png/${sz}x${sz}.png`);
      expect(fs.existsSync(p)).toBe(true);
      const b = fs.readFileSync(p);
      expect(b[0]).toBe(137);
      expect(b.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect(b.readUInt32BE(16)).toBe(sz);
      expect(b.readUInt32BE(20)).toBe(sz);
    }
    expect(fs.existsSync(path.join(root, "assets/icon/tray-16.png"))).toBe(true);
    expect(fs.existsSync(path.join(root, "assets/icon/taskbar-32.png"))).toBe(true);

    // 5. NSIS installer header (150x57) and sidebar (164x314) 24-bit BMPs
    const headerBmp = fs.readFileSync(path.join(root, "installer-assets/installerHeader.bmp"));
    expect(headerBmp.subarray(0, 2).toString("ascii")).toBe("BM");
    expect(headerBmp.readInt32LE(18)).toBe(150);
    expect(headerBmp.readInt32LE(22)).toBe(57);
    expect(headerBmp.readUInt16LE(28)).toBe(24);

    const sidebarBmp = fs.readFileSync(path.join(root, "installer-assets/installerSidebar.bmp"));
    expect(sidebarBmp.subarray(0, 2).toString("ascii")).toBe("BM");
    expect(sidebarBmp.readInt32LE(18)).toBe(164);
    expect(sidebarBmp.readInt32LE(22)).toBe(314);
    expect(sidebarBmp.readUInt16LE(28)).toBe(24);

    // 6. Verify icon wiring in TitleBar, HomeTab, and AboutDialog
    const titleBarSrc = fs.readFileSync(
      path.join(root, "packages/ui/src/shell/TitleBar.tsx"),
      "utf8"
    );
    const homeTabSrc = fs.readFileSync(
      path.join(root, "packages/ui/src/app/HomeTab.tsx"),
      "utf8"
    );
    const aboutSrc = fs.readFileSync(
      path.join(root, "packages/ui/src/featurecenter/index.tsx"),
      "utf8"
    );
    expect(titleBarSrc).toContain('dataTestId="titlebar-app-icon"');
    expect(homeTabSrc).toContain('dataTestId="home-app-icon"');
    expect(aboutSrc).toContain('dataTestId="about-app-icon"');
  });

  it("B17 .kpx file icon, single-instance handoff, portable mode PORTABLE_EXECUTABLE_DIR redirect, and installer-assets/installer.nsh registry + SHChangeNotify", async () => {
    const root = process.cwd();

    // 1. Dedicated .kpx document icon masters & 16/32 PNGs + multi-size file-kpx.ico
    expect(fs.existsSync(path.join(root, "assets/icon/file-kpx.svg"))).toBe(true);
    expect(fs.existsSync(path.join(root, "assets/icon/file-kpx-16.png"))).toBe(true);
    expect(fs.existsSync(path.join(root, "assets/icon/file-kpx-32.png"))).toBe(true);
    const kpxIco = fs.readFileSync(path.join(root, "assets/icon/file-kpx.ico"));
    expect(kpxIco.readUInt16LE(2)).toBe(1);
    expect(kpxIco.readUInt16LE(4)).toBe(7);

    // 2. Portable mode data dir redirect (`PORTABLE_EXECUTABLE_DIR` mocked)
    const portableBase = createTempDir("portable-usb");
    const resolved = resolveDesktopDataDir("/default/appdata", {
      PORTABLE_EXECUTABLE_DIR: portableBase,
    });
    expect(resolved.isPortable).toBe(true);
    expect(resolved.userDataDir).toBe(path.join(portableBase, "KekenikPixelData"));
    expect(resolved.settingsFilePath).toBe(
      path.join(portableBase, "KekenikPixelData", "kekenik-settings.json")
    );
    expect(resolved.windowStateFilePath).toBe(
      path.join(portableBase, "KekenikPixelData", "window-state.json")
    );

    // 3. Single-instance lock rejection when another instance holds the lock
    let quitCalled = false;
    const rejected = await bootstrapElectronMain(
      {
        app: {
          getPath: () => portableBase,
          whenReady: async () => {},
          on: () => {},
          quit: () => {
            quitCalled = true;
          },
          requestSingleInstanceLock: () => false,
        },
        BrowserWindow: class {} as never,
        ipcMain: { handle: () => {} },
        dialog: {
          showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
          showSaveDialog: async () => ({ canceled: true }),
        },
        clipboard: { writeText: () => {}, readText: () => "" },
      },
      { env: { PORTABLE_EXECUTABLE_DIR: portableBase } }
    );
    expect(rejected.locked).toBe(false);
    expect(quitCalled).toBe(true);

    // 4. Single-instance handoff on `second-instance` event
    const sampleKpxPath = path.join(portableBase, "test_handoff.kpx");
    fs.writeFileSync(sampleKpxPath, "KPX-TEST-PAYLOAD", "utf8");

    let secondInstanceHandler: ((ev: unknown, argv: string[], cwd: string) => void) | null = null;
    let windowFocused = false;
    let windowRestored = false;
    const openedFiles: Array<{ path: string; name: string }> = [];

    await bootstrapElectronMain(
      {
        app: {
          getPath: () => portableBase,
          setPath: () => {},
          whenReady: async () => {},
          on: (ev, fn) => {
            if (ev === "second-instance") {
              secondInstanceHandler = fn as never;
            }
          },
          quit: () => {},
          requestSingleInstanceLock: () => true,
        },
        BrowserWindow: class {
          public webContents = { send: () => {} };
          public minimize() {}
          public maximize() {}
          public restore() {
            windowRestored = true;
          }
          public close() {}
          public focus() {
            windowFocused = true;
          }
          public isMinimized() {
            return true;
          }
          public isMaximized() {
            return false;
          }
          public getBounds() {
            return { x: 0, y: 0, width: 1280, height: 800 };
          }
          public on() {}
          public async loadURL() {}
          public async loadFile() {}
        } as never,
        ipcMain: { handle: () => {} },
        dialog: {
          showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
          showSaveDialog: async () => ({ canceled: true }),
        },
        clipboard: { writeText: () => {}, readText: () => "" },
      },
      {
        env: { PORTABLE_EXECUTABLE_DIR: portableBase },
        argv: ["electron"],
        onOpenFileRequest: (file) => {
          openedFiles.push({ path: file.path, name: file.name });
        },
      }
    );

    expect(secondInstanceHandler).not.toBeNull();
    expect(
      extractFilePathsFromArgv(["KekenikPixel.exe", "--flag", sampleKpxPath], portableBase)
    ).toEqual([sampleKpxPath]);

    secondInstanceHandler!(null, ["KekenikPixel.exe", sampleKpxPath], portableBase);
    // Allow async fs.readFile in second-instance handler to complete
    await new Promise((r) => setTimeout(r, 30));
    expect(windowRestored).toBe(true);
    expect(windowFocused).toBe(true);
    expect(openedFiles).toEqual([{ path: sampleKpxPath, name: "test_handoff.kpx" }]);

    // 5. Verify `installer-assets/installer.nsh` registry commands & `SHChangeNotify`
    const nsh = fs.readFileSync(path.join(root, "installer-assets/installer.nsh"), "utf8");
    expect(nsh).toContain('WriteRegStr SHCTX "Software\\Classes\\.kpx" "" "KekenikPixel.kpx"');
    expect(nsh).toContain('WriteRegStr SHCTX "Software\\Classes\\.kpx\\OpenWithProgids"');
    expect(nsh).toContain("REGISTER_ASEPRITE_ASSOC");
    expect(nsh).toContain('DeleteRegKey SHCTX "Software\\Classes\\KekenikPixel.kpx"');
    expect(nsh).toContain("SHChangeNotify");
    expect(nsh).toContain("KeepUserSettings");
  });

  it("B12 build scripts, com.kekenik.pixel appId, main-process error handler, and verify-release-bundle.mjs fixture tests", async () => {
    const root = process.cwd();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      version: string;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
      build: {
        appId: string;
        asar: boolean;
        fileAssociations: Array<{ ext: string; role: string; icon: string }>;
      };
    };

    expect(pkg.build.appId).toBe("com.kekenik.pixel");
    expect(pkg.build.asar).toBe(true);
    expect(pkg.build.fileAssociations[0].ext).toBe("kpx");
    expect(pkg.build.fileAssociations[0].role).toBe("Editor");

    for (const s of [
      "dist:win",
      "dist:win:portable",
      "dist:linux",
      "dist:linux:docker",
      "dist:all",
      "dist:win:qa",
      "test:all",
    ]) {
      expect(typeof pkg.scripts[s]).toBe("string");
    }
    expect(pkg.devDependencies["electron"]).toBeDefined();
    expect(pkg.devDependencies["electron-builder"]).toBeDefined();
    expect(fs.existsSync(path.join(root, ".github/workflows/release.yml"))).toBe(true);

    const names = getExpectedArtifactNames("1.0.0");
    expect(names.winSetup).toBe("KekenikPixel-1.0.0-win-x64-setup.exe");
    expect(names.winPortable).toBe("KekenikPixel-1.0.0-win-x64-portable.exe");
    expect(names.linuxAppImage).toBe("KekenikPixel-1.0.0-linux-x64.AppImage");
    expect(names.linuxDeb).toBe("KekenikPixel-1.0.0-linux-x64.deb");
    expect(names.linuxTarGz).toBe("KekenikPixel-1.0.0-linux-x64.tar.gz");

    // Verify verify-release-bundle.mjs fails on a fixture with `sourceMappingURL` and passes on a clean fixture
    const dirtyDir = createTempDir("bundle-dirty");
    const dirtyFile = path.join(dirtyDir, "bundle.js");
    fs.writeFileSync(
      dirtyFile,
      "function app(){ return 1; }\n//# sourceMappingURL=bundle.js.map\n",
      "utf8"
    );
    const dirtyRes = verifyReleaseBundle([dirtyDir]);
    expect(dirtyRes.passed).toBe(false);
    expect(dirtyRes.findings.some((f) => f.forbidden === "sourceMappingURL")).toBe(true);

    const cleanDir = createTempDir("bundle-clean");
    const cleanFile = path.join(cleanDir, "bundle.js");
    fs.writeFileSync(cleanFile, "function app(){ return 42; }\n", "utf8");
    const cleanRes = verifyReleaseBundle([cleanDir]);
    expect(cleanRes.passed).toBe(true);
    expect(cleanRes.findings.length).toBe(0);
    expect(computeFileSha256(cleanFile)).toMatch(/^[0-9a-f]{64}$/);

    // Logger module is excluded from console.log( check
    expect(
      scanContentForForbiddenStrings(
        'console.log("internal logger")',
        "packages/core/src/util/index.ts"
      ).length
    ).toBe(0);

    // Verify atomic settings store & uncaught main-process error handler with "Open Logs Folder"
    const settingsDir = createTempDir("settings-atomic");
    const settings = new DesktopSettingsStore(settingsDir);
    await settings.write("theme", "default-dark");
    expect(await settings.read("theme", "classic-light")).toBe("default-dark");

    let openedPath = "";
    const errRes = await handleMainProcessError(
      new Error("Simulated disk error"),
      settingsDir,
      {
        showMessageBox: async () => ({ response: 0 }),
      },
      {
        openPath: async (p) => {
          openedPath = p;
          return "";
        },
      }
    );
    expect(errRes.openedLogs).toBe(true);
    expect(openedPath).toBe(settingsDir);
    expect(fs.existsSync(errRes.loggedPath)).toBe(true);
  });
});
