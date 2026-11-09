/**
 * @module @kekenik/core/render
 * High-performance frame compositor, recursive group & tilemap renderer, dirty-rect tracker,
 * Extra-Cel live tool preview overlay, viewport math, and color wheel harmony utilities.
 * Zero DOM, React, or Electron imports.
 */

import {
  BlendMode,
  Cel,
  getPaletteForFrame,
  GroupLayer,
  PixelImage,
  ReadonlySprite,
  TILE_FLIP_X_FLAG,
  TILE_FLIP_Y_FLAG,
  TILE_INDEX_MASK,
  TILE_ROTATE_90_FLAG,
  TilemapLayer,
  Tileset,
} from "../model/index.ts";
import {
  hsvToRgba,
  intersectRect,
  Rect,
  RGBA,
  rgbToHsv,
  unionRect,
} from "../util/index.ts";

/**
 * Live brush/tool preview overlay ("Extra Cel") composited at a target layer's stack position.
 */
export interface ExtraCelOverlay {
  readonly layerId: string;
  readonly frameIndex: number;
  readonly x: number;
  readonly y: number;
  readonly image: PixelImage;
  readonly opacity?: number; // 0..255
  readonly blendMode?: BlendMode;
  readonly replaceTargetCel?: boolean; // true when preview image already contains mutated target cel copy
}

export interface CompositeFrameOptions {
  readonly forExport?: boolean; // when true, excludes reference layers
  readonly extraCel?: ExtraCelOverlay | null;
  readonly clipRect?: Rect | null;
}

/**
 * Renders a TilemapLayer cel into an RGBA PixelImage using its Tileset and tile bitflags
 * (TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG, TILE_ROTATE_90_FLAG).
 */
export function renderTilemapCel(
  cel: Cel,
  layer: TilemapLayer,
  tilesets: readonly Tileset[],
  spriteWidth: number,
  spriteHeight: number,
  palette?: readonly RGBA[],
  transparentIndex = 0
): PixelImage {
  if (!cel.tilemapData) {
    return cel.image;
  }
  const tileset = tilesets.find((ts) => ts.id === layer.tilesetId) ?? tilesets[0];
  if (!tileset || tileset.tiles.length === 0) {
    return cel.image;
  }

  const out = new PixelImage(spriteWidth, spriteHeight, "rgba");
  const { width: mapCols, height: mapRows, tiles } = cel.tilemapData;
  const tw = tileset.tileWidth;
  const th = tileset.tileHeight;

  for (let row = 0; row < mapRows; row++) {
    for (let col = 0; col < mapCols; col++) {
      const rawTile = tiles[row * mapCols + col] >>> 0;
      const tileIdx = (rawTile & TILE_INDEX_MASK) - tileset.baseIndex;
      if (tileIdx < 0 || tileIdx >= tileset.tiles.length) continue;

      const tileImg = tileset.tiles[tileIdx];
      if (!tileImg) continue;

      const flipX = (rawTile & TILE_FLIP_X_FLAG) !== 0;
      const flipY = (rawTile & TILE_FLIP_Y_FLAG) !== 0;
      const rot90 = (rawTile & TILE_ROTATE_90_FLAG) !== 0;

      const baseX = tileset.gridOriginX + col * tw;
      const baseY = tileset.gridOriginY + row * th;

      for (let ty = 0; ty < th; ty++) {
        for (let tx = 0; tx < tw; tx++) {
          let sx = tx;
          let sy = ty;
          if (rot90) {
            const tmp = sx;
            sx = sy;
            sy = tw - 1 - tmp;
          }
          if (flipX) sx = tw - 1 - sx;
          if (flipY) sy = th - 1 - sy;

          const rgba = tileImg.getRGBA(sx, sy, palette, transparentIndex);
          if (rgba.a === 0) continue;
          const dx = baseX + tx;
          const dy = baseY + ty;
          if (dx >= 0 && dy >= 0 && dx < spriteWidth && dy < spriteHeight) {
            out.setRGBA(dx, dy, rgba);
          }
        }
      }
    }
  }
  return out;
}

/**
 * Fast region blit from `source` onto an RGBA `dest` image within `clipRect`.
 * Uses a fast integer path for `normal` blend mode and falls back to `blendRGBA` for non-normal modes.
 */
export function blitRegionRGBA(
  dest: PixelImage,
  source: PixelImage,
  dstX: number,
  dstY: number,
  mode: BlendMode,
  opacity: number,
  palette: readonly RGBA[],
  transparentIndex: number,
  clipRect: Rect
): void {
  if (opacity <= 0) return;

  const startX = Math.max(clipRect.x, dstX, 0);
  const startY = Math.max(clipRect.y, dstY, 0);
  const endX = Math.min(clipRect.x + clipRect.width, dstX + source.width, dest.width);
  const endY = Math.min(clipRect.y + clipRect.height, dstY + source.height, dest.height);

  if (endX <= startX || endY <= startY) return;

  const dstData = dest.data;
  const dstW = dest.width;

  // Fast path: RGBA source + normal blend mode
  if (source.colorMode === "rgba" && mode === "normal") {
    const srcData = source.data;
    const srcW = source.width;
    for (let dy = startY; dy < endY; dy++) {
      const sy = dy - dstY;
      for (let dx = startX; dx < endX; dx++) {
        const sx = dx - dstX;
        const sIdx = (sy * srcW + sx) * 4;
        const saRaw = srcData[sIdx + 3];
        if (saRaw === 0) continue;

        const sa = opacity === 255 ? saRaw : ((saRaw * opacity + 127) / 255) | 0;
        if (sa <= 0) continue;

        const dIdx = (dy * dstW + dx) * 4;
        const ba = dstData[dIdx + 3];

        if (sa === 255 || ba === 0) {
          dstData[dIdx] = srcData[sIdx];
          dstData[dIdx + 1] = srcData[sIdx + 1];
          dstData[dIdx + 2] = srcData[sIdx + 2];
          dstData[dIdx + 3] = sa;
        } else {
          const saF = sa / 255;
          const baF = ba / 255;
          const outA = saF + baF * (1 - saF);
          const invOutA = 1 / outA;
          dstData[dIdx] = Math.round(
            (srcData[sIdx] * saF + dstData[dIdx] * baF * (1 - saF)) * invOutA
          );
          dstData[dIdx + 1] = Math.round(
            (srcData[sIdx + 1] * saF + dstData[dIdx + 1] * baF * (1 - saF)) * invOutA
          );
          dstData[dIdx + 2] = Math.round(
            (srcData[sIdx + 2] * saF + dstData[dIdx + 2] * baF * (1 - saF)) * invOutA
          );
          dstData[dIdx + 3] = Math.round(outA * 255);
        }
      }
    }
    return;
  }

  // General path supporting all 19 blend modes and Grayscale/Indexed sources
  for (let dy = startY; dy < endY; dy++) {
    const sy = dy - dstY;
    for (let dx = startX; dx < endX; dx++) {
      const sx = dx - dstX;
      const srcRgba = source.getRGBA(sx, sy, palette, transparentIndex);
      if (srcRgba.a === 0) continue;
      dest.blit(
        new PixelImage(
          1,
          1,
          "rgba",
          new Uint8Array([srcRgba.r, srcRgba.g, srcRgba.b, srcRgba.a])
        ),
        dx,
        dy,
        mode,
        opacity,
        palette,
        transparentIndex
      );
    }
  }
}

/**
 * Composites a frame (or dirty sub-rectangle) from the full recursive layer tree:
 * - GroupLayers (recursive with group opacity & blend mode)
 * - ImageLayers & TilemapLayers
 * - Z-index ordering
 * - Reference layer exclusion when `options.forExport === true`
 * - Extra-Cel live tool preview overlay
 */
export function compositeFrameAdvanced(
  sprite: ReadonlySprite,
  frameIndex: number,
  options: CompositeFrameOptions = {}
): PixelImage {
  const fullRect: Rect = { x: 0, y: 0, width: sprite.width, height: sprite.height };
  const clip = options.clipRect ? intersectRect(options.clipRect, fullRect) ?? fullRect : fullRect;
  const out = new PixelImage(sprite.width, sprite.height, "rgba");
  const palette = getPaletteForFrame(sprite, frameIndex);
  const forExport = Boolean(options.forExport);
  const extraCel = options.extraCel;

  // Helper to composite a subset of layers sharing `parentId` into `targetBuffer`
  const compositeLayerChildren = (parentId: string | null, targetBuffer: PixelImage) => {
    const childLayers = sprite.layers
      .map((layer, stackIndex) => ({ layer, stackIndex }))
      .filter(({ layer }) => layer.parentId === parentId && layer.visible);

    // Collect renderable items (either a group or a leaf layer cel) so zIndex sorting works across siblings
    interface RenderEntry {
      zIndex: number;
      stackIndex: number;
      render: () => void;
    }

    const entries: RenderEntry[] = [];

    for (const { layer, stackIndex } of childLayers) {
      if (forExport && layer.reference) {
        continue;
      }

      if (layer.kind === "group") {
        const groupLayer = layer as GroupLayer;
        entries.push({
          zIndex: 0,
          stackIndex,
          render: () => {
            const groupBuffer = new PixelImage(sprite.width, sprite.height, "rgba");
            compositeLayerChildren(groupLayer.id, groupBuffer);
            blitRegionRGBA(
              targetBuffer,
              groupBuffer,
              0,
              0,
              groupLayer.blendMode,
              groupLayer.opacity,
              palette,
              sprite.transparentIndex,
              clip
            );
          },
        });
        continue;
      }

      const cel = sprite.cels.find(
        (c) => c.layerId === layer.id && c.frameIndex === frameIndex
      );

      const hasExtraOnThisLayer =
        extraCel && extraCel.layerId === layer.id && extraCel.frameIndex === frameIndex;

      if (!cel && !hasExtraOnThisLayer) continue;

      const zIndex = cel?.zIndex ?? 0;

      entries.push({
        zIndex,
        stackIndex,
        render: () => {
          const celOpacity = cel?.opacity ?? 255;
          const effectiveOpacity = Math.round((layer.opacity * celOpacity) / 255);

          if (hasExtraOnThisLayer && extraCel.replaceTargetCel) {
            blitRegionRGBA(
              targetBuffer,
              extraCel.image,
              extraCel.x,
              extraCel.y,
              extraCel.blendMode ?? layer.blendMode,
              extraCel.opacity ?? effectiveOpacity,
              palette,
              sprite.transparentIndex,
              clip
            );
            return;
          }

          if (cel) {
            const sourceImg =
              layer.kind === "tilemap" && cel.tilemapData
                ? renderTilemapCel(
                    cel,
                    layer as TilemapLayer,
                    sprite.tilesets,
                    sprite.width,
                    sprite.height,
                    palette,
                    sprite.transparentIndex
                  )
                : cel.image;

            blitRegionRGBA(
              targetBuffer,
              sourceImg,
              cel.x,
              cel.y,
              layer.blendMode,
              effectiveOpacity,
              palette,
              sprite.transparentIndex,
              clip
            );
          }

          if (hasExtraOnThisLayer && !extraCel.replaceTargetCel) {
            blitRegionRGBA(
              targetBuffer,
              extraCel.image,
              extraCel.x,
              extraCel.y,
              extraCel.blendMode ?? layer.blendMode,
              extraCel.opacity ?? effectiveOpacity,
              palette,
              sprite.transparentIndex,
              clip
            );
          }
        },
      });
    }

    entries.sort((a, b) => {
      if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
      return a.stackIndex - b.stackIndex;
    });

    for (const entry of entries) {
      entry.render();
    }
  };

  compositeLayerChildren(null, out);
  return out;
}

/**
 * Tracks dirty rectangles across document commands for incremental Canvas2D / WebGL2 updates.
 */
export class DirtyRectTracker {
  private dirtyRect: Rect | null = null;

  public markDirty(rect: Rect): void {
    if (rect.width <= 0 || rect.height <= 0) return;
    this.dirtyRect = this.dirtyRect ? unionRect(this.dirtyRect, rect) : { ...rect };
  }

  public markFullDirty(width: number, height: number): void {
    this.dirtyRect = { x: 0, y: 0, width, height };
  }

  public consumeDirtyRect(): Rect | null {
    const r = this.dirtyRect;
    this.dirtyRect = null;
    return r;
  }

  public get current(): Rect | null {
    return this.dirtyRect;
  }
}

/**
 * Incremental frame compositor cache that re-composites only the dirty sub-rectangle
 * into a persistent RGBA frame buffer when a stroke or patch occurs.
 */
export class FrameCompositorCache {
  private cachedFrame: PixelImage | null = null;
  private cachedSpriteId = "";
  private cachedFrameIndex = -1;
  public readonly dirtyTracker = new DirtyRectTracker();

  /**
   * Renders the full frame or updates only the dirty sub-rectangle in place.
   */
  public renderFrame(
    sprite: ReadonlySprite,
    frameIndex: number,
    dirtyRect?: Rect | null,
    options: CompositeFrameOptions = {}
  ): PixelImage {
    const needsFull =
      !this.cachedFrame ||
      this.cachedSpriteId !== sprite.id ||
      this.cachedFrameIndex !== frameIndex ||
      this.cachedFrame.width !== sprite.width ||
      this.cachedFrame.height !== sprite.height ||
      !dirtyRect;

    if (needsFull) {
      this.cachedFrame = compositeFrameAdvanced(sprite, frameIndex, options);
      this.cachedSpriteId = sprite.id;
      this.cachedFrameIndex = frameIndex;
      return this.cachedFrame;
    }

    const clamped = intersectRect(dirtyRect, {
      x: 0,
      y: 0,
      width: sprite.width,
      height: sprite.height,
    });
    if (!clamped) return this.cachedFrame!;

    // Clear dirty region in cachedFrame and re-composite only that region
    const subComp = compositeFrameAdvanced(sprite, frameIndex, {
      ...options,
      clipRect: clamped,
    });

    const bpp = 4;
    for (let row = 0; row < clamped.height; row++) {
      const y = clamped.y + row;
      const start = (y * sprite.width + clamped.x) * bpp;
      const end = start + clamped.width * bpp;
      this.cachedFrame!.data.set(subComp.data.subarray(start, end), start);
    }

    return this.cachedFrame!;
  }

  public invalidate(): void {
    this.cachedFrame = null;
  }
}

/**
 * Computes the non-transparent bounding box of a Layer's cel at `frameIndex` (for `View > Show > Layer Edges`).
 */
export function computeCelContentBounds(
  sprite: ReadonlySprite,
  layerId: string,
  frameIndex: number
): Rect | null {
  const cel = sprite.cels.find((c) => c.layerId === layerId && c.frameIndex === frameIndex);
  if (!cel) return null;
  const palette = getPaletteForFrame(sprite, frameIndex);
  const img = cel.image;
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.getRGBA(x, y, palette, sprite.transparentIndex).a > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return {
    x: cel.x + minX,
    y: cel.y + minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

// ---------------------------------------------------------------------------
// Viewport Fixed Zoom Steps & Zoom-to-Cursor Math
// ---------------------------------------------------------------------------

/**
 * Canonical Aseprite zoom steps in percentage (from 1:64 = 1.5625% up to 64:1 = 6400%).
 */
export const ZOOM_STEPS: readonly number[] = [
  1.5625,
  3.125,
  6.25,
  12.5,
  25,
  50,
  100,
  200,
  300,
  400,
  500,
  600,
  800,
  1200,
  1600,
  2400,
  3200,
  4800,
  6400,
];

/**
 * Returns the next higher zoom percentage from `ZOOM_STEPS`.
 */
export function getNextZoomStep(currentZoom: number): number {
  for (const step of ZOOM_STEPS) {
    if (step > currentZoom + 0.01) return step;
  }
  return ZOOM_STEPS[ZOOM_STEPS.length - 1];
}

/**
 * Returns the next lower zoom percentage from `ZOOM_STEPS`.
 */
export function getPrevZoomStep(currentZoom: number): number {
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < currentZoom - 0.01) return ZOOM_STEPS[i];
  }
  return ZOOM_STEPS[0];
}

/**
 * Computes new `(panX, panY)` when zooming from `oldZoom` to `newZoom` so the canvas point
 * under `(cursorOffsetX, cursorOffsetY)` (relative to viewport center) remains stationary.
 */
export function computeZoomToCursorPan(
  panX: number,
  panY: number,
  oldZoom: number,
  newZoom: number,
  cursorOffsetX: number,
  cursorOffsetY: number
): { panX: number; panY: number } {
  if (oldZoom <= 0 || newZoom <= 0) return { panX, panY };
  const ratio = newZoom / oldZoom;
  return {
    panX: Math.round(cursorOffsetX - (cursorOffsetX - panX) * ratio),
    panY: Math.round(cursorOffsetY - (cursorOffsetY - panY) * ratio),
  };
}

/**
 * Computes the best zoom percentage from `ZOOM_STEPS` that fits `spriteW x spriteH` inside `viewportW x viewportH`.
 */
export function computeZoomFit(
  spriteW: number,
  spriteH: number,
  viewportW: number,
  viewportH: number,
  pixelRatio: { w: number; h: number } = { w: 1, h: 1 }
): number {
  const effW = Math.max(1, spriteW * pixelRatio.w);
  const effH = Math.max(1, spriteH * pixelRatio.h);
  const maxScale = Math.min((viewportW * 0.85) / effW, (viewportH * 0.85) / effH);
  const targetPct = maxScale * 100;
  let best = ZOOM_STEPS[0];
  for (const step of ZOOM_STEPS) {
    if (step <= targetPct) best = step;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Color Wheel Harmonies (Complementary, Triadic, Analogous, Split-Complementary)
// ---------------------------------------------------------------------------

export type ColorHarmonyMode =
  | "complementary"
  | "triadic"
  | "analogous"
  | "split_complementary";

/**
 * Computes color harmony swatches for a given base RGBA color.
 */
export function computeColorHarmonies(
  baseColor: RGBA,
  mode: ColorHarmonyMode
): RGBA[] {
  const hsv = rgbToHsv(baseColor.r, baseColor.g, baseColor.b);
  const s = Math.max(25, hsv.s);
  const v = Math.max(30, hsv.v);
  const a = baseColor.a;

  const atHue = (degOffset: number): RGBA =>
    hsvToRgba((hsv.h + degOffset + 360) % 360, s, v, a);

  switch (mode) {
    case "complementary":
      return [baseColor, atHue(180)];
    case "triadic":
      return [baseColor, atHue(120), atHue(240)];
    case "analogous":
      return [atHue(-30), baseColor, atHue(30)];
    case "split_complementary":
      return [baseColor, atHue(150), atHue(210)];
  }
}
