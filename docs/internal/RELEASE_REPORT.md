# Kekenik Pixel — Release Verification Report (`RELEASE_REPORT.md`)

## 1. Release Metadata & Pinned Versions
- **Product Name**: `Kekenik Pixel`
- **Application ID (`appId`)**: `com.kekenik.pixel`
- **Version**: `1.0.0`
- **Node.js**: `v20.20.2`
- **TypeScript**: `5.9.3` (`strict: true`)
- **Vite**: `7.3.2`
- **Vitest**: `4.1.12`
- **Electron (pinned in `package.json`)**: `33.2.1`
- **electron-builder (pinned in `package.json`)**: `25.1.8`
- **Zod (IPC runtime validation)**: `4.x`

---

## 2. Automated Verification Results (Executed in Sandbox)

| Check / Command | Result | Details |
|---|---|---|
| `npm run typecheck` (`tsc --noEmit` + `tsc -p apps/desktop/tsconfig.json --noEmit`) | **PASS** | `0` TypeScript errors across `packages/core`, `packages/ui`, and `apps/desktop` |
| `npm test` (`vitest run`) | **PASS** | `8` test files passed, `210 / 210` tests passed (`bugs-7b.test.ts`: 5/5 passed; `bugs-7a.test.ts`: 15/15 passed; `ui.test.ts`: 7/7 passed; `core.test.ts`: 17/17 passed; `formats.test.ts`: 47/47 passed; `layout.test.ts`: 63/63 passed; `scripting.test.ts`: 48/48 passed; `extensions.test.ts`: 8/8 passed) |
| `npm run test:all` | **PASS** | Typecheck + 210 Vitest tests + 33 deterministic icon assets generated (`scripts/generate-icons.mjs`) |
| `npm run build:web` | **PASS** | Built single-file `dist/index.html` |
| `node scripts/verify-release-bundle.mjs` | **PASS** | `[verify-release-bundle] PASS — Scanned 1 release bundle file(s); 0 forbidden strings found.` (`sourceMappingURL`, `localhost:5173`, `REPLACE_BY_AGENT`, `console.log(`) |
| `node scripts/build.mjs --web` | **PASS** | Executed `generate-icons → typecheck → test → build:web → verify-release-bundle → SHA-256 report` |

---

## 3. Artifacts Produced in Sandbox & SHA-256 Checksums

- **`KekenikPixel_final_source.zip`**: Full release source repository (excluding `node_modules`, `dist`, `.git`, `release`, caches).
- **`KekenikPixel_web_build.zip`**: Production web bundle (`dist/index.html` + `release/1.0.0/SHA256SUMS.txt`).
- **`release/1.0.0/KekenikPixel-1.0.0-web-bundle.html`**:
  - **SHA-256**: `19193c190f82ad941c56bf53a071b2ef11649336e7018db75190f9f1b33a23de`
- **33 Generated Application & `.kpx` File Icons (`assets/icon/` & `build/`)**:
  - Full per-file SHA-256 manifest recorded in `assets/icon/icon-manifest.json`.

---

## 4. What Was Verified in Sandbox vs. Requires Native Windows / Linux Host

### Verified in Sandbox:
- All 210 unit, integration, and regression tests (`B01`–`B10`, `B18`–`B22` from Agent 7A + `B12`, `B13`, `B16`, `B17` from Agent 7B).
- `tsc -p apps/desktop/tsconfig.json --noEmit` for Electron main, preload, and IPC modules.
- Mocked `electron` (`app`, `BrowserWindow`, `Menu`, `screen`, `ipcMain`, `contextBridge`, `ipcRenderer`) smoke test verifying `frame: false`, `thickFrame: true`, `Menu.setApplicationMenu(null)`, `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, window control IPC (`window:minimize`, `window:maximize`, `window:restore`, `window:close`, `window:is-maximized`, `window:toggle-fullscreen`), window bounds persistence & display clamping, crash recovery on corrupted `window-state.json`, single-instance lock & `second-instance` file-open handoff, and `PORTABLE_EXECUTABLE_DIR` data redirection to `KekenikPixelData/`.
- Binary header & dimension verification of `assets/icon/icon.ico` (7 sizes: `16..256`), `assets/icon/icon.icns`, Linux PNGs (`16..1024`), `assets/icon/file-kpx.ico`, `installer-assets/installerHeader.bmp` (`150×57` 24-bit BMP), and `installer-assets/installerSidebar.bmp` (`164×314` 24-bit BMP).
- Text-level verification of `installer-assets/installer.nsh` (`WriteRegStr`, `DeleteRegKey`, `OpenWithProgids`, `REGISTER_ASEPRITE_ASSOC`, `KeepUserSettings`, and `SHChangeNotify`).
- Release bundle verification (`scripts/verify-release-bundle.mjs`) on both `dist/index.html` and dirty/clean test fixtures.

### Not Verifiable Inside Headless Linux Sandbox (Run on Windows 10/11 Host or GitHub Actions):
- Native execution of `electron-builder` to produce `KekenikPixel-1.0.0-win-x64-setup.exe`, `KekenikPixel-1.0.0-win-x64-portable.exe`, and `KekenikPixel-1.0.0-linux-x64.{AppImage,deb,tar.gz}` (the sandbox container does not pre-cache the Electron/NSIS/Wine binaries).
- Interactive Windows Explorer visual inspection of Aero Snap, Windows 10/11 Taskbar/Start Menu icons, Explorer double-click `.kpx` association, and live `SHChangeNotify` shell icon cache refresh.
