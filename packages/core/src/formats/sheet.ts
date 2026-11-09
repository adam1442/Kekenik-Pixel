/**
 * @module formats/sheet
 * Sprite-sheet export (Layout / Sprite / Borders / Output options, JSON Hash + Array metadata) and sprite-sheet import.
 * Pure TypeScript: usable from the UI, the CLI and the scripting worker.
 */

import {
  Mask,
  PixelImage,
  compositeFrame,
  createModelId,
  type Layer,
  type Sprite,
} from "../model/index.ts";
import type { RgbaBitmap } from "./image.ts";

/** Sheet layouts offered by the Export Sprite Sheet dialog. */
export type SheetType = "horizontal" | "vertical" | "rows" | "columns" | "packed";
/** Constraint applied to "rows" / "columns" / "packed" layouts. */
export type SheetConstraint =
  | { kind: "none" }
  | { kind: "fixed-cols"; value: number }
  | { kind: "fixed-rows"; value: number }
  | { kind: "fixed-width"; value: number }
  | { kind: "fixed-height"; value: number };

/** All options of the Export Sprite Sheet dialog (Layout / Sprite / Borders / Output tabs). */
export interface SheetOptions {
  sheetType: SheetType;
  constraint: SheetConstraint;
  mergeDuplicates: boolean;
  ignoreEmpty: boolean;
  layers: "visible" | "selected" | "all";
  selectedLayerIds: string[];
  splitLayers: boolean;
  frames: "all" | "selected" | "tag";
  tag: string;
  frameRange: [number, number] | null;
  splitTags: boolean;
  borderPadding: number;
  spacing: number;
  innerPadding: number;
  trimSprite: boolean;
  trimCels: boolean;
  byGrid: boolean;
  gridWidth: number;
  gridHeight: number;
  extrude: boolean;
  scale: number;
  dataFormat: "json-hash" | "json-array";
  /** Image file name written in `meta.image`. */
  outputFile: string;
  /** Template of frame names inside the JSON: `{title}`, `{frame}`, `{layer}`, `{tag}`, `{extension}`. */
  frameNameTemplate: string;
}

/** Defaults matching the dialog's initial state. */
export const DEFAULT_SHEET_OPTIONS: SheetOptions = {
  sheetType: "horizontal",
  constraint: { kind: "none" },
  mergeDuplicates: false,
  ignoreEmpty: false,
  layers: "visible",
  selectedLayerIds: [],
  splitLayers: false,
  frames: "all",
  tag: "",
  frameRange: null,
  splitTags: false,
  borderPadding: 0,
  spacing: 0,
  innerPadding: 0,
  trimSprite: false,
  trimCels: false,
  byGrid: false,
  gridWidth: 16,
  gridHeight: 16,
  extrude: false,
  scale: 1,
  dataFormat: "json-array",
  outputFile: "sheet.png",
  frameNameTemplate: "{title} {frame}.{extension}",
};

/** JSON rectangle. */
export interface JsonRect { x: number; y: number; w: number; h: number }

/** One exported sheet (several when splitting layers / tags). */
export interface SheetResult {
  /** Suffix to insert in the output file name when the export produced several sheets. */
  suffix: string;
  bitmap: RgbaBitmap;
  /** JSON document (Hash or Array flavour). */
  data: Record<string, unknown>;
  dataText: string;
  frameCount: number;
}

interface Cell {
  frame: number;
  bmp: RgbaBitmap;
  src: JsonRect;
  trimmed: boolean;
  /** Original sprite size. */
  size: { w: number; h: number };
  duration: number;
  dupOf: number;
  x: number;
  y: number;
  name: string;
}

function hashBitmap(b: RgbaBitmap): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < b.data.length; i++) { h1 ^= b.data[i]; h1 = Math.imul(h1, 16777619); }
  return `${b.width}x${b.height}:${(h1 >>> 0).toString(16)}`;
}

function bounds(b: RgbaBitmap): JsonRect | null {
  let x0 = b.width, y0 = b.height, x1 = -1, y1 = -1;
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
    if (b.data[(y * b.width + x) * 4 + 3] !== 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function crop(b: RgbaBitmap, r: JsonRect): RgbaBitmap {
  const out = new Uint8Array(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) out.set(b.data.subarray(((r.y + y) * b.width + r.x) * 4, ((r.y + y) * b.width + r.x + r.w) * 4), y * r.w * 4);
  return { width: r.w, height: r.h, data: out };
}

function blitInto(dst: RgbaBitmap, src: RgbaBitmap, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      dst.data.set(src.data.subarray((y * src.width + x) * 4, (y * src.width + x) * 4 + 4), (ty * dst.width + tx) * 4);
    }
  }
}

/** Renders a frame using only the layers allowed by `visibleIds` (reference layers are never exported). */
export function renderFrameWithLayers(sprite: Sprite, frame: number, visibleIds: Set<string>): RgbaBitmap {
  const layers: Layer[] = sprite.layers.map((l) => ({ ...l, visible: visibleIds.has(l.id) || (l.kind === "group" && l.visible) }));
  const tmp: Sprite = { ...sprite, layers };
  const img = compositeFrame(tmp, frame);
  return { width: img.width, height: img.height, data: img.data };
}

function pickLayers(sprite: Sprite, o: SheetOptions): Layer[] {
  const notRef = (l: Layer): boolean => !l.reference && l.kind !== "group";
  if (o.layers === "all") return sprite.layers.filter(notRef);
  if (o.layers === "selected") return sprite.layers.filter((l) => notRef(l) && o.selectedLayerIds.includes(l.id));
  return sprite.layers.filter((l) => notRef(l) && l.visible);
}

function placeCells(cells: Cell[], o: SheetOptions): { width: number; height: number } {
  const pad = o.borderPadding;
  const sp = o.spacing;
  const ext = o.extrude ? 1 : 0;
  const unique = cells.filter((c) => c.dupOf < 0);
  const cw = (c: Cell): number => c.bmp.width + o.innerPadding * 2 + ext * 2;
  const ch = (c: Cell): number => c.bmp.height + o.innerPadding * 2 + ext * 2;
  const uniformW = Math.max(1, ...unique.map(cw));
  const uniformH = Math.max(1, ...unique.map(ch));
  const gridW = o.byGrid ? Math.max(uniformW, o.gridWidth) : uniformW;
  const gridH = o.byGrid ? Math.max(uniformH, o.gridHeight) : uniformH;
  const n = unique.length;
  let width = pad * 2, height = pad * 2;

  const gridLayout = (cols: number): void => {
    const rows = Math.ceil(n / cols);
    unique.forEach((c, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      c.x = pad + col * (gridW + sp);
      c.y = pad + row * (gridH + sp);
    });
    width = pad * 2 + cols * gridW + Math.max(0, cols - 1) * sp;
    height = pad * 2 + rows * gridH + Math.max(0, rows - 1) * sp;
  };

  switch (o.sheetType) {
    case "horizontal": {
      let x = pad;
      for (const c of unique) { c.x = x; c.y = pad; x += cw(c) + sp; }
      width = x - sp + pad; height = pad * 2 + Math.max(1, ...unique.map(ch));
      if (o.byGrid) gridLayout(Math.max(1, n));
      break;
    }
    case "vertical": {
      let y = pad;
      for (const c of unique) { c.x = pad; c.y = y; y += ch(c) + sp; }
      height = y - sp + pad; width = pad * 2 + Math.max(1, ...unique.map(cw));
      if (o.byGrid) gridLayout(1);
      break;
    }
    case "rows": {
      const k = o.constraint.kind;
      let cols = Math.ceil(Math.sqrt(n));
      if (k === "fixed-cols") cols = Math.max(1, o.constraint.value);
      else if (k === "fixed-rows") cols = Math.ceil(n / Math.max(1, o.constraint.value));
      else if (k === "fixed-width") cols = Math.max(1, Math.floor((o.constraint.value - pad * 2 + sp) / (gridW + sp)));
      gridLayout(Math.min(cols, Math.max(1, n)));
      break;
    }
    case "columns": {
      const k = o.constraint.kind;
      let rows = Math.ceil(Math.sqrt(n));
      if (k === "fixed-rows") rows = Math.max(1, o.constraint.value);
      else if (k === "fixed-cols") rows = Math.ceil(n / Math.max(1, o.constraint.value));
      else if (k === "fixed-height") rows = Math.max(1, Math.floor((o.constraint.value - pad * 2 + sp) / (gridH + sp)));
      rows = Math.min(rows, Math.max(1, n));
      const cols = Math.ceil(n / rows);
      unique.forEach((c, i) => { c.x = pad + Math.floor(i / rows) * (gridW + sp); c.y = pad + (i % rows) * (gridH + sp); });
      width = pad * 2 + cols * gridW + Math.max(0, cols - 1) * sp;
      height = pad * 2 + rows * gridH + Math.max(0, rows - 1) * sp;
      break;
    }
    case "packed": {
      // MaxRects (best short side fit), growing the sheet width until everything fits.
      const order = unique.slice().sort((a, b) => ch(b) - ch(a) || cw(b) - cw(a));
      const totalArea = order.reduce((s, c) => s + (cw(c) + sp) * (ch(c) + sp), 0);
      const widest = Math.max(1, ...order.map(cw));
      let target = Math.max(widest, Math.ceil(Math.sqrt(totalArea)));
      if (o.constraint.kind === "fixed-width") target = Math.max(widest, o.constraint.value - pad * 2);
      for (let attempt = 0; attempt < 64; attempt++) {
        const maxH = o.constraint.kind === "fixed-height" ? o.constraint.value - pad * 2 : 1 << 20;
        const free: JsonRect[] = [{ x: 0, y: 0, w: target + sp, h: maxH + sp }];
        let ok = true, usedW = 0, usedH = 0;
        for (const c of order) {
          const w = cw(c) + sp, h = ch(c) + sp;
          let best = -1, bs = Infinity;
          free.forEach((f, i) => { if (w <= f.w && h <= f.h) { const s = Math.min(f.w - w, f.h - h); if (s < bs) { bs = s; best = i; } } });
          if (best < 0) { ok = false; break; }
          const f = free[best];
          c.x = pad + f.x; c.y = pad + f.y;
          usedW = Math.max(usedW, f.x + w - sp); usedH = Math.max(usedH, f.y + h - sp);
          const placed = { x: f.x, y: f.y, w, h };
          const next: JsonRect[] = [];
          for (const r of free) {
            if (placed.x >= r.x + r.w || placed.x + placed.w <= r.x || placed.y >= r.y + r.h || placed.y + placed.h <= r.y) { next.push(r); continue; }
            if (placed.x > r.x) next.push({ x: r.x, y: r.y, w: placed.x - r.x, h: r.h });
            if (placed.x + placed.w < r.x + r.w) next.push({ x: placed.x + placed.w, y: r.y, w: r.x + r.w - placed.x - placed.w, h: r.h });
            if (placed.y > r.y) next.push({ x: r.x, y: r.y, w: r.w, h: placed.y - r.y });
            if (placed.y + placed.h < r.y + r.h) next.push({ x: r.x, y: placed.y + placed.h, w: r.w, h: r.y + r.h - placed.y - placed.h });
          }
          free.length = 0;
          free.push(...next.filter((a, ai) => !next.some((b, bi) => bi !== ai && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (ai > bi || a.w * a.h < b.w * b.h))));
        }
        if (ok) { width = usedW + pad * 2; height = usedH + pad * 2; break; }
        target = Math.ceil(target * 1.25);
      }
      break;
    }
  }
  for (const c of cells) if (c.dupOf >= 0) { const d = cells[c.dupOf]; c.x = d.x; c.y = d.y; }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

function baseName(sprite: Sprite): string {
  return sprite.name.replace(/\.[a-z0-9-]+$/i, "");
}

function frameName(tpl: string, title: string, frame: number, layer: string, tag: string): string {
  return tpl.replace("{title}", title).replace("{frame}", String(frame)).replace("{layer}", layer).replace("{tag}", tag).replace("{extension}", "aseprite");
}

function exportOne(sprite: Sprite, o: SheetOptions, frameIdx: number[], layers: Layer[], layerName: string, tagName: string, suffix: string): SheetResult {
  const ids = new Set(layers.map((l) => l.id));
  let rendered = frameIdx.map((f) => ({ f, bmp: renderFrameWithLayers(sprite, f, ids) }));
  const size = { w: sprite.width, h: sprite.height };
  // Trim sprite: crop all frames to the union of content.
  let common: JsonRect | null = null;
  if (o.trimSprite) {
    for (const r of rendered) {
      const b = bounds(r.bmp);
      if (!b) continue;
      common = common ? { x: Math.min(common.x, b.x), y: Math.min(common.y, b.y), w: Math.max(common.x + common.w, b.x + b.w) - Math.min(common.x, b.x), h: Math.max(common.y + common.h, b.y + b.h) - Math.min(common.y, b.y) } : b;
    }
  }
  const cells: Cell[] = [];
  for (const r of rendered) {
    let bmp = r.bmp;
    let src: JsonRect = { x: 0, y: 0, w: bmp.width, h: bmp.height };
    let trimmed = false;
    if (common) { bmp = crop(bmp, common); src = { ...common }; trimmed = true; }
    if (o.trimCels) {
      const b = bounds(bmp);
      if (b) { const nb = crop(bmp, b); src = { x: src.x + b.x, y: src.y + b.y, w: b.w, h: b.h }; bmp = nb; trimmed = true; }
      else if (!o.ignoreEmpty) { bmp = { width: 1, height: 1, data: new Uint8Array(4) }; src = { x: 0, y: 0, w: 1, h: 1 }; trimmed = true; }
    }
    if (o.ignoreEmpty && !bounds(bmp)) continue;
    cells.push({
      frame: r.f, bmp, src, trimmed, size, duration: sprite.frames[r.f]?.durationMs ?? 100, dupOf: -1, x: 0, y: 0,
      name: frameName(o.frameNameTemplate, baseName(sprite), r.f, layerName, tagName),
    });
  }
  rendered = [];
  if (o.mergeDuplicates) {
    const seen = new Map<string, number>();
    cells.forEach((c, i) => {
      const key = `${hashBitmap(c.bmp)}|${c.src.x},${c.src.y}`;
      const hit = seen.get(key);
      if (hit !== undefined) c.dupOf = hit; else seen.set(key, i);
    });
  }
  if (cells.length === 0) cells.push({ frame: frameIdx[0] ?? 0, bmp: { width: 1, height: 1, data: new Uint8Array(4) }, src: { x: 0, y: 0, w: 1, h: 1 }, trimmed: false, size, duration: 100, dupOf: -1, x: 0, y: 0, name: frameName(o.frameNameTemplate, baseName(sprite), 0, layerName, tagName) });
  const dim = placeCells(cells, o);
  const sheet: RgbaBitmap = { width: dim.width, height: dim.height, data: new Uint8Array(dim.width * dim.height * 4) };
  const ext = o.extrude ? 1 : 0;
  for (const c of cells) {
    if (c.dupOf >= 0) continue;
    const ox = c.x + o.innerPadding + ext, oy = c.y + o.innerPadding + ext;
    if (ext) {
      for (let y = -1; y <= c.bmp.height; y++) for (let x = -1; x <= c.bmp.width; x++) {
        if (x >= 0 && y >= 0 && x < c.bmp.width && y < c.bmp.height) continue;
        const sx = Math.max(0, Math.min(c.bmp.width - 1, x)), sy = Math.max(0, Math.min(c.bmp.height - 1, y));
        const tx = ox + x, ty = oy + y;
        if (tx < 0 || ty < 0 || tx >= sheet.width || ty >= sheet.height) continue;
        sheet.data.set(c.bmp.data.subarray((sy * c.bmp.width + sx) * 4, (sy * c.bmp.width + sx) * 4 + 4), (ty * sheet.width + tx) * 4);
      }
    }
    blitInto(sheet, c.bmp, ox, oy);
  }
  let final = sheet;
  const s = Math.max(1, Math.round(o.scale));
  if (s > 1) {
    const w = sheet.width * s, h = sheet.height * s;
    const d = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(sheet.data.subarray((Math.floor(y / s) * sheet.width + Math.floor(x / s)) * 4, (Math.floor(y / s) * sheet.width + Math.floor(x / s)) * 4 + 4), (y * w + x) * 4);
    final = { width: w, height: h, data: d };
  }

  const frameEntries = cells.map((c) => {
    const pad = o.innerPadding + ext;
    return {
      filename: c.name,
      frame: { x: (c.x + pad) * s, y: (c.y + pad) * s, w: c.bmp.width * s, h: c.bmp.height * s },
      rotated: false,
      trimmed: c.trimmed,
      spriteSourceSize: { x: c.src.x * s, y: c.src.y * s, w: c.src.w * s, h: c.src.h * s },
      sourceSize: { w: c.size.w * s, h: c.size.h * s },
      duration: c.duration,
    };
  });
  const hex = (c: string): string => (c.length === 7 ? `${c}ff` : c);
  const exported = new Set(cells.map((c) => c.frame));
  const lo = Math.min(...frameIdx), hi = Math.max(...frameIdx);
  const tags = sprite.tags
    .filter((t) => t.toFrame >= lo && t.fromFrame <= hi)
    .map((t) => ({ name: t.name, from: t.fromFrame, to: t.toFrame, direction: t.direction, color: hex(t.color), ...(t.repeat ? { repeat: String(t.repeat) } : {}) }));
  const meta = {
    app: "Kekenik Pixel",
    version: "1.0",
    image: o.outputFile.replace(/\.[^.]+$/, "") + suffix + (o.outputFile.match(/\.[^.]+$/)?.[0] ?? ".png"),
    format: "RGBA8888",
    size: { w: final.width, h: final.height },
    scale: String(s),
    frameTags: tags,
    layers: sprite.layers.map((l) => ({
      name: l.name,
      opacity: l.opacity,
      blendMode: l.blendMode,
      ...(l.parentId ? { group: sprite.layers.find((p) => p.id === l.parentId)?.name } : {}),
    })),
    slices: sprite.slices.map((sl) => ({
      name: sl.name,
      color: hex(sl.color),
      keys: sl.keys
        .filter((k) => exported.has(k.frameIndex) || frameIdx.includes(k.frameIndex))
        .map((k) => ({
          frame: k.frameIndex,
          bounds: { x: k.bounds.x * s, y: k.bounds.y * s, w: k.bounds.width * s, h: k.bounds.height * s },
          ...(k.center ? { center: { x: k.center.x * s, y: k.center.y * s, w: k.center.width * s, h: k.center.height * s } } : {}),
          ...(k.pivot ? { pivot: { x: k.pivot.x * s, y: k.pivot.y * s } } : {}),
        })),
    })),
  };
  let frames: unknown;
  if (o.dataFormat === "json-hash") {
    const h: Record<string, unknown> = {};
    for (const e of frameEntries) { const { filename, ...rest } = e; h[filename] = rest; }
    frames = h;
  } else frames = frameEntries;
  const data = { frames, meta };
  return { suffix, bitmap: final, data, dataText: JSON.stringify(data, null, 2), frameCount: cells.length };
}

/**
 * Exports a sprite sheet. Returns one result, or several when `splitLayers` / `splitTags` is enabled.
 * @param sprite source sprite
 * @param options partial options merged over {@link DEFAULT_SHEET_OPTIONS}
 */
export function exportSpriteSheet(sprite: Sprite, options: Partial<SheetOptions> = {}): SheetResult[] {
  const o: SheetOptions = { ...DEFAULT_SHEET_OPTIONS, ...options };
  const all = sprite.frames.map((_, i) => i);
  let frameSets: Array<{ frames: number[]; tag: string }> = [];
  if (o.splitTags && sprite.tags.length) frameSets = sprite.tags.map((t) => ({ frames: all.filter((i) => i >= t.fromFrame && i <= t.toFrame), tag: t.name }));
  else if (o.frames === "tag") {
    const t = sprite.tags.find((x) => x.name === o.tag);
    if (!t) throw new Error(`Tag "${o.tag}" not found`);
    frameSets = [{ frames: all.filter((i) => i >= t.fromFrame && i <= t.toFrame), tag: t.name }];
  } else if (o.frames === "selected" && o.frameRange) {
    frameSets = [{ frames: all.filter((i) => i >= o.frameRange![0] && i <= o.frameRange![1]), tag: "" }];
  } else frameSets = [{ frames: all, tag: "" }];
  const layers = pickLayers(sprite, o);
  const layerSets = o.splitLayers ? layers.map((l) => ({ layers: [l], name: l.name })) : [{ layers, name: "" }];
  const results: SheetResult[] = [];
  const multi = frameSets.length * layerSets.length > 1;
  for (const fs of frameSets) {
    for (const ls of layerSets) {
      const suffix = multi ? `${fs.tag ? `_${fs.tag}` : ""}${ls.name ? `_${ls.name}` : ""}`.replace(/\s+/g, "_") : "";
      results.push(exportOne(sprite, o, fs.frames, ls.layers, ls.name, fs.tag, suffix));
    }
  }
  return results;
}

/** Options for {@link importSpriteSheet}. */
export interface SheetImportOptions {
  tileWidth: number;
  tileHeight: number;
  offsetX: number;
  offsetY: number;
  paddingX: number;
  paddingY: number;
  /** Import tiles as animation frames (default) or as one layer per tile. */
  mode: "frames" | "layers";
  ignoreEmpty: boolean;
  /** Include cells that are partially outside the image. */
  partial: boolean;
  name: string;
}

/** Computes the grid cells an import would produce (used for the live overlay preview). */
export function computeImportGrid(imgW: number, imgH: number, o: SheetImportOptions): JsonRect[] {
  const cells: JsonRect[] = [];
  const tw = Math.max(1, o.tileWidth), th = Math.max(1, o.tileHeight);
  for (let y = o.offsetY; y < imgH; y += th + o.paddingY) {
    for (let x = o.offsetX; x < imgW; x += tw + o.paddingX) {
      const full = x + tw <= imgW && y + th <= imgH;
      if (full || (o.partial && x < imgW && y < imgH)) cells.push({ x, y, w: tw, h: th });
    }
  }
  return cells;
}

/** Imports a sprite sheet bitmap into a new RGBA sprite (frames or layers). */
export function importSpriteSheet(bmp: RgbaBitmap, o: SheetImportOptions): Sprite {
  const cells = computeImportGrid(bmp.width, bmp.height, o).filter((c) => !o.ignoreEmpty || bounds(crop(bmp, { x: c.x, y: c.y, w: Math.min(c.w, bmp.width - c.x), h: Math.min(c.h, bmp.height - c.y) })));
  if (!cells.length) throw new Error("The grid does not contain any tiles. Check tile size, offset and padding.");
  const mk = (c: JsonRect): PixelImage => {
    const img = new PixelImage(c.w, c.h, "rgba");
    const part = crop(bmp, { x: c.x, y: c.y, w: Math.min(c.w, bmp.width - c.x), h: Math.min(c.h, bmp.height - c.y) });
    for (let y = 0; y < part.height; y++) img.data.set(part.data.subarray(y * part.width * 4, (y + 1) * part.width * 4), y * c.w * 4);
    return img;
  };
  const w = o.tileWidth, h = o.tileHeight;
  const sprite: Sprite = {
    id: createModelId("sprite"), name: o.name, width: w, height: h, colorMode: "rgba", transparentIndex: 0, pixelRatio: { w: 1, h: 1 },
    grid: { x: 0, y: 0, width: w, height: h, visible: false },
    palettes: [{ id: createModelId("pal"), name: "Palette", fromFrame: 0, toFrame: 9999, colors: [{ r: 0, g: 0, b: 0, a: 0 }] }],
    layers: [], frames: [], cels: [], tags: [], slices: [], tilesets: [], mask: new Mask(w, h), userData: { text: "" },
  };
  const addLayer = (name: string): Layer => {
    const l: Layer = { id: createModelId("layer"), kind: "image", name, parentId: null, visible: true, editable: true, lockMove: false, background: false, preferLinkedCels: false, collapsed: false, reference: false, blendMode: "normal", opacity: 255, userData: { text: "" } };
    sprite.layers.push(l);
    return l;
  };
  const addFrame = (): number => { const i = sprite.frames.length; sprite.frames.push({ id: createModelId("frame"), index: i, durationMs: 100 }); return i; };
  if (o.mode === "frames") {
    const layer = addLayer("Layer 1");
    cells.forEach((c) => {
      const f = addFrame();
      sprite.cels.push({ id: createModelId("cel"), layerId: layer.id, frameIndex: f, x: 0, y: 0, opacity: 255, zIndex: 0, image: mk(c), userData: { text: "" } });
    });
  } else {
    addFrame();
    cells.forEach((c, i) => {
      const layer = addLayer(`Tile ${i + 1}`);
      sprite.cels.push({ id: createModelId("cel"), layerId: layer.id, frameIndex: 0, x: 0, y: 0, opacity: 255, zIndex: 0, image: mk(c), userData: { text: "" } });
    });
  }
  return sprite;
}
