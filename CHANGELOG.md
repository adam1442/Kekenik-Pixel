# Changelog (`CHANGELOG.md`)

## [Unreleased] — Build system repair & open-source release preparation

### Fixed — build could not produce any installer
- **`installer-assets/installer.nsh` (fatal on every platform with an NSIS toolchain)**: `Var REGISTER_ASEPRITE_ASSOC`
  was declared unconditionally while only being used by `customInstall`. electron-builder compiles the
  script a second time for the uninstaller (`BUILD_UNINSTALLER`), where the variable is unused, so makensis
  emitted `warning 6001` — and electron-builder runs makensis with `-WX`, turning it into
  `Error: warning treated as error`. The declaration (and the `customInit` body) is now guarded by
  `!ifndef BUILD_UNINSTALLER`. **This was the root cause of the failing Windows build.**
- **`package.json`**: `build.win.publisherName` was rejected by electron-builder 26
  (`Invalid configuration object … configuration.win should be one of these: null`); replaced by
  `win.legalTrademarks`. All build-config keys are now schema-valid for electron-builder 26.
- **Missing Electron entry points**: `main.ts` exported `bootstrapElectronMain()` but nothing ever called
  it, `apps/desktop/package.json` pointed at a `dist/main.js` that was never generated, and the root
  `main` field pointed at a **TypeScript** file (Electron cannot execute `.ts`). Added
  `apps/desktop/src/electron-main.ts` + `electron-preload.ts`, a real bundling step
  (`scripts/build-desktop.mjs` → `dist-electron/main.mjs`, `dist-electron/preload.cjs`) and a dedicated
  Electron renderer bundle (`desktop.html` → `dist/desktop.html` with `ElectronPlatform` installed).
- **Windows path bug**: the main process derived its directory from `new URL(import.meta.url).pathname`
  (yields `/C:/Program%20Files/...` on Windows) and assumed a source-tree layout. Replaced with
  `fileURLToPath()` + `resolveAppRoot()` (works from source, from `dist-electron/` and from `app.asar`).
- **`atomicWriteFile` race**: temp file names were `…tmp.<pid>.<Date.now()>`, so window move/resize/close
  events fired in the same millisecond collided and the second `rename()` failed with `ENOENT` — at startup
  this surfaced as a modal "unexpected error" dialog. Writes are now serialized per target path, use a
  monotonic counter, clean up on failure, and stale temp files are pruned at boot.
- **`scripts/verify-release-bundle.mjs`**: default targets were `dist/` **and** `release/`, so once any
  installer existed the scan found `console.log(`/`sourceMappingURL` inside third-party code in
  `app.asar` and failed every subsequent `npm run build`. It now scans `dist/` only.
- **Committed generated icons**: `assets/icon/*` and `installer-assets/installer*.bmp` were missing from the
  repository, so `npm test` and packaging failed on a fresh clone. They are generated deterministically by
  `npm run generate:icons` and are now committed.
- **`REGISTER_ASEPRITE_ASSOC` test coverage, IPC idempotency**: re-entering `bootstrapElectronMain` on
  macOS `activate` no longer double-registers `ipcMain` channels (which Electron rejects at runtime).

### Changed
- **Tooling**: npm is the single package manager (`pnpm-workspace.yaml` removed, `package-lock.json`
  regenerated); Electron **33 → 41**, electron-builder **25 → 26**, Vite **7.3.2 → 7.3.8**, React 19.3.
  This removes the deprecated `inflight`/`npmlog`/`gauge`/`tar@6`/`glob@7-8` dependency chain and the
  `npm audit` findings reported against electron-builder 25 and Vite 7.3.2.
- **Smaller installs**: `node_modules` is excluded from the packaged app (everything is bundled by Vite);
  `app.asar` is now ~5 MB instead of shipping the whole dependency tree.
- **Build orchestrator** (`scripts/build.mjs`): added `--mac`, `--dir`, `--web`, `--skip-tests`,
  platform capability checks with actionable error messages (wine/Docker/OSX), `--publish never`
  for local builds, mono-arch Linux artifact names, and artifact/SHA-256 reporting without `.7z` noise.
- **GitHub**: rewritten `.github/workflows/release.yml` (Windows + macOS x64/arm64 + Linux on native
  runners, combined `SHA256SUMS.txt`, automatic GitHub Release), new `.github/workflows/ci.yml`,
  Dependabot config, issue forms, PR template.

### Added
- `README.md` (English, with `Screenshot.jpg` hero image), `README.fa.md` (Persian), `.gitignore`,
  `.gitattributes`, `.editorconfig`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/RELEASING.md`,
  rewritten `docs/BUILD.md` including a troubleshooting section for every failure fixed above.
- `packages/ui/src/__tests__/desktop-build.test.ts` — regression tests for concurrent atomic writes,
  app-root/preload/renderer path resolution, the packaged `main` entry and the NSIS `BUILD_UNINSTALLER` guard.

---


## [1.0.0] — 2026-11-09 (Agent 7B — Electron Polish, Application Icons & Cross-Platform Builds)

### Inherited Fixes
- None required at Agent 7B M0 baseline (`pnpm install`, `pnpm typecheck`, `pnpm test`, and `pnpm build:web` all passed cleanly on the input archive).

### Added & Hardened (Agent 7B — B12, B13, B16, B17)
- **Custom Frameless Window Chrome & Typed IPC (`B13`)**:
  - Updated `apps/desktop/src/main.ts` to default to `customTitleBar: true` (`frame: false`, `thickFrame: true`, `resizable: true`, `Menu.setApplicationMenu(null)`, macOS `titleBarStyle: 'hidden'` with native traffic light positioning).
  - Created `apps/desktop/src/main/ipc.ts` with `zod`-validated IPC handlers (`window:minimize`, `window:maximize`, `window:restore`, `window:close`, `window:is-maximized`, `window:toggle-fullscreen`, `window:is-fullscreen`, `window:get-bounds`, `window:set-bounds`), atomic file writes (`atomicWriteFile`), crash-resilient `WindowStateStore`, and multi-monitor bounds clamping (`clampWindowBoundsToDisplays`).
  - Created `packages/ui/src/shell/TitleBar.tsx` (and `apps/desktop/src/TitleBar.tsx`) with left App Icon system menu, embedded `MenuBar`, draggable region (`-webkit-app-region: drag`) with double-click maximize toggle, `● name.aseprite — Kekenik Pixel` title indicator, 46×32 Minimize/Maximize-Restore/Close buttons with red close-hover, `F11`/Zen hide, and unsaved-changes close delegation.
- **Original Application Icon & `.kpx` File Associations (`B16`, `B17`)**:
  - Created `scripts/generate-icons.mjs` and `packages/ui/src/skin/app-icon.tsx` generating 33 version-pinned icon assets (`assets/icon/app.svg`, multi-size `icon.ico` 16–256, `icon.icns`, Linux PNGs 16–1024, tray/taskbar variants, NSIS 24-bit BMPs `installer-assets/installerHeader.bmp` and `installer-assets/installerSidebar.bmp`, and dedicated `.kpx` document icons `file-kpx.svg`, `file-kpx-16.png`, `file-kpx-32.png`, `file-kpx.ico`).
  - Wired `KekenikAppIcon` into `BrowserWindow({ icon })`, `electron-builder`, `TitleBar`, `AboutDialog`, and `HomeTab`.
  - Created `installer-assets/installer.nsh` with `.kpx` registration, opt-in `.ase`/`.aseprite` association (`REGISTER_ASEPRITE_ASSOC`), Explorer "Open with" support, safe uninstall key cleanup, "keep settings" prompt, and `SHChangeNotify` icon cache refresh.
  - Added single-instance lock (`app.requestSingleInstanceLock()`) + `second-instance` file-open handoff and portable mode data redirection (`PORTABLE_EXECUTABLE_DIR` -> `KekenikPixelData/`).
- **Cross-Platform Build System & Release Verification (`B12`)**:
  - Added `scripts/build.mjs`, `scripts/verify-release-bundle.mjs`, `.github/workflows/release.yml`, `LICENSE.txt`, and `docs/BUILD.md` with `com.kekenik.pixel` `appId`, `dist:*` scripts, and SHA-256 checksum reporting.
  - Added `packages/ui/src/__tests__/bugs-7b.test.ts` covering `B12`, `B13`, `B16`, and `B17`.

---

## [1.3.0-agent3] — 2026-11-08

### Inherited Fixes (from Agent 2)
- **`packages/core/src/tools/index.ts` (`rasterizeRectangle`)**: Fixed outlined rectangle point ordering to walk the 4 edges clockwise (`top -> right -> bottom -> left`) instead of alternating `(x, y0)` and `(x, y1)` per column, which previously caused `paintStrokeOnImage`'s segment connector to draw vertical lines across the interior of outlined rectangles in `verifyGoldenToolSuite` (`Rect Outline 5x5`).
- **`packages/ui/src/app/App.tsx`**: Mounted Agent 2's `CustomDitherMatrixDialog` (`dialog.dither_matrix`) and `GridSettingsDialog` (`dialog.grid_settings`) in the root modal switch so opening them from the Context Bar or View menu renders the dialogs properly.

### Added (Agent 3)
- **Animation & Onion Skin Engine (`packages/core/src/animation/index.ts`)**:
  - Implemented `buildPlaybackSequence`, `resolvePlaybackRange`, `createPlaybackClockState`, `advancePlaybackClock` (with per-frame durations, `forward`/`reverse`/`pingpong`/`pingpong-reverse`, subtags, speed multiplier `0.25x..4x`, constant frame rate, finite repeat counter, and real-time frame-drop skip), `findAdjacentTagFrame`, and `computeCascadingTagRows`.
  - Implemented `resolveOnionSkinGhostFrames`, `applyOnionTint`, `renderOnionSkinOverlay`, and `compositeFrameWithOnionSkin` (`Red/Blue Tint` vs `Merge`, opacity falloff step, `loopTag`, `currentLayerOnly`, `behind` vs `in_front`).
- **Tilemaps, Tilesets & Slices Engine (`packages/core/src/tilemap/index.ts`)**:
  - Implemented 32-bit tile entry bitflag packing/unpacking (`TILE_FLIP_X_FLAG`, `TILE_FLIP_Y_FLAG`, `TILE_ROTATE_90_FLAG`), empty tile 0 rule, `extractTilesetFromImage` automatic tile deduplication, `syncTilemapFromEditedPixels` (`Auto` / `Stack` / `Manual` modes), tile-aware `paintTileCells`, `floodFillTileCells`, `rasterizeTileLine`, `rasterizeTileRectangle`, `findTileOccurrences`, and `purgeUnusedTilesInSprite`.
  - Implemented per-frame animated Slice keyframe lookup/upsert (`getSliceKeyForFrame`, `upsertSliceKey`), `hitTestSlices`, and `exportSliceCroppedImage`.
- **Undoable Agent-3 Commands (`packages/core/src/commands/agent3-commands.ts`)**:
  - Added `SetLayerFullPropsCommand`, `AddGroupLayerCommand`, `UngroupLayerCommand`, `ReparentAndMoveLayerCommand`, `AddTilemapLayerCommand`, `AddReferenceLayerCommand`, `DuplicateLayerCommand`, `MergeDownLayerCommand`, `FlattenLayersCommand`, `ConvertLayerCommand`, `IsolateLayerCommand`, `BulkLayerStateCommand`, `SetCelPropsCommand`, `ClearCelsCommand`, `TransferCelRangeCommand`, `SetFrameRangeDurationCommand`, `ReverseFramesCommand`, `UpdateTagCommand`, `RemoveTagCommand`, `UpdateSliceCommand`, `RemoveSliceCommand`, `TilemapEditCommand`, and `UpdateTilesetCommand`.
- **Full Timeline, Preview, Layers, Tileset, Tags & Slices UI (`packages/ui/src/panels/agent3-panels.tsx`, `packages/ui/src/featurecenter/agent3-dialogs.tsx`)**:
  - Upgraded `TimelinePanel` with hierarchical collapsible layer groups, drag-and-drop layers & cels, rectangular cel range selection, live cel thumbnails, Z-index badges, cascading tag banners with resize handles, onion skin popup, and embedded mini-player.
  - Upgraded `PreviewPanel` with independent playback loop, tag selector, 3x3 tiled preview, viewport sync box, and full-screen toggle.
  - Added `TilesetPanel`, `TagsPanel`, `SlicesPanel`, and all 9 Agent-3 modal dialogs.
  - Added 6 Agent-3 Demo Documents (`walk_cycle.ase`, `onion_skin_lab.ase`, `layer_groups_blends.ase`, `linked_cels_lab.ase`, `tilemap_dungeon.ase`, `slices_9patch_ui.ase`) and upgraded all 60 Agent-3 features in `FeatureRegistry` to `tested`.

---

## [1.0.0-agent1] — 2026-02-20

### Added (Agent 1)
- **Repository & Build**: Created monorepo structure (`packages/core`, `packages/ui`, `apps/desktop`, `docs/`) with strict TypeScript and Vitest test suite.
- **Core Model (`@kekenik/core`)**:
  - Implemented `PixelImage` backed by `Uint8Array` for `rgba` (4 B/px), `grayscale` (2 B/px), and `indexed` (1 B/px) with rectangular region patch extraction/application.
  - Implemented `Sprite`, `ImageLayer`, `GroupLayer`, `TilemapLayer`, `Cel` (with `linkId` shared-image linked cels and tilemap bitflags), `Frame`, `Tag`, `Slice`, `Tileset`, `PaletteSpan`, and 1-bit `Mask`.
  - Implemented all 19 blend modes and CPU frame compositor (`compositeFrame`).
  - Implemented `.kpx-snapshot` JSON + base64 binary crash-recovery serializer and deserializer.
- **Commands & Non-Linear History (`@kekenik/core`)**:
  - Implemented tree-structured non-linear `History` supporting branching undo/redo, cross-branch `jumpToNode(nodeId)`, and memory budget pruning.
  - Implemented `CelImagePatchCommand` storing only modified pixel rectangles.
  - Implemented `SpriteDocument.transact(label, tx => ...)` transactional API.
- **Registries & Contracts (`@kekenik/core`)**:
  - Implemented generic `Registry<T>` and `ToolRegistry`, `CommandRegistry`, `PanelRegistry`, `MenuRegistry`, `FormatRegistry`, `FilterRegistry`, `DialogRegistry`, `FeatureRegistry`.
  - Registered 261 features across Agents 1–5 with automated `selfTest()` checks for all Agent 1 features.
- **UI Shell (`@kekenik/ui`)**:
  - Implemented original pixel skin (`default-dark`, `classic-light`, `high-contrast`), 1-px bevel frames, UI scale (100/200/300%), and 85 original 16x16 pixel SVG icons.
  - Implemented `MenuBar`, `DocumentTabsBar`, `WorkspaceManager`, `ContextBar`, `ToolBar`, `DockManager`, `FloatingWindow`, `StatusBar`, `HomeTab`, and `GlobalErrorBoundary`.
  - Implemented 11 builtin panels (`Color Bar`, `Color Picker`, `Timeline`, `Preview`, `Undo History`, `Layers`, `Brushes`, `Info`, `Navigator`, `Log Viewer`, `Feature Center`).
  - Implemented `New Sprite` (+ `Canvas Presets`), `Sprite Size`, `Canvas Size`, `Keyboard Shortcuts`, `Preferences`, `Feature Center`, and `About` dialogs.
  - Implemented procedural demo documents (`antihero.ase`, `slime_bounce.ase`, `blend_modes.ase`).
- **Desktop Skeleton (`@kekenik/desktop`)**:
  - Implemented Electron Main, Preload (`contextIsolation: true`, `nodeIntegration: false`), `ElectronPlatform`, and Renderer entry points.
