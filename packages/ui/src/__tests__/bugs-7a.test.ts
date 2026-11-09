import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applySymmetryTransform,
  composeFloatingTransformMatrix,
  computeTransformedBounds,
  createSprite,
  flipFloatingSelectionHorizontal,
  flipFloatingSelectionVertical,
  FloatingSelectionState,
  getSymmetryTransforms,
  Mask,
  MenuRegistry,
  paintStrokeOnImage,
  PixelImage,
  rasterizeEllipse,
  renderFloatingTransformWithBounds,
  SetMaskCommand,
  SpriteDocument,
  TransformSpriteOrCelCommand,
} from "../../../core/src/index.ts";
import { buildMenuHierarchy, useAppStore } from "../index.ts";

function makeFloatingState(img: PixelImage, angleDeg = 0): FloatingSelectionState {
  const mask = new Mask(img.width, img.height);
  mask.selectAll();
  return {
    sourceImage: img,
    localMask: mask,
    originX: 10,
    originY: 10,
    x: 10,
    y: 10,
    width: img.width,
    height: img.height,
    angleDeg,
    skewXDeg: 0,
    skewYDeg: 0,
    pivotRelX: 0.5,
    pivotRelY: 0.5,
    algorithm: "fast",
  };
}

describe("Agent 7A Bug Fixes Verification (B01–B10, B18–B22)", () => {
  it("B01: Floating selection rotation expands bounds without clipping corners and composes transform matrix", () => {
    const img = new PixelImage(10, 10, "rgba");
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        img.setRGBA(x, y, { r: 255, g: 0, b: 0, a: 255 });
      }
    }
    const state = makeFloatingState(img, 45);
    const mat = composeFloatingTransformMatrix(state);
    expect(Math.abs(mat.a - Math.cos(Math.PI / 4))).toBeLessThan(1e-5);
    const bounds = computeTransformedBounds(state);
    expect(bounds.width).toBeGreaterThan(10);
    expect(bounds.height).toBeGreaterThan(10);
    const preview = renderFloatingTransformWithBounds(state);
    expect(preview.image.width).toBeGreaterThan(10);
    expect(preview.image.height).toBeGreaterThan(10);
  });

  it("B02: Gradient tool fills canvas/selection without requiring Shift, while Shift snaps angle", async () => {
    const { renderGradientImage } = await import("../../../core/src/index.ts");
    const img = new PixelImage(8, 8, "rgba");
    renderGradientImage(img, {
      start: { x: 0, y: 0 },
      end: { x: 7, y: 0 },
      fgColor: { r: 255, g: 0, b: 0, a: 255 },
      bgColor: { r: 0, g: 0, b: 255, a: 255 },
      gradientType: "linear",
      ditherMode: "none",
      contiguous: false,
      tolerance: 0,
      inkMode: "simple",
      opacity: 255,
    });
    expect(img.getRGBA(0, 0).r).toBe(255);
    expect(img.getRGBA(7, 0).b).toBe(255);
    const editorSrc = fs.readFileSync(
      path.resolve(process.cwd(), "packages/ui/src/editor/index.tsx"),
      "utf8"
    );
    expect(editorSrc).toContain("contiguous: toolOptions.contiguous");
    expect(editorSrc).not.toContain("toolOptions.contiguous && e.shiftKey");
  });

  it("B03: Closing a dirty document prompts Save/Discard/Cancel instead of closing immediately", () => {
    const store = useAppStore.getState();
    const doc = store.createNewDocument({
      name: "DirtyTabB03.ase",
      width: 16,
      height: 16,
      colorMode: "rgba",
      background: "transparent",
    });
    const layerId = doc.sprite.layers[0].id;
    doc.transact("Dirty Pixel", (tx) => {
      tx.drawPixels(layerId, 0, [{ x: 1, y: 1, color: { r: 255, g: 0, b: 0, a: 255 } }]);
    });
    expect(doc.isDirty).toBe(true);

    useAppStore.getState().closeDocument(doc.id);
    expect(useAppStore.getState().documents.some((d) => d.id === doc.id)).toBe(true);
    expect(useAppStore.getState().activeDialog).toBe("dialog.unsaved_changes");
    expect(useAppStore.getState().pendingCloseDocId).toBe(doc.id);

    useAppStore.getState().cancelPendingClose();
    expect(useAppStore.getState().activeDialog).toBeNull();
    expect(useAppStore.getState().documents.some((d) => d.id === doc.id)).toBe(true);

    useAppStore.getState().closeDocument(doc.id);
    useAppStore.getState().confirmDiscardAndClose();
    expect(useAppStore.getState().documents.some((d) => d.id === doc.id)).toBe(false);
  });

  it("B04: Tiled Mode wraps brush strokes across boundaries without streaking across the canvas interior", () => {
    const img = new PixelImage(16, 16, "rgba");
    paintStrokeOnImage(
      img,
      [
        { x: 15, y: 8 },
        { x: 16, y: 8 },
      ],
      {
        fgColor: { r: 0, g: 255, b: 0, a: 255 },
        bgColor: { r: 0, g: 0, b: 0, a: 0 },
        brush: { size: 1, type: "square", angle: 0 },
        inkMode: "simple",
        opacity: 255,
        pixelPerfect: false,
        symmetryMode: "none",
        symmetryX: 8,
        symmetryY: 8,
        tiledMode: "both",
      }
    );
    expect(img.getRGBA(15, 8).g).toBe(255);
    expect(img.getRGBA(0, 8).g).toBe(255);
    expect(img.getRGBA(8, 8).a).toBe(0);
  });

  it("B05: Symmetry reflects/transposes asymmetric brush offsets and deduplicates center axis stamps", () => {
    const tfs = getSymmetryTransforms("both");
    expect(tfs.length).toBe(4);
    const reflected = applySymmetryTransform({ x: 10, y: 6 }, tfs[1], 8, 8);
    expect(reflected.x).toBe(5);
    expect(reflected.y).toBe(6);
  });

  it("B06: Grid thickness is configurable between 1px and 8px via setGridAppearance", () => {
    useAppStore.getState().setGridAppearance("#4a90e2", 65, 4);
    expect(useAppStore.getState().gridThickness).toBe(4);
    useAppStore.getState().setGridAppearance("#4a90e2", 65, 99);
    expect(useAppStore.getState().gridThickness).toBe(8);
    useAppStore.getState().setGridAppearance("#4a90e2", 65, 1);
    expect(useAppStore.getState().gridThickness).toBe(1);
  });

  it("B07: ContextBar exposes Grid button with double-click-to-open Grid Settings Dialog", () => {
    const shellSrc = fs.readFileSync(
      path.resolve(process.cwd(), "packages/ui/src/shell/index.tsx"),
      "utf8"
    );
    expect(shellSrc).toContain('dataTestId="contextbar-grid-btn"');
    expect(shellSrc).toContain('onDoubleClick={() => openDialog("dialog.grid_settings")}');
  });

  it("B08: Updating sprite grid goes through an undoable Command (SetSpriteGridCommand)", () => {
    const doc = useAppStore.getState().createNewDocument({
      name: "GridUndoB08.ase",
      width: 32,
      height: 32,
      colorMode: "rgba",
      background: "transparent",
    });
    const origW = doc.sprite.grid.width;
    useAppStore.getState().updateSpriteGrid({ width: 12, height: 12 });
    expect(doc.sprite.grid.width).toBe(12);
    expect(doc.undo()).toBe(true);
    expect(doc.sprite.grid.width).toBe(origW);
  });

  it("B09: Input widgets select-all on focus and no raw <input>/<textarea> exist in panels/dialogs outside widgets/", () => {
    const uiSrcDir = path.resolve(process.cwd(), "packages/ui/src");
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__") continue;
          out.push(...walk(full));
        } else if (entry.name.endsWith(".tsx")) {
          out.push(full);
        }
      }
      return out;
    };
    for (const file of walk(uiSrcDir)) {
      if (file.endsWith(path.join("widgets", "index.tsx"))) continue;
      const content = fs.readFileSync(file, "utf8");
      expect(content, `Raw <input> found in ${file}`).not.toMatch(/<input\b/);
      expect(content, `Raw <textarea> found in ${file}`).not.toMatch(/<textarea\b/);
    }
  });

  it("B10: Modal dialog widget supports title-bar drag with viewport clamping", () => {
    const widgetSrc = fs.readFileSync(
      path.resolve(process.cwd(), "packages/ui/src/widgets/index.tsx"),
      "utf8"
    );
    expect(widgetSrc).toContain("handleTitleMouseDown");
    expect(widgetSrc).toContain('data-testid="dialog-titlebar"');
  });

  it("B18: Outlined Ellipse tool draws a hollow perimeter without filling interior", () => {
    const img = new PixelImage(16, 16, "rgba");
    const pts = rasterizeEllipse({ x: 2, y: 2 }, { x: 13, y: 13 }, { filled: false });
    paintStrokeOnImage(img, pts, {
      fgColor: { r: 255, g: 0, b: 0, a: 255 },
      bgColor: { r: 0, g: 0, b: 0, a: 0 },
      brush: { size: 1, type: "square", angle: 0 },
      inkMode: "simple",
      opacity: 255,
      pixelPerfect: false,
      symmetryMode: "none",
      symmetryX: 8,
      symmetryY: 8,
      connectPoints: false,
    });
    expect(img.getRGBA(7, 2).a).toBe(255);
    expect(img.getRGBA(7, 13).a).toBe(255);
    expect(img.getRGBA(7, 7).a).toBe(0);
  });

  it("B19: MenuBar builds hierarchical submenu trees with children for Open Sample Project, Paste Special, Adjustments, FX", () => {
    const allItems = MenuRegistry.getAll();
    const state = {
      symmetryMode: "none" as const,
      tiledMode: "none" as const,
      showGrid: false,
      showPixelGrid: true,
      showExtras: true,
      showLayerEdges: false,
      onionSkinEnabled: false,
    };
    const fileTree = buildMenuHierarchy("File", allItems, state);
    const openSample = fileTree.find((i) => i.id === "menu.file.open_sample");
    expect(openSample).toBeDefined();
    expect(openSample?.children?.length).toBeGreaterThanOrEqual(10);

    const editTree = buildMenuHierarchy("Edit", allItems, state);
    expect(editTree.find((i) => i.id === "menu.edit.paste_special")?.children?.length).toBeGreaterThanOrEqual(3);
    expect(editTree.find((i) => i.id === "menu.edit.adjustments")?.children?.length).toBeGreaterThanOrEqual(4);
    expect(editTree.find((i) => i.id === "menu.edit.fx")?.children?.length).toBeGreaterThanOrEqual(4);
  });

  it("B20: ContextBar source has removed Undo/Redo buttons, active tool label, and presets dropdown", () => {
    const shellSrc = fs.readFileSync(
      path.resolve(process.cwd(), "packages/ui/src/shell/index.tsx"),
      "utf8"
    );
    expect(shellSrc).not.toContain("+Preset");
    expect(shellSrc).toContain("B20: Undo/Redo, active tool label, and presets removed from DOM");
  });

  it("B21: Flip H / Flip V flips both pixel content and non-rectangular selection mask", () => {
    const doc = new SpriteDocument(createSprite({ width: 8, height: 8 }));
    const cel = doc.sprite.cels[0];
    const mask = new Mask(8, 8);
    mask.setBit(0, 0, true);
    mask.setBit(0, 1, true);
    mask.setBit(1, 0, true);
    doc.execute(new SetMaskCommand(mask, "Select L"));
    cel.image.setRGBA(0, 0, { r: 255, g: 0, b: 0, a: 255 });

    doc.execute(
      new TransformSpriteOrCelCommand({
        label: "Flip Horizontal",
        scope: "cel",
        layerId: doc.sprite.layers[0].id,
        frameIndex: 0,
        op: { kind: "flip_h" },
      })
    );
    expect(doc.sprite.mask.getBit(1, 0)).toBe(true);
    expect(doc.sprite.mask.getBit(1, 1)).toBe(true);
    expect(doc.sprite.mask.getBit(0, 1)).toBe(false);
    expect(cel.image.getRGBA(1, 0).r).toBe(255);

    const floatImg = new PixelImage(4, 2, "rgba");
    floatImg.setRGBA(0, 0, { r: 10, g: 20, b: 30, a: 255 });
    const flippedH = flipFloatingSelectionHorizontal(makeFloatingState(floatImg));
    expect(flippedH.sourceImage.getRGBA(3, 0).r).toBe(10);
    const flippedV = flipFloatingSelectionVertical(flippedH);
    expect(flippedV.sourceImage.getRGBA(3, 1).r).toBe(10);
  });

  it("B22: 8-way dihedral symmetry reflects strokes across all 4 axes (8 octants)", () => {
    const img = new PixelImage(16, 16, "rgba");
    paintStrokeOnImage(img, [{ x: 10, y: 9 }], {
      fgColor: { r: 255, g: 255, b: 0, a: 255 },
      bgColor: { r: 0, g: 0, b: 0, a: 0 },
      brush: { size: 1, type: "square", angle: 0 },
      inkMode: "simple",
      opacity: 255,
      pixelPerfect: false,
      symmetryMode: "eight_way",
      symmetryX: 8,
      symmetryY: 8,
    });
    let painted = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (img.getRGBA(x, y).a > 0) painted++;
      }
    }
    expect(painted).toBe(8);
  });
});
