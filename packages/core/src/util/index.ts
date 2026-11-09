/**
 * @module @kekenik/core/util
 * Pure math, geometry, pixel-perfect stroke, and color conversion utilities.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RGBA {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface HSV {
  readonly h: number; // 0..360
  readonly s: number; // 0..100
  readonly v: number; // 0..100
}

export interface HSL {
  readonly h: number; // 0..360
  readonly s: number; // 0..100
  readonly l: number; // 0..100
}

/**
 * Clamps a numeric value between min and max inclusive.
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Checks whether a point lies inside a rectangle.
 */
export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
}

/**
 * Computes the intersection of two rectangles, or returns null if disjoint.
 */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) {
    return null;
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Computes the bounding union rectangle of two rectangles.
 */
export function unionRect(a: Rect, b: Rect): Rect {
  if (a.width <= 0 || a.height <= 0) return { ...b };
  if (b.width <= 0 || b.height <= 0) return { ...a };
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Computes integer pixel coordinates along a line segment using Bresenham's algorithm.
 */
export function bresenhamLine(x0: number, y0: number, x1: number, y1: number): Point[] {
  const points: Point[] = [];
  let cx = Math.floor(x0);
  let cy = Math.floor(y0);
  const tx = Math.floor(x1);
  const ty = Math.floor(y1);

  const dx = Math.abs(tx - cx);
  const sx = cx < tx ? 1 : -1;
  const dy = -Math.abs(ty - cy);
  const sy = cy < ty ? 1 : -1;
  let err = dx + dy;

  while (true) {
    points.push({ x: cx, y: cy });
    if (cx === tx && cy === ty) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      cx += sx;
    }
    if (e2 <= dx) {
      err += dx;
      cy += sy;
    }
  }
  return points;
}

/**
 * Filters a sequence of stroke points to remove L-corners (pixel-perfect mode).
 */
export function filterPixelPerfect(points: readonly Point[]): Point[] {
  if (points.length < 3) return [...points];
  const result: Point[] = [points[0]];
  let i = 1;
  while (i < points.length - 1) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    const isCorner =
      Math.abs(prev.x - curr.x) + Math.abs(prev.y - curr.y) === 1 &&
      Math.abs(curr.x - next.x) + Math.abs(curr.y - next.y) === 1 &&
      prev.x !== next.x &&
      prev.y !== next.y;
    if (isCorner) {
      result.push(next);
      i += 2;
    } else {
      result.push(curr);
      i += 1;
    }
  }
  if (result[result.length - 1] !== points[points.length - 1]) {
    result.push(points[points.length - 1]);
  }
  return result;
}

/**
 * Converts RGBA (0..255) to a CSS hex string (#RRGGBB or #RRGGBBAA).
 */
export function rgbaToHex(color: RGBA, includeAlpha = false): string {
  const r = clamp(Math.round(color.r), 0, 255).toString(16).padStart(2, "0");
  const g = clamp(Math.round(color.g), 0, 255).toString(16).padStart(2, "0");
  const b = clamp(Math.round(color.b), 0, 255).toString(16).padStart(2, "0");
  if (!includeAlpha) {
    return `#${r}${g}${b}`.toUpperCase();
  }
  const a = clamp(Math.round(color.a), 0, 255).toString(16).padStart(2, "0");
  return `#${r}${g}${b}${a}`.toUpperCase();
}

/**
 * Parses a hex string (#RGB, #RRGGBB, or #RRGGBBAA) into RGBA.
 */
export function hexToRgba(hex: string, fallbackAlpha = 255): RGBA {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return { r: 0, g: 0, b: 0, a: fallbackAlpha };
    }
    return { r, g, b, a: fallbackAlpha };
  }
  if (clean.length === 6 || clean.length === 8) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const a = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) : fallbackAlpha;
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) {
      return { r: 0, g: 0, b: 0, a: fallbackAlpha };
    }
    return { r, g, b, a };
  }
  return { r: 0, g: 0, b: 0, a: fallbackAlpha };
}

/**
 * Converts RGB (0..255) to HSV (h: 0..360, s: 0..100, v: 0..100).
 */
export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    v: Math.round(v * 100),
  };
}

/**
 * Converts HSV (h: 0..360, s: 0..100, v: 0..100) to RGBA with specified alpha.
 */
export function hsvToRgba(h: number, s: number, v: number, a = 255): RGBA {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = clamp(s, 0, 100) / 100;
  const vn = clamp(v, 0, 100) / 100;

  const i = Math.floor(hn * 6);
  const f = hn * 6 - i;
  const p = vn * (1 - sn);
  const q = vn * (1 - f * sn);
  const t = vn * (1 - (1 - f) * sn);

  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = vn;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = vn;
      b = p;
      break;
    case 2:
      r = p;
      g = vn;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = vn;
      break;
    case 4:
      r = t;
      g = p;
      b = vn;
      break;
    case 5:
      r = vn;
      g = p;
      b = q;
      break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
    a: clamp(Math.round(a), 0, 255),
  };
}

/**
 * Converts RGB (0..255) to HSL (h: 0..360, s: 0..100, l: 0..100).
 */
export function rgbToHsl(r: number, g: number, b: number): HSL {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Converts HSL (h: 0..360, s: 0..100, l: 0..100) to RGBA.
 */
export function hslToRgba(h: number, s: number, l: number, a = 255): RGBA {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;

  if (sn === 0) {
    const v = Math.round(ln * 255);
    return { r: v, g: v, b: v, a };
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return {
    r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hn) * 255),
    b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
    a: clamp(Math.round(a), 0, 255),
  };
}
