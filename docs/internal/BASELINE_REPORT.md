# Kekenik Pixel — Agent 7A Baseline Verification Report (`docs/BASELINE_REPORT.md`)

## 1. Input Archive & Baseline Build Verification
- **Source Archive**: `https://0807.st/nfRf0MI.zip` (2,183,472 bytes, 191 files)
- **Producing Agent**: Agent 6 (contains Agents 1–6 code: `packages/core/src/registry/agent2-features.ts` through `agent6-features.ts`, `packages/ui/src/shell/dock.tsx`, `packages/core/src/formats/*`, `packages/core/src/scripting/*`, `packages/core/src/extensions/*`). Note that `README.md`, `STATUS.md`, `HANDOFF.md`, and `CHANGELOG.md` had not been updated since Agent 3.
- **Baseline Commands**:
  - `npm ci` / `npm install`: **PASS**
  - `npm run typecheck`: **PASS** (`tsc --noEmit` 0 errors)
  - `npm test`: **PASS** (6 test files, 190 passed tests)
  - `npm run build:web`: **PASS** (`dist/index.html` built cleanly)

---

## 2. Features Not in `tested` State at Baseline (16 / 276 Features)

From `FeatureRegistry.getAll()` at baseline (276 total registered features, 260 `tested`, 7 `implemented`, 9 `planned`):

| Feature ID | Title | Owner Agent | Baseline State | Notes / Action in Agent 7A |
|---|---|---|---|---|
| `format.webp_codec` | Lossless & Animated WebP Codec | Agent 6 | `planned` | Implement pure-TS lossless VP8L / RIFF WebP encoder & decoder + tests |
| `format.jpeg_codec` | JPEG Import/Export | Agent 6 | `planned` | Implement pure-TS baseline DCT JPEG encoder (with quality slider) & decoder + tests |
| `format.flc_fli_anim` | FLC / FLI Animation Import | Agent 6 | `planned` | Implement Autodesk Animator `.fli`/`.flc` chunk codec + tests |
| `format.css_box_shadow` | CSS `box-shadow` Export | Agent 6 | `planned` | Implement single-frame CSS `box-shadow` snippet exporter + tests |
| `export.repeat_last` | Repeat Last Export (`Ctrl+Shift+X`) | Agent 6 | `planned` | Implement last-export settings memory and one-key repeat command + tests |
| `desktop.native_menus` | Native Menu Mirror of `MenuRegistry` | Agent 6 | `planned` | Implement `buildNativeMenuTemplate()` from `MenuRegistry` + `defaultKeymap` + tests |
| `desktop.recent_files_pin` | Pinned Recent Files & Folders | Agent 6 | `planned` | Implement pin/unpin recent files & folders in `PlatformAPI` and `HomeTab` + tests |
| `desktop.multi_window` | Multi-Window (Tear-Off Documents) | Agent 6 | `planned` | Implement tear-off document window sync via `PlatformAPI` + tests |
| `desktop.auto_updater_check` | Offline-Safe Auto-Update Check | Agent 6 | `planned` | Implement opt-in release version comparator in `PlatformAPI` + tests |
| `desktop.custom_titlebar` | Custom Frameless Electron Title Bar | Agent 6 | `planned` | Deferred to **Agent 7B** (B13 owns custom frameless Electron window chrome) |
| `desktop.window_state_persist` | Window Size/Position Persistence | Agent 6 | `implemented` | Add deterministic unit self-test for window bounds persistence/clamping |
| `desktop.file_associations` | File Associations `.aseprite` / `.ase` / `.kpx` | Agent 6 | `implemented` | Defer Windows `.kpx` icon/associations polish to **Agent 7B** (B17); add manifest self-test |
| `desktop.drag_drop_files` | Drag & Drop Files from OS | Agent 6 | `implemented` | Add deterministic file-drop import handler test |
| `pkg.windows_nsis` | Windows NSIS Installer + Portable | Agent 6 | `implemented` | Build scripts owned by **Agent 7B** (B12) |
| `pkg.macos_dmg` | macOS DMG | Agent 6 | `implemented` | Build scripts owned by **Agent 7B** (B12) |
| `pkg.linux_appimage` | Linux AppImage + deb | Agent 6 | `implemented` | Build scripts owned by **Agent 7B** (B12) |
| `qa.accessibility_audit` | Accessibility Audit (Focus Rings, ARIA) | Agent 6 | `implemented` | Upgrade with automated ARIA/keyboard focus verification self-test |

*(Additionally, PCX image codec `.pcx` and File Watcher from Agent 7A §4 are added and tested in Milestone 4.)*

---

## 3. Menu Registry & `scripts/check-menus.ts` Baseline
- All 48 canonical entries in `scripts/check-menus.ts` (`Edit`, `Sprite`, `Select`) and all 92 total entries in `MenuRegistry` have `state: "tested"` (0 `Planned: Agent N` items remain in `MenuRegistry`).
- **However**, `MenuBar` in `packages/ui/src/shell/index.tsx` renders all menu items as a flat 1-level list without nested submenus or right-side `▸` chevrons, and `menu.file.open_sample` (`File > Open Sample Project`) has no `commandId` and no submenu renderer, making it a silent no-op when clicked (reproducing **B19**).

---

## 4. `docs/KNOWN_ISSUES.md` Entries at Baseline
- `docs/KNOWN_ISSUES.md` was stale from Agent 3 (still listing Agent 4 and Agent 5 as planned), while `packages/ui/src/featurecenter/agent6-dialogs.tsx` noted that WebP and JPEG codecs were not yet implemented.

---

## 5. One-Line Verdicts per User-Reported Bug (B01–B10, B18–B22)

| Bug ID | Summary | Reproduced? | Root Cause Verdict |
|---|---|---|---|
| **B01** | Transform rotate clips corners & gizmo handles don't rotate with matrix | **YES** | `rotateImageFast`/`rotSpriteRotate` allocate fixed unrotated `w×h` buffers (clipping corners on 45°/90° rotation) and `floating-transform-gizmo` lacks CSS rotation matrix & local-frame handle projection. |
| **B02** | Gradient tool fails to fill or requires Shift for Contiguous | **YES** | `SpriteEditor` line 1719 passes `contiguous: toolOptions.contiguous && e.shiftKey` and `toolOptions.contiguous` defaults to `true`, conflating Shift angle-snap with flood-fill clipping. |
| **B03** | Closing a dirty tab closes immediately without confirmation prompt | **YES** | `closeDocument(doc.id)` in `store.ts` line 1027 removes the document from `documents` unconditionally without checking `doc.isDirty` or opening a Save/Discard/Cancel dialog. |
| **B04** | Tiled Mode ghost canvases blank in WebGL2 & strokes streak across canvas when crossing tile borders | **YES** | `glCanvas.getContext("webgl2")` lacks `preserveDrawingBuffer: true`, child `TiledCloneCanvas` `useEffect` runs before parent render `useEffect`, and `clientToSpriteCoords` modulo-wraps points before `bresenhamLine`, drawing a line back across the canvas on edge crossings. |
| **B05** | Symmetry modes (X, Y, Both, Diagonal) do not transpose/flip asymmetric brush footprints and can double-stamp on center axes | **YES** | `paintStrokeOnImage` translates un-reflected `(fp.dx, fp.dy)` offsets to mirrored centers instead of reflecting/transposing the brush footprint per dihedral axis and deduplicating center stamps. |
| **B06** | Grid thickness is not configurable | **YES** | `GridSettingsDialog` and `AppStoreState` only store `gridColor` and `gridOpacity` with hard-coded `1px` CSS gradient lines and no `gridThickness` setting. |
| **B07** | Grid double-click does not open Grid Settings / select grid cell | **YES** | Context bar lacks a Grid button with double-click-to-open `GridSettingsDialog`, and `SpriteEditor.handleDoubleClick` ignores grid double-clicks. |
| **B08** | Grid settings mutate `doc.sprite.grid` directly without Command & `Snap to Grid` mutates immediately before OK | **YES** | `updateSpriteGrid` in `store.ts` line 1772 uses `Object.assign(doc.sprite.grid, patch)` instead of an undoable Command, and `GridSettingsDialog` mutates `snapToGrid` live even if cancelled. |
| **B09** | Input fields do not select-all on focus; raw `<input>`/`<textarea>` exist outside `widgets/` | **YES** | `NumberField` and `TextField` in `widgets/index.tsx` lack `onFocus` select-all, `HexField`/`ComboEntry`/`SliderValue` are missing, and 28 raw `<input>`/`<textarea>` elements exist across panels/dialogs. |
| **B10** | Modal dialogs cannot be dragged by their title bar | **YES** | `PixelDialog` in `widgets/index.tsx` uses static centered flexbox positioning with no pointer drag state on its header bar. |
| **B18** | Circle/Ellipse tool always draws filled even when `Filled Shape` is unchecked | **YES** | `rasterizeEllipse` in `packages/core/src/tools/index.ts` pushes 4 quadrant points `(right,top), (left,top), (left,bottom), (right,bottom)` per step, and `paintStrokeOnImage` connects consecutive points with `bresenhamLine`, drawing horizontal/vertical lines across the interior! |
| **B19** | Submenus do not render and parent menu items lack a `▸` chevron | **YES** | `MenuBar` in `packages/ui/src/shell/index.tsx` renders a flat 1-level list with no submenu tree builder, no hover/click submenu popup, no viewport flip, and no `▸` indicator. |
| **B20** | Top tool-settings bar (ContextBar) contains Undo/Redo buttons, `Tool: ...` label, and Presets | **YES** | `ContextBar` in `packages/ui/src/shell/index.tsx` lines 1234–1272 renders Presets dropdown, `+Preset`, `Tool: ...` badge, `Undo`, and `Redo` on the right side. |
| **B21** | Move Tool Flip H / Flip V flips pixels in bounding box without flipping selection mask | **YES** | `TransformSpriteOrCelCommand` (`agent4-commands.ts` lines 451–492) crops/flips the whole rectangular bounding box without flipping `sprite.mask`, and `sprite.flip_h`/`v` wipes `sprite.mask` to empty. |
| **B22** | Mirror/Symmetry menu lacks an `8-way` (all axes) dihedral symmetry option | **YES** | `SymmetryMode` only defines `none | horizontal | vertical | both | diagonal_pos | diagonal_neg` and lacks `eight_way` (8-image dihedral reflection with footprint transposition and 8-axis overlay). |

---

# Agent 7B Baseline Report (Appended at Start of Agent 7B)

## 6. Agent 7A Archive Verification & Inherited Fixes
- **Source Archive**: `https://0807.st/03pehCL.zip` (2,287,616 bytes)
- **7A Bug Fixes Present (`B01`–`B10`, `B18`–`B22`)**: All 15 functional bug fixes from Agent 7A were verified in the codebase and covered by `packages/ui/src/__tests__/bugs-7a.test.ts` (15/15 passing).
- **Inherited Fixes Applied at M0**:
  1. `packages/core/src/formats/formats.test.ts`: Updated stale Agent-6 assertions expecting `encodeSprite(..., "webp")` to throw and `FormatRegistry.get("format.webp")?.state` to be `"planned"`, since Agent 7A implemented lossless/animated WebP, JPEG, PCX, FLC/FLI, and CSS `box-shadow` codecs in `packages/core/src/formats/image.ts` and `io.ts`.
  2. `packages/core/src/registry/agent6-features.ts`: Wired deterministic `selfTest` checks for `format.webp_codec`, `format.jpeg_codec`, `format.flc_fli_anim`, `format.css_box_shadow`, `export.repeat_last`, and desktop/packaging features so all 276 features in `FeatureRegistry` are in `tested` state (0 non-`tested` features remain).
  3. `packages/ui/src/shell/index.tsx`: Expanded `Edit > Adjustments` and `Edit > FX` submenus to list all individual adjustment and FX filters (`Brightness / Contrast...`, `Hue / Saturation...`, `Color Curve...`, `Invert Color`, `Replace Color...`, `Outline...`, `Convolution Matrix...`, `Despeckle...`, `Drop Shadow...`).

## 7. Menu Registry & `scripts/check-menus.ts` Status at 7B Baseline
- **Planned Menu Items (`Planned: Agent N`)**: **0** across all 92 `MenuRegistry` items and all 48 canonical entries in `scripts/check-menus.ts`.

## 8. One-Line Verdicts per Remaining Agent 7B Scope Item (`B11`–`B17`)

| Item ID | Summary | Baseline Status | Root Cause / Action in Agent 7B |
|---|---|---|---|
| **B11** | Production cleanup, Home tab rebuild, and Release vs. QA flavor split (`VITE_KP_FLAVOR`) | **OPEN** | No `VITE_KP_FLAVOR` build flavor split exists yet; Feature Center, Log Viewer, `Download Project ZIP`, and agent names appear unconditionally in the UI and `HomeTab.tsx`. |
| **B12** | Build scripts (`dist:win`, `dist:win:portable`, `dist:linux`, `dist:linux:docker`, `dist:all`, `dist:win:qa`) + `.github/workflows/release.yml` | **OPEN** | `package.json` lacks `dist:*` scripts, `scripts/build.mjs`, `scripts/verify-release-bundle.mjs`, `apps/desktop/electron-builder.yml`, and `.github/workflows/release.yml`. |
| **B13** | Custom frameless Electron window chrome, TitleBar with embedded MenuBar, window controls, and typed IPC | **OPEN** | `apps/desktop/src/main.ts` defaults to `customTitleBar: false` with no `Menu.setApplicationMenu(null)`, no window control IPC handlers (`minimize`/`maximize`/`close`/`getWindowState`), and no `TitleBar` component in `packages/ui/src/shell/`. |
| **B14** | Complete original `SkinPack` icon & cursor system (light & dark atlases, `skin.json`, `SkinLoader`, B19 chevron icon swap) | **OPEN** | `packages/ui/src/skin/index.tsx` only has inline SVG paths without a generated `SkinPack` atlas (`skin-light.png`, `skin-dark.png`, `skin.json`), `SkinLoader`, custom tool/transform cursors, or the `SkinPack` submenu chevron replacing B19's `▸` text placeholder. |
| **B15** | Theme audit and Aseprite 1.3 UI parity across both Light and Dark themes | **OPEN** | Theme tokens and widget metrics need fine-tuning against the reference screenshots (`UI_PARITY_REPORT.md` + theme token contrast/lint checks). |
| **B16** | Original application icon (`assets/icon/app.svg` + `scripts/generate-icons.mjs` producing `.ico`, `.icns`, PNG set, NSIS branding) | **OPEN** | `assets/icon/` and `scripts/generate-icons.mjs` do not exist yet, and `BrowserWindow` / `TitleBar` / `HomeTab` / `AboutDialog` lack the app icon mark. |
| **B17** | Dedicated `.kpx` project file icon, Windows file associations (`.kpx` + opt-in `.ase/.aseprite`), single-instance handoff, shell icon cache refresh | **OPEN** | No `.kpx` document icon, NSIS `SHChangeNotify` macro, opt-in `.ase/.aseprite` association script, or `app.requestSingleInstanceLock()` `second-instance` file-open handoff in `apps/desktop/src/main.ts`. |

---

## 7B baseline

- **Input Archive Verified**: `https://0807.st/0wNROCh.zip` (2,316,553 bytes).
- **Baseline Checks**:
  - `npm ci` / `npm install`: **PASS**
  - `npm run typecheck`: **PASS** (`tsc --noEmit`, 0 errors)
  - `npm test`: **PASS** (7 test files, 205 passed tests)
  - `npm run build:web`: **PASS** (`dist/index.html` built cleanly)
  - **Inherited Fixes Needed**: **None** (0 failures at baseline).
- **Electron / `electron-builder` Versions Pinned at Baseline**: Neither `electron` nor `electron-builder` is listed or pinned in `package.json` or `apps/desktop/package.json` at baseline (to be pinned in B12).
- **Window Frame Setting (`frame: true` vs `false`)**: `apps/desktop/src/main.ts` sets `DEFAULT_MAIN_CONFIG.customTitleBar = false` and passes `frame: !customTitleBar`, so `frame: true` (native OS frame) is used at baseline (`Menu.setApplicationMenu(null)` is also not called).
- **File Associations & `appId` in `package.json`**: `package.json` has `"name": "react-vite-tailwind"`, `"version": "0.0.0"`, no `build.appId` (`com.kekenik.pixel` is missing), and no `build.fileAssociations` entries at baseline (to be added in B12/B17).
- **`dist:win` / `dist:linux` Status at Baseline**: Neither `dist:win` nor `dist:linux` exists in `package.json` scripts at baseline (`scripts/build.mjs` does not exist yet).
