/**
 * @module @kekenik/core/commands/agent3-commands
 * Undoable Commands for Agent 3:
 * - Layer groups, drag-and-drop reparenting, duplicate, merge down, flatten, convert to/from background & tilemap, solo/isolate, lock/show all
 * - Frame range durations, constant frame rate, reverse frames, cel properties (opacity, z-index, offset, userData)
 * - Cel range move/swap, copy, link, clear, and clipboard paste
 * - Tag update/delete and Slice keyframe/9-patch/pivot update/delete
 * - Tilemap cel edits (Tiles Mode & Auto/Stack/Manual Pixels Mode) and Tileset management
 * Zero DOM, React, or Electron imports.
 */

import {
  BlendMode,
  Cel,
  createModelId,
  Frame,
  getCel,
  getPaletteForFrame,
  GroupLayer,
  ImageLayer,
  Layer,
  PixelImage,
  Slice,
  SliceKey,
  Sprite,
  Tag,
  TilemapLayer,
  Tileset,
  UserData,
} from "../model/index.ts";
import { compositeFrameAdvanced, renderTilemapCel } from "../render/index.ts";
import {
  cloneSliceKey,
  createDefaultTileset,
  extractTilesetFromImage,
  packTileEntry,
  purgeUnusedTilesInSprite,
  unpackTileEntry,
} from "../tilemap/index.ts";
import { clamp, RGBA } from "../util/index.ts";
import { Command } from "./index.ts";

function cloneCel(c: Cel): Cel {
  return {
    ...c,
    image: c.image.clone(),
    tilemapData: c.tilemapData
      ? {
          width: c.tilemapData.width,
          height: c.tilemapData.height,
          tiles: new Uint32Array(c.tilemapData.tiles),
        }
      : undefined,
    userData: { ...c.userData },
  };
}

function cloneLayer(l: Layer): Layer {
  if (l.kind === "group") {
    return {
      ...l,
      children: [...l.children],
      userData: { ...l.userData },
    };
  }
  return {
    ...l,
    userData: { ...l.userData },
  };
}

function cloneTileset(ts: Tileset): Tileset {
  return {
    ...ts,
    tiles: ts.tiles.map((img) => img.clone()),
    userData: { ...ts.userData },
  };
}

function rebuildGroupChildrenArrays(sprite: Sprite): void {
  for (const l of sprite.layers) {
    if (l.kind === "group") {
      l.children = sprite.layers
        .filter((child) => child.parentId === l.id)
        .map((child) => child.id);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Layer Full Properties & UserData Command
// ---------------------------------------------------------------------------

export interface LayerFullPropsPatch {
  name?: string;
  visible?: boolean;
  editable?: boolean;
  lockMove?: boolean;
  background?: boolean;
  preferLinkedCels?: boolean;
  collapsed?: boolean;
  reference?: boolean;
  blendMode?: BlendMode;
  opacity?: number;
  parentId?: string | null;
  userData?: UserData;
}

/**
 * Updates any properties on a Layer (including `userData.color`, `userData.text`, `reference`, `collapsed`, `parentId`).
 */
export class SetLayerFullPropsCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 192;
  private readonly layerId: string;
  private readonly patch: LayerFullPropsPatch;
  private prevSnapshot: Layer | null = null;

  public constructor(
    layerId: string,
    patch: LayerFullPropsPatch,
    label = "Layer Properties"
  ) {
    this.layerId = layerId;
    this.patch = patch;
    this.label = label;
  }

  public do(sprite: Sprite): void {
    const idx = sprite.layers.findIndex((l) => l.id === this.layerId);
    if (idx < 0) return;
    const layer = sprite.layers[idx];
    this.prevSnapshot = cloneLayer(layer);

    if (this.patch.name !== undefined) layer.name = this.patch.name;
    if (this.patch.visible !== undefined) layer.visible = this.patch.visible;
    if (this.patch.editable !== undefined) layer.editable = this.patch.editable;
    if (this.patch.lockMove !== undefined) layer.lockMove = this.patch.lockMove;
    if (this.patch.background !== undefined) layer.background = this.patch.background;
    if (this.patch.preferLinkedCels !== undefined)
      layer.preferLinkedCels = this.patch.preferLinkedCels;
    if (this.patch.collapsed !== undefined) layer.collapsed = this.patch.collapsed;
    if (this.patch.reference !== undefined) layer.reference = this.patch.reference;
    if (this.patch.blendMode !== undefined) layer.blendMode = this.patch.blendMode;
    if (this.patch.opacity !== undefined)
      layer.opacity = clamp(Math.round(this.patch.opacity), 0, 255);
    if (this.patch.parentId !== undefined) layer.parentId = this.patch.parentId;
    if (this.patch.userData !== undefined) {
      layer.userData = { ...this.patch.userData };
    }
    rebuildGroupChildrenArrays(sprite);
  }

  public undo(sprite: Sprite): void {
    if (!this.prevSnapshot) return;
    const idx = sprite.layers.findIndex((l) => l.id === this.layerId);
    if (idx < 0) return;
    sprite.layers[idx] = cloneLayer(this.prevSnapshot);
    rebuildGroupChildrenArrays(sprite);
  }
}

// ---------------------------------------------------------------------------
// 2. Group Layer Creation, Grouping, Ungrouping & Reparenting
// ---------------------------------------------------------------------------

/**
 * Adds a new `GroupLayer` to the sprite and optionally moves `childLayerIds` inside it.
 */
export class AddGroupLayerCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 384;
  public readonly groupLayer: GroupLayer;
  private readonly childLayerIds: string[];
  private prevLayers: Layer[] = [];

  public constructor(name = "Group 1", childLayerIds: string[] = [], parentId: string | null = null) {
    this.childLayerIds = [...childLayerIds];
    this.label = childLayerIds.length > 0 ? "Group Selected Layers" : `New Group (${name})`;
    this.groupLayer = {
      id: createModelId("group"),
      kind: "group",
      name,
      parentId,
      visible: true,
      editable: true,
      lockMove: false,
      background: false,
      preferLinkedCels: false,
      collapsed: false,
      reference: false,
      blendMode: "normal",
      opacity: 255,
      children: [...childLayerIds],
      userData: { text: "" },
    };
  }

  public do(sprite: Sprite): void {
    this.prevLayers = sprite.layers.map(cloneLayer);
    sprite.layers.push(cloneLayer(this.groupLayer));
    for (const childId of this.childLayerIds) {
      const child = sprite.layers.find((l) => l.id === childId);
      if (child && child.id !== this.groupLayer.id) {
        child.parentId = this.groupLayer.id;
      }
    }
    rebuildGroupChildrenArrays(sprite);
  }

  public undo(sprite: Sprite): void {
    sprite.layers = this.prevLayers.map(cloneLayer);
    rebuildGroupChildrenArrays(sprite);
  }
}

/**
 * Ungroups a `GroupLayer`, moving its children to its parent and removing the group container.
 */
export class UngroupLayerCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Ungroup Layer";
  public readonly timestamp = Date.now();
  public readonly byteSize = 384;
  private readonly groupId: string;
  private prevLayers: Layer[] = [];

  public constructor(groupId: string) {
    this.groupId = groupId;
  }

  public do(sprite: Sprite): void {
    const group = sprite.layers.find((l) => l.id === this.groupId && l.kind === "group");
    if (!group) return;
    this.prevLayers = sprite.layers.map(cloneLayer);
    for (const l of sprite.layers) {
      if (l.parentId === this.groupId) {
        l.parentId = group.parentId;
      }
    }
    sprite.layers = sprite.layers.filter((l) => l.id !== this.groupId);
    rebuildGroupChildrenArrays(sprite);
  }

  public undo(sprite: Sprite): void {
    if (this.prevLayers.length === 0) return;
    sprite.layers = this.prevLayers.map(cloneLayer);
    rebuildGroupChildrenArrays(sprite);
  }
}

/**
 * Reorders a layer in `sprite.layers` and optionally reparents it into a `GroupLayer`.
 */
export class ReparentAndMoveLayerCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Move / Regroup Layer";
  public readonly timestamp = Date.now();
  public readonly byteSize = 256;
  private readonly layerId: string;
  private readonly toIndex: number;
  private readonly newParentId: string | null;
  private prevLayers: Layer[] = [];

  public constructor(layerId: string, toIndex: number, newParentId: string | null) {
    this.layerId = layerId;
    this.toIndex = toIndex;
    this.newParentId = newParentId;
  }

  public do(sprite: Sprite): void {
    this.prevLayers = sprite.layers.map(cloneLayer);
    const fromIdx = sprite.layers.findIndex((l) => l.id === this.layerId);
    if (fromIdx < 0) return;

    // Prevent parenting a group into itself or its own descendant
    let checkId: string | null = this.newParentId;
    while (checkId) {
      if (checkId === this.layerId) return;
      const p = sprite.layers.find((l) => l.id === checkId);
      checkId = p ? p.parentId : null;
    }

    const [moved] = sprite.layers.splice(fromIdx, 1);
    moved.parentId = this.newParentId;
    const clampedTo = clamp(this.toIndex, 0, sprite.layers.length);
    sprite.layers.splice(clampedTo, 0, moved);
    rebuildGroupChildrenArrays(sprite);
  }

  public undo(sprite: Sprite): void {
    if (this.prevLayers.length === 0) return;
    sprite.layers = this.prevLayers.map(cloneLayer);
    rebuildGroupChildrenArrays(sprite);
  }
}

// ---------------------------------------------------------------------------
// 3. New Tilemap Layer & New Reference Layer Commands
// ---------------------------------------------------------------------------

/**
 * Creates a new `TilemapLayer` (and optionally adds a new `Tileset` to `sprite.tilesets`),
 * initializing `TilemapCelData` on every frame.
 */
export class AddTilemapLayerCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 1024;
  public readonly layer: TilemapLayer;
  public readonly createdTileset: Tileset | null;
  private createdCels: Cel[] = [];

  public constructor(options: {
    name?: string;
    tileset?: Tileset;
    existingTilesetId?: string;
    parentId?: string | null;
  } = {}) {
    const ts =
      options.tileset ??
      (options.existingTilesetId ? null : createDefaultTileset({ name: "Tileset 1" }));
    this.createdTileset = ts;
    const tilesetId = options.existingTilesetId ?? ts?.id ?? "";
    const name = options.name ?? "Tilemap 1";
    this.label = `New Tilemap Layer (${name})`;
    this.layer = {
      id: createModelId("layer_tm"),
      kind: "tilemap",
      name,
      parentId: options.parentId ?? null,
      visible: true,
      editable: true,
      lockMove: false,
      background: false,
      preferLinkedCels: false,
      collapsed: false,
      reference: false,
      blendMode: "normal",
      opacity: 255,
      tilesetId,
      userData: { text: "" },
    };
  }

  public do(sprite: Sprite): void {
    if (this.createdTileset && !sprite.tilesets.some((t) => t.id === this.createdTileset!.id)) {
      sprite.tilesets.push(cloneTileset(this.createdTileset));
    }
    const ts =
      sprite.tilesets.find((t) => t.id === this.layer.tilesetId) ?? sprite.tilesets[0];
    const tw = ts?.tileWidth ?? 16;
    const th = ts?.tileHeight ?? 16;
    const cols = Math.max(1, Math.ceil(sprite.width / tw));
    const rows = Math.max(1, Math.ceil(sprite.height / th));

    sprite.layers.push(cloneLayer(this.layer));
    if (this.createdCels.length === 0) {
      this.createdCels = sprite.frames.map((f) => ({
        id: createModelId("cel"),
        layerId: this.layer.id,
        frameIndex: f.index,
        x: 0,
        y: 0,
        opacity: 255,
        zIndex: 0,
        image: new PixelImage(sprite.width, sprite.height, sprite.colorMode),
        tilemapData: {
          width: cols,
          height: rows,
          tiles: new Uint32Array(cols * rows),
        },
        userData: { text: "" },
      }));
    }
    sprite.cels.push(...this.createdCels.map(cloneCel));
    rebuildGroupChildrenArrays(sprite);
  }

  public undo(sprite: Sprite): void {
    sprite.layers = sprite.layers.filter((l) => l.id !== this.layer.id);
    sprite.cels = sprite.cels.filter((c) => c.layerId !== this.layer.id);
    if (this.createdTileset) {
      sprite.tilesets = sprite.tilesets.filter((t) => t.id !== this.createdTileset!.id);
    }
    rebuildGroupChildrenArrays(sprite);
  }
}

/**
 * Adds a Reference Layer (`reference: true`) with an optional guide underlay image.
 */
export class AddReferenceLayerCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "New Reference Layer";
  public readonly timestamp = Date.now();
  public readonly byteSize = 1024;
  public readonly layer: ImageLayer;
  private readonly guideImage?: PixelImage;
  private createdCels: Cel[] = [];

  public constructor(name = "Reference Guide", guideImage?: PixelImage) {
    this.guideImage = guideImage ? guideImage.clone() : undefined;
    this.layer = {
      id: createModelId("layer_ref"),
      kind: "image",
      name,
      parentId: null,
      visible: true,
      editable: true,
      lockMove: false,
      background: false,
      preferLinkedCels: true,
      collapsed: false,
      reference: true,
      blendMode: "normal",
      opacity: 140,
      userData: { text: "Reference underlay (excluded from exports)", color: "#a855f7" },
    };
  }

  public do(sprite: Sprite): void {
    sprite.layers.push(cloneLayer(this.layer));
    if (this.createdCels.length === 0) {
      const sharedLinkId = createModelId("link_ref");
      const baseImg =
        this.guideImage ?? new PixelImage(sprite.width, sprite.height, sprite.colorMode);
      if (!this.guideImage) {
        // Draw subtle golden-ratio / crosshair reference grid so the user immediately sees the guide
        const guideColor: RGBA = { r: 168, g: 85, b: 247, a: 180 };
        const cx = Math.floor(sprite.width / 2);
        const cy = Math.floor(sprite.height / 2);
        for (let x = 0; x < sprite.width; x += 2) baseImg.setRGBA(x, cy, guideColor);
        for (let y = 0; y < sprite.height; y += 2) baseImg.setRGBA(cx, y, guideColor);
      }
      this.createdCels = sprite.frames.map((f) => ({
        id: createModelId("cel"),
        layerId: this.layer.id,
        frameIndex: f.index,
        x: 0,
        y: 0,
        opacity: 255,
        zIndex: 0,
        linkId: sharedLinkId,
        image: baseImg,
        userData: { text: "" },
      }));
    }
    sprite.cels.push(...this.createdCels);
  }

  public undo(sprite: Sprite): void {
    sprite.layers = sprite.layers.filter((l) => l.id !== this.layer.id);
    sprite.cels = sprite.cels.filter((c) => c.layerId !== this.layer.id);
  }
}

// ---------------------------------------------------------------------------
// 4. Duplicate, Merge Down, Flatten & Convert Layer Commands
// ---------------------------------------------------------------------------

/**
 * Duplicates a Layer and all of its Cels across frames (preserving linked cel groups).
 */
export class DuplicateLayerCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Duplicate Layer";
  public readonly timestamp = Date.now();
  public readonly byteSize = 2048;
  private readonly sourceLayerId: string;
  public duplicatedLayerId = "";
  private prevLayers: Layer[] = [];
  private prevCels: Cel[] = [];

  public constructor(sourceLayerId: string) {
    this.sourceLayerId = sourceLayerId;
  }

  public do(sprite: Sprite): void {
    const srcIdx = sprite.layers.findIndex((l) => l.id === this.sourceLayerId);
    if (srcIdx < 0) return;
    this.prevLayers = sprite.layers.map(cloneLayer);
    this.prevCels = sprite.cels.map(cloneCel);

    const srcLayer = sprite.layers[srcIdx];
    const newId = this.duplicatedLayerId || createModelId("layer_dup");
    this.duplicatedLayerId = newId;

    const dupLayer: Layer = {
      ...cloneLayer(srcLayer),
      id: newId,
      name: `${srcLayer.name} Copy`,
      background: false,
    };
    sprite.layers.splice(srcIdx + 1, 0, dupLayer);

    // Clone cels while remapping linkId groups
    const linkMap = new Map<string, { newLinkId: string; sharedImg: PixelImage }>();
    const srcCels = sprite.cels.filter((c) => c.layerId === this.sourceLayerId);
    for (const c of srcCels) {
      let nextLinkId: string | undefined;
      let nextImg: PixelImage;
      if (c.linkId) {
        if (!linkMap.has(c.linkId)) {
          linkMap.set(c.linkId, {
            newLinkId: createModelId("link"),
            sharedImg: c.image.clone(),
          });
        }
        const entry = linkMap.get(c.linkId)!;
        nextLinkId = entry.newLinkId;
        nextImg = entry.sharedImg;
      } else {
        nextImg = c.image.clone();
      }
      sprite.cels.push({
        ...cloneCel(c),
        id: createModelId("cel"),
        layerId: newId,
        linkId: nextLinkId,
        image: nextImg,
      });
    }
    rebuildGroupChildrenArrays(sprite);
  }

  public undo(sprite: Sprite): void {
    sprite.layers = this.prevLayers.map(cloneLayer);
    sprite.cels = this.prevCels.map(cloneCel);
    rebuildGroupChildrenArrays(sprite);
  }
}

/**
 * Merges `layerId` down into the layer immediately below it in stack order across all frames.
 */
export class MergeDownLayerCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Merge Down";
  public readonly timestamp = Date.now();
  public readonly byteSize = 4096;
  private readonly layerId: string;
  public targetLowerLayerId = "";
  private prevLayers: Layer[] = [];
  private prevCels: Cel[] = [];

  public constructor(layerId: string) {
    this.layerId = layerId;
  }

  public do(sprite: Sprite): void {
    const upperIdx = sprite.layers.findIndex((l) => l.id === this.layerId);
    if (upperIdx <= 0) return;
    const upperLayer = sprite.layers[upperIdx];
    const lowerLayer = sprite.layers[upperIdx - 1];
    if (upperLayer.kind === "group" || lowerLayer.kind === "group") return;

    this.prevLayers = sprite.layers.map(cloneLayer);
    this.prevCels = sprite.cels.map(cloneCel);
    this.targetLowerLayerId = lowerLayer.id;

    for (const frame of sprite.frames) {
      const upperCel = getCel(sprite, upperLayer.id, frame.index);
      let lowerCel = getCel(sprite, lowerLayer.id, frame.index);
      if (!upperCel) continue;

      if (!lowerCel) {
        lowerCel = {
          id: createModelId("cel"),
          layerId: lowerLayer.id,
          frameIndex: frame.index,
          x: 0,
          y: 0,
          opacity: 255,
          zIndex: 0,
          image: new PixelImage(sprite.width, sprite.height, sprite.colorMode),
          userData: { text: "" },
        };
        sprite.cels.push(lowerCel);
      } else {
        // Unlink lower cel before mutating so we don't double-composite linked frames
        lowerCel.linkId = undefined;
        lowerCel.image = lowerCel.image.clone();
      }

      const palette = getPaletteForFrame(sprite, frame.index);
      const upperImg =
        upperLayer.kind === "tilemap" && upperCel.tilemapData
          ? renderTilemapCel(
              upperCel,
              upperLayer as TilemapLayer,
              sprite.tilesets,
              sprite.width,
              sprite.height,
              palette,
              sprite.transparentIndex
            )
          : upperCel.image;

      const effOpacity = Math.round((upperLayer.opacity * upperCel.opacity) / 255);
      lowerCel.image.blit(
        upperImg,
        upperCel.x - lowerCel.x,
        upperCel.y - lowerCel.y,
        upperLayer.blendMode,
        effOpacity,
        palette,
        sprite.transparentIndex
      );
    }

    sprite.layers.splice(upperIdx, 1);
    sprite.cels = sprite.cels.filter((c) => c.layerId !== upperLayer.id);
    rebuildGroupChildrenArrays(sprite);
  }

  public undo(sprite: Sprite): void {
    if (this.prevLayers.length === 0) return;
    sprite.layers = this.prevLayers.map(cloneLayer);
    sprite.cels = this.prevCels.map(cloneCel);
    rebuildGroupChildrenArrays(sprite);
  }
}

/**
 * Flattens all layers (or only visible layers when `visibleOnly = true`) into a single ImageLayer.
 */
export class FlattenLayersCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 8192;
  private readonly visibleOnly: boolean;
  public flattenedLayerId = "";
  private prevLayers: Layer[] = [];
  private prevCels: Cel[] = [];

  public constructor(visibleOnly = false) {
    this.visibleOnly = visibleOnly;
    this.label = visibleOnly ? "Flatten Visible Layers" : "Flatten Layers";
  }

  public do(sprite: Sprite): void {
    this.prevLayers = sprite.layers.map(cloneLayer);
    this.prevCels = sprite.cels.map(cloneCel);

    const flatId = this.flattenedLayerId || createModelId("layer_flat");
    this.flattenedLayerId = flatId;

    // Temporarily force all layers visible if visibleOnly === false
    if (!this.visibleOnly) {
      for (const l of sprite.layers) l.visible = true;
    }

    const flatCels: Cel[] = sprite.frames.map((frame) => {
      const comp = compositeFrameAdvanced(sprite, frame.index);
      let finalImg = comp;
      if (sprite.colorMode !== "rgba") {
        finalImg = new PixelImage(sprite.width, sprite.height, sprite.colorMode);
        const pal = getPaletteForFrame(sprite, frame.index);
        for (let y = 0; y < sprite.height; y++) {
          for (let x = 0; x < sprite.width; x++) {
            finalImg.setRGBA(x, y, comp.getRGBA(x, y), pal, sprite.transparentIndex);
          }
        }
      }
      return {
        id: createModelId("cel"),
        layerId: flatId,
        frameIndex: frame.index,
        x: 0,
        y: 0,
        opacity: 255,
        zIndex: 0,
        image: finalImg,
        userData: { text: "" },
      };
    });

    const flatLayer: ImageLayer = {
      id: flatId,
      kind: "image",
      name: "Flattened",
      parentId: null,
      visible: true,
      editable: true,
      lockMove: false,
      background: false,
      preferLinkedCels: false,
      collapsed: false,
      reference: false,
      blendMode: "normal",
      opacity: 255,
      userData: { text: "" },
    };

    if (this.visibleOnly) {
      const hiddenLayers = this.prevLayers
        .filter((l) => !l.visible)
        .map(cloneLayer);
      const hiddenLayerIds = new Set(hiddenLayers.map((l) => l.id));
      const hiddenCels = this.prevCels
        .filter((c) => hiddenLayerIds.has(c.layerId))
        .map(cloneCel);
      sprite.layers = [...hiddenLayers, flatLayer];
      sprite.cels = [...hiddenCels, ...flatCels];
    } else {
      sprite.layers = [flatLayer];
      sprite.cels = flatCels;
    }
    rebuildGroupChildrenArrays(sprite);
  }

  public undo(sprite: Sprite): void {
    if (this.prevLayers.length === 0) return;
    sprite.layers = this.prevLayers.map(cloneLayer);
    sprite.cels = this.prevCels.map(cloneCel);
    rebuildGroupChildrenArrays(sprite);
  }
}

/**
 * Converts a layer to/from `Background` or converts between `ImageLayer` and `TilemapLayer`.
 */
export class ConvertLayerCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 4096;
  private readonly layerId: string;
  private readonly targetType: "background" | "image" | "tilemap";
  private readonly bgColor: RGBA;
  private readonly tileWidth: number;
  private readonly tileHeight: number;
  private prevLayers: Layer[] = [];
  private prevCels: Cel[] = [];
  private prevTilesets: Tileset[] = [];

  public constructor(
    layerId: string,
    targetType: "background" | "image" | "tilemap",
    options: { bgColor?: RGBA; tileWidth?: number; tileHeight?: number } = {}
  ) {
    this.layerId = layerId;
    this.targetType = targetType;
    this.bgColor = options.bgColor ?? { r: 255, g: 255, b: 255, a: 255 };
    this.tileWidth = options.tileWidth ?? 16;
    this.tileHeight = options.tileHeight ?? 16;
    this.label =
      targetType === "background"
        ? "Convert to Background"
        : targetType === "tilemap"
        ? "Convert to Tilemap Layer"
        : "Convert to Regular Layer";
  }

  public do(sprite: Sprite): void {
    const idx = sprite.layers.findIndex((l) => l.id === this.layerId);
    if (idx < 0) return;
    const layer = sprite.layers[idx];
    if (layer.kind === "group") return;

    this.prevLayers = sprite.layers.map(cloneLayer);
    this.prevCels = sprite.cels.map(cloneCel);
    this.prevTilesets = sprite.tilesets.map(cloneTileset);

    if (this.targetType === "background") {
      layer.background = true;
      layer.lockMove = true;
      layer.name = "Background";
      layer.blendMode = "normal";
      layer.opacity = 255;
      // Move background layer to bottom of stack (index 0)
      sprite.layers.splice(idx, 1);
      sprite.layers.unshift(layer);
      // Fill transparent pixels with bgColor
      const pal = getPaletteForFrame(sprite, 0);
      for (const cel of sprite.cels) {
        if (cel.layerId !== layer.id) continue;
        cel.image = cel.image.clone();
        for (let y = 0; y < cel.image.height; y++) {
          for (let x = 0; x < cel.image.width; x++) {
            const px = cel.image.getRGBA(x, y, pal, sprite.transparentIndex);
            if (px.a === 0) {
              cel.image.setRGBA(x, y, { ...this.bgColor, a: 255 }, pal, sprite.transparentIndex);
            }
          }
        }
      }
      return;
    }

    if (this.targetType === "image") {
      if (layer.kind === "tilemap") {
        const tmLayer = layer as TilemapLayer;
        const pal = getPaletteForFrame(sprite, 0);
        for (const cel of sprite.cels) {
          if (cel.layerId !== layer.id) continue;
          cel.image = renderTilemapCel(
            cel,
            tmLayer,
            sprite.tilesets,
            sprite.width,
            sprite.height,
            pal,
            sprite.transparentIndex
          );
          cel.tilemapData = undefined;
        }
      }
      const imgLayer: ImageLayer = {
        id: layer.id,
        kind: "image",
        name: layer.background ? "Layer 1" : layer.name,
        parentId: layer.parentId,
        visible: layer.visible,
        editable: layer.editable,
        lockMove: false,
        background: false,
        preferLinkedCels: layer.preferLinkedCels,
        collapsed: false,
        reference: layer.reference,
        blendMode: layer.blendMode,
        opacity: layer.opacity,
        userData: { ...layer.userData },
      };
      sprite.layers[idx] = imgLayer;
      return;
    }

    // targetType === "tilemap": Automatic tile deduplication across cels
    const firstCel = getCel(sprite, layer.id, 0);
    const extracted = extractTilesetFromImage(
      firstCel ? firstCel.image : new PixelImage(sprite.width, sprite.height, sprite.colorMode),
      this.tileWidth,
      this.tileHeight,
      `${layer.name} Tileset`,
      sprite.transparentIndex
    );
    sprite.tilesets.push(extracted.tileset);

    const tmLayer: TilemapLayer = {
      id: layer.id,
      kind: "tilemap",
      name: layer.name,
      parentId: layer.parentId,
      visible: layer.visible,
      editable: layer.editable,
      lockMove: layer.lockMove,
      background: false,
      preferLinkedCels: layer.preferLinkedCels,
      collapsed: false,
      reference: false,
      blendMode: layer.blendMode,
      opacity: layer.opacity,
      tilesetId: extracted.tileset.id,
      userData: { ...layer.userData },
    };
    sprite.layers[idx] = tmLayer;

    for (const cel of sprite.cels) {
      if (cel.layerId !== layer.id) continue;
      if (cel.frameIndex === 0) {
        cel.tilemapData = extracted.tilemapData;
      } else {
        const frameExt = extractTilesetFromImage(
          cel.image,
          this.tileWidth,
          this.tileHeight,
          extracted.tileset.name,
          sprite.transparentIndex
        );
        // Merge any new unique tiles from subsequent frames into extracted.tileset
        const remappedTiles = new Uint32Array(frameExt.tilemapData.tiles.length);
        for (let i = 0; i < frameExt.tilemapData.tiles.length; i++) {
          const tIdx = unpackTileEntry(frameExt.tilemapData.tiles[i]).tileIndex;
          if (tIdx === 0) {
            remappedTiles[i] = 0;
            continue;
          }
          const tileBitmap = frameExt.tileset.tiles[tIdx];
          let matchIdx = extracted.tileset.tiles.findIndex(
            (existing, ei) =>
              ei > 0 &&
              existing.data.length === tileBitmap.data.length &&
              existing.data.every((v, k) => v === tileBitmap.data[k])
          );
          if (matchIdx < 0) {
            matchIdx = extracted.tileset.tiles.length;
            extracted.tileset.tiles.push(tileBitmap);
          }
          remappedTiles[i] = packTileEntry(matchIdx);
        }
        cel.tilemapData = {
          width: frameExt.tilemapData.width,
          height: frameExt.tilemapData.height,
          tiles: remappedTiles,
        };
      }
    }
  }

  public undo(sprite: Sprite): void {
    sprite.layers = this.prevLayers.map(cloneLayer);
    sprite.cels = this.prevCels.map(cloneCel);
    sprite.tilesets = this.prevTilesets.map(cloneTileset);
  }
}

/**
 * Isolates (solos) a single layer by hiding all other sibling/top-level layers, or restores
 * visibility if already isolated (`Alt+Click Eye`).
 */
export class IsolateLayerCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Isolate Layer (Solo)";
  public readonly timestamp = Date.now();
  public readonly byteSize = 128;
  private readonly targetLayerId: string;
  private prevVisibility: Array<{ id: string; visible: boolean }> = [];

  public constructor(targetLayerId: string) {
    this.targetLayerId = targetLayerId;
  }

  public do(sprite: Sprite): void {
    this.prevVisibility = sprite.layers.map((l) => ({ id: l.id, visible: l.visible }));
    // Keep target layer AND its ancestor groups visible
    const keepVisible = new Set<string>([this.targetLayerId]);
    let curr = sprite.layers.find((l) => l.id === this.targetLayerId);
    while (curr?.parentId) {
      keepVisible.add(curr.parentId);
      curr = sprite.layers.find((l) => l.id === curr?.parentId);
    }
    // If target is a group, also keep its descendants visible
    const addDescendants = (parentId: string) => {
      for (const l of sprite.layers) {
        if (l.parentId === parentId) {
          keepVisible.add(l.id);
          if (l.kind === "group") addDescendants(l.id);
        }
      }
    };
    addDescendants(this.targetLayerId);

    const othersAlreadyHidden = sprite.layers
      .filter((l) => !keepVisible.has(l.id))
      .every((l) => !l.visible);

    for (const l of sprite.layers) {
      l.visible = othersAlreadyHidden ? true : keepVisible.has(l.id);
    }
  }

  public undo(sprite: Sprite): void {
    for (const item of this.prevVisibility) {
      const l = sprite.layers.find((layer) => layer.id === item.id);
      if (l) l.visible = item.visible;
    }
  }
}

/**
 * Bulk-toggles visibility (`showAll`) or editability (`lockAll`) across all layers.
 */
export class BulkLayerStateCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 128;
  private readonly field: "visible" | "editable";
  private readonly value: boolean;
  private prevStates: Array<{ id: string; val: boolean }> = [];

  public constructor(field: "visible" | "editable", value: boolean) {
    this.field = field;
    this.value = value;
    this.label =
      field === "visible"
        ? value
          ? "Show All Layers"
          : "Hide All Layers"
        : value
        ? "Unlock All Layers"
        : "Lock All Layers";
  }

  public do(sprite: Sprite): void {
    this.prevStates = sprite.layers.map((l) => ({ id: l.id, val: l[this.field] }));
    for (const l of sprite.layers) {
      l[this.field] = this.value;
    }
  }

  public undo(sprite: Sprite): void {
    for (const st of this.prevStates) {
      const l = sprite.layers.find((layer) => layer.id === st.id);
      if (l) l[this.field] = st.val;
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Frame & Cel Commands (Properties, Clear, Range Move/Copy/Link, Reverse, Bulk Duration)
// ---------------------------------------------------------------------------

export interface CelPropsPatch {
  opacity?: number;
  zIndex?: number;
  x?: number;
  y?: number;
  userData?: UserData;
}

/**
 * Updates properties (`opacity`, `zIndex`, `x`, `y`, `userData`) on one or more Cels.
 */
export class SetCelPropsCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 192;
  private readonly targets: ReadonlyArray<{ layerId: string; frameIndex: number }>;
  private readonly patch: CelPropsPatch;
  private prevStates: Array<{
    layerId: string;
    frameIndex: number;
    opacity: number;
    zIndex: number;
    x: number;
    y: number;
    userData: UserData;
  }> = [];

  public constructor(
    targets: ReadonlyArray<{ layerId: string; frameIndex: number }>,
    patch: CelPropsPatch,
    label = "Cel Properties"
  ) {
    this.targets = targets;
    this.patch = patch;
    this.label = label;
  }

  public do(sprite: Sprite): void {
    this.prevStates = [];
    for (const t of this.targets) {
      const cel = getCel(sprite, t.layerId, t.frameIndex);
      if (!cel) continue;
      this.prevStates.push({
        layerId: t.layerId,
        frameIndex: t.frameIndex,
        opacity: cel.opacity,
        zIndex: cel.zIndex,
        x: cel.x,
        y: cel.y,
        userData: { ...cel.userData },
      });
      if (this.patch.opacity !== undefined) {
        cel.opacity = clamp(Math.round(this.patch.opacity), 0, 255);
      }
      if (this.patch.zIndex !== undefined) {
        cel.zIndex = clamp(Math.round(this.patch.zIndex), -64, 64);
      }
      if (this.patch.x !== undefined) cel.x = Math.round(this.patch.x);
      if (this.patch.y !== undefined) cel.y = Math.round(this.patch.y);
      if (this.patch.userData !== undefined) {
        cel.userData = { ...this.patch.userData };
      }
    }
  }

  public undo(sprite: Sprite): void {
    for (const st of this.prevStates) {
      const cel = getCel(sprite, st.layerId, st.frameIndex);
      if (!cel) continue;
      cel.opacity = st.opacity;
      cel.zIndex = st.zIndex;
      cel.x = st.x;
      cel.y = st.y;
      cel.userData = { ...st.userData };
    }
  }
}

/**
 * Clears pixel content (and resets tilemapData to 0) on the specified `(layerId, frameIndex)` cels
 * while preserving the cel slots in the timeline (`timeline.clear_cel`).
 */
export class ClearCelsCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Clear Cel";
  public readonly timestamp = Date.now();
  public readonly byteSize = 1024;
  private readonly targets: ReadonlyArray<{ layerId: string; frameIndex: number }>;
  private prevCels: Cel[] = [];

  public constructor(targets: ReadonlyArray<{ layerId: string; frameIndex: number }>) {
    this.targets = targets;
  }

  public do(sprite: Sprite): void {
    this.prevCels = sprite.cels.map(cloneCel);
    for (const t of this.targets) {
      const cel = getCel(sprite, t.layerId, t.frameIndex);
      if (!cel) continue;
      cel.linkId = undefined;
      cel.image = new PixelImage(sprite.width, sprite.height, sprite.colorMode);
      if (cel.tilemapData) {
        cel.tilemapData = {
          width: cel.tilemapData.width,
          height: cel.tilemapData.height,
          tiles: new Uint32Array(cel.tilemapData.width * cel.tilemapData.height),
        };
      }
    }
  }

  public undo(sprite: Sprite): void {
    sprite.cels = this.prevCels.map(cloneCel);
  }
}

/**
 * Moves/Swaps (`mode = "move"`), Copies (`mode = "copy"`), or Links (`mode = "link"`) a range of cels
 * across frames and layers in the Timeline matrix.
 */
export class TransferCelRangeCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 2048;
  private readonly sourceCoords: ReadonlyArray<{ layerId: string; frameIndex: number }>;
  private readonly layerDelta: number;
  private readonly frameDelta: number;
  private readonly mode: "move" | "copy" | "link";
  private prevCels: Cel[] = [];

  public constructor(
    sourceCoords: ReadonlyArray<{ layerId: string; frameIndex: number }>,
    layerDelta: number,
    frameDelta: number,
    mode: "move" | "copy" | "link" = "move"
  ) {
    this.sourceCoords = sourceCoords;
    this.layerDelta = layerDelta;
    this.frameDelta = frameDelta;
    this.mode = mode;
    this.label =
      mode === "copy" ? "Copy Cel(s)" : mode === "link" ? "Link Cel(s)" : "Move Cel(s)";
  }

  public do(sprite: Sprite): void {
    if (this.layerDelta === 0 && this.frameDelta === 0) return;
    this.prevCels = sprite.cels.map(cloneCel);

    const snapshots = this.sourceCoords
      .map((coord) => {
        const layerIdx = sprite.layers.findIndex((l) => l.id === coord.layerId);
        const cel = getCel(sprite, coord.layerId, coord.frameIndex);
        return { coord, layerIdx, cel: cel ? cloneCel(cel) : null, origCel: cel };
      })
      .filter((item) => item.layerIdx >= 0 && item.cel !== null);

    for (const item of snapshots) {
      const dstLayerIdx = clamp(item.layerIdx + this.layerDelta, 0, sprite.layers.length - 1);
      const dstLayer = sprite.layers[dstLayerIdx];
      if (!dstLayer || dstLayer.kind === "group") continue;
      const dstFrameIdx = clamp(
        item.coord.frameIndex + this.frameDelta,
        0,
        sprite.frames.length - 1
      );
      if (dstLayer.id === item.coord.layerId && dstFrameIdx === item.coord.frameIndex) continue;

      const dstCel = getCel(sprite, dstLayer.id, dstFrameIdx);
      const srcCel = item.origCel!;

      if (this.mode === "move" && dstCel) {
        // Swap source and destination cels
        const tmpImg = dstCel.image;
        const tmpLink = dstCel.linkId;
        const tmpTm = dstCel.tilemapData;
        const tmpZ = dstCel.zIndex;
        const tmpOp = dstCel.opacity;

        dstCel.image = item.cel!.image;
        dstCel.linkId = item.cel!.linkId;
        dstCel.tilemapData = item.cel!.tilemapData;
        dstCel.zIndex = item.cel!.zIndex;
        dstCel.opacity = item.cel!.opacity;

        srcCel.image = tmpImg;
        srcCel.linkId = tmpLink;
        srcCel.tilemapData = tmpTm;
        srcCel.zIndex = tmpZ;
        srcCel.opacity = tmpOp;
      } else if (this.mode === "copy" && dstCel) {
        dstCel.linkId = undefined;
        dstCel.image = item.cel!.image.clone();
        dstCel.opacity = item.cel!.opacity;
        dstCel.zIndex = item.cel!.zIndex;
        if (item.cel!.tilemapData) {
          dstCel.tilemapData = {
            width: item.cel!.tilemapData.width,
            height: item.cel!.tilemapData.height,
            tiles: new Uint32Array(item.cel!.tilemapData.tiles),
          };
        }
      } else if (this.mode === "link" && dstCel && dstLayer.id === item.coord.layerId) {
        const sharedLinkId = srcCel.linkId ?? createModelId("link");
        srcCel.linkId = sharedLinkId;
        dstCel.linkId = sharedLinkId;
        dstCel.image = srcCel.image;
        if (srcCel.tilemapData) {
          dstCel.tilemapData = srcCel.tilemapData;
        }
      }
    }
  }

  public undo(sprite: Sprite): void {
    if (this.prevCels.length === 0) return;
    sprite.cels = this.prevCels.map(cloneCel);
  }
}

/**
 * Sets `durationMs` across a range of frames (used for Frame Properties "Apply to range" and Constant Frame Rate).
 */
export class SetFrameRangeDurationCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 128;
  private readonly frameIndices: number[];
  private readonly durationMs: number;
  private prevDurations: Array<{ index: number; durationMs: number }> = [];

  public constructor(
    frameIndices: readonly number[],
    durationMs: number,
    label = "Frame Duration"
  ) {
    this.frameIndices = [...frameIndices];
    this.durationMs = clamp(Math.round(durationMs), 10, 65535);
    this.label = label;
  }

  public do(sprite: Sprite): void {
    this.prevDurations = [];
    for (const fi of this.frameIndices) {
      const f = sprite.frames[fi];
      if (!f) continue;
      this.prevDurations.push({ index: fi, durationMs: f.durationMs });
      f.durationMs = this.durationMs;
    }
  }

  public undo(sprite: Sprite): void {
    for (const prev of this.prevDurations) {
      const f = sprite.frames[prev.index];
      if (f) f.durationMs = prev.durationMs;
    }
  }
}

/**
 * Reverses the order of frames and cels within `[fromFrame..toFrame]` (`anim.reverse_frames`).
 */
export class ReverseFramesCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Reverse Frames";
  public readonly timestamp = Date.now();
  public readonly byteSize = 512;
  private readonly fromFrame: number;
  private readonly toFrame: number;
  private prevFrames: Frame[] = [];
  private prevCels: Cel[] = [];

  public constructor(fromFrame: number, toFrame: number) {
    this.fromFrame = Math.min(fromFrame, toFrame);
    this.toFrame = Math.max(fromFrame, toFrame);
  }

  public do(sprite: Sprite): void {
    const start = clamp(this.fromFrame, 0, sprite.frames.length - 1);
    const end = clamp(this.toFrame, 0, sprite.frames.length - 1);
    if (end <= start) return;

    this.prevFrames = sprite.frames.map((f) => ({ ...f }));
    this.prevCels = sprite.cels.map(cloneCel);

    // Reverse durations in [start..end]
    const subDurations = sprite.frames
      .slice(start, end + 1)
      .map((f) => f.durationMs)
      .reverse();
    for (let i = start; i <= end; i++) {
      sprite.frames[i].durationMs = subDurations[i - start];
    }

    // Mirror frameIndex on all cels in [start..end]
    for (const cel of sprite.cels) {
      if (cel.frameIndex >= start && cel.frameIndex <= end) {
        cel.frameIndex = start + (end - cel.frameIndex);
      }
    }
  }

  public undo(sprite: Sprite): void {
    if (this.prevFrames.length === 0) return;
    sprite.frames = this.prevFrames.map((f) => ({ ...f }));
    sprite.cels = this.prevCels.map(cloneCel);
  }
}

// ---------------------------------------------------------------------------
// 6. Tag & Slice Commands
// ---------------------------------------------------------------------------

/**
 * Updates an animation Tag's properties or frame bounds (`fromFrame`, `toFrame`, `name`, `direction`, `color`, `repeat`, `userData`).
 */
export class UpdateTagCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Tag Properties";
  public readonly timestamp = Date.now();
  public readonly byteSize = 128;
  private readonly tagId: string;
  private readonly patch: Partial<Omit<Tag, "id">>;
  private prevTag: Tag | null = null;

  public constructor(tagId: string, patch: Partial<Omit<Tag, "id">>) {
    this.tagId = tagId;
    this.patch = patch;
  }

  public do(sprite: Sprite): void {
    const tag = sprite.tags.find((t) => t.id === this.tagId);
    if (!tag) return;
    this.prevTag = { ...tag, userData: { ...tag.userData } };
    const maxF = Math.max(0, sprite.frames.length - 1);

    if (this.patch.name !== undefined) tag.name = this.patch.name;
    if (this.patch.fromFrame !== undefined) {
      tag.fromFrame = clamp(Math.round(this.patch.fromFrame), 0, maxF);
    }
    if (this.patch.toFrame !== undefined) {
      tag.toFrame = clamp(Math.round(this.patch.toFrame), tag.fromFrame, maxF);
    }
    if (this.patch.direction !== undefined) tag.direction = this.patch.direction;
    if (this.patch.color !== undefined) tag.color = this.patch.color;
    if (this.patch.repeat !== undefined) {
      tag.repeat = clamp(Math.round(this.patch.repeat), 0, 9999);
    }
    if (this.patch.userData !== undefined) {
      tag.userData = { ...this.patch.userData };
    }
  }

  public undo(sprite: Sprite): void {
    if (!this.prevTag) return;
    const idx = sprite.tags.findIndex((t) => t.id === this.tagId);
    if (idx >= 0) {
      sprite.tags[idx] = { ...this.prevTag, userData: { ...this.prevTag.userData } };
    }
  }
}

/**
 * Removes an animation Tag by ID.
 */
export class RemoveTagCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Delete Tag";
  public readonly timestamp = Date.now();
  public readonly byteSize = 128;
  private readonly tagId: string;
  private removedTag: Tag | null = null;
  private removedIndex = -1;

  public constructor(tagId: string) {
    this.tagId = tagId;
  }

  public do(sprite: Sprite): void {
    this.removedIndex = sprite.tags.findIndex((t) => t.id === this.tagId);
    if (this.removedIndex < 0) return;
    this.removedTag = {
      ...sprite.tags[this.removedIndex],
      userData: { ...sprite.tags[this.removedIndex].userData },
    };
    sprite.tags.splice(this.removedIndex, 1);
  }

  public undo(sprite: Sprite): void {
    if (!this.removedTag || this.removedIndex < 0) return;
    sprite.tags.splice(this.removedIndex, 0, this.removedTag);
  }
}

/**
 * Updates a Slice (`name`, `color`, `userData`, or `keys` including 9-patch `center` and `pivot`).
 */
export class UpdateSliceCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 256;
  private readonly sliceId: string;
  private readonly patch: {
    name?: string;
    color?: string;
    userData?: UserData;
    keys?: SliceKey[];
  };
  private prevSlice: Slice | null = null;

  public constructor(
    sliceId: string,
    patch: {
      name?: string;
      color?: string;
      userData?: UserData;
      keys?: SliceKey[];
    },
    label = "Edit Slice"
  ) {
    this.sliceId = sliceId;
    this.patch = patch;
    this.label = label;
  }

  public do(sprite: Sprite): void {
    const s = sprite.slices.find((item) => item.id === this.sliceId);
    if (!s) return;
    this.prevSlice = {
      ...s,
      keys: s.keys.map(cloneSliceKey),
      userData: { ...s.userData },
    };
    if (this.patch.name !== undefined) s.name = this.patch.name;
    if (this.patch.color !== undefined) s.color = this.patch.color;
    if (this.patch.userData !== undefined) s.userData = { ...this.patch.userData };
    if (this.patch.keys !== undefined) {
      s.keys = this.patch.keys.map(cloneSliceKey);
    }
  }

  public undo(sprite: Sprite): void {
    if (!this.prevSlice) return;
    const idx = sprite.slices.findIndex((item) => item.id === this.sliceId);
    if (idx >= 0) {
      sprite.slices[idx] = {
        ...this.prevSlice,
        keys: this.prevSlice.keys.map(cloneSliceKey),
        userData: { ...this.prevSlice.userData },
      };
    }
  }
}

/**
 * Removes a Slice by ID.
 */
export class RemoveSliceCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Delete Slice";
  public readonly timestamp = Date.now();
  public readonly byteSize = 192;
  private readonly sliceId: string;
  private removedSlice: Slice | null = null;
  private removedIndex = -1;

  public constructor(sliceId: string) {
    this.sliceId = sliceId;
  }

  public do(sprite: Sprite): void {
    this.removedIndex = sprite.slices.findIndex((s) => s.id === this.sliceId);
    if (this.removedIndex < 0) return;
    const s = sprite.slices[this.removedIndex];
    this.removedSlice = {
      ...s,
      keys: s.keys.map(cloneSliceKey),
      userData: { ...s.userData },
    };
    sprite.slices.splice(this.removedIndex, 1);
  }

  public undo(sprite: Sprite): void {
    if (!this.removedSlice || this.removedIndex < 0) return;
    sprite.slices.splice(this.removedIndex, 0, this.removedSlice);
  }
}

// ---------------------------------------------------------------------------
// 7. Tilemap & Tileset Undoable Commands
// ---------------------------------------------------------------------------

/**
 * Records an undoable edit to a Tilemap cel (`tilemapData.tiles`) and/or its `Tileset`
 * (used for both Tiles Mode placement and Pixels Mode Auto/Stack/Manual synchronization).
 */
export class TilemapEditCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize: number;
  private readonly layerId: string;
  private readonly frameIndex: number;
  private readonly tilesetId: string;
  private readonly beforeTiles: Uint32Array;
  private readonly afterTiles: Uint32Array;
  private readonly beforeTileset: Tileset | null;
  private readonly afterTileset: Tileset | null;

  public constructor(options: {
    label: string;
    layerId: string;
    frameIndex: number;
    tilesetId: string;
    beforeTiles: Uint32Array;
    afterTiles: Uint32Array;
    beforeTileset?: Tileset | null;
    afterTileset?: Tileset | null;
  }) {
    this.label = options.label;
    this.layerId = options.layerId;
    this.frameIndex = options.frameIndex;
    this.tilesetId = options.tilesetId;
    this.beforeTiles = new Uint32Array(options.beforeTiles);
    this.afterTiles = new Uint32Array(options.afterTiles);
    this.beforeTileset = options.beforeTileset ? cloneTileset(options.beforeTileset) : null;
    this.afterTileset = options.afterTileset ? cloneTileset(options.afterTileset) : null;
    this.byteSize =
      this.beforeTiles.byteLength +
      this.afterTiles.byteLength +
      (this.afterTileset ? this.afterTileset.tiles.length * 256 : 0) +
      128;
  }

  public do(sprite: Sprite): void {
    if (this.afterTileset) {
      const tsIdx = sprite.tilesets.findIndex((ts) => ts.id === this.tilesetId);
      if (tsIdx >= 0) {
        sprite.tilesets[tsIdx] = cloneTileset(this.afterTileset);
      }
    }
    const cel = getCel(sprite, this.layerId, this.frameIndex);
    const layer = sprite.layers.find((l) => l.id === this.layerId);
    if (cel && cel.tilemapData && layer && layer.kind === "tilemap") {
      cel.tilemapData.tiles.set(this.afterTiles);
      const pal = getPaletteForFrame(sprite, this.frameIndex);
      cel.image = renderTilemapCel(
        cel,
        layer as TilemapLayer,
        sprite.tilesets,
        sprite.width,
        sprite.height,
        pal,
        sprite.transparentIndex
      );
    }
  }

  public undo(sprite: Sprite): void {
    if (this.beforeTileset) {
      const tsIdx = sprite.tilesets.findIndex((ts) => ts.id === this.tilesetId);
      if (tsIdx >= 0) {
        sprite.tilesets[tsIdx] = cloneTileset(this.beforeTileset);
      }
    }
    const cel = getCel(sprite, this.layerId, this.frameIndex);
    const layer = sprite.layers.find((l) => l.id === this.layerId);
    if (cel && cel.tilemapData && layer && layer.kind === "tilemap") {
      cel.tilemapData.tiles.set(this.beforeTiles);
      const pal = getPaletteForFrame(sprite, this.frameIndex);
      cel.image = renderTilemapCel(
        cel,
        layer as TilemapLayer,
        sprite.tilesets,
        sprite.width,
        sprite.height,
        pal,
        sprite.transparentIndex
      );
    }
  }
}

/**
 * Updates a `Tileset` (properties, adding/duplicating/removing/reordering tiles, editing a tile's pixels,
 * or purging unused tiles) and re-renders all `TilemapLayer` cels that reference it.
 */
export class UpdateTilesetCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 2048;
  private readonly tilesetId: string;
  private readonly mutator: (sprite: Sprite, tileset: Tileset) => void;
  private prevTileset: Tileset | null = null;
  private prevCelTilemaps: Array<{ celId: string; tiles: Uint32Array }> = [];

  public constructor(
    tilesetId: string,
    label: string,
    mutator: (sprite: Sprite, tileset: Tileset) => void
  ) {
    this.tilesetId = tilesetId;
    this.label = label;
    this.mutator = mutator;
  }

  public do(sprite: Sprite): void {
    const ts = sprite.tilesets.find((t) => t.id === this.tilesetId);
    if (!ts) return;
    this.prevTileset = cloneTileset(ts);
    this.prevCelTilemaps = sprite.cels
      .filter((c) => Boolean(c.tilemapData))
      .map((c) => ({
        celId: c.id,
        tiles: new Uint32Array(c.tilemapData!.tiles),
      }));

    this.mutator(sprite, ts);
    this.refreshTilemapCels(sprite);
  }

  public undo(sprite: Sprite): void {
    if (!this.prevTileset) return;
    const tsIdx = sprite.tilesets.findIndex((t) => t.id === this.tilesetId);
    if (tsIdx >= 0) {
      sprite.tilesets[tsIdx] = cloneTileset(this.prevTileset);
    }
    for (const saved of this.prevCelTilemaps) {
      const cel = sprite.cels.find((c) => c.id === saved.celId);
      if (cel && cel.tilemapData) {
        cel.tilemapData.tiles = new Uint32Array(saved.tiles);
      }
    }
    this.refreshTilemapCels(sprite);
  }

  private refreshTilemapCels(sprite: Sprite): void {
    for (const layer of sprite.layers) {
      if (layer.kind !== "tilemap" || layer.tilesetId !== this.tilesetId) continue;
      for (const cel of sprite.cels) {
        if (cel.layerId !== layer.id || !cel.tilemapData) continue;
        const pal = getPaletteForFrame(sprite, cel.frameIndex);
        cel.image = renderTilemapCel(
          cel,
          layer,
          sprite.tilesets,
          sprite.width,
          sprite.height,
          pal,
          sprite.transparentIndex
        );
      }
    }
  }
}

/**
 * Helper to create an undoable command that purges unused tiles from `tilesetId`.
 */
export function createPurgeUnusedTilesCommand(tilesetId: string): UpdateTilesetCommand {
  return new UpdateTilesetCommand(tilesetId, "Purge Unused Tiles", (sprite) => {
    purgeUnusedTilesInSprite(sprite, tilesetId);
  });
}
