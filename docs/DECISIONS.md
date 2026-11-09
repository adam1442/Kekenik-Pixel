# Architectural Decision Records (`docs/DECISIONS.md`)

## ADR-001: Backing Pixel Storage in Typed Arrays (`Uint8Array`)
- **Context**: Pixel-art editors perform thousands of per-pixel reads, flood fills, color index remappings, and undo patch extractions per second, and must run identically in Vitest (Node) and Web Workers.
- **Decision**: Store all pixel buffers in `PixelImage` using raw `Uint8Array` (RGBA = 4 B/px, Grayscale = 2 B/px, Indexed = 1 B/px) with zero DOM `<canvas>` dependencies inside `packages/core`.
- **Why**: Enables 100% deterministic headless unit testing in Vitest without canvas mocks, trivial rectangular `subarray` copy for region-patch undo, and zero GPU readback stalls duringEyedropper or flood-fill operations.
- **Trade-offs**: The UI renderer must upload `Uint8Array` data to an `ImageData` / WebGL texture on frame composite, which is fast for sprite dimensions up to 4096×4096.

## ADR-002: Non-Linear Branching Undo History + Region-Patch Storage
- **Context**: Users frequently undo several strokes, try an alternative shading pass, and then want to recover their earlier strokes without losing either branch; meanwhile, storing full canvas copies on every stroke would exhaust memory on 4096×4096 sprites.
- **Decision**: Implement `History` as a directed tree of `HistoryNode` items with lowest-common-ancestor traversal (`jumpToNode`) and store pixel edits as bounding-box `ImagePatch` diffs (`CelImagePatchCommand`).
- **Why**: Matches Aseprite's Undo History tree where no work is lost on undo+draw, while a 1-px stroke on a 256×256 canvas consumes < 100 bytes instead of 262 KB.
- **Trade-offs**: Jumping between distant branches requires replaying patches along the tree path from the lowest common ancestor, which stays well under 10 ms for typical history depths.

## ADR-003: Custom Pixel Docking & Floating Window Engine vs External Layout Library
- **Context**: Deliverable 5.3 requires an Aseprite-skinned docking and floating window system (left/right/bottom docks, splitters, floating Preview window, pin/unpin, workspace JSON serialization).
- **Decision**: Build a custom lightweight `DockManager` + `FloatingWindow` + `SplitPane` system backed by serializable `WorkspaceLayout` state in Zustand rather than importing `dockview` or `flexlayout-react`.
- **Why**: Third-party layout libraries inject modern web CSS/DOM structures that clash with Aseprite's 1-px pixel-beveled chrome and compact floating Preview window UX, and add ~150 KB of external code.
- **Trade-offs**: Advanced multi-level nested split trees are simplified to Aseprite's canonical 3 dock slots (Left Color Bar, Right Utility Dock, Bottom Timeline Dock) plus arbitrary draggable/resizable Floating Windows.

## ADR-004: Registry-First Extension Architecture (8 Registries)
- **Context**: Five sequential agents build Kekenik Pixel one after another; if later agents edit core shell files heavily, merge conflicts and regressions will occur.
- **Decision**: Provide 8 strongly-typed registries (`ToolRegistry`, `CommandRegistry`, `PanelRegistry`, `MenuRegistry`, `FormatRegistry`, `FilterRegistry`, `DialogRegistry`, `FeatureRegistry`) in `@kekenik/core`.
- **Why**: `MenuBar`, `ToolBar`, `ContextBar`, `DockManager`, and `FeatureCenter` render dynamically from registry contents, automatically displaying `"Planned: Agent N"` tooltips until an agent flips the state to `"tested"`.
- **Trade-offs**: Requires upfront schema registration in `master-features.ts`, which also serves as the live verification catalog.

## ADR-005: Zustand + Monotonic Document Revision Counter for UI Reactivity
- **Context**: `SpriteDocument` and `Sprite` are pure TypeScript classes in `packages/core` mutated exclusively through `doc.transact(...)` commands in-place for performance.
- **Decision**: Keep `SpriteDocument` instances inside a Zustand store (`useAppStore`) paired with a monotonic `docRevision` integer incremented after every command/undo/redo.
- **Why**: Avoids cloning multi-megabyte `Uint8Array` buffers on every React render while guaranteeing immediate, predictable React re-renders of the Canvas, Timeline, and Undo History panels.
- **Trade-offs**: UI actions must call `bumpRevision()` (or dispatch via `runCommandById`) after `doc.transact(...)` completes.

## ADR-006: PlatformAPI Abstraction (`WebPlatform` & `ElectronPlatform`)
- **Context**: The app must run in a standard web browser (`npm run dev`) for sandbox verification AND as a native Electron desktop app (`npm run dev:desktop`) with `contextIsolation: true`.
- **Decision**: Route all settings, recent files, file open/save dialogs, and clipboard operations through the `PlatformAPI` interface in `@kekenik/core/platform`.
- **Why**: Keeps 100% of `@kekenik/core` and `@kekenik/ui` agnostic of Electron IPC vs Browser File/Storage APIs.
- **Trade-offs**: Browser mode saves files as downloads (`.kpx-snapshot`) rather than overwriting arbitrary disk paths silently when the File System Access API is unavailable.

## ADR-007: Pure Fake-Clock-Testable Animation Playback Engine (`PlaybackClockState`)
- **Context**: Animation playback must respect per-frame `durationMs`, tag directions (`forward`, `reverse`, `pingpong`, `pingpong-reverse`), nested subtags, speed multipliers (`0.25x..4x`), finite tag repeat counts, and frame-drop compensation, while being 100% unit-testable in Vitest without real `setTimeout` delays.
- **Decision**: Implement `createPlaybackClockState` and `advancePlaybackClock(sprite, state, deltaMs, config)` as pure functions in `@kekenik/core/animation` driven by wall-clock deltas in the UI (`App.tsx` and `PreviewPanel`).
- **Why**: Allows deterministic sub-millisecond verification of complex multi-frame timelines and ping-pong tag loops in Feature Center self-tests while powering both the main editor timeline and the independent Preview window loop.
- **Trade-offs**: Requires maintaining a lightweight `PlaybackClockState` cursor alongside `activeFrameIndex` so ping-pong direction phase (`forward` vs `return` leg) is preserved across ticks.

## ADR-008: Onion Skin Ghost Resolution & Luminance-Preserving Red/Blue Tint Compositor
- **Context**: Animators need to inspect multiple previous and next frames simultaneously with either Red/Blue directional tinting or true-color merging, optional tag-boundary wrapping (`loopTag`), per-frame opacity falloff, and `behind` vs `in_front` compositing.
- **Decision**: Implement `resolveOnionSkinGhostFrames` and `compositeFrameWithOnionSkin` in `@kekenik/core/animation`, applying luminance-weighted RGB tinting (`applyOnionTint`) before blitting with Agent 2's `blitRegionRGBA`.
- **Why**: Preserves internal shading contrast inside ghost frames while clearly distinguishing past frames (Red) from future frames (Blue), and works identically in WebGL2 and Canvas2D backends.
- **Trade-offs**: Compositing N ghost frames adds N regional blits when Onion Skin is enabled, which remains well within the 60 fps budget for typical `framesBefore/After <= 4`.

## ADR-009: Packed 32-Bit Unsigned Tile Entries (`Uint32Array`) + Cached `cel.image` Synchronization
- **Context**: Aseprite 1.3 tilemaps store a tile index plus horizontal flip, vertical flip, and 90° rotation flags per grid cell, and must render at 60 fps and display thumbnails in the Timeline.
- **Decision**: Store tilemap grids in `Uint32Array` using bitflags `TILE_FLIP_X_FLAG (0x80000000)`, `TILE_FLIP_Y_FLAG (0x40000000)`, `TILE_ROTATE_90_FLAG (0x20000000)`, and `TILE_INDEX_MASK (0x1fffffff)`, with Tile `0` reserved as the empty transparent tile, and synchronize `cel.image` via `renderTilemapCel` on `TilemapEditCommand`.
- **Why**: Matches the `.ase` binary specification (`0x2023` tileset & tilemap cel chunks) for Agent 5 while allowing all existing thumbnail, eyedropper, and export pipelines to read `cel.image` directly.
- **Trade-offs**: `TilemapEditCommand` stores both the compact `Uint32Array` tile grid diff and any modified `Tileset` tile bitmaps on Auto/Stack pixel edits.

## ADR-010: Auto / Stack / Manual Tileset Synchronization on Pixels-Mode Edits
- **Context**: When painting in Pixels Mode on a `TilemapLayer`, Aseprite offers three behaviors: `Auto` (reuse matching tile or create new tile), `Stack` (always allocate a new tile copy), and `Manual` (modify existing referenced tile in-place across all usages).
- **Decision**: Implement `syncTilemapFromEditedPixels(cel, tileset, editedImage, mode)` in `@kekenik/core/tilemap`, comparing each grid cell (accounting for its flip/rotation flags) against `editedImage` and updating `tileset.tiles` and `cel.tilemapData` atomically inside `TilemapEditCommand`.
- **Why**: Avoids duplicating Agent 2's 18 drawing tools — every pixel tool (Pencil, Spray, Gradient, Shapes, Text, Blur) automatically works with Auto/Stack/Manual tilemap semantics.
- **Trade-offs**: Full-grid byte comparison runs on pointer-up commit, which takes `< 1 ms` for typical sprite tilemaps.

## ADR-011: Per-Frame Keyframed Slices (`SliceKey[]`) with 9-Patch Center & Pivot
- **Context**: Game UI and character hitboxes require slices that can change bounds, 9-slice scaling centers, and pivot coordinates across animation frames.
- **Decision**: Represent each `Slice` with a frame-sorted `keys: SliceKey[]` array queried via `getSliceKeyForFrame(slice, frameIndex)` (step-interpolating the latest key `<= frameIndex`) and mutated via `upsertSliceKey` + `UpdateSliceCommand`.
- **Why**: Supports both static single-key UI atlases and multi-frame animated hitboxes/buttons without duplicating slice metadata on every frame.
- **Trade-offs**: Editing a slice on frame `F` inserts or updates the keyframe at `F`.

## ADR-012: Custom Frameless Electron Chrome with Embedded `MenuBar` (`B13`)
- **Context**: Aseprite-style desktop integration requires a compact top bar combining the application icon system menu, in-app `MenuBar`, `● name.aseprite — Kekenik Pixel` dirty indicator, draggable region, and 46×32 window controls without a duplicate OS menu bar.
- **Decision**: Configure `BrowserWindow` with `frame: false`, `thickFrame: true`, `resizable: true`, and `Menu.setApplicationMenu(null)` on Windows/Linux (`titleBarStyle: 'hidden'` on macOS), and embed `<MenuBar embedded />` directly inside `<TitleBar />`.
- **Why**: Preserves native Windows Aero Snap, Snap Layouts, and edge resize handles (`thickFrame: true`) while eliminating double menu bars and reusing 100% of `MenuRegistry` and the existing `closeDocument` unsaved-changes flow.
- **Trade-offs**: Requires explicit `-webkit-app-region: drag` on empty space and `no-drag` on all interactive children.

## ADR-013: Runtime-Validated Typed IPC Surface with `zod` & Sandboxed Preload (`B13`)
- **Context**: Renderer-to-main IPC calls for window controls, settings, and file dialogs must uphold Electron security best practices (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`).
- **Decision**: Centralize IPC schemas and handlers in `apps/desktop/src/main/ipc.ts` validated at runtime with `zod`, and expose only strongly-typed wrapper methods on `window.kekenikElectron` via `contextBridge.exposeInMainWorld`.
- **Why**: Prevents malformed or untrusted payloads from reaching main-process APIs and ensures the renderer never accesses raw `ipcRenderer`.
- **Trade-offs**: Adds a lightweight schema validation step (`< 0.05 ms` per call) on IPC invocation.

## ADR-014: Pure-Node Code-Generated Icons (`scripts/generate-icons.mjs`) (`B16`, `B17`)
- **Context**: Packaging for Windows, macOS, and Linux requires multi-size `.ico` (`16`–`256`), `.icns`, Linux PNGs (`16`–`1024`), tray/taskbar icons, 24-bit NSIS BMP banners, and small-size-optimized `.kpx` document icons without introducing fragile native image toolchains.
- **Decision**: Define the app icon and `.kpx` document icon as deterministic pixel-art grids + SVG masters (`assets/icon/app.svg`, `assets/icon/file-kpx.svg`) and encode PNG, ICO, ICNS, and 24-bit BMP containers directly in `scripts/generate-icons.mjs` using Node's built-in `fs`, `zlib`, and `crypto`.
- **Why**: Guarantees 100% reproducible, version-pinned icon generation on any OS without native C++ addons (`sharp`/`canvas`).
- **Trade-offs**: Custom binary container encoders (`.ico`, `.icns`, `.bmp`) must be maintained in `scripts/generate-icons.mjs` (covered by unit tests in `bugs-7b.test.ts`).

## ADR-015: Portable Mode Data Redirection & Single-Instance File Handoff (`B17`)
- **Context**: Portable Windows users expect settings, recents, and autosaves to stay on their USB drive beside the `.exe`, while installed users expect double-clicking a `.kpx` file in Explorer to open in the already-running instance.
- **Decision**: Check `process.env.PORTABLE_EXECUTABLE_DIR` at startup (`resolveDesktopDataDir`) to redirect `userData` to `KekenikPixelData/`, and use `app.requestSingleInstanceLock()` + `app.on("second-instance")` to forward `argv` file paths via `kpx:open-external-file`.
- **Why**: Provides true zero-footprint portable execution and seamless single-window Explorer file opening.
- **Trade-offs**: In portable mode, the directory containing the `.exe` must be writable by the current user.

## ADR-016: Non-Intrusive NSIS File Association & Shell Icon Refresh Strategy (`B17`, `B12`)
- **Context**: Installing Kekenik Pixel should associate `.kpx` files with their dedicated document icon immediately, support Explorer "Open with" for `.kpx`/`.aseprite`/`.ase`, and never hijack an existing editor's `.aseprite` default association unless opted in.
- **Decision**: Implement `installer-assets/installer.nsh` using `SHCTX` registry writes, gating default `.ase`/`.aseprite` association behind `REGISTER_ASEPRITE_ASSOC` (default `"0"`), tagging installer-created keys with `KekenikPixelCreated`, and invoking `Shell32::SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0)` on install and uninstall.
- **Why**: Refreshes Explorer icons immediately without a reboot and ensures uninstall removes only keys created by Kekenik Pixel while offering a "keep settings" prompt.
- **Trade-offs**: Users who want Kekenik Pixel as the default double-click handler for `.aseprite` opt in explicitly or use Windows "Open with".
