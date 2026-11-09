# Kekenik Pixel — Project Status (`STATUS.md`)

## Agent Progress Overview

| Agent | Scope | Status | Features Tested | Features Planned |
|---|---|---|---|---|
| **Agent 1** | Core Model, Non-Linear Undo, 8 Registries, Full UI Shell, Desktop Skeleton | **DONE (100%)** | 21 / 21 | 0 |
| **Agent 2** | Rendering Engine, Drawing Tools, Ink Modes, Brush Engine & Library | **DONE (100%)** | 60 / 60 | 0 |
| **Agent 3** | Layers, Frames, Timeline Matrix, Animation, Onion Skin, Tags, Slices, Tilemaps | **DONE (100%)** | 60 / 60 | 0 |
| **Agent 4** | Selection, Transform, Clipboard, Palettes, Color Modes, Filters, Sprite/Edit Menus | **DONE (100%)** | 60 / 60 | 0 |
| **Agent 5 / 6 / 7A** | `.ase/.aseprite`/`.kpx`/WebP/JPEG/FLC/PCX Codecs, Sprite Sheets, Docking v2, Scripting, Extensions, Bug Fixes (`B01`–`B10`, `B18`–`B22`) | **DONE (100%)** | 135 / 135 | 0 |
| **Agent 7B** | Custom Frameless Electron Chrome (`B13`), Original App & `.kpx` Icons (`B16`, `B17`), Cross-Platform Build & Packaging (`B12`) | **DONE (100%)** | All 7B Tests Passing | 0 |

**Total Progress**: **276 / 276 Features Tested & Passing + Agent 7B Milestones (`M0` → `M-final`) Complete (8 test files, 210 passed tests)**.

---

## Agent 7B Milestone Status (`M0` → `M-final`)

| Milestone | Scope | Status |
|---|---|---|
| **M0** | Input archive verification, baseline report (`docs/BASELINE_REPORT.md` "7B baseline"), `com.kekenik.pixel` `appId` check | **DONE** |
| **M1 (B13)** | Custom frameless Electron window chrome (`frame: false`, `Menu.setApplicationMenu(null)`), `TitleBar` with embedded `MenuBar`, 46×32 window controls, `zod`-validated IPC, display-clamped bounds persistence, F11/Zen hide, unsaved-changes close delegation | **DONE & TESTED** |
| **M2 (B16 + B17)** | Original pixel-art + vector app icon (`assets/icon/app.svg`, `.ico`, `.icns`, Linux PNGs, NSIS BMPs), `.kpx` document icon (`file-kpx.ico`, 16/32 variants), `installer-assets/installer.nsh` (`SHChangeNotify`, opt-in `.ase`), single-instance handoff, portable mode (`KekenikPixelData/`) | **DONE & TESTED** |
| **M3 (B12)** | `scripts/build.mjs`, `scripts/verify-release-bundle.mjs`, `.github/workflows/release.yml`, `dist:win`, `dist:win:portable`, `dist:linux`, `dist:linux:docker`, `dist:all`, `dist:win:qa`, `docs/BUILD.md` | **DONE & TESTED** |
| **M4** | Electron security hardening (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, atomic writes, uncaught main-process error dialog with "Open Logs Folder"), `npm run test:all` green | **DONE & TESTED** |
| **M5 (`M-final`)** | Release bundle verification (`0` forbidden strings), web & source release archives, SHA-256 reporting, `RELEASE_REPORT.md` | **DONE** |

---

## Completed Deliverables Checklist (Agents 1–3)

- [x] **Agent 1 Deliverables**: Monorepo layout, `Uint8Array` `PixelImage`, 19 blend modes, linked cels, 1-bit `Mask`, `.kpx-snapshot` serializer, non-linear branching `History`, 8 registries, Aseprite 1.3-style UI shell, workspaces, shortcut editor, and Electron desktop skeleton.
- [x] **Agent 2 Deliverables**: WebGL2 & Canvas2D dirty-rect renderer, pixel grid (`>= 800%`), tile grid, symmetry guides, 3x3 Tiled Mode, Extra-Cel live preview, 18 drawing/retouch/text tools, 5 ink modes, ordered Bayer dithering matrices, custom stamp brushes (`Ctrl+B`), and Brush Library.
- [x] **Agent 3 Part A (Layers)**: Hierarchical Layer Tree in Timeline & Layers panel with eye (visibility + `Alt+Click` Solo), lock, continuous cels toggle, group expand/collapse, colored layer rows, drag & drop reorder/regroup, `Shift`/`Ctrl` multi-select, inline `F2` rename, Reference Layer underlay, Duplicate, Merge Down, Flatten, Convert To/From Background & Tilemap, and `LayerPropertiesDialog`.
- [x] **Agent 3 Part B (Frames & Cels)**: Zoomable timeline columns, Small/Medium/Large cel thumbnails, rectangular multi-cel range selection, drag & drop cels (`Move`, `Ctrl=Copy`, `Alt=Link`), continuous layer auto-linking, Cel Opacity slider & Z-index offset (`-32..+32`), Cel Clipboard, `New Empty Frame` (`Alt+B`), `Reverse Frames`, `ConstantFrameRateDialog`, `FramePropertiesDialog`, and `CelPropertiesDialog`.
- [x] **Agent 3 Part C (Playback & Onion Skin)**: Per-frame duration playback engine (`forward`, `reverse`, `pingpong`, `pingpong-reverse`, subtags, speed multiplier `0.25x..4x`, constant frame rate, finite repeats, frame-drop compensation), Onion Skin (`Red/Blue Tint` vs `Merge`, before/after counts, opacity falloff, loop tag, current layer only, behind/in-front), full floating/dockable `PreviewPanel` (independent playback, 3x3 tiled mode, viewport sync box, full-screen toggle), and Timeline Mini-Player.
- [x] **Agent 3 Part D (Tags & Slices)**: Cascading multi-row Tag banners with resize handles, `TagPropertiesDialog`, `TagsPanel`, interactive `Slice Tool (Shift+C)`, 9-patch center guides, pivot editor, per-frame animated `SliceKey`s, `SlicePropertiesDialog`, `SlicesPanel`, `Select Slice Bounds` hook, and `Export Slice as Sprite Tab`.
- [x] **Agent 3 Part E (Tilemaps & Tilesets)**: Tile 0 empty rule, 32-bit `FlipX` / `FlipY` / `Rot90` flags, `Tiles Mode` (tile-aware Pencil, Eraser, Paint Bucket, Line, Rectangle) & `Pixels Mode` (`Auto` / `Stack` / `Manual` tileset sync), dockable `TilesetPanel` with live tile pixel editor, `Highlight Used Tiles`, `Purge Unused Tiles`, and `TilesetPropertiesDialog`.
- [x] **Agent 3 Part F (Verification)**: 6 new Agent-3 Demo Documents (`walk_cycle.ase`, `onion_skin_lab.ase`, `layer_groups_blends.ase`, `linked_cels_lab.ase`, `tilemap_dungeon.ase`, `slices_9patch_ui.ase`), 60 automated Agent-3 Feature Center self-tests passing, and 55-step `docs/MANUAL_TEST.md`.
