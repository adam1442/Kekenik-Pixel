/**
 * @module @kekenik/core/transform
 * Pure TypeScript algorithms for Pixel-Art Scaling (Scale2x, Eagle, Nearest-Neighbor, Bilinear),
 * RotSprite Clean Pixel-Art Rotation (8x Scale2x -> Rotate -> Downscale), Orthogonal Rotations
 * (90 CW, 90 CCW, 180), Flip Horizontal/Vertical, Skew/Shear, Wrap-Around Pixel Shift,
 * Floating Selection Lift/Preview/Commit, and Selection Fill/Stroke.
 * Zero DOM, React, or Electron imports.
 */

import { blendRGBA, Mask, PixelImage } from "../model/index.ts";
import { borderMask, flipMaskHorizontal, flipMaskVertical } from "../selection/index.ts";
import { clamp, Point, Rect, RGBA } from "../util/index.ts";

export interface TransformMatrix2D {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
}

export type TransformInterpolation = "fast" | "rotsprite" | "bilinear" | "scale2x" | "eagle";

export interface FloatingSelectionState {
  readonly sourceImage: PixelImage;
  readonly localMask: Mask;
  readonly originX: number;
  readonly originY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  angleDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  pivotRelX: number; // 0..1 (0.5 = center)
  pivotRelY: number; // 0..1 (0.5 = center)
  algorithm: "fast" | "rotsprite" | "bilinear";
}

/**
 * Compares two packed pixel values for equality in Scale2x / RotSprite.
 * In RotSprite, similar colors within a small perceptual threshold can also be treated as equal.
 */
function pixelsSimilar(img: PixelImage, pA: number, pB: number, useSimilarity = false): boolean {
  if (pA === pB) return true;
  if (!useSimilarity || img.colorMode !== "rgba") return false;
  const aA = (pA >>> 24) & 0xff;
  const aB = (pB >>> 24) & 0xff;
  if (aA === 0 && aB === 0) return true;
  if (Math.abs(aA - aB) > 24) return false;
  const rA = pA & 0xff;
  const gA = (pA >>> 8) & 0xff;
  const bA = (pA >>> 16) & 0xff;
  const rB = pB & 0xff;
  const gB = (pB >>> 8) & 0xff;
  const bB = (pB >>> 16) & 0xff;
  const distSq = (rA - rB) * (rA - rB) + (gA - gB) * (gA - gB) + (bA - bB) * (bA - bB);
  return distSq <= 300;
}

/**
 * Upscales `img` by 2x using the classic Scale2x (AdvMAME2x) pixel-art edge-preserving algorithm.
 * When `rotSpriteSimilarity` is true, applies Xenowhirl's RotSprite similarity heuristic.
 */
export function scale2xImage(img: PixelImage, rotSpriteSimilarity = false): PixelImage {
  const w = img.width;
  const h = img.height;
  const out = new PixelImage(w * 2, h * 2, img.colorMode);

  const getClamped = (x: number, y: number): number =>
    img.getPixel(clamp(x, 0, w - 1), clamp(y, 0, h - 1));

  const eq = (a: number, b: number) => pixelsSimilar(img, a, b, rotSpriteSimilarity);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const P = getClamped(x, y);
      const A = getClamped(x, y - 1);
      const B = getClamped(x + 1, y);
      const C = getClamped(x - 1, y);
      const D = getClamped(x, y + 1);

      let E0 = P;
      let E1 = P;
      let E2 = P;
      let E3 = P;

      if (!eq(C, B) && !eq(A, D)) {
        if (eq(C, A)) E0 = A;
        if (eq(A, B)) E1 = B;
        if (eq(C, D)) E2 = C;
        if (eq(B, D)) E3 = D;
      }

      const dx = x * 2;
      const dy = y * 2;
      out.putPixel(dx, dy, E0);
      out.putPixel(dx + 1, dy, E1);
      out.putPixel(dx, dy + 1, E2);
      out.putPixel(dx + 1, dy + 1, E3);
    }
  }
  return out;
}

/**
 * Upscales `img` by 2x using the classic Eagle 2x pixel-art corner-smoothing algorithm.
 */
export function eagleScaleImage(img: PixelImage): PixelImage {
  const w = img.width;
  const h = img.height;
  const out = new PixelImage(w * 2, h * 2, img.colorMode);

  const getClamped = (x: number, y: number): number =>
    img.getPixel(clamp(x, 0, w - 1), clamp(y, 0, h - 1));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const C = getClamped(x, y);
      const S = getClamped(x - 1, y - 1);
      const T = getClamped(x, y - 1);
      const U = getClamped(x + 1, y - 1);
      const V = getClamped(x - 1, y);
      const W = getClamped(x + 1, y);
      const X = getClamped(x - 1, y + 1);
      const Y = getClamped(x, y + 1);
      const Z = getClamped(x + 1, y + 1);

      const p0 = V === S && S === T ? S : C;
      const p1 = T === U && U === W ? U : C;
      const p2 = V === X && X === Y ? X : C;
      const p3 = W === Z && Z === Y ? Z : C;

      const dx = x * 2;
      const dy = y * 2;
      out.putPixel(dx, dy, p0);
      out.putPixel(dx + 1, dy, p1);
      out.putPixel(dx, dy + 1, p2);
      out.putPixel(dx + 1, dy + 1, p3);
    }
  }
  return out;
}

/**
 * Scales `img` to `(targetWidth, targetHeight)` using crisp Nearest-Neighbor sampling.
 */
export function scaleImageNearest(
  img: PixelImage,
  targetWidth: number,
  targetHeight: number
): PixelImage {
  const tw = Math.max(1, Math.floor(targetWidth));
  const th = Math.max(1, Math.floor(targetHeight));
  const out = new PixelImage(tw, th, img.colorMode);
  for (let y = 0; y < th; y++) {
    const sy = clamp(Math.floor((y * img.height) / th), 0, img.height - 1);
    for (let x = 0; x < tw; x++) {
      const sx = clamp(Math.floor((x * img.width) / tw), 0, img.width - 1);
      out.putPixel(x, y, img.getPixel(sx, sy));
    }
  }
  return out;
}

/**
 * Scales `img` to `(targetWidth, targetHeight)` using Bilinear interpolation (for RGBA/Grayscale).
 * If `img` is Indexed, falls back to Nearest-Neighbor to preserve palette indices cleanly.
 */
export function scaleImageBilinear(
  img: PixelImage,
  targetWidth: number,
  targetHeight: number,
  palette?: readonly RGBA[],
  transparentIndex = 0
): PixelImage {
  if (img.colorMode === "indexed") {
    return scaleImageNearest(img, targetWidth, targetHeight);
  }
  const tw = Math.max(1, Math.floor(targetWidth));
  const th = Math.max(1, Math.floor(targetHeight));
  const out = new PixelImage(tw, th, img.colorMode);

  for (let y = 0; y < th; y++) {
    const fy = ((y + 0.5) * img.height) / th - 0.5;
    const y0 = clamp(Math.floor(fy), 0, img.height - 1);
    const y1 = clamp(y0 + 1, 0, img.height - 1);
    const wy = clamp(fy - y0, 0, 1);

    for (let x = 0; x < tw; x++) {
      const fx = ((x + 0.5) * img.width) / tw - 0.5;
      const x0 = clamp(Math.floor(fx), 0, img.width - 1);
      const x1 = clamp(x0 + 1, 0, img.width - 1);
      const wx = clamp(fx - x0, 0, 1);

      const c00 = img.getRGBA(x0, y0, palette, transparentIndex);
      const c10 = img.getRGBA(x1, y0, palette, transparentIndex);
      const c01 = img.getRGBA(x0, y1, palette, transparentIndex);
      const c11 = img.getRGBA(x1, y1, palette, transparentIndex);

      const w00 = (1 - wx) * (1 - wy);
      const w10 = wx * (1 - wy);
      const w01 = (1 - wx) * wy;
      const w11 = wx * wy;

      const r = Math.round(c00.r * w00 + c10.r * w10 + c01.r * w01 + c11.r * w11);
      const g = Math.round(c00.g * w00 + c10.g * w10 + c01.g * w01 + c11.g * w11);
      const b = Math.round(c00.b * w00 + c10.b * w10 + c01.b * w01 + c11.b * w11);
      const a = Math.round(c00.a * w00 + c10.a * w10 + c01.a * w01 + c11.a * w11);

      out.setRGBA(x, y, { r, g, b, a }, palette, transparentIndex);
    }
  }
  return out;
}

/**
 * Rotates `img` by `angleDeg` around `pivot` (defaults to image center) using fast Nearest-Neighbor inverse mapping.
 */
export function rotateImageFast(
  img: PixelImage,
  angleDeg: number,
  pivot?: Point
): PixelImage {
  const normAngle = ((angleDeg % 360) + 360) % 360;
  if (Math.abs(normAngle) < 0.01 || Math.abs(normAngle - 360) < 0.01) {
    return img.clone();
  }

  const w = img.width;
  const h = img.height;
  const out = new PixelImage(w, h, img.colorMode);
  const cx = pivot ? pivot.x : w / 2;
  const cy = pivot ? pivot.y : h / 2;
  const rad = (-angleDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  for (let y = 0; y < h; y++) {
    const dy = y + 0.5 - cy;
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx;
      const sx = Math.floor(cx + dx * cosA - dy * sinA);
      const sy = Math.floor(cy + dx * sinA + dy * cosA);
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) {
        out.putPixel(x, y, img.getPixel(sx, sy));
      }
    }
  }
  return out;
}

/**
 * Implements the public **RotSprite** algorithm (Xenowhirl) for clean pixel-art rotation:
 * 1. Upscale 3 times using modified Scale2x (`2x -> 4x -> 8x`).
 * 2. Rotate the 8x buffer by `angleDeg` around `pivot * 8`.
 * 3. Downscale 1/8x using nearest-neighbor sampling back to `(img.width, img.height)`.
 */
export function rotSpriteRotate(
  img: PixelImage,
  angleDeg: number,
  pivot?: Point
): PixelImage {
  const normAngle = ((angleDeg % 360) + 360) % 360;
  if (Math.abs(normAngle) < 0.01 || Math.abs(normAngle - 360) < 0.01) {
    return img.clone();
  }

  // For huge canvases (> 256px), cap upscale steps to 2x/4x so interactive preview stays 60fps
  const maxDim = Math.max(img.width, img.height);
  const steps = maxDim <= 128 ? 3 : maxDim <= 256 ? 2 : 1;
  const factor = 1 << steps; // 8, 4, or 2

  let up = img;
  for (let s = 0; s < steps; s++) {
    up = scale2xImage(up, true);
  }

  const upPivot = pivot
    ? { x: pivot.x * factor, y: pivot.y * factor }
    : { x: up.width / 2, y: up.height / 2 };

  const rotatedUp = rotateImageFast(up, angleDeg, upPivot);

  const out = new PixelImage(img.width, img.height, img.colorMode);
  const half = Math.floor(factor / 2);
  for (let y = 0; y < img.height; y++) {
    const sy = clamp(y * factor + half, 0, rotatedUp.height - 1);
    for (let x = 0; x < img.width; x++) {
      const sx = clamp(x * factor + half, 0, rotatedUp.width - 1);
      out.putPixel(x, y, rotatedUp.getPixel(sx, sy));
    }
  }
  return out;
}

/**
 * Applies horizontal and vertical skew/shear in degrees around the center of `img`.
 */
export function skewImage(
  img: PixelImage,
  skewXDeg: number,
  skewYDeg: number
): PixelImage {
  if (Math.abs(skewXDeg) < 0.01 && Math.abs(skewYDeg) < 0.01) {
    return img.clone();
  }
  const w = img.width;
  const h = img.height;
  const out = new PixelImage(w, h, img.colorMode);
  const cx = w / 2;
  const cy = h / 2;
  const tanX = Math.tan((clamp(skewXDeg, -75, 75) * Math.PI) / 180);
  const tanY = Math.tan((clamp(skewYDeg, -75, 75) * Math.PI) / 180);

  for (let y = 0; y < h; y++) {
    const dy = y + 0.5 - cy;
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx;
      const sx = Math.floor(cx + dx - dy * tanX);
      const sy = Math.floor(cy + dy - dx * tanY);
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) {
        out.putPixel(x, y, img.getPixel(sx, sy));
      }
    }
  }
  return out;
}

/**
 * Flips `img` horizontally (mirror left-right).
 */
export function flipImageHorizontal(img: PixelImage): PixelImage {
  const out = new PixelImage(img.width, img.height, img.colorMode);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      out.putPixel(img.width - 1 - x, y, img.getPixel(x, y));
    }
  }
  return out;
}

/**
 * Flips `img` vertically (mirror top-bottom).
 */
export function flipImageVertical(img: PixelImage): PixelImage {
  const out = new PixelImage(img.width, img.height, img.colorMode);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      out.putPixel(x, img.height - 1 - y, img.getPixel(x, y));
    }
  }
  return out;
}

/**
 * Rotates `img` orthogonally by 90° CW, 90° CCW, or 180°.
 */
export function rotateImageOrthogonal(
  img: PixelImage,
  direction: "90cw" | "90ccw" | "180"
): PixelImage {
  const w = img.width;
  const h = img.height;
  if (direction === "180") {
    const out = new PixelImage(w, h, img.colorMode);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        out.putPixel(w - 1 - x, h - 1 - y, img.getPixel(x, y));
      }
    }
    return out;
  }

  const out = new PixelImage(h, w, img.colorMode);
  if (direction === "90cw") {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        out.putPixel(h - 1 - y, x, img.getPixel(x, y));
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        out.putPixel(y, w - 1 - x, img.getPixel(x, y));
      }
    }
  }
  return out;
}

/**
 * Shifts pixels in `img` by `(dx, dy)` with toroidal wrap-around.
 * If a non-empty `mask` is supplied, wraps only within the mask's bounding rectangle.
 */
export function shiftImageWrap(
  img: PixelImage,
  dx: number,
  dy: number,
  mask?: Mask
): PixelImage {
  const out = img.clone();
  const bounds =
    mask && !mask.isEmpty && mask.bounds
      ? mask.bounds
      : { x: 0, y: 0, width: img.width, height: img.height };

  const rw = bounds.width;
  const rh = bounds.height;
  if (rw <= 0 || rh <= 0) return out;

  for (let ry = 0; ry < rh; ry++) {
    for (let rx = 0; rx < rw; rx++) {
      const dstX = bounds.x + rx;
      const dstY = bounds.y + ry;
      if (mask && !mask.isEmpty && !mask.getBit(dstX, dstY)) continue;

      const srcRx = (((rx - dx) % rw) + rw) % rw;
      const srcRy = (((ry - dy) % rh) + rh) % rh;
      const srcX = bounds.x + srcRx;
      const srcY = bounds.y + srcRy;
      out.putPixel(dstX, dstY, img.getPixel(srcX, srcY));
    }
  }
  return out;
}

/**
 * Lifts selected pixels from `celImage` into a `FloatingSelectionState` and optionally clears
 * the selected pixels in the returned `clearedBase` image (when `copyMode` is false).
 */
export function liftSelectionFromImage(
  celImage: PixelImage,
  mask: Mask,
  copyMode = false,
  transparentIndex = 0
): {
  floating: FloatingSelectionState;
  clearedBase: PixelImage;
} {
  const bounds = mask.bounds ?? {
    x: 0,
    y: 0,
    width: celImage.width,
    height: celImage.height,
  };
  const useFull = mask.isEmpty;

  const sourceImage = new PixelImage(bounds.width, bounds.height, celImage.colorMode);
  const localMask = new Mask(bounds.width, bounds.height);
  const clearedBase = celImage.clone();
  const clearVal = celImage.colorMode === "indexed" ? transparentIndex : 0;

  for (let ly = 0; ly < bounds.height; ly++) {
    for (let lx = 0; lx < bounds.width; lx++) {
      const gx = bounds.x + lx;
      const gy = bounds.y + ly;
      const selected = useFull || mask.getBit(gx, gy);
      if (selected) {
        localMask.setBit(lx, ly, true);
        sourceImage.putPixel(lx, ly, celImage.getPixel(gx, gy));
        if (!copyMode) {
          clearedBase.putPixel(gx, gy, clearVal);
        }
      } else {
        sourceImage.putPixel(lx, ly, clearVal);
      }
    }
  }
  localMask.recalcBounds();

  const floating: FloatingSelectionState = {
    sourceImage,
    localMask,
    originX: bounds.x,
    originY: bounds.y,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    angleDeg: 0,
    skewXDeg: 0,
    skewYDeg: 0,
    pivotRelX: 0.5,
    pivotRelY: 0.5,
    algorithm: "rotsprite",
  };

  return { floating, clearedBase };
}

/**
 * Multiplies two 2D affine matrices `m1 * m2`.
 */
export function multiplyTransformMatrices(
  m1: TransformMatrix2D,
  m2: TransformMatrix2D
): TransformMatrix2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    tx: m1.a * m2.tx + m1.c * m2.ty + m1.tx,
    ty: m1.b * m2.tx + m1.d * m2.ty + m1.ty,
  };
}

/**
 * Applies a 2D affine matrix `m` to point `pt`.
 */
export function applyMatrixToPoint(m: TransformMatrix2D, pt: Point): Point {
  return {
    x: m.a * pt.x + m.c * pt.y + m.tx,
    y: m.b * pt.x + m.d * pt.y + m.ty,
  };
}

/**
 * Computes the inverse of a 2D affine matrix `m`.
 */
export function invertTransformMatrix2D(m: TransformMatrix2D): TransformMatrix2D {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-8) {
    return { a: 1, b: 0, c: 0, d: 1, tx: -m.tx, ty: -m.ty };
  }
  const invDet = 1 / det;
  const a = m.d * invDet;
  const b = -m.b * invDet;
  const c = -m.c * invDet;
  const d = m.a * invDet;
  return {
    a,
    b,
    c,
    d,
    tx: -(a * m.tx + c * m.ty),
    ty: -(b * m.tx + d * m.ty),
  };
}

/**
 * Composes the full 2D affine transformation matrix for a `FloatingSelectionState` (B01),
 * mapping local scaled box coordinates `(0..width, 0..height)` into sprite canvas coordinates.
 */
export function composeFloatingTransformMatrix(
  state: FloatingSelectionState
): TransformMatrix2D {
  const w = Math.max(1, state.width);
  const h = Math.max(1, state.height);
  const px = w * state.pivotRelX;
  const py = h * state.pivotRelY;

  const rad = (state.angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const tanX = Math.tan((clamp(state.skewXDeg, -75, 75) * Math.PI) / 180);
  const tanY = Math.tan((clamp(state.skewYDeg, -75, 75) * Math.PI) / 180);

  // T(x + px, y + py) * R(angle) * Skew(tanX, tanY) * T(-px, -py)
  const m00 = cos - sin * tanY;
  const m01 = cos * tanX - sin;
  const m10 = sin + cos * tanY;
  const m11 = sin * tanX + cos;

  return {
    a: m00,
    b: m10,
    c: m01,
    d: m11,
    tx: state.x + px - (m00 * px + m01 * py),
    ty: state.y + py - (m10 * px + m11 * py),
  };
}

/**
 * Computes the axis-aligned sprite bounding box of a transformed `FloatingSelectionState` (B01).
 */
export function computeTransformedBounds(state: FloatingSelectionState): Rect {
  const w = Math.max(1, Math.round(state.width));
  const h = Math.max(1, Math.round(state.height));
  if (
    Math.abs(state.angleDeg % 360) < 0.01 &&
    Math.abs(state.skewXDeg) < 0.01 &&
    Math.abs(state.skewYDeg) < 0.01
  ) {
    return {
      x: Math.round(state.x),
      y: Math.round(state.y),
      width: w,
      height: h,
    };
  }
  const m = composeFloatingTransformMatrix(state);
  const corners = [
    applyMatrixToPoint(m, { x: 0, y: 0 }),
    applyMatrixToPoint(m, { x: w, y: 0 }),
    applyMatrixToPoint(m, { x: w, y: h }),
    applyMatrixToPoint(m, { x: 0, y: h }),
  ];
  const minX = Math.floor(Math.min(...corners.map((p) => p.x)));
  const minY = Math.floor(Math.min(...corners.map((p) => p.y)));
  const maxX = Math.ceil(Math.max(...corners.map((p) => p.x)));
  const maxY = Math.ceil(Math.max(...corners.map((p) => p.y)));
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * Flips a `FloatingSelectionState` horizontally in-place (both `sourceImage` and `localMask`),
 * keeping the transform matrix and pivot consistent (B21).
 */
export function flipFloatingSelectionHorizontal(
  state: FloatingSelectionState
): FloatingSelectionState {
  return {
    ...state,
    sourceImage: flipImageHorizontal(state.sourceImage),
    localMask: flipMaskHorizontal(state.localMask, {
      x: 0,
      y: 0,
      width: state.localMask.width,
      height: state.localMask.height,
    }),
    angleDeg: state.angleDeg !== 0 ? -state.angleDeg : 0,
    skewXDeg: state.skewXDeg !== 0 ? -state.skewXDeg : 0,
    pivotRelX: Number((1 - state.pivotRelX).toFixed(4)),
  };
}

/**
 * Flips a `FloatingSelectionState` vertically in-place (both `sourceImage` and `localMask`),
 * keeping the transform matrix and pivot consistent (B21).
 */
export function flipFloatingSelectionVertical(
  state: FloatingSelectionState
): FloatingSelectionState {
  return {
    ...state,
    sourceImage: flipImageVertical(state.sourceImage),
    localMask: flipMaskVertical(state.localMask, {
      x: 0,
      y: 0,
      width: state.localMask.width,
      height: state.localMask.height,
    }),
    angleDeg: state.angleDeg !== 0 ? -state.angleDeg : 0,
    skewYDeg: state.skewYDeg !== 0 ? -state.skewYDeg : 0,
    pivotRelY: Number((1 - state.pivotRelY).toFixed(4)),
  };
}

/**
 * Renders the current transformed `FloatingSelectionState` into an unclipped `PixelImage` and local `Mask`,
 * along with the `(offsetX, offsetY)` relative to `(Math.round(state.x), Math.round(state.y))` so rotated
 * corners are never clipped (B01).
 */
export function renderFloatingTransformWithBounds(
  state: FloatingSelectionState,
  palette?: readonly RGBA[],
  transparentIndex = 0
): { image: PixelImage; localMask: Mask; offsetX: number; offsetY: number } {
  const targetW = Math.max(1, Math.round(state.width));
  const targetH = Math.max(1, Math.round(state.height));

  // 1. Scale image & localMask
  let current: PixelImage;
  if (targetW === state.sourceImage.width && targetH === state.sourceImage.height) {
    current = state.sourceImage.clone();
  } else if (state.algorithm === "bilinear") {
    current = scaleImageBilinear(state.sourceImage, targetW, targetH, palette, transparentIndex);
  } else {
    current = scaleImageNearest(state.sourceImage, targetW, targetH);
  }

  let scaledMask = new Mask(targetW, targetH);
  if (state.localMask.isEmpty) {
    scaledMask.selectAll();
  } else {
    for (let y = 0; y < targetH; y++) {
      const sy = clamp(Math.floor((y * state.localMask.height) / targetH), 0, state.localMask.height - 1);
      for (let x = 0; x < targetW; x++) {
        const sx = clamp(Math.floor((x * state.localMask.width) / targetW), 0, state.localMask.width - 1);
        if (state.localMask.getBit(sx, sy)) {
          scaledMask.setBit(x, y, true);
        }
      }
    }
    scaledMask.recalcBounds();
  }

  const hasSkew = Math.abs(state.skewXDeg) >= 0.1 || Math.abs(state.skewYDeg) >= 0.1;
  const hasRot = Math.abs(state.angleDeg % 360) >= 0.1;

  if (!hasSkew && !hasRot) {
    return { image: current, localMask: scaledMask, offsetX: 0, offsetY: 0 };
  }

  // Pad canvas around pivot so rotation/skew never clips corners (B01)
  const diag = Math.ceil(Math.hypot(targetW, targetH));
  const padX = Math.max(0, Math.ceil((diag - targetW) / 2) + 2);
  const padY = Math.max(0, Math.ceil((diag - targetH) / 2) + 2);
  const expW = targetW + padX * 2;
  const expH = targetH + padY * 2;

  const clearVal = current.colorMode === "indexed" ? transparentIndex : 0;
  let padded = new PixelImage(expW, expH, current.colorMode);
  if (clearVal !== 0) padded.clear(clearVal);
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      padded.putPixel(padX + x, padY + y, current.getPixel(x, y));
    }
  }

  let maskImg = new PixelImage(expW, expH, "rgba");
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      if (scaledMask.getBit(x, y)) {
        maskImg.setRGBA(padX + x, padY + y, { r: 255, g: 255, b: 255, a: 255 });
      }
    }
  }

  if (hasSkew) {
    padded = skewImage(padded, state.skewXDeg, state.skewYDeg);
    maskImg = skewImage(maskImg, state.skewXDeg, state.skewYDeg);
  }

  if (hasRot) {
    const pivot = {
      x: padX + targetW * state.pivotRelX,
      y: padY + targetH * state.pivotRelY,
    };
    if (state.algorithm === "rotsprite") {
      padded = rotSpriteRotate(padded, state.angleDeg, pivot);
    } else {
      padded = rotateImageFast(padded, state.angleDeg, pivot);
    }
    maskImg = rotateImageFast(maskImg, state.angleDeg, pivot);
  }

  const outMask = new Mask(expW, expH);
  for (let y = 0; y < expH; y++) {
    for (let x = 0; x < expW; x++) {
      const hasAlpha = padded.getRGBA(x, y, palette, transparentIndex).a > 0;
      if (maskImg.getRGBA(x, y).a > 0 || hasAlpha) {
        outMask.setBit(x, y, true);
      }
    }
  }
  outMask.recalcBounds();

  return {
    image: padded,
    localMask: outMask,
    offsetX: -padX,
    offsetY: -padY,
  };
}

/**
 * Renders the current transformed `FloatingSelectionState` into a standalone `PixelImage`
 * ready for live preview blitting or final commit.
 */
export function renderFloatingTransform(
  state: FloatingSelectionState,
  palette?: readonly RGBA[],
  transparentIndex = 0
): PixelImage {
  const targetW = Math.max(1, Math.round(state.width));
  const targetH = Math.max(1, Math.round(state.height));

  // 1. Scale
  let current: PixelImage;
  if (targetW === state.sourceImage.width && targetH === state.sourceImage.height) {
    current = state.sourceImage.clone();
  } else if (state.algorithm === "bilinear") {
    current = scaleImageBilinear(state.sourceImage, targetW, targetH, palette, transparentIndex);
  } else {
    current = scaleImageNearest(state.sourceImage, targetW, targetH);
  }

  // 2. Skew
  if (Math.abs(state.skewXDeg) >= 0.1 || Math.abs(state.skewYDeg) >= 0.1) {
    current = skewImage(current, state.skewXDeg, state.skewYDeg);
  }

  // 3. Rotate around pivot
  if (Math.abs(state.angleDeg % 360) >= 0.1) {
    const pivot = {
      x: current.width * state.pivotRelX,
      y: current.height * state.pivotRelY,
    };
    if (state.algorithm === "rotsprite") {
      current = rotSpriteRotate(current, state.angleDeg, pivot);
    } else {
      current = rotateImageFast(current, state.angleDeg, pivot);
    }
  }

  return current;
}

/**
 * Commits a `FloatingSelectionState` onto `baseImage` and returns the updated image plus the new selection mask.
 */
export function commitFloatingSelectionToImage(
  baseImage: PixelImage,
  state: FloatingSelectionState,
  palette?: readonly RGBA[],
  transparentIndex = 0
): { image: PixelImage; mask: Mask } {
  const outImage = baseImage.clone();
  const { image: transformed, localMask, offsetX, offsetY } = renderFloatingTransformWithBounds(
    state,
    palette,
    transparentIndex
  );
  const outMask = new Mask(baseImage.width, baseImage.height);
  const baseX = Math.round(state.x) + offsetX;
  const baseY = Math.round(state.y) + offsetY;

  for (let sy = 0; sy < transformed.height; sy++) {
    const dy = baseY + sy;
    if (dy < 0 || dy >= outImage.height) continue;
    for (let sx = 0; sx < transformed.width; sx++) {
      const dx = baseX + sx;
      if (dx < 0 || dx >= outImage.width) continue;
      const inMask = localMask.getBit(sx, sy);
      if (!inMask) continue;
      outMask.setBit(dx, dy, true);
      const srcRgba = transformed.getRGBA(sx, sy, palette, transparentIndex);
      if (srcRgba.a === 0) continue;
      const dstRgba = outImage.getRGBA(dx, dy, palette, transparentIndex);
      const blended = blendRGBA(dstRgba, srcRgba, "normal", 255);
      outImage.setRGBA(dx, dy, blended, palette, transparentIndex);
    }
  }
  outMask.recalcBounds();
  return { image: outImage, mask: outMask };
}

/**
 * Fills all pixels selected by `mask` (or the entire image if `mask.isEmpty`) with `color`.
 */
export function fillSelectionOnImage(
  image: PixelImage,
  mask: Mask,
  color: RGBA,
  palette?: readonly RGBA[],
  transparentIndex = 0
): PixelImage {
  const out = image.clone();
  const fillAll = mask.isEmpty;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      if (fillAll || mask.getBit(x, y)) {
        out.setRGBA(x, y, color, palette, transparentIndex);
      }
    }
  }
  return out;
}

/**
 * Strokes the inner border of `mask` (or the canvas border if `mask.isEmpty`) with `color` and `borderWidth`.
 */
export function strokeSelectionOnImage(
  image: PixelImage,
  mask: Mask,
  color: RGBA,
  borderWidth = 1,
  shape: "square" | "circle" = "square",
  palette?: readonly RGBA[],
  transparentIndex = 0
): PixelImage {
  let effectiveMask = mask;
  if (mask.isEmpty) {
    effectiveMask = new Mask(image.width, image.height);
    effectiveMask.selectAll();
  }
  const strokeMask = borderMask(effectiveMask, borderWidth, shape);
  return fillSelectionOnImage(image, strokeMask, color, palette, transparentIndex);
}
