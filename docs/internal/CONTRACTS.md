# Kekenik Pixel — Public Contracts & Extension Guide (`CONTRACTS.md`)

> **Rule for Agents 2–5**: Do NOT rename or break public interfaces listed in this document. Always extend functionality by registering items in the 8 registries (`ToolRegistry`, `CommandRegistry`, `PanelRegistry`, `MenuRegistry`, `FormatRegistry`, `FilterRegistry`, `DialogRegistry`, `FeatureRegistry`) and mutating documents strictly via `doc.transact(label, tx => { ... })` or `doc.execute(command)`.

---

## 1. Document Mutation Contract (`packages/core/src/commands`)

UI components and tools **must never** mutate `doc.sprite` directly (`doc.sprite` is typed as `ReadonlySprite`).

### Example: Executing a Custom Command or Pixel Stroke
```ts
import { SpriteDocument, Command, Sprite } from "@kekenik/core";

// Option A: Using TransactionBuilder (built-in model helpers + region-patch strokes)
doc.transact("Paint Stroke", (tx) => {
  tx.drawPixels(
    activeLayerId,
    activeFrameIndex,
    [{ x: 10, y: 12, color: { r: 255, g: 0, b: 128, a: 255 } }],
    brushSize,
    "circle",
    "Paint Stroke"
  );
});

// Option B: Implementing a custom Command (for Agent 2..5 tools/filters)
export class FlipHorizontalCommand implements Command {
  public readonly id = "cmd_flip_h";
  public readonly label = "Flip Horizontal";
  public readonly timestamp = Date.now();
  public readonly byteSize = 512;

  public do(sprite: Sprite): void {
    // Perform in-place flip on target cel image
  }

  public undo(sprite: Sprite): void {
    // Reverse in-place flip
  }
}

doc.execute(new FlipHorizontalCommand());
```

---

## 2. The 8 Extension Registries (`packages/core/src/registry`)

### 2.1 `ToolRegistry` (Primary Owner: Agent 2 & Agent 4)
```ts
import { ToolRegistry } from "@kekenik/core";

ToolRegistry.register({
  id: "tool.paint_bucket",
  title: "Paint Bucket Tool",
  icon: "bucket",
  cursor: "crosshair",
  group: "fill",
  defaultShortcut: "G",
  ownerAgent: 2,
  state: "tested",
  contextBarSchema: [
    { key: "tolerance", label: "Tolerance", type: "number", min: 0, max: 255 },
    { key: "contiguous", label: "Contiguous", type: "toggle" },
  ],
  onPointerDown(ctx) {
    // Flood fill via ctx.doc.transact(...)
  },
});
```

### 2.2 `CommandRegistry` & `MenuRegistry` (Extended by Agents 2–5)
```ts
import { CommandRegistry, MenuRegistry } from "@kekenik/core";

CommandRegistry.register({
  id: "edit.invert_color",
  title: "Invert Color",
  category: "Menus",
  ownerAgent: 4,
  state: "tested",
  run({ activeDoc }) {
    if (!activeDoc) return;
    // Run invert filter command
  },
});

MenuRegistry.register({
  id: "menu.edit.invert",
  menu: "Edit",
  label: "Invert Color",
  commandId: "edit.invert_color",
  order: 8,
  ownerAgent: 4,
  state: "tested",
});
```

### 2.3 `PanelRegistry` (Extended by Agent 2, 3, 5)
```ts
import { PanelRegistry } from "@kekenik/core";

PanelRegistry.register({
  id: "panel.tileset",
  title: "Tileset",
  icon: "grid",
  ownerAgent: 3,
  state: "tested",
  defaultDockSlot: "left",
  singleton: true,
  floatable: true,
});
```

### 2.4 `FormatRegistry` (Primary Owner: Agent 5)
```ts
import { FormatRegistry } from "@kekenik/core";

FormatRegistry.register({
  id: "format.aseprite",
  name: "Aseprite Binary (.ase, .aseprite)",
  extensions: ["ase", "aseprite"],
  canRead: true,
  canWrite: true,
  supportsAnimation: true,
  supportsLayers: true,
  ownerAgent: 5,
  state: "tested",
  async read(bytes) { /* parse .ase chunks */ },
  async write(sprite) { /* encode .ase chunks */ },
});
```

### 2.5 `FilterRegistry` (Primary Owner: Agent 4)
```ts
import { FilterRegistry } from "@kekenik/core";

FilterRegistry.register({
  id: "filter.outline",
  title: "Outline...",
  category: "FX",
  ownerAgent: 4,
  state: "tested",
  apply(image, params) {
    return image.clone();
  },
});
```

### 2.6 `DialogRegistry` (Extended by Agents 2–5)
```ts
import { DialogRegistry } from "@kekenik/core";

DialogRegistry.register({
  id: "dialog.export_sprite_sheet",
  title: "Export Sprite Sheet",
  ownerAgent: 5,
  state: "tested",
});
```

### 2.7 `FeatureRegistry` (Mandatory for ALL Agents 1–5)
Every agent **must** update its features in `FeatureRegistry` from `state: "planned"` to `state: "implemented"` or `state: "tested"`, and supply a real `selfTest()` implementation:
```ts
import { FeatureRegistry } from "@kekenik/core";

FeatureRegistry.register({
  id: "tool.paint_bucket",
  title: "Paint Bucket Flood Fill (Contiguous, Tolerance, 8-Connected)",
  category: "Drawing Tools",
  ownerAgent: 2,
  state: "tested",
  description: "8-connected & 4-connected flood fill with tolerance 0..255.",
  selfTest() {
    // Run deterministic flood-fill test on an 8x8 PixelImage
    return { passed: true, message: "Flood fill verified on 8x8 test image.", durationMs: 0.4 };
  },
});
```

---

## 3. File Ownership Map

| Directory / File | Owning Agent | Policy for Later Agents |
|---|---|---|
| `packages/core/src/model/*` | Agent 1 | Extend via helper functions; do not break existing interfaces |
| `packages/core/src/commands/*` | Agent 1 (base) + Agents 2–4 | Add new `Command` classes; keep `History` & `SpriteDocument` intact |
| `packages/core/src/registry/*` | Agent 1 (engine) + All | Register/update items via `*.register(...)` |
| `packages/core/src/keymap/*` | Agent 1 | Add new bindings if needed; preserve `KeymapManager` API |
| `packages/core/src/platform/*` | Agent 1 + Agent 5 | Agent 5 extends `ElectronPlatform` for `.ase` file associations & CLI |
| `packages/ui/src/skin/*` | Agent 1 | Add icons to `PixelIcon`; do not break theme tokens |
| `packages/ui/src/widgets/*` | Agent 1 | Shared widget library for all agents |
| `packages/ui/src/shell/*` | Agent 1 | Reads from registries automatically |
| `packages/ui/src/editor/*` | Agent 2 (`REPLACE_BY_AGENT_2`) | Agent 2 upgrades the CPU renderer & tool dispatch to WebGL2/Canvas2D + Brush Engine |
| `packages/core/src/animation/*` | Agent 3 | Pure TypeScript PlaybackEngine, tag sequence builders, and Onion Skin compositor |
| `packages/core/src/tilemap/*` | Agent 3 | Pure TypeScript Tilemap/Tileset engine, Auto/Stack/Manual sync, and Slice keyframe helpers |
| `packages/core/src/commands/agent3-commands.ts` | Agent 3 | Undoable Layer/Group/Cel/Frame/Tag/Slice/Tilemap/Tileset commands |
| `packages/ui/src/panels/*` | Agent 1 (shell) + Agent 3 & 4 | Agent 3 completed Timeline/Preview/Layers/Tileset/Tags/Slices; Agent 4 upgrades ColorBar/Palettes |
| `apps/desktop/*` | Agent 1 (skeleton) + Agent 5 | Agent 5 completes native OS menus, CLI, autosave daemon, and packaging |

---

## 4. Agent 3 Integration Hooks for Agents 4 & 5
- **Slice Bounds -> Selection Mask Hook (for Agent 4)**: `useAppStore.getState().selectSliceBounds(sliceId)` populates `doc.sprite.mask` with the active frame's `SliceKey.bounds` via `SetMaskCommand`. Agent 4's selection & transform tools automatically operate on this mask.
- **Tileset Export Fields (for Agent 5)**: `Tileset` in `@kekenik/core/model` exposes `tileWidth`, `tileHeight`, `gridOriginX`, `gridOriginY`, `baseIndex`, and `columns` (default `8`) for Agent 5's sprite-sheet and `.ase` tileset chunk (`0x2023`) exporters.
- **Reference Layer Export Exclusion (for Agent 5)**: Calling `compositeFrameAdvanced(sprite, frameIndex, { forExport: true })` automatically skips layers with `layer.reference === true`.
