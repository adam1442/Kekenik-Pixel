/**
 * @module @kekenik/core/filters
 * Pure TypeScript Filters & Effects Engine for Kekenik Pixel:
 * Invert Color, Brightness/Contrast, Hue/Saturation/Lightness, Color Curve (with 256-bin Histogram),
 * Posterize, Replace Color, Outline (Circle/Square/Horiz/Vert + 3x3 Matrix, Inside/Outside),
 * Convolution Matrix (3x3/5x5 kernels + Tiled Mode wrap-around), Despeckle (Median Filter),
 * and Drop Shadow, with per-channel target masks (R, G, B, A, Index) and Selection Mask clipping.
 * Zero DOM, React, or Electron imports.
 */

import { Mask, PixelImage } from "../model/index.ts";
import { colorDistanceTolerance } from "../selection/index.ts";
import {
  clamp,
  hslToRgba,
  hsvToRgba,
  Point,
  RGBA,
  rgbToHsl,
  rgbToHsv,
} from "../util/index.ts";

export type FilterTargetScope =
  | "selection"
  | "active_cel"
  | "active_layer"
  | "selected_cels"
  | "all_frames";

export interface FilterTargetChannels {
  readonly r: boolean;
  readonly g: boolean;
  readonly b: boolean;
  readonly a: boolean;
  readonly index: boolean;
}

export const DEFAULT_FILTER_CHANNELS: FilterTargetChannels = {
  r: true,
  g: true,
  b: true,
  a: true,
  index: true,
};

export interface FilterCommonOptions {
  readonly channels?: FilterTargetChannels;
  readonly mask?: Mask;
  readonly palette?: readonly RGBA[];
  readonly transparentIndex?: number;
}

function applyChannelMask(orig: RGBA, modified: RGBA, channels = DEFAULT_FILTER_CHANNELS): RGBA {
  return {
    r: channels.r ? clamp(Math.round(modified.r), 0, 255) : orig.r,
    g: channels.g ? clamp(Math.round(modified.g), 0, 255) : orig.g,
    b: channels.b ? clamp(Math.round(modified.b), 0, 255) : orig.b,
    a: channels.a ? clamp(Math.round(modified.a), 0, 255) : orig.a,
  };
}

function isPixelTargeted(mask: Mask | undefined, x: number, y: number): boolean {
  if (!mask || mask.isEmpty) return true;
  return mask.getBit(x, y);
}

/**
 * 1. Invert Color Filter (`Edit > Adjustments > Invert Color`, `Ctrl+I`)
 */
export function applyInvertFilter(
  image: PixelImage,
  options: FilterCommonOptions = {}
): PixelImage {
  const out = image.clone();
  const ch = options.channels ?? DEFAULT_FILTER_CHANNELS;
  const pal = options.palette;
  const tIdx = options.transparentIndex ?? 0;

  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      if (!isPixelTargeted(options.mask, x, y)) continue;
      const orig = image.getRGBA(x, y, pal, tIdx);
      if (orig.a === 0 && !ch.a) continue;
      const inv: RGBA = {
        r: 255 - orig.r,
        g: 255 - orig.g,
        b: 255 - orig.b,
        a: orig.a,
      };
      out.setRGBA(x, y, applyChannelMask(orig, inv, ch), pal, tIdx);
    }
  }
  return out;
}

/**
 * 2. Brightness / Contrast Filter (`brightness`: -100..+100, `contrast`: -100..+100)
 */
export function applyBrightnessContrastFilter(
  image: PixelImage,
  brightness: number,
  contrast: number,
  options: FilterCommonOptions = {}
): PixelImage {
  const out = image.clone();
  const ch = options.channels ?? DEFAULT_FILTER_CHANNELS;
  const pal = options.palette;
  const tIdx = options.transparentIndex ?? 0;

  const bOffset = (clamp(brightness, -100, 100) / 100) * 255;
  const cNorm = (clamp(contrast, -100, 100) / 100) * 255;
  const factor = (259 * (cNorm + 255)) / (255 * (259 - cNorm));

  const mapVal = (v: number): number => clamp(Math.round(factor * (v + bOffset - 128) + 128), 0, 255);

  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      if (!isPixelTargeted(options.mask, x, y)) continue;
      const orig = image.getRGBA(x, y, pal, tIdx);
      if (orig.a === 0) continue;
      const mod: RGBA = {
        r: mapVal(orig.r),
        g: mapVal(orig.g),
        b: mapVal(orig.b),
        a: orig.a,
      };
      out.setRGBA(x, y, applyChannelMask(orig, mod, ch), pal, tIdx);
    }
  }
  return out;
}

/**
 * 3. Hue / Saturation / Lightness (or Value) Filter (`Ctrl+U`)
 */
export function applyHueSaturationFilter(
  image: PixelImage,
  params: {
    hueShift: number; // -180..+180
    saturationShift: number; // -100..+100
    lightnessShift: number; // -100..+100
    alphaShift?: number; // -100..+100
    mode?: "hsl" | "hsv";
  },
  options: FilterCommonOptions = {}
): PixelImage {
  const out = image.clone();
  const ch = options.channels ?? DEFAULT_FILTER_CHANNELS;
  const pal = options.palette;
  const tIdx = options.transparentIndex ?? 0;
  const mode = params.mode ?? "hsl";
  const aDelta = Math.round(((params.alphaShift ?? 0) / 100) * 255);

  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      if (!isPixelTargeted(options.mask, x, y)) continue;
      const orig = image.getRGBA(x, y, pal, tIdx);
      if (orig.a === 0 && aDelta <= 0) continue;

      const newA = clamp(orig.a + aDelta, 0, 255);
      let converted: RGBA;
      if (mode === "hsv") {
        const hsv = rgbToHsv(orig.r, orig.g, orig.b);
        const h = (hsv.h + params.hueShift + 360) % 360;
        const s = clamp(hsv.s + params.saturationShift, 0, 100);
        const v = clamp(hsv.v + params.lightnessShift, 0, 100);
        converted = hsvToRgba(h, s, v, newA);
      } else {
        const hsl = rgbToHsl(orig.r, orig.g, orig.b);
        const h = (hsl.h + params.hueShift + 360) % 360;
        const s = clamp(hsl.s + params.saturationShift, 0, 100);
        const l = clamp(hsl.l + params.lightnessShift, 0, 100);
        converted = hslToRgba(h, s, l, newA);
      }
      out.setRGBA(x, y, applyChannelMask(orig, converted, ch), pal, tIdx);
    }
  }
  return out;
}

/**
 * Evaluates a 256-entry lookup table (`Uint8Array(256)`) from sorted curve control points `(0..255, 0..255)`
 * using smooth Catmull-Rom / monotone spline interpolation.
 */
export function evaluateCurveLUT(points: readonly Point[]): Uint8Array {
  const lut = new Uint8Array(256);
  const sorted = [...points]
    .map((p) => ({ x: clamp(Math.round(p.x), 0, 255), y: clamp(Math.round(p.y), 0, 255) }))
    .sort((a, b) => a.x - b.x);

  if (sorted.length === 0) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  if (sorted.length === 1) {
    lut.fill(sorted[0].y);
    return lut;
  }

  for (let x = 0; x <= sorted[0].x; x++) {
    lut[x] = sorted[0].y;
  }
  for (let x = sorted[sorted.length - 1].x; x < 256; x++) {
    lut[x] = sorted[sorted.length - 1].y;
  }

  for (let seg = 0; seg < sorted.length - 1; seg++) {
    const p0 = sorted[Math.max(0, seg - 1)];
    const p1 = sorted[seg];
    const p2 = sorted[seg + 1];
    const p3 = sorted[Math.min(sorted.length - 1, seg + 2)];
    const span = p2.x - p1.x;
    if (span <= 0) {
      lut[p1.x] = p2.y;
      continue;
    }
    for (let x = p1.x; x <= p2.x; x++) {
      const t = (x - p1.x) / span;
      const t2 = t * t;
      const t3 = t2 * t;
      // Catmull-Rom spline evaluation
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      lut[x] = clamp(Math.round(y), 0, 255);
    }
  }
  return lut;
}

/**
 * Computes 256-bin R, G, B, and Luminance histograms for displaying behind the Color Curve spline editor.
 */
export function computeImageHistogram(
  image: PixelImage,
  palette?: readonly RGBA[],
  transparentIndex = 0
): {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  luma: Uint32Array;
  maxCount: number;
} {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const luma = new Uint32Array(256);

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const c = image.getRGBA(x, y, palette, transparentIndex);
      if (c.a === 0) continue;
      r[c.r]++;
      g[c.g]++;
      b[c.b]++;
      const l = clamp(Math.round(0.299 * c.r + 0.587 * c.g + 0.114 * c.b), 0, 255);
      luma[l]++;
    }
  }

  let maxCount = 1;
  for (let i = 0; i < 256; i++) {
    if (luma[i] > maxCount) maxCount = luma[i];
  }
  return { r, g, b, luma, maxCount };
}

/**
 * 4. Color Curve Filter (`Edit > Adjustments > Color Curve`, `Ctrl+M`)
 */
export function applyColorCurveFilter(
  image: PixelImage,
  points: readonly Point[],
  options: FilterCommonOptions = {}
): PixelImage {
  const out = image.clone();
  const lut = evaluateCurveLUT(points);
  const ch = options.channels ?? DEFAULT_FILTER_CHANNELS;
  const pal = options.palette;
  const tIdx = options.transparentIndex ?? 0;

  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      if (!isPixelTargeted(options.mask, x, y)) continue;
      const orig = image.getRGBA(x, y, pal, tIdx);
      if (orig.a === 0 && !ch.a) continue;
      const mod: RGBA = {
        r: lut[orig.r],
        g: lut[orig.g],
        b: lut[orig.b],
        a: ch.a && !ch.r && !ch.g && !ch.b ? lut[orig.a] : orig.a,
      };
      out.setRGBA(x, y, applyChannelMask(orig, mod, ch), pal, tIdx);
    }
  }
  return out;
}

/**
 * 5. Posterize / Quantize Color Levels Filter (`levels`: 2..64)
 */
export function applyPosterizeFilter(
  image: PixelImage,
  levels: number,
  options: FilterCommonOptions = {}
): PixelImage {
  const out = image.clone();
  const n = clamp(Math.floor(levels), 2, 64);
  const ch = options.channels ?? DEFAULT_FILTER_CHANNELS;
  const pal = options.palette;
  const tIdx = options.transparentIndex ?? 0;

  const quant = (v: number): number => {
    const step = Math.round((v / 255) * (n - 1));
    return clamp(Math.round((step / (n - 1)) * 255), 0, 255);
  };

  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      if (!isPixelTargeted(options.mask, x, y)) continue;
      const orig = image.getRGBA(x, y, pal, tIdx);
      if (orig.a === 0) continue;
      const mod: RGBA = {
        r: quant(orig.r),
        g: quant(orig.g),
        b: quant(orig.b),
        a: orig.a,
      };
      out.setRGBA(x, y, applyChannelMask(orig, mod, ch), pal, tIdx);
    }
  }
  return out;
}

/**
 * 6. Replace Color Filter (`Edit > Replace Color`, `Shift+R`)
 */
export function applyReplaceColorFilter(
  image: PixelImage,
  fromColor: RGBA,
  toColor: RGBA,
  tolerance = 0,
  options: FilterCommonOptions = {}
): PixelImage {
  const out = image.clone();
  const tol = clamp(tolerance, 0, 255);
  const ch = options.channels ?? DEFAULT_FILTER_CHANNELS;
  const pal = options.palette;
  const tIdx = options.transparentIndex ?? 0;

  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      if (!isPixelTargeted(options.mask, x, y)) continue;
      const orig = image.getRGBA(x, y, pal, tIdx);
      if (colorDistanceTolerance(orig, fromColor) <= tol) {
        out.setRGBA(x, y, applyChannelMask(orig, toColor, ch), pal, tIdx);
      }
    }
  }
  return out;
}

export type OutlinePatternPreset = "circle" | "square" | "horizontal" | "vertical" | "custom";

/**
 * Returns a 9-element boolean array (`3x3` neighbor matrix) for the chosen Outline pattern preset.
 */
export function getOutlineMatrixForPattern(pattern: OutlinePatternPreset): boolean[] {
  switch (pattern) {
    case "circle":
      return [
        false, true, false,
        true, false, true,
        false, true, false,
      ];
    case "square":
      return [
        true, true, true,
        true, false, true,
        true, true, true,
      ];
    case "horizontal":
      return [
        false, false, false,
        true, false, true,
        false, false, false,
      ];
    case "vertical":
      return [
        false, true, false,
        false, false, false,
        false, true, false,
      ];
    default:
      return [
        false, true, false,
        true, false, true,
        false, true, false,
      ];
  }
}

/**
 * 7. Outline Effect Filter (`Edit > FX > Outline`, `Shift+O`) matching Aseprite 1.3:
 * Supports `outside` or `inside` placement, `circle`/`square`/`horizontal`/`vertical` or custom 3x3 matrix,
 * and optional `bgColor` treatment as transparent background.
 */
export function applyOutlineFilter(
  image: PixelImage,
  params: {
    outlineColor: RGBA;
    place?: "outside" | "inside";
    pattern?: OutlinePatternPreset;
    matrix3x3?: readonly boolean[]; // length 9 (row-major dy=-1..1, dx=-1..1)
    bgColor?: RGBA;
  },
  options: FilterCommonOptions = {}
): PixelImage {
  const out = image.clone();
  const w = image.width;
  const h = image.height;
  const pal = options.palette;
  const tIdx = options.transparentIndex ?? 0;
  const ch = options.channels ?? DEFAULT_FILTER_CHANNELS;
  const place = params.place ?? "outside";
  const matrix =
    params.matrix3x3 && params.matrix3x3.length === 9
      ? params.matrix3x3
      : getOutlineMatrixForPattern(params.pattern ?? "circle");

  const isBgPixel = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= w || y >= h) return true;
    const c = image.getRGBA(x, y, pal, tIdx);
    if (c.a === 0) return true;
    if (params.bgColor && params.bgColor.a > 0) {
      return (
        c.r === params.bgColor.r &&
        c.g === params.bgColor.g &&
        c.b === params.bgColor.b &&
        c.a === params.bgColor.a
      );
    }
    return false;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isPixelTargeted(options.mask, x, y)) continue;
      const selfIsBg = isBgPixel(x, y);

      if (place === "outside") {
        if (!selfIsBg) continue;
        let touchesFg = false;
        for (let dy = -1; dy <= 1 && !touchesFg; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const mIdx = (dy + 1) * 3 + (dx + 1);
            if (!matrix[mIdx]) continue;
            // In outside mode, if neighbor (x - dx, y - dy) is foreground, this pixel receives outline
            if (!isBgPixel(x - dx, y - dy)) {
              touchesFg = true;
              break;
            }
          }
        }
        if (touchesFg) {
          const orig = image.getRGBA(x, y, pal, tIdx);
          out.setRGBA(x, y, applyChannelMask(orig, params.outlineColor, ch), pal, tIdx);
        }
      } else {
        // place === "inside"
        if (selfIsBg) continue;
        let touchesBg = false;
        for (let dy = -1; dy <= 1 && !touchesBg; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const mIdx = (dy + 1) * 3 + (dx + 1);
            if (!matrix[mIdx]) continue;
            if (isBgPixel(x + dx, y + dy)) {
              touchesBg = true;
              break;
            }
          }
        }
        if (touchesBg) {
          const orig = image.getRGBA(x, y, pal, tIdx);
          out.setRGBA(x, y, applyChannelMask(orig, params.outlineColor, ch), pal, tIdx);
        }
      }
    }
  }
  return out;
}

export interface ConvolutionPreset {
  readonly id: string;
  readonly name: string;
  readonly size: 3 | 5;
  readonly kernel: readonly number[];
  readonly divisor: number;
  readonly bias: number;
}

export const CONVOLUTION_PRESETS: readonly ConvolutionPreset[] = [
  {
    id: "blur_3x3",
    name: "Smooth / Box Blur (3x3)",
    size: 3,
    kernel: [1, 1, 1, 1, 1, 1, 1, 1, 1],
    divisor: 9,
    bias: 0,
  },
  {
    id: "gaussian_3x3",
    name: "Gaussian Blur (3x3)",
    size: 3,
    kernel: [1, 2, 1, 2, 4, 2, 1, 2, 1],
    divisor: 16,
    bias: 0,
  },
  {
    id: "sharpen_3x3",
    name: "Sharpen (3x3)",
    size: 3,
    kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0],
    divisor: 1,
    bias: 0,
  },
  {
    id: "edge_detect",
    name: "Edge Detect (Laplacian 3x3)",
    size: 3,
    kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
    divisor: 1,
    bias: 0,
  },
  {
    id: "emboss",
    name: "Emboss (3x3)",
    size: 3,
    kernel: [-2, -1, 0, -1, 1, 1, 0, 1, 2],
    divisor: 1,
    bias: 128,
  },
  {
    id: "gaussian_5x5",
    name: "Gaussian Blur (5x5)",
    size: 5,
    kernel: [
      1, 4, 6, 4, 1,
      4, 16, 24, 16, 4,
      6, 24, 36, 24, 6,
      4, 16, 24, 16, 4,
      1, 4, 6, 4, 1,
    ],
    divisor: 256,
    bias: 0,
  },
];

function resolveCoordWithTiling(
  coord: number,
  limit: number,
  wrap: boolean
): number {
  if (wrap) {
    return ((coord % limit) + limit) % limit;
  }
  return clamp(coord, 0, limit - 1);
}

/**
 * 8. Convolution Matrix Filter (`Edit > FX > Convolution Matrix`)
 * Supports 3x3 and 5x5 custom kernels, divisor, bias, and Tiled Mode (`none`, `x`, `y`, `both`) wrap-around!
 */
export function applyConvolutionMatrixFilter(
  image: PixelImage,
  params: {
    size: 3 | 5;
    kernel: readonly number[];
    divisor?: number;
    bias?: number;
    tiledMode?: "none" | "x" | "y" | "both";
  },
  options: FilterCommonOptions = {}
): PixelImage {
  const out = image.clone();
  const w = image.width;
  const h = image.height;
  const size = params.size;
  const half = Math.floor(size / 2);
  const kernel = params.kernel;
  const div = params.divisor && params.divisor !== 0 ? params.divisor : 1;
  const bias = params.bias ?? 0;
  const tiled = params.tiledMode ?? "none";
  const wrapX = tiled === "x" || tiled === "both";
  const wrapY = tiled === "y" || tiled === "both";
  const pal = options.palette;
  const tIdx = options.transparentIndex ?? 0;
  const ch = options.channels ?? DEFAULT_FILTER_CHANNELS;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isPixelTargeted(options.mask, x, y)) continue;
      const orig = image.getRGBA(x, y, pal, tIdx);
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;

      for (let ky = -half; ky <= half; ky++) {
        const sy = resolveCoordWithTiling(y + ky, h, wrapY);
        for (let kx = -half; kx <= half; kx++) {
          const sx = resolveCoordWithTiling(x + kx, w, wrapX);
          const weight = kernel[(ky + half) * size + (kx + half)] ?? 0;
          if (weight === 0) continue;
          const sample = image.getRGBA(sx, sy, pal, tIdx);
          sumR += sample.r * weight;
          sumG += sample.g * weight;
          sumB += sample.b * weight;
          sumA += sample.a * weight;
        }
      }

      const mod: RGBA = {
        r: clamp(Math.round(sumR / div + bias), 0, 255),
        g: clamp(Math.round(sumG / div + bias), 0, 255),
        b: clamp(Math.round(sumB / div + bias), 0, 255),
        a: ch.a ? clamp(Math.round(sumA / div + bias), 0, 255) : orig.a,
      };
      out.setRGBA(x, y, applyChannelMask(orig, mod, ch), pal, tIdx);
    }
  }
  return out;
}

/**
 * 9. Despeckle (Median Filter) (`Edit > FX > Despeckle`)
 * Removes salt-and-pepper noise using a `(kernelW x kernelH)` per-channel median window.
 */
export function applyDespeckleFilter(
  image: PixelImage,
  kernelWidth = 3,
  kernelHeight = 3,
  tiledMode: "none" | "x" | "y" | "both" = "none",
  options: FilterCommonOptions = {}
): PixelImage {
  const out = image.clone();
  const w = image.width;
  const h = image.height;
  const rx = Math.floor(clamp(kernelWidth, 1, 9) / 2);
  const ry = Math.floor(clamp(kernelHeight, 1, 9) / 2);
  const wrapX = tiledMode === "x" || tiledMode === "both";
  const wrapY = tiledMode === "y" || tiledMode === "both";
  const pal = options.palette;
  const tIdx = options.transparentIndex ?? 0;
  const ch = options.channels ?? DEFAULT_FILTER_CHANNELS;

  const rVals: number[] = [];
  const gVals: number[] = [];
  const bVals: number[] = [];
  const aVals: number[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isPixelTargeted(options.mask, x, y)) continue;
      rVals.length = 0;
      gVals.length = 0;
      bVals.length = 0;
      aVals.length = 0;

      for (let dy = -ry; dy <= ry; dy++) {
        const sy = resolveCoordWithTiling(y + dy, h, wrapY);
        for (let dx = -rx; dx <= rx; dx++) {
          const sx = resolveCoordWithTiling(x + dx, w, wrapX);
          const c = image.getRGBA(sx, sy, pal, tIdx);
          rVals.push(c.r);
          gVals.push(c.g);
          bVals.push(c.b);
          aVals.push(c.a);
        }
      }

      rVals.sort((a, b) => a - b);
      gVals.sort((a, b) => a - b);
      bVals.sort((a, b) => a - b);
      aVals.sort((a, b) => a - b);
      const mid = Math.floor(rVals.length / 2);
      const orig = image.getRGBA(x, y, pal, tIdx);
      const mod: RGBA = {
        r: rVals[mid],
        g: gVals[mid],
        b: bVals[mid],
        a: aVals[mid],
      };
      out.setRGBA(x, y, applyChannelMask(orig, mod, ch), pal, tIdx);
    }
  }
  return out;
}

/**
 * 10. Drop Shadow / Offset Outline Effect (`Edit > FX > Drop Shadow`)
 */
export function applyDropShadowFilter(
  image: PixelImage,
  params: {
    offsetX: number;
    offsetY: number;
    shadowColor: RGBA;
    opacity?: number; // 0..255
  },
  options: FilterCommonOptions = {}
): PixelImage {
  const out = image.clone();
  const w = image.width;
  const h = image.height;
  const pal = options.palette;
  const tIdx = options.transparentIndex ?? 0;
  const alpha = clamp(params.opacity ?? params.shadowColor.a ?? 180, 0, 255);
  const shCol: RGBA = {
    r: params.shadowColor.r,
    g: params.shadowColor.g,
    b: params.shadowColor.b,
    a: alpha,
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isPixelTargeted(options.mask, x, y)) continue;
      const dst = image.getRGBA(x, y, pal, tIdx);
      if (dst.a > 0) continue; // Only cast shadow into empty background pixels
      const srcX = x - params.offsetX;
      const srcY = y - params.offsetY;
      if (srcX >= 0 && srcY >= 0 && srcX < w && srcY < h) {
        const caster = image.getRGBA(srcX, srcY, pal, tIdx);
        if (caster.a > 0) {
          out.setRGBA(x, y, shCol, pal, tIdx);
        }
      }
    }
  }
  return out;
}
