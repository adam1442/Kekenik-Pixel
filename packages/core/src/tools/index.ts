/**
 * @module @kekenik/core/tools
 * Pure TypeScript algorithms for all Agent-2 Drawing Tools, Retouch Tools, Flood Fill,
 * Gradients, Shapes, Curves, Polygons, Bitmap Text, and Transactional Patch Commits.
 * Zero DOM, React, or Electron imports.
 */

import {
  applySymmetryTransform,
  BrushConfig,
  computeInkColor,
  computeSymmetryPoints,
  DEFAULT_BRUSH_DYNAMICS,
  DitherMatrix,
  DitherMatrixId,
  DynamicStrokeSample,
  evaluateDitherMatrix,
  generateBrushFootprint,
  getSymmetryTransforms,
  InkMode,
  PatternAlignMode,
  SymmetryMode,
  TiledMode,
  wrapTiledCoord,
} from "../brush/index.ts";
import { CelImagePatchCommand, SpriteDocument } from "../commands/index.ts";
import { getCel, getPaletteForFrame, Mask, PixelImage } from "../model/index.ts";
import {
  bresenhamLine,
  clamp,
  filterPixelPerfect,
  intersectRect,
  Point,
  Rect,
  RGBA,
  unionRect,
} from "../util/index.ts";

/**
 * Deterministic 32-bit PRNG (Mulberry32) for reproducible Spray and Jumble tools.
 */
export function createSeededRandom(seed = 1337): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Constrains `end` relative to `start` using Aseprite's Shift angle snap (0°, 26.565° 2:1 pixel art,
 * 45°, 63.435° 1:2 pixel art, 90°) or Ctrl axis lock (horizontal/vertical).
 */
export function constrainLineEndpoint(
  start: Point,
  end: Point,
  mode: "none" | "angle_snap" | "axis_lock"
): Point {
  if (mode === "none") return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return end;

  if (mode === "axis_lock") {
    if (Math.abs(dx) >= Math.abs(dy)) {
      return { x: end.x, y: start.y };
    }
    return { x: start.x, y: end.y };
  }

  // Snap to canonical pixel-art angles: 0°, 26.565° (2:1), 45° (1:1), 63.435° (1:2), 90°
  const dist = Math.hypot(dx, dy);
  const rawAngle = Math.atan2(dy, dx);
  const deg = ((rawAngle * 180) / Math.PI + 360) % 360;
  const snapAngles = [
    0, 26.565, 45, 63.435, 90, 116.565, 135, 153.435, 180, 206.565, 225, 243.435, 270, 296.565,
    315, 333.435, 360,
  ];
  let bestDeg = 0;
  let minDiff = 360;
  for (const a of snapAngles) {
    const diff = Math.abs(deg - a);
    if (diff < minDiff) {
      minDiff = diff;
      bestDeg = a;
    }
  }
  const snappedRad = (bestDeg * Math.PI) / 180;
  return {
    x: Math.round(start.x + Math.cos(snappedRad) * dist),
    y: Math.round(start.y + Math.sin(snappedRad) * dist),
  };
}

/**
 * Snaps a point `(x, y)` to the nearest grid intersection or cell origin when Snap to Grid is enabled.
 */
export function snapPointToGrid(
  pt: Point,
  grid: { x: number; y: number; width: number; height: number }
): Point {
  const gw = Math.max(1, grid.width);
  const gh = Math.max(1, grid.height);
  return {
    x: Math.round((pt.x - grid.x) / gw) * gw + grid.x,
    y: Math.round((pt.y - grid.y) / gh) * gh + grid.y,
  };
}

/**
 * Smooths raw freehand input points using Catmull-Rom / moving-window stabilizer (factor 0..32).
 */
export function stabilizeStrokePoints(
  points: readonly Point[],
  stabilizerFactor: number
): Point[] {
  const factor = clamp(Math.floor(stabilizerFactor), 0, 32);
  if (factor <= 0 || points.length < 3) {
    return [...points];
  }
  const windowRadius = Math.max(1, Math.min(8, Math.ceil(factor / 4)));
  const smoothed: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i === 0 || i === points.length - 1) {
      smoothed.push(points[i]);
      continue;
    }
    let sumX = 0;
    let sumY = 0;
    let weightSum = 0;
    for (let k = -windowRadius; k <= windowRadius; k++) {
      const idx = clamp(i + k, 0, points.length - 1);
      const w = windowRadius + 1 - Math.abs(k);
      sumX += points[idx].x * w;
      sumY += points[idx].y * w;
      weightSum += w;
    }
    smoothed.push({
      x: Math.round(sumX / weightSum),
      y: Math.round(sumY / weightSum),
    });
  }
  // Connect smoothed control points with Bresenham segments so there are no gaps
  const connected: Point[] = [];
  for (let i = 0; i < smoothed.length; i++) {
    if (i === 0) {
      connected.push(smoothed[0]);
    } else {
      const seg = bresenhamLine(
        smoothed[i - 1].x,
        smoothed[i - 1].y,
        smoothed[i].x,
        smoothed[i].y
      );
      connected.push(...seg.slice(1));
    }
  }
  return connected;
}

/**
 * Filters a continuous pixel path so stamps are placed every `stepPx` pixels along the stroke.
 */
export function applyStampSpacing(points: readonly Point[], stepPx: number): Point[] {
  if (points.length <= 1 || stepPx <= 1) return [...points];
  const out: Point[] = [points[0]];
  let accumDist = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    accumDist += Math.hypot(dx, dy);
    if (accumDist >= stepPx || i === points.length - 1) {
      out.push(points[i]);
      accumDist = 0;
    }
  }
  return out;
}

export interface PaintStrokeOptions {
  readonly fgColor: RGBA;
  readonly bgColor: RGBA;
  readonly brush?: Partial<BrushConfig>;
  readonly inkMode?: InkMode;
  readonly opacity?: number; // 0..255
  readonly button?: number; // 0 = left, 2 = right
  readonly isEraser?: boolean;
  readonly isBackgroundLayer?: boolean;
  readonly pixelPerfect?: boolean;
  readonly stabilizerFactor?: number;
  readonly connectPoints?: boolean; // default true for continuous strokes; false for pre-rasterized point sets
  readonly ditherMatrixId?: DitherMatrixId;
  readonly ditherRatio?: number;
  readonly customDitherMatrix?: DitherMatrix;
  readonly symmetryMode?: SymmetryMode;
  readonly symmetryX?: number;
  readonly symmetryY?: number;
  readonly tiledMode?: TiledMode;
  readonly palette?: readonly RGBA[];
  readonly transparentIndex?: number;
  readonly shadingRamp?: readonly RGBA[];
  readonly mask?: Mask;
  readonly samples?: readonly DynamicStrokeSample[];
}

function resolveFullBrushConfig(partial?: Partial<BrushConfig>): BrushConfig {
  return {
    id: partial?.id ?? "brush_active",
    name: partial?.name ?? "Active Brush",
    category: partial?.category ?? "Basic",
    type: partial?.type ?? "square",
    size: clamp(Math.round(partial?.size ?? 1), 1, 128),
    angle: clamp(Math.round(partial?.angle ?? 0), -180, 180),
    spacing: clamp(Math.round(partial?.spacing ?? 10), 1, 200),
    patternAlign: partial?.patternAlign ?? "none",
    flipH: partial?.flipH ?? false,
    flipV: partial?.flipV ?? false,
    dynamics: partial?.dynamics ?? { ...DEFAULT_BRUSH_DYNAMICS },
    image: partial?.image,
    slot: partial?.slot,
  };
}

/**
 * Paints a sequence of stroke points onto `target` with full support for Brush footprints,
 * Ink modes, Dithering matrices, Symmetry axes, Tiled wrap-around, Pixel-Perfect filtering,
 * Stabilizer, and Selection Mask clipping.
 * Returns the bounding dirty `Rect` of modified pixels (or `null` if no pixels changed).
 */
export function paintStrokeOnImage(
  target: PixelImage,
  rawPoints: readonly Point[],
  options: PaintStrokeOptions
): Rect | null {
  if (rawPoints.length === 0) return null;

  const brushCfg = resolveFullBrushConfig(options.brush);
  const symMode = options.symmetryMode ?? "none";
  const symX = options.symmetryX ?? target.width / 2;
  const symY = options.symmetryY ?? target.height / 2;
  const tiledMode = options.tiledMode ?? "none";
  const hasMask = Boolean(options.mask && !options.mask.isEmpty);

  // 1. Stabilize and interpolate continuous path (unless pre-rasterized discrete points)
  let path: Point[] = [];
  if (options.connectPoints === false) {
    path = [...rawPoints];
  } else {
    for (let i = 0; i < rawPoints.length; i++) {
      if (i === 0) {
        path.push(rawPoints[0]);
      } else {
        const seg = bresenhamLine(
          rawPoints[i - 1].x,
          rawPoints[i - 1].y,
          rawPoints[i].x,
          rawPoints[i].y
        );
        path.push(...seg.slice(1));
      }
    }
  }

  if ((options.stabilizerFactor ?? 0) > 0 && path.length >= 3) {
    path = stabilizeStrokePoints(path, options.stabilizerFactor!);
  }

  if (options.pixelPerfect && !options.isEraser && brushCfg.size === 1) {
    path = filterPixelPerfect(path);
  }

  // Apply stamp spacing if spacing > 25% and brush size > 1
  const stepPx =
    brushCfg.spacing > 25
      ? Math.max(1, Math.round((brushCfg.size * brushCfg.spacing) / 100))
      : 1;
  if (stepPx > 1) {
    path = applyStampSpacing(path, stepPx);
  }

  // Determine primary & secondary colors for left vs right mouse button or eraser
  const isEraser = Boolean(options.isEraser);
  const primaryColor: RGBA = isEraser
    ? options.isBackgroundLayer
      ? options.bgColor
      : { r: 0, g: 0, b: 0, a: 0 }
    : options.button === 2
    ? options.bgColor
    : options.fgColor;

  const secondaryColor: RGBA =
    options.button === 2 ? options.fgColor : options.bgColor;

  const effectiveInkMode: InkMode = isEraser
    ? "copy_color_alpha"
    : options.inkMode ?? "simple";

  let minX = target.width;
  let minY = target.height;
  let maxX = -1;
  let maxY = -1;

  const strokeOrigin = path[0];

  for (let i = 0; i < path.length; i++) {
    const pt = path[i];
    const sample: DynamicStrokeSample = options.samples?.[i] ?? {
      pressure: 1,
      velocity: 0,
      strokeProgress: path.length > 1 ? i / (path.length - 1) : 0,
    };

    const footprint = generateBrushFootprint(brushCfg, sample);
    const symTransforms = getSymmetryTransforms(symMode);
    const dabStamped = new Set<number>();

    const dynamicDitherRatio =
      brushCfg.dynamics.gradientDither && sample.strokeProgress !== undefined
        ? sample.strokeProgress
        : options.ditherRatio ?? 0.5;

    for (const tf of symTransforms) {
      for (const fp of footprint) {
        // Reflect & transpose the stamp point (pt + fp) across the active symmetry axis/axes (B05, B22)
        const transformedPt =
          symMode === "none"
            ? { x: pt.x + fp.dx, y: pt.y + fp.dy }
            : applySymmetryTransform({ x: pt.x + fp.dx, y: pt.y + fp.dy }, tf, symX, symY);

        const wrapped = wrapTiledCoord(
          transformedPt.x,
          transformedPt.y,
          target.width,
          target.height,
          tiledMode
        );
        if (!wrapped) continue;

        const { x: px, y: py } = wrapped;
        if (hasMask && !options.mask!.getBit(px, py)) continue;

        // Prevent double-stamping when multiple symmetry axes map to the same pixel (e.g., center or axis line)
        const pixelKey = py * target.width + px;
        if (dabStamped.has(pixelKey)) continue;
        dabStamped.add(pixelKey);

        const stampFg =
          brushCfg.type === "image" && fp.color && brushCfg.patternAlign === "none"
            ? fp.color
            : primaryColor;

        const outColor = computeInkColor(target, px, py, stampFg, secondaryColor, {
          inkMode: effectiveInkMode,
          opacity: isEraser ? 255 : options.opacity ?? 255,
          button: options.button ?? 0,
          palette: options.palette,
          transparentIndex: options.transparentIndex,
          shadingRamp: options.shadingRamp,
          ditherMatrixId: options.ditherMatrixId,
          ditherRatio: dynamicDitherRatio,
          customDitherMatrix: options.customDitherMatrix,
          patternAlign: brushCfg.patternAlign,
          patternImage: brushCfg.image,
          strokeOrigin,
        });

        if (!outColor) continue;
        target.setRGBA(px, py, outColor, options.palette, options.transparentIndex ?? 0);

        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }
    void computeSymmetryPoints;
  }

  if (maxX < minX || maxY < minY) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

// ---------------------------------------------------------------------------
// Shape Rasterizers: Line, Bezier Curve, Rectangle, Ellipse, Contour/Polygon
// ---------------------------------------------------------------------------

/**
 * Rasterizes a straight pixel line between `start` and `end`, with optional angle snap or axis lock.
 */
export function rasterizeLine(
  start: Point,
  end: Point,
  options: { snapAngle?: boolean; lockAxis?: boolean } = {}
): Point[] {
  const mode = options.lockAxis
    ? "axis_lock"
    : options.snapAngle
    ? "angle_snap"
    : "none";
  const targetEnd = constrainLineEndpoint(start, end, mode);
  return bresenhamLine(start.x, start.y, targetEnd.x, targetEnd.y);
}

/**
 * Rasterizes a Quadratic or Cubic Bezier pixel curve (`p0 -> p1 -> p2 [-> p3]`)
 * with L-corner pixel-perfect cleanup.
 */
export function rasterizeBezierCurve(
  p0: Point,
  p1: Point,
  p2: Point,
  p3?: Point
): Point[] {
  const controlEnd = p3 ?? p2;
  const approxLen =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y) +
    (p3 ? Math.hypot(p3.x - p2.x, p3.y - p2.y) : 0);

  const steps = Math.max(16, Math.ceil(approxLen * 2));
  const sampled: Point[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    let x = 0;
    let y = 0;
    if (p3) {
      // Cubic Bezier
      const w0 = mt * mt * mt;
      const w1 = 3 * mt * mt * t;
      const w2 = 3 * mt * t * t;
      const w3 = t * t * t;
      x = Math.round(w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x);
      y = Math.round(w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y);
    } else {
      // Quadratic Bezier
      const w0 = mt * mt;
      const w1 = 2 * mt * t;
      const w2 = t * t;
      x = Math.round(w0 * p0.x + w1 * p1.x + w2 * controlEnd.x);
      y = Math.round(w0 * p0.y + w1 * p1.y + w2 * controlEnd.y);
    }
    if (
      sampled.length === 0 ||
      sampled[sampled.length - 1].x !== x ||
      sampled[sampled.length - 1].y !== y
    ) {
      sampled.push({ x, y });
    }
  }

  // Ensure 8-connected continuity with Bresenham segments
  const connected: Point[] = [];
  for (let i = 0; i < sampled.length; i++) {
    if (i === 0) {
      connected.push(sampled[0]);
    } else {
      const seg = bresenhamLine(
        sampled[i - 1].x,
        sampled[i - 1].y,
        sampled[i].x,
        sampled[i].y
      );
      connected.push(...seg.slice(1));
    }
  }
  return filterPixelPerfect(connected);
}

/**
 * Resolves bounding box `[x0, y0, x1, y1]` for Rectangle/Ellipse given `start` and `end`,
 * handling `proportional` (Shift = Square/Circle) and `fromCenter` (Ctrl).
 */
export function resolveShapeBox(
  start: Point,
  end: Point,
  options: { proportional?: boolean; fromCenter?: boolean } = {}
): { x0: number; y0: number; x1: number; y1: number } {
  let dx = end.x - start.x;
  let dy = end.y - start.y;

  if (options.proportional) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  }

  if (options.fromCenter) {
    const x0 = Math.min(start.x - dx, start.x + dx);
    const x1 = Math.max(start.x - dx, start.x + dx);
    const y0 = Math.min(start.y - dy, start.y + dy);
    const y1 = Math.max(start.y - dy, start.y + dy);
    return { x0, y0, x1, y1 };
  }

  const x0 = Math.min(start.x, start.x + dx);
  const x1 = Math.max(start.x, start.x + dx);
  const y0 = Math.min(start.y, start.y + dy);
  const y1 = Math.max(start.y, start.y + dy);
  return { x0, y0, x1, y1 };
}

/**
 * Rasterizes an Outlined or Filled Rectangle.
 */
export function rasterizeRectangle(
  start: Point,
  end: Point,
  options: { filled?: boolean; proportional?: boolean; fromCenter?: boolean } = {}
): Point[] {
  const { x0, y0, x1, y1 } = resolveShapeBox(start, end, options);
  const pts: Point[] = [];

  if (options.filled) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        pts.push({ x, y });
      }
    }
    return pts;
  }

  // Walk perimeter clockwise so consecutive points are adjacent
  for (let x = x0; x <= x1; x++) {
    pts.push({ x, y: y0 });
  }
  for (let y = y0 + 1; y <= y1; y++) {
    pts.push({ x: x1, y });
  }
  if (y1 > y0) {
    for (let x = x1 - 1; x >= x0; x--) {
      pts.push({ x, y: y1 });
    }
  }
  if (x1 > x0) {
    for (let y = y1 - 1; y > y0; y--) {
      pts.push({ x: x0, y });
    }
  }
  return pts;
}

/**
 * Rasterizes an Outlined or Filled Ellipse / Circle using integer midpoint symmetry (B18).
 * - When `filled` is false, returns only the perimeter points ordered clockwise around `(cx, cy)`
 *   so that `paintStrokeOnImage` never connects opposite quadrants across the interior.
 * - When `filled` is true, fills each horizontal scanline between the left and right outline
 *   perimeter pixels so that the filled shape's boundary matches the outline-mode perimeter 1:1.
 */
export function rasterizeEllipse(
  start: Point,
  end: Point,
  options: { filled?: boolean; proportional?: boolean; fromCenter?: boolean } = {}
): Point[] {
  const { x0, y0, x1, y1 } = resolveShapeBox(start, end, options);
  const w = x1 - x0;
  const h = y1 - y0;

  if (w === 0 && h === 0) return [{ x: x0, y: y0 }];
  if (w === 0 || h === 0) return bresenhamLine(x0, y0, x1, y1);

  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;

  // Outlined midpoint ellipse algorithm (4-quadrant symmetrical)
  let a = Math.abs(x1 - x0);
  const b = Math.abs(y1 - y0);
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  let e2 = 0;

  let left = x0;
  let right = x1;
  let top = y0 + Math.floor((b + 1) / 2);
  let bottom = top - b1;
  a = 8 * a * a;
  b1 = 8 * b * b;

  const seen = new Set<string>();
  const outline: Point[] = [];
  const addPt = (px: number, py: number) => {
    const k = `${px},${py}`;
    if (!seen.has(k)) {
      seen.add(k);
      outline.push({ x: px, y: py });
    }
  };

  do {
    addPt(right, top);
    addPt(left, top);
    addPt(left, bottom);
    addPt(right, bottom);
    e2 = 2 * err;
    if (e2 <= dy) {
      top += 1;
      bottom -= 1;
      dy += a;
      err += dy;
    }
    if (e2 >= dx || 2 * err > dy) {
      left += 1;
      right -= 1;
      dx += b1;
      err += dx;
    }
  } while (left <= right);

  while (top - bottom <= b) {
    addPt(left - 1, top);
    addPt(right + 1, top);
    top += 1;
    addPt(left - 1, bottom);
    addPt(right + 1, bottom);
    bottom -= 1;
  }

  if (options.filled) {
    const rowMinMax = new Map<number, { minX: number; maxX: number }>();
    for (const p of outline) {
      const cur = rowMinMax.get(p.y);
      if (!cur) {
        rowMinMax.set(p.y, { minX: p.x, maxX: p.x });
      } else {
        if (p.x < cur.minX) cur.minX = p.x;
        if (p.x > cur.maxX) cur.maxX = p.x;
      }
    }
    const filledPts: Point[] = [];
    for (let y = y0; y <= y1; y++) {
      const span = rowMinMax.get(y);
      if (!span) continue;
      for (let x = span.minX; x <= span.maxX; x++) {
        filledPts.push({ x, y });
      }
    }
    return filledPts;
  }

  // Order perimeter points clockwise around (cx, cy) so consecutive points are adjacent
  // and never jump across the interior of the ellipse.
  outline.sort(
    (pA, pB) => Math.atan2(pA.y - cy, pA.x - cx) - Math.atan2(pB.y - cy, pB.x - cx)
  );
  return outline;
}

/**
 * Rasterizes a closed Polygon or Freehand Contour (`filled = true` uses scanline fill + perimeter).
 */
export function rasterizePolygon(
  vertices: readonly Point[],
  filled = true
): Point[] {
  if (vertices.length === 0) return [];
  if (vertices.length === 1) return [vertices[0]];
  if (vertices.length === 2) return bresenhamLine(vertices[0].x, vertices[0].y, vertices[1].x, vertices[1].y);

  const seen = new Set<string>();
  const pts: Point[] = [];
  const addPt = (x: number, y: number) => {
    const k = `${x},${y}`;
    if (!seen.has(k)) {
      seen.add(k);
      pts.push({ x, y });
    }
  };

  // 1. Rasterize polygon edges
  let minY = vertices[0].y;
  let maxY = vertices[0].y;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    if (a.y < minY) minY = a.y;
    if (a.y > maxY) maxY = a.y;
    for (const p of bresenhamLine(a.x, a.y, b.x, b.y)) {
      addPt(p.x, p.y);
    }
  }

  if (!filled) return pts;

  // 2. Scanline polygon interior fill
  for (let y = minY; y <= maxY; y++) {
    const nodeX: number[] = [];
    let j = vertices.length - 1;
    for (let i = 0; i < vertices.length; i++) {
      const vi = vertices[i];
      const vj = vertices[j];
      if ((vi.y < y && vj.y >= y) || (vj.y < y && vi.y >= y)) {
        const intersectX = vi.x + ((y - vi.y) / (vj.y - vi.y)) * (vj.x - vi.x);
        nodeX.push(intersectX);
      }
      j = i;
    }
    nodeX.sort((a, b) => a - b);
    for (let i = 0; i < nodeX.length - 1; i += 2) {
      const startX = Math.ceil(nodeX[i]);
      const endX = Math.floor(nodeX[i + 1]);
      for (let x = startX; x <= endX; x++) {
        addPt(x, y);
      }
    }
  }

  return pts;
}

// ---------------------------------------------------------------------------
// Paint Bucket Flood Fill (Contiguous / Non-Contiguous, Tolerance, 4/8-Connected)
// ---------------------------------------------------------------------------

export interface FloodFillOptions {
  readonly x: number;
  readonly y: number;
  readonly fillColor: RGBA;
  readonly secondaryColor?: RGBA;
  readonly tolerance?: number; // 0..255
  readonly contiguous?: boolean; // default true
  readonly eightConnected?: boolean; // default false (4-connected)
  readonly sampleImage?: PixelImage; // when sampling composite of all layers
  readonly inkMode?: InkMode;
  readonly opacity?: number;
  readonly ditherMatrixId?: DitherMatrixId;
  readonly ditherRatio?: number;
  readonly customDitherMatrix?: DitherMatrix;
  readonly patternAlign?: PatternAlignMode;
  readonly patternImage?: PixelImage;
  readonly palette?: readonly RGBA[];
  readonly transparentIndex?: number;
  readonly mask?: Mask;
}

function colorWithinTolerance(a: RGBA, b: RGBA, tolerance: number): boolean {
  if (a.a === 0 && b.a === 0) return true;
  const dr = Math.abs(a.r - b.r);
  const dg = Math.abs(a.g - b.g);
  const db = Math.abs(a.b - b.b);
  const da = Math.abs(a.a - b.a);
  return Math.max(dr, dg, db, da) <= tolerance;
}

/**
 * Computes a boolean mask (`Uint8Array` of 0/1) of pixels matching the seed color at `(startX, startY)`
 * via 4-connected or 8-connected BFS flood fill (or non-contiguous global scan).
 */
export function computeFloodRegionMask(
  sampleImg: PixelImage,
  startX: number,
  startY: number,
  tolerance = 0,
  contiguous = true,
  eightConnected = false,
  palette?: readonly RGBA[],
  transparentIndex = 0,
  selectionMask?: Mask
): { region: Uint8Array; bounds: Rect | null } {
  const w = sampleImg.width;
  const h = sampleImg.height;
  const region = new Uint8Array(w * h);

  if (startX < 0 || startY < 0 || startX >= w || startY >= h) {
    return { region, bounds: null };
  }

  const hasMask = Boolean(selectionMask && !selectionMask.isEmpty);
  if (hasMask && !selectionMask!.getBit(startX, startY)) {
    return { region, bounds: null };
  }

  const seedColor = sampleImg.getRGBA(startX, startY, palette, transparentIndex);
  const tol = clamp(Math.round(tolerance), 0, 255);

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  const mark = (px: number, py: number) => {
    region[py * w + px] = 1;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  };

  if (!contiguous) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (hasMask && !selectionMask!.getBit(x, y)) continue;
        const c = sampleImg.getRGBA(x, y, palette, transparentIndex);
        if (colorWithinTolerance(c, seedColor, tol)) {
          mark(x, y);
        }
      }
    }
  } else {
    const visited = new Uint8Array(w * h);
    const queueX = new Int32Array(w * h);
    const queueY = new Int32Array(w * h);
    let head = 0;
    let tail = 0;

    queueX[tail] = startX;
    queueY[tail] = startY;
    tail += 1;
    visited[startY * w + startX] = 1;

    const dirsX = eightConnected ? [1, -1, 0, 0, 1, 1, -1, -1] : [1, -1, 0, 0];
    const dirsY = eightConnected ? [0, 0, 1, -1, 1, -1, 1, -1] : [0, 0, 1, -1];

    while (head < tail) {
      const cx = queueX[head];
      const cy = queueY[head];
      head += 1;
      mark(cx, cy);

      for (let d = 0; d < dirsX.length; d++) {
        const nx = cx + dirsX[d];
        const ny = cy + dirsY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (visited[nIdx]) continue;
        visited[nIdx] = 1;
        if (hasMask && !selectionMask!.getBit(nx, ny)) continue;
        const nc = sampleImg.getRGBA(nx, ny, palette, transparentIndex);
        if (colorWithinTolerance(nc, seedColor, tol)) {
          queueX[tail] = nx;
          queueY[tail] = ny;
          tail += 1;
        }
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { region, bounds: null };
  }
  return {
    region,
    bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

/**
 * Executes Paint Bucket flood fill onto `target` and returns the modified bounding `Rect`.
 */
export function floodFillImage(target: PixelImage, options: FloodFillOptions): Rect | null {
  const sampleImg = options.sampleImage ?? target;
  const { region, bounds } = computeFloodRegionMask(
    sampleImg,
    options.x,
    options.y,
    options.tolerance ?? 0,
    options.contiguous ?? true,
    options.eightConnected ?? false,
    options.palette,
    options.transparentIndex ?? 0,
    options.mask
  );

  if (!bounds) return null;

  const w = target.width;
  const bg = options.secondaryColor ?? { r: 0, g: 0, b: 0, a: 0 };
  const origin: Point = { x: options.x, y: options.y };

  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      if (!region[y * w + x]) continue;
      const outColor = computeInkColor(target, x, y, options.fillColor, bg, {
        inkMode: options.inkMode ?? "simple",
        opacity: options.opacity ?? 255,
        palette: options.palette,
        transparentIndex: options.transparentIndex,
        ditherMatrixId: options.ditherMatrixId,
        ditherRatio: options.ditherRatio ?? 0.5,
        customDitherMatrix: options.customDitherMatrix,
        patternAlign: options.patternAlign,
        patternImage: options.patternImage,
        strokeOrigin: origin,
      });
      if (outColor) {
        target.setRGBA(x, y, outColor, options.palette, options.transparentIndex ?? 0);
      }
    }
  }

  return bounds;
}

// ---------------------------------------------------------------------------
// Gradient Tool (Linear & Radial, Bayer Dither, Floyd-Steinberg, Contiguous)
// ---------------------------------------------------------------------------

export type GradientType = "linear" | "radial";
export type GradientDitherMode =
  | "none"
  | "bayer2x2"
  | "bayer4x4"
  | "bayer8x8"
  | "floyd_steinberg"
  | "old_style"
  | "custom";

export interface GradientRenderOptions {
  readonly start: Point;
  readonly end: Point;
  readonly fgColor: RGBA;
  readonly bgColor: RGBA;
  readonly gradientType?: GradientType;
  readonly ditherMode?: GradientDitherMode;
  readonly customDitherMatrix?: DitherMatrix;
  readonly colorRamp?: readonly RGBA[]; // optional multi-stop palette ramp
  readonly contiguous?: boolean; // when true, flood-clips to region around `start`
  readonly tolerance?: number;
  readonly inkMode?: InkMode;
  readonly opacity?: number;
  readonly palette?: readonly RGBA[];
  readonly transparentIndex?: number;
  readonly mask?: Mask;
}

function interpolateRamp(ramp: readonly RGBA[], t: number): {
  exact: RGBA;
  c0: RGBA;
  c1: RGBA;
  localT: number;
} {
  const clampedT = clamp(t, 0, 1);
  if (ramp.length === 0) {
    const black = { r: 0, g: 0, b: 0, a: 255 };
    return { exact: black, c0: black, c1: black, localT: 0 };
  }
  if (ramp.length === 1) {
    return { exact: ramp[0], c0: ramp[0], c1: ramp[0], localT: 0 };
  }
  const scaled = clampedT * (ramp.length - 1);
  const idx0 = Math.min(ramp.length - 2, Math.floor(scaled));
  const idx1 = idx0 + 1;
  const localT = scaled - idx0;
  const c0 = ramp[idx0];
  const c1 = ramp[idx1];
  const exact: RGBA = {
    r: Math.round(c0.r + (c1.r - c0.r) * localT),
    g: Math.round(c0.g + (c1.g - c0.g) * localT),
    b: Math.round(c0.b + (c1.b - c0.b) * localT),
    a: Math.round(c0.a + (c1.a - c0.a) * localT),
  };
  return { exact, c0, c1, localT };
}

/**
 * Renders a Linear or Radial gradient onto `target` with Bayer ordered dithering,
 * Floyd–Steinberg error diffusion, Old-Style banding, or smooth interpolation,
 * plus optional contiguous flood-region clipping.
 */
export function renderGradientImage(
  target: PixelImage,
  options: GradientRenderOptions
): Rect | null {
  const w = target.width;
  const h = target.height;
  const hasMask = Boolean(options.mask && !options.mask.isEmpty);

  let floodMask: Uint8Array | null = null;
  let clipBounds: Rect = { x: 0, y: 0, width: w, height: h };

  if (options.contiguous) {
    const flood = computeFloodRegionMask(
      target,
      options.start.x,
      options.start.y,
      options.tolerance ?? 32,
      true,
      false,
      options.palette,
      options.transparentIndex ?? 0,
      options.mask
    );
    if (!flood.bounds) return null;
    floodMask = flood.region;
    clipBounds = flood.bounds;
  } else if (hasMask && options.mask!.bounds) {
    clipBounds = options.mask!.bounds;
  }

  const dx = options.end.x - options.start.x;
  const dy = options.end.y - options.start.y;
  const lenSq = dx * dx + dy * dy;
  const len = Math.sqrt(lenSq);

  const ramp =
    options.colorRamp && options.colorRamp.length >= 2
      ? options.colorRamp
      : [options.fgColor, options.bgColor];

  const ditherMode = options.ditherMode ?? "none";

  // Error buffer for Floyd-Steinberg dithering
  const errBuffer =
    ditherMode === "floyd_steinberg" ? new Float32Array(w * h) : null;

  for (let y = clipBounds.y; y < clipBounds.y + clipBounds.height; y++) {
    for (let x = clipBounds.x; x < clipBounds.x + clipBounds.width; x++) {
      if (hasMask && !options.mask!.getBit(x, y)) continue;
      if (floodMask && !floodMask[y * w + x]) continue;

      let t = 0;
      if (len > 0.0001) {
        if (options.gradientType === "radial") {
          t = Math.hypot(x - options.start.x, y - options.start.y) / len;
        } else {
          t = ((x - options.start.x) * dx + (y - options.start.y) * dy) / lenSq;
        }
      }
      t = clamp(t, 0, 1);

      const { exact, c0, c1, localT } = interpolateRamp(ramp, t);
      let chosenColor = exact;

      if (
        ditherMode === "bayer2x2" ||
        ditherMode === "bayer4x4" ||
        ditherMode === "bayer8x8" ||
        ditherMode === "custom"
      ) {
        const useSecond = evaluateDitherMatrix(
          x,
          y,
          ditherMode,
          localT,
          options.customDitherMatrix
        );
        chosenColor = useSecond ? c1 : c0;
      } else if (ditherMode === "old_style") {
        // Classic 5-band pixel art dither bands (solid -> 25% -> 50% checker -> 75% -> solid)
        let matId: DitherMatrixId = "bayer2x2";
        if (localT >= 0.35 && localT <= 0.65) {
          matId = "checkerboard";
        }
        const useSecond = evaluateDitherMatrix(x, y, matId, localT);
        chosenColor = useSecond ? c1 : c0;
      } else if (ditherMode === "floyd_steinberg" && errBuffer) {
        const idx = y * w + x;
        const val = clamp(localT + errBuffer[idx], 0, 1);
        const pickC1 = val >= 0.5;
        chosenColor = pickC1 ? c1 : c0;
        const quantErr = val - (pickC1 ? 1 : 0);
        if (x + 1 < w) errBuffer[idx + 1] += (quantErr * 7) / 16;
        if (y + 1 < h) {
          if (x > 0) errBuffer[idx + w - 1] += (quantErr * 3) / 16;
          errBuffer[idx + w] += (quantErr * 5) / 16;
          if (x + 1 < w) errBuffer[idx + w + 1] += (quantErr * 1) / 16;
        }
      }

      const outColor = computeInkColor(target, x, y, chosenColor, options.bgColor, {
        inkMode: options.inkMode ?? "simple",
        opacity: options.opacity ?? 255,
        palette: options.palette,
        transparentIndex: options.transparentIndex,
      });

      if (outColor) {
        target.setRGBA(x, y, outColor, options.palette, options.transparentIndex ?? 0);
      }
    }
  }

  return clipBounds;
}

// ---------------------------------------------------------------------------
// Spray / Airbrush Tool
// ---------------------------------------------------------------------------

export interface SprayOptions extends PaintStrokeOptions {
  readonly sprayWidth?: number; // radius 1..64, default 8
  readonly spraySpeed?: number; // droplets per dab 1..100, default 12
  readonly seed?: number;
}

/**
 * Generates deterministic or random droplet points inside a circular spray radius.
 */
export function generateSprayPoints(
  center: Point,
  radius: number,
  count: number,
  seed = 1337
): Point[] {
  const rng = createSeededRandom(seed);
  const r = clamp(radius, 1, 64);
  const droplets = clamp(Math.round(count), 1, 200);
  const pts: Point[] = [];
  for (let i = 0; i < droplets; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * r;
    pts.push({
      x: Math.round(center.x + Math.cos(angle) * dist),
      y: Math.round(center.y + Math.sin(angle) * dist),
    });
  }
  return pts;
}

/**
 * Paints a spray burst at `center` onto `target`.
 */
export function paintSprayOnImage(
  target: PixelImage,
  center: Point,
  options: SprayOptions
): Rect | null {
  const droplets = generateSprayPoints(
    center,
    options.sprayWidth ?? 6,
    options.spraySpeed ?? 12,
    options.seed ?? 42
  );
  let totalDirty: Rect | null = null;
  for (const pt of droplets) {
    const r = paintStrokeOnImage(target, [pt], {
      ...options,
      pixelPerfect: false,
      stabilizerFactor: 0,
    });
    if (r) {
      totalDirty = totalDirty ? unionRect(totalDirty, r) : r;
    }
  }
  return totalDirty;
}

// ---------------------------------------------------------------------------
// Blur & Jumble Retouch Tools
// ---------------------------------------------------------------------------

/**
 * Applies a 3x3 pixel-art neighborhood box/gaussian blur within `radius` around `center`.
 */
export function applyBlurDab(
  target: PixelImage,
  center: Point,
  radius = 2,
  palette?: readonly RGBA[],
  transparentIndex = 0,
  mask?: Mask
): Rect | null {
  const r = clamp(Math.floor(radius), 1, 32);
  const snap = target.clone();
  const hasMask = Boolean(mask && !mask.isEmpty);

  let minX = target.width;
  let minY = target.height;
  let maxX = -1;
  let maxY = -1;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + 0.5) continue;
      const px = center.x + dx;
      const py = center.y + dy;
      if (px < 0 || py < 0 || px >= target.width || py >= target.height) continue;
      if (hasMask && !mask!.getBit(px, py)) continue;

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let count = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const sx = clamp(px + kx, 0, snap.width - 1);
          const sy = clamp(py + ky, 0, snap.height - 1);
          const c = snap.getRGBA(sx, sy, palette, transparentIndex);
          const w = kx === 0 && ky === 0 ? 4 : 1;
          sumR += c.r * w;
          sumG += c.g * w;
          sumB += c.b * w;
          sumA += c.a * w;
          count += w;
        }
      }

      target.setRGBA(
        px,
        py,
        {
          r: Math.round(sumR / count),
          g: Math.round(sumG / count),
          b: Math.round(sumB / count),
          a: Math.round(sumA / count),
        },
        palette,
        transparentIndex
      );

      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Jumbles (scrambles) neighboring pixels within `radius` around `center`.
 */
export function applyJumbleDab(
  target: PixelImage,
  center: Point,
  radius = 2,
  seed = 1337,
  mask?: Mask
): Rect | null {
  const r = clamp(Math.floor(radius), 1, 32);
  const rng = createSeededRandom(seed);
  const hasMask = Boolean(mask && !mask.isEmpty);

  const coords: Point[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + 0.5) continue;
      const px = center.x + dx;
      const py = center.y + dy;
      if (px < 0 || py < 0 || px >= target.width || py >= target.height) continue;
      if (hasMask && !mask!.getBit(px, py)) continue;
      coords.push({ x: px, y: py });
    }
  }

  if (coords.length < 2) return null;

  // Fisher-Yates partial shuffle of pixel values inside the dab
  for (let i = coords.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = coords[i];
    const b = coords[j];
    const valA = target.getPixel(a.x, a.y);
    const valB = target.getPixel(b.x, b.y);
    target.putPixel(a.x, a.y, valB);
    target.putPixel(b.x, b.y, valA);
  }

  let minX = target.width;
  let minY = target.height;
  let maxX = -1;
  let maxY = -1;
  for (const p of coords) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// ---------------------------------------------------------------------------
// Pixel Bitmap Text Renderer (100% headless-safe 5x7 font + Anti-Alias option)
// ---------------------------------------------------------------------------

const PIXEL_FONT_5X7: Record<string, readonly number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x12, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0x00, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x00, 0x04],
  ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04],
  ",": [0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x08],
  "-": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  "+": [0x00, 0x04, 0x04, 0x1f, 0x04, 0x04, 0x00],
  ":": [0x00, 0x04, 0x00, 0x00, 0x04, 0x00, 0x00],
  " ": [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
};

/**
 * Renders `text` into a standalone RGBA `PixelImage` using the crisp 5x7 bitmap font,
 * scaled by `fontSize` (7px = 1x, 14px = 2x, 21px = 3x, etc.) with optional `antiAlias` smoothing.
 */
export function renderPixelText(
  text: string,
  color: RGBA,
  fontSize = 7,
  antiAlias = false
): PixelImage {
  const clean = text.length > 0 ? text : " ";
  const scale = clamp(Math.round(fontSize / 7), 1, 8);
  const charW = 5 * scale;
  const charH = 7 * scale;
  const gap = 1 * scale;
  const totalW = Math.max(1, clean.length * (charW + gap) - gap);
  const totalH = Math.max(1, charH);

  const img = new PixelImage(totalW, totalH, "rgba");

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i].toUpperCase();
    const glyph = PIXEL_FONT_5X7[ch] ?? PIXEL_FONT_5X7["?"];
    const baseX = i * (charW + gap);

    for (let row = 0; row < 7; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 5; col++) {
        const on = (bits & (1 << (4 - col))) !== 0;
        if (!on) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            img.setRGBA(baseX + col * scale + sx, row * scale + sy, color);
          }
        }
      }
    }
  }

  // Optional anti-alias pass: add 45%-alpha diagonal bridge pixels at inner L-corners
  if (antiAlias) {
    const aaColor: RGBA = {
      r: color.r,
      g: color.g,
      b: color.b,
      a: Math.max(1, Math.round(color.a * 0.45)),
    };
    const snap = img.clone();
    for (let y = 1; y < img.height - 1; y++) {
      for (let x = 1; x < img.width - 1; x++) {
        if (snap.getRGBA(x, y).a > 0) continue;
        const n = snap.getRGBA(x, y - 1).a > 0 ? 1 : 0;
        const s = snap.getRGBA(x, y + 1).a > 0 ? 1 : 0;
        const e = snap.getRGBA(x + 1, y).a > 0 ? 1 : 0;
        const w = snap.getRGBA(x - 1, y).a > 0 ? 1 : 0;
        if ((n && e) || (n && w) || (s && e) || (s && w)) {
          img.setRGBA(x, y, aaColor);
        }
      }
    }
  }

  return img;
}

/**
 * Stamps rendered pixel text onto `target` at `(x, y)` and returns the dirty `Rect`.
 */
export function stampTextOnImage(
  target: PixelImage,
  text: string,
  x: number,
  y: number,
  color: RGBA,
  fontSize = 7,
  antiAlias = false,
  palette?: readonly RGBA[],
  transparentIndex = 0
): Rect | null {
  const stamp = renderPixelText(text, color, fontSize, antiAlias);
  target.blit(stamp, x, y, "normal", 255, palette, transparentIndex);
  return intersectRect(
    { x, y, width: stamp.width, height: stamp.height },
    { x: 0, y: 0, width: target.width, height: target.height }
  );
}

// ---------------------------------------------------------------------------
// Transactional Commit Helper (1 Tool Action = 1 Compact CelImagePatchCommand)
// ---------------------------------------------------------------------------

/**
 * Applies an arbitrary image mutation function on `(doc, layerId, frameIndex)` inside a single
 * undoable transaction storing only the dirty bounding-box `CelImagePatchCommand`.
 */
export function commitToolEditTransaction(
  doc: SpriteDocument,
  layerId: string,
  frameIndex: number,
  label: string,
  mutateFn: (workingImage: PixelImage, palette: readonly RGBA[], transparentIndex: number) => Rect | null
): Rect | null {
  const layer = doc.sprite.layers.find((l) => l.id === layerId);
  if (!layer || !layer.editable || !layer.visible || layer.kind === "group") {
    return null;
  }
  const cel = getCel(doc.sprite, layerId, frameIndex);
  if (!cel) return null;

  const working = cel.image.clone();
  const palette = getPaletteForFrame(doc.sprite, frameIndex);
  const dirty = mutateFn(working, palette, doc.sprite.transparentIndex);
  if (!dirty) return null;

  const clampedDirty = intersectRect(dirty, {
    x: 0,
    y: 0,
    width: cel.image.width,
    height: cel.image.height,
  });
  if (!clampedDirty) return null;

  const beforePatch = cel.image.extractPatch(clampedDirty);
  const afterPatch = working.extractPatch(clampedDirty);

  doc.execute(
    new CelImagePatchCommand(label, layerId, frameIndex, beforePatch, afterPatch)
  );
  return clampedDirty;
}
