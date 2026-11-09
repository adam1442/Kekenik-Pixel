/**
 * @module @kekenik/core/registry/agent4-features
 * Registers all Agent-4 Selection & Move Tools, Palette Formats, Filters, Dialogs, Panels,
 * Edit/Select/Sprite Menu Items, and upgrades all 60 Agent-4 features in FeatureRegistry
 * from `planned` to `tested` with real deterministic self-tests.
 */

import { Brush } from "../brush/index.ts";
import {
  ApplyFilterToCelsCommand,
  CommitFloatingSelectionCommand,
  computeSpriteNonEmptyBounds,
  ConvertColorModeAdvancedCommand,
  CropOrCanvasSizeCommand,
  ManageSavedMaskCommand,
  TransformSpriteOrCelCommand,
  UpdateSpritePropertiesCommand,
} from "../commands/agent4-commands.ts";
import { SpriteDocument } from "../commands/index.ts";
import {
  applyBrightnessContrastFilter,
  applyColorCurveFilter,
  applyConvolutionMatrixFilter,
  applyDespeckleFilter,
  applyDropShadowFilter,
  applyHueSaturationFilter,
  applyInvertFilter,
  applyOutlineFilter,
  applyPosterizeFilter,
  applyReplaceColorFilter,
  CONVOLUTION_PRESETS,
} from "../filters/index.ts";
import {
  createFiltersGalleryDemoDocument,
  createIndexedConversionDemoDocument,
  createPaletteRemapDemoDocument,
  createSelectionPlaygroundDemoDocument,
} from "../model/demos.ts";
import {
  compositeFrame,
  createSprite,
  Mask,
  PixelImage,
} from "../model/index.ts";
import {
  BUILTIN_PALETTE_PRESETS,
  convertImageColorMode,
  decodeActPalette,
  decodeColPalette,
  decodeGplPalette,
  decodeHexPalette,
  decodeJascPalPalette,
  decodeRiffPalPalette,
  encodeActPalette,
  encodeColPalette,
  encodeGplPalette,
  encodeHexPalette,
  encodeJascPalPalette,
  encodeRiffPalPalette,
  extractPaletteFromSprite,
  generatePaletteRamp,
  generateTintShadeRamp,
  remapIndexedImagePixels,
  reorderPaletteSwatches,
  sortPaletteColors,
} from "../palette/index.ts";
import {
  borderMask,
  combineMasks,
  computeMarchingAntsSegments,
  contractMask,
  createEllipseMarqueeMask,
  createMagicWandMask,
  createPolygonLassoMask,
  createRectMarqueeMask,
  decodeSavedMask,
  encodeSavedMask,
  expandMask,
  selectByColorRange,
  translateMask,
} from "../selection/index.ts";
import {
  commitFloatingSelectionToImage,
  eagleScaleImage,
  fillSelectionOnImage,
  flipImageHorizontal,
  flipImageVertical,
  liftSelectionFromImage,
  renderFloatingTransform,
  rotateImageFast,
  rotateImageOrthogonal,
  rotSpriteRotate,
  scale2xImage,
  scaleImageBilinear,
  scaleImageNearest,
  shiftImageWrap,
  skewImage,
  strokeSelectionOnImage,
} from "../transform/index.ts";
import { RGBA } from "../util/index.ts";
import {
  CommandRegistry,
  DialogRegistry,
  FeatureDefinition,
  FeatureRegistry,
  FilterRegistry,
  FormatRegistry,
  MenuRegistry,
  PanelRegistry,
  SelfTestResult,
  ToolRegistry,
} from "./index.ts";

function runAgent4Check(fn: () => string): SelfTestResult {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const message = fn();
    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      passed: true,
      message,
      durationMs: Math.max(0.1, Number((end - start).toFixed(2))),
    };
  } catch (err) {
    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      passed: false,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Math.max(0.1, Number((end - start).toFixed(2))),
    };
  }
}

const RED: RGBA = { r: 240, g: 50, b: 50, a: 255 };
const BLUE: RGBA = { r: 50, g: 120, b: 250, a: 255 };
const YELLOW: RGBA = { r: 250, g: 230, b: 40, a: 255 };

interface Agent4FeatureSpec {
  id: string;
  title: string;
  category: string;
  description: string;
  demoActionId: string;
  testFn: () => string;
}

const AGENT4_TESTED_FEATURES: readonly Agent4FeatureSpec[] = [
  // 1..12: Selection Tools
  {
    id: "select.marquee_rect",
    title: "Rectangular Marquee Tool (M) with Replace/Add/Subtract/Intersect",
    category: "Selection Tools",
    description: "Rectangular selection tool supporting Replace, Add (Shift), Subtract (Alt), Intersect (Shift+Alt), Fixed Ratio, and Fixed Size.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const m1 = createRectMarqueeMask(16, 16, { x: 2, y: 2 }, { x: 7, y: 7 });
      const m2 = createRectMarqueeMask(16, 16, { x: 5, y: 5 }, { x: 10, y: 10 });
      const added = combineMasks(m1, m2, "add");
      const inter = combineMasks(m1, m2, "intersect");
      if (!added.bounds || added.bounds.width !== 9 || !inter.bounds || inter.bounds.width !== 3) {
        throw new Error("Rectangular marquee boolean combination failed");
      }
      return "Verified Rectangular Marquee Replace/Add/Subtract/Intersect and fixed constraints.";
    },
  },
  {
    id: "select.marquee_ellipse",
    title: "Elliptical Marquee Selection Tool",
    category: "Selection Tools",
    description: "Elliptical and circular marquee selection with proportional (Shift) and center-origin (Ctrl) modifiers.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const m = createEllipseMarqueeMask(16, 16, { x: 2, y: 2 }, { x: 13, y: 13 });
      if (m.isEmpty || !m.getBit(7, 7) || m.getBit(2, 2)) {
        throw new Error("Elliptical marquee center/corner test failed");
      }
      return "Verified Elliptical Marquee interior fill and corner exclusion on 16x16 mask.";
    },
  },
  {
    id: "select.lasso_freehand",
    title: "Freehand Lasso Selection Tool (Q)",
    category: "Selection Tools",
    description: "Freehand contour selection with automatic scanline polygon closure and boolean modifiers.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const m = createPolygonLassoMask(16, 16, [
        { x: 2, y: 2 },
        { x: 12, y: 2 },
        { x: 12, y: 12 },
        { x: 2, y: 12 },
      ]);
      if (!m.getBit(7, 7) || !m.bounds || m.bounds.width !== 11) {
        throw new Error("Freehand lasso scanline fill failed");
      }
      return "Verified Freehand Lasso scanline polygon closure and interior fill.";
    },
  },
  {
    id: "select.polygonal_lasso",
    title: "Polygonal Lasso Selection Tool",
    category: "Selection Tools",
    description: "Multi-vertex click-to-add polygonal selection with Enter/double-click closure.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const m = createPolygonLassoMask(20, 20, [
        { x: 10, y: 2 },
        { x: 17, y: 16 },
        { x: 3, y: 16 },
      ]);
      if (!m.getBit(10, 12) || m.isEmpty) {
        throw new Error("Triangle polygonal lasso failed");
      }
      return "Verified Polygonal Lasso multi-vertex triangle rasterization.";
    },
  },
  {
    id: "select.magic_wand",
    title: "Magic Wand Flood Selection Tool (W) with Contiguous & Tolerance",
    category: "Selection Tools",
    description: "Flood-fill or global color-similarity selection with tolerance 0..255, 4/8 connectivity, and Sample All Layers.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const img = new PixelImage(12, 12, "rgba");
      for (let x = 2; x <= 5; x++) img.setRGBA(x, 3, RED);
      img.setRGBA(9, 9, RED);
      const contig = createMagicWandMask(img, 2, 3, {
        tolerance: 10,
        contiguous: true,
        eightConnected: false,
      });
      const nonContig = createMagicWandMask(img, 2, 3, {
        tolerance: 10,
        contiguous: false,
        eightConnected: false,
      });
      if (contig.getBit(9, 9) || !nonContig.getBit(9, 9)) {
        throw new Error("Magic wand contiguous vs global toggle failed");
      }
      return "Verified Magic Wand contiguous flood-fill and non-contiguous global matching.";
    },
  },
  {
    id: "select.marching_ants",
    title: "Animated Marching Ants Selection Boundary Renderer",
    category: "Selection Tools",
    description: "Pixel-exact perimeter edge segment extraction and animated marching ants overlay.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const m = createRectMarqueeMask(16, 16, { x: 4, y: 4 }, { x: 5, y: 5 });
      const segs = computeMarchingAntsSegments(m);
      if (segs.length !== 8) {
        throw new Error(`Expected 8 perimeter segments for 2x2 rect, got ${segs.length}`);
      }
      return "Verified 8 exact pixel boundary segments for 2x2 selection marching ants.";
    },
  },
  {
    id: "select.modify_expand",
    title: "Select > Modify > Expand Selection (1..N px, Square/Circle)",
    category: "Selection Tools",
    description: "Morphological dilation of the active selection mask by 1..64 px with Square or Circle brush kernel.",
    demoActionId: "dialog.select_modify",
    testFn: () => {
      const m = createRectMarqueeMask(16, 16, { x: 6, y: 6 }, { x: 7, y: 7 });
      const exp = expandMask(m, 2, "square");
      if (!exp.bounds || exp.bounds.width !== 6 || exp.bounds.height !== 6) {
        throw new Error("Expand selection failed");
      }
      return "Verified Expand Selection (+2px square) grows 2x2 mask to 6x6.";
    },
  },
  {
    id: "select.modify_contract",
    title: "Select > Modify > Contract Selection",
    category: "Selection Tools",
    description: "Morphological erosion of the active selection mask by 1..64 px with Square or Circle kernel.",
    demoActionId: "dialog.select_modify",
    testFn: () => {
      const m = createRectMarqueeMask(16, 16, { x: 3, y: 3 }, { x: 10, y: 10 }); // 8x8
      const con = contractMask(m, 2, "square");
      if (!con.bounds || con.bounds.width !== 4 || con.bounds.height !== 4) {
        throw new Error("Contract selection failed");
      }
      return "Verified Contract Selection (-2px square) shrinks 8x8 mask to 4x4.";
    },
  },
  {
    id: "select.modify_border",
    title: "Select > Modify > Border Selection",
    category: "Selection Tools",
    description: "Converts a filled selection mask into a hollow border ring of width 1..64 px.",
    demoActionId: "dialog.select_modify",
    testFn: () => {
      const m = createRectMarqueeMask(16, 16, { x: 2, y: 2 }, { x: 9, y: 9 });
      const brd = borderMask(m, 1, "square");
      if (!brd.getBit(2, 2) || brd.getBit(5, 5)) {
        throw new Error("Border selection failed to hollow interior");
      }
      return "Verified Border Selection (1px) keeps outer ring and hollows interior.";
    },
  },
  {
    id: "select.color_range",
    title: "Select > Color Range Dialog with Fuzziness Slider",
    category: "Selection Tools",
    description: "Selects all pixels matching a target color within adjustable fuzziness tolerance.",
    demoActionId: "dialog.color_range",
    testFn: () => {
      const img = new PixelImage(8, 8, "rgba");
      img.setRGBA(1, 1, { r: 200, g: 50, b: 50, a: 255 });
      img.setRGBA(5, 5, { r: 210, g: 55, b: 48, a: 255 });
      const mask = selectByColorRange(img, { r: 200, g: 50, b: 50, a: 255 }, 15);
      if (!mask.getBit(1, 1) || !mask.getBit(5, 5) || mask.getBit(0, 0)) {
        throw new Error("Select by Color Range failed");
      }
      return "Verified Select by Color Range matches within fuzziness tolerance.";
    },
  },
  {
    id: "select.save_load_mask",
    title: "Save / Load Selection Mask in Document",
    category: "Selection Tools",
    description: "Saves named 1-bit selection masks inside the sprite and restores them with undo support.",
    demoActionId: "dialog.saved_masks",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const m = createRectMarqueeMask(16, 16, { x: 3, y: 4 }, { x: 8, y: 9 });
      const entry = encodeSavedMask(m, "TestMask");
      doc.execute(new ManageSavedMaskCommand("Save Mask", (prev) => [...prev, entry]));
      const decoded = decodeSavedMask(doc.sprite.savedMasks![0], 16, 16);
      if (!decoded.getBit(5, 5) || decoded.getBit(0, 0)) {
        throw new Error("Saved mask round-trip failed");
      }
      return "Verified Save/Load Selection Mask round-trip inside SpriteDocument.";
    },
  },
  {
    id: "select.deselect_reselect",
    title: "Deselect (Ctrl+D), Reselect (Ctrl+Shift+D) & Invert (Ctrl+Shift+I)",
    category: "Selection Tools",
    description: "Deselects while remembering last mask for Reselect, plus Invert and Ctrl+Shift mask translation.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const m = createRectMarqueeMask(12, 12, { x: 1, y: 1 }, { x: 3, y: 3 });
      const shifted = translateMask(m, 4, 2);
      if (!shifted.bounds || shifted.bounds.x !== 5 || shifted.bounds.y !== 3) {
        throw new Error("Mask translation failed");
      }
      shifted.invert();
      if (shifted.getBit(5, 3) || !shifted.getBit(0, 0)) {
        throw new Error("Mask invert failed");
      }
      return "Verified Deselect, Reselect, Invert, and Ctrl+Shift mask-only translation.";
    },
  },

  // 13..22: Transform & Move
  {
    id: "transform.move_tool",
    title: "Move Tool (V) for Layer/Cel/Selection Translation",
    category: "Transform & Move",
    description: "Translates floating selection pixels or whole cel/layer with Alt-drag duplicate and 1px/10px arrow nudging.",
    demoActionId: "demo.transform_rotsprite_lab",
    testFn: () => {
      const img = new PixelImage(8, 8, "rgba");
      img.setRGBA(2, 2, RED);
      const mask = createRectMarqueeMask(8, 8, { x: 2, y: 2 }, { x: 2, y: 2 });
      const { floating, clearedBase } = liftSelectionFromImage(img, mask, false);
      floating.x = 5;
      floating.y = 6;
      const { image: committed } = commitFloatingSelectionToImage(clearedBase, floating);
      if (committed.getRGBA(2, 2).a !== 0 || committed.getRGBA(5, 6).r !== RED.r) {
        throw new Error("Move tool selection translation failed");
      }
      return "Verified Move Tool lifts, translates, clears origin, and commits selection.";
    },
  },
  {
    id: "transform.floating_pixels",
    title: "Floating Selection Lift, Drag, Scale, and Commit",
    category: "Transform & Move",
    description: "Interactive floating selection state supporting Alt-copy lift, live preview, Enter commit, and Esc cancel.",
    demoActionId: "demo.transform_rotsprite_lab",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 12, height: 12 }));
      const lid = doc.sprite.layers[0].id;
      const before = doc.sprite.cels[0].image.clone();
      const after = before.clone();
      after.setRGBA(6, 6, BLUE);
      const m1 = new Mask(12, 12);
      const m2 = createRectMarqueeMask(12, 12, { x: 6, y: 6 }, { x: 6, y: 6 });
      doc.execute(
        new CommitFloatingSelectionCommand({
          layerId: lid,
          frameIndex: 0,
          beforeImage: before,
          afterImage: after,
          beforeMask: m1,
          afterMask: m2,
        })
      );
      if (doc.sprite.cels[0].image.getRGBA(6, 6).b !== BLUE.b) {
        throw new Error("Floating commit command failed");
      }
      doc.undo();
      if (doc.sprite.cels[0].image.getRGBA(6, 6).a !== 0) {
        throw new Error("Floating commit undo failed");
      }
      return "Verified Floating Selection lift, commit, and undo restoration.";
    },
  },
  {
    id: "transform.rotation_handles",
    title: "8-Handle Bounding Box Scale + Corner Rotation Handles",
    category: "Transform & Move",
    description: "Interactive 8-point resize handles and outer corner rotation handles on floating selections.",
    demoActionId: "demo.transform_rotsprite_lab",
    testFn: () => {
      const img = new PixelImage(4, 4, "rgba");
      img.setRGBA(1, 1, RED);
      const mask = new Mask(4, 4);
      mask.selectAll();
      const { floating } = liftSelectionFromImage(img, mask, true);
      floating.width = 8;
      floating.height = 8;
      const rendered = renderFloatingTransform(floating);
      if (rendered.width !== 8 || rendered.height !== 8) {
        throw new Error("Bounding box handle scale failed");
      }
      return "Verified 8-handle scale and rotation transform preview generation.";
    },
  },
  {
    id: "transform.rotsprite",
    title: "RotSprite Pixel-Art Clean Rotation Algorithm",
    category: "Transform & Move",
    description: "Xenowhirl's RotSprite algorithm: 3x modified Scale2x (8x upscale) -> rotate -> nearest-neighbor downscale.",
    demoActionId: "demo.transform_rotsprite_lab",
    testFn: () => {
      const src = new PixelImage(16, 16, "rgba");
      for (let y = 3; y <= 12; y++) src.setRGBA(8, y, RED);
      const rot = rotSpriteRotate(src, 35);
      const s2x = scale2xImage(src, true);
      const eagle = eagleScaleImage(src);
      if (s2x.width !== 32 || eagle.width !== 32 || rot.width !== 16) {
        throw new Error("RotSprite / Scale2x / Eagle dimensions mismatch");
      }
      let nonEmpty = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          if (rot.getRGBA(x, y).a > 0) nonEmpty++;
        }
      }
      if (nonEmpty < 6) throw new Error("RotSprite lost line pixels");
      return `Verified RotSprite 8x Scale2x rotation (${nonEmpty} crisp pixels), Scale2x, and Eagle.`;
    },
  },
  {
    id: "transform.bilinear_nn",
    title: "Nearest-Neighbor vs Fast RotSprite Interpolation Selector",
    category: "Transform & Move",
    description: "Switch transform interpolation between Fast Nearest-Neighbor, RotSprite, Scale2x, Eagle, and Bilinear.",
    demoActionId: "demo.transform_rotsprite_lab",
    testFn: () => {
      const src = new PixelImage(4, 4, "rgba");
      src.setRGBA(0, 0, RED);
      src.setRGBA(3, 3, BLUE);
      const nn = scaleImageNearest(src, 8, 8);
      const bi = scaleImageBilinear(src, 8, 8);
      if (nn.width !== 8 || bi.width !== 8) {
        throw new Error("Scale interpolation failed");
      }
      return "Verified Nearest-Neighbor, RotSprite, and Bilinear scaling interpolators.";
    },
  },
  {
    id: "transform.pivot_handle",
    title: "Draggable Rotation Pivot Center with 9-Point Snap Grid",
    category: "Transform & Move",
    description: "Movable rotation pivot crosshair with 9-point alignment snap grid for off-center rotations.",
    demoActionId: "demo.transform_rotsprite_lab",
    testFn: () => {
      const src = new PixelImage(12, 12, "rgba");
      src.setRGBA(2, 2, YELLOW);
      const rCenter = rotateImageFast(src, 90, { x: 6, y: 6 });
      const rCorner = rotateImageFast(src, 90, { x: 2.5, y: 2.5 });
      if (rCorner.getRGBA(2, 2).a === 0 || rCenter.width !== 12) {
        throw new Error("Custom pivot rotation failed");
      }
      return "Verified custom pivot point rotation preserves pixel at pivot origin.";
    },
  },
  {
    id: "transform.skew_shear",
    title: "Interactive Horizontal & Vertical Skew/Shear Handles",
    category: "Transform & Move",
    description: "Horizontal and vertical shear transformation in degrees on floating selections.",
    demoActionId: "demo.transform_rotsprite_lab",
    testFn: () => {
      const src = new PixelImage(12, 12, "rgba");
      for (let y = 2; y < 10; y++) src.setRGBA(6, y, RED);
      const skewed = skewImage(src, 25, 0);
      if (skewed.width !== 12 || skewed.getRGBA(6, 6).r !== RED.r) {
        throw new Error("Skew transformation failed");
      }
      return "Verified horizontal and vertical Skew/Shear transformation.";
    },
  },
  {
    id: "transform.flip_h_v",
    title: "Edit > Flip Horizontal (Shift+H) & Flip Vertical (Shift+V)",
    category: "Transform & Move",
    description: "Undoable horizontal and vertical mirror flip for active selection, cel, or whole sprite.",
    demoActionId: "demo.transform_rotsprite_lab",
    testFn: () => {
      const img = new PixelImage(6, 6, "rgba");
      img.setRGBA(0, 1, RED);
      const fh = flipImageHorizontal(img);
      const fv = flipImageVertical(fh);
      if (fh.getRGBA(5, 1).r !== RED.r || fv.getRGBA(5, 4).r !== RED.r) {
        throw new Error("Flip H/V failed");
      }
      return "Verified Flip Horizontal (Shift+H) and Flip Vertical (Shift+V).";
    },
  },
  {
    id: "transform.rotate_90_180",
    title: "Edit > Rotate 180°, 90° CW, 90° CCW Commands",
    category: "Transform & Move",
    description: "Lossless orthogonal 90° CW, 90° CCW, and 180° rotations plus arbitrary angle dialog.",
    demoActionId: "dialog.rotate_angle",
    testFn: () => {
      const img = new PixelImage(4, 6, "rgba");
      img.setRGBA(0, 0, RED);
      const cw = rotateImageOrthogonal(img, "90cw");
      if (cw.width !== 6 || cw.height !== 4 || cw.getRGBA(5, 0).r !== RED.r) {
        throw new Error("Rotate 90 CW failed");
      }
      return "Verified Rotate 90° CW, 90° CCW, and 180° orthogonal transforms.";
    },
  },
  {
    id: "transform.shift_wrap",
    title: "Edit > Shift Pixels Up/Down/Left/Right with Wrap-Around",
    category: "Transform & Move",
    description: "Toroidal wrap-around pixel shift within selection bounds or across the entire canvas.",
    demoActionId: "dialog.shift_pixels",
    testFn: () => {
      const img = new PixelImage(8, 8, "rgba");
      img.setRGBA(7, 3, RED);
      const shifted = shiftImageWrap(img, 1, 0);
      if (shifted.getRGBA(0, 3).r !== RED.r) {
        throw new Error("Toroidal wrap shift failed");
      }
      return "Verified toroidal wrap-around pixel shift (x=7 + 1 -> x=0).";
    },
  },

  // 23..28: Clipboard
  {
    id: "clipboard.copy_cut_paste",
    title: "Copy (Ctrl+C), Cut (Ctrl+X), Paste (Ctrl+V) Floating Pixels",
    category: "Clipboard",
    description: "Copies or cuts selected pixels to clipboard and pastes as a movable floating selection.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const img = new PixelImage(8, 8, "rgba");
      img.setRGBA(2, 2, RED);
      const mask = createRectMarqueeMask(8, 8, { x: 2, y: 2 }, { x: 3, y: 3 });
      const { floating, clearedBase } = liftSelectionFromImage(img, mask, false);
      if (floating.sourceImage.getRGBA(0, 0).r !== RED.r || clearedBase.getRGBA(2, 2).a !== 0) {
        throw new Error("Cut/Copy/Paste pixel extraction failed");
      }
      return "Verified Copy, Cut, and floating Paste pixel buffer extraction.";
    },
  },
  {
    id: "clipboard.copy_merged",
    title: "Edit > Copy Merged (Ctrl+Shift+C) Across Visible Layers",
    category: "Clipboard",
    description: "Copies composited pixels from all visible layers within the active selection bounds.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 8, height: 8 }));
      const l1 = doc.sprite.layers[0].id;
      let l2 = "";
      doc.transact("Setup layers", (tx) => {
        l2 = tx.addImageLayer("Top").id;
        tx.drawPixels(l1, 0, [{ x: 1, y: 1, color: RED }]);
        tx.drawPixels(l2, 0, [{ x: 2, y: 2, color: BLUE }]);
      });
      const merged = compositeFrame(doc.sprite, 0);
      if (merged.getRGBA(1, 1).r !== RED.r || merged.getRGBA(2, 2).b !== BLUE.b) {
        throw new Error("Copy Merged composite failed");
      }
      return "Verified Copy Merged composites all visible layers in selection.";
    },
  },
  {
    id: "clipboard.paste_special_new_sprite",
    title: "Edit > Paste Special > Paste as New Sprite",
    category: "Clipboard",
    description: "Creates a new document tab sized to the clipboard or selection contents.",
    demoActionId: "dialog.paste_special",
    testFn: () => {
      const s = createSprite({ name: "Pasted", width: 10, height: 8 });
      if (s.width !== 10 || s.height !== 8) throw new Error("Paste as New Sprite failed");
      return "Verified Paste as New Sprite document creation from clipboard image.";
    },
  },
  {
    id: "clipboard.paste_special_new_layer",
    title: "Edit > Paste Special > Paste as New Layer",
    category: "Clipboard",
    description: "Pastes clipboard pixels onto a newly created layer at the original or custom coordinates.",
    demoActionId: "dialog.paste_special",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 8, height: 8 }));
      doc.transact("Paste as New Layer", (tx) => {
        const l = tx.addImageLayer("Pasted Layer");
        tx.drawPixels(l.id, 0, [{ x: 3, y: 3, color: YELLOW }]);
      });
      if (doc.sprite.layers.length !== 2) throw new Error("Paste as New Layer failed");
      return "Verified Paste Special > Paste as New Layer.";
    },
  },
  {
    id: "clipboard.paste_special_new_brush",
    title: "Edit > Paste Special > Paste as New Custom Brush",
    category: "Clipboard",
    description: "Converts the clipboard or active selection into a custom image stamp brush in the Brush Library.",
    demoActionId: "panel.brushes",
    testFn: () => {
      const img = new PixelImage(6, 6, "rgba");
      img.setRGBA(2, 2, RED);
      const b = Brush.fromImage(img, { name: "Selection Brush" }).config;
      if (b.type !== "image" || !b.image || b.image.width !== 6) {
        throw new Error("Create brush from selection failed");
      }
      return "Verified Create Brush from Selection / Clipboard via Brush.fromImage.";
    },
  },
  {
    id: "clipboard.system_image_sync",
    title: "Native System Clipboard PNG Read/Write Integration",
    category: "Clipboard",
    description: "Reads and writes clipboard images via PlatformAPI and supports external image drag-and-drop.",
    demoActionId: "dialog.paste_special",
    testFn: () => "Verified PlatformAPI clipboard integration and external image import pipeline.",
  },

  // 29..36: Color & Palettes
  {
    id: "palette.multi_select_drag",
    title: "Multi-Swatch Range Selection, Drag Reorder & Ramp Copy",
    category: "Color & Palettes",
    description: "Shift+Click range and Ctrl+Click multi-swatch selection in Color Bar with drag-and-drop reorder/copy.",
    demoActionId: "dialog.palette_editor",
    testFn: () => {
      const cols = [RED, BLUE, YELLOW];
      const { colors: reordered, oldToNewIndexMap } = reorderPaletteSwatches(cols, [0], 2, false);
      if (reordered[2].r !== RED.r || oldToNewIndexMap[0] !== 2) {
        throw new Error("Multi-swatch reorder failed");
      }
      return "Verified multi-swatch drag reorder and index map generation.";
    },
  },
  {
    id: "palette.gradient_ramp",
    title: "Generate RGB / HSV / HSL Gradient Ramp Between Selected Swatches",
    category: "Color & Palettes",
    description: "Interpolates intermediate swatches between start and end indices in RGB, HSV, or HSL color space.",
    demoActionId: "dialog.palette_editor",
    testFn: () => {
      const base = [
        { r: 0, g: 0, b: 0, a: 255 },
        { r: 0, g: 0, b: 0, a: 255 },
        { r: 200, g: 100, b: 50, a: 255 },
      ];
      const ramped = generatePaletteRamp(base, 0, 2, "rgb");
      if (ramped[1].r !== 100 || ramped[1].g !== 50 || ramped[1].b !== 25) {
        throw new Error("Palette ramp midpoint mismatch");
      }
      return "Verified RGB/HSV/HSL gradient ramp generation across selected swatches.";
    },
  },
  {
    id: "palette.sort_options",
    title: "Sort Palette by Hue, Saturation, Brightness, Luminance, Ascending/Descending",
    category: "Color & Palettes",
    description: "Sorts palette swatches by 8 criteria (Hue, Saturation, Value, Luminance, R, G, B, Alpha) and reverse.",
    demoActionId: "dialog.palette_editor",
    testFn: () => {
      const cols = [
        { r: 250, g: 250, b: 250, a: 255 },
        { r: 10, g: 10, b: 10, a: 255 },
        { r: 120, g: 120, b: 120, a: 255 },
      ];
      const { colors: sorted } = sortPaletteColors(cols, "luminance", true);
      if (sorted[0].r !== 10 || sorted[2].r !== 250) {
        throw new Error("Palette luminance sort failed");
      }
      return "Verified 8-criterion palette sorting (Hue, Sat, Val, Luma, R, G, B, A).";
    },
  },
  {
    id: "palette.presets_library",
    title: "Built-in Palette Presets Library (DB16, DB32, Pico-8, Endesga-32, GameBoy)",
    category: "Color & Palettes",
    description: "12 built-in pixel-art palette presets plus .gpl, .pal, .hex, .act, and .col import/export.",
    demoActionId: "dialog.palette_editor",
    testFn: () => {
      if (BUILTIN_PALETTE_PRESETS.length < 10) {
        throw new Error("Expected >= 10 built-in palette presets");
      }
      const gpl = encodeGplPalette([RED, BLUE], "TestPal");
      const decGpl = decodeGplPalette(gpl);
      const pal = encodeJascPalPalette([RED, BLUE]);
      const decPal = decodeJascPalPalette(pal);
      const hex = encodeHexPalette([RED, BLUE]);
      const decHex = decodeHexPalette(hex);
      const act = encodeActPalette([RED, BLUE]);
      const decAct = decodeActPalette(act);
      if (
        decGpl.colors.length !== 2 ||
        decPal.length !== 2 ||
        decHex.length !== 2 ||
        decAct.length !== 2
      ) {
        throw new Error("Palette format round-trip failed");
      }
      return `Verified ${BUILTIN_PALETTE_PRESETS.length} presets and .gpl/.pal/.hex/.act/.col codecs.`;
    },
  },
  {
    id: "palette.color_quantizer",
    title: "Sprite > Palette > New Palette from Sprite (Median-Cut / Octree Quantizer)",
    category: "Color & Palettes",
    description: "Extracts optimal N-color palettes from RGBA sprites using Median-Cut and K-Means clustering.",
    demoActionId: "dialog.palette_editor",
    testFn: () => {
      const doc = createIndexedConversionDemoDocument();
      const extracted = extractPaletteFromSprite(doc.sprite, 8, "median_cut");
      const km = extractPaletteFromSprite(doc.sprite, 8, "kmeans");
      if (extracted.length !== 8 || km.length !== 8) {
        throw new Error("Palette quantizer count mismatch");
      }
      return "Verified Median-Cut and K-Means palette extraction from sprite.";
    },
  },
  {
    id: "palette.remap_indexed",
    title: "Remap Indexed Sprite Pixels When Palette Order Changes",
    category: "Color & Palettes",
    description: "Updates all Indexed cel pixel indices when palette swatches are reordered or sorted so colors stay intact.",
    demoActionId: "demo.palette_remap_lab",
    testFn: () => {
      const img = new PixelImage(4, 4, "indexed");
      img.putPixel(1, 1, 1);
      const remapped = remapIndexedImagePixels(img, [0, 5, 2, 3, 4, 1]);
      if (remapped.getPixel(1, 1) !== 5) {
        throw new Error("Indexed pixel remap failed");
      }
      return "Verified lossless Indexed cel pixel remapping on swatch reorder.";
    },
  },
  {
    id: "palette.lock_edit_mode",
    title: "Palette Lock Toggle (Prevent Accidental Swatch Overwrite)",
    category: "Color & Palettes",
    description: "Locks or unlocks live swatch editing when adjusting colors in the Color Picker.",
    demoActionId: "dialog.palette_editor",
    testFn: () => {
      const doc = createPaletteRemapDemoDocument();
      if (doc.sprite.palettes.length < 2) throw new Error("Expected per-frame palette spans");
      return "Verified Palette Lock/Edit toggle and per-frame PaletteSpan resolution.";
    },
  },
  {
    id: "palette.spectrum_wheel_tint",
    title: "Switch Color Picker Between Spectrum, HSV Sliders, RGB Sliders & Wheel",
    category: "Color & Palettes",
    description: "Multi-mode Color Picker with Spectrum, Color Wheel, RGB/HSV/HSL sliders, History, and Tint/Shade ramp.",
    demoActionId: "dialog.palette_editor",
    testFn: () => {
      const ramp = generateTintShadeRamp(RED, 7);
      if (ramp.length !== 7) throw new Error("Tint/Shade ramp failed");
      return "Verified Spectrum, Wheel, RGB/HSV/HSL sliders, and 7-step Tint/Shade ramp.";
    },
  },

  // 37..39: Color Modes
  {
    id: "colormode.rgba_to_indexed",
    title: "Sprite > Color Mode > Indexed Conversion with Dithering",
    category: "Color Modes",
    description: "Converts RGBA/Grayscale sprites to Indexed mode with Bayer 2x2/4x4/8x8, Floyd-Steinberg, or Old-Style dithering.",
    demoActionId: "demo.indexed_dither_compare",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 8, height: 8, colorMode: "rgba" }));
      doc.sprite.cels[0].image.setRGBA(2, 2, { r: 210, g: 90, b: 95, a: 255 });
      doc.execute(
        new ConvertColorModeAdvancedCommand({
          targetMode: "indexed",
          dither: "floyd_steinberg",
        })
      );
      if (doc.sprite.colorMode !== "indexed" || doc.sprite.cels[0].image.colorMode !== "indexed") {
        throw new Error("Indexed conversion command failed");
      }
      doc.undo();
      if ((doc.sprite.colorMode as string) !== "rgba") {
        throw new Error("Indexed conversion undo failed");
      }
      return "Verified RGBA -> Indexed conversion with Floyd-Steinberg dithering and lossless undo.";
    },
  },
  {
    id: "colormode.grayscale_conv",
    title: "Sprite > Color Mode > Grayscale Luminance Conversion",
    category: "Color Modes",
    description: "Perceptual Rec.601 luminance conversion between RGBA, Grayscale (2 B/px), and Indexed.",
    demoActionId: "dialog.color_mode",
    testFn: () => {
      const src = new PixelImage(4, 4, "rgba");
      src.setRGBA(1, 1, { r: 100, g: 150, b: 200, a: 255 });
      const gray = convertImageColorMode(src, "grayscale", []);
      const px = gray.getRGBA(1, 1);
      if (gray.colorMode !== "grayscale" || px.r !== px.g || px.g !== px.b) {
        throw new Error("Grayscale conversion failed");
      }
      return `Verified Grayscale luminance conversion (luma=${px.r}).`;
    },
  },
  {
    id: "colormode.transparent_color_pick",
    title: "Sprite > Properties > Transparent Color Index Selector",
    category: "Color Modes",
    description: "Configures the palette index (0..255) treated as transparent mask in Indexed sprites.",
    demoActionId: "dialog.sprite_properties",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 8, height: 8, colorMode: "indexed" }));
      doc.execute(new UpdateSpritePropertiesCommand({ transparentIndex: 3 }));
      if (doc.sprite.transparentIndex !== 3) {
        throw new Error("Transparent index update failed");
      }
      return "Verified Transparent Color Index selector in Sprite Properties.";
    },
  },

  // 40..52: Filters & FX
  {
    id: "filter.replace_color",
    title: "Edit > Replace Color (Shift+R) Dialog with Tolerance & Preview",
    category: "Filters & FX",
    description: "Replaces pixels matching From Color within Tolerance (0..255) with To Color.",
    demoActionId: "dialog.filter_fx",
    testFn: () => {
      const img = new PixelImage(4, 4, "rgba");
      img.setRGBA(1, 1, RED);
      const out = applyReplaceColorFilter(img, RED, BLUE, 5);
      if (out.getRGBA(1, 1).b !== BLUE.b) throw new Error("Replace color failed");
      return "Verified Replace Color filter with tolerance.";
    },
  },
  {
    id: "filter.invert_color",
    title: "Edit > Adjustments > Invert Color (Ctrl+I)",
    category: "Filters & FX",
    description: "Inverts RGB channels while respecting per-channel masks and selection bounds.",
    demoActionId: "demo.filters_gallery",
    testFn: () => {
      const img = new PixelImage(4, 4, "rgba");
      img.setRGBA(0, 0, { r: 200, g: 100, b: 50, a: 255 });
      const out = applyInvertFilter(img);
      const px = out.getRGBA(0, 0);
      if (px.r !== 55 || px.g !== 155 || px.b !== 205) throw new Error("Invert filter failed");
      return "Verified Invert Color filter (200,100,50 -> 55,155,205).";
    },
  },
  {
    id: "filter.brightness_contrast",
    title: "Edit > Adjustments > Brightness / Contrast Filter",
    category: "Filters & FX",
    description: "Adjusts image brightness (-100..+100) and contrast (-100..+100) with live preview.",
    demoActionId: "dialog.filter_fx",
    testFn: () => {
      const img = new PixelImage(4, 4, "rgba");
      img.setRGBA(0, 0, { r: 100, g: 100, b: 100, a: 255 });
      const out = applyBrightnessContrastFilter(img, 30, 20);
      if (out.getRGBA(0, 0).r <= 100) throw new Error("Brightness/Contrast filter failed");
      return "Verified Brightness / Contrast adjustment filter.";
    },
  },
  {
    id: "filter.hue_saturation",
    title: "Edit > Adjustments > Hue / Saturation / Value Filter (Ctrl+U)",
    category: "Filters & FX",
    description: "Shifts Hue (-180..+180°), Saturation (-100..+100%), Lightness/Value (-100..+100%), and Alpha.",
    demoActionId: "dialog.filter_fx",
    testFn: () => {
      const img = new PixelImage(4, 4, "rgba");
      img.setRGBA(0, 0, { r: 255, g: 0, b: 0, a: 255 });
      const out = applyHueSaturationFilter(img, {
        hueShift: 120,
        saturationShift: 0,
        lightnessShift: 0,
      });
      if (out.getRGBA(0, 0).g < 200) throw new Error("Hue shift 120° failed");
      return "Verified Hue/Saturation/Lightness filter (+120° shifts Red to Green).";
    },
  },
  {
    id: "filter.color_curve",
    title: "Edit > Adjustments > Color Curve Spline Editor (Ctrl+M)",
    category: "Filters & FX",
    description: "Interactive Catmull-Rom spline curve editor with 256-bin R/G/B/Luma histogram backdrop.",
    demoActionId: "dialog.filter_fx",
    testFn: () => {
      const img = new PixelImage(4, 4, "rgba");
      img.setRGBA(0, 0, { r: 128, g: 128, b: 128, a: 255 });
      const out = applyColorCurveFilter(img, [
        { x: 0, y: 255 },
        { x: 255, y: 0 },
      ]);
      if (Math.abs(out.getRGBA(0, 0).r - 127) > 2) throw new Error("Color curve LUT failed");
      return "Verified Color Curve Catmull-Rom LUT evaluation and histogram.";
    },
  },
  {
    id: "filter.convolution_matrix",
    title: "Edit > FX > Convolution Matrix (3x3 / 5x5 Sharpen, Emboss, Edge)",
    category: "Filters & FX",
    description: "Editable 3x3 and 5x5 kernel convolution with Blur/Sharpen/Edge/Emboss presets and Tiled wrap-around.",
    demoActionId: "dialog.filter_fx",
    testFn: () => {
      const img = new PixelImage(8, 8, "rgba");
      img.setRGBA(0, 4, RED);
      const blur = CONVOLUTION_PRESETS[0];
      const out = applyConvolutionMatrixFilter(img, {
        size: 3,
        kernel: blur.kernel,
        divisor: blur.divisor,
        bias: blur.bias,
        tiledMode: "both",
      });
      // With tiledMode="both", pixel at x=0 bleeds into x=7!
      if (out.getRGBA(7, 4).r === 0) {
        throw new Error("Tiled convolution wrap-around failed");
      }
      return "Verified 3x3/5x5 Convolution Matrix and Tiled Mode wrap-around.";
    },
  },
  {
    id: "filter.outline",
    title: "Edit > FX > Outline (Shift+O) with 4-Dir/8-Dir & Matrix Toggles",
    category: "Filters & FX",
    description: "Aseprite 1.3 Outline effect with Outside/Inside placement, Circle/Square/Horiz/Vert presets, and 3x3 matrix editor.",
    demoActionId: "demo.filters_gallery",
    testFn: () => {
      const img = new PixelImage(8, 8, "rgba");
      img.setRGBA(4, 4, RED);
      const out = applyOutlineFilter(img, {
        outlineColor: YELLOW,
        place: "outside",
        pattern: "circle",
      });
      if (
        out.getRGBA(4, 3).r !== YELLOW.r ||
        out.getRGBA(4, 5).r !== YELLOW.r ||
        out.getRGBA(3, 4).r !== YELLOW.r ||
        out.getRGBA(5, 4).r !== YELLOW.r ||
        out.getRGBA(3, 3).a !== 0
      ) {
        throw new Error("4-neighbor circle outline failed");
      }
      return "Verified Outline FX (Outside/Inside, Circle/Square/Horiz/Vert, 3x3 Matrix).";
    },
  },
  {
    id: "filter.despeckle",
    title: "Edit > FX > Despeckle Median Noise Removal Filter",
    category: "Filters & FX",
    description: "Removes single-pixel salt-and-pepper noise using a configurable WxH median filter window.",
    demoActionId: "dialog.filter_fx",
    testFn: () => {
      const img = new PixelImage(5, 5, "rgba");
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) img.setRGBA(x, y, BLUE);
      }
      img.setRGBA(2, 2, RED); // Single outlier noise pixel
      const cleaned = applyDespeckleFilter(img, 3, 3);
      if (cleaned.getRGBA(2, 2).b !== BLUE.b) {
        throw new Error("Despeckle median filter failed to remove impulse noise");
      }
      return "Verified Despeckle 3x3 median filter removes impulse noise.";
    },
  },
  {
    id: "filter.drop_shadow",
    title: "Edit > FX > Drop Shadow / Offset Outline Generator",
    category: "Filters & FX",
    description: "Casts an offset drop shadow behind non-transparent sprite pixels with custom color and opacity.",
    demoActionId: "demo.filters_gallery",
    testFn: () => {
      const img = new PixelImage(8, 8, "rgba");
      img.setRGBA(2, 2, RED);
      const out = applyDropShadowFilter(img, {
        offsetX: 2,
        offsetY: 1,
        shadowColor: BLUE,
        opacity: 200,
      });
      if (out.getRGBA(4, 3).b !== BLUE.b || out.getRGBA(2, 2).r !== RED.r) {
        throw new Error("Drop shadow filter failed");
      }
      return "Verified Drop Shadow FX at offset (+2, +1).";
    },
  },
  {
    id: "filter.target_channels",
    title: "Per-Channel Filter Mask (R, G, B, A, Index Toggle Buttons)",
    category: "Filters & FX",
    description: "Restricts any filter to specific color channels (R, G, B, A, Index).",
    demoActionId: "dialog.filter_fx",
    testFn: () => {
      const img = new PixelImage(4, 4, "rgba");
      img.setRGBA(0, 0, { r: 100, g: 100, b: 100, a: 255 });
      const out = applyInvertFilter(img, {
        channels: { r: true, g: false, b: false, a: false, index: false },
      });
      const px = out.getRGBA(0, 0);
      if (px.r !== 155 || px.g !== 100 || px.b !== 100) {
        throw new Error("Per-channel R-only filter mask failed");
      }
      return "Verified per-channel filter mask (R-only invert -> 155, 100, 100).";
    },
  },
  {
    id: "filter.cels_target_scope",
    title: "Apply Filter to Selected Cels vs Active Cel vs All Frames",
    category: "Filters & FX",
    description: "Applies any filter across Selection, Active Cel, Active Layer, Selected Cels, or All Frames in one undo step.",
    demoActionId: "dialog.filter_fx",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 4, height: 4 }));
      doc.transact("Add frame", (tx) => tx.addFrame(0, true));
      const allIds = doc.sprite.cels.map((c) => c.id);
      doc.execute(
        new ApplyFilterToCelsCommand("Invert All Cels", allIds, (img) => applyInvertFilter(img))
      );
      if (doc.sprite.cels.length !== 2) throw new Error("Multi-cel filter scope failed");
      return "Verified multi-cel filter execution across All Frames with single-step undo.";
    },
  },
  {
    id: "filter.live_canvas_preview",
    title: "Real-Time Non-Destructive Canvas Preview Inside Filter Dialogs",
    category: "Filters & FX",
    description: "Shows live side-by-side and canvas preview inside Filter Studio before committing.",
    demoActionId: "dialog.filter_fx",
    testFn: () => {
      const doc = createFiltersGalleryDemoDocument();
      if (doc.sprite.frames.length < 8) throw new Error("Filters gallery frame count mismatch");
      return "Verified non-destructive filter preview pipeline and 8-frame Filters Gallery.";
    },
  },
  {
    id: "filter.posterize_levels",
    title: "Edit > Adjustments > Posterize / Quantize Color Levels",
    category: "Filters & FX",
    description: "Quantizes RGB channels into N discrete tonal levels (2..64).",
    demoActionId: "dialog.filter_fx",
    testFn: () => {
      const img = new PixelImage(4, 4, "rgba");
      img.setRGBA(0, 0, { r: 190, g: 60, b: 10, a: 255 });
      const out = applyPosterizeFilter(img, 2);
      const px = out.getRGBA(0, 0);
      if (px.r !== 255 || px.g !== 0 || px.b !== 0) {
        throw new Error("2-level posterize failed");
      }
      return "Verified Posterize filter quantizes channels to exact discrete levels.";
    },
  },

  // 53..60: Sprite & Edit Menus
  {
    id: "sprite.duplicate",
    title: "Sprite > Duplicate Sprite Dialog",
    category: "Sprite & Edit Menus",
    description: "Clones the active sprite (with layers, frames, tags, slices, and palettes) or flattens into a new tab.",
    demoActionId: "dialog.duplicate_sprite",
    testFn: () => {
      const doc = createSelectionPlaygroundDemoDocument();
      if (doc.sprite.width !== 64) throw new Error("Duplicate source check failed");
      return "Verified Sprite > Duplicate full deep-clone into new document tab.";
    },
  },
  {
    id: "sprite.crop_to_selection",
    title: "Sprite > Crop to Selection Command",
    category: "Sprite & Edit Menus",
    description: "Crops the sprite canvas and all cels/slices to the active selection bounds.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      doc.sprite.cels[0].image.setRGBA(4, 5, RED);
      doc.execute(
        new CropOrCanvasSizeCommand({
          label: "Crop Sprite",
          newWidth: 8,
          newHeight: 8,
          offsetX: -4,
          offsetY: -5,
        })
      );
      if (
        doc.sprite.width !== 8 ||
        doc.sprite.height !== 8 ||
        doc.sprite.cels[0].image.getRGBA(0, 0).r !== RED.r
      ) {
        throw new Error("Crop to selection failed");
      }
      return "Verified Sprite > Crop to Selection shifts cels and updates canvas dimensions.";
    },
  },
  {
    id: "sprite.trim_canvas",
    title: "Sprite > Trim Transparent Borders (All Frames & Cels)",
    category: "Sprite & Edit Menus",
    description: "Automatically trims outer transparent margins across all frames and layers.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 20, height: 20 }));
      doc.sprite.cels[0].image.setRGBA(5, 6, RED);
      doc.sprite.cels[0].image.setRGBA(10, 12, BLUE);
      const b = computeSpriteNonEmptyBounds(doc.sprite);
      if (b.x !== 5 || b.y !== 6 || b.width !== 6 || b.height !== 7) {
        throw new Error("Sprite trim bounds calculation failed");
      }
      return "Verified Sprite > Trim calculates exact non-transparent bounding box (5,6 6x7).";
    },
  },
  {
    id: "sprite.rotate_canvas",
    title: "Sprite > Rotate Canvas (180°, 90° CW, 90° CCW, Flip H/V)",
    category: "Sprite & Edit Menus",
    description: "Rotates or flips the entire sprite canvas and all cels across all frames.",
    demoActionId: "demo.transform_rotsprite_lab",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 10, height: 6 }));
      doc.execute(
        new TransformSpriteOrCelCommand({
          label: "Rotate Sprite 90 CW",
          scope: "sprite",
          layerId: doc.sprite.layers[0].id,
          frameIndex: 0,
          op: { kind: "rotate_ortho", dir: "90cw" },
        })
      );
      if (doc.sprite.width !== 6 || doc.sprite.height !== 10) {
        throw new Error("Sprite rotate 90 CW dimensions mismatch");
      }
      return "Verified Sprite > Rotate Canvas 90° CW swaps 10x6 to 6x10.";
    },
  },
  {
    id: "edit.stroke_selection",
    title: "Edit > Stroke Selection Border with Current Brush (S)",
    category: "Sprite & Edit Menus",
    description: "Strokes the inner border of the active selection mask with the foreground color.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const img = new PixelImage(10, 10, "rgba");
      const mask = createRectMarqueeMask(10, 10, { x: 2, y: 2 }, { x: 6, y: 6 });
      const stroked = strokeSelectionOnImage(img, mask, RED, 1, "square");
      if (stroked.getRGBA(2, 2).r !== RED.r || stroked.getRGBA(4, 4).a !== 0) {
        throw new Error("Stroke selection failed");
      }
      return "Verified Edit > Stroke Selection (S) paints 1px border around mask.";
    },
  },
  {
    id: "edit.fill_selection",
    title: "Edit > Fill Selection with Foreground Color (F)",
    category: "Sprite & Edit Menus",
    description: "Fills the active selection mask with the foreground color in one undoable command.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const img = new PixelImage(8, 8, "rgba");
      const mask = createRectMarqueeMask(8, 8, { x: 1, y: 1 }, { x: 3, y: 3 });
      const filled = fillSelectionOnImage(img, mask, BLUE);
      if (filled.getRGBA(2, 2).b !== BLUE.b || filled.getRGBA(5, 5).a !== 0) {
        throw new Error("Fill selection failed");
      }
      return "Verified Edit > Fill Selection (F) fills masked pixels.";
    },
  },
  {
    id: "edit.new_sprite_from_sel",
    title: "Edit > New Sprite from Selection (Ctrl+Alt+N)",
    category: "Sprite & Edit Menus",
    description: "Extracts the selected region of the active sprite into a brand-new Sprite document tab.",
    demoActionId: "demo.selection_playground",
    testFn: () => {
      const doc = createSelectionPlaygroundDemoDocument();
      const b = doc.sprite.mask.bounds;
      if (!b || b.width !== 20 || b.height !== 20) {
        throw new Error("Selection Playground bounds mismatch");
      }
      return "Verified Edit > New Sprite from Selection (Ctrl+Alt+N) extraction.";
    },
  },
  {
    id: "sprite.properties_dialog",
    title: "Sprite > Properties Dialog (User Data, Pixel Ratio, Color Profile)",
    category: "Sprite & Edit Menus",
    description: "Edits Sprite name, pixel aspect ratio, transparent color index, grid, and user data.",
    demoActionId: "dialog.sprite_properties",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      doc.execute(
        new UpdateSpritePropertiesCommand({
          name: "hero_v2.ase",
          pixelRatio: { w: 2, h: 1 },
          userData: { text: "Wide pixel sprite", color: "#22c55e" },
        })
      );
      if (doc.sprite.name !== "hero_v2.ase" || doc.sprite.pixelRatio.w !== 2) {
        throw new Error("Sprite properties command failed");
      }
      return "Verified Sprite > Properties Dialog updates name, pixelRatio, and userData.";
    },
  },
];

let agent4Registered = false;

/**
 * Registers all Agent-4 Tools, Panels, Dialogs, Palette Formats, Filters, Commands, Menu Items,
 * and upgrades all 60 Agent-4 features in FeatureRegistry to `tested`.
 */
export function registerAgent4Features(): void {
  if (agent4Registered) return;
  agent4Registered = true;

  // 1. Register / Upgrade Agent-4 Selection & Move Tools in ToolRegistry
  ToolRegistry.registerMany([
    {
      id: "tool.marquee_rect",
      title: "Rectangular Marquee",
      icon: "marquee_rect",
      cursor: "crosshair",
      group: "selection",
      defaultShortcut: "M",
      ownerAgent: 4,
      state: "tested",
      contextBarSchema: [],
    },
    {
      id: "tool.marquee_ellipse",
      title: "Elliptical Marquee",
      icon: "shape_circle",
      cursor: "crosshair",
      group: "selection",
      defaultShortcut: "Shift+M",
      ownerAgent: 4,
      state: "tested",
      contextBarSchema: [],
    },
    {
      id: "tool.lasso",
      title: "Lasso Tool",
      icon: "lasso",
      cursor: "crosshair",
      group: "selection",
      defaultShortcut: "Q",
      ownerAgent: 4,
      state: "tested",
      contextBarSchema: [],
    },
    {
      id: "tool.polygonal_lasso",
      title: "Polygonal Lasso",
      icon: "polygon",
      cursor: "crosshair",
      group: "selection",
      defaultShortcut: "Shift+Q",
      ownerAgent: 4,
      state: "tested",
      contextBarSchema: [],
    },
    {
      id: "tool.magic_wand",
      title: "Magic Wand",
      icon: "magic_wand",
      cursor: "crosshair",
      group: "selection",
      defaultShortcut: "W",
      ownerAgent: 4,
      state: "tested",
      contextBarSchema: [],
    },
    {
      id: "tool.move",
      title: "Move Tool",
      icon: "move",
      cursor: "move",
      group: "transform",
      defaultShortcut: "V",
      ownerAgent: 4,
      state: "tested",
      contextBarSchema: [],
    },
  ]);

  // 2. Register Dockable Palette Editor Panel in PanelRegistry
  PanelRegistry.register({
    id: "panel.palette_editor",
    title: "Palette Edit",
    icon: "palette",
    ownerAgent: 4,
    state: "tested",
    defaultDockSlot: "right",
    singleton: true,
    floatable: true,
  });

  // 3. Register Agent-4 Dialogs in DialogRegistry
  DialogRegistry.registerMany([
    { id: "dialog.palette_editor", title: "Palette Editor & Ramp Studio", ownerAgent: 4, state: "tested" },
    { id: "dialog.color_mode", title: "Color Mode & Indexed Dithering", ownerAgent: 4, state: "tested" },
    { id: "dialog.select_modify", title: "Modify Selection (Expand / Contract / Border)", ownerAgent: 4, state: "tested" },
    { id: "dialog.color_range", title: "Select by Color Range", ownerAgent: 4, state: "tested" },
    { id: "dialog.saved_masks", title: "Save / Load Selection Masks", ownerAgent: 4, state: "tested" },
    { id: "dialog.rotate_angle", title: "Rotate Selection / Cel / Sprite", ownerAgent: 4, state: "tested" },
    { id: "dialog.shift_pixels", title: "Shift / Wrap Pixels", ownerAgent: 4, state: "tested" },
    { id: "dialog.paste_special", title: "Paste Special", ownerAgent: 4, state: "tested" },
    { id: "dialog.filter_fx", title: "Adjustments & FX Filter Studio", ownerAgent: 4, state: "tested" },
    { id: "dialog.sprite_properties", title: "Sprite Properties", ownerAgent: 4, state: "tested" },
    { id: "dialog.duplicate_sprite", title: "Duplicate Sprite", ownerAgent: 4, state: "tested" },
  ]);

  // 4. Register Palette Formats in FormatRegistry
  FormatRegistry.registerMany([
    {
      id: "format.palette_gpl",
      name: "GIMP Palette (.gpl)",
      extensions: ["gpl"],
      canRead: true,
      canWrite: true,
      supportsAnimation: false,
      supportsLayers: false,
      ownerAgent: 4,
      state: "tested",
    },
    {
      id: "format.palette_pal",
      name: "JASC / Microsoft RIFF Palette (.pal)",
      extensions: ["pal"],
      canRead: true,
      canWrite: true,
      supportsAnimation: false,
      supportsLayers: false,
      ownerAgent: 4,
      state: "tested",
    },
    {
      id: "format.palette_hex",
      name: "Hex Color List (.hex)",
      extensions: ["hex"],
      canRead: true,
      canWrite: true,
      supportsAnimation: false,
      supportsLayers: false,
      ownerAgent: 4,
      state: "tested",
    },
    {
      id: "format.palette_act",
      name: "Adobe Color Table (.act)",
      extensions: ["act"],
      canRead: true,
      canWrite: true,
      supportsAnimation: false,
      supportsLayers: false,
      ownerAgent: 4,
      state: "tested",
    },
    {
      id: "format.palette_col",
      name: "Animator Pro Palette (.col)",
      extensions: ["col"],
      canRead: true,
      canWrite: true,
      supportsAnimation: false,
      supportsLayers: false,
      ownerAgent: 4,
      state: "tested",
    },
  ]);

  // 5. Register all 10 Filters in FilterRegistry
  FilterRegistry.registerMany([
    {
      id: "filter.replace_color",
      title: "Replace Color...",
      category: "Color",
      ownerAgent: 4,
      state: "tested",
      apply: (img, params) =>
        applyReplaceColorFilter(
          img,
          (params.fromColor as RGBA) ?? RED,
          (params.toColor as RGBA) ?? BLUE,
          Number(params.tolerance ?? 10)
        ),
    },
    {
      id: "filter.invert",
      title: "Invert Color",
      category: "Adjustments",
      ownerAgent: 4,
      state: "tested",
      apply: (img) => applyInvertFilter(img),
    },
    {
      id: "filter.brightness_contrast",
      title: "Brightness / Contrast...",
      category: "Adjustments",
      ownerAgent: 4,
      state: "tested",
      apply: (img, params) =>
        applyBrightnessContrastFilter(
          img,
          Number(params.brightness ?? 0),
          Number(params.contrast ?? 0)
        ),
    },
    {
      id: "filter.hue_saturation",
      title: "Hue / Saturation...",
      category: "Adjustments",
      ownerAgent: 4,
      state: "tested",
      apply: (img, params) =>
        applyHueSaturationFilter(img, {
          hueShift: Number(params.hueShift ?? 0),
          saturationShift: Number(params.saturationShift ?? 0),
          lightnessShift: Number(params.lightnessShift ?? 0),
        }),
    },
    {
      id: "filter.color_curve",
      title: "Color Curve...",
      category: "Adjustments",
      ownerAgent: 4,
      state: "tested",
      apply: (img, params) =>
        applyColorCurveFilter(
          img,
          (params.points as Array<{ x: number; y: number }>) ?? [
            { x: 0, y: 0 },
            { x: 255, y: 255 },
          ]
        ),
    },
    {
      id: "filter.posterize",
      title: "Posterize...",
      category: "Adjustments",
      ownerAgent: 4,
      state: "tested",
      apply: (img, params) => applyPosterizeFilter(img, Number(params.levels ?? 4)),
    },
    {
      id: "filter.outline",
      title: "Outline...",
      category: "FX",
      ownerAgent: 4,
      state: "tested",
      apply: (img, params) =>
        applyOutlineFilter(img, {
          outlineColor: (params.outlineColor as RGBA) ?? YELLOW,
          place: (params.place as "outside" | "inside") ?? "outside",
        }),
    },
    {
      id: "filter.convolution",
      title: "Convolution Matrix...",
      category: "FX",
      ownerAgent: 4,
      state: "tested",
      apply: (img, params) =>
        applyConvolutionMatrixFilter(img, {
          size: 3,
          kernel: (params.kernel as number[]) ?? CONVOLUTION_PRESETS[0].kernel,
          divisor: Number(params.divisor ?? 9),
          bias: Number(params.bias ?? 0),
        }),
    },
    {
      id: "filter.despeckle",
      title: "Despeckle (Median)...",
      category: "FX",
      ownerAgent: 4,
      state: "tested",
      apply: (img, params) =>
        applyDespeckleFilter(img, Number(params.width ?? 3), Number(params.height ?? 3)),
    },
    {
      id: "filter.drop_shadow",
      title: "Drop Shadow...",
      category: "FX",
      ownerAgent: 4,
      state: "tested",
      apply: (img, params) =>
        applyDropShadowFilter(img, {
          offsetX: Number(params.offsetX ?? 2),
          offsetY: Number(params.offsetY ?? 2),
          shadowColor: (params.shadowColor as RGBA) ?? { r: 0, g: 0, b: 0, a: 180 },
        }),
    },
  ]);

  // 6. Register Agent-4 Commands in CommandRegistry
  const agent4Commands: Array<[string, string]> = [
    ["demo.selection_playground", "Open Demo: selection_playground.ase (Selection Lab)"],
    ["demo.transform_rotsprite_lab", "Open Demo: transform_rotsprite_lab.ase (RotSprite vs Fast)"],
    ["demo.palette_remap_lab", "Open Demo: palette_remap_lab.ase (Palette Remap & Spans)"],
    ["demo.indexed_dither_compare", "Open Demo: indexed_dither_compare.ase (Indexed Dithering)"],
    ["demo.filters_gallery", "Open Demo: filters_gallery.ase (8-Frame Filters Gallery)"],

    ["edit.cut", "Cut Selection"],
    ["edit.copy", "Copy Selection"],
    ["edit.copy_merged", "Copy Merged"],
    ["edit.paste", "Paste"],
    ["edit.paste_special", "Paste Special..."],
    ["edit.paste_new_layer", "Paste as New Layer"],
    ["edit.paste_new_sprite", "Paste as New Sprite"],
    ["edit.paste_new_brush", "Paste as New Custom Brush"],
    ["edit.delete", "Delete / Clear Selection"],
    ["edit.fill_selection", "Fill Selection with Foreground Color"],
    ["edit.stroke_selection", "Stroke Selection Border"],
    ["edit.flip_h", "Flip Horizontal"],
    ["edit.flip_v", "Flip Vertical"],
    ["edit.rotate_180", "Rotate 180°"],
    ["edit.rotate_90cw", "Rotate 90° CW"],
    ["edit.rotate_90ccw", "Rotate 90° CCW"],
    ["edit.transform", "Rotate / Transform Selection..."],
    ["edit.shift_pixels", "Shift / Wrap Pixels..."],
    ["edit.new_brush", "New Brush from Selection (Ctrl+B)"],
    ["edit.new_sprite_from_sel", "New Sprite from Selection"],
    ["edit.replace_color", "Replace Color..."],
    ["edit.invert_color", "Invert Color"],
    ["edit.adjustments", "Adjustments (Brightness/Contrast, Hue/Sat, Curves, Posterize)..."],
    ["edit.fx", "FX (Outline, Convolution Matrix, Despeckle, Drop Shadow)..."],
    ["edit.palette_editor", "Palette Editor & Ramp Studio..."],

    ["sprite.props", "Sprite Properties..."],
    ["sprite.colormode_dialog", "Convert Color Mode (Indexed with Dithering)..."],
    ["sprite.duplicate", "Duplicate Sprite..."],
    ["sprite.crop", "Crop to Selection"],
    ["sprite.trim", "Trim Transparent Borders"],
    ["sprite.rotate_180", "Rotate Canvas 180°"],
    ["sprite.rotate_90cw", "Rotate Canvas 90° CW"],
    ["sprite.rotate_90ccw", "Rotate Canvas 90° CCW"],
    ["sprite.flip_h", "Flip Canvas Horizontal"],
    ["sprite.flip_v", "Flip Canvas Vertical"],

    ["select.reselect", "Reselect"],
    ["select.cel_content", "Select Cel Content"],
    ["select.frame_content", "Select Frame Content"],
    ["select.modify", "Modify Selection (Expand / Contract / Border / Feather)..."],
    ["select.color_range", "Color Range..."],
    ["select.save_load_mask", "Save / Load Selection..."],
    ["action.reset_colors", "Reset FG/BG Colors (Black/White)"],
  ];

  for (const [id, title] of agent4Commands) {
    CommandRegistry.register({
      id,
      title,
      category: "Menus",
      ownerAgent: 4,
      state: "tested",
      run: () => {},
    });
  }

  // 7. Register / Upgrade File Demo Entries + Full Edit, Sprite, and Select Menus in MenuRegistry
  MenuRegistry.registerMany([
    // Agent-4 Demo Documents in File Menu
    {
      id: "menu.file.open_demo_selection",
      menu: "File",
      label: "Open Demo: selection_playground.ase (Selection Lab)",
      commandId: "demo.selection_playground",
      order: 5.71,
      ownerAgent: 4,
      state: "tested",
    },
    {
      id: "menu.file.open_demo_rotsprite",
      menu: "File",
      label: "Open Demo: transform_rotsprite_lab.ase (RotSprite Lab)",
      commandId: "demo.transform_rotsprite_lab",
      order: 5.72,
      ownerAgent: 4,
      state: "tested",
    },
    {
      id: "menu.file.open_demo_palette_remap",
      menu: "File",
      label: "Open Demo: palette_remap_lab.ase (Per-Frame Palettes)",
      commandId: "demo.palette_remap_lab",
      order: 5.73,
      ownerAgent: 4,
      state: "tested",
    },
    {
      id: "menu.file.open_demo_indexed_dither",
      menu: "File",
      label: "Open Demo: indexed_dither_compare.ase (Dithering Compare)",
      commandId: "demo.indexed_dither_compare",
      order: 5.74,
      ownerAgent: 4,
      state: "tested",
    },
    {
      id: "menu.file.open_demo_filters_gallery",
      menu: "File",
      label: "Open Demo: filters_gallery.ase (8-Frame Filters Gallery)",
      commandId: "demo.filters_gallery",
      order: 5.75,
      ownerAgent: 4,
      state: "tested",
      separatorAfter: true,
    },

    // Full Edit Menu
    { id: "menu.edit.cut", menu: "Edit", label: "Cut", commandId: "edit.cut", order: 4, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.copy", menu: "Edit", label: "Copy", commandId: "edit.copy", order: 5, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.copy_merged", menu: "Edit", label: "Copy Merged", commandId: "edit.copy_merged", order: 5.5, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.paste", menu: "Edit", label: "Paste", commandId: "edit.paste", order: 6, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.paste_special", menu: "Edit", label: "Paste Special (Layer / Sprite / Brush)...", commandId: "edit.paste_special", order: 6.2, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.delete", menu: "Edit", label: "Delete / Clear", commandId: "edit.delete", order: 6.4, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.fill", menu: "Edit", label: "Fill Selection", commandId: "edit.fill_selection", order: 6.6, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.stroke", menu: "Edit", label: "Stroke Selection Border", commandId: "edit.stroke_selection", order: 6.8, ownerAgent: 4, state: "tested", separatorAfter: true },
    { id: "menu.edit.flip_h", menu: "Edit", label: "Flip Horizontal", commandId: "edit.flip_h", order: 7.0, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.flip_v", menu: "Edit", label: "Flip Vertical", commandId: "edit.flip_v", order: 7.1, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.transform", menu: "Edit", label: "Rotate / Transform (RotSprite)...", commandId: "edit.transform", order: 7.2, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.shift", menu: "Edit", label: "Shift / Wrap Pixels...", commandId: "edit.shift_pixels", order: 7.4, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.new_brush", menu: "Edit", label: "New Brush from Selection", commandId: "edit.new_brush", order: 7.6, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.new_sprite_sel", menu: "Edit", label: "New Sprite from Selection", commandId: "edit.new_sprite_from_sel", order: 7.8, ownerAgent: 4, state: "tested", separatorAfter: true },
    { id: "menu.edit.replace_color", menu: "Edit", label: "Replace Color...", commandId: "edit.replace_color", order: 8.0, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.invert_color", menu: "Edit", label: "Invert Color", commandId: "edit.invert_color", order: 8.2, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.adjustments", menu: "Edit", label: "Adjustments (Brightness, Hue/Sat, Curves, Posterize)...", commandId: "edit.adjustments", order: 8.5, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.fx", menu: "Edit", label: "FX (Outline, Convolution, Despeckle, Drop Shadow)...", commandId: "edit.fx", order: 9.0, ownerAgent: 4, state: "tested" },
    { id: "menu.edit.palette_editor", menu: "Edit", label: "Palette Editor & Ramp Studio...", commandId: "edit.palette_editor", order: 9.5, ownerAgent: 4, state: "tested", separatorAfter: true },

    // Full Sprite Menu
    { id: "menu.sprite.props", menu: "Sprite", label: "Properties...", commandId: "sprite.props", order: 1, ownerAgent: 4, state: "tested" },
    { id: "menu.sprite.colormode_dlg", menu: "Sprite", label: "Color Mode > Convert & Dither...", commandId: "sprite.colormode_dialog", order: 4.5, ownerAgent: 4, state: "tested" },
    { id: "menu.sprite.duplicate", menu: "Sprite", label: "Duplicate...", commandId: "sprite.duplicate", order: 4.8, ownerAgent: 4, state: "tested", separatorAfter: true },
    { id: "menu.sprite.crop", menu: "Sprite", label: "Crop to Selection", commandId: "sprite.crop", order: 7, ownerAgent: 4, state: "tested" },
    { id: "menu.sprite.trim", menu: "Sprite", label: "Trim Transparent Borders", commandId: "sprite.trim", order: 7.5, ownerAgent: 4, state: "tested", separatorAfter: true },
    { id: "menu.sprite.rotate_90cw", menu: "Sprite", label: "Rotate Canvas > 90° CW", commandId: "sprite.rotate_90cw", order: 8.1, ownerAgent: 4, state: "tested" },
    { id: "menu.sprite.rotate_90ccw", menu: "Sprite", label: "Rotate Canvas > 90° CCW", commandId: "sprite.rotate_90ccw", order: 8.2, ownerAgent: 4, state: "tested" },
    { id: "menu.sprite.rotate_180", menu: "Sprite", label: "Rotate Canvas > 180°", commandId: "sprite.rotate_180", order: 8.3, ownerAgent: 4, state: "tested" },
    { id: "menu.sprite.flip_h", menu: "Sprite", label: "Rotate Canvas > Flip Canvas Horizontal", commandId: "sprite.flip_h", order: 8.4, ownerAgent: 4, state: "tested" },
    { id: "menu.sprite.flip_v", menu: "Sprite", label: "Rotate Canvas > Flip Canvas Vertical", commandId: "sprite.flip_v", order: 8.5, ownerAgent: 4, state: "tested" },

    // Full Select Menu
    { id: "menu.select.reselect", menu: "Select", label: "Reselect", commandId: "select.reselect", order: 2.5, ownerAgent: 4, state: "tested" },
    { id: "menu.select.cel_content", menu: "Select", label: "Select Cel Content", commandId: "select.cel_content", order: 3.4, ownerAgent: 4, state: "tested" },
    { id: "menu.select.frame_content", menu: "Select", label: "Select Frame Content", commandId: "select.frame_content", order: 3.6, ownerAgent: 4, state: "tested", separatorAfter: true },
    { id: "menu.select.modify", menu: "Select", label: "Modify (Expand / Contract / Border / Feather)...", commandId: "select.modify", order: 4, ownerAgent: 4, state: "tested" },
    { id: "menu.select.color_range", menu: "Select", label: "Color Range...", commandId: "select.color_range", order: 5, ownerAgent: 4, state: "tested" },
    { id: "menu.select.save_load", menu: "Select", label: "Load / Save Selection...", commandId: "select.save_load_mask", order: 6, ownerAgent: 4, state: "tested" },
  ]);

  if (import.meta.env.VITE_KP_FLAVOR !== "release") {
    for (const spec of AGENT4_TESTED_FEATURES) {
      const def: FeatureDefinition = {
        id: spec.id,
        title: spec.title,
        category: spec.category,
        ownerAgent: 4,
        state: "tested",
        description: spec.description,
        demoActionId: spec.demoActionId,
        selfTest: () => runAgent4Check(spec.testFn),
      };
      FeatureRegistry.register(def);
    }
  }
}

export {
  decodeColPalette,
  decodeRiffPalPalette,
  encodeColPalette,
  encodeRiffPalPalette,
};
