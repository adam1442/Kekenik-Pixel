# Known Issues & Environment Notes (`docs/KNOWN_ISSUES.md`)

## 1. Functional & Packaging Scope Status (Agents 1–7B)
- All **276 registered features** across Agents 1–7A and all **Agent 7B deliverables (`B12`, `B13`, `B16`, `B17`)** are implemented and covered by automated unit and regression tests (`8` test files, `210` passing tests).
- Per Agent 7B scope instructions (§0 & §4), the in-app QA/verification surface (`Feature Center`, `Log Viewer`, sample/demo openers) left in place by the previous agent was preserved untouched.

---

## 2. Sandbox vs. Native Host Notes
1. **Electron Binary & `electron-builder` Packaging in Headless Linux Sandbox**:
   - The verification sandbox does not pre-install the multi-hundred-megabyte Electron / Wine / NSIS native binaries required by `electron-builder` to produce `.exe` / `.AppImage` binaries inside the container.
   - All Electron main-process, preload, `zod` IPC validation, window bounds persistence/clamping, single-instance handoff, portable `KekenikPixelData/` redirection, and NSIS `installer-assets/installer.nsh` scripts are verified via deterministic Vitest tests in `packages/ui/src/__tests__/bugs-7b.test.ts` and `tsc -p apps/desktop/tsconfig.json --noEmit`.
   - Run `npm run dist:win` and `npm run dist:win:portable` on a Windows 10/11 x64 host (or via `.github/workflows/release.yml` in GitHub Actions) to produce the signed/packaged `.exe` artifacts.
2. **Playwright-Electron Smoke Test in Sandbox**:
   - Playwright-Electron cannot launch a GUI Electron binary inside the headless sandbox; therefore, per Agent 7B §6, the `electron` module (`app`, `BrowserWindow`, `Menu`, `screen`, `ipcMain`, `contextBridge`, `ipcRenderer`) is mocked in `packages/ui/src/__tests__/bugs-7b.test.ts` to test the frameless window options, `Menu.setApplicationMenu(null)`, window controls IPC (`window:minimize`, `window:maximize`, `window:restore`, `window:close`, `window:is-maximized`, `window:toggle-fullscreen`), single-instance handoff, and preload bridge.
