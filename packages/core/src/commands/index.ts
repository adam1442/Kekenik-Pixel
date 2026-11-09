/**
 * @module @kekenik/core/commands
 * Command pattern, transactional model edits, region-patch pixel undo, and non-linear branching History.
 */

import { EventBus } from "../events/index.ts";
import {
  Cel,
  ColorMode,
  createModelId,
  Frame,
  getCel,
  getPaletteForFrame,
  ImageLayer,
  ImagePatch,
  Layer,
  Mask,
  PixelImage,
  ReadonlySprite,
  Slice,
  Sprite,
  Tag,
} from "../model/index.ts";
import { clamp, Rect, RGBA, unionRect } from "../util/index.ts";

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly timestamp: number;
  readonly byteSize: number;
  do(sprite: Sprite): void;
  undo(sprite: Sprite): void;
  mergeWith?(next: Command): Command | null;
}

export interface HistoryNode {
  readonly id: string;
  readonly command: Command | null; // null for root node
  readonly parentId: string | null;
  readonly childrenIds: string[];
  activeChildIndex: number;
  readonly timestamp: number;
  readonly branchIndex: number;
}

export interface HistoryEvents extends Record<string, unknown> {
  changed: { currentNodeId: string; canUndo: boolean; canRedo: boolean };
}

/**
 * Non-linear (branching) Undo/Redo History manager with memory budget pruning.
 * Matches Aseprite's Undo History behavior where undoing and performing a new action
 * creates a new branch while preserving previous branches for inspection or jumping.
 */
export class History {
  public readonly events = new EventBus<HistoryEvents>();
  private readonly nodes = new Map<string, HistoryNode>();
  private rootId: string;
  private currentId: string;
  private maxBytes: number;
  private totalBytes = 0;
  private branchCounter = 0;

  public constructor(maxBytes = 64 * 1024 * 1024) {
    this.maxBytes = Math.max(1024, maxBytes);
    const root: HistoryNode = {
      id: "root",
      command: null,
      parentId: null,
      childrenIds: [],
      activeChildIndex: -1,
      timestamp: Date.now(),
      branchIndex: 0,
    };
    this.rootId = root.id;
    this.currentId = root.id;
    this.nodes.set(root.id, root);
  }

  /**
   * Executes a command on `sprite` and records it in the history tree.
   */
  public execute(sprite: Sprite, command: Command, allowMerge = false): HistoryNode {
    command.do(sprite);

    const current = this.nodes.get(this.currentId)!;
    if (allowMerge && current.command && current.command.mergeWith && current.childrenIds.length === 0) {
      const merged = current.command.mergeWith(command);
      if (merged) {
        this.totalBytes -= current.command.byteSize;
        this.totalBytes += merged.byteSize;
        const updatedNode: HistoryNode = {
          ...current,
          command: merged,
          timestamp: merged.timestamp,
        };
        this.nodes.set(current.id, updatedNode);
        this.enforceMemoryBudget();
        this.emitChanged();
        return updatedNode;
      }
    }

    const isNewBranch = current.childrenIds.length > 0;
    if (isNewBranch) {
      this.branchCounter += 1;
    }
    const node: HistoryNode = {
      id: createModelId("hist"),
      command,
      parentId: current.id,
      childrenIds: [],
      activeChildIndex: -1,
      timestamp: command.timestamp,
      branchIndex: isNewBranch ? this.branchCounter : current.branchIndex,
    };

    current.childrenIds.push(node.id);
    current.activeChildIndex = current.childrenIds.length - 1;
    this.nodes.set(node.id, node);
    this.currentId = node.id;
    this.totalBytes += command.byteSize;

    this.enforceMemoryBudget();
    this.emitChanged();
    return node;
  }

  /**
   * Returns true if undo is available from the current state.
   */
  public get canUndo(): boolean {
    const curr = this.nodes.get(this.currentId);
    return Boolean(curr && curr.parentId !== null);
  }

  /**
   * Returns true if redo is available along the active child branch.
   */
  public get canRedo(): boolean {
    const curr = this.nodes.get(this.currentId);
    return Boolean(curr && curr.activeChildIndex >= 0 && curr.childrenIds[curr.activeChildIndex]);
  }

  /**
   * Undoes the current command node and moves to its parent.
   */
  public undo(sprite: Sprite): boolean {
    const curr = this.nodes.get(this.currentId);
    if (!curr || !curr.parentId || !curr.command) return false;
    curr.command.undo(sprite);
    this.currentId = curr.parentId;
    this.emitChanged();
    return true;
  }

  /**
   * Redoes the active child command node from the current state.
   */
  public redo(sprite: Sprite): boolean {
    const curr = this.nodes.get(this.currentId);
    if (!curr || curr.activeChildIndex < 0) return false;
    const nextId = curr.childrenIds[curr.activeChildIndex];
    const next = nextId ? this.nodes.get(nextId) : undefined;
    if (!next || !next.command) return false;
    next.command.do(sprite);
    this.currentId = next.id;
    this.emitChanged();
    return true;
  }

  /**
   * Jumps to ANY node in the non-linear history tree by finding the lowest common ancestor
   * and undoing up to LCA then redoing down to the target node.
   */
  public jumpToNode(sprite: Sprite, targetNodeId: string): boolean {
    if (!this.nodes.has(targetNodeId)) return false;
    if (this.currentId === targetNodeId) return true;

    const currentPath = this.getPathFromRoot(this.currentId);
    const targetPath = this.getPathFromRoot(targetNodeId);

    let lcaIndex = 0;
    while (
      lcaIndex < currentPath.length &&
      lcaIndex < targetPath.length &&
      currentPath[lcaIndex] === targetPath[lcaIndex]
    ) {
      lcaIndex += 1;
    }
    lcaIndex -= 1;

    // Undo from current down to LCA
    for (let i = currentPath.length - 1; i > lcaIndex; i--) {
      const node = this.nodes.get(currentPath[i])!;
      node.command?.undo(sprite);
    }

    // Redo from LCA to target
    for (let i = lcaIndex + 1; i < targetPath.length; i++) {
      const parent = this.nodes.get(targetPath[i - 1])!;
      const childId = targetPath[i];
      const childIdx = parent.childrenIds.indexOf(childId);
      if (childIdx >= 0) {
        parent.activeChildIndex = childIdx;
      }
      const child = this.nodes.get(childId)!;
      child.command?.do(sprite);
    }

    this.currentId = targetNodeId;
    this.emitChanged();
    return true;
  }

  /**
   * Returns all history nodes in topological order for the Undo History panel.
   */
  public getAllNodes(): HistoryNode[] {
    const result: HistoryNode[] = [];
    const visit = (id: string) => {
      const n = this.nodes.get(id);
      if (!n) return;
      result.push(n);
      for (const childId of n.childrenIds) {
        visit(childId);
      }
    };
    visit(this.rootId);
    return result;
  }

  /**
   * Returns the current active node ID.
   */
  public get currentNodeId(): string {
    return this.currentId;
  }

  /**
   * Returns total bytes used by history patches and commands.
   */
  public get usedBytes(): number {
    return this.totalBytes;
  }

  private getPathFromRoot(nodeId: string): string[] {
    const path: string[] = [];
    let currId: string | null = nodeId;
    while (currId) {
      path.push(currId);
      const node = this.nodes.get(currId);
      currId = node ? node.parentId : null;
    }
    return path.reverse();
  }

  private enforceMemoryBudget(): void {
    // If memory exceeds maxBytes, prune non-active oldest leaf branches first
    while (this.totalBytes > this.maxBytes && this.nodes.size > 3) {
      const activePath = new Set(this.getPathFromRoot(this.currentId));
      let pruned = false;
      for (const [id, node] of this.nodes.entries()) {
        if (id !== this.rootId && !activePath.has(id) && node.childrenIds.length === 0) {
          this.removeLeafNode(id);
          pruned = true;
          break;
        }
      }
      if (!pruned) break;
    }
  }

  private removeLeafNode(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent) {
        const idx = parent.childrenIds.indexOf(id);
        if (idx >= 0) {
          parent.childrenIds.splice(idx, 1);
          if (parent.activeChildIndex >= parent.childrenIds.length) {
            parent.activeChildIndex = parent.childrenIds.length - 1;
          }
        }
      }
    }
    if (node.command) {
      this.totalBytes = Math.max(0, this.totalBytes - node.command.byteSize);
    }
    this.nodes.delete(id);
  }

  private emitChanged(): void {
    this.events.emit("changed", {
      currentNodeId: this.currentId,
      canUndo: this.canUndo,
      canRedo: this.canRedo,
    });
  }
}

/**
 * Composite transaction grouping multiple sub-commands into a single undoable step.
 */
export class TransactionCommand implements Command {
  public readonly id: string;
  public readonly label: string;
  public readonly timestamp: number;
  public readonly commands: Command[];

  public constructor(label: string, commands: Command[]) {
    this.id = createModelId("tx");
    this.label = label;
    this.timestamp = Date.now();
    this.commands = commands;
  }

  public get byteSize(): number {
    return this.commands.reduce((acc, cmd) => acc + cmd.byteSize, 64);
  }

  public do(sprite: Sprite): void {
    for (const cmd of this.commands) {
      cmd.do(sprite);
    }
  }

  public undo(sprite: Sprite): void {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo(sprite);
    }
  }
}

/**
 * Region-patch command storing only the dirty pixel rectangle before and after a drawing operation.
 */
export class CelImagePatchCommand implements Command {
  public readonly id: string;
  public readonly label: string;
  public readonly timestamp: number;
  public readonly layerId: string;
  public readonly frameIndex: number;
  public readonly beforePatch: ImagePatch;
  public readonly afterPatch: ImagePatch;

  public constructor(
    label: string,
    layerId: string,
    frameIndex: number,
    beforePatch: ImagePatch,
    afterPatch: ImagePatch
  ) {
    this.id = createModelId("patch");
    this.label = label;
    this.timestamp = Date.now();
    this.layerId = layerId;
    this.frameIndex = frameIndex;
    this.beforePatch = beforePatch;
    this.afterPatch = afterPatch;
  }

  public get byteSize(): number {
    return this.beforePatch.data.byteLength + this.afterPatch.data.byteLength + 64;
  }

  public do(sprite: Sprite): void {
    const cel = getCel(sprite, this.layerId, this.frameIndex);
    if (cel) {
      cel.image.applyPatch(this.afterPatch);
    }
  }

  public undo(sprite: Sprite): void {
    const cel = getCel(sprite, this.layerId, this.frameIndex);
    if (cel) {
      cel.image.applyPatch(this.beforePatch);
    }
  }
}

/**
 * Adds a new layer to a Sprite.
 */
export class AddLayerCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 256;
  private readonly layer: Layer;
  private readonly insertIndex?: number;
  private createdCels: Cel[] = [];

  public constructor(layer: Layer, insertIndex?: number, label = "New Layer") {
    this.layer = layer;
    this.insertIndex = insertIndex;
    this.label = label;
  }

  public do(sprite: Sprite): void {
    const idx =
      this.insertIndex !== undefined
        ? clamp(this.insertIndex, 0, sprite.layers.length)
        : sprite.layers.length;
    sprite.layers.splice(idx, 0, this.layer);
    if (this.layer.kind === "image") {
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
          userData: { text: "" },
        }));
      }
      sprite.cels.push(...this.createdCels);
    }
  }

  public undo(sprite: Sprite): void {
    const idx = sprite.layers.findIndex((l) => l.id === this.layer.id);
    if (idx >= 0) sprite.layers.splice(idx, 1);
    sprite.cels = sprite.cels.filter((c) => c.layerId !== this.layer.id);
  }
}

/**
 * Removes an existing layer and its cels from a Sprite.
 */
export class RemoveLayerCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Delete Layer";
  public readonly timestamp = Date.now();
  public readonly byteSize = 512;
  private readonly layerId: string;
  private removedLayer: Layer | null = null;
  private removedIndex = -1;
  private removedCels: Cel[] = [];

  public constructor(layerId: string) {
    this.layerId = layerId;
  }

  public do(sprite: Sprite): void {
    if (sprite.layers.length <= 1) return;
    this.removedIndex = sprite.layers.findIndex((l) => l.id === this.layerId);
    if (this.removedIndex < 0) return;
    this.removedLayer = sprite.layers[this.removedIndex];
    sprite.layers.splice(this.removedIndex, 1);
    this.removedCels = sprite.cels.filter((c) => c.layerId === this.layerId);
    sprite.cels = sprite.cels.filter((c) => c.layerId !== this.layerId);
  }

  public undo(sprite: Sprite): void {
    if (!this.removedLayer || this.removedIndex < 0) return;
    sprite.layers.splice(this.removedIndex, 0, this.removedLayer);
    sprite.cels.push(...this.removedCels);
  }
}

/**
 * Reorders a layer in the Sprite's layer stack.
 */
export class MoveLayerCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Move Layer";
  public readonly timestamp = Date.now();
  public readonly byteSize = 128;
  private readonly layerId: string;
  private readonly toIndex: number;
  private fromIndex = -1;

  public constructor(layerId: string, toIndex: number) {
    this.layerId = layerId;
    this.toIndex = toIndex;
  }

  public do(sprite: Sprite): void {
    this.fromIndex = sprite.layers.findIndex((l) => l.id === this.layerId);
    if (this.fromIndex < 0) return;
    const [layer] = sprite.layers.splice(this.fromIndex, 1);
    const target = clamp(this.toIndex, 0, sprite.layers.length);
    sprite.layers.splice(target, 0, layer);
  }

  public undo(sprite: Sprite): void {
    if (this.fromIndex < 0) return;
    const currIdx = sprite.layers.findIndex((l) => l.id === this.layerId);
    if (currIdx < 0) return;
    const [layer] = sprite.layers.splice(currIdx, 1);
    sprite.layers.splice(this.fromIndex, 0, layer);
  }
}

/**
 * Updates layer properties (name, visible, editable, opacity, blendMode, etc.).
 */
export class SetLayerPropsCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 128;
  private readonly layerId: string;
  private readonly nextProps: Partial<
    Pick<
      Layer,
      | "name"
      | "visible"
      | "editable"
      | "lockMove"
      | "preferLinkedCels"
      | "collapsed"
      | "blendMode"
      | "opacity"
    >
  >;
  private prevProps: Record<string, unknown> = {};

  public constructor(
    layerId: string,
    nextProps: Partial<
      Pick<
        Layer,
        | "name"
        | "visible"
        | "editable"
        | "lockMove"
        | "preferLinkedCels"
        | "collapsed"
        | "blendMode"
        | "opacity"
      >
    >,
    label = "Layer Properties"
  ) {
    this.layerId = layerId;
    this.nextProps = nextProps;
    this.label = label;
  }

  public do(sprite: Sprite): void {
    const layer = sprite.layers.find((l) => l.id === this.layerId);
    if (!layer) return;
    this.prevProps = {};
    for (const key of Object.keys(this.nextProps) as Array<keyof typeof this.nextProps>) {
      this.prevProps[key] = layer[key];
      (layer as unknown as Record<string, unknown>)[key] = this.nextProps[key];
    }
  }

  public undo(sprite: Sprite): void {
    const layer = sprite.layers.find((l) => l.id === this.layerId);
    if (!layer) return;
    for (const [k, v] of Object.entries(this.prevProps)) {
      (layer as unknown as Record<string, unknown>)[k] = v;
    }
  }
}

/**
 * Adds or duplicates a frame in the Sprite timeline.
 */
export class AddFrameCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 1024;
  private readonly afterFrameIndex: number;
  private readonly duplicateContent: boolean;
  private readonly forceEmpty: boolean;
  private insertedIndex = -1;
  private createdFrame: Frame | null = null;
  private createdCels: Cel[] = [];

  public constructor(afterFrameIndex: number, duplicateContent = false, forceEmpty = false) {
    this.afterFrameIndex = afterFrameIndex;
    this.duplicateContent = duplicateContent;
    this.forceEmpty = forceEmpty;
    this.label = forceEmpty ? "New Empty Frame" : duplicateContent ? "Duplicate Frame" : "New Frame";
  }

  public do(sprite: Sprite): void {
    this.insertedIndex = clamp(this.afterFrameIndex + 1, 0, sprite.frames.length);
    const refDuration = sprite.frames[this.afterFrameIndex]?.durationMs ?? 100;

    // Shift existing frames and cels >= insertedIndex
    for (const f of sprite.frames) {
      if (f.index >= this.insertedIndex) f.index += 1;
    }
    for (const c of sprite.cels) {
      if (c.frameIndex >= this.insertedIndex) c.frameIndex += 1;
    }

    this.createdFrame = {
      id: createModelId("frame"),
      index: this.insertedIndex,
      durationMs: refDuration,
    };
    sprite.frames.splice(this.insertedIndex, 0, this.createdFrame);

    if (this.createdCels.length === 0) {
      for (const layer of sprite.layers) {
        if (layer.kind === "group") continue;
        const sourceCel = getCel(sprite, layer.id, Math.max(0, this.insertedIndex - 1));
        const shouldLink = !this.forceEmpty && layer.preferLinkedCels && Boolean(sourceCel);
        const linkId = shouldLink && sourceCel
          ? sourceCel.linkId ?? (sourceCel.linkId = createModelId("link"))
          : undefined;
        const img = linkId && sourceCel
          ? sourceCel.image
          : !this.forceEmpty && this.duplicateContent && sourceCel
          ? sourceCel.image.clone()
          : new PixelImage(sprite.width, sprite.height, sprite.colorMode);
        const tilemapData =
          layer.kind === "tilemap" && sourceCel?.tilemapData
            ? !this.forceEmpty && (shouldLink || this.duplicateContent)
              ? {
                  width: sourceCel.tilemapData.width,
                  height: sourceCel.tilemapData.height,
                  tiles: shouldLink
                    ? sourceCel.tilemapData.tiles
                    : new Uint32Array(sourceCel.tilemapData.tiles),
                }
              : {
                  width: sourceCel.tilemapData.width,
                  height: sourceCel.tilemapData.height,
                  tiles: new Uint32Array(sourceCel.tilemapData.width * sourceCel.tilemapData.height),
                }
            : undefined;
        this.createdCels.push({
          id: createModelId("cel"),
          layerId: layer.id,
          frameIndex: this.insertedIndex,
          x: sourceCel?.x ?? 0,
          y: sourceCel?.y ?? 0,
          opacity: sourceCel?.opacity ?? 255,
          zIndex: sourceCel?.zIndex ?? 0,
          linkId,
          image: img,
          tilemapData,
          userData: { text: "" },
        });
      }
    }
    sprite.cels.push(...this.createdCels);
  }

  public undo(sprite: Sprite): void {
    if (this.insertedIndex < 0) return;
    sprite.frames.splice(this.insertedIndex, 1);
    sprite.cels = sprite.cels.filter((c) => c.frameIndex !== this.insertedIndex);
    for (const f of sprite.frames) {
      if (f.index > this.insertedIndex) f.index -= 1;
    }
    for (const c of sprite.cels) {
      if (c.frameIndex > this.insertedIndex) c.frameIndex -= 1;
    }
  }
}

/**
 * Removes a frame from the Sprite timeline.
 */
export class RemoveFrameCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Delete Frame";
  public readonly timestamp = Date.now();
  public readonly byteSize = 1024;
  private readonly frameIndex: number;
  private removedFrame: Frame | null = null;
  private removedCels: Cel[] = [];

  public constructor(frameIndex: number) {
    this.frameIndex = frameIndex;
  }

  public do(sprite: Sprite): void {
    if (sprite.frames.length <= 1) return;
    const idx = clamp(this.frameIndex, 0, sprite.frames.length - 1);
    this.removedFrame = sprite.frames[idx];
    sprite.frames.splice(idx, 1);
    this.removedCels = sprite.cels.filter((c) => c.frameIndex === idx);
    sprite.cels = sprite.cels.filter((c) => c.frameIndex !== idx);
    for (const f of sprite.frames) {
      if (f.index > idx) f.index -= 1;
    }
    for (const c of sprite.cels) {
      if (c.frameIndex > idx) c.frameIndex -= 1;
    }
  }

  public undo(sprite: Sprite): void {
    if (!this.removedFrame) return;
    const idx = this.removedFrame.index;
    for (const f of sprite.frames) {
      if (f.index >= idx) f.index += 1;
    }
    for (const c of sprite.cels) {
      if (c.frameIndex >= idx) c.frameIndex += 1;
    }
    sprite.frames.splice(idx, 0, this.removedFrame);
    sprite.cels.push(...this.removedCels);
  }
}

/**
 * Sets a frame's duration in milliseconds.
 */
export class SetFrameDurationCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Frame Duration";
  public readonly timestamp = Date.now();
  public readonly byteSize = 64;
  private readonly frameIndex: number;
  private readonly durationMs: number;
  private prevDurationMs = 100;

  public constructor(frameIndex: number, durationMs: number) {
    this.frameIndex = frameIndex;
    this.durationMs = clamp(Math.floor(durationMs), 1, 65535);
  }

  public do(sprite: Sprite): void {
    const f = sprite.frames[this.frameIndex];
    if (!f) return;
    this.prevDurationMs = f.durationMs;
    f.durationMs = this.durationMs;
  }

  public undo(sprite: Sprite): void {
    const f = sprite.frames[this.frameIndex];
    if (!f) return;
    f.durationMs = this.prevDurationMs;
  }
}

/**
 * Links or unlinks cels across frames on a layer so they share or separate their PixelImage.
 */
export class LinkCelsCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 256;
  private readonly layerId: string;
  private readonly frameIndices: number[];
  private readonly link: boolean;
  private prevStates: Array<{ frameIndex: number; linkId?: string; image: PixelImage }> = [];

  public constructor(layerId: string, frameIndices: number[], link: boolean) {
    this.layerId = layerId;
    this.frameIndices = [...frameIndices].sort((a, b) => a - b);
    this.link = link;
    this.label = link ? "Link Cels" : "Unlink Cels";
  }

  public do(sprite: Sprite): void {
    this.prevStates = [];
    const targetCels = this.frameIndices
      .map((fi) => getCel(sprite, this.layerId, fi))
      .filter((c): c is Cel => Boolean(c));
    if (targetCels.length === 0) return;

    for (const c of targetCels) {
      this.prevStates.push({ frameIndex: c.frameIndex, linkId: c.linkId, image: c.image });
    }

    if (this.link && targetCels.length >= 2) {
      const sharedLinkId = targetCels[0].linkId ?? createModelId("link");
      const sharedImg = targetCels[0].image;
      for (const c of targetCels) {
        c.linkId = sharedLinkId;
        c.image = sharedImg;
      }
    } else if (!this.link) {
      for (const c of targetCels) {
        c.linkId = undefined;
        c.image = c.image.clone();
      }
    }
  }

  public undo(sprite: Sprite): void {
    for (const st of this.prevStates) {
      const c = getCel(sprite, this.layerId, st.frameIndex);
      if (c) {
        c.linkId = st.linkId;
        c.image = st.image;
      }
    }
  }
}

/**
 * Resizes the sprite or canvas dimensions with undo support.
 */
export class SetSpriteSizeCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 4096;
  private readonly newWidth: number;
  private readonly newHeight: number;
  private readonly scaleContent: boolean;
  private prevWidth = 0;
  private prevHeight = 0;
  private prevCelImages: Array<{ celId: string; image: PixelImage }> = [];

  public constructor(newWidth: number, newHeight: number, scaleContent = true) {
    this.newWidth = clamp(Math.floor(newWidth), 1, 16384);
    this.newHeight = clamp(Math.floor(newHeight), 1, 16384);
    this.scaleContent = scaleContent;
    this.label = scaleContent ? "Sprite Size" : "Canvas Size";
  }

  public do(sprite: Sprite): void {
    this.prevWidth = sprite.width;
    this.prevHeight = sprite.height;
    this.prevCelImages = sprite.cels.map((c) => ({ celId: c.id, image: c.image.clone() }));

    const processedLinks = new Map<string, PixelImage>();

    for (const cel of sprite.cels) {
      if (cel.linkId && processedLinks.has(cel.linkId)) {
        cel.image = processedLinks.get(cel.linkId)!;
        continue;
      }
      const nextImg = new PixelImage(this.newWidth, this.newHeight, sprite.colorMode);
      if (this.scaleContent) {
        for (let y = 0; y < this.newHeight; y++) {
          const sy = Math.min(
            cel.image.height - 1,
            Math.floor((y * cel.image.height) / this.newHeight)
          );
          for (let x = 0; x < this.newWidth; x++) {
            const sx = Math.min(
              cel.image.width - 1,
              Math.floor((x * cel.image.width) / this.newWidth)
            );
            nextImg.putPixel(x, y, cel.image.getPixel(sx, sy));
          }
        }
      } else {
        for (let y = 0; y < Math.min(this.newHeight, cel.image.height); y++) {
          for (let x = 0; x < Math.min(this.newWidth, cel.image.width); x++) {
            nextImg.putPixel(x, y, cel.image.getPixel(x, y));
          }
        }
      }
      cel.image = nextImg;
      if (cel.linkId) {
        processedLinks.set(cel.linkId, nextImg);
      }
    }

    sprite.width = this.newWidth;
    sprite.height = this.newHeight;
    sprite.mask = new Mask(this.newWidth, this.newHeight);
  }

  public undo(sprite: Sprite): void {
    sprite.width = this.prevWidth;
    sprite.height = this.prevHeight;
    sprite.mask = new Mask(this.prevWidth, this.prevHeight);
    for (const prev of this.prevCelImages) {
      const cel = sprite.cels.find((c) => c.id === prev.celId);
      if (cel) cel.image = prev.image;
    }
  }
}

/**
 * Updates the Sprite palette colors.
 */
export class SetPaletteCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Edit Palette";
  public readonly timestamp = Date.now();
  public readonly byteSize = 512;
  private readonly nextColors: RGBA[];
  private prevColors: RGBA[] = [];

  public constructor(nextColors: RGBA[]) {
    this.nextColors = nextColors.map((c) => ({ ...c }));
  }

  public do(sprite: Sprite): void {
    const pal = sprite.palettes[0];
    if (!pal) return;
    this.prevColors = pal.colors.map((c) => ({ ...c }));
    pal.colors = this.nextColors.map((c) => ({ ...c }));
  }

  public undo(sprite: Sprite): void {
    const pal = sprite.palettes[0];
    if (!pal) return;
    pal.colors = this.prevColors.map((c) => ({ ...c }));
  }
}

/**
 * Updates the Sprite selection mask.
 */
export class SetMaskCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label: string;
  public readonly timestamp = Date.now();
  public readonly byteSize = 256;
  private readonly nextMask: Mask;
  private prevMask: Mask | null = null;

  public constructor(nextMask: Mask, label = "Selection") {
    this.nextMask = nextMask.clone();
    this.label = label;
  }

  public do(sprite: Sprite): void {
    this.prevMask = sprite.mask.clone();
    sprite.mask = this.nextMask.clone();
  }

  public undo(sprite: Sprite): void {
    if (this.prevMask) {
      sprite.mask = this.prevMask.clone();
    }
  }
}

/**
 * Adds or removes an animation Tag.
 */
export class AddTagCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Add Tag";
  public readonly timestamp = Date.now();
  public readonly byteSize = 128;
  private readonly tag: Tag;

  public constructor(tag: Tag) {
    this.tag = tag;
  }

  public do(sprite: Sprite): void {
    sprite.tags.push(this.tag);
  }

  public undo(sprite: Sprite): void {
    sprite.tags = sprite.tags.filter((t) => t.id !== this.tag.id);
  }
}

/**
 * Adds a Slice to the Sprite.
 */
export class AddSliceCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Add Slice";
  public readonly timestamp = Date.now();
  public readonly byteSize = 128;
  private readonly slice: Slice;

  public constructor(slice: Slice) {
    this.slice = slice;
  }

  public do(sprite: Sprite): void {
    sprite.slices.push(this.slice);
  }

  public undo(sprite: Sprite): void {
    sprite.slices = sprite.slices.filter((s) => s.id !== this.slice.id);
  }
}

/**
 * Changes the Sprite's ColorMode (RGBA, Grayscale, Indexed).
 */
export class SetColorModeCommand implements Command {
  public readonly id = createModelId("cmd");
  public readonly label = "Color Mode";
  public readonly timestamp = Date.now();
  public readonly byteSize = 2048;
  private readonly nextMode: ColorMode;
  private prevMode: ColorMode = "rgba";
  private prevCelImages: Array<{ celId: string; image: PixelImage }> = [];

  public constructor(nextMode: ColorMode) {
    this.nextMode = nextMode;
  }

  public do(sprite: Sprite): void {
    this.prevMode = sprite.colorMode;
    this.prevCelImages = sprite.cels.map((c) => ({ celId: c.id, image: c.image.clone() }));
    const palette = getPaletteForFrame(sprite, 0);
    for (const cel of sprite.cels) {
      const converted = new PixelImage(cel.image.width, cel.image.height, this.nextMode);
      for (let y = 0; y < cel.image.height; y++) {
        for (let x = 0; x < cel.image.width; x++) {
          const rgba = cel.image.getRGBA(x, y, palette, sprite.transparentIndex);
          converted.setRGBA(x, y, rgba, palette, sprite.transparentIndex);
        }
      }
      cel.image = converted;
    }
    sprite.colorMode = this.nextMode;
  }

  public undo(sprite: Sprite): void {
    sprite.colorMode = this.prevMode;
    for (const prev of this.prevCelImages) {
      const cel = sprite.cels.find((c) => c.id === prev.celId);
      if (cel) cel.image = prev.image;
    }
  }
}

/**
 * Builder exposed inside `doc.transact(label, tx => { ... })`.
 */
export class TransactionBuilder {
  private readonly sprite: Sprite;
  private readonly commands: Command[] = [];

  public constructor(sprite: Sprite) {
    this.sprite = sprite;
  }

  /**
   * Adds a custom Command to this transaction and immediately executes it on the sprite.
   */
  public run(command: Command): void {
    command.do(this.sprite);
    this.commands.push(command);
  }

  /**
   * Draws a stroke or set of pixels on (layerId, frameIndex) and stores only the changed bounding-box patch.
   */
  public drawPixels(
    layerId: string,
    frameIndex: number,
    pixels: ReadonlyArray<{ x: number; y: number; color: RGBA }>,
    brushSize = 1,
    brushShape: "circle" | "square" = "square",
    label = "Pencil Stroke"
  ): void {
    const layer = this.sprite.layers.find((l) => l.id === layerId);
    if (!layer || !layer.editable || !layer.visible || layer.kind === "group") return;
    const cel = getCel(this.sprite, layerId, frameIndex);
    if (!cel) return;
    if (pixels.length === 0) return;

    const r = Math.floor(brushSize / 2);
    let dirty: Rect | null = null;
    for (const pt of pixels) {
      const ptRect: Rect = {
        x: pt.x - r,
        y: pt.y - r,
        width: brushSize,
        height: brushSize,
      };
      dirty = dirty ? unionRect(dirty, ptRect) : ptRect;
    }
    if (!dirty) return;

    const beforePatch = cel.image.extractPatch(dirty);
    const palette = getPaletteForFrame(this.sprite, frameIndex);
    const hasMask = !this.sprite.mask.isEmpty;

    for (const pt of pixels) {
      for (let dy = -r; dy < -r + brushSize; dy++) {
        for (let dx = -r; dx < -r + brushSize; dx++) {
          if (brushShape === "circle" && brushSize > 2) {
            const distSq = (dx + 0.5) * (dx + 0.5) + (dy + 0.5) * (dy + 0.5);
            if (distSq > (brushSize / 2) * (brushSize / 2)) continue;
          }
          const px = pt.x + dx;
          const py = pt.y + dy;
          if (px < 0 || py < 0 || px >= cel.image.width || py >= cel.image.height) continue;
          if (hasMask && !this.sprite.mask.getBit(px, py)) continue;
          cel.image.setRGBA(px, py, pt.color, palette, this.sprite.transparentIndex);
        }
      }
    }

    const afterPatch = cel.image.extractPatch(dirty);
    this.commands.push(
      new CelImagePatchCommand(label, layerId, frameIndex, beforePatch, afterPatch)
    );
  }

  /**
   * Adds a new ImageLayer to the sprite.
   */
  public addImageLayer(name?: string, insertIndex?: number): ImageLayer {
    const newLayer: ImageLayer = {
      id: createModelId("layer"),
      kind: "image",
      name: name ?? `Layer ${this.sprite.layers.length + 1}`,
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
    this.run(new AddLayerCommand(newLayer, insertIndex, `New Layer (${newLayer.name})`));
    return newLayer;
  }

  /**
   * Removes a layer by ID.
   */
  public removeLayer(layerId: string): void {
    this.run(new RemoveLayerCommand(layerId));
  }

  /**
   * Moves a layer to a new stack index.
   */
  public moveLayer(layerId: string, toIndex: number): void {
    this.run(new MoveLayerCommand(layerId, toIndex));
  }

  /**
   * Updates layer properties.
   */
  public setLayerProps(
    layerId: string,
    props: Partial<
      Pick<
        Layer,
        | "name"
        | "visible"
        | "editable"
        | "lockMove"
        | "preferLinkedCels"
        | "collapsed"
        | "blendMode"
        | "opacity"
      >
    >
  ): void {
    this.run(new SetLayerPropsCommand(layerId, props));
  }

  /**
   * Adds or duplicates a frame.
   */
  public addFrame(afterFrameIndex: number, duplicateContent = false): void {
    this.run(new AddFrameCommand(afterFrameIndex, duplicateContent));
  }

  /**
   * Removes a frame.
   */
  public removeFrame(frameIndex: number): void {
    this.run(new RemoveFrameCommand(frameIndex));
  }

  /**
   * Sets frame duration in milliseconds.
   */
  public setFrameDuration(frameIndex: number, durationMs: number): void {
    this.run(new SetFrameDurationCommand(frameIndex, durationMs));
  }

  /**
   * Links or unlinks cels across frames on a layer.
   */
  public linkCels(layerId: string, frameIndices: number[], link: boolean): void {
    this.run(new LinkCelsCommand(layerId, frameIndices, link));
  }

  /**
   * Resizes the sprite or canvas.
   */
  public setSpriteSize(width: number, height: number, scaleContent = true): void {
    this.run(new SetSpriteSizeCommand(width, height, scaleContent));
  }

  /**
   * Changes the sprite color mode.
   */
  public setColorMode(mode: ColorMode): void {
    this.run(new SetColorModeCommand(mode));
  }

  /**
   * Updates the sprite palette.
   */
  public setPalette(colors: RGBA[]): void {
    this.run(new SetPaletteCommand(colors));
  }

  /**
   * Updates the selection mask.
   */
  public setMask(mask: Mask, label = "Selection"): void {
    this.run(new SetMaskCommand(mask, label));
  }

  /**
   * Adds an animation Tag.
   */
  public addTag(tag: Tag): void {
    this.run(new AddTagCommand(tag));
  }

  /**
   * Adds a Slice.
   */
  public addSlice(slice: Slice): void {
    this.run(new AddSliceCommand(slice));
  }

  /**
   * Internal accessor returning recorded commands.
   */
  public getRecordedCommands(): Command[] {
    return this.commands;
  }
}

export interface DocumentEvents extends Record<string, unknown> {
  changed: { revision: number; label: string };
}

/**
 * Encapsulates a Sprite, its non-linear History, dirty state, and transactional mutation API.
 * All document modifications from the UI MUST pass through `doc.transact(...)` or `doc.execute(...)`.
 */
export class SpriteDocument {
  public readonly id: string;
  public readonly history: History;
  public readonly events = new EventBus<DocumentEvents>();
  private readonly _sprite: Sprite;
  private _revision = 0;
  private _savedNodeId = "root";
  public filePath: string | null = null;

  public constructor(sprite: Sprite, maxHistoryBytes = 64 * 1024 * 1024) {
    this.id = sprite.id;
    this._sprite = sprite;
    this.history = new History(maxHistoryBytes);
  }

  /**
   * Readonly view of the underlying Sprite.
   */
  public get sprite(): ReadonlySprite {
    return this._sprite;
  }

  /**
   * Monotonically increasing revision counter incremented on every edit/undo/redo.
   */
  public get revision(): number {
    return this._revision;
  }

  /**
   * True if the current history node differs from the last saved node.
   */
  public get isDirty(): boolean {
    return this.history.currentNodeId !== this._savedNodeId;
  }

  /**
   * Marks the current history state as saved.
   */
  public markSaved(): void {
    this._savedNodeId = this.history.currentNodeId;
    this._revision += 1;
    this.events.emit("changed", { revision: this._revision, label: "Saved" });
  }

  /**
   * Executes a single Command through History.
   */
  public execute(command: Command, allowMerge = false): void {
    this.history.execute(this._sprite, command, allowMerge);
    this._revision += 1;
    this.events.emit("changed", { revision: this._revision, label: command.label });
  }

  /**
   * Runs one or more model operations inside a single atomic Undo/Redo transaction.
   */
  public transact(label: string, fn: (tx: TransactionBuilder) => void): void {
    const builder = new TransactionBuilder(this._sprite);
    fn(builder);
    const cmds = builder.getRecordedCommands();
    if (cmds.length === 0) return;

    // Note: builder.run() / drawPixels() already mutated _sprite in-place,
    // so we record the command node in History without re-running do() twice.
    const finalCommand = cmds.length === 1 ? cmds[0] : new TransactionCommand(label, cmds);
    // Undo then execute via history so History invariants are 100% consistent
    finalCommand.undo(this._sprite);
    this.history.execute(this._sprite, finalCommand, false);
    this._revision += 1;
    this.events.emit("changed", { revision: this._revision, label });
  }

  /**
   * Undoes the last transaction/command.
   */
  public undo(): boolean {
    const ok = this.history.undo(this._sprite);
    if (ok) {
      this._revision += 1;
      this.events.emit("changed", { revision: this._revision, label: "Undo" });
    }
    return ok;
  }

  /**
   * Redoes the next transaction/command along the active branch.
   */
  public redo(): boolean {
    const ok = this.history.redo(this._sprite);
    if (ok) {
      this._revision += 1;
      this.events.emit("changed", { revision: this._revision, label: "Redo" });
    }
    return ok;
  }

  /**
   * Jumps to any node in the non-linear Undo History tree.
   */
  public jumpToHistoryNode(nodeId: string): boolean {
    const ok = this.history.jumpToNode(this._sprite, nodeId);
    if (ok) {
      this._revision += 1;
      this.events.emit("changed", { revision: this._revision, label: "Jump History" });
    }
    return ok;
  }
}
