/**
 * @module @kekenik/core/model
 * Framework-independent pixel-art document model matching Aseprite 1.3 capabilities.
 * Pixel data lives strictly in Uint8Array buffers.
 */

import { clamp, hslToRgba, intersectRect, Point, Rect, RGBA, rgbToHsl } from "../util/index.ts";

export type ColorMode = "rgba" | "grayscale" | "indexed";

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hsl-hue"
  | "hsl-saturation"
  | "hsl-color"
  | "hsl-luminosity"
  | "addition"
  | "subtract"
  | "divide";

export const ALL_BLEND_MODES: readonly BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hsl-hue",
  "hsl-saturation",
  "hsl-color",
  "hsl-luminosity",
  "addition",
  "subtract",
  "divide",
];

export interface UserData {
  text: string;
  color?: string;
}

/**
 * Returns bytes per pixel for a given ColorMode.
 * RGBA = 4 B/px, Grayscale = 2 B/px (value + alpha), Indexed = 1 B/px (palette index).
 */
export function bytesPerPixel(mode: ColorMode): number {
  switch (mode) {
    case "rgba":
      return 4;
    case "grayscale":
      return 2;
    case "indexed":
      return 1;
  }
}

/**
 * Blends a source RGBA pixel onto a backdrop RGBA pixel using any of the 18 Aseprite blend modes.
 */
export function blendRGBA(
  backdrop: RGBA,
  source: RGBA,
  mode: BlendMode = "normal",
  layerOpacity = 255
): RGBA {
  const sa = (clamp(source.a, 0, 255) / 255) * (clamp(layerOpacity, 0, 255) / 255);
  if (sa <= 0) return backdrop;
  const ba = clamp(backdrop.a, 0, 255) / 255;
  if (ba <= 0) {
    return {
      r: source.r,
      g: source.g,
      b: source.b,
      a: Math.round(sa * 255),
    };
  }

  const br = backdrop.r / 255;
  const bg = backdrop.g / 255;
  const bb = backdrop.b / 255;
  const sr = source.r / 255;
  const sg = source.g / 255;
  const sb = source.b / 255;

  const chBlend = (b: number, s: number): number => {
    switch (mode) {
      case "normal":
        return s;
      case "multiply":
        return b * s;
      case "screen":
        return 1 - (1 - b) * (1 - s);
      case "overlay":
        return b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
      case "darken":
        return Math.min(b, s);
      case "lighten":
        return Math.max(b, s);
      case "color-dodge":
        return s >= 1 ? 1 : Math.min(1, b / (1 - s));
      case "color-burn":
        return s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s);
      case "hard-light":
        return s < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
      case "soft-light": {
        const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
        return s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (d - b);
      }
      case "difference":
        return Math.abs(b - s);
      case "exclusion":
        return b + s - 2 * b * s;
      case "addition":
        return Math.min(1, b + s);
      case "subtract":
        return Math.max(0, b - s);
      case "divide":
        return s <= 0 ? 1 : Math.min(1, b / s);
      default:
        return s;
    }
  };

  let cr = 0;
  let cg = 0;
  let cb = 0;

  if (
    mode === "hsl-hue" ||
    mode === "hsl-saturation" ||
    mode === "hsl-color" ||
    mode === "hsl-luminosity"
  ) {
    const bHsl = rgbToHsl(backdrop.r, backdrop.g, backdrop.b);
    const sHsl = rgbToHsl(source.r, source.g, source.b);
    let h = bHsl.h;
    let s = bHsl.s;
    let l = bHsl.l;
    if (mode === "hsl-hue") {
      h = sHsl.h;
    } else if (mode === "hsl-saturation") {
      s = sHsl.s;
    } else if (mode === "hsl-color") {
      h = sHsl.h;
      s = sHsl.s;
    } else if (mode === "hsl-luminosity") {
      l = sHsl.l;
    }
    const mixed = hslToRgba(h, s, l, 255);
    cr = mixed.r / 255;
    cg = mixed.g / 255;
    cb = mixed.b / 255;
  } else {
    cr = chBlend(br, sr);
    cg = chBlend(bg, sg);
    cb = chBlend(bb, sb);
  }

  const outA = sa + ba * (1 - sa);
  if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };

  const mixChannel = (b: number, c: number): number =>
    ((1 - sa) * ba * b + (1 - ba) * sa * (c === cr ? sr : c === cg ? sg : sb) + ba * sa * c) /
    outA;

  return {
    r: clamp(Math.round(mixChannel(br, cr) * 255), 0, 255),
    g: clamp(Math.round(mixChannel(bg, cg) * 255), 0, 255),
    b: clamp(Math.round(mixChannel(bb, cb) * 255), 0, 255),
    a: clamp(Math.round(outA * 255), 0, 255),
  };
}

export interface ImagePatch {
  readonly rect: Rect;
  readonly colorMode: ColorMode;
  readonly data: Uint8Array;
}

/**
 * Backing pixel buffer supporting RGBA (4 B/px), Grayscale (2 B/px), and Indexed (1 B/px).
 */
export class PixelImage {
  public readonly width: number;
  public readonly height: number;
  public readonly colorMode: ColorMode;
  public readonly data: Uint8Array;

  public constructor(width: number, height: number, colorMode: ColorMode = "rgba", data?: Uint8Array) {
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid PixelImage dimensions: ${width}x${height}`);
    }
    this.width = Math.floor(width);
    this.height = Math.floor(height);
    this.colorMode = colorMode;
    const expectedLength = this.width * this.height * bytesPerPixel(colorMode);
    if (data) {
      if (data.length !== expectedLength) {
        throw new Error(`Data buffer length ${data.length} does not match expected ${expectedLength}`);
      }
      this.data = data;
    } else {
      this.data = new Uint8Array(expectedLength);
    }
  }

  /**
   * Returns a deep copy of this PixelImage.
   */
  public clone(): PixelImage {
    return new PixelImage(this.width, this.height, this.colorMode, new Uint8Array(this.data));
  }

  /**
   * Returns raw packed integer pixel value at (x, y).
   * - RGBA: 0xAABBGGRR unsigned 32-bit int
   * - Grayscale: 0xAAVV unsigned 16-bit int
   * - Indexed: 0xII unsigned 8-bit int
   */
  public getPixel(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const bpp = bytesPerPixel(this.colorMode);
    const idx = (y * this.width + x) * bpp;
    if (this.colorMode === "rgba") {
      return (
        (this.data[idx] |
          (this.data[idx + 1] << 8) |
          (this.data[idx + 2] << 16) |
          (this.data[idx + 3] << 24)) >>>
        0
      );
    }
    if (this.colorMode === "grayscale") {
      return this.data[idx] | (this.data[idx + 1] << 8);
    }
    return this.data[idx];
  }

  /**
   * Writes raw packed integer pixel value at (x, y).
   */
  public putPixel(x: number, y: number, value: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const bpp = bytesPerPixel(this.colorMode);
    const idx = (y * this.width + x) * bpp;
    if (this.colorMode === "rgba") {
      this.data[idx] = value & 0xff;
      this.data[idx + 1] = (value >>> 8) & 0xff;
      this.data[idx + 2] = (value >>> 16) & 0xff;
      this.data[idx + 3] = (value >>> 24) & 0xff;
    } else if (this.colorMode === "grayscale") {
      this.data[idx] = value & 0xff;
      this.data[idx + 1] = (value >>> 8) & 0xff;
    } else {
      this.data[idx] = value & 0xff;
    }
  }

  /**
   * Reads an RGBA color at (x, y), resolving palette if in Indexed mode.
   */
  public getRGBA(
    x: number,
    y: number,
    palette?: readonly RGBA[],
    transparentIndex = 0
  ): RGBA {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const bpp = bytesPerPixel(this.colorMode);
    const idx = (y * this.width + x) * bpp;
    if (this.colorMode === "rgba") {
      return {
        r: this.data[idx],
        g: this.data[idx + 1],
        b: this.data[idx + 2],
        a: this.data[idx + 3],
      };
    }
    if (this.colorMode === "grayscale") {
      const v = this.data[idx];
      const a = this.data[idx + 1];
      return { r: v, g: v, b: v, a };
    }
    const palIndex = this.data[idx];
    if (palIndex === transparentIndex) {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    if (palette && palette[palIndex]) {
      return palette[palIndex];
    }
    return { r: palIndex, g: palIndex, b: palIndex, a: 255 };
  }

  /**
   * Sets an RGBA color at (x, y), converting to grayscale or nearest palette index when needed.
   */
  public setRGBA(
    x: number,
    y: number,
    color: RGBA,
    palette?: readonly RGBA[],
    transparentIndex = 0
  ): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const bpp = bytesPerPixel(this.colorMode);
    const idx = (y * this.width + x) * bpp;
    if (this.colorMode === "rgba") {
      this.data[idx] = color.r;
      this.data[idx + 1] = color.g;
      this.data[idx + 2] = color.b;
      this.data[idx + 3] = color.a;
    } else if (this.colorMode === "grayscale") {
      const lum = Math.round(0.299 * color.r + 0.587 * color.g + 0.114 * color.b);
      this.data[idx] = clamp(lum, 0, 255);
      this.data[idx + 1] = clamp(color.a, 0, 255);
    } else {
      if (color.a === 0) {
        this.data[idx] = transparentIndex;
        return;
      }
      if (palette && palette.length > 0) {
        let bestIdx = 0;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < palette.length; i++) {
          if (i === transparentIndex) continue;
          const p = palette[i];
          const dr = p.r - color.r;
          const dg = p.g - color.g;
          const db = p.b - color.b;
          const dist = dr * dr + dg * dg + db * db;
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        this.data[idx] = bestIdx;
      } else {
        this.data[idx] = color.r;
      }
    }
  }

  /**
   * Fills the entire image with a packed pixel value (defaults to 0).
   */
  public clear(packedValue = 0): void {
    if (packedValue === 0) {
      this.data.fill(0);
      return;
    }
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.putPixel(x, y, packedValue);
      }
    }
  }

  /**
   * Returns a new cropped PixelImage for the requested rectangle.
   */
  public crop(rect: Rect): PixelImage {
    const out = new PixelImage(rect.width, rect.height, this.colorMode);
    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        const sx = rect.x + x;
        const sy = rect.y + y;
        if (sx >= 0 && sy >= 0 && sx < this.width && sy < this.height) {
          out.putPixel(x, y, this.getPixel(sx, sy));
        }
      }
    }
    return out;
  }

  /**
   * Extracts a rectangular region patch for compact undo/redo storage.
   */
  public extractPatch(rect: Rect): ImagePatch {
    const clamped = intersectRect(rect, {
      x: 0,
      y: 0,
      width: this.width,
      height: this.height,
    }) ?? { x: 0, y: 0, width: 1, height: 1 };
    const bpp = bytesPerPixel(this.colorMode);
    const patchData = new Uint8Array(clamped.width * clamped.height * bpp);
    for (let row = 0; row < clamped.height; row++) {
      const srcStart = ((clamped.y + row) * this.width + clamped.x) * bpp;
      const srcEnd = srcStart + clamped.width * bpp;
      const dstStart = row * clamped.width * bpp;
      patchData.set(this.data.subarray(srcStart, srcEnd), dstStart);
    }
    return {
      rect: clamped,
      colorMode: this.colorMode,
      data: patchData,
    };
  }

  /**
   * Applies a previously extracted rectangular region patch in-place.
   */
  public applyPatch(patch: ImagePatch): void {
    if (patch.colorMode !== this.colorMode) {
      throw new Error(`Patch colorMode ${patch.colorMode} != image colorMode ${this.colorMode}`);
    }
    const bpp = bytesPerPixel(this.colorMode);
    const { rect, data } = patch;
    for (let row = 0; row < rect.height; row++) {
      const dstY = rect.y + row;
      if (dstY < 0 || dstY >= this.height) continue;
      const srcStart = row * rect.width * bpp;
      const srcEnd = srcStart + rect.width * bpp;
      const dstStart = (dstY * this.width + rect.x) * bpp;
      this.data.set(data.subarray(srcStart, srcEnd), dstStart);
    }
  }

  /**
   * Blits `source` onto `this` image at (dstX, dstY) using the given BlendMode and opacity.
   */
  public blit(
    source: PixelImage,
    dstX = 0,
    dstY = 0,
    mode: BlendMode = "normal",
    opacity = 255,
    palette?: readonly RGBA[],
    transparentIndex = 0
  ): void {
    for (let sy = 0; sy < source.height; sy++) {
      const dy = dstY + sy;
      if (dy < 0 || dy >= this.height) continue;
      for (let sx = 0; sx < source.width; sx++) {
        const dx = dstX + sx;
        if (dx < 0 || dx >= this.width) continue;
        const srcRgba = source.getRGBA(sx, sy, palette, transparentIndex);
        if (srcRgba.a === 0) continue;
        const dstRgba = this.getRGBA(dx, dy, palette, transparentIndex);
        const blended = blendRGBA(dstRgba, srcRgba, mode, opacity);
        this.setRGBA(dx, dy, blended, palette, transparentIndex);
      }
    }
  }
}

/**
 * 1-bit selection mask with automatic bounding rectangle calculation.
 */
export class Mask {
  public readonly width: number;
  public readonly height: number;
  public readonly bits: Uint8Array;
  private _bounds: Rect | null = null;

  public constructor(width: number, height: number, bits?: Uint8Array) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    const byteLen = Math.ceil((this.width * this.height) / 8);
    this.bits = bits ? new Uint8Array(bits) : new Uint8Array(byteLen);
    this.recalcBounds();
  }

  /**
   * Returns current selection bounds or null when empty.
   */
  public get bounds(): Rect | null {
    return this._bounds;
  }

  /**
   * Returns true if no pixels are selected.
   */
  public get isEmpty(): boolean {
    return this._bounds === null;
  }

  /**
   * Clones the selection mask.
   */
  public clone(): Mask {
    return new Mask(this.width, this.height, this.bits);
  }

  /**
   * Reads selection bit at (x, y).
   */
  public getBit(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    const bitIdx = y * this.width + x;
    return (this.bits[bitIdx >> 3] & (1 << (bitIdx & 7))) !== 0;
  }

  /**
   * Sets selection bit at (x, y).
   */
  public setBit(x: number, y: number, selected: boolean): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const bitIdx = y * this.width + x;
    if (selected) {
      this.bits[bitIdx >> 3] |= 1 << (bitIdx & 7);
    } else {
      this.bits[bitIdx >> 3] &= ~(1 << (bitIdx & 7));
    }
  }

  /**
   * Selects a rectangular region.
   */
  public selectRect(rect: Rect, additive = false): void {
    if (!additive) {
      this.bits.fill(0);
    }
    const x0 = clamp(rect.x, 0, this.width);
    const y0 = clamp(rect.y, 0, this.height);
    const x1 = clamp(rect.x + rect.width, 0, this.width);
    const y1 = clamp(rect.y + rect.height, 0, this.height);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        this.setBit(x, y, true);
      }
    }
    this.recalcBounds();
  }

  /**
   * Selects all pixels in the mask.
   */
  public selectAll(): void {
    this.selectRect({ x: 0, y: 0, width: this.width, height: this.height });
  }

  /**
   * Clears all selected bits.
   */
  public clear(): void {
    this.bits.fill(0);
    this._bounds = null;
  }

  /**
   * Inverts all bits in the mask.
   */
  public invert(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.setBit(x, y, !this.getBit(x, y));
      }
    }
    this.recalcBounds();
  }

  /**
   * Recomputes the bounding rectangle of selected bits.
   */
  public recalcBounds(): Rect | null {
    let minX = this.width;
    let minY = this.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.getBit(x, y)) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) {
      this._bounds = null;
    } else {
      this._bounds = {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      };
    }
    return this._bounds;
  }
}

export interface PaletteSpan {
  id: string;
  name: string;
  fromFrame: number;
  toFrame: number;
  colors: RGBA[];
  entryNames?: Record<number, string>;
}

/**
 * Default 32-color pixel art palette (original Kekenik-32 palette inspired by classic 16/32-bit palettes).
 */
export const DEFAULT_PALETTE_COLORS: readonly RGBA[] = [
  { r: 0, g: 0, b: 0, a: 255 },
  { r: 34, g: 32, b: 52, a: 255 },
  { r: 69, g: 40, b: 60, a: 255 },
  { r: 102, g: 57, b: 49, a: 255 },
  { r: 143, g: 86, b: 59, a: 255 },
  { r: 223, g: 113, b: 38, a: 255 },
  { r: 217, g: 160, b: 102, a: 255 },
  { r: 238, g: 195, b: 154, a: 255 },
  { r: 251, g: 242, b: 54, a: 255 },
  { r: 153, g: 229, b: 80, a: 255 },
  { r: 106, g: 190, b: 48, a: 255 },
  { r: 55, g: 148, b: 110, a: 255 },
  { r: 75, g: 105, b: 47, a: 255 },
  { r: 82, g: 75, b: 36, a: 255 },
  { r: 50, g: 60, b: 57, a: 255 },
  { r: 63, g: 63, b: 116, a: 255 },
  { r: 48, g: 96, b: 130, a: 255 },
  { r: 91, g: 110, b: 225, a: 255 },
  { r: 99, g: 155, b: 255, a: 255 },
  { r: 95, g: 205, b: 228, a: 255 },
  { r: 203, g: 219, b: 252, a: 255 },
  { r: 255, g: 255, b: 255, a: 255 },
  { r: 155, g: 173, b: 183, a: 255 },
  { r: 132, g: 126, b: 135, a: 255 },
  { r: 105, g: 106, b: 106, a: 255 },
  { r: 89, g: 86, b: 82, a: 255 },
  { r: 118, g: 66, b: 138, a: 255 },
  { r: 172, g: 50, b: 50, a: 255 },
  { r: 217, g: 87, b: 99, a: 255 },
  { r: 215, g: 123, b: 186, a: 255 },
  { r: 143, g: 151, b: 74, a: 255 },
  { r: 138, g: 111, b: 48, a: 255 },
];

export interface BaseLayer {
  id: string;
  name: string;
  parentId: string | null;
  visible: boolean;
  editable: boolean;
  lockMove: boolean;
  background: boolean;
  preferLinkedCels: boolean;
  collapsed: boolean;
  reference: boolean;
  blendMode: BlendMode;
  opacity: number; // 0..255
  userData: UserData;
}

export interface ImageLayer extends BaseLayer {
  kind: "image";
}

export interface GroupLayer extends BaseLayer {
  kind: "group";
  children: string[];
}

export interface TilemapLayer extends BaseLayer {
  kind: "tilemap";
  tilesetId: string;
}

export type Layer = ImageLayer | GroupLayer | TilemapLayer;

export const TILE_FLIP_X_FLAG = 0x80000000;
export const TILE_FLIP_Y_FLAG = 0x40000000;
export const TILE_ROTATE_90_FLAG = 0x20000000;
export const TILE_INDEX_MASK = 0x1fffffff;

export interface TilemapCelData {
  width: number;
  height: number;
  tiles: Uint32Array;
}

export interface Cel {
  id: string;
  layerId: string;
  frameIndex: number;
  x: number;
  y: number;
  opacity: number; // 0..255
  zIndex: number;
  linkId?: string;
  image: PixelImage;
  tilemapData?: TilemapCelData;
  userData: UserData;
}

export interface Frame {
  id: string;
  index: number;
  durationMs: number;
}

export type TagDirection = "forward" | "reverse" | "pingpong" | "pingpong-reverse";

export interface Tag {
  id: string;
  name: string;
  fromFrame: number;
  toFrame: number;
  direction: TagDirection;
  color: string;
  repeat: number; // 0 = infinite
  userData: UserData;
}

export interface SliceKey {
  frameIndex: number;
  bounds: Rect;
  center?: Rect;
  pivot?: Point;
}

export interface Slice {
  id: string;
  name: string;
  color: string;
  keys: SliceKey[];
  userData: UserData;
}

export interface Tileset {
  id: string;
  name: string;
  tileWidth: number;
  tileHeight: number;
  gridOriginX: number;
  gridOriginY: number;
  baseIndex: number;
  columns?: number;
  tiles: PixelImage[];
  userData: UserData;
}

export interface GridSettings {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface SavedMaskEntry {
  id: string;
  name: string;
  width: number;
  height: number;
  bitsBase64: string;
}

export interface Sprite {
  id: string;
  name: string;
  width: number;
  height: number;
  colorMode: ColorMode;
  transparentIndex: number;
  pixelRatio: { w: number; h: number };
  grid: GridSettings;
  palettes: PaletteSpan[];
  layers: Layer[];
  frames: Frame[];
  cels: Cel[];
  tags: Tag[];
  slices: Slice[];
  tilesets: Tileset[];
  mask: Mask;
  savedMasks?: SavedMaskEntry[];
  userData: UserData;
  /**
   * Chunks of an imported `.aseprite` file that Kekenik Pixel does not model (color profile, external files,
   * cel extras, unknown future chunks). They are written back verbatim so round-trips are lossless.
   */
  preservedChunks?: PreservedChunk[];
}

/** A raw `.aseprite` chunk kept for lossless round-trip. */
export interface PreservedChunk {
  frameIndex: number;
  type: number;
  data: Uint8Array;
  /** For cel-extra chunks (0x2006): file layer index of the cel it follows. */
  celLayerIndex?: number;
}

export type ReadonlySprite = Readonly<Sprite>;

export interface CreateSpriteOptions {
  name?: string;
  width?: number;
  height?: number;
  colorMode?: ColorMode;
  background?: "transparent" | "white" | "black";
  pixelRatio?: { w: number; h: number };
}

let idCounter = 1;

/**
 * Generates a deterministic-friendly unique ID for model entities.
 */
export function createModelId(prefix = "id"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/**
 * Creates a new Sprite instance with initial layer, frame, cel, and palette.
 */
export function createSprite(options: CreateSpriteOptions = {}): Sprite {
  const width = clamp(Math.floor(options.width ?? 64), 1, 16384);
  const height = clamp(Math.floor(options.height ?? 64), 1, 16384);
  const colorMode = options.colorMode ?? "rgba";
  const background = options.background ?? "transparent";

  const layerId = createModelId("layer");
  const frameId = createModelId("frame");
  const celId = createModelId("cel");

  const initialLayer: ImageLayer = {
    id: layerId,
    kind: "image",
    name: background === "transparent" ? "Layer 1" : "Background",
    parentId: null,
    visible: true,
    editable: true,
    lockMove: background !== "transparent",
    background: background !== "transparent",
    preferLinkedCels: false,
    collapsed: false,
    reference: false,
    blendMode: "normal",
    opacity: 255,
    userData: { text: "" },
  };

  const img = new PixelImage(width, height, colorMode);
  const paletteColors = DEFAULT_PALETTE_COLORS.map((c) => ({ ...c }));

  if (background === "white" || background === "black") {
    const fillRgba: RGBA =
      background === "white"
        ? { r: 255, g: 255, b: 255, a: 255 }
        : { r: 0, g: 0, b: 0, a: 255 };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        img.setRGBA(x, y, fillRgba, paletteColors, 0);
      }
    }
  }

  const initialCel: Cel = {
    id: celId,
    layerId,
    frameIndex: 0,
    x: 0,
    y: 0,
    opacity: 255,
    zIndex: 0,
    image: img,
    userData: { text: "" },
  };

  return {
    id: createModelId("sprite"),
    name: options.name ?? "Sprite-0001",
    width,
    height,
    colorMode,
    transparentIndex: 0,
    pixelRatio: options.pixelRatio ?? { w: 1, h: 1 },
    grid: { x: 0, y: 0, width: 16, height: 16, visible: false },
    palettes: [
      {
        id: createModelId("pal"),
        name: "Default Palette",
        fromFrame: 0,
        toFrame: 9999,
        colors: paletteColors,
      },
    ],
    layers: [initialLayer],
    frames: [{ id: frameId, index: 0, durationMs: 100 }],
    cels: [initialCel],
    tags: [],
    slices: [],
    tilesets: [],
    mask: new Mask(width, height),
    userData: { text: "" },
  };
}

/**
 * Resolves the active palette for a given frame index.
 */
export function getPaletteForFrame(sprite: ReadonlySprite, frameIndex: number): RGBA[] {
  for (const span of sprite.palettes) {
    if (frameIndex >= span.fromFrame && frameIndex <= span.toFrame) {
      return span.colors;
    }
  }
  return sprite.palettes[0]?.colors ?? [...DEFAULT_PALETTE_COLORS];
}

/**
 * Finds the cel at (layerId, frameIndex), resolving linked cels if present.
 */
export function getCel(
  sprite: ReadonlySprite,
  layerId: string,
  frameIndex: number
): Cel | undefined {
  return sprite.cels.find((c) => c.layerId === layerId && c.frameIndex === frameIndex);
}

/**
 * Checks whether a layer is effectively visible (including ancestor group layers).
 */
export function isLayerEffectivelyVisible(sprite: ReadonlySprite, layer: Layer): boolean {
  let curr: Layer | undefined = layer;
  while (curr) {
    if (!curr.visible) return false;
    if (!curr.parentId) break;
    curr = sprite.layers.find((l) => l.id === curr?.parentId);
  }
  return true;
}

/**
 * Composites all visible layers at `frameIndex` into an RGBA PixelImage.
 */
export function compositeFrame(sprite: ReadonlySprite, frameIndex: number): PixelImage {
  const out = new PixelImage(sprite.width, sprite.height, "rgba");
  const palette = getPaletteForFrame(sprite, frameIndex);

  const celsForFrame = sprite.cels
    .filter((c) => c.frameIndex === frameIndex)
    .map((cel) => {
      const layerOrder = sprite.layers.findIndex((l) => l.id === cel.layerId);
      const layer = sprite.layers[layerOrder];
      return { cel, layer, layerOrder };
    })
    .filter((item) => item.layer && item.layer.kind !== "group" && isLayerEffectivelyVisible(sprite, item.layer))
    .sort((a, b) => {
      if (a.cel.zIndex !== b.cel.zIndex) return a.cel.zIndex - b.cel.zIndex;
      return a.layerOrder - b.layerOrder;
    });

  for (const { cel, layer } of celsForFrame) {
    if (!layer) continue;
    const effectiveOpacity = Math.round((layer.opacity * cel.opacity) / 255);
    out.blit(
      cel.image,
      cel.x,
      cel.y,
      layer.blendMode,
      effectiveOpacity,
      palette,
      sprite.transparentIndex
    );
  }

  return out;
}

/**
 * Encodes a Uint8Array to a base64 string without DOM dependencies.
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a base64 string into a Uint8Array without DOM dependencies.
 */
export function base64ToUint8(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export interface KpxSnapshot {
  format: "kpx-snapshot";
  version: 1;
  savedAt: string;
  sprite: {
    id: string;
    name: string;
    width: number;
    height: number;
    colorMode: ColorMode;
    transparentIndex: number;
    pixelRatio: { w: number; h: number };
    grid: GridSettings;
    palettes: PaletteSpan[];
    layers: Layer[];
    frames: Frame[];
    cels: Array<{
      id: string;
      layerId: string;
      frameIndex: number;
      x: number;
      y: number;
      opacity: number;
      zIndex: number;
      linkId?: string;
      imageWidth: number;
      imageHeight: number;
      imageColorMode: ColorMode;
      imageBase64: string;
      tilemapData?: {
        width: number;
        height: number;
        tiles: number[];
      };
      userData: UserData;
    }>;
    tags: Tag[];
    slices: Slice[];
    tilesets?: Array<{
      id: string;
      name: string;
      tileWidth: number;
      tileHeight: number;
      gridOriginX: number;
      gridOriginY: number;
      baseIndex: number;
      columns?: number;
      tiles: Array<{
        width: number;
        height: number;
        colorMode: ColorMode;
        base64: string;
      }>;
      userData: UserData;
    }>;
    maskBase64: string;
    savedMasks?: SavedMaskEntry[];
    userData: UserData;
  };
}

/**
 * Serializes a Sprite to a versioned `.kpx-snapshot` JSON string for crash recovery and autosave.
 */
export function serializeSnapshot(sprite: ReadonlySprite): string {
  const snapshot: KpxSnapshot = {
    format: "kpx-snapshot",
    version: 1,
    savedAt: new Date().toISOString(),
    sprite: {
      id: sprite.id,
      name: sprite.name,
      width: sprite.width,
      height: sprite.height,
      colorMode: sprite.colorMode,
      transparentIndex: sprite.transparentIndex,
      pixelRatio: { ...sprite.pixelRatio },
      grid: { ...sprite.grid },
      palettes: sprite.palettes.map((p) => ({
        ...p,
        colors: p.colors.map((c) => ({ ...c })),
      })),
      layers: sprite.layers.map((l) => ({ ...l, userData: { ...l.userData } })),
      frames: sprite.frames.map((f) => ({ ...f })),
      cels: sprite.cels.map((c) => ({
        id: c.id,
        layerId: c.layerId,
        frameIndex: c.frameIndex,
        x: c.x,
        y: c.y,
        opacity: c.opacity,
        zIndex: c.zIndex,
        linkId: c.linkId,
        imageWidth: c.image.width,
        imageHeight: c.image.height,
        imageColorMode: c.image.colorMode,
        imageBase64: uint8ToBase64(c.image.data),
        tilemapData: c.tilemapData
          ? {
              width: c.tilemapData.width,
              height: c.tilemapData.height,
              tiles: Array.from(c.tilemapData.tiles),
            }
          : undefined,
        userData: { ...c.userData },
      })),
      tags: sprite.tags.map((t) => ({ ...t, userData: { ...t.userData } })),
      slices: sprite.slices.map((s) => ({
        ...s,
        keys: s.keys.map((k) => ({ ...k, bounds: { ...k.bounds } })),
        userData: { ...s.userData },
      })),
      tilesets: sprite.tilesets.map((ts) => ({
        id: ts.id,
        name: ts.name,
        tileWidth: ts.tileWidth,
        tileHeight: ts.tileHeight,
        gridOriginX: ts.gridOriginX,
        gridOriginY: ts.gridOriginY,
        baseIndex: ts.baseIndex,
        columns: ts.columns,
        tiles: ts.tiles.map((tImg) => ({
          width: tImg.width,
          height: tImg.height,
          colorMode: tImg.colorMode,
          base64: uint8ToBase64(tImg.data),
        })),
        userData: { ...ts.userData },
      })),
      maskBase64: uint8ToBase64(sprite.mask.bits),
      savedMasks: sprite.savedMasks?.map((sm) => ({ ...sm })),
      userData: { ...sprite.userData },
    },
  };
  return JSON.stringify(snapshot);
}

/**
 * Deserializes a `.kpx-snapshot` JSON string back into a live Sprite instance, preserving linked cel images.
 */
export function deserializeSnapshot(json: string): Sprite {
  const parsed = JSON.parse(json) as KpxSnapshot;
  if (parsed.format !== "kpx-snapshot" || parsed.version !== 1) {
    throw new Error("Unsupported .kpx-snapshot format or version");
  }
  const s = parsed.sprite;
  const linkedImages = new Map<string, PixelImage>();

  const cels: Cel[] = s.cels.map((c) => {
    let image: PixelImage;
    if (c.linkId && linkedImages.has(c.linkId)) {
      image = linkedImages.get(c.linkId)!;
    } else {
      image = new PixelImage(
        c.imageWidth,
        c.imageHeight,
        c.imageColorMode,
        base64ToUint8(c.imageBase64)
      );
      if (c.linkId) {
        linkedImages.set(c.linkId, image);
      }
    }
    return {
      id: c.id,
      layerId: c.layerId,
      frameIndex: c.frameIndex,
      x: c.x,
      y: c.y,
      opacity: c.opacity,
      zIndex: c.zIndex,
      linkId: c.linkId,
      image,
      tilemapData: c.tilemapData
        ? {
            width: c.tilemapData.width,
            height: c.tilemapData.height,
            tiles: new Uint32Array(c.tilemapData.tiles),
          }
        : undefined,
      userData: { ...c.userData },
    };
  });

  const tilesets: Tileset[] = (s.tilesets ?? []).map((ts) => ({
    id: ts.id,
    name: ts.name,
    tileWidth: ts.tileWidth,
    tileHeight: ts.tileHeight,
    gridOriginX: ts.gridOriginX,
    gridOriginY: ts.gridOriginY,
    baseIndex: ts.baseIndex,
    columns: ts.columns,
    tiles: ts.tiles.map(
      (tImg) =>
        new PixelImage(tImg.width, tImg.height, tImg.colorMode, base64ToUint8(tImg.base64))
    ),
    userData: { ...ts.userData },
  }));

  return {
    id: s.id,
    name: s.name,
    width: s.width,
    height: s.height,
    colorMode: s.colorMode,
    transparentIndex: s.transparentIndex,
    pixelRatio: { ...s.pixelRatio },
    grid: { ...s.grid },
    palettes: s.palettes,
    layers: s.layers,
    frames: s.frames,
    cels,
    tags: s.tags,
    slices: s.slices,
    tilesets,
    mask: new Mask(s.width, s.height, base64ToUint8(s.maskBase64)),
    savedMasks: s.savedMasks?.map((sm) => ({ ...sm })) ?? [],
    userData: { ...s.userData },
  };
}
