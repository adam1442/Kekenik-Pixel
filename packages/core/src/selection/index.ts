/**
 * @module @kekenik/core/selection
 * Pure TypeScript selection algorithms for Rectangular Marquee, Elliptical Marquee,
 * Freehand Lasso, Polygonal Lasso, Magic Wand, Color Range, Boolean Mask Combinations
 * (Replace, Add, Subtract, Intersect), Selection Modifiers (Expand, Contract, Border, Feather),
 * Mask Translation, Named Saved Selections, and Pixel-Exact Marching Ants Edge Extraction.
 * Zero DOM, React, or Electron imports.
 */

import {
  base64ToUint8,
  compositeFrame,
  getCel,
  getPaletteForFrame,
  Mask,
  PixelImage,
  ReadonlySprite,
  SavedMaskEntry,
  uint8ToBase64,
  createModelId,
} from "../model/index.ts";
import { clamp, Point, Rect, RGBA } from "../util/index.ts";

export type SelectionCombineMode = "replace" | "add" | "subtract" | "intersect";
export type MarqueeConstraintMode = "free" | "fixed_ratio" | "fixed_size";
export type SelectionModifyShape = "square" | "circle";

export interface MarqueeShapeOptions {
  constraint?: MarqueeConstraintMode;
  ratioW?: number;
  ratioH?: number;
  fixedW?: number;
  fixedH?: number;
  proportional?: boolean;
  fromCenter?: boolean;
}

export interface MagicWandOptions {
  tolerance: number; // 0..255
  contiguous: boolean;
  eightConnected: boolean;
  palette?: readonly RGBA[];
  transparentIndex?: number;
}

export interface MarchingAntSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * Resolves the effective selection combination mode from the Context Bar default mode
 * and keyboard modifiers matching Aseprite 1.3 (`Shift` = Add, `Alt` = Subtract, `Shift+Alt` = Intersect).
 */
export function resolveSelectionMode(
  baseMode: SelectionCombineMode,
  shiftKey: boolean,
  altKey: boolean
): SelectionCombineMode {
  if (shiftKey && altKey) return "intersect";
  if (shiftKey) return "add";
  if (altKey) return "subtract";
  return baseMode;
}

/**
 * Combines an `existing` selection mask with an `incoming` selection mask using the given boolean mode.
 */
export function combineMasks(
  existing: Mask,
  incoming: Mask,
  mode: SelectionCombineMode
): Mask {
  const w = existing.width;
  const h = existing.height;
  const out = new Mask(w, h);

  if (mode === "replace") {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (incoming.getBit(x, y)) out.setBit(x, y, true);
      }
    }
    out.recalcBounds();
    return out;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = existing.getBit(x, y);
      const b = incoming.getBit(x, y);
      let sel = false;
      if (mode === "add") {
        sel = a || b;
      } else if (mode === "subtract") {
        sel = a && !b;
      } else if (mode === "intersect") {
        sel = a && b;
      }
      if (sel) out.setBit(x, y, true);
    }
  }
  out.recalcBounds();
  return out;
}

/**
 * Computes the constrained marquee rectangle from `start` and `end` points.
 */
export function computeMarqueeRect(
  start: Point,
  end: Point,
  options: MarqueeShapeOptions = {}
): Rect {
  const constraint = options.constraint ?? "free";

  if (constraint === "fixed_size") {
    const fw = Math.max(1, Math.floor(options.fixedW ?? 16));
    const fh = Math.max(1, Math.floor(options.fixedH ?? 16));
    if (options.fromCenter) {
      return {
        x: Math.round(end.x - fw / 2),
        y: Math.round(end.y - fh / 2),
        width: fw,
        height: fh,
      };
    }
    return { x: end.x, y: end.y, width: fw, height: fh };
  }

  let dx = end.x - start.x;
  let dy = end.y - start.y;

  if (options.proportional) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = dx < 0 ? -side : side;
    dy = dy < 0 ? -side : side;
  } else if (constraint === "fixed_ratio") {
    const rw = Math.max(1, options.ratioW ?? 1);
    const rh = Math.max(1, options.ratioH ?? 1);
    const absW = Math.abs(dx) + 1;
    const targetH = Math.max(1, Math.round((absW * rh) / rw));
    dy = dy < 0 ? -(targetH - 1) : targetH - 1;
  }

  if (options.fromCenter) {
    const rx = Math.abs(dx);
    const ry = Math.abs(dy);
    return {
      x: start.x - rx,
      y: start.y - ry,
      width: rx * 2 + 1,
      height: ry * 2 + 1,
    };
  }

  const x0 = Math.min(start.x, start.x + dx);
  const y0 = Math.min(start.y, start.y + dy);
  const width = Math.abs(dx) + 1;
  const height = Math.abs(dy) + 1;
  return { x: x0, y: y0, width, height };
}

/**
 * Generates a rectangular marquee Mask of size `(width, height)`.
 */
export function createRectMarqueeMask(
  width: number,
  height: number,
  start: Point,
  end: Point,
  options: MarqueeShapeOptions = {}
): Mask {
  const mask = new Mask(width, height);
  const rect = computeMarqueeRect(start, end, options);
  mask.selectRect(rect, false);
  return mask;
}

/**
 * Generates an elliptical marquee Mask inside the bounding rectangle defined by `start` and `end`.
 */
export function createEllipseMarqueeMask(
  width: number,
  height: number,
  start: Point,
  end: Point,
  options: MarqueeShapeOptions = {}
): Mask {
  const mask = new Mask(width, height);
  const rect = computeMarqueeRect(start, end, options);
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  const cx = rect.x + rx;
  const cy = rect.y + ry;

  if (rx <= 0.5 || ry <= 0.5) {
    mask.selectRect(rect, false);
    return mask;
  }

  const x0 = clamp(rect.x, 0, width);
  const y0 = clamp(rect.y, 0, height);
  const x1 = clamp(rect.x + rect.width, 0, width);
  const y1 = clamp(rect.y + rect.height, 0, height);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny <= 1.0) {
        mask.setBit(x, y, true);
      }
    }
  }
  mask.recalcBounds();
  return mask;
}

/**
 * Generates a filled polygon selection Mask from an array of polygon or freehand lasso vertices
 * using scanline even-odd / winding interior fill plus boundary rasterization.
 */
export function createPolygonLassoMask(
  width: number,
  height: number,
  vertices: readonly Point[]
): Mask {
  const mask = new Mask(width, height);
  if (vertices.length === 0) return mask;
  if (vertices.length === 1) {
    mask.setBit(vertices[0].x, vertices[0].y, true);
    mask.recalcBounds();
    return mask;
  }

  let minY = height - 1;
  let maxY = 0;
  for (const v of vertices) {
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  minY = clamp(minY, 0, height - 1);
  maxY = clamp(maxY, 0, height - 1);

  // Rasterize polygon edges so thin 1px tips are always included
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    let x0 = a.x;
    let y0 = a.y;
    const x1 = b.x;
    const y1 = b.y;
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
      mask.setBit(x0, y0, true);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  // Scanline interior fill
  for (let y = minY; y <= maxY; y++) {
    const intersections: number[] = [];
    const scanY = y + 0.5;
    for (let i = 0; i < vertices.length; i++) {
      const p1 = vertices[i];
      const p2 = vertices[(i + 1) % vertices.length];
      const y1 = p1.y + 0.5;
      const y2 = p2.y + 0.5;
      if ((y1 <= scanY && y2 > scanY) || (y2 <= scanY && y1 > scanY)) {
        const t = (scanY - y1) / (y2 - y1);
        const ix = p1.x + 0.5 + t * (p2.x - p1.x);
        intersections.push(ix);
      }
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const startX = clamp(Math.floor(intersections[i]), 0, width - 1);
      const endX = clamp(Math.floor(intersections[i + 1]), 0, width - 1);
      for (let x = startX; x <= endX; x++) {
        mask.setBit(x, y, true);
      }
    }
  }

  mask.recalcBounds();
  return mask;
}

/**
 * Computes maximum per-channel RGBA distance (0..255) for Magic Wand and Color Range matching.
 */
export function colorDistanceTolerance(a: RGBA, b: RGBA): number {
  if (a.a === 0 && b.a === 0) return 0;
  return Math.max(
    Math.abs(a.r - b.r),
    Math.abs(a.g - b.g),
    Math.abs(a.b - b.b),
    Math.abs(a.a - b.a)
  );
}

/**
 * Generates a selection Mask using the Magic Wand tool at `(seedX, seedY)` with configurable
 * tolerance (0..255), contiguous vs global matching, and 4/8-way connectivity.
 */
export function createMagicWandMask(
  image: PixelImage,
  seedX: number,
  seedY: number,
  options: MagicWandOptions
): Mask {
  const w = image.width;
  const h = image.height;
  const mask = new Mask(w, h);
  if (seedX < 0 || seedY < 0 || seedX >= w || seedY >= h) return mask;

  const tol = clamp(options.tolerance, 0, 255);
  const seedColor = image.getRGBA(seedX, seedY, options.palette, options.transparentIndex ?? 0);

  const matchesSeed = (x: number, y: number): boolean => {
    const c = image.getRGBA(x, y, options.palette, options.transparentIndex ?? 0);
    return colorDistanceTolerance(seedColor, c) <= tol;
  };

  if (!options.contiguous) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (matchesSeed(x, y)) {
          mask.setBit(x, y, true);
        }
      }
    }
    mask.recalcBounds();
    return mask;
  }

  const visited = new Uint8Array(w * h);
  const queueX = new Int32Array(w * h);
  const queueY = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  queueX[tail] = seedX;
  queueY[tail] = seedY;
  tail++;
  visited[seedY * w + seedX] = 1;

  const dirs4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const dirs8 = [
    ...dirs4,
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  const dirs = options.eightConnected ? dirs8 : dirs4;

  while (head < tail) {
    const cx = queueX[head];
    const cy = queueY[head];
    head++;
    mask.setBit(cx, cy, true);

    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const idx = ny * w + nx;
      if (visited[idx]) continue;
      visited[idx] = 1;
      if (matchesSeed(nx, ny)) {
        queueX[tail] = nx;
        queueY[tail] = ny;
        tail++;
      }
    }
  }

  mask.recalcBounds();
  return mask;
}

/**
 * Selects all pixels across `image` within `fuzziness` (0..255) distance of `targetColor`.
 */
export function selectByColorRange(
  image: PixelImage,
  targetColor: RGBA,
  fuzziness: number,
  palette?: readonly RGBA[],
  transparentIndex = 0
): Mask {
  const mask = new Mask(image.width, image.height);
  const tol = clamp(fuzziness, 0, 255);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const c = image.getRGBA(x, y, palette, transparentIndex);
      if (colorDistanceTolerance(targetColor, c) <= tol) {
        mask.setBit(x, y, true);
      }
    }
  }
  mask.recalcBounds();
  return mask;
}

/**
 * Selects all non-transparent pixels in a specific cel (`Select > Select Cel Content`) or
 * across the composited frame (`Select > Select Frame Content`).
 */
export function selectNonEmptyPixelsMask(
  sprite: ReadonlySprite,
  frameIndex: number,
  layerId?: string
): Mask {
  const mask = new Mask(sprite.width, sprite.height);
  const palette = getPaletteForFrame(sprite, frameIndex);
  if (layerId) {
    const cel = getCel(sprite, layerId, frameIndex);
    if (!cel) return mask;
    for (let y = 0; y < cel.image.height; y++) {
      for (let x = 0; x < cel.image.width; x++) {
        const rgba = cel.image.getRGBA(x, y, palette, sprite.transparentIndex);
        if (rgba.a > 0) {
          mask.setBit(cel.x + x, cel.y + y, true);
        }
      }
    }
  } else {
    const comp = compositeFrame(sprite, frameIndex);
    for (let y = 0; y < comp.height; y++) {
      for (let x = 0; x < comp.width; x++) {
        if (comp.getRGBA(x, y).a > 0) {
          mask.setBit(x, y, true);
        }
      }
    }
  }
  mask.recalcBounds();
  return mask;
}

function withinKernel(dx: number, dy: number, radius: number, shape: SelectionModifyShape): boolean {
  if (shape === "square") {
    return Math.abs(dx) <= radius && Math.abs(dy) <= radius;
  }
  return dx * dx + dy * dy <= radius * radius + 0.25;
}

/**
 * Morphologically expands (dilates) `mask` by `radius` pixels using a square or circle kernel.
 */
export function expandMask(
  mask: Mask,
  radius: number,
  shape: SelectionModifyShape = "square"
): Mask {
  const r = clamp(Math.floor(radius), 1, 64);
  const out = new Mask(mask.width, mask.height);
  if (mask.isEmpty) return out;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!mask.getBit(x, y)) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (withinKernel(dx, dy, r, shape)) {
            out.setBit(x + dx, y + dy, true);
          }
        }
      }
    }
  }
  out.recalcBounds();
  return out;
}

/**
 * Morphologically contracts (erodes) `mask` by `radius` pixels using a square or circle kernel.
 * Pixels touching the canvas edge are also eroded when their neighbor lies outside.
 */
export function contractMask(
  mask: Mask,
  radius: number,
  shape: SelectionModifyShape = "square"
): Mask {
  const r = clamp(Math.floor(radius), 1, 64);
  const out = new Mask(mask.width, mask.height);
  if (mask.isEmpty) return out;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!mask.getBit(x, y)) continue;
      let keep = true;
      for (let dy = -r; dy <= r && keep; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (!withinKernel(dx, dy, r, shape)) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height || !mask.getBit(nx, ny)) {
            keep = false;
            break;
          }
        }
      }
      if (keep) out.setBit(x, y, true);
    }
  }
  out.recalcBounds();
  return out;
}

/**
 * Creates a border selection of width `borderWidth` along the inner/outer boundary of `mask`.
 */
export function borderMask(
  mask: Mask,
  borderWidth: number,
  shape: SelectionModifyShape = "square"
): Mask {
  const bw = clamp(Math.floor(borderWidth), 1, 64);
  const out = new Mask(mask.width, mask.height);
  if (mask.isEmpty) return out;

  const innerContracted = contractMask(mask, bw, shape);
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.getBit(x, y) && !innerContracted.getBit(x, y)) {
        out.setBit(x, y, true);
      }
    }
  }
  out.recalcBounds();
  return out;
}

/**
 * Computes feather weights (`0..1`) and an expanded mask for feathered selection operations.
 */
export function featherMask(
  mask: Mask,
  radius: number
): { mask: Mask; weights: Float32Array } {
  const r = clamp(radius, 1, 32);
  const w = mask.width;
  const h = mask.height;
  const weights = new Float32Array(w * h);
  const outMask = new Mask(w, h);
  if (mask.isEmpty) return { mask: outMask, weights };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      const ir = Math.ceil(r);
      for (let dy = -ir; dy <= ir; dy++) {
        for (let dx = -ir; dx <= ir; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          count++;
          if (mask.getBit(x + dx, y + dy)) sum++;
        }
      }
      const weight = count > 0 ? sum / count : 0;
      weights[y * w + x] = weight;
      if (weight >= 0.25) {
        outMask.setBit(x, y, true);
      }
    }
  }
  outMask.recalcBounds();
  return { mask: outMask, weights };
}

/**
 * Translates a selection mask by `(dx, dy)` without modifying any cel pixels (`Ctrl+Shift+Drag`).
 */
export function translateMask(mask: Mask, dx: number, dy: number): Mask {
  const out = new Mask(mask.width, mask.height);
  if (mask.isEmpty) return out;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.getBit(x, y)) {
        out.setBit(x + dx, y + dy, true);
      }
    }
  }
  out.recalcBounds();
  return out;
}

/**
 * Flips a selection mask horizontally inside `bounds` (defaults to `mask.bounds`, or full canvas when `wholeCanvas` is true) (B21).
 */
export function flipMaskHorizontal(mask: Mask, bounds?: Rect): Mask {
  const out = new Mask(mask.width, mask.height);
  if (mask.isEmpty) return out;
  const b = bounds ?? mask.bounds ?? { x: 0, y: 0, width: mask.width, height: mask.height };
  for (let y = b.y; y < b.y + b.height; y++) {
    for (let x = b.x; x < b.x + b.width; x++) {
      if (mask.getBit(x, y)) {
        const fx = b.x + b.width - 1 - (x - b.x);
        out.setBit(fx, y, true);
      }
    }
  }
  out.recalcBounds();
  return out;
}

/**
 * Flips a selection mask vertically inside `bounds` (defaults to `mask.bounds`, or full canvas when `wholeCanvas` is true) (B21).
 */
export function flipMaskVertical(mask: Mask, bounds?: Rect): Mask {
  const out = new Mask(mask.width, mask.height);
  if (mask.isEmpty) return out;
  const b = bounds ?? mask.bounds ?? { x: 0, y: 0, width: mask.width, height: mask.height };
  for (let y = b.y; y < b.y + b.height; y++) {
    for (let x = b.x; x < b.x + b.width; x++) {
      if (mask.getBit(x, y)) {
        const fy = b.y + b.height - 1 - (y - b.y);
        out.setBit(x, fy, true);
      }
    }
  }
  out.recalcBounds();
  return out;
}

/**
 * Rotates a selection mask orthogonally (`90cw`, `90ccw`, `180`) either across the whole canvas or within `mask.bounds`.
 */
export function rotateMaskOrthogonal(
  mask: Mask,
  direction: "90cw" | "90ccw" | "180",
  wholeCanvas = false
): Mask {
  if (mask.isEmpty) {
    const nw = !wholeCanvas || direction === "180" ? mask.width : mask.height;
    const nh = !wholeCanvas || direction === "180" ? mask.height : mask.width;
    return new Mask(nw, nh);
  }
  if (wholeCanvas) {
    const w = mask.width;
    const h = mask.height;
    if (direction === "180") {
      const out = new Mask(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (mask.getBit(x, y)) out.setBit(w - 1 - x, h - 1 - y, true);
        }
      }
      out.recalcBounds();
      return out;
    }
    const out = new Mask(h, w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask.getBit(x, y)) continue;
        if (direction === "90cw") {
          out.setBit(h - 1 - y, x, true);
        } else {
          out.setBit(y, w - 1 - x, true);
        }
      }
    }
    out.recalcBounds();
    return out;
  }

  const b = mask.bounds!;
  const out = new Mask(mask.width, mask.height);
  if (direction === "180") {
    for (let ry = 0; ry < b.height; ry++) {
      for (let rx = 0; rx < b.width; rx++) {
        if (mask.getBit(b.x + rx, b.y + ry)) {
          out.setBit(b.x + b.width - 1 - rx, b.y + b.height - 1 - ry, true);
        }
      }
    }
    out.recalcBounds();
    return out;
  }
  for (let ry = 0; ry < b.height; ry++) {
    for (let rx = 0; rx < b.width; rx++) {
      if (!mask.getBit(b.x + rx, b.y + ry)) continue;
      if (direction === "90cw") {
        out.setBit(b.x + (b.height - 1 - ry), b.y + rx, true);
      } else {
        out.setBit(b.x + ry, b.y + (b.width - 1 - rx), true);
      }
    }
  }
  out.recalcBounds();
  return out;
}

/**
 * Extracts exact pixel-boundary edge segments for rendering crisp animated Marching Ants
 * around arbitrary non-rectangular (Lasso / Magic Wand / Disjoint) selections.
 */
export function computeMarchingAntsSegments(mask: Mask): MarchingAntSegment[] {
  const segments: MarchingAntSegment[] = [];
  if (mask.isEmpty || !mask.bounds) return segments;

  const { x: bx, y: by, width: bw, height: bh } = mask.bounds;
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      if (!mask.getBit(x, y)) continue;
      // Top edge
      if (!mask.getBit(x, y - 1)) {
        segments.push({ x1: x, y1: y, x2: x + 1, y2: y });
      }
      // Bottom edge
      if (!mask.getBit(x, y + 1)) {
        segments.push({ x1: x, y1: y + 1, x2: x + 1, y2: y + 1 });
      }
      // Left edge
      if (!mask.getBit(x - 1, y)) {
        segments.push({ x1: x, y1: y, x2: x, y2: y + 1 });
      }
      // Right edge
      if (!mask.getBit(x + 1, y)) {
        segments.push({ x1: x + 1, y1: y, x2: x + 1, y2: y + 1 });
      }
    }
  }
  return segments;
}

/**
 * Serializes a `Mask` into a named `SavedMaskEntry` for storing inside `sprite.savedMasks`.
 */
export function encodeSavedMask(mask: Mask, name: string): SavedMaskEntry {
  return {
    id: createModelId("selmask"),
    name: name.trim() || "Selection",
    width: mask.width,
    height: mask.height,
    bitsBase64: uint8ToBase64(mask.bits),
  };
}

/**
 * Decodes a `SavedMaskEntry` back into a `Mask` resized/clipped to `(targetWidth, targetHeight)`.
 */
export function decodeSavedMask(
  entry: SavedMaskEntry,
  targetWidth = entry.width,
  targetHeight = entry.height
): Mask {
  const srcMask = new Mask(entry.width, entry.height, base64ToUint8(entry.bitsBase64));
  if (entry.width === targetWidth && entry.height === targetHeight) {
    return srcMask;
  }
  const out = new Mask(targetWidth, targetHeight);
  for (let y = 0; y < Math.min(entry.height, targetHeight); y++) {
    for (let x = 0; x < Math.min(entry.width, targetWidth); x++) {
      if (srcMask.getBit(x, y)) out.setBit(x, y, true);
    }
  }
  out.recalcBounds();
  return out;
}
