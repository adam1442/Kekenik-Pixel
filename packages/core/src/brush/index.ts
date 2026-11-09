/**
 * @module @kekenik/core/brush
 * Pure TypeScript Brush Engine, Dithering Matrices, Ink Modes, Symmetry, Tiled Wrap-Around,
 * and Brush Library persistence (zero DOM, React, or Electron imports).
 */

import { blendRGBA, createModelId, PixelImage } from "../model/index.ts";
import { bresenhamLine, clamp, Point, RGBA } from "../util/index.ts";

export type BrushType = "circle" | "square" | "line" | "image";

export type PatternAlignMode = "none" | "source" | "destination";

export type BrushCategory = "Basic" | "Pixel Art" | "Dither & Texture" | "Custom Stamps";

export interface BrushDynamics {
  readonly pressureSize: boolean;
  readonly pressureAngle: boolean;
  readonly velocitySize: boolean;
  readonly gradientDither: boolean;
}

export interface BrushConfig {
  readonly id: string;
  readonly name: string;
  readonly category: BrushCategory;
  readonly type: BrushType;
  readonly size: number; // 1..128
  readonly angle: number; // -180..180 degrees
  readonly spacing: number; // 1..200 (%)
  readonly patternAlign: PatternAlignMode;
  readonly flipH: boolean;
  readonly flipV: boolean;
  readonly dynamics: BrushDynamics;
  readonly image?: PixelImage;
  readonly slot?: number; // 1..9 quick slot
}

export interface SerializedBrushConfig {
  id: string;
  name: string;
  category: BrushCategory;
  type: BrushType;
  size: number;
  angle: number;
  spacing: number;
  patternAlign: PatternAlignMode;
  flipH: boolean;
  flipV: boolean;
  dynamics: BrushDynamics;
  slot?: number;
  imageWidth?: number;
  imageHeight?: number;
  imageData?: number[];
}

export interface BrushFootprintPoint {
  readonly dx: number;
  readonly dy: number;
  readonly color?: RGBA;
}

export interface DynamicStrokeSample {
  readonly pressure?: number; // 0..1, default 1
  readonly velocity?: number; // pixels/ms, default 0
  readonly strokeProgress?: number; // 0..1 along stroke
}

export const DEFAULT_BRUSH_DYNAMICS: BrushDynamics = {
  pressureSize: false,
  pressureAngle: false,
  velocitySize: false,
  gradientDither: false,
};

/**
 * Rotates and/or flips a PixelImage using nearest-neighbor sampling for crisp pixel stamps.
 */
export function transformStampImage(
  source: PixelImage,
  angleDeg = 0,
  flipH = false,
  flipV = false
): PixelImage {
  const normAngle = (((angleDeg % 360) + 360) % 360);
  if (normAngle === 0 && !flipH && !flipV) {
    return source.clone();
  }

  const rad = (normAngle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const sw = source.width;
  const sh = source.height;
  const newW = Math.max(1, Math.round(Math.abs(sw * cos) + Math.abs(sh * sin)));
  const newH = Math.max(1, Math.round(Math.abs(sw * sin) + Math.abs(sh * cos)));

  const out = new PixelImage(newW, newH, "rgba");
  const cx = (sw - 1) / 2;
  const cy = (sh - 1) / 2;
  const ncx = (newW - 1) / 2;
  const ncy = (newH - 1) / 2;

  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const rx = x - ncx;
      const ry = y - ncy;
      let sx = Math.round(rx * cos + ry * sin + cx);
      let sy = Math.round(-rx * sin + ry * cos + cy);
      if (flipH) sx = sw - 1 - sx;
      if (flipV) sy = sh - 1 - sy;
      if (sx >= 0 && sy >= 0 && sx < sw && sy < sh) {
        out.setRGBA(x, y, source.getRGBA(sx, sy));
      }
    }
  }
  return out;
}

/**
 * Generates an exact pixel-art footprint (no antialiasing) for any brush configuration and dynamic sample.
 */
export function generateBrushFootprint(
  config: BrushConfig,
  sample?: DynamicStrokeSample
): BrushFootprintPoint[] {
  let effectiveSize = clamp(Math.round(config.size), 1, 128);
  let effectiveAngle = config.angle;

  if (sample) {
    if (config.dynamics.pressureSize && sample.pressure !== undefined) {
      effectiveSize = clamp(Math.round(effectiveSize * clamp(sample.pressure, 0.1, 1)), 1, 128);
    }
    if (config.dynamics.velocitySize && sample.velocity !== undefined) {
      const velFactor = clamp(1 - sample.velocity * 0.15, 0.25, 1.25);
      effectiveSize = clamp(Math.round(effectiveSize * velFactor), 1, 128);
    }
    if (config.dynamics.pressureAngle && sample.pressure !== undefined) {
      effectiveAngle = ((config.angle + (1 - sample.pressure) * 180) % 360) - 180;
    }
  }

  if (config.type === "image" && config.image) {
    const transformed = transformStampImage(
      config.image,
      effectiveAngle,
      config.flipH,
      config.flipV
    );
    const halfW = Math.floor(transformed.width / 2);
    const halfH = Math.floor(transformed.height / 2);
    const pts: BrushFootprintPoint[] = [];
    for (let y = 0; y < transformed.height; y++) {
      for (let x = 0; x < transformed.width; x++) {
        const rgba = transformed.getRGBA(x, y);
        if (rgba.a > 0) {
          pts.push({ dx: x - halfW, dy: y - halfH, color: rgba });
        }
      }
    }
    return pts;
  }

  if (config.type === "line") {
    const rad = (effectiveAngle * Math.PI) / 180;
    const half = (effectiveSize - 1) / 2;
    const x0 = Math.round(-Math.cos(rad) * half);
    const y0 = Math.round(-Math.sin(rad) * half);
    const x1 = Math.round(Math.cos(rad) * half);
    const y1 = Math.round(Math.sin(rad) * half);
    return bresenhamLine(x0, y0, x1, y1).map((p) => ({ dx: p.x, dy: p.y }));
  }

  const r = Math.floor(effectiveSize / 2);
  const pts: BrushFootprintPoint[] = [];

  if (config.type === "square") {
    if (effectiveAngle === 0) {
      for (let dy = -r; dy < -r + effectiveSize; dy++) {
        for (let dx = -r; dx < -r + effectiveSize; dx++) {
          pts.push({ dx, dy });
        }
      }
      return pts;
    }
    // Rotated square
    const rad = (effectiveAngle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const half = effectiveSize / 2;
    const bound = Math.ceil(half * 1.5);
    for (let dy = -bound; dy <= bound; dy++) {
      for (let dx = -bound; dx <= bound; dx++) {
        const rx = dx * cos + dy * sin;
        const ry = -dx * sin + dy * cos;
        if (Math.abs(rx) <= half - 0.01 && Math.abs(ry) <= half - 0.01) {
          pts.push({ dx, dy });
        }
      }
    }
    return pts.length > 0 ? pts : [{ dx: 0, dy: 0 }];
  }

  // Circle brush: crisp pixel-art midpoint/distance threshold matching Aseprite 1..128px circles
  if (effectiveSize === 1) {
    return [{ dx: 0, dy: 0 }];
  }
  if (effectiveSize === 2) {
    return [
      { dx: -1, dy: -1 },
      { dx: 0, dy: -1 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 0 },
    ];
  }
  if (effectiveSize === 3) {
    return [
      { dx: 0, dy: -1 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
    ];
  }

  const centerOffset = effectiveSize % 2 === 0 ? 0.5 : 0;
  const radius = effectiveSize / 2;
  const radiusSq = (radius - 0.15) * (radius - 0.15);

  for (let dy = -r; dy < -r + effectiveSize; dy++) {
    for (let dx = -r; dx < -r + effectiveSize; dx++) {
      const cx = dx + centerOffset;
      const cy = dy + centerOffset;
      if (cx * cx + cy * cy <= radiusSq) {
        pts.push({ dx, dy });
      }
    }
  }
  return pts;
}

/**
 * Class wrapper for creating and manipulating Brushes (including `Brush.fromImage`).
 */
export class Brush {
  public readonly config: BrushConfig;

  public constructor(config: Partial<BrushConfig> & { type?: BrushType; size?: number } = {}) {
    this.config = {
      id: config.id ?? createModelId("brush"),
      name: config.name ?? `${config.size ?? 1}px ${config.type ?? "square"}`,
      category: config.category ?? "Basic",
      type: config.type ?? "square",
      size: clamp(Math.round(config.size ?? 1), 1, 128),
      angle: clamp(Math.round(config.angle ?? 0), -180, 180),
      spacing: clamp(Math.round(config.spacing ?? 15), 1, 200),
      patternAlign: config.patternAlign ?? "none",
      flipH: config.flipH ?? false,
      flipV: config.flipV ?? false,
      dynamics: config.dynamics ?? { ...DEFAULT_BRUSH_DYNAMICS },
      image: config.image,
      slot: config.slot,
    };
  }

  /**
   * Creates a custom Image Brush from any PixelImage (e.g., from selection or clipboard).
   */
  public static fromImage(
    image: PixelImage,
    options: {
      name?: string;
      patternAlign?: PatternAlignMode;
      angle?: number;
      flipH?: boolean;
      flipV?: boolean;
      slot?: number;
    } = {}
  ): Brush {
    const rgbaCopy = new PixelImage(image.width, image.height, "rgba");
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        rgbaCopy.setRGBA(x, y, image.getRGBA(x, y));
      }
    }
    return new Brush({
      name: options.name ?? `Stamp ${image.width}x${image.height}`,
      category: "Custom Stamps",
      type: "image",
      size: Math.max(image.width, image.height),
      angle: options.angle ?? 0,
      spacing: 25,
      patternAlign: options.patternAlign ?? "none",
      flipH: options.flipH ?? false,
      flipV: options.flipV ?? false,
      image: rgbaCopy,
      slot: options.slot,
    });
  }

  /**
   * Generates the pixel footprint for this brush.
   */
  public getFootprint(sample?: DynamicStrokeSample): BrushFootprintPoint[] {
    return generateBrushFootprint(this.config, sample);
  }
}

// ---------------------------------------------------------------------------
// Ordered Dithering Matrices (Bayer 2x2, 4x4, 8x8, Checkerboard, Lines, Custom)
// ---------------------------------------------------------------------------

export type DitherMatrixId =
  | "none"
  | "bayer2x2"
  | "bayer4x4"
  | "bayer8x8"
  | "checkerboard"
  | "horizontal_lines"
  | "vertical_lines"
  | "diagonal_lines"
  | "custom";

export interface DitherMatrix {
  readonly id: DitherMatrixId;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly maxVal: number;
  readonly values: readonly number[];
}

export const BAYER_2X2: DitherMatrix = {
  id: "bayer2x2",
  name: "Bayer Matrix 2x2",
  width: 2,
  height: 2,
  maxVal: 4,
  values: [0, 2, 3, 1],
};

export const BAYER_4X4: DitherMatrix = {
  id: "bayer4x4",
  name: "Bayer Matrix 4x4",
  width: 4,
  height: 4,
  maxVal: 16,
  values: [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5],
};

export const BAYER_8X8: DitherMatrix = {
  id: "bayer8x8",
  name: "Bayer Matrix 8x8",
  width: 8,
  height: 8,
  maxVal: 64,
  values: [
    0, 32, 8, 40, 2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
  ],
};

export const CHECKERBOARD_MATRIX: DitherMatrix = {
  id: "checkerboard",
  name: "Checkerboard 2x2",
  width: 2,
  height: 2,
  maxVal: 2,
  values: [0, 1, 1, 0],
};

export const HORIZONTAL_LINES_MATRIX: DitherMatrix = {
  id: "horizontal_lines",
  name: "Horizontal Lines",
  width: 2,
  height: 2,
  maxVal: 2,
  values: [0, 0, 1, 1],
};

export const VERTICAL_LINES_MATRIX: DitherMatrix = {
  id: "vertical_lines",
  name: "Vertical Lines",
  width: 2,
  height: 2,
  maxVal: 2,
  values: [0, 1, 0, 1],
};

export const DIAGONAL_LINES_MATRIX: DitherMatrix = {
  id: "diagonal_lines",
  name: "Diagonal Lines 4x4",
  width: 4,
  height: 4,
  maxVal: 4,
  values: [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2],
};

export const BUILTIN_DITHER_MATRICES: Record<Exclude<DitherMatrixId, "none" | "custom">, DitherMatrix> = {
  bayer2x2: BAYER_2X2,
  bayer4x4: BAYER_4X4,
  bayer8x8: BAYER_8X8,
  checkerboard: CHECKERBOARD_MATRIX,
  horizontal_lines: HORIZONTAL_LINES_MATRIX,
  vertical_lines: VERTICAL_LINES_MATRIX,
  diagonal_lines: DIAGONAL_LINES_MATRIX,
};

/**
 * Evaluates whether pixel `(x, y)` should use the secondary/BG color (`true`) or primary/FG color (`false`)
 * under the chosen dither matrix and mix factor `ratio` (0 = 100% FG, 0.5 = 50/50 dither, 1 = 100% BG).
 */
export function evaluateDitherMatrix(
  x: number,
  y: number,
  matrixId: DitherMatrixId,
  ratio = 0.5,
  customMatrix?: DitherMatrix
): boolean {
  if (matrixId === "none") return false;
  const mat =
    matrixId === "custom"
      ? customMatrix ?? BAYER_4X4
      : BUILTIN_DITHER_MATRICES[matrixId] ?? BAYER_4X4;
  const mx = ((Math.floor(x) % mat.width) + mat.width) % mat.width;
  const my = ((Math.floor(y) % mat.height) + mat.height) % mat.height;
  const threshold = (mat.values[my * mat.width + mx] + 0.5) / mat.maxVal;
  return clamp(ratio, 0, 1) >= threshold;
}

// ---------------------------------------------------------------------------
// Ink Modes (Simple, Alpha Compositing, Copy Color+Alpha, Lock Alpha, Shading)
// ---------------------------------------------------------------------------

export type InkMode =
  | "simple"
  | "alpha_compositing"
  | "copy_color_alpha"
  | "lock_alpha"
  | "shading";

export interface InkApplicationOptions {
  readonly inkMode: InkMode;
  readonly opacity: number; // 0..255
  readonly button?: number; // 0 = left (forward ramp), 2 = right (reverse ramp)
  readonly palette?: readonly RGBA[];
  readonly transparentIndex?: number;
  readonly shadingRamp?: readonly RGBA[];
  readonly ditherMatrixId?: DitherMatrixId;
  readonly ditherRatio?: number;
  readonly customDitherMatrix?: DitherMatrix;
  readonly patternAlign?: PatternAlignMode;
  readonly patternImage?: PixelImage;
  readonly strokeOrigin?: Point;
}

function colorsEqualRGB(a: RGBA, b: RGBA): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

/**
 * Computes the resulting RGBA pixel to write at `(x, y)` on `target` according to the active InkMode,
 * dithering matrix, pattern alignment, and shading ramp.
 */
export function computeInkColor(
  target: PixelImage,
  x: number,
  y: number,
  fgColor: RGBA,
  bgColor: RGBA,
  options: InkApplicationOptions
): RGBA | null {
  const dst = target.getRGBA(x, y, options.palette, options.transparentIndex ?? 0);

  // 1. Resolve source color (pattern alignment or dithered FG/BG)
  let srcColor = fgColor;

  if (options.patternImage && options.patternAlign && options.patternAlign !== "none") {
    const pat = options.patternImage;
    let px = x;
    let py = y;
    if (options.patternAlign === "source" && options.strokeOrigin) {
      px = x - options.strokeOrigin.x;
      py = y - options.strokeOrigin.y;
    }
    const wx = ((px % pat.width) + pat.width) % pat.width;
    const wy = ((py % pat.height) + pat.height) % pat.height;
    srcColor = pat.getRGBA(wx, wy);
  } else if (options.ditherMatrixId && options.ditherMatrixId !== "none") {
    const useBg = evaluateDitherMatrix(
      x,
      y,
      options.ditherMatrixId,
      options.ditherRatio ?? 0.5,
      options.customDitherMatrix
    );
    srcColor = useBg ? bgColor : fgColor;
  }

  const opacity = clamp(options.opacity ?? 255, 0, 255);

  switch (options.inkMode) {
    case "simple": {
      if (srcColor.a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      if (opacity >= 255 && srcColor.a >= 255) {
        return srcColor;
      }
      return blendRGBA(dst, srcColor, "normal", opacity);
    }

    case "alpha_compositing": {
      if (srcColor.a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return blendRGBA(dst, srcColor, "normal", opacity);
    }

    case "copy_color_alpha": {
      const scaledAlpha = Math.round((srcColor.a * opacity) / 255);
      return {
        r: srcColor.r,
        g: srcColor.g,
        b: srcColor.b,
        a: clamp(scaledAlpha, 0, 255),
      };
    }

    case "lock_alpha": {
      if (dst.a === 0) return null; // Keep transparent pixels untouched
      const blended = blendRGBA(
        { r: dst.r, g: dst.g, b: dst.b, a: 255 },
        { r: srcColor.r, g: srcColor.g, b: srcColor.b, a: 255 },
        "normal",
        opacity
      );
      return {
        r: blended.r,
        g: blended.g,
        b: blended.b,
        a: dst.a,
      };
    }

    case "shading": {
      if (dst.a === 0) return null;
      const ramp =
        options.shadingRamp && options.shadingRamp.length >= 2
          ? options.shadingRamp
          : options.palette && options.palette.length >= 2
          ? options.palette
          : [];
      if (ramp.length < 2) return null;

      // Find exact or closest color in the shading ramp
      let foundIdx = ramp.findIndex((c) => colorsEqualRGB(c, dst));
      if (foundIdx < 0) {
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < ramp.length; i++) {
          const c = ramp[i];
          if (c.a === 0) continue;
          const dr = c.r - dst.r;
          const dg = c.g - dst.g;
          const db = c.b - dst.b;
          const d = dr * dr + dg * dg + db * db;
          if (d < bestDist) {
            bestDist = d;
            foundIdx = i;
          }
        }
      }
      if (foundIdx < 0) return null;
      const step = options.button === 2 ? -1 : 1;
      const nextIdx = clamp(foundIdx + step, 0, ramp.length - 1);
      const nextColor = ramp[nextIdx];
      return {
        r: nextColor.r,
        g: nextColor.g,
        b: nextColor.b,
        a: dst.a,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Symmetry & Tiled Mode Coordinate Transforms
// ---------------------------------------------------------------------------

export type SymmetryMode =
  | "none"
  | "horizontal"
  | "vertical"
  | "both"
  | "diagonal_pos"
  | "diagonal_neg"
  | "eight_way";

export type TiledMode = "none" | "x" | "y" | "both";

export interface SymmetryTransform {
  readonly id: string;
  readonly signX: 1 | -1;
  readonly signY: 1 | -1;
  readonly swapXY: boolean;
}

const SYMMETRY_TRANSFORMS: Record<SymmetryMode, readonly SymmetryTransform[]> = {
  none: [{ id: "id", signX: 1, signY: 1, swapXY: false }],
  horizontal: [
    { id: "id", signX: 1, signY: 1, swapXY: false },
    { id: "h", signX: -1, signY: 1, swapXY: false },
  ],
  vertical: [
    { id: "id", signX: 1, signY: 1, swapXY: false },
    { id: "v", signX: 1, signY: -1, swapXY: false },
  ],
  both: [
    { id: "id", signX: 1, signY: 1, swapXY: false },
    { id: "h", signX: -1, signY: 1, swapXY: false },
    { id: "v", signX: 1, signY: -1, swapXY: false },
    { id: "hv", signX: -1, signY: -1, swapXY: false },
  ],
  diagonal_pos: [
    { id: "id", signX: 1, signY: 1, swapXY: false },
    { id: "d_pos", signX: 1, signY: 1, swapXY: true },
  ],
  diagonal_neg: [
    { id: "id", signX: 1, signY: 1, swapXY: false },
    { id: "d_neg", signX: -1, signY: -1, swapXY: true },
  ],
  eight_way: [
    { id: "id", signX: 1, signY: 1, swapXY: false },
    { id: "h", signX: -1, signY: 1, swapXY: false },
    { id: "v", signX: 1, signY: -1, swapXY: false },
    { id: "hv", signX: -1, signY: -1, swapXY: false },
    { id: "d_pos", signX: 1, signY: 1, swapXY: true },
    { id: "d_pos_h", signX: -1, signY: 1, swapXY: true },
    { id: "d_pos_v", signX: 1, signY: -1, swapXY: true },
    { id: "d_neg", signX: -1, signY: -1, swapXY: true },
  ],
};

/**
 * Returns the active dihedral group transforms for the given `SymmetryMode`.
 */
export function getSymmetryTransforms(mode: SymmetryMode): readonly SymmetryTransform[] {
  return SYMMETRY_TRANSFORMS[mode] ?? SYMMETRY_TRANSFORMS.none;
}

/**
 * Applies a single dihedral symmetry reflection/transposition around `(axisX, axisY)`
 * with full support for both integer (even canvas) and half-pixel `.5` (odd canvas) axis centers.
 */
export function applySymmetryTransform(
  pt: Point,
  tf: SymmetryTransform,
  axisX: number,
  axisY: number
): Point {
  const cx = axisX - 0.5;
  const cy = axisY - 0.5;
  const rx = pt.x - cx;
  const ry = pt.y - cy;
  const tx = tf.swapXY ? tf.signX * ry : tf.signX * rx;
  const ty = tf.swapXY ? tf.signY * rx : tf.signY * ry;
  return {
    x: Math.round(cx + tx),
    y: Math.round(cy + ty),
  };
}

/**
 * Reflects and/or transposes a brush footprint according to a dihedral `SymmetryTransform`.
 */
export function transposeBrushFootprint(
  footprint: readonly BrushFootprintPoint[],
  tf: SymmetryTransform
): BrushFootprintPoint[] {
  if (!tf.swapXY && tf.signX === 1 && tf.signY === 1) {
    return [...footprint];
  }
  return footprint.map((fp) => ({
    dx: tf.swapXY ? tf.signX * fp.dy : tf.signX * fp.dx,
    dy: tf.swapXY ? tf.signY * fp.dx : tf.signY * fp.dy,
    color: fp.color,
  }));
}

/**
 * Computes mirrored points for the active SymmetryMode around `(axisX, axisY)`.
 * Deduplicates points that land on the exact same pixel (e.g. on an axis or center pixel)
 * when `deduplicate` is true (default false for backward-compatible length checks on off-axis points,
 * while identical coordinates are deduplicated).
 */
export function computeSymmetryPoints(
  pt: Point,
  mode: SymmetryMode,
  axisX: number,
  axisY: number,
  deduplicate = true
): Point[] {
  if (mode === "none") return [pt];
  const transforms = getSymmetryTransforms(mode);
  const out: Point[] = [];
  const seen = new Set<string>();
  for (const tf of transforms) {
    const p = applySymmetryTransform(pt, tf, axisX, axisY);
    if (deduplicate) {
      const key = `${p.x},${p.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(p);
  }
  return out;
}

/**
 * Wraps a pixel coordinate `(x, y)` into `[0..width-1, 0..height-1]` according to `tiledMode`,
 * or returns `null` if out of bounds and not tiled on that axis.
 */
export function wrapTiledCoord(
  x: number,
  y: number,
  width: number,
  height: number,
  tiledMode: TiledMode
): Point | null {
  let wx = x;
  let wy = y;

  if (wx < 0 || wx >= width) {
    if (tiledMode === "x" || tiledMode === "both") {
      wx = ((wx % width) + width) % width;
    } else {
      return null;
    }
  }

  if (wy < 0 || wy >= height) {
    if (tiledMode === "y" || tiledMode === "both") {
      wy = ((wy % height) + height) % height;
    } else {
      return null;
    }
  }

  return { x: wx, y: wy };
}

// ---------------------------------------------------------------------------
// Brush Library & Preset Persistence (.kpbrushes)
// ---------------------------------------------------------------------------

/**
 * Generates a small procedural custom stamp PixelImage for built-in library presets.
 */
function makePresetStamp(pattern: string[], color: RGBA = { r: 255, g: 255, b: 255, a: 255 }): PixelImage {
  const h = pattern.length;
  const w = pattern[0]?.length ?? 1;
  const img = new PixelImage(w, h, "rgba");
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pattern[y][x] === "#") {
        img.setRGBA(x, y, color);
      }
    }
  }
  return img;
}

export const BUILTIN_BRUSH_PRESETS: readonly BrushConfig[] = [
  {
    id: "brush.preset.1px_pixel",
    name: "1px Pixel",
    category: "Basic",
    type: "square",
    size: 1,
    angle: 0,
    spacing: 10,
    patternAlign: "none",
    flipH: false,
    flipV: false,
    dynamics: { ...DEFAULT_BRUSH_DYNAMICS },
    slot: 1,
  },
  {
    id: "brush.preset.2px_block",
    name: "2px Block",
    category: "Basic",
    type: "square",
    size: 2,
    angle: 0,
    spacing: 15,
    patternAlign: "none",
    flipH: false,
    flipV: false,
    dynamics: { ...DEFAULT_BRUSH_DYNAMICS },
    slot: 2,
  },
  {
    id: "brush.preset.3px_round",
    name: "3px Cross Round",
    category: "Basic",
    type: "circle",
    size: 3,
    angle: 0,
    spacing: 15,
    patternAlign: "none",
    flipH: false,
    flipV: false,
    dynamics: { ...DEFAULT_BRUSH_DYNAMICS },
    slot: 3,
  },
  {
    id: "brush.preset.5px_round",
    name: "5px Circle",
    category: "Basic",
    type: "circle",
    size: 5,
    angle: 0,
    spacing: 20,
    patternAlign: "none",
    flipH: false,
    flipV: false,
    dynamics: { ...DEFAULT_BRUSH_DYNAMICS },
    slot: 4,
  },
  {
    id: "brush.preset.8px_round",
    name: "8px Soft Round",
    category: "Basic",
    type: "circle",
    size: 8,
    angle: 0,
    spacing: 20,
    patternAlign: "none",
    flipH: false,
    flipV: false,
    dynamics: { ...DEFAULT_BRUSH_DYNAMICS, pressureSize: true },
    slot: 5,
  },
  {
    id: "brush.preset.calligraphy_45",
    name: "5px Calligraphy 45°",
    category: "Pixel Art",
    type: "line",
    size: 5,
    angle: 45,
    spacing: 12,
    patternAlign: "none",
    flipH: false,
    flipV: false,
    dynamics: { ...DEFAULT_BRUSH_DYNAMICS },
    slot: 6,
  },
  {
    id: "brush.preset.chisel_minus45",
    name: "6px Chisel -45°",
    category: "Pixel Art",
    type: "line",
    size: 6,
    angle: -45,
    spacing: 12,
    patternAlign: "none",
    flipH: false,
    flipV: false,
    dynamics: { ...DEFAULT_BRUSH_DYNAMICS },
    slot: 7,
  },
  {
    id: "brush.preset.crosshatch_stamp",
    name: "4x4 Crosshatch Pattern",
    category: "Dither & Texture",
    type: "image",
    size: 4,
    angle: 0,
    spacing: 50,
    patternAlign: "destination",
    flipH: false,
    flipV: false,
    dynamics: { ...DEFAULT_BRUSH_DYNAMICS },
    image: makePresetStamp(["#.#.", ".#.#", "#.#.", ".#.#"]),
    slot: 8,
  },
  {
    id: "brush.preset.star_stamp",
    name: "5x5 Sparkle Stamp",
    category: "Custom Stamps",
    type: "image",
    size: 5,
    angle: 0,
    spacing: 100,
    patternAlign: "none",
    flipH: false,
    flipV: false,
    dynamics: { ...DEFAULT_BRUSH_DYNAMICS },
    image: makePresetStamp(["..#..", "..#..", "#####", "..#..", "..#.."]),
    slot: 9,
  },
];

/**
 * Manages the user's brush library, slots 1..9, and `.kpbrushes` JSON serialization.
 */
export class BrushLibrary {
  private brushes: BrushConfig[];

  public constructor(initial?: readonly BrushConfig[]) {
    this.brushes = (initial ?? BUILTIN_BRUSH_PRESETS).map((b) => ({
      ...b,
      dynamics: { ...b.dynamics },
      image: b.image ? b.image.clone() : undefined,
    }));
  }

  public getAll(): BrushConfig[] {
    return this.brushes.map((b) => ({ ...b }));
  }

  public getById(id: string): BrushConfig | undefined {
    return this.brushes.find((b) => b.id === id);
  }

  public getBySlot(slot: number): BrushConfig | undefined {
    return this.brushes.find((b) => b.slot === slot);
  }

  public addBrush(config: Omit<BrushConfig, "id"> & { id?: string }): BrushConfig {
    const created: BrushConfig = {
      ...config,
      id: config.id ?? createModelId("brush"),
      dynamics: { ...config.dynamics },
      image: config.image ? config.image.clone() : undefined,
    };
    this.brushes.push(created);
    return created;
  }

  public removeBrush(id: string): boolean {
    const idx = this.brushes.findIndex((b) => b.id === id);
    if (idx < 0) return false;
    this.brushes.splice(idx, 1);
    return true;
  }

  public renameBrush(id: string, name: string): boolean {
    const target = this.brushes.find((b) => b.id === id);
    if (!target) return false;
    const idx = this.brushes.indexOf(target);
    this.brushes[idx] = { ...target, name: name.trim() || target.name };
    return true;
  }

  public reorderBrush(fromIndex: number, toIndex: number): void {
    if (
      fromIndex < 0 ||
      fromIndex >= this.brushes.length ||
      toIndex < 0 ||
      toIndex >= this.brushes.length
    ) {
      return;
    }
    const [moved] = this.brushes.splice(fromIndex, 1);
    this.brushes.splice(toIndex, 0, moved);
  }

  public assignSlot(id: string, slot: number): void {
    for (let i = 0; i < this.brushes.length; i++) {
      if (this.brushes[i].slot === slot) {
        this.brushes[i] = { ...this.brushes[i], slot: undefined };
      }
      if (this.brushes[i].id === id) {
        this.brushes[i] = { ...this.brushes[i], slot };
      }
    }
  }

  public exportJson(): string {
    const serialized: SerializedBrushConfig[] = this.brushes.map((b) => ({
      id: b.id,
      name: b.name,
      category: b.category,
      type: b.type,
      size: b.size,
      angle: b.angle,
      spacing: b.spacing,
      patternAlign: b.patternAlign,
      flipH: b.flipH,
      flipV: b.flipV,
      dynamics: { ...b.dynamics },
      slot: b.slot,
      imageWidth: b.image?.width,
      imageHeight: b.image?.height,
      imageData: b.image ? Array.from(b.image.data) : undefined,
    }));
    return JSON.stringify({ format: "kpbrushes", version: 1, brushes: serialized }, null, 2);
  }

  public importJson(json: string): void {
    const parsed = JSON.parse(json) as {
      format?: string;
      version?: number;
      brushes?: SerializedBrushConfig[];
    };
    if (!parsed || parsed.format !== "kpbrushes" || !Array.isArray(parsed.brushes)) {
      throw new Error("Invalid .kpbrushes library JSON");
    }
    this.brushes = parsed.brushes.map((raw) => {
      let image: PixelImage | undefined;
      if (raw.imageWidth && raw.imageHeight && Array.isArray(raw.imageData)) {
        image = new PixelImage(
          raw.imageWidth,
          raw.imageHeight,
          "rgba",
          new Uint8Array(raw.imageData)
        );
      }
      return {
        id: raw.id || createModelId("brush"),
        name: raw.name || "Brush",
        category: raw.category || "Basic",
        type: raw.type || "square",
        size: clamp(raw.size || 1, 1, 128),
        angle: clamp(raw.angle || 0, -180, 180),
        spacing: clamp(raw.spacing || 15, 1, 200),
        patternAlign: raw.patternAlign || "none",
        flipH: Boolean(raw.flipH),
        flipV: Boolean(raw.flipV),
        dynamics: raw.dynamics ?? { ...DEFAULT_BRUSH_DYNAMICS },
        slot: raw.slot,
        image,
      };
    });
  }
}

export const defaultBrushLibrary = new BrushLibrary();
