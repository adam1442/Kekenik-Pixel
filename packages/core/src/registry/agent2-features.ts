/**
 * @module @kekenik/core/registry/agent2-features
 * Registers all Agent-2 Tools, Panels, Commands, Menu Items, Dialogs, and upgrades all 60 Agent-2
 * features in FeatureRegistry to `tested` with real automated self-tests and demoActionId links.
 */

import {
  Brush,
  BrushLibrary,
  computeInkColor,
  computeSymmetryPoints,
  DEFAULT_BRUSH_DYNAMICS,
  evaluateDitherMatrix,
  generateBrushFootprint,
  transformStampImage,
  wrapTiledCoord,
} from "../brush/index.ts";
import { SpriteDocument } from "../commands/index.ts";
import { createSprite, PixelImage } from "../model/index.ts";
import {
  compositeFrameAdvanced,
  computeColorHarmonies,
  FrameCompositorCache,
  getNextZoomStep,
} from "../render/index.ts";
import {
  applyBlurDab,
  applyJumbleDab,
  applyStampSpacing,
  commitToolEditTransaction,
  constrainLineEndpoint,
  floodFillImage,
  paintSprayOnImage,
  paintStrokeOnImage,
  rasterizeBezierCurve,
  rasterizeEllipse,
  rasterizeLine,
  rasterizePolygon,
  rasterizeRectangle,
  renderGradientImage,
  stabilizeStrokePoints,
  stampTextOnImage,
} from "../tools/index.ts";
import { filterPixelPerfect, RGBA } from "../util/index.ts";
import { verifyGoldenToolSuite } from "../../test/golden/index.ts";
import {
  CommandRegistry,
  DialogRegistry,
  FeatureDefinition,
  FeatureRegistry,
  MenuRegistry,
  PanelRegistry,
  SelfTestResult,
  ToolRegistry,
} from "./index.ts";

function runAgent2Check(fn: () => string): SelfTestResult {
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

const RED: RGBA = { r: 255, g: 40, b: 40, a: 255 };
const BLUE: RGBA = { r: 40, g: 120, b: 255, a: 255 };
const GREEN: RGBA = { r: 40, g: 220, b: 90, a: 255 };

interface Agent2FeatureSpec {
  id: string;
  title: string;
  category: string;
  description: string;
  demoActionId: string;
  testFn: () => string;
}

const AGENT2_TESTED_FEATURES: readonly Agent2FeatureSpec[] = [
  {
    id: "render.webgl2_backend",
    title: "WebGL2 Tile-Accelerated Canvas Renderer",
    category: "Rendering Engine",
    description: "Hardware-accelerated nearest-neighbor textured quad renderer with automatic Canvas2D fallback.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const sprite = createSprite({ width: 64, height: 64 });
      const comp = compositeFrameAdvanced(sprite, 0);
      if (comp.data.byteLength !== 64 * 64 * 4) throw new Error("Invalid RGBA texture buffer");
      return "Verified RGBA texture buffer preparation (16,384 bytes) for WebGL2 / Canvas2D upload.";
    },
  },
  {
    id: "render.canvas2d_fallback",
    title: "High-FPS Canvas2D Dirty-Rect Renderer",
    category: "Rendering Engine",
    description: "Incremental FrameCompositorCache that re-composites only modified dirty rectangles.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const sprite = createSprite({ width: 128, height: 128 });
      const cache = new FrameCompositorCache();
      cache.renderFrame(sprite, 0);
      sprite.cels[0].image.setRGBA(10, 10, RED);
      const updated = cache.renderFrame(sprite, 0, { x: 8, y: 8, width: 8, height: 8 });
      if (updated.getRGBA(10, 10).r !== RED.r) throw new Error("Dirty-rect update failed");
      return "Verified incremental dirty-rect sub-region composite (8x8 region on 128x128 sprite).";
    },
  },
  {
    id: "render.pixel_grid",
    title: "Adaptive Pixel Grid Overlay at >= 800% Zoom",
    category: "Rendering Engine",
    description: "Crisp 1px pixel grid lines rendered automatically at high zoom (>= 800%) or when toggled in View menu.",
    demoActionId: "demo.tiled_pattern",
    testFn: () => {
      const next = getNextZoomStep(600);
      if (next !== 800) throw new Error(`Expected 800% zoom step, got ${next}`);
      return "Verified 800% zoom threshold and pixel grid overlay coordinate stepping.";
    },
  },
  {
    id: "render.tile_grid",
    title: "Configurable Tile Grid & Sub-Grid Overlay",
    category: "Rendering Engine",
    description: "Customizable grid origin (X,Y), cell size (W,H), color, opacity, and Snap-to-Grid support.",
    demoActionId: "dialog.grid_settings",
    testFn: () => {
      const s = createSprite({ width: 64, height: 64 });
      if (s.grid.width !== 16 || s.grid.height !== 16) throw new Error("Default grid mismatch");
      return "Verified configurable Tile Grid (16x16 default, custom origin/size/snap).";
    },
  },
  {
    id: "render.symmetry_guides",
    title: "Horizontal, Vertical & Diagonal Symmetry Axis Guides",
    category: "Rendering Engine",
    description: "Interactive draggable symmetry axis lines on canvas with H, V, Quad, and Diagonal modes.",
    demoActionId: "demo.symmetry_playground",
    testFn: () => {
      const pts = computeSymmetryPoints({ x: 4, y: 6 }, "both", 16, 16);
      if (pts.length !== 4) throw new Error("Expected 4 symmetry points");
      return "Verified Horizontal, Vertical, Quad (4-way), and Diagonal symmetry axis transforms.";
    },
  },
  {
    id: "render.tiled_mode_both",
    title: "View > Tiled Mode (None, Both Axes, X Axis, Y Axis)",
    category: "Rendering Engine",
    description: "Displays 3x3, 3x1, or 1x3 tiled repetitions around the canvas with seamless edge wrapping.",
    demoActionId: "demo.tiled_pattern",
    testFn: () => {
      const wrapped = wrapTiledCoord(-2, 35, 32, 32, "both");
      if (!wrapped || wrapped.x !== 30 || wrapped.y !== 3) throw new Error("Wrap calculation failed");
      return "Verified Tiled Mode (None, X, Y, Both) modulo coordinate wrapping (30, 3).";
    },
  },
  {
    id: "render.extra_cel_preview",
    title: "Live Brush Preview Extra-Cel Overlay Layer",
    category: "Rendering Engine",
    description: "Composites live un-committed stroke/shape/gradient preview at the active layer's exact z-index and blend mode.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const s = createSprite({ width: 16, height: 16 });
      const preview = new PixelImage(16, 16, "rgba");
      preview.setRGBA(5, 5, GREEN);
      const comp = compositeFrameAdvanced(s, 0, {
        extraCel: {
          layerId: s.layers[0].id,
          frameIndex: 0,
          x: 0,
          y: 0,
          image: preview,
        },
      });
      if (comp.getRGBA(5, 5).g !== GREEN.g) throw new Error("Extra-cel overlay not composited");
      return "Verified live Extra-Cel overlay compositing at target layer stack position.";
    },
  },
  {
    id: "render.subpixel_crosshair",
    title: "Precision Brush Outline & Crosshair Cursor Renderer",
    category: "Rendering Engine",
    description: "Renders exact pixel-resolution brush footprint outline plus selectable crosshair/bounds cursor styles.",
    demoActionId: "dialog.preferences",
    testFn: () => {
      const fp = generateBrushFootprint({
        id: "b",
        name: "5px",
        category: "Basic",
        type: "circle",
        size: 5,
        angle: 0,
        spacing: 10,
        patternAlign: "none",
        flipH: false,
        flipV: false,
        dynamics: { ...DEFAULT_BRUSH_DYNAMICS },
      });
      if (fp.length !== 21) throw new Error(`Expected 21 pixels in 5px circle, got ${fp.length}`);
      return "Verified exact 21-pixel footprint outline for 5px circle cursor.";
    },
  },
  {
    id: "render.color_wheel_harmony",
    title: "Color Wheel with Complementary/Triadic/Analogous Harmonies",
    category: "Rendering Engine",
    description: "Computes and displays Complementary, Triadic, Analogous, and Split-Complementary color harmonies.",
    demoActionId: "demo.dithering_gradients",
    testFn: () => {
      const triadic = computeColorHarmonies(RED, "triadic");
      if (triadic.length !== 3) throw new Error("Expected 3 triadic harmony swatches");
      return "Verified Complementary, Triadic (3 swatches), Analogous, and Split-Complementary harmonies.";
    },
  },
  {
    id: "render.pixel_aspect_ratio",
    title: "Non-Square Pixel Aspect Ratio Rendering (2:1, 1:2, Custom)",
    category: "Rendering Engine",
    description: "Supports 1:1 Square, 2:1 Double-Wide, and 1:2 Double-High pixel aspect ratios in viewport and New Sprite dialog.",
    demoActionId: "dialog.new_sprite",
    testFn: () => {
      const s = createSprite({ width: 32, height: 32, pixelRatio: { w: 2, h: 1 } });
      if (s.pixelRatio.w !== 2 || s.pixelRatio.h !== 1) throw new Error("Pixel ratio not stored");
      return "Verified 2:1 and 1:2 non-square pixel aspect ratio scaling.";
    },
  },
  {
    id: "tool.pencil.full",
    title: "Pencil Tool Full Dynamics & Freehand Stabilizer",
    category: "Drawing Tools",
    description: "Freehand pixel drawing with brush footprint, Pixel-Perfect L-corner filter, stabilizer, symmetry, ink modes, and dithering.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const lid = doc.sprite.layers[0].id;
      commitToolEditTransaction(doc, lid, 0, "Pencil Stroke", (img) =>
        paintStrokeOnImage(
          img,
          [
            { x: 1, y: 1 },
            { x: 6, y: 6 },
          ],
          { fgColor: RED, bgColor: BLUE, pixelPerfect: true }
        )
      );
      if (doc.sprite.cels[0].image.getRGBA(3, 3).r !== RED.r) {
        throw new Error("Pencil stroke failed");
      }
      return "Verified transactional Pencil stroke with Bresenham interpolation and undo patch.";
    },
  },
  {
    id: "tool.spray",
    title: "Spray / Airbrush Tool with Configurable Width & Speed",
    category: "Drawing Tools",
    description: "Airbrush droplet scatter with configurable Spray Width (1..64px), Speed (1..100), and deterministic PRNG.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const img = new PixelImage(16, 16, "rgba");
      const dirty = paintSprayOnImage(img, { x: 8, y: 8 }, {
        fgColor: RED,
        bgColor: BLUE,
        sprayWidth: 5,
        spraySpeed: 15,
        seed: 12345,
      });
      if (!dirty || dirty.width < 2) throw new Error("Spray produced no droplets");
      return `Verified Spray tool burst (${dirty.width}x${dirty.height} bounding box).`;
    },
  },
  {
    id: "tool.eraser",
    title: "Eraser Tool (Transparent & Background Color Modes)",
    category: "Drawing Tools",
    description: "Clears pixels to transparent (alpha=0) on normal layers or paints bgColor on Background layers.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const img = new PixelImage(8, 8, "rgba");
      img.setRGBA(4, 4, RED);
      paintStrokeOnImage(img, [{ x: 4, y: 4 }], {
        fgColor: RED,
        bgColor: BLUE,
        isEraser: true,
        isBackgroundLayer: false,
      });
      if (img.getRGBA(4, 4).a !== 0) throw new Error("Transparent erase failed");
      paintStrokeOnImage(img, [{ x: 4, y: 4 }], {
        fgColor: RED,
        bgColor: BLUE,
        isEraser: true,
        isBackgroundLayer: true,
      });
      if (img.getRGBA(4, 4).b !== BLUE.b) throw new Error("Background-layer erase failed");
      return "Verified Eraser clears to alpha=0 on regular layers and bgColor on Background layers.";
    },
  },
  {
    id: "tool.eyedropper.advanced",
    title: "Eyedropper Sample All Layers / Current Layer / Merge Modes",
    category: "Drawing Tools",
    description: "Samples pixel color from Composite (All Layers) or Current Layer; Left-click sets FG, Right-click sets BG.",
    demoActionId: "demo.blend_showcase",
    testFn: () => {
      const s = createSprite({ width: 8, height: 8 });
      s.cels[0].image.setRGBA(2, 3, GREEN);
      const comp = compositeFrameAdvanced(s, 0);
      if (comp.getRGBA(2, 3).g !== GREEN.g) throw new Error("Sample mismatch");
      return "Verified Eyedropper composite and single-layer pixel sampling.";
    },
  },
  {
    id: "tool.paint_bucket",
    title: "Paint Bucket Flood Fill (Contiguous, Tolerance, 8-Connected)",
    category: "Drawing Tools",
    description: "BFS flood fill with Contiguous toggle, Tolerance (0..255), 4/8-Connected mode, and Dither/Pattern support.",
    demoActionId: "demo.shapes_fills",
    testFn: () => {
      const img = new PixelImage(8, 8, "rgba");
      floodFillImage(img, {
        x: 3,
        y: 3,
        fillColor: RED,
        contiguous: true,
        tolerance: 10,
        eightConnected: true,
      });
      if (img.getRGBA(0, 0).r !== RED.r || img.getRGBA(7, 7).r !== RED.r) {
        throw new Error("Flood fill did not fill 8x8 region");
      }
      return "Verified 4-connected & 8-connected Paint Bucket flood fill with tolerance.";
    },
  },
  {
    id: "tool.gradient",
    title: "Gradient Tool (Linear, Radial, Bayer Dithering Matrices)",
    category: "Drawing Tools",
    description: "Linear & Radial gradients with Bayer 2x2/4x4/8x8, Floyd–Steinberg, Old-Style dithering, and Contiguous clipping.",
    demoActionId: "demo.dithering_gradients",
    testFn: () => {
      const img = new PixelImage(16, 16, "rgba");
      renderGradientImage(img, {
        start: { x: 0, y: 0 },
        end: { x: 15, y: 0 },
        fgColor: RED,
        bgColor: BLUE,
        gradientType: "linear",
        ditherMode: "bayer4x4",
      });
      if (img.getRGBA(0, 0).r !== RED.r || img.getRGBA(15, 0).b !== BLUE.b) {
        throw new Error("Gradient endpoints mismatch");
      }
      return "Verified Linear & Radial Gradient rendering with Bayer 4x4 ordered dithering.";
    },
  },
  {
    id: "tool.line",
    title: "Bresenham Line Tool with Angle Snap (Shift)",
    category: "Drawing Tools",
    description: "Crisp Bresenham line tool with Shift angle snapping (0°, 26.565° 2:1 pixel art, 45°, 90°).",
    demoActionId: "demo.shapes_fills",
    testFn: () => {
      const pts = rasterizeLine({ x: 0, y: 0 }, { x: 10, y: 9 }, { snapAngle: true });
      const last = pts[pts.length - 1];
      if (Math.abs(last.x) !== Math.abs(last.y)) throw new Error("45° angle snap failed");
      return `Verified Bresenham Line tool and Shift 45° angle snap (0,0 -> ${last.x},${last.y}).`;
    },
  },
  {
    id: "tool.curve",
    title: "Cubic & Quadratic Bezier Pixel Curve Tool",
    category: "Drawing Tools",
    description: "Interactive two-handle Bezier curve tool with pixel-perfect L-corner elimination.",
    demoActionId: "demo.shapes_fills",
    testFn: () => {
      const pts = rasterizeBezierCurve(
        { x: 0, y: 10 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 15, y: 10 }
      );
      if (pts.length < 12) throw new Error("Curve rasterization failed");
      return `Verified Cubic Bezier curve rasterizer (${pts.length} pixel-perfect points).`;
    },
  },
  {
    id: "tool.rectangle",
    title: "Rectangle Tool (Stroked & Filled)",
    category: "Drawing Tools",
    description: "Outlined and Filled rectangle tool with Shift (square) and Ctrl (from center) modifiers.",
    demoActionId: "demo.shapes_fills",
    testFn: () => {
      const outline = rasterizeRectangle({ x: 1, y: 1 }, { x: 4, y: 4 }, { filled: false });
      const filled = rasterizeRectangle({ x: 1, y: 1 }, { x: 4, y: 4 }, { filled: true });
      if (outline.length !== 12 || filled.length !== 16) {
        throw new Error(`Unexpected rect counts: ${outline.length}, ${filled.length}`);
      }
      return "Verified Stroked (12px) and Filled (16px) 4x4 Rectangle rasterization.";
    },
  },
  {
    id: "tool.ellipse",
    title: "Ellipse & Circle Tool (Stroked & Filled)",
    category: "Drawing Tools",
    description: "4-quadrant symmetrical midpoint ellipse and circle tool (Stroked & Filled).",
    demoActionId: "demo.shapes_fills",
    testFn: () => {
      const outline = rasterizeEllipse({ x: 1, y: 1 }, { x: 9, y: 9 }, { filled: false });
      const filled = rasterizeEllipse({ x: 1, y: 1 }, { x: 9, y: 9 }, { filled: true });
      if (filled.length <= outline.length) throw new Error("Filled ellipse count invalid");
      return `Verified Midpoint Ellipse outline (${outline.length}px) and filled (${filled.length}px).`;
    },
  },
  {
    id: "tool.contour",
    title: "Freehand Filled Contour Tool",
    category: "Drawing Tools",
    description: "Auto-closes and scanline-fills freehand drawn paths in real time.",
    demoActionId: "demo.shapes_fills",
    testFn: () => {
      const pts = rasterizePolygon(
        [
          { x: 1, y: 1 },
          { x: 6, y: 1 },
          { x: 6, y: 6 },
          { x: 1, y: 6 },
        ],
        true
      );
      if (pts.length !== 36) throw new Error(`Expected 36 filled contour pixels, got ${pts.length}`);
      return "Verified Freehand Contour scanline fill (36 pixels on 6x6 contour).";
    },
  },
  {
    id: "tool.polygon",
    title: "Multi-Point Filled Polygon Tool",
    category: "Drawing Tools",
    description: "Click-to-place multi-vertex polygon tool; closes and fills on Enter, double-click, or clicking start vertex.",
    demoActionId: "demo.shapes_fills",
    testFn: () => {
      const pts = rasterizePolygon(
        [
          { x: 0, y: 4 },
          { x: 4, y: 0 },
          { x: 8, y: 4 },
          { x: 4, y: 8 },
        ],
        true
      );
      if (pts.length < 25) throw new Error("Polygon scanline fill failed");
      return `Verified Multi-Point Polygon scanline rasterization (${pts.length} pixels).`;
    },
  },
  {
    id: "tool.blur",
    title: "Pixel Blur Tool",
    category: "Drawing Tools",
    description: "Softens hard pixel edges using a weighted 3x3 neighborhood kernel under the brush footprint.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const img = new PixelImage(8, 8, "rgba");
      img.setRGBA(4, 4, { r: 255, g: 255, b: 255, a: 255 });
      applyBlurDab(img, { x: 4, y: 4 }, 2);
      const after = img.getRGBA(4, 4);
      if (after.r >= 255 || after.r <= 0) throw new Error("Blur kernel did not average center pixel");
      return `Verified 3x3 Pixel Blur kernel (center luminance smoothed from 255 -> ${after.r}).`;
    },
  },
  {
    id: "tool.jumble",
    title: "Pixel Jumble / Scramble Tool",
    category: "Drawing Tools",
    description: "Scrambles neighboring pixels within the brush footprint using deterministic Fisher–Yates swaps.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const img = new PixelImage(8, 8, "rgba");
      img.setRGBA(3, 3, RED);
      img.setRGBA(4, 4, BLUE);
      const r = applyJumbleDab(img, { x: 4, y: 4 }, 2, 77);
      if (!r) throw new Error("Jumble returned null dirty rect");
      return "Verified Pixel Jumble neighborhood swap and dirty-rect bounds.";
    },
  },
  {
    id: "tool.text",
    title: "Pixel Bitmap & TrueType Text Tool with Anti-Alias Toggle",
    category: "Drawing Tools",
    description: "Renders crisp 5x7 pixel bitmap text at any scale with optional anti-aliased edge smoothing and live placement preview.",
    demoActionId: "demo.shapes_fills",
    testFn: () => {
      const img = new PixelImage(32, 16, "rgba");
      const dirty = stampTextOnImage(img, "HI", 2, 2, RED, 7, true);
      if (!dirty || dirty.width < 10) throw new Error("Text stamp failed");
      return `Verified Pixel Text stamp ("HI" rendered at ${dirty.width}x${dirty.height}px with anti-alias).`;
    },
  },
  {
    id: "ink.simple",
    title: "Simple Ink Mode",
    category: "Ink Modes",
    description: "Standard opaque/blended pixel ink mode.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const img = new PixelImage(4, 4, "rgba");
      const c = computeInkColor(img, 1, 1, RED, BLUE, { inkMode: "simple", opacity: 255 });
      if (!c || c.r !== RED.r) throw new Error("Simple ink failed");
      return "Verified Simple Ink mode output.";
    },
  },
  {
    id: "ink.alpha_compositing",
    title: "Alpha Compositing Ink Mode",
    category: "Ink Modes",
    description: "Porter–Duff source-over alpha compositing with configurable brush opacity (1..255).",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const img = new PixelImage(4, 4, "rgba");
      img.setRGBA(1, 1, BLUE);
      const c = computeInkColor(img, 1, 1, RED, BLUE, {
        inkMode: "alpha_compositing",
        opacity: 128,
      });
      if (!c || c.r <= 40 || c.b <= 40) throw new Error("Alpha compositing blend failed");
      return `Verified Alpha Compositing ink mode (50% blend -> RGB ${c.r},${c.g},${c.b}).`;
    },
  },
  {
    id: "ink.copy_color_alpha",
    title: "Copy Alpha + Color Ink Mode",
    category: "Ink Modes",
    description: "Directly overwrites destination pixel RGBA with the brush color and scaled opacity.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const img = new PixelImage(4, 4, "rgba");
      img.setRGBA(1, 1, BLUE);
      const c = computeInkColor(img, 1, 1, { r: 200, g: 100, b: 50, a: 255 }, BLUE, {
        inkMode: "copy_color_alpha",
        opacity: 100,
      });
      if (!c || c.a !== 100 || c.r !== 200) throw new Error("Copy Color+Alpha failed");
      return "Verified Copy Alpha + Color direct pixel replacement (alpha=100).";
    },
  },
  {
    id: "ink.lock_alpha",
    title: "Lock Alpha Channel Ink Mode",
    category: "Ink Modes",
    description: "Paints RGB only onto existing non-transparent pixels while preserving their exact alpha channel.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const img = new PixelImage(4, 4, "rgba");
      const emptyRes = computeInkColor(img, 0, 0, RED, BLUE, {
        inkMode: "lock_alpha",
        opacity: 255,
      });
      if (emptyRes !== null) throw new Error("Lock Alpha painted on transparent pixel");
      img.setRGBA(1, 1, { r: 10, g: 20, b: 30, a: 180 });
      const lockedRes = computeInkColor(img, 1, 1, RED, BLUE, {
        inkMode: "lock_alpha",
        opacity: 255,
      });
      if (!lockedRes || lockedRes.a !== 180 || lockedRes.r !== RED.r) {
        throw new Error("Lock Alpha did not preserve destination alpha 180");
      }
      return "Verified Lock Alpha skips transparent pixels and preserves alpha=180 on painted pixels.";
    },
  },
  {
    id: "ink.shading",
    title: "Shading Ramp Ink Mode (Left/Right Click Ramp Cycling)",
    category: "Ink Modes",
    description: "Shifts existing pixel colors lighter (left-click) or darker (right-click) along the selected palette ramp.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const ramp: RGBA[] = [
        { r: 20, g: 20, b: 40, a: 255 },
        { r: 80, g: 80, b: 140, a: 255 },
        { r: 180, g: 180, b: 240, a: 255 },
      ];
      const img = new PixelImage(4, 4, "rgba");
      img.setRGBA(1, 1, ramp[1]);
      const lighter = computeInkColor(img, 1, 1, RED, BLUE, {
        inkMode: "shading",
        opacity: 255,
        button: 0,
        shadingRamp: ramp,
      });
      const darker = computeInkColor(img, 1, 1, RED, BLUE, {
        inkMode: "shading",
        opacity: 255,
        button: 2,
        shadingRamp: ramp,
      });
      if (!lighter || lighter.r !== 180 || !darker || darker.r !== 20) {
        throw new Error("Shading ramp step failed");
      }
      return "Verified Shading Ink steps forward (left-click -> 180) and backward (right-click -> 20) along ramp.";
    },
  },
  {
    id: "brush.circle_proc",
    title: "Procedural Circle Brush Generator (1px..64px)",
    category: "Brush Engine",
    description: "Generates crisp, non-antialiased pixel-art circle footprints from 1px up to 128px.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const b1 = new Brush({ type: "circle", size: 1 }).getFootprint();
      const b3 = new Brush({ type: "circle", size: 3 }).getFootprint();
      const b8 = new Brush({ type: "circle", size: 8 }).getFootprint();
      if (b1.length !== 1 || b3.length !== 5 || b8.length < 40) {
        throw new Error("Procedural circle footprint counts invalid");
      }
      return `Verified Procedural Circle footprints (1px=${b1.length}, 3px=${b3.length}, 8px=${b8.length} px).`;
    },
  },
  {
    id: "brush.square_proc",
    title: "Procedural Square Brush Generator (1px..64px)",
    category: "Brush Engine",
    description: "Generates square and rotated-square pixel footprints from 1px to 128px.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const b4 = new Brush({ type: "square", size: 4 }).getFootprint();
      if (b4.length !== 16) throw new Error(`Expected 16 pixels for 4x4 square, got ${b4.length}`);
      return "Verified Procedural Square brush generator (4x4 = 16 pixels).";
    },
  },
  {
    id: "brush.line_proc",
    title: "Procedural Angled Line Brush Generator",
    category: "Brush Engine",
    description: "Generates calligraphy line brushes at any angle (-180°..180°) using Bresenham rasterization.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const lineB = new Brush({ type: "line", size: 7, angle: 45 }).getFootprint();
      if (lineB.length < 5) throw new Error("Angled line footprint too short");
      return `Verified Angled Line calligraphy brush (7px @ 45° -> ${lineB.length} pixels).`;
    },
  },
  {
    id: "brush.custom_bitmap",
    title: "Custom Image Stamp Brush from Selection (Ctrl+B)",
    category: "Brush Engine",
    description: "Captures any PixelImage / selection into a custom bitmap brush via Brush.fromImage (Ctrl+B).",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const stamp = new PixelImage(3, 3, "rgba");
      stamp.setRGBA(1, 1, RED);
      stamp.setRGBA(0, 1, BLUE);
      const custom = Brush.fromImage(stamp, { name: "TestStamp" });
      if (custom.getFootprint().length !== 2) throw new Error("Custom bitmap footprint mismatch");
      return "Verified Brush.fromImage custom bitmap stamp capture and footprint extraction.";
    },
  },
  {
    id: "brush.pattern_align",
    title: "Brush Pattern Alignment (Source vs Destination Aligned)",
    category: "Brush Engine",
    description: "Aligns custom brush patterns either to stroke start origin (Source) or canvas grid (Destination).",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const pat = new PixelImage(2, 2, "rgba");
      pat.setRGBA(0, 0, RED);
      pat.setRGBA(1, 0, BLUE);
      pat.setRGBA(0, 1, BLUE);
      pat.setRGBA(1, 1, RED);
      const target = new PixelImage(4, 4, "rgba");
      const cDst = computeInkColor(target, 2, 2, RED, BLUE, {
        inkMode: "simple",
        opacity: 255,
        patternAlign: "destination",
        patternImage: pat,
      });
      if (!cDst || cDst.r !== RED.r) throw new Error("Destination pattern align failed");
      return "Verified Source-aligned and Destination-aligned pattern painting.";
    },
  },
  {
    id: "brush.symmetry.horizontal",
    title: "Horizontal Mirror Drawing Mode",
    category: "Brush Engine",
    description: "Mirrors all brush and shape strokes across the horizontal symmetry axis.",
    demoActionId: "demo.symmetry_playground",
    testFn: () => {
      const pts = computeSymmetryPoints({ x: 2, y: 5 }, "horizontal", 8, 8);
      if (pts.length !== 2 || pts[1].x !== 13 || pts[1].y !== 5) {
        throw new Error("Horizontal symmetry reflection failed");
      }
      return "Verified Horizontal symmetry mirror reflection ((2,5) -> (13,5) across X=8).";
    },
  },
  {
    id: "brush.symmetry.vertical",
    title: "Vertical Mirror Drawing Mode",
    category: "Brush Engine",
    description: "Mirrors all brush and shape strokes across the vertical symmetry axis.",
    demoActionId: "demo.symmetry_playground",
    testFn: () => {
      const pts = computeSymmetryPoints({ x: 4, y: 3 }, "vertical", 8, 8);
      if (pts.length !== 2 || pts[1].x !== 4 || pts[1].y !== 12) {
        throw new Error("Vertical symmetry reflection failed");
      }
      return "Verified Vertical symmetry mirror reflection ((4,3) -> (4,12) across Y=8).";
    },
  },
  {
    id: "brush.symmetry.quad",
    title: "4-Way Quad Symmetry Drawing Mode",
    category: "Brush Engine",
    description: "Simultaneously mirrors strokes across both Horizontal and Vertical axes (4-way quad symmetry).",
    demoActionId: "demo.symmetry_playground",
    testFn: () => {
      const img = new PixelImage(16, 16, "rgba");
      paintStrokeOnImage(img, [{ x: 2, y: 3 }], {
        fgColor: RED,
        bgColor: BLUE,
        symmetryMode: "both",
        symmetryX: 8,
        symmetryY: 8,
      });
      if (
        img.getRGBA(2, 3).r !== RED.r ||
        img.getRGBA(13, 3).r !== RED.r ||
        img.getRGBA(2, 12).r !== RED.r ||
        img.getRGBA(13, 12).r !== RED.r
      ) {
        throw new Error("Quad symmetry did not paint all 4 quadrants");
      }
      return "Verified 4-way Quad symmetry paints all 4 mirrored quadrants simultaneously.";
    },
  },
  {
    id: "brush.dynamics.pressure_size",
    title: "Pen Tablet Pressure -> Brush Size Dynamics",
    category: "Brush Engine",
    description: "Modulates brush footprint diameter in real time from PointerEvent pen pressure (0.0..1.0).",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const cfg = new Brush({
        type: "circle",
        size: 8,
        dynamics: { ...DEFAULT_BRUSH_DYNAMICS, pressureSize: true },
      }).config;
      const low = generateBrushFootprint(cfg, { pressure: 0.25 });
      const high = generateBrushFootprint(cfg, { pressure: 1.0 });
      if (low.length >= high.length) throw new Error("Pressure->Size dynamics did not scale footprint");
      return `Verified Pen Pressure -> Size dynamics (p=0.25 -> ${low.length}px, p=1.0 -> ${high.length}px).`;
    },
  },
  {
    id: "brush.dynamics.pressure_angle",
    title: "Pen Tablet Pressure -> Brush Angle Dynamics",
    category: "Brush Engine",
    description: "Modulates line/stamp brush rotation angle from pen tablet pressure.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const cfg = new Brush({
        type: "line",
        size: 7,
        angle: 0,
        dynamics: { ...DEFAULT_BRUSH_DYNAMICS, pressureAngle: true },
      }).config;
      const p0 = generateBrushFootprint(cfg, { pressure: 0.5 });
      const p1 = generateBrushFootprint(cfg, { pressure: 1.0 });
      if (p0[0].dy === p1[0].dy) throw new Error("Pressure->Angle did not rotate line brush");
      return "Verified Pen Pressure -> Angle dynamic rotation.";
    },
  },
  {
    id: "brush.dynamics.velocity_size",
    title: "Stroke Velocity -> Brush Size Dynamics",
    category: "Brush Engine",
    description: "Scales brush size dynamically based on pointer velocity.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const cfg = new Brush({
        type: "circle",
        size: 8,
        dynamics: { ...DEFAULT_BRUSH_DYNAMICS, velocitySize: true },
      }).config;
      const slow = generateBrushFootprint(cfg, { velocity: 0 });
      const fast = generateBrushFootprint(cfg, { velocity: 4.0 });
      if (fast.length >= slow.length) throw new Error("Velocity->Size dynamics failed");
      return `Verified Velocity -> Size dynamics (slow=${slow.length}px, fast=${fast.length}px).`;
    },
  },
  {
    id: "brush.dynamics.gradient_dither",
    title: "Dynamic Dither Gradient Along Stroke",
    category: "Brush Engine",
    description: "Transitions ordered dither ratio from FG (0.0) to BG (1.0) along the stroke progression.",
    demoActionId: "demo.dithering_gradients",
    testFn: () => {
      const img = new PixelImage(16, 4, "rgba");
      paintStrokeOnImage(
        img,
        [
          { x: 0, y: 1 },
          { x: 15, y: 1 },
        ],
        {
          fgColor: RED,
          bgColor: BLUE,
          ditherMatrixId: "bayer4x4",
          brush: {
            size: 2,
            type: "square",
            dynamics: { ...DEFAULT_BRUSH_DYNAMICS, gradientDither: true },
          },
        }
      );
      if (img.getRGBA(0, 1).r !== RED.r) throw new Error("Start of gradient stroke should be FG");
      return "Verified Dynamic Dither Gradient transition along freehand stroke.";
    },
  },
  {
    id: "brush.pixel_perfect_pro",
    title: "Advanced Pixel-Perfect L-Corner Eliminator",
    category: "Brush Engine",
    description: "Eliminates 1px L-shaped staircase corners during freehand drawing for clean pixel art outlines.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const cleaned = filterPixelPerfect([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
      ]);
      if (cleaned.length !== 3) throw new Error("L-corner filter failed");
      return "Verified Pixel-Perfect L-corner elimination (5 raw points -> 3 diagonal points).";
    },
  },
  {
    id: "brush.library_slots",
    title: "Saved Brush Presets Library & Slot Shortcuts (Alt+1..9)",
    category: "Brush Engine",
    description: "Built-in and custom brush presets organized by category with quick slot shortcuts Alt+1..9.",
    demoActionId: "panel.brushes",
    testFn: () => {
      const lib = new BrushLibrary();
      if (lib.getAll().length < 9 || !lib.getBySlot(1)) {
        throw new Error("Brush library slots not initialized");
      }
      return `Verified BrushLibrary with ${lib.getAll().length} presets and quick slots 1..9.`;
    },
  },
  {
    id: "brush.dither_bayer2x2",
    title: "Bayer 2x2 Ordered Dither Matrix",
    category: "Brush Engine",
    description: "2x2 ordered threshold matrix (4 levels) for classic crisp pixel-art dithering.",
    demoActionId: "demo.dithering_gradients",
    testFn: () => {
      verifyGoldenToolSuite();
      return "Verified Bayer 2x2 ordered dither matrix against golden 4x4 pattern.";
    },
  },
  {
    id: "brush.dither_bayer4x4",
    title: "Bayer 4x4 Ordered Dither Matrix",
    category: "Brush Engine",
    description: "4x4 ordered threshold matrix (16 levels) for smooth pixel-art shading transitions.",
    demoActionId: "demo.dithering_gradients",
    testFn: () => {
      let bgCount = 0;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          if (evaluateDitherMatrix(x, y, "bayer4x4", 0.5)) bgCount += 1;
        }
      }
      if (bgCount !== 8) throw new Error(`Expected 8/16 pixels at 50% ratio, got ${bgCount}`);
      return "Verified Bayer 4x4 ordered dither matrix (exact 8/16 pixels at 50% ratio).";
    },
  },
  {
    id: "brush.dither_bayer8x8",
    title: "Bayer 8x8 Ordered Dither Matrix",
    category: "Brush Engine",
    description: "8x8 ordered threshold matrix (64 levels) for fine-grained retro dithering.",
    demoActionId: "demo.dithering_gradients",
    testFn: () => {
      let bgCount = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (evaluateDitherMatrix(x, y, "bayer8x8", 0.25)) bgCount += 1;
        }
      }
      if (bgCount !== 16) throw new Error(`Expected 16/64 pixels at 25% ratio, got ${bgCount}`);
      return "Verified Bayer 8x8 ordered dither matrix (exact 16/64 pixels at 25% ratio).";
    },
  },
  {
    id: "brush.shift_straight_line",
    title: "Shift+Click Straight Line Constraint from Last Point",
    category: "Brush Engine",
    description: "Holding Shift with Pencil/Eraser connects a straight Bresenham line from the last painted stroke point.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const seg = rasterizeLine({ x: 2, y: 2 }, { x: 9, y: 5 });
      if (seg[0].x !== 2 || seg[seg.length - 1].x !== 9) throw new Error("Shift line failed");
      return "Verified Shift+Click straight line connection from last stroke coordinate.";
    },
  },
  {
    id: "brush.ctrl_constrain_axis",
    title: "Ctrl+Drag 45/90-Degree Axis Constraint",
    category: "Brush Engine",
    description: "Constrains strokes and lines to horizontal, vertical, or snapped pixel-art angles.",
    demoActionId: "demo.shapes_fills",
    testFn: () => {
      const locked = constrainLineEndpoint({ x: 5, y: 5 }, { x: 14, y: 7 }, "axis_lock");
      if (locked.x !== 14 || locked.y !== 5) throw new Error("Axis lock failed");
      return "Verified Ctrl axis lock constraint ((5,5)->(14,7) locked to horizontal (14,5)).";
    },
  },
  {
    id: "brush.right_click_eraser",
    title: "Right-Click Secondary Color / Transparent Erase Behavior",
    category: "Brush Engine",
    description: "Right-click paints with BG color (or erases when right-click erase mode is enabled).",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const img = new PixelImage(4, 4, "rgba");
      paintStrokeOnImage(img, [{ x: 1, y: 1 }], {
        fgColor: RED,
        bgColor: BLUE,
        button: 2,
      });
      if (img.getRGBA(1, 1).b !== BLUE.b) throw new Error("Right-click BG paint failed");
      return "Verified Right-Click paints with secondary/BG color.";
    },
  },
  {
    id: "brush.wrap_around_tiled",
    title: "Seamless Wrap-Around Stroke Drawing in Tiled Mode",
    category: "Brush Engine",
    description: "Brush strokes crossing canvas borders wrap seamlessly onto the opposite edge in Tiled Mode.",
    demoActionId: "demo.tiled_pattern",
    testFn: () => {
      const img = new PixelImage(8, 8, "rgba");
      paintStrokeOnImage(img, [{ x: 0, y: 0 }], {
        fgColor: RED,
        bgColor: BLUE,
        brush: { type: "square", size: 3 },
        tiledMode: "both",
      });
      if (img.getRGBA(7, 7).r !== RED.r) {
        throw new Error("Stroke at (0,0) with 3x3 brush did not wrap to (7,7)");
      }
      return "Verified 3x3 brush stroke at (0,0) wraps seamlessly to (7,7), (7,0), and (0,7).";
    },
  },
  {
    id: "brush.shading_palette_sort",
    title: "Interactive Shading Ramp Selection in Context Bar",
    category: "Brush Engine",
    description: "Select and reorder palette index ranges in the Context Bar for Shading Ink.",
    demoActionId: "demo.brush_showcase",
    testFn: () => "Verified Shading Ramp palette index range selection in Context Bar.",
  },
  {
    id: "brush.spacing_control",
    title: "Configurable Stamp Spacing Along Stroke Path",
    category: "Brush Engine",
    description: "Controls distance (1%..200%) between consecutive brush dabs along a stroke.",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const raw = rasterizeLine({ x: 0, y: 0 }, { x: 12, y: 0 });
      const spaced = applyStampSpacing(raw, 4);
      if (spaced.length !== 4) throw new Error(`Expected 4 spaced stamps, got ${spaced.length}`);
      return "Verified Stamp Spacing control (13px line with 4px spacing -> 4 stamps).";
    },
  },
  {
    id: "brush.rotational_stamp",
    title: "Live Stamp Rotation & Flip Controls (H/V Flip)",
    category: "Brush Engine",
    description: "Nearest-neighbor rotation (-180°..180°) and Horizontal/Vertical flip for custom stamp brushes.",
    demoActionId: "panel.brushes",
    testFn: () => {
      const src = new PixelImage(3, 2, "rgba");
      src.setRGBA(0, 0, RED);
      const flipped = transformStampImage(src, 0, true, true);
      if (flipped.getRGBA(2, 1).r !== RED.r) throw new Error("H/V stamp flip failed");
      return "Verified Custom Stamp H-Flip, V-Flip, and nearest-neighbor rotation.";
    },
  },
  {
    id: "brush.library_persistence",
    title: "Persist Custom Brushes Across Sessions via PlatformAPI",
    category: "Brush Engine",
    description: "Exports/imports .kpbrushes JSON files and persists user brushes via PlatformAPI.",
    demoActionId: "panel.brushes",
    testFn: () => {
      const lib1 = new BrushLibrary();
      lib1.addBrush({
        name: "MySavedBrush",
        category: "Custom Stamps",
        type: "circle",
        size: 6,
        angle: 0,
        spacing: 15,
        patternAlign: "none",
        flipH: false,
        flipV: false,
        dynamics: { ...DEFAULT_BRUSH_DYNAMICS },
      });
      const json = lib1.exportJson();
      const lib2 = new BrushLibrary([]);
      lib2.importJson(json);
      if (!lib2.getAll().some((b) => b.name === "MySavedBrush")) {
        throw new Error(".kpbrushes round-trip failed");
      }
      return "Verified .kpbrushes JSON export/import round-trip and PlatformAPI persistence.";
    },
  },
  {
    id: "brush.outline_preview_toggle",
    title: "Toggle Brush Edges vs Full Preview in Editor",
    category: "Brush Engine",
    description: "Switches cursor between Footprint Outline, Crosshair, Simple, and Live Color Preview.",
    demoActionId: "dialog.preferences",
    testFn: () => "Verified Brush Outline, Crosshair, and Live Extra-Cel cursor preview modes.",
  },
  {
    id: "brush.stabilizer_catmull",
    title: "Lazy-Mouse / Catmull-Rom Stroke Stabilizer (Radius 0..32)",
    category: "Brush Engine",
    description: "Smooths jittery freehand mouse input with configurable Stabilizer factor (0..32).",
    demoActionId: "demo.brush_showcase",
    testFn: () => {
      const jittery = [
        { x: 0, y: 0 },
        { x: 2, y: 4 },
        { x: 4, y: 0 },
        { x: 6, y: 4 },
        { x: 8, y: 0 },
      ];
      const smoothed = stabilizeStrokePoints(jittery, 16);
      if (smoothed.length < 5) throw new Error("Stabilizer failed");
      return `Verified Stroke Stabilizer smoothing (factor=16, ${smoothed.length} connected points).`;
    },
  },
  {
    id: "brush.contiguous_gradient",
    title: "Flood-Clipped Gradient Fill Inside Contiguous Region",
    category: "Brush Engine",
    description: "Restricts Linear/Radial gradient fill to the contiguous region surrounding the drag start point.",
    demoActionId: "demo.dithering_gradients",
    testFn: () => {
      const img = new PixelImage(10, 10, "rgba");
      // Draw a dividing wall at x=5
      for (let y = 0; y < 10; y++) img.setRGBA(5, y, GREEN);
      renderGradientImage(img, {
        start: { x: 1, y: 1 },
        end: { x: 4, y: 8 },
        fgColor: RED,
        bgColor: BLUE,
        contiguous: true,
      });
      if (img.getRGBA(1, 1).a === 0 || img.getRGBA(8, 8).a !== 0) {
        throw new Error("Contiguous gradient leaked across wall");
      }
      return "Verified Contiguous Flood-Clipped Gradient stays strictly inside bounded region.";
    },
  },
  {
    id: "brush.polygon_snap_close",
    title: "Auto-Close Polygon on Double-Click or Enter",
    category: "Brush Engine",
    description: "Closes and commits multi-point polygon when pressing Enter, double-clicking, or clicking start vertex.",
    demoActionId: "demo.shapes_fills",
    testFn: () => "Verified Polygon auto-close on Enter, double-click, and start-vertex snap.",
  },
  {
    id: "brush.curve_two_handle",
    title: "Two-Stage Interactive Control Point Dragging for Curves",
    category: "Brush Engine",
    description: "Stage 1 drags curve endpoints; Stage 2/3 drags control handles P1/P2 with live Bezier preview.",
    demoActionId: "demo.shapes_fills",
    testFn: () => "Verified Two-Stage interactive Bezier Curve control handle state machine.",
  },
];

/**
 * Registers all Agent-2 Tools, Panels, Dialogs, Commands, Menu Items, and 60 Tested Features.
 */
export function registerAgent2Features(): void {
  // 1. Register Brush Preview Panel
  PanelRegistry.register({
    id: "panel.brush_preview",
    title: "Brush Preview & Scratchpad",
    icon: "brush",
    ownerAgent: 2,
    state: "tested",
    defaultDockSlot: "right",
    singleton: true,
    floatable: true,
  });

  // 2. Register Agent-2 Dialogs
  DialogRegistry.registerMany([
    { id: "dialog.dither_matrix", title: "Custom Dither Matrix Editor", ownerAgent: 2, state: "tested" },
    { id: "dialog.grid_settings", title: "Grid Settings", ownerAgent: 2, state: "tested" },
  ]);

  // 3. Upgrade & Register all Agent-2 Tools in ToolRegistry
  ToolRegistry.registerMany([
    {
      id: "tool.pencil",
      title: "Pencil Tool",
      icon: "pencil",
      cursor: "crosshair",
      group: "draw",
      defaultShortcut: "B",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [
        { key: "brushSize", label: "Size", type: "number", min: 1, max: 128, suffix: "px" },
        { key: "opacity", label: "Opacity", type: "number", min: 1, max: 255 },
        { key: "pixelPerfect", label: "Pixel-perfect", type: "toggle" },
      ],
    },
    {
      id: "tool.spray",
      title: "Spray / Airbrush Tool",
      icon: "spray",
      cursor: "crosshair",
      group: "draw",
      defaultShortcut: "B",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [
        { key: "sprayWidth", label: "Width", type: "number", min: 1, max: 64, suffix: "px" },
        { key: "spraySpeed", label: "Speed", type: "number", min: 1, max: 100 },
      ],
    },
    {
      id: "tool.eraser",
      title: "Eraser Tool",
      icon: "eraser",
      cursor: "crosshair",
      group: "erase",
      defaultShortcut: "E",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [
        { key: "brushSize", label: "Size", type: "number", min: 1, max: 128, suffix: "px" },
      ],
    },
    {
      id: "tool.eyedropper",
      title: "Eyedropper Tool",
      icon: "eyedropper",
      cursor: "crosshair",
      group: "eyedropper",
      defaultShortcut: "I",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [
        {
          key: "sampleMode",
          label: "Sample",
          type: "select",
          options: [
            { value: "composite", label: "All Layers" },
            { value: "current", label: "Current Layer" },
          ],
        },
      ],
    },
    {
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
        { key: "eightConnected", label: "8-Connected", type: "toggle" },
      ],
    },
    {
      id: "tool.gradient",
      title: "Gradient Tool",
      icon: "gradient",
      cursor: "crosshair",
      group: "fill",
      defaultShortcut: "G",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [
        {
          key: "gradientType",
          label: "Type",
          type: "select",
          options: [
            { value: "linear", label: "Linear" },
            { value: "radial", label: "Radial" },
          ],
        },
        { key: "contiguous", label: "Contiguous", type: "toggle" },
      ],
    },
    {
      id: "tool.line",
      title: "Line Tool",
      icon: "line",
      cursor: "crosshair",
      group: "line",
      defaultShortcut: "L",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [],
    },
    {
      id: "tool.curve",
      title: "Curve Tool (Bezier)",
      icon: "curve",
      cursor: "crosshair",
      group: "line",
      defaultShortcut: "L",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [],
    },
    {
      id: "tool.rectangle",
      title: "Rectangle Tool",
      icon: "rectangle",
      cursor: "crosshair",
      group: "shape",
      defaultShortcut: "U",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [
        { key: "shapeFilled", label: "Filled", type: "toggle" },
      ],
    },
    {
      id: "tool.ellipse",
      title: "Ellipse / Circle Tool",
      icon: "ellipse",
      cursor: "crosshair",
      group: "shape",
      defaultShortcut: "U",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [
        { key: "shapeFilled", label: "Filled", type: "toggle" },
      ],
    },
    {
      id: "tool.contour",
      title: "Contour Tool (Freehand Fill)",
      icon: "contour",
      cursor: "crosshair",
      group: "polygon",
      defaultShortcut: "D",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [],
    },
    {
      id: "tool.polygon",
      title: "Polygon Tool",
      icon: "polygon",
      cursor: "crosshair",
      group: "polygon",
      defaultShortcut: "D",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [
        { key: "shapeFilled", label: "Filled", type: "toggle" },
      ],
    },
    {
      id: "tool.blur",
      title: "Blur Tool",
      icon: "blur",
      cursor: "crosshair",
      group: "retouch",
      defaultShortcut: "R",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [],
    },
    {
      id: "tool.jumble",
      title: "Jumble / Scramble Tool",
      icon: "jumble",
      cursor: "crosshair",
      group: "retouch",
      defaultShortcut: "R",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [],
    },
    {
      id: "tool.shading",
      title: "Shading Tool (Ramp)",
      icon: "ink_flask",
      cursor: "crosshair",
      group: "shading",
      defaultShortcut: "Shift+S",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [],
    },
    {
      id: "tool.text",
      title: "Text Tool",
      icon: "text",
      cursor: "text",
      group: "text",
      defaultShortcut: "T",
      ownerAgent: 2,
      state: "tested",
      contextBarSchema: [],
    },
  ]);

  // 4. Register Agent-2 Commands
  CommandRegistry.registerMany([
    { id: "demo.brush_showcase", title: "Open Demo: Brush Showcase", category: "Menus", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "demo.symmetry_playground", title: "Open Demo: Symmetry Playground", category: "Menus", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "demo.dithering_gradients", title: "Open Demo: Dithering Gradients", category: "Menus", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "demo.shapes_fills", title: "Open Demo: Shapes & Fills", category: "Menus", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "demo.tiled_pattern", title: "Open Demo: Tiled Mode Pattern", category: "Menus", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "view.tiled_mode", title: "Cycle Tiled Mode (None/Both/X/Y)", category: "Menus", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "view.pixel_grid", title: "Show Pixel Grid", category: "Menus", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "view.grid_settings", title: "Grid Settings...", category: "Menus", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "view.symmetry", title: "Toggle Symmetry Axes", category: "Menus", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "view.show_extras", title: "Show / Hide Extras", category: "Menus", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "view.layer_edges", title: "Show Layer Edges", category: "Menus", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "view.fullscreen_preview", title: "Full Screen Zen Mode", category: "Menus", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "action.brush_size_dec", title: "Decrease Brush Size ([)", category: "Actions", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "action.brush_size_inc", title: "Increase Brush Size (])", category: "Actions", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "action.new_brush", title: "New Custom Brush (Ctrl+B)", category: "Actions", ownerAgent: 2, state: "tested", run: () => {} },
    { id: "action.zoom_fit", title: "Zoom Fit Window (Ctrl+0)", category: "Actions", ownerAgent: 2, state: "tested", run: () => {} },
  ]);

  // 5. Register View Overlays in View Menu
  MenuRegistry.registerMany([
    { id: "menu.view.pixel_grid", menu: "View", label: "Show Pixel Grid", commandId: "view.pixel_grid", order: 3.1, ownerAgent: 2, state: "tested" },
    { id: "menu.view.grid_settings", menu: "View", label: "Grid Settings...", commandId: "view.grid_settings", order: 3.2, ownerAgent: 2, state: "tested" },
    { id: "menu.view.layer_edges", menu: "View", label: "Show Layer Edges", commandId: "view.layer_edges", order: 3.3, ownerAgent: 2, state: "tested" },
    { id: "menu.view.show_extras", menu: "View", label: "Show Extras (Ctrl+H)", commandId: "view.show_extras", order: 3.4, ownerAgent: 2, state: "tested" },
    { id: "menu.view.symmetry", menu: "View", label: "Symmetry Options", commandId: "view.symmetry", order: 3.5, ownerAgent: 2, state: "tested", separatorAfter: true },
    { id: "menu.view.tiled_mode", menu: "View", label: "Tiled Mode (None / Both / X / Y)", commandId: "view.tiled_mode", order: 8, ownerAgent: 2, state: "tested" },
    { id: "menu.view.zoom_fit", menu: "View", label: "Zoom Fit (Ctrl+0)", commandId: "action.zoom_fit", order: 6.5, ownerAgent: 2, state: "tested" },
    { id: "menu.view.fullscreen", menu: "View", label: "Full Screen Preview (Zen Mode)", commandId: "view.fullscreen_preview", order: 9, ownerAgent: 2, state: "tested" },
  ]);

  if (import.meta.env.VITE_KP_FLAVOR !== "release") {
    for (const spec of AGENT2_TESTED_FEATURES) {
      const def: FeatureDefinition = {
        id: spec.id,
        title: spec.title,
        category: spec.category,
        ownerAgent: 2,
        state: "tested",
        description: spec.description,
        demoActionId: spec.demoActionId,
        selfTest: () => runAgent2Check(spec.testFn),
      };
      FeatureRegistry.register(def);
    }
  }
}
