/**
 * @module @kekenik/core/commands/agent4-commands
 * Undoable Commands for Agent 4: Selection Masks, Floating Transform Commits, Palette Editing &
 * Indexed Remapping, Per-Frame Palette Spans, RGBA/Grayscale/Indexed Color Mode Conversion with Dithering,
 * Multi-Scope Filter Execution, Sprite Crop/Trim/Anchored Canvas Size, Orthogonal/RotSprite Canvas Rotation,
 * and Sprite Properties.
 */

import {
  Cel,
  ColorMode,
  createModelId,
  getCel,
  getPaletteForFrame,
  GridSettings,
  Mask,
  PaletteSpan,
  PixelImage,
  SavedMaskEntry,
  Slice,
  Sprite,
  UserData,
} from "../model/index.ts";
import {
  convertImageColorMode,
  IndexedDitherAlgorithm,
  remapIndexedImagePixels,
} from "../palette/index.ts";
import {
  flipMaskHorizontal,
  flipMaskVertical,
  rotateMaskOrthogonal,
} from "../selection/index.ts";
import {
  eagleScaleImage,
  flipImageHorizontal,
  flipImageVertical,
  rotateImageFast,
  rotateImageOrthogonal,
  rotSpriteRotate,
  scale2xImage,
  scaleImageBilinear,
  scaleImageNearest,
  shiftImageWrap,
} from "../transform/index.ts";
import { clamp, Rect, RGBA } from "../util/index.ts";
import { Command } from "./index.ts";

/**
 * 1. Saves or deletes a named selection mask inside `sprite.savedMasks`.
 */
export class ManageSavedMaskCommand implements Command {
  public readonly id = createModelId("cmd_saved_mask");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 256;

  private beforeMasks: SavedMaskEntry[] = [];
  private readonly afterUpdater: (prev: SavedMaskEntry[]) => SavedMaskEntry[];

  public constructor(label: string, updater: (prev: SavedMaskEntry[]) => SavedMaskEntry[]) {
    this.label = label;
    this.afterUpdater = updater;
  }

  public do(sprite: Sprite): void {
    this.beforeMasks = (sprite.savedMasks ?? []).map((m) => ({ ...m }));
    sprite.savedMasks = this.afterUpdater(this.beforeMasks);
  }

  public undo(sprite: Sprite): void {
    sprite.savedMasks = this.beforeMasks.map((m) => ({ ...m }));
  }
}

/**
 * 2. Commits a lifted/pasted/transformed floating selection image and updated mask in one atomic undoable command.
 */
export class CommitFloatingSelectionCommand implements Command {
  public readonly id = createModelId("cmd_commit_float");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize: number;

  private readonly layerId: string;
  private readonly frameIndex: number;
  private readonly beforeImage: PixelImage;
  private readonly afterImage: PixelImage;
  private readonly beforeMask: Mask;
  private readonly afterMask: Mask;

  public constructor(params: {
    label?: string;
    layerId: string;
    frameIndex: number;
    beforeImage: PixelImage;
    afterImage: PixelImage;
    beforeMask: Mask;
    afterMask: Mask;
  }) {
    this.label = params.label ?? "Transform / Commit Selection";
    this.layerId = params.layerId;
    this.frameIndex = params.frameIndex;
    this.beforeImage = params.beforeImage.clone();
    this.afterImage = params.afterImage.clone();
    this.beforeMask = params.beforeMask.clone();
    this.afterMask = params.afterMask.clone();
    this.byteSize =
      this.beforeImage.data.byteLength +
      this.afterImage.data.byteLength +
      this.beforeMask.bits.byteLength * 2;
  }

  public do(sprite: Sprite): void {
    const cel = getCel(sprite, this.layerId, this.frameIndex);
    if (cel) {
      cel.image = this.afterImage.clone();
    }
    sprite.mask = this.afterMask.clone();
  }

  public undo(sprite: Sprite): void {
    const cel = getCel(sprite, this.layerId, this.frameIndex);
    if (cel) {
      cel.image = this.beforeImage.clone();
    }
    sprite.mask = this.beforeMask.clone();
  }
}

/**
 * 3. Updates palette swatches, palette spans, and optionally remaps all Indexed cel pixels.
 */
export class UpdatePaletteAndRemapCommand implements Command {
  public readonly id = createModelId("cmd_pal_remap");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public byteSize = 1024;

  private beforePalettes: PaletteSpan[] = [];
  private readonly nextPalettes: PaletteSpan[];
  private readonly oldToNewIndexMap?: readonly number[];
  private readonly remapPixels: boolean;
  private beforeCelImages = new Map<string, PixelImage>();

  public constructor(params: {
    label?: string;
    nextPalettes: PaletteSpan[];
    oldToNewIndexMap?: readonly number[];
    remapPixels?: boolean;
  }) {
    this.label = params.label ?? "Edit Palette";
    this.nextPalettes = params.nextPalettes.map((p) => ({
      ...p,
      colors: p.colors.map((c) => ({ ...c })),
      entryNames: p.entryNames ? { ...p.entryNames } : undefined,
    }));
    this.oldToNewIndexMap = params.oldToNewIndexMap;
    this.remapPixels = Boolean(params.remapPixels && params.oldToNewIndexMap);
  }

  public do(sprite: Sprite): void {
    this.beforePalettes = sprite.palettes.map((p) => ({
      ...p,
      colors: p.colors.map((c) => ({ ...c })),
      entryNames: p.entryNames ? { ...p.entryNames } : undefined,
    }));

    sprite.palettes = this.nextPalettes.map((p) => ({
      ...p,
      colors: p.colors.map((c) => ({ ...c })),
      entryNames: p.entryNames ? { ...p.entryNames } : undefined,
    }));

    this.beforeCelImages.clear();
    if (this.remapPixels && this.oldToNewIndexMap && sprite.colorMode === "indexed") {
      const seenImages = new Set<PixelImage>();
      for (const cel of sprite.cels) {
        if (seenImages.has(cel.image)) continue;
        seenImages.add(cel.image);
        this.beforeCelImages.set(cel.id, cel.image.clone());
        const remapped = remapIndexedImagePixels(cel.image, this.oldToNewIndexMap);
        cel.image.data.set(remapped.data);
      }
    }
  }

  public undo(sprite: Sprite): void {
    sprite.palettes = this.beforePalettes.map((p) => ({
      ...p,
      colors: p.colors.map((c) => ({ ...c })),
      entryNames: p.entryNames ? { ...p.entryNames } : undefined,
    }));
    for (const cel of sprite.cels) {
      const prev = this.beforeCelImages.get(cel.id);
      if (prev) {
        cel.image.data.set(prev.data);
      }
    }
  }
}

/**
 * 4. Converts a Sprite between `rgba`, `grayscale`, and `indexed` color modes with dithering,
 * optional new palette replacement, and transparent index selection. Fully lossless on `undo()`.
 */
export class ConvertColorModeAdvancedCommand implements Command {
  public readonly id = createModelId("cmd_colormode_adv");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public byteSize = 4096;

  private readonly targetMode: ColorMode;
  private readonly dither: IndexedDitherAlgorithm;
  private readonly customPalette?: RGBA[];
  private readonly transparentIndex?: number;

  private beforeMode: ColorMode = "rgba";
  private beforeTransparentIndex = 0;
  private beforePalettes: PaletteSpan[] = [];
  private beforeCelImages = new Map<string, PixelImage>();

  public constructor(params: {
    targetMode: ColorMode;
    dither?: IndexedDitherAlgorithm;
    customPalette?: readonly RGBA[];
    transparentIndex?: number;
  }) {
    this.targetMode = params.targetMode;
    this.dither = params.dither ?? "none";
    this.customPalette = params.customPalette?.map((c) => ({ ...c }));
    this.transparentIndex = params.transparentIndex;
    this.label = `Convert to ${params.targetMode.toUpperCase()}${
      params.dither && params.dither !== "none" ? ` (${params.dither})` : ""
    }`;
  }

  public do(sprite: Sprite): void {
    this.beforeMode = sprite.colorMode;
    this.beforeTransparentIndex = sprite.transparentIndex;
    this.beforePalettes = sprite.palettes.map((p) => ({
      ...p,
      colors: p.colors.map((c) => ({ ...c })),
    }));
    this.beforeCelImages.clear();

    if (this.transparentIndex !== undefined) {
      sprite.transparentIndex = clamp(this.transparentIndex, 0, 255);
    }

    if (this.customPalette && this.customPalette.length > 0 && sprite.palettes.length > 0) {
      sprite.palettes[0] = {
        ...sprite.palettes[0],
        colors: this.customPalette.map((c) => ({ ...c })),
      };
    }

    const linkMap = new Map<string, PixelImage>();
    let bytes = 512;

    for (const cel of sprite.cels) {
      this.beforeCelImages.set(cel.id, cel.image.clone());
      bytes += cel.image.data.byteLength;

      if (cel.linkId && linkMap.has(cel.linkId)) {
        cel.image = linkMap.get(cel.linkId)!;
        continue;
      }

      const pal = getPaletteForFrame(sprite, cel.frameIndex);
      const converted = convertImageColorMode(
        cel.image,
        this.targetMode,
        pal,
        sprite.transparentIndex,
        this.dither
      );
      cel.image = converted;
      if (cel.linkId) {
        linkMap.set(cel.linkId, converted);
      }
    }

    sprite.colorMode = this.targetMode;
    this.byteSize = bytes;
  }

  public undo(sprite: Sprite): void {
    sprite.colorMode = this.beforeMode;
    sprite.transparentIndex = this.beforeTransparentIndex;
    sprite.palettes = this.beforePalettes.map((p) => ({
      ...p,
      colors: p.colors.map((c) => ({ ...c })),
    }));

    const linkMap = new Map<string, PixelImage>();
    for (const cel of sprite.cels) {
      const prev = this.beforeCelImages.get(cel.id);
      if (!prev) continue;
      if (cel.linkId && linkMap.has(cel.linkId)) {
        cel.image = linkMap.get(cel.linkId)!;
      } else {
        const cloned = prev.clone();
        cel.image = cloned;
        if (cel.linkId) linkMap.set(cel.linkId, cloned);
      }
    }
  }
}

/**
 * 5. Applies an image transformation or filter function across one or multiple target cels
 * (`active_cel`, `active_layer`, `selected_cels`, or `all_frames`).
 */
export class ApplyFilterToCelsCommand implements Command {
  public readonly id = createModelId("cmd_filter_cels");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public byteSize = 2048;

  private readonly targetCelIds: readonly string[];
  private readonly transformFn: (img: PixelImage, cel: Cel, sprite: Sprite) => PixelImage;
  private beforeImages = new Map<string, PixelImage>();

  public constructor(
    label: string,
    targetCelIds: readonly string[],
    transformFn: (img: PixelImage, cel: Cel, sprite: Sprite) => PixelImage
  ) {
    this.label = label;
    this.targetCelIds = targetCelIds;
    this.transformFn = transformFn;
  }

  public do(sprite: Sprite): void {
    this.beforeImages.clear();
    const targetSet = new Set(this.targetCelIds);
    const processedLinks = new Set<string>();
    let totalBytes = 0;

    for (const cel of sprite.cels) {
      if (!targetSet.has(cel.id)) continue;
      if (cel.linkId && processedLinks.has(cel.linkId)) continue;
      if (cel.linkId) processedLinks.add(cel.linkId);

      this.beforeImages.set(cel.id, cel.image.clone());
      const nextImg = this.transformFn(cel.image, cel, sprite);
      cel.image.data.set(nextImg.data);
      totalBytes += cel.image.data.byteLength * 2;
    }
    this.byteSize = Math.max(256, totalBytes);
  }

  public undo(sprite: Sprite): void {
    for (const cel of sprite.cels) {
      const prev = this.beforeImages.get(cel.id);
      if (prev) {
        cel.image.data.set(prev.data);
      }
    }
  }
}

/**
 * 6. Rotates, flips, scales, or shifts either the active cel/selection OR the entire Sprite canvas.
 */
export class TransformSpriteOrCelCommand implements Command {
  public readonly id = createModelId("cmd_transform_op");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public byteSize = 4096;

  private readonly scope: "cel" | "sprite";
  private readonly layerId: string;
  private readonly frameIndex: number;
  private readonly op:
    | { kind: "flip_h" }
    | { kind: "flip_v" }
    | { kind: "rotate_ortho"; dir: "90cw" | "90ccw" | "180" }
    | { kind: "rotate_angle"; angleDeg: number; algorithm: "fast" | "rotsprite" }
    | {
        kind: "scale";
        width: number;
        height: number;
        algorithm: "nearest" | "rotsprite" | "bilinear" | "scale2x" | "eagle";
      }
    | { kind: "shift"; dx: number; dy: number };

  private beforeWidth = 0;
  private beforeHeight = 0;
  private beforeMask!: Mask;
  private beforeCels = new Map<string, { x: number; y: number; image: PixelImage }>();

  public constructor(params: {
    label: string;
    scope: "cel" | "sprite";
    layerId: string;
    frameIndex: number;
    op: TransformSpriteOrCelCommand["op"];
  }) {
    this.label = params.label;
    this.scope = params.scope;
    this.layerId = params.layerId;
    this.frameIndex = params.frameIndex;
    this.op = params.op;
  }

  private applyOpToImage(img: PixelImage, sprite: Sprite, frameIdx: number): PixelImage {
    const pal = getPaletteForFrame(sprite, frameIdx);
    switch (this.op.kind) {
      case "flip_h":
        return flipImageHorizontal(img);
      case "flip_v":
        return flipImageVertical(img);
      case "rotate_ortho":
        return rotateImageOrthogonal(img, this.op.dir);
      case "rotate_angle":
        return this.op.algorithm === "rotsprite"
          ? rotSpriteRotate(img, this.op.angleDeg)
          : rotateImageFast(img, this.op.angleDeg);
      case "scale": {
        if (this.op.algorithm === "scale2x") {
          const s2 = scale2xImage(img);
          return s2.width === this.op.width && s2.height === this.op.height
            ? s2
            : scaleImageNearest(s2, this.op.width, this.op.height);
        }
        if (this.op.algorithm === "eagle") {
          const eg = eagleScaleImage(img);
          return eg.width === this.op.width && eg.height === this.op.height
            ? eg
            : scaleImageNearest(eg, this.op.width, this.op.height);
        }
        if (this.op.algorithm === "bilinear") {
          return scaleImageBilinear(img, this.op.width, this.op.height, pal, sprite.transparentIndex);
        }
        return scaleImageNearest(img, this.op.width, this.op.height);
      }
      case "shift":
        return shiftImageWrap(img, this.op.dx, this.op.dy, sprite.mask);
    }
  }

  public do(sprite: Sprite): void {
    this.beforeWidth = sprite.width;
    this.beforeHeight = sprite.height;
    this.beforeMask = sprite.mask.clone();
    this.beforeCels.clear();

    if (this.scope === "cel") {
      const cel = getCel(sprite, this.layerId, this.frameIndex);
      if (!cel) return;
      this.beforeCels.set(cel.id, { x: cel.x, y: cel.y, image: cel.image.clone() });

      // If selection mask is non-empty and operation stays same size, apply inside selection bounds (B21)
      if (
        !sprite.mask.isEmpty &&
        sprite.mask.bounds &&
        (this.op.kind === "flip_h" ||
          this.op.kind === "flip_v" ||
          this.op.kind === "rotate_angle" ||
          (this.op.kind === "rotate_ortho" && this.op.dir === "180") ||
          this.op.kind === "shift")
      ) {
        if (this.op.kind === "shift") {
          cel.image = shiftImageWrap(cel.image, this.op.dx, this.op.dy, sprite.mask);
          return;
        }
        const b = sprite.mask.bounds;
        const clearVal = cel.image.colorMode === "indexed" ? sprite.transparentIndex : 0;

        // Extract only pixels that are inside the selection mask so unselected pixels inside `b` are untouched
        const sub = new PixelImage(b.width, b.height, cel.image.colorMode);
        if (clearVal !== 0) sub.clear(clearVal);
        const out = cel.image.clone();

        for (let y = 0; y < b.height; y++) {
          for (let x = 0; x < b.width; x++) {
            const gx = b.x + x;
            const gy = b.y + y;
            if (sprite.mask.getBit(gx, gy)) {
              sub.putPixel(x, y, cel.image.getPixel(gx, gy));
              out.putPixel(gx, gy, clearVal);
            }
          }
        }

        const transformedSub = this.applyOpToImage(sub, sprite, this.frameIndex);

        // Flip/rotate the selection mask about the exact same bounds `b` (B21)
        let nextMask = sprite.mask.clone();
        if (this.op.kind === "flip_h") {
          nextMask = flipMaskHorizontal(sprite.mask, b);
        } else if (this.op.kind === "flip_v") {
          nextMask = flipMaskVertical(sprite.mask, b);
        } else if (this.op.kind === "rotate_ortho" && this.op.dir === "180") {
          nextMask = rotateMaskOrthogonal(sprite.mask, "180", false);
        }

        for (let y = 0; y < transformedSub.height; y++) {
          for (let x = 0; x < transformedSub.width; x++) {
            const gx = b.x + x;
            const gy = b.y + y;
            if (gx >= 0 && gy >= 0 && gx < out.width && gy < out.height) {
              if (this.op.kind === "rotate_angle") {
                const px = transformedSub.getPixel(x, y);
                if (px !== clearVal) {
                  out.putPixel(gx, gy, px);
                }
              } else if (nextMask.getBit(gx, gy)) {
                out.putPixel(gx, gy, transformedSub.getPixel(x, y));
              }
            }
          }
        }
        cel.image = out;
        sprite.mask = nextMask;
        return;
      }

      const nextImg = this.applyOpToImage(cel.image, sprite, this.frameIndex);
      if (nextImg.width === cel.image.width && nextImg.height === cel.image.height) {
        cel.image = nextImg;
      } else {
        // Fit back onto canvas dimensions centered
        const fitted = new PixelImage(sprite.width, sprite.height, sprite.colorMode);
        for (let y = 0; y < Math.min(sprite.height, nextImg.height); y++) {
          for (let x = 0; x < Math.min(sprite.width, nextImg.width); x++) {
            fitted.putPixel(x, y, nextImg.getPixel(x, y));
          }
        }
        cel.image = fitted;
      }
      return;
    }

    // Whole-Sprite Transform
    let newW = sprite.width;
    let newH = sprite.height;
    if (this.op.kind === "rotate_ortho" && (this.op.dir === "90cw" || this.op.dir === "90ccw")) {
      newW = sprite.height;
      newH = sprite.width;
    } else if (this.op.kind === "scale") {
      newW = Math.max(1, Math.floor(this.op.width));
      newH = Math.max(1, Math.floor(this.op.height));
    }

    const linkMap = new Map<string, PixelImage>();
    for (const cel of sprite.cels) {
      this.beforeCels.set(cel.id, { x: cel.x, y: cel.y, image: cel.image.clone() });
      if (cel.linkId && linkMap.has(cel.linkId)) {
        cel.image = linkMap.get(cel.linkId)!;
        continue;
      }
      const nextImg = this.applyOpToImage(cel.image, sprite, cel.frameIndex);
      cel.image = nextImg;
      if (cel.linkId) linkMap.set(cel.linkId, nextImg);
    }

    const oldW = sprite.width;
    const oldH = sprite.height;
    sprite.width = newW;
    sprite.height = newH;

    // Preserve and reflect/rotate selection mask about canvas center when whole sprite is flipped/rotated (B21)
    if (!sprite.mask.isEmpty) {
      if (this.op.kind === "flip_h") {
        sprite.mask = flipMaskHorizontal(sprite.mask, { x: 0, y: 0, width: oldW, height: oldH });
      } else if (this.op.kind === "flip_v") {
        sprite.mask = flipMaskVertical(sprite.mask, { x: 0, y: 0, width: oldW, height: oldH });
      } else if (this.op.kind === "rotate_ortho") {
        sprite.mask = rotateMaskOrthogonal(sprite.mask, this.op.dir, true);
      } else {
        sprite.mask = new Mask(newW, newH);
      }
    } else {
      sprite.mask = new Mask(newW, newH);
    }
  }

  public undo(sprite: Sprite): void {
    sprite.width = this.beforeWidth;
    sprite.height = this.beforeHeight;
    sprite.mask = this.beforeMask.clone();

    const linkMap = new Map<string, PixelImage>();
    for (const cel of sprite.cels) {
      const prev = this.beforeCels.get(cel.id);
      if (!prev) continue;
      cel.x = prev.x;
      cel.y = prev.y;
      if (cel.linkId && linkMap.has(cel.linkId)) {
        cel.image = linkMap.get(cel.linkId)!;
      } else {
        const cloned = prev.image.clone();
        cel.image = cloned;
        if (cel.linkId) linkMap.set(cel.linkId, cloned);
      }
    }
  }
}

/**
 * Computes the union bounding box of all non-transparent pixels across all cels in `sprite`
 * for `Sprite > Trim`.
 */
export function computeSpriteNonEmptyBounds(sprite: Sprite): Rect {
  let minX = sprite.width;
  let minY = sprite.height;
  let maxX = -1;
  let maxY = -1;

  for (const cel of sprite.cels) {
    const pal = getPaletteForFrame(sprite, cel.frameIndex);
    for (let y = 0; y < cel.image.height; y++) {
      for (let x = 0; x < cel.image.width; x++) {
        const c = cel.image.getRGBA(x, y, pal, sprite.transparentIndex);
        if (c.a > 0) {
          const gx = cel.x + x;
          const gy = cel.y + y;
          if (gx < minX) minX = gx;
          if (gy < minY) minY = gy;
          if (gx > maxX) maxX = gx;
          if (gy > maxY) maxY = gy;
        }
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width: sprite.width, height: sprite.height };
  }
  return {
    x: clamp(minX, 0, sprite.width - 1),
    y: clamp(minY, 0, sprite.height - 1),
    width: Math.max(1, maxX - minX + 1),
    height: Math.max(1, maxY - minY + 1),
  };
}

/**
 * 7. Crops, trims, or resizes the Sprite Canvas with an explicit `(offsetX, offsetY)` anchor offset.
 */
export class CropOrCanvasSizeCommand implements Command {
  public readonly id = createModelId("cmd_crop_canvas");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public byteSize = 4096;

  private readonly newWidth: number;
  private readonly newHeight: number;
  private readonly offsetX: number; //Where old (0,0) lands in the new canvas
  private readonly offsetY: number;

  private beforeWidth = 0;
  private beforeHeight = 0;
  private beforeMask!: Mask;
  private beforeSlices: Slice[] = [];
  private beforeCels = new Map<string, PixelImage>();

  public constructor(params: {
    label: string;
    newWidth: number;
    newHeight: number;
    offsetX: number;
    offsetY: number;
  }) {
    this.label = params.label;
    this.newWidth = Math.max(1, Math.floor(params.newWidth));
    this.newHeight = Math.max(1, Math.floor(params.newHeight));
    this.offsetX = Math.round(params.offsetX);
    this.offsetY = Math.round(params.offsetY);
  }

  public do(sprite: Sprite): void {
    this.beforeWidth = sprite.width;
    this.beforeHeight = sprite.height;
    this.beforeMask = sprite.mask.clone();
    this.beforeSlices = sprite.slices.map((s) => ({
      ...s,
      keys: s.keys.map((k) => ({ ...k, bounds: { ...k.bounds } })),
    }));
    this.beforeCels.clear();

    const linkMap = new Map<string, PixelImage>();
    for (const cel of sprite.cels) {
      this.beforeCels.set(cel.id, cel.image.clone());
      if (cel.linkId && linkMap.has(cel.linkId)) {
        cel.image = linkMap.get(cel.linkId)!;
        continue;
      }
      const nextImg = new PixelImage(this.newWidth, this.newHeight, sprite.colorMode);
      if (sprite.colorMode === "indexed" && sprite.transparentIndex !== 0) {
        nextImg.clear(sprite.transparentIndex);
      }
      for (let sy = 0; sy < cel.image.height; sy++) {
        const dy = sy + this.offsetY;
        if (dy < 0 || dy >= this.newHeight) continue;
        for (let sx = 0; sx < cel.image.width; sx++) {
          const dx = sx + this.offsetX;
          if (dx < 0 || dx >= this.newWidth) continue;
          nextImg.putPixel(dx, dy, cel.image.getPixel(sx, sy));
        }
      }
      cel.image = nextImg;
      if (cel.linkId) linkMap.set(cel.linkId, nextImg);
    }

    // Shift slice bounds by (offsetX, offsetY)
    for (const s of sprite.slices) {
      for (const k of s.keys) {
        k.bounds = {
          x: k.bounds.x + this.offsetX,
          y: k.bounds.y + this.offsetY,
          width: k.bounds.width,
          height: k.bounds.height,
        };
      }
    }

    sprite.width = this.newWidth;
    sprite.height = this.newHeight;
    sprite.mask = new Mask(this.newWidth, this.newHeight);
  }

  public undo(sprite: Sprite): void {
    sprite.width = this.beforeWidth;
    sprite.height = this.beforeHeight;
    sprite.mask = this.beforeMask.clone();
    sprite.slices = this.beforeSlices.map((s) => ({
      ...s,
      keys: s.keys.map((k) => ({ ...k, bounds: { ...k.bounds } })),
    }));

    const linkMap = new Map<string, PixelImage>();
    for (const cel of sprite.cels) {
      const prev = this.beforeCels.get(cel.id);
      if (!prev) continue;
      if (cel.linkId && linkMap.has(cel.linkId)) {
        cel.image = linkMap.get(cel.linkId)!;
      } else {
        const cloned = prev.clone();
        cel.image = cloned;
        if (cel.linkId) linkMap.set(cel.linkId, cloned);
      }
    }
  }
}

/**
 * 8. Updates Sprite Properties (`name`, `transparentIndex`, `pixelRatio`, `grid`, `userData`).
 */
export class UpdateSpritePropertiesCommand implements Command {
  public readonly id = createModelId("cmd_sprite_props");
  public readonly label = "Sprite Properties";
  public readonly timestamp = Date.now();
  public readonly byteSize = 256;

  private before!: {
    name: string;
    transparentIndex: number;
    pixelRatio: { w: number; h: number };
    grid: GridSettings;
    userData: UserData;
  };
  private readonly patch: Partial<{
    name: string;
    transparentIndex: number;
    pixelRatio: { w: number; h: number };
    grid: GridSettings;
    userData: UserData;
  }>;

  public constructor(
    patch: Partial<{
      name: string;
      transparentIndex: number;
      pixelRatio: { w: number; h: number };
      grid: GridSettings;
      userData: UserData;
    }>
  ) {
    this.patch = patch;
  }

  public do(sprite: Sprite): void {
    this.before = {
      name: sprite.name,
      transparentIndex: sprite.transparentIndex,
      pixelRatio: { ...sprite.pixelRatio },
      grid: { ...sprite.grid },
      userData: { ...sprite.userData },
    };
    if (this.patch.name !== undefined) sprite.name = this.patch.name;
    if (this.patch.transparentIndex !== undefined) {
      sprite.transparentIndex = clamp(this.patch.transparentIndex, 0, 255);
    }
    if (this.patch.pixelRatio) sprite.pixelRatio = { ...this.patch.pixelRatio };
    if (this.patch.grid) sprite.grid = { ...this.patch.grid };
    if (this.patch.userData) sprite.userData = { ...this.patch.userData };
  }

  public undo(sprite: Sprite): void {
    sprite.name = this.before.name;
    sprite.transparentIndex = this.before.transparentIndex;
    sprite.pixelRatio = { ...this.before.pixelRatio };
    sprite.grid = { ...this.before.grid };
    sprite.userData = { ...this.before.userData };
  }
}
