# Kekenik Pixel — Final Release Handoff (`HANDOFF.md`)

## 0. Agent 7B Summary (Electron Chrome, Icons, and Cross-Platform Builds)
Agent 7B has completed the final production hardening and packaging layer (`B12`, `B13`, `B16`, `B17`):
- **Electron Layer (`apps/desktop/src/main.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/preload.ts`, `packages/ui/src/shell/TitleBar.tsx`)**:
  - Uses `frame: false`, `thickFrame: true`, `resizable: true`, and `Menu.setApplicationMenu(null)` on Windows/Linux (`titleBarStyle: 'hidden'` on macOS).
  - All window control IPC channels (`window:minimize`, `window:maximize`, `window:restore`, `window:close`, `window:is-maximized`, `window:toggle-fullscreen`, `window:get-bounds`, `window:set-bounds`) are validated at runtime with `zod` in `apps/desktop/src/main/ipc.ts` and exposed through a strict sandboxed preload bridge (`window.kekenikElectron`).
  - Window bounds and maximized state are persisted atomically in `window-state.json` via `WindowStateStore` and clamped across active monitors (`clampWindowBoundsToDisplays`).
  - Single-instance lock (`app.requestSingleInstanceLock()`) forwards `second-instance` CLI/Explorer file arguments to the running window via `kpx:open-external-file`.
  - When `process.env.PORTABLE_EXECUTABLE_DIR` is set (Windows Portable target), all user data is redirected to `<PORTABLE_EXECUTABLE_DIR>/KekenikPixelData/`.
- **Application & `.kpx` File Icons (`scripts/generate-icons.mjs`, `assets/icon/`, `build/`)**:
  - Run `npm run generate:icons` (`node scripts/generate-icons.mjs`) after bumping `version` in `package.json` to regenerate all 33 version-pinned icon assets (`app.svg`, `icon.ico`, `icon.icns`, Linux PNGs `16`–`1024`, tray/taskbar icons, `file-kpx.svg`, `file-kpx.ico`, `installer-assets/installerHeader.bmp`, `installer-assets/installerSidebar.bmp`).
  - Windows file associations and shell icon cache refresh (`SHChangeNotify`) are configured in `package.json` (`build.fileAssociations`) and `installer-assets/installer.nsh`.
- **Builds & Packaging (`scripts/build.mjs`, `scripts/verify-release-bundle.mjs`, `.github/workflows/release.yml`, `docs/BUILD.md`)**:
  - See `docs/BUILD.md` for full build commands (`npm run dist:win`, `npm run dist:win:portable`, `npm run dist:linux`, `npm run dist:linux:docker`, `pnpm dist:all`, `npm run dist:win:qa`) and SHA-256 verification.

---

# Historical Handoff Notes (Agents 1–3)

## 1. Current State Summary (Agents 1, 2 & 3 Complete)
Agents 1, 2, and 3 have completed 141 / 261 registered features (all 141 in `tested` state with automated self-tests passing):
- **Agent 1 (21 Tested Features)**: Monorepo (`packages/core`, `packages/ui`, `apps/desktop`), `PixelImage` (`Uint8Array`), 19 blend modes, non-linear branching `History` with region-patch storage, 8 extension registries, Aseprite 1.3-style UI shell, docking/floating panels, workspaces, keyboard shortcuts, themes, and Persian RTL i18n.
- **Agent 2 (60 Tested Features)**: WebGL2 + Canvas2D dirty-rect renderer, adaptive pixel grid (`>= 800%`), tile grid, draggable symmetry axes, 3x3 Tiled Mode, Extra-Cel live tool preview, 18 drawing/retouch/text tools, 5 ink modes, ordered Bayer dithering matrices, custom stamp brushes (`Ctrl+B`), and Brush Library.
- **Agent 3 (60 Tested Features)**:
  - **Layers & Groups (`packages/core/src/commands/agent3-commands.ts`, `TimelinePanel`, `LayersPanel`)**: Hierarchical collapsible `GroupLayer` tree in the Timeline & Layers panel, drag-and-drop layer reorder/regroup, `Shift`/`Ctrl` multi-select, inline `F2` rename, custom layer row color swatches (`userData.color`), `Alt+Click` eye to Isolate/Solo layer, Reference Layers (`reference: true`, excluded from export composites), Duplicate, Merge Down, Flatten All / Flatten Visible, Convert To/From Background, Convert Layer `<->` Tilemap, and `LayerPropertiesDialog` (`Shift+P`).
  - **Frames & Cels**: Zoomable timeline column width, live cel pixel thumbnails (`Off | Small | Medium | Large`), rectangular multi-cel range selection (`Shift+Click`), drag-and-drop cels (`Move/Swap`, `Ctrl=Copy`, `Alt=Link`), continuous layer auto-linking (`preferLinkedCels`), per-cel Z-index offset (`-32..+32`) & opacity slider in the Timeline header, Cel Clipboard (`Copy`/`Paste`/`Duplicate`/`Clear`), `New Empty Frame` (`Alt+B`), `Reverse Frames`, `ConstantFrameRateDialog`, `FramePropertiesDialog` (`P`), and `CelPropertiesDialog`.
  - **Playback Engine & Onion Skin (`packages/core/src/animation/index.ts`)**: Deterministic fake-clock-testable `PlaybackClockState` & `advancePlaybackClock` supporting per-frame `durationMs`, `forward`/`reverse`/`pingpong`/`pingpong-reverse`, play subtags, speed multiplier (`0.25x..4x`), constant frame rate, finite tag repeat counter, and real-time frame-drop compensation. Full Onion Skin compositor (`Red/Blue Tint` vs `Merge`, configurable `framesBefore`/`framesAfter`, opacity falloff step, `loopTag`, `currentLayerOnly`, `behind`/`in_front`) + `OnionSkinSettingsDialog` (`F3`).
  - **Preview Window & Timeline Mini-Player**: Independent playback loop in floating/dockable `PreviewPanel`, tag selector, `3x3` tiled preview, pan/zoom sync viewport box, full-screen toggle (`F7`), and embedded Timeline Mini-Player.
  - **Tags & Slices (`packages/core/src/tilemap/index.ts`, `TagsPanel`, `SlicesPanel`)**: Cascading multi-row Tag banners in the Timeline header with `[` / `]` edge resize handles, `TagPropertiesDialog`, interactive Slice Tool (`Shift+C`) on canvas, 9-patch center scaling guides, pivot crosshair editor, per-frame animated `SliceKey`s, `Select Slice Bounds` mask hook (`selectSliceBounds`), and `Export Slice as Sprite Tab` (`exportSliceAsNewDocument`).
  - **Tilemaps & Tilesets (`packages/core/src/tilemap/index.ts`, `TilesetPanel`)**: Tile 0 empty/transparent rule, 32-bit `TILE_FLIP_X_FLAG` / `TILE_FLIP_Y_FLAG` / `TILE_ROTATE_90_FLAG` bitflags, `Tiles Mode` (tile-aware Pencil, Eraser, Paint Bucket, Line, Rectangle) and `Pixels Mode` (`Auto` / `Stack` / `Manual` tileset synchronization), dockable `TilesetPanel` with live single-tile pixel editor, `Highlight Used Tiles` canvas overlay, `Purge Unused Tiles`, and `TilesetPropertiesDialog`.

---

## 2. Instructions for Agent 4 (Selection, Transform, Clipboard, Palettes, Color Modes, Filters & Sprite/Edit Menus)
1. **Unzip & Verify**:
   ```bash
   npm ci
   npm run typecheck
   npm test
   npm run build:web
   ```
2. **Where to Plug In**:
   - **Selection Tools**: Register/activate `tool.marquee_rect` (`M`), `tool.marquee_ellipse`, `tool.lasso` (`Q`), `tool.polygonal_lasso`, and `tool.magic_wand` (`W`) in `ToolRegistry`, and implement selection boolean operations (`Replace`, `Add`, `Subtract`, `Intersect`), `Select > Modify` (`Expand`, `Contract`, `Border`), and `Select > Color Range`. Note: `selectSliceBounds(sliceId)` in `useAppStore` already populates `sprite.mask` for Slice-to-Selection integration!
   - **Transform & Move Tool (`tool.move`, `V`)**: Implement floating pixel lift, translation, 8-handle scale, corner rotation with `RotSprite` & Nearest-Neighbor interpolation, draggable pivot handle, skew/shear, Flip H/V, Rotate 90/180, and Shift/Wrap pixels.
   - **Clipboard & Palettes**: Implement `Copy`, `Cut`, `Paste`, `Copy Merged`, `Paste Special` (`New Sprite`, `New Layer`, `New Brush`), multi-swatch palette drag/ramp/sort, built-in palette presets (`DB16`, `DB32`, `Pico-8`, `Endesga-32`, `GameBoy`), median-cut/octree color quantizer, and RGBA/Grayscale/Indexed conversion with dithering.
   - **Filters & FX (`FilterRegistry`)**: Implement `Replace Color`, `Invert`, `Brightness/Contrast`, `Hue/Saturation`, `Color Curve`, `Convolution Matrix`, `Outline`, `Despeckle`, `Drop Shadow`, and `Posterize` with per-channel target masks (`R,G,B,A,Index`) and live preview.
   - Flip all 60 Agent-4 features in `FeatureRegistry` from `"planned"` to `"tested"` with real `selfTest()` checks.
