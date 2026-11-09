/**
 * @module @kekenik/core/tilemap
 * Pure TypeScript Tilemap, Tileset, and Slice engine matching Aseprite 1.3 behavior:
 * - Tile index + FlipX / FlipY / Rotate90 bitflag packing & unpacking
 * - Empty tile 0 rule ("Empty tile = transparent")
 * - Tiles Mode (Tile Brush, Tile Flood Fill, Tile Line, Tile Rectangle)
 * - Pixels Mode (Auto / Stack / Manual tileset synchronization)
 * - Automatic Layer <-> Tilemap conversion with tile deduplication
 * - Unused tile cleanup & index remapping
 * - Animated per-frame Slice keys, 9-patch center guides, pivot points, and Slice region export
 * Zero DOM, React, or Electron imports.
 */

import {
  Cel,
  ColorMode,
  createModelId,
  PixelImage,
  ReadonlySprite,
  Slice,
  SliceKey,
  Sprite,
  TILE_FLIP_X_FLAG,
  TILE_FLIP_Y_FLAG,
  TILE_INDEX_MASK,
  TILE_ROTATE_90_FLAG,
  TilemapCelData,
  TilemapLayer,
  Tileset,
} from "../model/index.ts";
import { compositeFrameAdvanced, renderTilemapCel } from "../render/index.ts";
import { bresenhamLine, clamp, Point, Rect } from "../util/index.ts";

export type TilemapEditMode = "tiles" | "pixels";
export type TilesetModificationMode = "auto" | "stack" | "manual";

export interface UnpackedTileEntry {
  readonly tileIndex: number;
  readonly flipX: boolean;
  readonly flipY: boolean;
  readonly rot90: boolean;
}

/**
 * Packs a tile index and flip/rotation flags into an unsigned 32-bit integer.
 */
export function packTileEntry(
  tileIndex: number,
  flipX = false,
  flipY = false,
  rot90 = false
): number {
  let raw = Math.max(0, Math.floor(tileIndex)) & TILE_INDEX_MASK;
  if (flipX) raw = (raw | TILE_FLIP_X_FLAG) >>> 0;
  if (flipY) raw = (raw | TILE_FLIP_Y_FLAG) >>> 0;
  if (rot90) raw = (raw | TILE_ROTATE_90_FLAG) >>> 0;
  return raw >>> 0;
}

/**
 * Unpacks an unsigned 32-bit tilemap entry into its tile index and transformation flags.
 */
export function unpackTileEntry(rawEntry: number): UnpackedTileEntry {
  const u = rawEntry >>> 0;
  return {
    tileIndex: u & TILE_INDEX_MASK,
    flipX: (u & TILE_FLIP_X_FLAG) !== 0,
    flipY: (u & TILE_FLIP_Y_FLAG) !== 0,
    rot90: (u & TILE_ROTATE_90_FLAG) !== 0,
  };
}

/**
 * Checks whether a tile image is completely transparent ("Empty tile 0 rule").
 */
export function isTileImageEmpty(img: PixelImage, transparentIndex = 0): boolean {
  if (img.colorMode === "rgba") {
    for (let i = 3; i < img.data.length; i += 4) {
      if (img.data[i] !== 0) return false;
    }
    return true;
  }
  if (img.colorMode === "grayscale") {
    for (let i = 1; i < img.data.length; i += 2) {
      if (img.data[i] !== 0) return false;
    }
    return true;
  }
  for (let i = 0; i < img.data.length; i++) {
    if (img.data[i] !== transparentIndex) return false;
  }
  return true;
}

/**
 * Checks whether two `PixelImage` instances have identical dimensions and pixel bytes.
 */
export function areTileImagesEqual(a: PixelImage, b: PixelImage): boolean {
  if (a.width !== b.width || a.height !== b.height || a.colorMode !== b.colorMode) {
    return false;
  }
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

/**
 * Creates a new `Tileset` with Tile 0 initialized as an empty transparent tile.
 */
export function createDefaultTileset(options: {
  name?: string;
  tileWidth?: number;
  tileHeight?: number;
  gridOriginX?: number;
  gridOriginY?: number;
  baseIndex?: number;
  columns?: number;
  colorMode?: ColorMode;
} = {}): Tileset {
  const tw = clamp(Math.floor(options.tileWidth ?? 16), 1, 256);
  const th = clamp(Math.floor(options.tileHeight ?? 16), 1, 256);
  const mode = options.colorMode ?? "rgba";
  const emptyTile0 = new PixelImage(tw, th, mode);

  return {
    id: createModelId("tileset"),
    name: options.name ?? "Tileset 1",
    tileWidth: tw,
    tileHeight: th,
    gridOriginX: options.gridOriginX ?? 0,
    gridOriginY: options.gridOriginY ?? 0,
    baseIndex: options.baseIndex ?? 0,
    columns: options.columns ?? 8,
    tiles: [emptyTile0],
    userData: { text: "" },
  };
}

/**
 * Extracts a deduplicated `Tileset` and `TilemapCelData` from an existing `PixelImage`.
 * Empty cells map to Tile 0 (`baseIndex + 0`), and identical non-empty tiles share the same tile index.
 */
export function extractTilesetFromImage(
  source: PixelImage,
  tileWidth: number,
  tileHeight: number,
  name = "Extracted Tileset",
  transparentIndex = 0
): { tileset: Tileset; tilemapData: TilemapCelData } {
  const tw = clamp(Math.floor(tileWidth), 1, source.width);
  const th = clamp(Math.floor(tileHeight), 1, source.height);
  const cols = Math.max(1, Math.ceil(source.width / tw));
  const rows = Math.max(1, Math.ceil(source.height / th));

  const tileset = createDefaultTileset({
    name,
    tileWidth: tw,
    tileHeight: th,
    colorMode: source.colorMode,
  });

  const tiles = new Uint32Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellImg = source.crop({
        x: c * tw,
        y: r * th,
        width: tw,
        height: th,
      });

      if (isTileImageEmpty(cellImg, transparentIndex)) {
        tiles[r * cols + c] = 0;
        continue;
      }

      let foundIdx = -1;
      for (let ti = 1; ti < tileset.tiles.length; ti++) {
        if (areTileImagesEqual(tileset.tiles[ti], cellImg)) {
          foundIdx = ti;
          break;
        }
      }

      if (foundIdx === -1) {
        foundIdx = tileset.tiles.length;
        tileset.tiles.push(cellImg);
      }

      tiles[r * cols + c] = packTileEntry(foundIdx + tileset.baseIndex);
    }
  }

  return {
    tileset,
    tilemapData: {
      width: cols,
      height: rows,
      tiles,
    },
  };
}

/**
 * Rebuilds `cel.image` from `cel.tilemapData` and `tileset` so tools and thumbnails always have an up-to-date PixelImage.
 */
export function syncCelImageFromTilemap(
  cel: Cel,
  layer: TilemapLayer,
  sprite: ReadonlySprite
): void {
  if (!cel.tilemapData) return;
  const rendered = renderTilemapCel(
    cel,
    layer,
    sprite.tilesets,
    sprite.width,
    sprite.height,
    sprite.palettes[0]?.colors,
    sprite.transparentIndex
  );
  cel.image = rendered;
}

/**
 * Synchronizes pixel edits made in Pixels Mode (`editedImage`) back into `tileset` and `cel.tilemapData`
 * according to `mode` (`"auto"` | `"stack"` | `"manual"`):
 * - `"manual"`: modifies existing referenced tiles in-place (if cell references tile > 0); cells referencing empty tile 0 are ignored unless in auto/stack.
 * - `"auto"`: deduplicates modified cell bitmaps against existing tileset tiles or creates a new tile when unique.
 * - `"stack"`: always allocates a new tile in the tileset for any modified cell that was previously shared or empty.
 */
export function syncTilemapFromEditedPixels(
  cel: Cel,
  tileset: Tileset,
  editedImage: PixelImage,
  mode: TilesetModificationMode,
  transparentIndex = 0
): void {
  if (!cel.tilemapData) return;
  const { width: cols, height: rows, tiles } = cel.tilemapData;
  const tw = tileset.tileWidth;
  const th = tileset.tileHeight;

  // Count how many cells reference each tile index
  const usageCounts = new Map<number, number>();
  for (let i = 0; i < tiles.length; i++) {
    const idx = (tiles[i] & TILE_INDEX_MASK) - tileset.baseIndex;
    usageCounts.set(idx, (usageCounts.get(idx) ?? 0) + 1);
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellIdx = r * cols + c;
      const rawEntry = tiles[cellIdx] >>> 0;
      const currentTileIdx = (rawEntry & TILE_INDEX_MASK) - tileset.baseIndex;

      const cellBitmap = editedImage.crop({
        x: tileset.gridOriginX + c * tw,
        y: tileset.gridOriginY + r * th,
        width: tw,
        height: th,
      });

      const currentTileImg = tileset.tiles[currentTileIdx] ?? tileset.tiles[0];
      if (currentTileImg) {
        const flipX = (rawEntry & TILE_FLIP_X_FLAG) !== 0;
        const flipY = (rawEntry & TILE_FLIP_Y_FLAG) !== 0;
        const rot90 = (rawEntry & TILE_ROTATE_90_FLAG) !== 0;
        let expectedCell = currentTileImg;
        if (flipX || flipY || rot90) {
          expectedCell = new PixelImage(tw, th, currentTileImg.colorMode);
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
              expectedCell.putPixel(tx, ty, currentTileImg.getPixel(sx, sy));
            }
          }
        }
        if (areTileImagesEqual(expectedCell, cellBitmap)) {
          continue;
        }
      }

      // Empty tile = transparent rule: if cell bitmap was erased to empty
      if (isTileImageEmpty(cellBitmap, transparentIndex)) {
        if (mode !== "manual") {
          tiles[cellIdx] = 0;
        } else if (currentTileIdx > 0 && tileset.tiles[currentTileIdx]) {
          tileset.tiles[currentTileIdx].clear(0);
        }
        continue;
      }

      if (mode === "manual") {
        // Manual mode only edits existing non-zero tiles in-place
        if (currentTileIdx > 0 && tileset.tiles[currentTileIdx]) {
          tileset.tiles[currentTileIdx] = cellBitmap;
        }
        continue;
      }

      if (mode === "auto") {
        // Check if an identical tile already exists in the tileset
        let existingIdx = -1;
        for (let ti = 1; ti < tileset.tiles.length; ti++) {
          if (areTileImagesEqual(tileset.tiles[ti], cellBitmap)) {
            existingIdx = ti;
            break;
          }
        }
        if (existingIdx !== -1) {
          tiles[cellIdx] = packTileEntry(existingIdx + tileset.baseIndex);
        } else {
          const newIdx = tileset.tiles.length;
          tileset.tiles.push(cellBitmap);
          tiles[cellIdx] = packTileEntry(newIdx + tileset.baseIndex);
        }
        continue;
      }

      // mode === "stack": always create a new tile copy so other cells are unaffected
      const newIdx = tileset.tiles.length;
      tileset.tiles.push(cellBitmap);
      tiles[cellIdx] = packTileEntry(newIdx + tileset.baseIndex);
    }
  }

  // Ensure Tile 0 stays strictly empty/transparent
  if (tileset.tiles[0]) {
    tileset.tiles[0].clear(0);
  }
}

// ---------------------------------------------------------------------------
// Tile-Aware Drawing Algorithms (Pencil, Eraser, Paint Bucket, Line, Rectangle)
// ---------------------------------------------------------------------------

/**
 * Converts sprite pixel coordinate `(px, py)` to tilemap cell `(col, row)`.
 */
export function pixelToTileCoord(
  px: number,
  py: number,
  tileset: Pick<Tileset, "tileWidth" | "tileHeight" | "gridOriginX" | "gridOriginY">
): Point {
  return {
    x: Math.floor((px - tileset.gridOriginX) / Math.max(1, tileset.tileWidth)),
    y: Math.floor((py - tileset.gridOriginY) / Math.max(1, tileset.tileHeight)),
  };
}

/**
 * Paints `packedTileEntry` at each tile cell coordinate in `cells` onto `tilemapData`.
 */
export function paintTileCells(
  tilemapData: TilemapCelData,
  cells: readonly Point[],
  packedTileEntry: number
): boolean {
  let changed = false;
  for (const pt of cells) {
    if (pt.x < 0 || pt.y < 0 || pt.x >= tilemapData.width || pt.y >= tilemapData.height) {
      continue;
    }
    const idx = pt.y * tilemapData.width + pt.x;
    if (tilemapData.tiles[idx] !== packedTileEntry >>> 0) {
      tilemapData.tiles[idx] = packedTileEntry >>> 0;
      changed = true;
    }
  }
  return changed;
}

/**
 * Flood-fills contiguous or global tile cells matching the starting cell's tile entry.
 */
export function floodFillTileCells(
  tilemapData: TilemapCelData,
  startCol: number,
  startRow: number,
  fillPackedEntry: number,
  contiguous = true
): boolean {
  const w = tilemapData.width;
  const h = tilemapData.height;
  if (startCol < 0 || startRow < 0 || startCol >= w || startRow >= h) return false;

  const targetVal = tilemapData.tiles[startRow * w + startCol] >>> 0;
  const replacementVal = fillPackedEntry >>> 0;
  if (targetVal === replacementVal) return false;

  if (!contiguous) {
    for (let i = 0; i < tilemapData.tiles.length; i++) {
      if (tilemapData.tiles[i] >>> 0 === targetVal) {
        tilemapData.tiles[i] = replacementVal;
      }
    }
    return true;
  }

  const visited = new Uint8Array(w * h);
  const queue: number[] = [startRow * w + startCol];
  visited[startRow * w + startCol] = 1;

  while (queue.length > 0) {
    const curr = queue.pop()!;
    tilemapData.tiles[curr] = replacementVal;
    const cx = curr % w;
    const cy = Math.floor(curr / w);

    const neighbors = [
      { nx: cx - 1, ny: cy },
      { nx: cx + 1, ny: cy },
      { nx: cx, ny: cy - 1 },
      { nx: cx, ny: cy + 1 },
    ];
    for (const { nx, ny } of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (visited[nIdx]) continue;
      if (tilemapData.tiles[nIdx] >>> 0 === targetVal) {
        visited[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }
  return true;
}

/**
 * Draws a Bresenham line of tile entries on `tilemapData`.
 */
export function rasterizeTileLine(
  tilemapData: TilemapCelData,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  packedEntry: number
): boolean {
  const pts = bresenhamLine(c0, r0, c1, r1);
  return paintTileCells(tilemapData, pts, packedEntry);
}

/**
 * Draws a stroked or filled rectangle of tile entries on `tilemapData`.
 */
export function rasterizeTileRectangle(
  tilemapData: TilemapCelData,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  packedEntry: number,
  filled = true
): boolean {
  const minC = Math.min(c0, c1);
  const maxC = Math.max(c0, c1);
  const minR = Math.min(r0, r1);
  const maxR = Math.max(r0, r1);
  const pts: Point[] = [];

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (filled || r === minR || r === maxR || c === minC || c === maxC) {
        pts.push({ x: c, y: r });
      }
    }
  }
  return paintTileCells(tilemapData, pts, packedEntry);
}

/**
 * Finds all cell coordinates `(col, row)` in `tilemapData` that reference `targetTileIndex`.
 */
export function findTileOccurrences(
  tilemapData: TilemapCelData,
  targetTileIndex: number
): Array<{ col: number; row: number; flipX: boolean; flipY: boolean; rot90: boolean }> {
  const out: Array<{ col: number; row: number; flipX: boolean; flipY: boolean; rot90: boolean }> = [];
  for (let r = 0; r < tilemapData.height; r++) {
    for (let c = 0; c < tilemapData.width; c++) {
      const unpacked = unpackTileEntry(tilemapData.tiles[r * tilemapData.width + c]);
      if (unpacked.tileIndex === targetTileIndex) {
        out.push({
          col: c,
          row: r,
          flipX: unpacked.flipX,
          flipY: unpacked.flipY,
          rot90: unpacked.rot90,
        });
      }
    }
  }
  return out;
}

/**
 * Purges unused tiles (excluding Tile 0) from `tileset` and remaps all `TilemapCelData` entries
 * in `sprite` that belong to layers referencing `tileset.id`.
 * Returns the number of removed unused tiles.
 */
export function purgeUnusedTilesInSprite(sprite: Sprite, tilesetId: string): number {
  const tileset = sprite.tilesets.find((ts) => ts.id === tilesetId);
  if (!tileset || tileset.tiles.length <= 1) return 0;

  const usedIndices = new Set<number>([0]); // Always keep Tile 0
  const layerIds = new Set(
    sprite.layers
      .filter((l): l is TilemapLayer => l.kind === "tilemap" && l.tilesetId === tilesetId)
      .map((l) => l.id)
  );

  for (const cel of sprite.cels) {
    if (!layerIds.has(cel.layerId) || !cel.tilemapData) continue;
    for (let i = 0; i < cel.tilemapData.tiles.length; i++) {
      const idx = (cel.tilemapData.tiles[i] & TILE_INDEX_MASK) - tileset.baseIndex;
      if (idx >= 0 && idx < tileset.tiles.length) {
        usedIndices.add(idx);
      }
    }
  }

  const newTiles: PixelImage[] = [];
  const oldToNewIndex = new Map<number, number>();

  for (let oldIdx = 0; oldIdx < tileset.tiles.length; oldIdx++) {
    if (usedIndices.has(oldIdx)) {
      oldToNewIndex.set(oldIdx, newTiles.length);
      newTiles.push(tileset.tiles[oldIdx]);
    }
  }

  const removedCount = tileset.tiles.length - newTiles.length;
  if (removedCount <= 0) return 0;

  tileset.tiles = newTiles;

  for (const cel of sprite.cels) {
    if (!layerIds.has(cel.layerId) || !cel.tilemapData) continue;
    for (let i = 0; i < cel.tilemapData.tiles.length; i++) {
      const unpacked = unpackTileEntry(cel.tilemapData.tiles[i]);
      const localOld = unpacked.tileIndex - tileset.baseIndex;
      const localNew = oldToNewIndex.get(localOld) ?? 0;
      cel.tilemapData.tiles[i] = packTileEntry(
        localNew + tileset.baseIndex,
        unpacked.flipX,
        unpacked.flipY,
        unpacked.rot90
      );
    }
  }

  return removedCount;
}

// ---------------------------------------------------------------------------
// Slice & Animated Slice Key Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the active `SliceKey` for `slice` at `frameIndex` (exact match or latest key `<= frameIndex`).
 */
export function getSliceKeyForFrame(slice: Slice, frameIndex: number): SliceKey {
  if (slice.keys.length === 0) {
    return {
      frameIndex: 0,
      bounds: { x: 0, y: 0, width: 16, height: 16 },
    };
  }
  const sorted = [...slice.keys].sort((a, b) => a.frameIndex - b.frameIndex);
  let active = sorted[0];
  for (const k of sorted) {
    if (k.frameIndex <= frameIndex) {
      active = k;
    } else {
      break;
    }
  }
  return active;
}

/**
 * Clones a `SliceKey` deeply.
 */
export function cloneSliceKey(k: SliceKey): SliceKey {
  return {
    frameIndex: k.frameIndex,
    bounds: { ...k.bounds },
    center: k.center ? { ...k.center } : undefined,
    pivot: k.pivot ? { ...k.pivot } : undefined,
  };
}

/**
 * Inserts or updates a keyframe on `slice` at `frameIndex`.
 */
export function upsertSliceKey(
  slice: Slice,
  frameIndex: number,
  patch: {
    bounds?: Rect;
    center?: Rect | undefined;
    pivot?: Point | undefined;
  }
): SliceKey {
  const existingIdx = slice.keys.findIndex((k) => k.frameIndex === frameIndex);
  const baseKey = getSliceKeyForFrame(slice, frameIndex);

  const updated: SliceKey = {
    frameIndex,
    bounds: patch.bounds ? { ...patch.bounds } : { ...baseKey.bounds },
    center: "center" in patch ? (patch.center ? { ...patch.center } : undefined) : baseKey.center ? { ...baseKey.center } : undefined,
    pivot: "pivot" in patch ? (patch.pivot ? { ...patch.pivot } : undefined) : baseKey.pivot ? { ...baseKey.pivot } : undefined,
  };

  if (existingIdx >= 0) {
    slice.keys[existingIdx] = updated;
  } else {
    slice.keys.push(updated);
    slice.keys.sort((a, b) => a.frameIndex - b.frameIndex);
  }
  return updated;
}

/**
 * Hit-tests all slices at `(x, y)` on `frameIndex`, returning the topmost matching Slice or null.
 */
export function hitTestSlices(
  slices: readonly Slice[],
  frameIndex: number,
  x: number,
  y: number
): Slice | null {
  for (let i = slices.length - 1; i >= 0; i--) {
    const s = slices[i];
    const key = getSliceKeyForFrame(s, frameIndex);
    const b = key.bounds;
    if (x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height) {
      return s;
    }
  }
  return null;
}

/**
 * Exports the composited pixel region inside a Slice's bounds at `frameIndex` as a cropped `PixelImage`
 * (`timeline.slice_export_bounds`).
 */
export function exportSliceCroppedImage(
  sprite: ReadonlySprite,
  sliceId: string,
  frameIndex: number
): PixelImage | null {
  const slice = sprite.slices.find((s) => s.id === sliceId);
  if (!slice) return null;
  const key = getSliceKeyForFrame(slice, frameIndex);
  const comp = compositeFrameAdvanced(sprite, frameIndex, { forExport: true });
  return comp.crop({
    x: clamp(key.bounds.x, 0, sprite.width - 1),
    y: clamp(key.bounds.y, 0, sprite.height - 1),
    width: clamp(key.bounds.width, 1, sprite.width),
    height: clamp(key.bounds.height, 1, sprite.height),
  });
}
