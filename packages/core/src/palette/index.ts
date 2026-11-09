/**
 * @module @kekenik/core/palette
 * Pure TypeScript Color & Palette Engine: 12 Built-in Palette Presets, RGB/HSV/HSL Ramp Generator,
 * Tint/Shade Generator, 8-Criterion Sorting, Swatch Drag Reorder & Indexed Pixel Remapping,
 * Median-Cut & K-Means Color Quantizers, Palette Format Codecs (.gpl, .pal JASC/RIFF, .hex, .act, .col),
 * and RGBA <-> Grayscale <-> Indexed Color Mode Conversion with Ordered Bayer & Floyd-Steinberg Dithering.
 * Zero DOM, React, or Electron imports.
 */

import {
  DitherMatrixId,
  evaluateDitherMatrix,
} from "../brush/index.ts";
import {
  ColorMode,
  compositeFrame,
  DEFAULT_PALETTE_COLORS,
  getPaletteForFrame,
  PixelImage,
  ReadonlySprite,
} from "../model/index.ts";
import {
  clamp,
  hexToRgba,
  hslToRgba,
  hsvToRgba,
  RGBA,
  rgbaToHex,
  rgbToHsl,
  rgbToHsv,
} from "../util/index.ts";

export type PaletteSortCriterion =
  | "hue"
  | "saturation"
  | "value"
  | "luminance"
  | "red"
  | "green"
  | "blue"
  | "alpha";

export type PaletteRampColorSpace = "rgb" | "hsv" | "hsl";

export type IndexedDitherAlgorithm =
  | "none"
  | "bayer2x2"
  | "bayer4x4"
  | "bayer8x8"
  | "floyd_steinberg"
  | "old_style";

export interface PalettePresetDefinition {
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly license: string;
  readonly colors: readonly RGBA[];
}

function hexListToRgba(hexes: readonly string[]): RGBA[] {
  return hexes.map((h) => hexToRgba(h));
}

/**
 * 12 Built-in Pixel-Art Palette Presets (all Public Domain / CC0 or Original Kekenik palettes).
 */
export const BUILTIN_PALETTE_PRESETS: readonly PalettePresetDefinition[] = [
  {
    id: "kekenik_32",
    name: "Kekenik-32 (Default)",
    author: "Kekenik Studio",
    license: "CC0-1.0 / Public Domain",
    colors: [...DEFAULT_PALETTE_COLORS],
  },
  {
    id: "db16",
    name: "DB16 Classic 16-Color",
    author: "DawnBringer (Public Spec)",
    license: "CC0 / Public Domain Color Values",
    colors: hexListToRgba([
      "#140c1c", "#442434", "#30346d", "#4e4a4e",
      "#854c30", "#346524", "#d04648", "#757161",
      "#597dce", "#d27d2c", "#8595a1", "#6daa2c",
      "#d2aa99", "#6dc2ca", "#dad45e", "#deeed6",
    ]),
  },
  {
    id: "db32",
    name: "DB32 Classic 32-Color",
    author: "DawnBringer (Public Spec)",
    license: "CC0 / Public Domain Color Values",
    colors: [...DEFAULT_PALETTE_COLORS],
  },
  {
    id: "pico8",
    name: "Pico-8 Fantasy 16",
    author: "Lexaloffle Standard 16",
    license: "Public Domain Color Values",
    colors: hexListToRgba([
      "#000000", "#1d2b53", "#7e2553", "#008751",
      "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
      "#ff004d", "#ffa300", "#ffec27", "#00e436",
      "#29adff", "#83769c", "#ff77a8", "#ffccaa",
    ]),
  },
  {
    id: "endesga32",
    name: "Endesga-32 Vibrant",
    author: "Kekenik Vibrant 32",
    license: "CC0 / Public Domain Color Values",
    colors: hexListToRgba([
      "#be4a2f", "#d77643", "#ead4aa", "#e4a672",
      "#b86f50", "#733e39", "#3e2731", "#a22633",
      "#e43b44", "#f77622", "#feae34", "#fee761",
      "#63c74d", "#3e8948", "#265c42", "#193c3e",
      "#124e89", "#0099db", "#2ce8f5", "#ffffff",
      "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466",
      "#262b44", "#181425", "#ff0044", "#68386c",
      "#b55088", "#f6757a", "#e8b796", "#c28569",
    ]),
  },
  {
    id: "gameboy",
    name: "GameBoy DMG-01 4-Shade",
    author: "Classic Handheld",
    license: "CC0 / Public Domain",
    colors: hexListToRgba(["#0f380f", "#306230", "#8bac0f", "#9bbc0f"]),
  },
  {
    id: "nes16",
    name: "8-Bit Console 16",
    author: "Kekenik Studio",
    license: "CC0-1.0",
    colors: hexListToRgba([
      "#000000", "#fcfcfc", "#f8f8f8", "#bcbcbc",
      "#7c7c7c", "#a4e4fc", "#3cbcfc", "#0078f8",
      "#0000fc", "#b8b8f8", "#6888fc", "#0058f8",
      "#f83800", "#e40058", "#58d854", "#00a800",
    ]),
  },
  {
    id: "cga16",
    name: "CGA 16-Color PC",
    author: "IBM CGA Standard",
    license: "Public Domain",
    colors: hexListToRgba([
      "#000000", "#0000aa", "#00aa00", "#00aaaa",
      "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa",
      "#555555", "#5555ff", "#55ff55", "#55ffff",
      "#ff5555", "#ff55ff", "#ffff55", "#ffffff",
    ]),
  },
  {
    id: "cyberpunk16",
    name: "Neon Synthwave 16",
    author: "Kekenik Studio",
    license: "CC0-1.0",
    colors: hexListToRgba([
      "#0b0614", "#1b1035", "#32195b", "#542282",
      "#8c2799", "#c9299b", "#ff2a85", "#ff6699",
      "#ff99b3", "#00f0ff", "#00b8ff", "#0077ff",
      "#ffe600", "#ff9900", "#22ff88", "#ffffff",
    ]),
  },
  {
    id: "pastel16",
    name: "Pastel Dream 16",
    author: "Kekenik Studio",
    license: "CC0-1.0",
    colors: hexListToRgba([
      "#2d2a32", "#59546c", "#8b85a1", "#c4b7cb",
      "#f7e1d7", "#edafb8", "#f4978e", "#f8ad9d",
      "#fbc4ab", "#ffdab9", "#e2ece9", "#bee1e6",
      "#cddafd", "#dfe7fd", "#b5e48c", "#d9ed92",
    ]),
  },
  {
    id: "earth16",
    name: "Forest & Earth 16",
    author: "Kekenik Studio",
    license: "CC0-1.0",
    colors: hexListToRgba([
      "#161311", "#2e2621", "#4d3c30", "#735742",
      "#9c7858", "#c49e76", "#e6c89c", "#f5e6c8",
      "#1c2b1e", "#2d472c", "#466939", "#6a9146",
      "#96b85c", "#c6db7d", "#3a4f66", "#6b8ea6",
    ]),
  },
  {
    id: "monochrome8",
    name: "Monochrome 8-Step",
    author: "Kekenik Studio",
    license: "CC0-1.0",
    colors: hexListToRgba([
      "#000000", "#242424", "#494949", "#6d6d6d",
      "#929292", "#b6b6b6", "#dbdbdb", "#ffffff",
    ]),
  },
];

/**
 * Generates a smooth color ramp between `fromIndex` and `toIndex` in `colors` using RGB, HSV, or HSL interpolation.
 */
export function generatePaletteRamp(
  colors: readonly RGBA[],
  fromIndex: number,
  toIndex: number,
  space: PaletteRampColorSpace = "rgb"
): RGBA[] {
  const out = colors.map((c) => ({ ...c }));
  const i0 = clamp(Math.min(fromIndex, toIndex), 0, out.length - 1);
  const i1 = clamp(Math.max(fromIndex, toIndex), 0, out.length - 1);
  const span = i1 - i0;
  if (span <= 1) return out;

  const start = out[i0];
  const end = out[i1];

  for (let step = 1; step < span; step++) {
    const t = step / span;
    const alpha = Math.round(start.a + (end.a - start.a) * t);

    if (space === "rgb") {
      out[i0 + step] = {
        r: Math.round(start.r + (end.r - start.r) * t),
        g: Math.round(start.g + (end.g - start.g) * t),
        b: Math.round(start.b + (end.b - start.b) * t),
        a: alpha,
      };
    } else if (space === "hsv") {
      const hsvA = rgbToHsv(start.r, start.g, start.b);
      const hsvB = rgbToHsv(end.r, end.g, end.b);
      let dh = hsvB.h - hsvA.h;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      const h = (hsvA.h + dh * t + 360) % 360;
      const s = hsvA.s + (hsvB.s - hsvA.s) * t;
      const v = hsvA.v + (hsvB.v - hsvA.v) * t;
      out[i0 + step] = hsvToRgba(h, s, v, alpha);
    } else {
      const hslA = rgbToHsl(start.r, start.g, start.b);
      const hslB = rgbToHsl(end.r, end.g, end.b);
      let dh = hslB.h - hslA.h;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      const h = (hslA.h + dh * t + 360) % 360;
      const s = hslA.s + (hslB.s - hslA.s) * t;
      const l = hslA.l + (hslB.l - hslA.l) * t;
      out[i0 + step] = hslToRgba(h, s, l, alpha);
    }
  }
  return out;
}

/**
 * Generates a Tint & Shade ramp of `steps` colors ranging from dark shade through `baseColor` to light tint.
 */
export function generateTintShadeRamp(baseColor: RGBA, steps = 7): RGBA[] {
  const count = clamp(Math.floor(steps), 3, 16);
  const hsl = rgbToHsl(baseColor.r, baseColor.g, baseColor.b);
  const ramp: RGBA[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1); // 0 = dark shade, 0.5 = base, 1 = light tint
    const l = clamp(Math.round(12 + t * 80), 5, 95);
    const s = clamp(Math.round(hsl.s * (1 - Math.abs(t - 0.5) * 0.35)), 0, 100);
    ramp.push(hslToRgba(hsl.h, s, l, baseColor.a));
  }
  return ramp;
}

/**
 * Sorts a palette by `criterion` (`hue`, `saturation`, `value`, `luminance`, `red`, `green`, `blue`, `alpha`)
 * and returns both the sorted colors and `oldToNewIndexMap` so indexed sprite pixels can be remapped losslessly.
 */
export function sortPaletteColors(
  colors: readonly RGBA[],
  criterion: PaletteSortCriterion,
  ascending = true
): {
  colors: RGBA[];
  oldToNewIndexMap: number[];
} {
  const indexed = colors.map((c, oldIdx) => ({ color: { ...c }, oldIdx }));

  const metric = (c: RGBA): number => {
    switch (criterion) {
      case "hue":
        return rgbToHsv(c.r, c.g, c.b).h;
      case "saturation":
        return rgbToHsv(c.r, c.g, c.b).s;
      case "value":
        return rgbToHsv(c.r, c.g, c.b).v;
      case "luminance":
        return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
      case "red":
        return c.r;
      case "green":
        return c.g;
      case "blue":
        return c.b;
      case "alpha":
        return c.a;
    }
  };

  indexed.sort((a, b) => {
    const diff = metric(a.color) - metric(b.color);
    return ascending ? diff : -diff;
  });

  const oldToNewIndexMap = new Array<number>(colors.length).fill(0);
  const sortedColors = indexed.map((entry, newIdx) => {
    oldToNewIndexMap[entry.oldIdx] = newIdx;
    return entry.color;
  });

  return { colors: sortedColors, oldToNewIndexMap };
}

/**
 * Reverses either the entire palette or a selected subset of swatch indices, returning `oldToNewIndexMap`.
 */
export function reversePaletteColors(
  colors: readonly RGBA[],
  selectedIndices?: readonly number[]
): {
  colors: RGBA[];
  oldToNewIndexMap: number[];
} {
  const n = colors.length;
  const indices =
    selectedIndices && selectedIndices.length >= 2
      ? [...selectedIndices].sort((a, b) => a - b)
      : Array.from({ length: n }, (_, i) => i);

  const out = colors.map((c) => ({ ...c }));
  const oldToNewIndexMap = Array.from({ length: n }, (_, i) => i);

  for (let k = 0; k < indices.length; k++) {
    const srcIdx = indices[k];
    const dstIdx = indices[indices.length - 1 - k];
    out[dstIdx] = { ...colors[srcIdx] };
    oldToNewIndexMap[srcIdx] = dstIdx;
  }

  return { colors: out, oldToNewIndexMap };
}

/**
 * Moves or copies `selectedIndices` swatches to `targetIndex` in the palette, returning `oldToNewIndexMap`.
 */
export function reorderPaletteSwatches(
  colors: readonly RGBA[],
  selectedIndices: readonly number[],
  targetIndex: number,
  copyMode = false
): {
  colors: RGBA[];
  oldToNewIndexMap: number[];
} {
  const n = colors.length;
  const validSel = Array.from(new Set(selectedIndices.filter((i) => i >= 0 && i < n))).sort(
    (a, b) => a - b
  );
  if (validSel.length === 0) {
    return {
      colors: colors.map((c) => ({ ...c })),
      oldToNewIndexMap: Array.from({ length: n }, (_, i) => i),
    };
  }

  if (copyMode) {
    const out = colors.map((c) => ({ ...c }));
    for (let k = 0; k < validSel.length; k++) {
      const dst = clamp(targetIndex + k, 0, n - 1);
      out[dst] = { ...colors[validSel[k]] };
    }
    return {
      colors: out,
      oldToNewIndexMap: Array.from({ length: n }, (_, i) => i),
    };
  }

  const selSet = new Set(validSel);
  const picked = validSel.map((oldIdx) => ({ color: { ...colors[oldIdx] }, oldIdx }));
  const remaining = colors
    .map((c, oldIdx) => ({ color: { ...c }, oldIdx }))
    .filter((item) => !selSet.has(item.oldIdx));

  const insertPos = clamp(targetIndex, 0, remaining.length);
  const combined = [
    ...remaining.slice(0, insertPos),
    ...picked,
    ...remaining.slice(insertPos),
  ];

  const oldToNewIndexMap = new Array<number>(n).fill(0);
  const outColors = combined.map((entry, newIdx) => {
    oldToNewIndexMap[entry.oldIdx] = newIdx;
    return entry.color;
  });

  return { colors: outColors, oldToNewIndexMap };
}

/**
 * Remaps all palette index values in an Indexed `PixelImage` according to `oldToNewIndexMap`
 * so changing the order of palette swatches preserves the visual appearance of the sprite.
 */
export function remapIndexedImagePixels(
  image: PixelImage,
  oldToNewIndexMap: readonly number[]
): PixelImage {
  const out = image.clone();
  if (out.colorMode !== "indexed") return out;
  for (let i = 0; i < out.data.length; i++) {
    const oldIdx = out.data[i];
    if (oldIdx >= 0 && oldIdx < oldToNewIndexMap.length) {
      out.data[i] = oldToNewIndexMap[oldIdx] & 0xff;
    }
  }
  return out;
}

/**
 * Extracts all unique non-transparent RGBA colors present across all frames of `sprite`.
 */
export function extractUniqueColorsFromSprite(sprite: ReadonlySprite): RGBA[] {
  const seen = new Set<number>();
  const unique: RGBA[] = [];
  for (let f = 0; f < sprite.frames.length; f++) {
    const comp = compositeFrame(sprite, f);
    for (let y = 0; y < comp.height; y++) {
      for (let x = 0; x < comp.width; x++) {
        const c = comp.getRGBA(x, y);
        if (c.a === 0) continue;
        const key = ((c.r << 16) | (c.g << 8) | c.b) >>> 0;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push({ r: c.r, g: c.g, b: c.b, a: 255 });
        }
      }
    }
  }
  return unique;
}

/**
 * Quantizes an array of RGBA colors down to at most `maxColors` using Heckbert's **Median-Cut** algorithm.
 */
export function quantizeColorsMedianCut(
  inputColors: readonly RGBA[],
  maxColors: number
): RGBA[] {
  const targetCount = clamp(Math.floor(maxColors), 2, 256);
  const opaque = inputColors.filter((c) => c.a > 0);
  if (opaque.length === 0) {
    return [{ r: 0, g: 0, b: 0, a: 255 }];
  }
  if (opaque.length <= targetCount) {
    return opaque.map((c) => ({ ...c, a: 255 }));
  }

  interface ColorBox {
    colors: RGBA[];
  }

  const boxes: ColorBox[] = [{ colors: opaque.map((c) => ({ ...c })) }];

  const channelRange = (list: RGBA[]) => {
    let minR = 255, maxR = 0;
    let minG = 255, maxG = 0;
    let minB = 255, maxB = 0;
    for (const c of list) {
      if (c.r < minR) minR = c.r;
      if (c.r > maxR) maxR = c.r;
      if (c.g < minG) minG = c.g;
      if (c.g > maxG) maxG = c.g;
      if (c.b < minB) minB = c.b;
      if (c.b > maxB) maxB = c.b;
    }
    return {
      rRange: maxR - minR,
      gRange: maxG - minG,
      bRange: maxB - minB,
      maxSpan: Math.max(maxR - minR, maxG - minG, maxB - minB),
    };
  };

  while (boxes.length < targetCount) {
    let bestBoxIdx = -1;
    let bestSpan = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].colors.length < 2) continue;
      const span = channelRange(boxes[i].colors).maxSpan;
      if (span > bestSpan) {
        bestSpan = span;
        bestBoxIdx = i;
      }
    }
    if (bestBoxIdx === -1) break;

    const box = boxes[bestBoxIdx];
    const { rRange, gRange, bRange } = channelRange(box.colors);
    if (rRange >= gRange && rRange >= bRange) {
      box.colors.sort((a, b) => a.r - b.r);
    } else if (gRange >= rRange && gRange >= bRange) {
      box.colors.sort((a, b) => a.g - b.g);
    } else {
      box.colors.sort((a, b) => a.b - b.b);
    }

    const mid = Math.floor(box.colors.length / 2);
    const left = box.colors.slice(0, mid);
    const right = box.colors.slice(mid);
    boxes.splice(bestBoxIdx, 1, { colors: left }, { colors: right });
  }

  return boxes.map((box) => {
    let sr = 0, sg = 0, sb = 0;
    for (const c of box.colors) {
      sr += c.r;
      sg += c.g;
      sb += c.b;
    }
    const n = Math.max(1, box.colors.length);
    return {
      r: Math.round(sr / n),
      g: Math.round(sg / n),
      b: Math.round(sb / n),
      a: 255,
    };
  });
}

/**
 * Quantizes an array of RGBA colors down to at most `maxColors` using deterministic **K-Means** clustering.
 */
export function quantizeColorsKMeans(
  inputColors: readonly RGBA[],
  maxColors: number,
  iterations = 8
): RGBA[] {
  const k = clamp(Math.floor(maxColors), 2, 256);
  const opaque = inputColors.filter((c) => c.a > 0);
  if (opaque.length === 0) return [{ r: 0, g: 0, b: 0, a: 255 }];
  if (opaque.length <= k) return opaque.map((c) => ({ ...c, a: 255 }));

  // Deterministic k-means++ style evenly-spaced seed initialization
  const centroids: RGBA[] = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor((i * (opaque.length - 1)) / Math.max(1, k - 1));
    centroids.push({ ...opaque[idx], a: 255 });
  }

  for (let iter = 0; iter < iterations; iter++) {
    const sums = Array.from({ length: k }, () => ({ r: 0, g: 0, b: 0, count: 0 }));
    for (const c of opaque) {
      let bestK = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let j = 0; j < k; j++) {
        const ct = centroids[j];
        const dr = c.r - ct.r;
        const dg = c.g - ct.g;
        const db = c.b - ct.b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) {
          bestDist = d;
          bestK = j;
        }
      }
      sums[bestK].r += c.r;
      sums[bestK].g += c.g;
      sums[bestK].b += c.b;
      sums[bestK].count += 1;
    }
    for (let j = 0; j < k; j++) {
      if (sums[j].count > 0) {
        centroids[j] = {
          r: Math.round(sums[j].r / sums[j].count),
          g: Math.round(sums[j].g / sums[j].count),
          b: Math.round(sums[j].b / sums[j].count),
          a: 255,
        };
      }
    }
  }
  return centroids;
}

/**
 * Extracts a new palette from `sprite` with transparent index 0 followed by up to `maxColors - 1` quantized colors.
 */
export function extractPaletteFromSprite(
  sprite: ReadonlySprite,
  maxColors = 16,
  algorithm: "median_cut" | "kmeans" | "unique" = "median_cut"
): RGBA[] {
  const unique = extractUniqueColorsFromSprite(sprite);
  const limit = clamp(Math.floor(maxColors), 2, 256);
  let body: RGBA[];
  if (algorithm === "unique" || unique.length <= limit - 1) {
    body = unique.slice(0, limit - 1);
  } else if (algorithm === "kmeans") {
    body = quantizeColorsKMeans(unique, limit - 1);
  } else {
    body = quantizeColorsMedianCut(unique, limit - 1);
  }
  return [{ r: 0, g: 0, b: 0, a: 255 }, ...body];
}

// ---------------------------------------------------------------------------
// Palette File Format Codecs (.gpl, .pal JASC & RIFF, .hex, .act, .col)
// ---------------------------------------------------------------------------

/**
 * Encodes a palette into GIMP `.gpl` text format.
 */
export function encodeGplPalette(
  colors: readonly RGBA[],
  name = "Kekenik Palette",
  entryNames: Record<number, string> = {}
): string {
  const lines = [
    "GIMP Palette",
    `Name: ${name}`,
    "Columns: 8",
    "# Generated by Kekenik Pixel",
  ];
  colors.forEach((c, idx) => {
    const r = String(clamp(c.r, 0, 255)).padStart(3, " ");
    const g = String(clamp(c.g, 0, 255)).padStart(3, " ");
    const b = String(clamp(c.b, 0, 255)).padStart(3, " ");
    const label = entryNames[idx] ?? `Index ${idx}`;
    lines.push(`${r} ${g} ${b}\t${label}`);
  });
  return lines.join("\n") + "\n";
}

/**
 * Decodes a GIMP `.gpl` text palette into colors, palette name, and optional entry names.
 */
export function decodeGplPalette(text: string): {
  name: string;
  colors: RGBA[];
  entryNames: Record<number, string>;
} {
  const lines = text.split(/\r?\n/);
  let name = "Imported GPL Palette";
  const colors: RGBA[] = [];
  const entryNames: Record<number, string> = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("GIMP Palette") || line.startsWith("Columns:")) {
      continue;
    }
    if (line.startsWith("Name:")) {
      name = line.slice(5).trim() || name;
      continue;
    }
    const match = line.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/);
    if (match) {
      const idx = colors.length;
      colors.push({
        r: clamp(Number(match[1]), 0, 255),
        g: clamp(Number(match[2]), 0, 255),
        b: clamp(Number(match[3]), 0, 255),
        a: 255,
      });
      if (match[4]) {
        entryNames[idx] = match[4].trim();
      }
    }
  }
  return { name, colors, entryNames };
}

/**
 * Encodes a palette into JASC-PAL `.pal` text format.
 */
export function encodeJascPalPalette(colors: readonly RGBA[]): string {
  const lines = ["JASC-PAL", "0100", String(colors.length)];
  for (const c of colors) {
    lines.push(`${clamp(c.r, 0, 255)} ${clamp(c.g, 0, 255)} ${clamp(c.b, 0, 255)}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Decodes a JASC-PAL `.pal` text string into an RGBA array.
 */
export function decodeJascPalPalette(text: string): RGBA[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines[0] !== "JASC-PAL") {
    throw new Error("Invalid JASC-PAL header");
  }
  const colors: RGBA[] = [];
  for (let i = 3; i < lines.length; i++) {
    const parts = lines[i].split(/\s+/).map(Number);
    if (parts.length >= 3 && !parts.some(Number.isNaN)) {
      colors.push({
        r: clamp(parts[0], 0, 255),
        g: clamp(parts[1], 0, 255),
        b: clamp(parts[2], 0, 255),
        a: parts[3] !== undefined ? clamp(parts[3], 0, 255) : 255,
      });
    }
  }
  return colors;
}

/**
 * Encodes a palette into binary Microsoft RIFF `.pal` format.
 */
export function encodeRiffPalPalette(colors: readonly RGBA[]): Uint8Array {
  const count = colors.length;
  const dataChunkSize = 4 + count * 4;
  const totalSize = 12 + 8 + dataChunkSize;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  // "RIFF" + fileSize + "PAL " + "data"
  out.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, totalSize - 8, true);
  out.set([0x50, 0x41, 0x4c, 0x20], 8);
  out.set([0x64, 0x61, 0x74, 0x61], 12);
  view.setUint32(16, dataChunkSize, true);
  view.setUint16(20, 0x0300, true); // palVersion
  view.setUint16(22, count, true); // palNumEntries

  for (let i = 0; i < count; i++) {
    const offset = 24 + i * 4;
    out[offset] = clamp(colors[i].r, 0, 255);
    out[offset + 1] = clamp(colors[i].g, 0, 255);
    out[offset + 2] = clamp(colors[i].b, 0, 255);
    out[offset + 3] = 0;
  }
  return out;
}

/**
 * Decodes a binary RIFF `.pal` file (or falls back to JASC-PAL text if ASCII) into an RGBA array.
 */
export function decodeRiffPalPalette(bytes: Uint8Array): RGBA[] {
  // Check if ASCII JASC-PAL
  if (bytes.length >= 8 && bytes[0] === 0x4a && bytes[1] === 0x41) {
    const text = new TextDecoder().decode(bytes);
    return decodeJascPalPalette(text);
  }
  if (bytes.length < 24 || bytes[0] !== 0x52 || bytes[1] !== 0x49) {
    throw new Error("Invalid RIFF PAL header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(22, true);
  const colors: RGBA[] = [];
  for (let i = 0; i < count && 24 + i * 4 + 2 < bytes.length; i++) {
    const offset = 24 + i * 4;
    colors.push({
      r: bytes[offset],
      g: bytes[offset + 1],
      b: bytes[offset + 2],
      a: 255,
    });
  }
  return colors;
}

/**
 * Encodes a palette into `.hex` format (one 6-digit hex code per line).
 */
export function encodeHexPalette(colors: readonly RGBA[]): string {
  return (
    colors
      .map((c) => rgbaToHex(c).replace(/^#/, "").slice(0, 6).toLowerCase())
      .join("\n") + "\n"
  );
}

/**
 * Decodes a `.hex` palette string into an RGBA array.
 */
export function decodeHexPalette(text: string): RGBA[] {
  const colors: RGBA[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const cleaned = raw.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(cleaned)) {
      colors.push(hexToRgba(`#${cleaned}`));
    }
  }
  return colors;
}

/**
 * Encodes a palette into a 772-byte Adobe Color Table (`.act`) binary buffer.
 */
export function encodeActPalette(colors: readonly RGBA[]): Uint8Array {
  const out = new Uint8Array(772);
  const count = clamp(colors.length, 1, 256);
  for (let i = 0; i < count; i++) {
    out[i * 3] = clamp(colors[i].r, 0, 255);
    out[i * 3 + 1] = clamp(colors[i].g, 0, 255);
    out[i * 3 + 2] = clamp(colors[i].b, 0, 255);
  }
  out[768] = (count >> 8) & 0xff;
  out[769] = count & 0xff;
  out[770] = 0xff;
  out[771] = 0xff;
  return out;
}

/**
 * Decodes an Adobe Color Table (`.act`, 768 or 772 bytes) binary buffer into an RGBA array.
 */
export function decodeActPalette(bytes: Uint8Array): RGBA[] {
  if (bytes.length < 768) {
    throw new Error("Invalid .act buffer length (< 768 bytes)");
  }
  let count = 256;
  if (bytes.length >= 770) {
    const n = (bytes[768] << 8) | bytes[769];
    if (n >= 1 && n <= 256) count = n;
  }
  const colors: RGBA[] = [];
  for (let i = 0; i < count; i++) {
    colors.push({
      r: bytes[i * 3],
      g: bytes[i * 3 + 1],
      b: bytes[i * 3 + 2],
      a: 255,
    });
  }
  return colors;
}

/**
 * Encodes a palette into Animator Pro `.col` binary format.
 */
export function encodeColPalette(colors: readonly RGBA[]): Uint8Array {
  const count = clamp(colors.length, 1, 256);
  const size = 8 + count * 3;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, size, true);
  view.setUint16(4, 0xb123, true); // Animator Pro magic
  view.setUint16(6, 0, true);
  for (let i = 0; i < count; i++) {
    out[8 + i * 3] = clamp(colors[i].r, 0, 255);
    out[8 + i * 3 + 1] = clamp(colors[i].g, 0, 255);
    out[8 + i * 3 + 2] = clamp(colors[i].b, 0, 255);
  }
  return out;
}

/**
 * Decodes an Animator Pro `.col` binary palette buffer.
 */
export function decodeColPalette(bytes: Uint8Array): RGBA[] {
  if (bytes.length === 768) {
    // Raw 256x3 VGA 6-bit or 8-bit .col
    const colors: RGBA[] = [];
    for (let i = 0; i < 256; i++) {
      colors.push({
        r: bytes[i * 3],
        g: bytes[i * 3 + 1],
        b: bytes[i * 3 + 2],
        a: 255,
      });
    }
    return colors;
  }
  if (bytes.length < 11) throw new Error("Invalid .col palette file");
  const count = Math.min(256, Math.floor((bytes.length - 8) / 3));
  const colors: RGBA[] = [];
  for (let i = 0; i < count; i++) {
    colors.push({
      r: bytes[8 + i * 3],
      g: bytes[8 + i * 3 + 1],
      b: bytes[8 + i * 3 + 2],
      a: 255,
    });
  }
  return colors;
}

// ---------------------------------------------------------------------------
// Color Mode Conversion (RGBA <-> Grayscale <-> Indexed with Dithering)
// ---------------------------------------------------------------------------

function findTwoClosestPaletteIndices(
  r: number,
  g: number,
  b: number,
  palette: readonly RGBA[],
  transparentIndex: number
): { bestIdx: number; secondIdx: number; ratio: number } {
  let bestIdx = 0;
  let secondIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  let secondDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < palette.length; i++) {
    if (i === transparentIndex && palette.length > 1) continue;
    const p = palette[i];
    const dr = r - p.r;
    const dg = g - p.g;
    const db = b - p.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      secondDist = bestDist;
      secondIdx = bestIdx;
      bestDist = dist;
      bestIdx = i;
    } else if (dist < secondDist) {
      secondDist = dist;
      secondIdx = i;
    }
  }

  if (bestDist <= 1 || !Number.isFinite(secondDist) || bestDist + secondDist === 0) {
    return { bestIdx, secondIdx: bestIdx, ratio: 0 };
  }
  const d1 = Math.sqrt(bestDist);
  const d2 = Math.sqrt(secondDist);
  const ratio = clamp(d1 / (d1 + d2), 0, 1);
  return { bestIdx, secondIdx, ratio };
}

/**
 * Converts a single `PixelImage` to `targetMode` (`rgba`, `grayscale`, or `indexed`)
 * using the specified `dither` algorithm (`none`, `bayer2x2`, `bayer4x4`, `bayer8x8`, `floyd_steinberg`, `old_style`).
 */
export function convertImageColorMode(
  source: PixelImage,
  targetMode: ColorMode,
  palette: readonly RGBA[],
  transparentIndex = 0,
  dither: IndexedDitherAlgorithm = "none"
): PixelImage {
  const w = source.width;
  const h = source.height;
  const out = new PixelImage(w, h, targetMode);

  if (targetMode === "rgba") {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        out.setRGBA(x, y, source.getRGBA(x, y, palette, transparentIndex));
      }
    }
    return out;
  }

  if (targetMode === "grayscale") {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = source.getRGBA(x, y, palette, transparentIndex);
        out.setRGBA(x, y, c);
      }
    }
    return out;
  }

  // Target mode === "indexed"
  if (dither === "floyd_steinberg") {
    const errR = new Float32Array(w * h);
    const errG = new Float32Array(w * h);
    const errB = new Float32Array(w * h);
    const alphaBuf = new Uint8Array(w * h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = source.getRGBA(x, y, palette, transparentIndex);
        const idx = y * w + x;
        errR[idx] = c.r;
        errG[idx] = c.g;
        errB[idx] = c.b;
        alphaBuf[idx] = c.a;
      }
    }

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const pos = y * w + x;
        if (alphaBuf[pos] < 128) {
          out.putPixel(x, y, transparentIndex);
          continue;
        }
        const r = clamp(Math.round(errR[pos]), 0, 255);
        const g = clamp(Math.round(errG[pos]), 0, 255);
        const b = clamp(Math.round(errB[pos]), 0, 255);

        const { bestIdx } = findTwoClosestPaletteIndices(r, g, b, palette, transparentIndex);
        out.putPixel(x, y, bestIdx);

        const chosen = palette[bestIdx] ?? { r, g, b, a: 255 };
        const dr = r - chosen.r;
        const dg = g - chosen.g;
        const db = b - chosen.b;

        const distribute = (nx: number, ny: number, weight: number) => {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
          const npos = ny * w + nx;
          if (alphaBuf[npos] < 128) return;
          errR[npos] += dr * weight;
          errG[npos] += dg * weight;
          errB[npos] += db * weight;
        };

        distribute(x + 1, y, 7 / 16);
        distribute(x - 1, y + 1, 3 / 16);
        distribute(x, y + 1, 5 / 16);
        distribute(x + 1, y + 1, 1 / 16);
      }
    }
    return out;
  }

  const matrixId: DitherMatrixId =
    dither === "bayer2x2"
      ? "bayer2x2"
      : dither === "bayer8x8"
      ? "bayer8x8"
      : "bayer4x4";

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = source.getRGBA(x, y, palette, transparentIndex);
      if (c.a < 128) {
        out.putPixel(x, y, transparentIndex);
        continue;
      }

      if (dither === "none") {
        out.setRGBA(x, y, c, palette, transparentIndex);
        continue;
      }

      const { bestIdx, secondIdx, ratio } = findTwoClosestPaletteIndices(
        c.r,
        c.g,
        c.b,
        palette,
        transparentIndex
      );

      if (dither === "old_style") {
        const useSecond = ratio > 0.28 && (x + y) % 2 === 1;
        out.putPixel(x, y, useSecond ? secondIdx : bestIdx);
      } else {
        const useSecond = evaluateDitherMatrix(x, y, matrixId, ratio);
        out.putPixel(x, y, useSecond ? secondIdx : bestIdx);
      }
    }
  }

  return out;
}

/**
 * Resolves the `PaletteSpan` object active at `frameIndex` (or the default first span).
 */
export function getPaletteSpanForFrame(sprite: ReadonlySprite, frameIndex: number) {
  for (const span of sprite.palettes) {
    if (frameIndex >= span.fromFrame && frameIndex <= span.toFrame) {
      return span;
    }
  }
  return sprite.palettes[0];
}

export { getPaletteForFrame };
