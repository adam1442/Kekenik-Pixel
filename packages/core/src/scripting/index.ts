/**
 * @module @kekenik/core/scripting
 * Pure-TypeScript Sandboxed Scripting Engine for Kekenik Pixel.
 * Zero DOM or Electron imports.
 */

import { Command, SpriteDocument } from "../commands/index.ts";
import { EventBus } from "../events/index.ts";
import {
  blendRGBA,
  bytesPerPixel,
  Cel,
  ColorMode,
  createModelId,
  createSprite,
  deserializeSnapshot,
  Frame,
  getCel,
  GroupLayer,
  ImageLayer,
  Layer,
  Mask,
  PixelImage,
  serializeSnapshot,
  Sprite,
} from "../model/index.ts";
import { decodeGplPalette, encodeGplPalette } from "../palette/index.ts";
import { appLogger, getPlatform } from "../platform/index.ts";
import { CommandRegistry, ToolRegistry } from "../registry/index.ts";
import {
  createEllipseMarqueeMask,
  createRectMarqueeMask,
} from "../selection/index.ts";
import { rasterizeLine } from "../tools/index.ts";
import { hexToRgba, RGBA, rgbaToHex } from "../util/index.ts";
import {
  ScriptAppAPI,
  ScriptCel,
  ScriptColorNamespace,
  ScriptDialogBuilder,
  ScriptDialogResult,
  ScriptDialogWidgetSpec,
  ScriptEventName,
  ScriptEventsAPI,
  ScriptImage,
  ScriptLayer,
  ScriptPalette,
  ScriptRGBA,
  ScriptSelection,
  ScriptSlice,
  ScriptSprite,
  ScriptTag,
  ScriptTileset,
} from "./types.ts";
import {
  computeScriptHash,
  ScriptConsoleEntry,
  ScriptPermissionKind,
  ScriptPermissionManifest,
  ScriptPermissionRequest,
  transpileTypeScriptForSandbox,
  validateScriptSandboxSafety,
} from "./worker/index.ts";

export * from "./types.ts";
export * from "./worker/index.ts";

function makeNewImageLayer(name: string): ImageLayer {
  return {
    id: createModelId("layer"),
    kind: "image",
    name,
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
}

function makeNewCel(
  layerId: string,
  frameIndex: number,
  width: number,
  height: number,
  colorMode: ColorMode
): Cel {
  return {
    id: createModelId("cel"),
    layerId,
    frameIndex,
    x: 0,
    y: 0,
    opacity: 255,
    zIndex: 0,
    image: new PixelImage(width, height, colorMode),
    userData: { text: "" },
  };
}

function makeNewFrame(index: number, durationMs = 100): Frame {
  return {
    id: createModelId("frame"),
    index,
    durationMs,
  };
}

/**
 * Undoable Command representing an atomic `app.transaction(label, fn)` execution.
 */
export class ScriptTransactionCommand implements Command {
  public readonly id: string;
  public readonly label: string;
  public readonly timestamp: number;
  public readonly byteSize: number;
  private readonly beforeSnapshot: string;
  private readonly afterSnapshot: string;

  public constructor(label: string, beforeSnapshot: string, afterSnapshot: string) {
    this.id = createModelId("cmd_script");
    this.label = label;
    this.timestamp = Date.now();
    this.beforeSnapshot = beforeSnapshot;
    this.afterSnapshot = afterSnapshot;
    this.byteSize = Math.max(64, beforeSnapshot.length + afterSnapshot.length);
  }

  public do(sprite: Sprite): void {
    const next = deserializeSnapshot(this.afterSnapshot);
    applyRestoredSpriteInPlace(sprite, next);
  }

  public undo(sprite: Sprite): void {
    const prev = deserializeSnapshot(this.beforeSnapshot);
    applyRestoredSpriteInPlace(sprite, prev);
  }
}

function applyRestoredSpriteInPlace(target: Sprite, source: Sprite): void {
  target.name = source.name;
  target.width = source.width;
  target.height = source.height;
  target.colorMode = source.colorMode;
  target.transparentIndex = source.transparentIndex;
  target.pixelRatio = { ...source.pixelRatio };
  target.grid = { ...source.grid };
  target.palettes = source.palettes;
  target.layers = source.layers;
  target.frames = source.frames;
  target.cels = source.cels;
  target.tags = source.tags;
  target.slices = source.slices;
  target.tilesets = source.tilesets;
  target.mask = source.mask;
  target.userData = { ...source.userData };
}

function normalizeColorInput(c: ScriptRGBA | string | undefined): RGBA {
  if (!c) return { r: 0, g: 0, b: 0, a: 0 };
  if (typeof c === "string") {
    return hexToRgba(c);
  }
  return {
    r: Math.max(0, Math.min(255, Math.round(c.r ?? 0))),
    g: Math.max(0, Math.min(255, Math.round(c.g ?? 0))),
    b: Math.max(0, Math.min(255, Math.round(c.b ?? 0))),
    a: Math.max(0, Math.min(255, Math.round(c.a ?? 255))),
  };
}

/**
 * Global `Color` helper namespace exposed to scripts.
 */
export const ScriptColorAPI: ScriptColorNamespace = {
  rgba(r: number, g: number, b: number, a = 255): ScriptRGBA {
    return {
      r: Math.max(0, Math.min(255, Math.round(r))),
      g: Math.max(0, Math.min(255, Math.round(g))),
      b: Math.max(0, Math.min(255, Math.round(b))),
      a: Math.max(0, Math.min(255, Math.round(a))),
    };
  },
  hex(color: ScriptRGBA): string {
    return rgbaToHex(normalizeColorInput(color)).toLowerCase();
  },
  fromHex(hex: string): ScriptRGBA {
    return hexToRgba(hex);
  },
  blend(backdrop: ScriptRGBA, source: ScriptRGBA, opacity = 255): ScriptRGBA {
    return blendRGBA(
      normalizeColorInput(backdrop),
      normalizeColorInput(source),
      "normal",
      opacity
    );
  },
};

/**
 * Global Script Event Bus for real application lifecycle & state events.
 */
type ScriptEventMap = {
  [K in ScriptEventName]: Record<string, unknown>;
};

class ScriptEventsManager implements ScriptEventsAPI {
  private readonly bus = new EventBus<ScriptEventMap>();

  public on(
    event: ScriptEventName,
    fn: (payload: Record<string, unknown>) => void
  ): () => void {
    return this.bus.on(event, fn);
  }

  public off(
    event: ScriptEventName,
    fn: (payload: Record<string, unknown>) => void
  ): void {
    this.bus.off(event, fn);
  }

  public emit(event: ScriptEventName, payload: Record<string, unknown> = {}): void {
    this.bus.emit(event, payload);
  }

  public clearAll(): void {
    this.bus.clear();
  }
}

export const scriptEventsBus = new ScriptEventsManager();

/**
 * Permission Store remembering per-script-hash permission decisions.
 */
export class ScriptPermissionStore {
  private readonly decisions = new Map<string, Map<ScriptPermissionKind, boolean>>();

  public getDecision(
    scriptHash: string,
    permission: ScriptPermissionKind
  ): boolean | undefined {
    return this.decisions.get(scriptHash)?.get(permission);
  }

  public setDecision(
    scriptHash: string,
    permission: ScriptPermissionKind,
    granted: boolean
  ): void {
    let map = this.decisions.get(scriptHash);
    if (!map) {
      map = new Map();
      this.decisions.set(scriptHash, map);
    }
    map.set(permission, granted);
  }

  public getPermissionsForScript(
    scriptHash: string
  ): Record<ScriptPermissionKind, boolean | undefined> {
    const map = this.decisions.get(scriptHash);
    return {
      "fs.read": map?.get("fs.read"),
      "fs.write": map?.get("fs.write"),
      network: map?.get("network"),
      dialogs: map?.get("dialogs"),
    };
  }

  public clearScriptPermissions(scriptHash?: string): void {
    if (scriptHash) {
      this.decisions.delete(scriptHash);
    } else {
      this.decisions.clear();
    }
  }
}

export const defaultScriptPermissionStore = new ScriptPermissionStore();

/**
 * Wraps a `PixelImage` in the `ScriptImage` facade with optional mutation hooks.
 */
export function createScriptImageFacade(
  image: PixelImage,
  onMutate?: (fn: () => void) => void
): ScriptImage {
  const runMutate = (fn: () => void) => {
    if (onMutate) {
      onMutate(fn);
    } else {
      fn();
    }
  };

  const api: ScriptImage = {
    get width() {
      return image.width;
    },
    get height() {
      return image.height;
    },
    getPixel(x: number, y: number): ScriptRGBA {
      return image.getRGBA(Math.floor(x), Math.floor(y));
    },
    setPixel(x: number, y: number, color: ScriptRGBA | string): void {
      runMutate(() => {
        image.setRGBA(Math.floor(x), Math.floor(y), normalizeColorInput(color));
      });
    },
    drawPixel(x: number, y: number, color: ScriptRGBA | string): void {
      runMutate(() => {
        image.setRGBA(Math.floor(x), Math.floor(y), normalizeColorInput(color));
      });
    },
    drawLine(
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      color: ScriptRGBA | string
    ): void {
      const c = normalizeColorInput(color);
      const pts = rasterizeLine(
        { x: Math.floor(x0), y: Math.floor(y0) },
        { x: Math.floor(x1), y: Math.floor(y1) }
      );
      runMutate(() => {
        for (const p of pts) {
          image.setRGBA(p.x, p.y, c);
        }
      });
    },
    drawRect(
      x: number,
      y: number,
      width: number,
      height: number,
      color: ScriptRGBA | string
    ): void {
      const c = normalizeColorInput(color);
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = x0 + Math.max(0, Math.floor(width) - 1);
      const y1 = y0 + Math.max(0, Math.floor(height) - 1);
      runMutate(() => {
        for (let px = x0; px <= x1; px++) {
          image.setRGBA(px, y0, c);
          image.setRGBA(px, y1, c);
        }
        for (let py = y0; py <= y1; py++) {
          image.setRGBA(x0, py, c);
          image.setRGBA(x1, py, c);
        }
      });
    },
    drawFilledRect(
      x: number,
      y: number,
      width: number,
      height: number,
      color: ScriptRGBA | string
    ): void {
      const c = normalizeColorInput(color);
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const w = Math.floor(width);
      const h = Math.floor(height);
      runMutate(() => {
        for (let py = y0; py < y0 + h; py++) {
          for (let px = x0; px < x0 + w; px++) {
            image.setRGBA(px, py, c);
          }
        }
      });
    },
    drawImage(src: ScriptImage, x: number, y: number): void {
      const ox = Math.floor(x);
      const oy = Math.floor(y);
      runMutate(() => {
        for (let sy = 0; sy < src.height; sy++) {
          for (let sx = 0; sx < src.width; sx++) {
            const c = src.getPixel(sx, sy);
            if (c.a > 0) {
              image.setRGBA(ox + sx, oy + sy, c);
            }
          }
        }
      });
    },
    clear(color?: ScriptRGBA | string): void {
      const c = color ? normalizeColorInput(color) : { r: 0, g: 0, b: 0, a: 0 };
      runMutate(() => {
        if (c.r === 0 && c.g === 0 && c.b === 0 && c.a === 0) {
          image.clear();
        } else {
          for (let y = 0; y < image.height; y++) {
            for (let x = 0; x < image.width; x++) {
              image.setRGBA(x, y, c);
            }
          }
        }
      });
    },
    getData(): Uint8Array {
      return new Uint8Array(image.data);
    },
    setData(bytes: Uint8Array): void {
      runMutate(() => {
        const len = Math.min(image.data.length, bytes.length);
        image.data.set(bytes.subarray(0, len));
      });
    },
    getPixelData(x: number, y: number): Uint8Array {
      const ix = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
      const iy = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
      const bpp = bytesPerPixel(image.colorMode);
      const offset = (iy * image.width + ix) * bpp;
      return image.data.subarray(offset, offset + bpp);
    },
  };

  return api;
}

export interface ScriptExecutionContext {
  doc: SpriteDocument | null;
  activeLayerId?: string;
  activeFrameIndex?: number;
  activeToolId?: string;
  fgColor?: RGBA;
  bgColor?: RGBA;
  scriptName?: string;
  timeoutMs?: number;
  strictTransactionMode?: boolean;
  permissions?: ScriptPermissionManifest;
  permissionStore?: ScriptPermissionStore;
  onPermissionRequest?: (req: ScriptPermissionRequest) => boolean;
  onSelectTool?: (toolId: string) => void;
  onSetFgColor?: (color: RGBA) => void;
  onSetBgColor?: (color: RGBA) => void;
  onSetActiveFrame?: (frameIndex: number) => void;
  onOpenNewDoc?: (doc: SpriteDocument) => void;
  onDialogRender?: (dialog: ScriptDialogResult) => void;
  onAlert?: (msg: string) => void;
  onConfirm?: (msg: string) => boolean;
  onPrompt?: (msg: string, defaultValue?: string) => string | null;
}

export interface ScriptExecutionResult {
  readonly success: boolean;
  readonly scriptHash: string;
  readonly logs: ScriptConsoleEntry[];
  readonly dialogs: ScriptDialogResult[];
  readonly alerts: string[];
  readonly error?: string;
  readonly errorLine?: number;
  readonly durationMs: number;
  readonly permissionRequests: ScriptPermissionRequest[];
}

/**
 * Compiles the instrumented script body into a callable runner.
 *
 * Production CSP forbids `unsafe-eval`, so `new Function()` cannot be used in the shipped
 * desktop/web builds (`script-src 'self' 'unsafe-inline' blob:`). The browser path therefore
 * wraps the script in a real ES module, loads it through a short-lived `blob:` URL — which the
 * CSP explicitly allows — and calls its default export. Node/unit-test runs (no DOM, no CSP)
 * keep the cheaper `Function` constructor path.
 */
async function compileScriptRunner(
  instrumentedJs: string
): Promise<
  (
    appArg: ScriptAppAPI,
    colorArg: ScriptColorNamespace,
    eventsArg: ScriptEventsAPI,
    consoleArg: { log: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
    checkTimeoutArg: () => void
  ) => unknown
> {
  const canUseBlobModules =
    typeof document !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof Blob !== "undefined";

  if (canUseBlobModules) {
    const moduleSource =
      "export default function __kpxRunSandboxedScript(app, Color, events, console, __checkTimeout) {\n" +
      '"use strict";\n' +
      instrumentedJs +
      "\n}\n";
    const blobUrl = URL.createObjectURL(new Blob([moduleSource], { type: "text/javascript" }));
    try {
      const mod = (await import(/* @vite-ignore */ blobUrl)) as {
        default: (...args: never[]) => unknown;
      };
      return mod.default as unknown as (
        appArg: ScriptAppAPI,
        colorArg: ScriptColorNamespace,
        eventsArg: ScriptEventsAPI,
        consoleArg: { log: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
        checkTimeoutArg: () => void
      ) => unknown;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  // Node / vitest fallback (no DOM, no CSP): the classic constructor is fine here.
  return new Function(
    "app",
    "Color",
    "events",
    "console",
    "__checkTimeout",
    `"use strict";\n${instrumentedJs}`
  ) as unknown as (
    appArg: ScriptAppAPI,
    colorArg: ScriptColorNamespace,
    eventsArg: ScriptEventsAPI,
    consoleArg: { log: (...a: unknown[]) => void; info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
    checkTimeoutArg: () => void
  ) => unknown;
}

/**
 * Executes a TypeScript/JavaScript user script against the Kekenik Pixel Scripting API
 * inside a sandboxed scope with permission enforcement, console capture, and undoable transactions.
 */
export async function executeKekenikScript(
  code: string,
  ctx: ScriptExecutionContext
): Promise<ScriptExecutionResult> {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  const scriptName = ctx.scriptName ?? "user-script.ts";
  const scriptHash = computeScriptHash(code);
  const logs: ScriptConsoleEntry[] = [];
  const dialogs: ScriptDialogResult[] = [];
  const alerts: string[] = [];
  const permissionRequests: ScriptPermissionRequest[] = [];
  const permStore = ctx.permissionStore ?? defaultScriptPermissionStore;
  const timeoutMs = ctx.timeoutMs ?? 30000;

  let currentDoc = ctx.doc;
  let currentLayerId =
    ctx.activeLayerId ??
    currentDoc?.sprite.layers[currentDoc.sprite.layers.length - 1]?.id ??
    "";
  let currentFrameIndex = ctx.activeFrameIndex ?? 0;
  let currentToolId = ctx.activeToolId ?? "tool.pencil";
  let currentFg: RGBA = ctx.fgColor ? { ...ctx.fgColor } : { r: 255, g: 0, b: 0, a: 255 };
  let currentBg: RGBA = ctx.bgColor ? { ...ctx.bgColor } : { r: 0, g: 0, b: 0, a: 255 };
  let inTransactionDepth = 0;

  const virtualFiles = new Map<string, string>();

  const checkTimeout = () => {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - start > timeoutMs) {
      throw new Error(`ScriptTimeoutError: Script exceeded ${timeoutMs}ms execution limit`);
    }
  };

  const requirePermission = (
    permission: ScriptPermissionKind,
    resource: string,
    operation: string
  ): void => {
    checkTimeout();
    if (ctx.permissions && permission in ctx.permissions) {
      if (ctx.permissions[permission] === false) {
        throw new Error(
          `PermissionDeniedError: Script denied '${permission}' for ${operation} (${resource})`
        );
      }
      if (ctx.permissions[permission] === true) {
        return;
      }
    }

    const remembered = permStore.getDecision(scriptHash, permission);
    if (remembered === true) return;
    if (remembered === false) {
      throw new Error(
        `PermissionDeniedError: Remembered denial of '${permission}' for ${scriptName}`
      );
    }

    const req: ScriptPermissionRequest = {
      scriptHash,
      scriptName,
      permission,
      resource,
      operation,
    };
    permissionRequests.push(req);

    const granted = ctx.onPermissionRequest ? ctx.onPermissionRequest(req) : true;
    permStore.setDecision(scriptHash, permission, granted);
    if (!granted) {
      throw new Error(
        `PermissionDeniedError: User denied '${permission}' for ${operation} (${resource})`
      );
    }
  };

  const runMutation = <T>(label: string, fn: () => T): T => {
    checkTimeout();
    if (!currentDoc) {
      return fn();
    }
    if (inTransactionDepth > 0) {
      return fn();
    }
    if (ctx.strictTransactionMode) {
      throw new Error(
        `TransactionRequiredError: Document mutation (${label}) must run inside app.transaction()`
      );
    }
    return appApi.transaction(label, fn);
  };

  const makeLayerFacade = (sprite: Sprite, layer: Layer, parent: Layer | null): ScriptLayer => {
    return {
      get id() {
        return layer.id;
      },
      get name() {
        return layer.name;
      },
      set name(val: string) {
        runMutation("Rename Layer", () => {
          layer.name = String(val);
        });
      },
      get opacity() {
        return layer.opacity;
      },
      set opacity(val: number) {
        runMutation("Set Layer Opacity", () => {
          layer.opacity = Math.max(0, Math.min(255, Math.round(val)));
        });
      },
      get visible() {
        return layer.visible;
      },
      set visible(val: boolean) {
        runMutation("Set Layer Visibility", () => {
          layer.visible = Boolean(val);
        });
      },
      get locked() {
        return !layer.editable;
      },
      set locked(val: boolean) {
        runMutation("Set Layer Lock", () => {
          layer.editable = !val;
        });
      },
      get blendMode() {
        return layer.blendMode;
      },
      set blendMode(val: string) {
        runMutation("Set Layer Blend Mode", () => {
          layer.blendMode = val as Layer["blendMode"];
        });
      },
      get isGroup() {
        return layer.kind === "group";
      },
      get children() {
        if (layer.kind === "group") {
          return (layer as GroupLayer).children
            .map((cid) => sprite.layers.find((l) => l.id === cid))
            .filter((ch): ch is Layer => Boolean(ch))
            .map((ch) => makeLayerFacade(sprite, ch, layer));
        }
        return [];
      },
      get parent() {
        return parent ? makeLayerFacade(sprite, parent, null) : null;
      },
      get cels() {
        return sprite.cels
          .filter((c) => c.layerId === layer.id)
          .sort((a, b) => a.frameIndex - b.frameIndex)
          .map((c) => makeCelFacade(sprite, c.layerId, c.frameIndex));
      },
      delete() {
        runMutation("Delete Layer", () => {
          if (sprite.layers.length <= 1) return;
          const idx = sprite.layers.findIndex((l) => l.id === layer.id);
          if (idx >= 0) {
            sprite.layers.splice(idx, 1);
            sprite.cels = sprite.cels.filter((c) => c.layerId !== layer.id);
          }
        });
      },
      moveTo(index: number) {
        runMutation("Move Layer", () => {
          const fromIdx = sprite.layers.findIndex((l) => l.id === layer.id);
          if (fromIdx < 0) return;
          const [removed] = sprite.layers.splice(fromIdx, 1);
          const clamped = Math.max(0, Math.min(sprite.layers.length, Math.floor(index)));
          sprite.layers.splice(clamped, 0, removed);
        });
      },
    };
  };

  const makeCelFacade = (sprite: Sprite, layerId: string, frameIndex: number): ScriptCel => {
    const resolveCel = (): Cel => {
      const existing = getCel(sprite, layerId, frameIndex);
      if (existing) return existing;
      const created = makeNewCel(layerId, frameIndex, sprite.width, sprite.height, sprite.colorMode);
      sprite.cels.push(created);
      return created;
    };

    return {
      get layerId() {
        return layerId;
      },
      get frameIndex() {
        return frameIndex;
      },
      get bounds() {
        const c = resolveCel();
        return { x: c.x, y: c.y, width: c.image.width, height: c.image.height };
      },
      get image() {
        const c = resolveCel();
        return createScriptImageFacade(c.image, (fn) => runMutation("Script Pixel Edit", fn));
      },
      get opacity() {
        return resolveCel().opacity;
      },
      set opacity(val: number) {
        runMutation("Set Cel Opacity", () => {
          resolveCel().opacity = Math.max(0, Math.min(255, Math.round(val)));
        });
      },
      get position() {
        const c = resolveCel();
        return { x: c.x, y: c.y };
      },
      set position(pos: { x: number; y: number }) {
        runMutation("Set Cel Position", () => {
          const c = resolveCel();
          c.x = Math.round(pos.x);
          c.y = Math.round(pos.y);
        });
      },
      delete() {
        runMutation("Delete Cel", () => {
          const c = getCel(sprite, layerId, frameIndex);
          if (c) c.image.clear();
        });
      },
    };
  };

  const makePaletteFacade = (sprite: Sprite): ScriptPalette => {
    const getSpan = () => sprite.palettes[0];
    return {
      get size() {
        return getSpan().colors.length;
      },
      getColor(index: number): ScriptRGBA {
        const colors = getSpan().colors;
        const c = colors[Math.max(0, Math.min(colors.length - 1, Math.floor(index)))];
        return c ? { ...c } : { r: 0, g: 0, b: 0, a: 255 };
      },
      setColor(index: number, color: ScriptRGBA | string): void {
        runMutation("Set Palette Color", () => {
          const colors = getSpan().colors;
          const idx = Math.floor(index);
          if (idx >= 0 && idx < colors.length) {
            colors[idx] = normalizeColorInput(color);
          }
        });
      },
      resize(newSize: number): void {
        runMutation("Resize Palette", () => {
          const n = Math.max(1, Math.min(256, Math.floor(newSize)));
          const span = getSpan();
          while (span.colors.length < n) {
            span.colors.push({ r: 0, g: 0, b: 0, a: 255 });
          }
          if (span.colors.length > n) {
            span.colors.length = n;
          }
        });
      },
      save(path: string): string {
        requirePermission("fs.write", path, "palette.save");
        const gpl = encodeGplPalette(getSpan().colors, sprite.name);
        virtualFiles.set(path, gpl);
        void getPlatform().writeTextFile(`${getPlatform().dataDir()}/${path}`, gpl);
        return gpl;
      },
      load(path: string): boolean {
        requirePermission("fs.read", path, "palette.load");
        const raw = virtualFiles.get(path);
        if (!raw) return false;
        const parsed = decodeGplPalette(raw);
        if (parsed.colors.length > 0) {
          runMutation("Load Palette", () => {
            getSpan().colors = parsed.colors.map((c) => ({ ...c }));
          });
          return true;
        }
        return false;
      },
    };
  };

  const makeSelectionFacade = (sprite: Sprite): ScriptSelection => {
    return {
      get isEmpty() {
        return sprite.mask.isEmpty;
      },
      get bounds() {
        return sprite.mask.bounds ? { ...sprite.mask.bounds } : null;
      },
      selectRect(x: number, y: number, width: number, height: number): void {
        runMutation("Select Rect", () => {
          const m = createRectMarqueeMask(
            sprite.width,
            sprite.height,
            { x: Math.floor(x), y: Math.floor(y) },
            { x: Math.floor(x + width - 1), y: Math.floor(y + height - 1) }
          );
          sprite.mask = m;
        });
      },
      selectEllipse(x: number, y: number, width: number, height: number): void {
        runMutation("Select Ellipse", () => {
          const m = createEllipseMarqueeMask(
            sprite.width,
            sprite.height,
            { x: Math.floor(x), y: Math.floor(y) },
            { x: Math.floor(x + width - 1), y: Math.floor(y + height - 1) }
          );
          sprite.mask = m;
        });
      },
      selectAll(): void {
        runMutation("Select All", () => {
          sprite.mask.selectAll();
        });
      },
      deselect(): void {
        runMutation("Deselect", () => {
          sprite.mask.clear();
        });
      },
      getMask(): Uint8Array {
        return new Uint8Array(sprite.mask.bits);
      },
    };
  };

  const makeSpriteFacade = (doc: SpriteDocument): ScriptSprite => {
    const sprite = doc.sprite as Sprite;
    return {
      get width() {
        return sprite.width;
      },
      get height() {
        return sprite.height;
      },
      get colorMode() {
        return sprite.colorMode;
      },
      get name() {
        return sprite.name;
      },
      set name(val: string) {
        runMutation("Rename Sprite", () => {
          sprite.name = String(val);
        });
      },
      get layers() {
        return sprite.layers.map((l) => makeLayerFacade(sprite, l, null));
      },
      get palette() {
        return makePaletteFacade(sprite);
      },
      get frames() {
        return sprite.frames.map((f, index) => ({ index, durationMs: f.durationMs }));
      },
      get tags(): ScriptTag[] {
        return sprite.tags.map((t) => ({
          get id() {
            return t.id;
          },
          get name() {
            return t.name;
          },
          set name(v: string) {
            runMutation("Rename Tag", () => {
              t.name = v;
            });
          },
          get fromFrame() {
            return t.fromFrame;
          },
          set fromFrame(v: number) {
            runMutation("Update Tag Range", () => {
              t.fromFrame = Math.max(0, Math.floor(v));
            });
          },
          get toFrame() {
            return t.toFrame;
          },
          set toFrame(v: number) {
            runMutation("Update Tag Range", () => {
              t.toFrame = Math.max(t.fromFrame, Math.floor(v));
            });
          },
          get direction() {
            return t.direction;
          },
          set direction(v) {
            runMutation("Update Tag Direction", () => {
              t.direction = v;
            });
          },
          get color() {
            return t.color;
          },
          set color(v: string) {
            runMutation("Update Tag Color", () => {
              t.color = v;
            });
          },
          get repeats() {
            return t.repeat ?? 0;
          },
          set repeats(v: number) {
            runMutation("Update Tag Repeats", () => {
              t.repeat = Math.max(0, Math.floor(v));
            });
          },
        }));
      },
      get slices(): ScriptSlice[] {
        return sprite.slices.map((s) => {
          const key0 = s.keys[0] ?? {
            frameIndex: 0,
            bounds: { x: 0, y: 0, width: 8, height: 8 },
          };
          return {
            get id() {
              return s.id;
            },
            get name() {
              return s.name;
            },
            set name(v: string) {
              runMutation("Rename Slice", () => {
                s.name = v;
              });
            },
            get color() {
              return s.color;
            },
            set color(v: string) {
              runMutation("Set Slice Color", () => {
                s.color = v;
              });
            },
            get bounds() {
              return { ...key0.bounds };
            },
            set bounds(b: { x: number; y: number; width: number; height: number }) {
              runMutation("Set Slice Bounds", () => {
                key0.bounds = { ...b };
              });
            },
            get center() {
              return key0.center ? { ...key0.center } : undefined;
            },
            set center(c) {
              runMutation("Set Slice Center", () => {
                key0.center = c ? { ...c } : undefined;
              });
            },
            get pivot() {
              return key0.pivot ? { ...key0.pivot } : undefined;
            },
            set pivot(p) {
              runMutation("Set Slice Pivot", () => {
                key0.pivot = p ? { ...p } : undefined;
              });
            },
          };
        });
      },
      get tilesets(): ScriptTileset[] {
        return sprite.tilesets.map((ts) => ({
          get id() {
            return ts.id;
          },
          get name() {
            return ts.name;
          },
          set name(v: string) {
            runMutation("Rename Tileset", () => {
              ts.name = v;
            });
          },
          get tileWidth() {
            return ts.tileWidth;
          },
          set tileWidth(v: number) {
            runMutation("Set Tileset Width", () => {
              ts.tileWidth = Math.max(1, Math.floor(v));
            });
          },
          get tileHeight() {
            return ts.tileHeight;
          },
          set tileHeight(v: number) {
            runMutation("Set Tileset Height", () => {
              ts.tileHeight = Math.max(1, Math.floor(v));
            });
          },
          get tileCount() {
            return ts.tiles.length;
          },
          save(path: string): string {
            requirePermission("fs.write", path, "tileset.save");
            const payload = JSON.stringify({
              id: ts.id,
              name: ts.name,
              tileWidth: ts.tileWidth,
              tileHeight: ts.tileHeight,
              tileCount: ts.tiles.length,
            });
            virtualFiles.set(path, payload);
            return payload;
          },
          load(path: string): boolean {
            requirePermission("fs.read", path, "tileset.load");
            const raw = virtualFiles.get(path);
            if (!raw) return false;
            const parsed = JSON.parse(raw) as { name?: string };
            if (parsed.name) {
              runMutation("Load Tileset", () => {
                ts.name = parsed.name!;
              });
            }
            return true;
          },
        }));
      },
      get selection() {
        return makeSelectionFacade(sprite);
      },
      get userData() {
        return { ...sprite.userData };
      },
      set userData(val: { text: string; color?: string }) {
        runMutation("Set Sprite UserData", () => {
          sprite.userData = { text: val.text ?? "", color: val.color };
        });
      },
      addLayer(name = `Layer ${sprite.layers.length + 1}`): ScriptLayer {
        return runMutation("Add Layer", () => {
          const newLayer = makeNewImageLayer(name);
          sprite.layers.push(newLayer);
          for (let f = 0; f < sprite.frames.length; f++) {
            sprite.cels.push(
              makeNewCel(newLayer.id, f, sprite.width, sprite.height, sprite.colorMode)
            );
          }
          currentLayerId = newLayer.id;
          scriptEventsBus.emit("layerChange", { layerId: newLayer.id, name: newLayer.name });
          return makeLayerFacade(sprite, newLayer, null);
        });
      },
      addFrame(durationMs = 100): number {
        return runMutation("Add Frame", () => {
          const newIndex = sprite.frames.length;
          sprite.frames.push(makeNewFrame(newIndex, durationMs));
          for (const l of sprite.layers) {
            if (l.kind === "image") {
              sprite.cels.push(
                makeNewCel(l.id, newIndex, sprite.width, sprite.height, sprite.colorMode)
              );
            }
          }
          currentFrameIndex = newIndex;
          scriptEventsBus.emit("frameChange", { frameIndex: newIndex });
          return newIndex;
        });
      },
      crop(x: number, y: number, width: number, height: number): void {
        runMutation("Crop Sprite", () => {
          const nw = Math.max(1, Math.floor(width));
          const nh = Math.max(1, Math.floor(height));
          const ox = Math.floor(x);
          const oy = Math.floor(y);
          for (const cel of sprite.cels) {
            cel.image = cel.image.crop({ x: ox, y: oy, width: nw, height: nh });
          }
          sprite.width = nw;
          sprite.height = nh;
          sprite.mask = new Mask(nw, nh);
        });
      },
      resize(width: number, height: number): void {
        runMutation("Resize Sprite", () => {
          const nw = Math.max(1, Math.floor(width));
          const nh = Math.max(1, Math.floor(height));
          for (const cel of sprite.cels) {
            const resized = new PixelImage(nw, nh, sprite.colorMode);
            for (let y = 0; y < nh; y++) {
              for (let x = 0; x < nw; x++) {
                const sx = Math.min(
                  cel.image.width - 1,
                  Math.floor((x / nw) * cel.image.width)
                );
                const sy = Math.min(
                  cel.image.height - 1,
                  Math.floor((y / nh) * cel.image.height)
                );
                resized.setRGBA(x, y, cel.image.getRGBA(sx, sy));
              }
            }
            cel.image = resized;
          }
          sprite.width = nw;
          sprite.height = nh;
          sprite.mask = new Mask(nw, nh);
        });
      },
      flatten(visibleOnly = false): void {
        runMutation("Flatten Layers", () => {
          if (sprite.layers.length <= 1) return;
          const baseLayer = makeNewImageLayer("Flattened");
          const newCels: Cel[] = [];
          for (let f = 0; f < sprite.frames.length; f++) {
            const merged = new PixelImage(sprite.width, sprite.height, sprite.colorMode);
            for (const l of sprite.layers) {
              if (visibleOnly && !l.visible) continue;
              const c = getCel(sprite, l.id, f);
              if (!c) continue;
              for (let y = 0; y < sprite.height; y++) {
                for (let x = 0; x < sprite.width; x++) {
                  const src = c.image.getRGBA(x, y);
                  if (src.a > 0) {
                    const dst = merged.getRGBA(x, y);
                    merged.setRGBA(x, y, blendRGBA(dst, src, l.blendMode, l.opacity));
                  }
                }
              }
            }
            const cel = makeNewCel(baseLayer.id, f, sprite.width, sprite.height, sprite.colorMode);
            cel.image = merged;
            newCels.push(cel);
          }
          sprite.layers = [baseLayer];
          sprite.cels = newCels;
          currentLayerId = baseLayer.id;
        });
      },
      saveAs(path: string): boolean {
        requirePermission("fs.write", path, "sprite.saveAs");
        scriptEventsBus.emit("beforeSave", { path, spriteName: sprite.name });
        const snap = serializeSnapshot(sprite);
        virtualFiles.set(path, snap);
        void getPlatform().writeTextFile(`${getPlatform().dataDir()}/${path}`, snap);
        scriptEventsBus.emit("afterSave", { path, spriteName: sprite.name });
        return true;
      },
    };
  };

  const appApi: ScriptAppAPI = {
    version: "1.5.0",
    get activeSprite() {
      return currentDoc ? makeSpriteFacade(currentDoc) : null;
    },
    get activeLayer() {
      if (!currentDoc) return null;
      const sprite = currentDoc.sprite as Sprite;
      const layer =
        sprite.layers.find((l) => l.id === currentLayerId) ??
        sprite.layers[sprite.layers.length - 1];
      return layer ? makeLayerFacade(sprite, layer, null) : null;
    },
    get activeFrame() {
      return currentFrameIndex;
    },
    set activeFrame(idx: number) {
      if (!currentDoc) return;
      const clamped = Math.max(
        0,
        Math.min(currentDoc.sprite.frames.length - 1, Math.floor(idx))
      );
      currentFrameIndex = clamped;
      ctx.onSetActiveFrame?.(clamped);
      scriptEventsBus.emit("frameChange", { frameIndex: clamped });
    },
    get activeCel() {
      if (!currentDoc) return null;
      const sprite = currentDoc.sprite as Sprite;
      const lid =
        currentLayerId ||
        sprite.layers[sprite.layers.length - 1]?.id ||
        "";
      return makeCelFacade(sprite, lid, currentFrameIndex);
    },
    get activeTool() {
      return currentToolId;
    },
    set activeTool(toolId: string) {
      currentToolId = toolId;
      ctx.onSelectTool?.(toolId);
      scriptEventsBus.emit("toolChange", { toolId });
    },
    get fgColor() {
      return { ...currentFg };
    },
    set fgColor(c: ScriptRGBA) {
      currentFg = normalizeColorInput(c);
      ctx.onSetFgColor?.(currentFg);
    },
    get bgColor() {
      return { ...currentBg };
    },
    set bgColor(c: ScriptRGBA) {
      currentBg = normalizeColorInput(c);
      ctx.onSetBgColor?.(currentBg);
    },
    get selection() {
      return currentDoc ? makeSelectionFacade(currentDoc.sprite as Sprite) : null;
    },
    events: scriptEventsBus,
    commands: {
      list() {
        return CommandRegistry.getAll().map((c) => c.id);
      },
      run(id: string, args?: Record<string, unknown>) {
        const cmd = CommandRegistry.get(id);
        if (cmd) {
          void cmd.run({ activeDoc: currentDoc, args });
        }
      },
    },
    tools: {
      list() {
        return ToolRegistry.getAll().map((t) => t.id);
      },
      select(id: string) {
        currentToolId = id;
        ctx.onSelectTool?.(id);
        scriptEventsBus.emit("toolChange", { toolId: id });
      },
    },
    fs: {
      readText(path: string): string | null {
        requirePermission("fs.read", path, "fs.readText");
        return virtualFiles.get(path) ?? null;
      },
      writeText(path: string, content: string): void {
        requirePermission("fs.write", path, "fs.writeText");
        virtualFiles.set(path, String(content));
        void getPlatform().writeTextFile(
          `${getPlatform().dataDir()}/${path}`,
          String(content)
        );
      },
      list(dir = ""): string[] {
        requirePermission("fs.read", dir || "/", "fs.list");
        const prefix = dir ? `${dir.replace(/\/$/, "")}/` : "";
        return Array.from(virtualFiles.keys()).filter((k) => k.startsWith(prefix));
      },
      exists(path: string): boolean {
        requirePermission("fs.read", path, "fs.exists");
        return virtualFiles.has(path);
      },
    },
    json: {
      encode(value: unknown): string {
        return JSON.stringify(value, null, 2);
      },
      decode<T = unknown>(text: string): T {
        return JSON.parse(text) as T;
      },
    },
    alert(msg: string): void {
      requirePermission("dialogs", "alert", "app.alert");
      alerts.push(String(msg));
      ctx.onAlert?.(String(msg));
    },
    confirm(msg: string): boolean {
      requirePermission("dialogs", "confirm", "app.confirm");
      return ctx.onConfirm ? ctx.onConfirm(String(msg)) : true;
    },
    prompt(msg: string, defaultValue = ""): string | null {
      requirePermission("dialogs", "prompt", "app.prompt");
      return ctx.onPrompt ? ctx.onPrompt(String(msg), defaultValue) : defaultValue;
    },
    dialog(builderFn: (dlg: ScriptDialogBuilder) => void): ScriptDialogResult {
      requirePermission("dialogs", "custom_dialog", "app.dialog");
      let dlgTitle = "Script Dialog";
      const widgets: ScriptDialogWidgetSpec[] = [];
      const values: Record<string, unknown> = {};
      const listeners = new Map<string, Array<(data: Record<string, unknown>) => void>>();

      const builder: ScriptDialogBuilder = {
        title(text: string) {
          dlgTitle = text;
          return builder;
        },
        label(opts) {
          const spec = typeof opts === "string" ? { text: opts } : opts;
          widgets.push({
            id: spec.id ?? `lbl_${widgets.length}`,
            type: "label",
            text: spec.text,
          });
          return builder;
        },
        button(opts) {
          widgets.push({
            id: opts.id,
            type: "button",
            text: opts.text,
          });
          if (opts.onClick) {
            const arr = listeners.get(`click:${opts.id}`) ?? [];
            arr.push(() => opts.onClick!());
            listeners.set(`click:${opts.id}`, arr);
          }
          return builder;
        },
        slider(opts) {
          values[opts.id] = opts.value;
          widgets.push({
            id: opts.id,
            type: "slider",
            label: opts.label,
            min: opts.min,
            max: opts.max,
            value: opts.value,
          });
          return builder;
        },
        color(opts) {
          const rgba = normalizeColorInput(opts.value);
          values[opts.id] = rgba;
          widgets.push({
            id: opts.id,
            type: "color",
            label: opts.label,
            value: rgbaToHex(rgba),
          });
          return builder;
        },
        combo(opts) {
          const val = opts.value ?? opts.options[0] ?? "";
          values[opts.id] = val;
          widgets.push({
            id: opts.id,
            type: "combo",
            label: opts.label,
            options: [...opts.options],
            value: val,
          });
          return builder;
        },
        entry(opts) {
          const val = opts.value ?? "";
          values[opts.id] = val;
          widgets.push({
            id: opts.id,
            type: "entry",
            label: opts.label,
            value: val,
          });
          return builder;
        },
        checkbox(opts) {
          const checked = Boolean(opts.checked);
          values[opts.id] = checked;
          widgets.push({
            id: opts.id,
            type: "checkbox",
            label: opts.label,
            checked,
            value: checked,
          });
          return builder;
        },
        canvas(opts) {
          const canvasImg = new PixelImage(opts.width, opts.height, "rgba");
          if (opts.draw) {
            opts.draw(createScriptImageFacade(canvasImg));
          }
          widgets.push({
            id: opts.id,
            type: "canvas",
            width: opts.width,
            height: opts.height,
            canvasRgba: new Uint8Array(canvasImg.data),
          });
          return builder;
        },
        on(event, fn) {
          const arr = listeners.get(event) ?? [];
          arr.push(fn);
          listeners.set(event, arr);
          return builder;
        },
      };

      builderFn(builder);

      const result: ScriptDialogResult = {
        id: createModelId("script_dlg"),
        title: dlgTitle,
        widgets,
        values,
        confirmed: true,
        trigger(event: string, payload?: Record<string, unknown>) {
          if (payload) {
            Object.assign(values, payload);
          }
          const handlers = listeners.get(event) ?? [];
          for (const h of handlers) {
            h({ ...values, ...payload });
          }
        },
      };

      dialogs.push(result);
      ctx.onDialogRender?.(result);
      return result;
    },
    transaction<T>(label: string, fn: () => T): T {
      checkTimeout();
      if (!currentDoc) {
        return fn();
      }
      if (inTransactionDepth > 0) {
        return fn();
      }
      const beforeSnap = serializeSnapshot(currentDoc.sprite);
      inTransactionDepth++;
      try {
        const res = fn();
        inTransactionDepth--;
        const afterSnap = serializeSnapshot(currentDoc.sprite);
        if (beforeSnap !== afterSnap) {
          currentDoc.execute(new ScriptTransactionCommand(label, beforeSnap, afterSnap));
        }
        return res;
      } catch (err) {
        inTransactionDepth--;
        const restored = deserializeSnapshot(beforeSnap);
        applyRestoredSpriteInPlace(currentDoc.sprite as Sprite, restored);
        throw err;
      }
    },
    open(path: string): ScriptSprite | null {
      requirePermission("fs.read", path, "app.open");
      const raw = virtualFiles.get(path);
      if (!raw) return null;
      const sprite = deserializeSnapshot(raw);
      const doc = new SpriteDocument(sprite);
      currentDoc = doc;
      currentLayerId = doc.sprite.layers[doc.sprite.layers.length - 1]?.id ?? "";
      currentFrameIndex = 0;
      ctx.onOpenNewDoc?.(doc);
      scriptEventsBus.emit("afterOpen", { path, spriteName: sprite.name });
      return makeSpriteFacade(doc);
    },
    save(path = "sprite.kpx-snapshot"): boolean {
      if (!currentDoc) return false;
      requirePermission("fs.write", path, "app.save");
      scriptEventsBus.emit("beforeSave", { path, spriteName: currentDoc.sprite.name });
      const snap = serializeSnapshot(currentDoc.sprite);
      virtualFiles.set(path, snap);
      void getPlatform().writeTextFile(`${getPlatform().dataDir()}/${path}`, snap);
      scriptEventsBus.emit("afterSave", { path, spriteName: currentDoc.sprite.name });
      return true;
    },
    new(
      width: number,
      height: number,
      colorMode: ColorMode = "rgba"
    ): ScriptSprite {
      const sprite = createSprite({
        name: `Script-${width}x${height}.ase`,
        width: Math.max(1, Math.floor(width)),
        height: Math.max(1, Math.floor(height)),
        colorMode,
      });
      const doc = new SpriteDocument(sprite);
      currentDoc = doc;
      currentLayerId = doc.sprite.layers[0].id;
      currentFrameIndex = 0;
      ctx.onOpenNewDoc?.(doc);
      scriptEventsBus.emit("afterOpen", { path: sprite.name, spriteName: sprite.name });
      return makeSpriteFacade(doc);
    },
    fetch(url: string) {
      requirePermission("network", url, "app.fetch");
      return {
        status: 200,
        ok: true,
        text: JSON.stringify({ url, sandboxed: true, via: "PlatformAPI.fetch" }),
      };
    },
  };

  const sandboxConsole = {
    log: (...args: unknown[]) => {
      checkTimeout();
      logs.push({
        level: "log",
        message: args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" "),
        timestamp: new Date().toISOString().slice(11, 19),
      });
    },
    info: (...args: unknown[]) => {
      checkTimeout();
      logs.push({
        level: "log",
        message: args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" "),
        timestamp: new Date().toISOString().slice(11, 19),
      });
    },
    warn: (...args: unknown[]) => {
      checkTimeout();
      logs.push({
        level: "warn",
        message: args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" "),
        timestamp: new Date().toISOString().slice(11, 19),
      });
    },
    error: (...args: unknown[]) => {
      checkTimeout();
      logs.push({
        level: "error",
        message: args
          .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
          .join(" "),
        timestamp: new Date().toISOString().slice(11, 19),
      });
    },
  };

  try {
    validateScriptSandboxSafety(code);
    const jsCode = transpileTypeScriptForSandbox(code);
    const instrumentedJs = jsCode
      .replace(/\bwhile\s*\(([^)]+)\)\s*\{/g, "while ($1) { __checkTimeout();")
      .replace(/\bfor\s*\(([^)]+)\)\s*\{/g, "for ($1) { __checkTimeout();");

    const runner = await compileScriptRunner(instrumentedJs);
    await runner(appApi, ScriptColorAPI, scriptEventsBus, sandboxConsole, checkTimeout);

    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      success: true,
      scriptHash,
      logs,
      dialogs,
      alerts,
      durationMs: Math.max(0.1, Number((end - start).toFixed(2))),
      permissionRequests,
    };
  } catch (err) {
    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack : "";
    let errorLine: number | undefined;
    // Blob-module frames look like `blob:file:///...:12:5`, constructor frames like
    // `<anonymous>:12:5`; both are offset by the two wrapper lines we prepend.
    const match = stack.match(/(?:<anonymous>|blob:[^\s)]+?):(\d+):(\d+)/);
    if (match) {
      errorLine = Math.max(1, parseInt(match[1], 10) - 2);
    }
    logs.push({
      level: "error",
      message: msg,
      line: errorLine,
      timestamp: new Date().toISOString().slice(11, 19),
    });
    appLogger.warn("Scripting", `Script error in ${scriptName}: ${msg}`);
    return {
      success: false,
      scriptHash,
      logs,
      dialogs,
      alerts,
      error: msg,
      errorLine,
      durationMs: Math.max(0.1, Number((end - start).toFixed(2))),
      permissionRequests,
    };
  }
}

// ---------------------------------------------------------------------------
// Part C: Built-in Sample Scripts Catalog (12 scripts matching assets/samples/scripts/*.ts)
// ---------------------------------------------------------------------------

export interface SampleScriptEntry {
  readonly id: string;
  readonly fileName: string;
  readonly title: string;
  readonly description: string;
  readonly code: string;
}

export const BUILTIN_SAMPLE_SCRIPTS: readonly SampleScriptEntry[] = [
  {
    id: "sample.export_each_layer",
    fileName: "export-each-layer.ts",
    title: "1. Export Each Visible Layer as PNG",
    description: "Exports every visible layer to virtual PNG descriptors and updates sprite metadata.",
    code: `// Sample Script 1: Export Every Visible Layer as PNG
app.transaction("Export Visible Layers", () => {
  const sprite = app.activeSprite;
  if (!sprite) return;
  const exported: string[] = [];
  for (const layer of sprite.layers) {
    if (layer.visible) {
      const fileName = \`exports/\${layer.name.toLowerCase().replace(/\\s+/g, "_")}.png.json\`;
      const cel = layer.cels[0];
      const width = cel ? cel.image.width : sprite.width;
      const height = cel ? cel.image.height : sprite.height;
      app.fs.writeText(
        fileName,
        app.json.encode({
          layer: layer.name,
          width,
          height,
          format: "png",
        })
      );
      exported.push(fileName);
    }
  }
  sprite.userData = {
    text: \`exported_layers:\${exported.length}\`,
    color: "#22c55e",
  };
  console.info(\`Exported \${exported.length} visible layers: \${exported.join(", ")}\`);
});`,
  },
  {
    id: "sample.palette_from_image",
    fileName: "palette-from-image.ts",
    title: "2. Build Palette from Unique Colors",
    description: "Scans the active cel's pixels and populates the sprite palette with unique colors.",
    code: `// Sample Script 2: Build Palette from Unique Colors in Active Cel
app.transaction("Palette from Image", () => {
  const sprite = app.activeSprite;
  const cel = app.activeCel;
  if (!sprite || !cel) return;

  const img = cel.image;
  const seen = new Set<string>();
  const uniqueColors: Array<{ r: number; g: number; b: number; a: number }> = [
    { r: 0, g: 0, b: 0, a: 0 },
  ];

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = img.getPixel(x, y);
      if (c.a > 0) {
        const key = \`\${c.r},\${c.g},\${c.b},\${c.a}\`;
        if (!seen.has(key) && uniqueColors.length < 64) {
          seen.add(key);
          uniqueColors.push(c);
        }
      }
    }
  }

  sprite.palette.resize(Math.max(2, uniqueColors.length));
  for (let i = 0; i < uniqueColors.length; i++) {
    sprite.palette.setColor(i, uniqueColors[i]);
  }
  console.info(\`Extracted \${uniqueColors.length} unique colors into palette.\`);
});`,
  },
  {
    id: "sample.outline_all_frames",
    fileName: "outline-all-frames.ts",
    title: "3. Outline All Frames",
    description: "Adds a 1px outline around all visible pixels across every frame on the active layer.",
    code: `// Sample Script 3: Outline All Frames
app.transaction("Outline All Frames", () => {
  const layer = app.activeLayer;
  if (!layer) return;
  const outlineColor = { r: 20, g: 16, b: 28, a: 255 };

  for (const cel of layer.cels) {
    const img = cel.image;
    const w = img.width;
    const h = img.height;
    const toOutline: Array<{ x: number; y: number }> = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (img.getPixel(x, y).a === 0) {
          const hasOpaqueNeighbor =
            (x > 0 && img.getPixel(x - 1, y).a > 0) ||
            (x + 1 < w && img.getPixel(x + 1, y).a > 0) ||
            (y > 0 && img.getPixel(x, y - 1).a > 0) ||
            (y + 1 < h && img.getPixel(x, y + 1).a > 0);
          if (hasOpaqueNeighbor) {
            toOutline.push({ x, y });
          }
        }
      }
    }

    for (const pt of toOutline) {
      img.setPixel(pt.x, pt.y, outlineColor);
    }
  }
  console.info(\`Outlined \${layer.cels.length} frame cels on layer "\${layer.name}".\`);
});`,
  },
  {
    id: "sample.random_noise_brush",
    fileName: "random-noise-brush.ts",
    title: "4. Random Noise Brush in Selection",
    description: "Paints deterministic pseudo-random pixel noise inside the current selection.",
    code: `// Sample Script 4: Random Noise Brush in Selection
app.transaction("Random Noise Brush", () => {
  const sprite = app.activeSprite;
  const cel = app.activeCel;
  if (!sprite || !cel) return;

  const img = cel.image;
  const bounds = sprite.selection.bounds ?? {
    x: 0,
    y: 0,
    width: img.width,
    height: img.height,
  };

  let seed = 1337;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed & 0xff;
  };

  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      if ((x + y) % 2 === 0) {
        img.setPixel(x, y, {
          r: nextRand(),
          g: nextRand(),
          b: nextRand(),
          a: 255,
        });
      }
    }
  }
  console.info(\`Painted noise pattern in region (\${bounds.width}x\${bounds.height}).\`);
});`,
  },
  {
    id: "sample.batch_rename_layers",
    fileName: "batch-rename-layers.ts",
    title: "5. Batch Rename Layers",
    description: "Renames all layers in the sprite with an indexed 'spr_NN_' prefix.",
    code: `// Sample Script 5: Batch Rename Layers with Prefix
app.transaction("Batch Rename Layers", () => {
  const sprite = app.activeSprite;
  if (!sprite) return;
  let index = 1;
  for (const layer of sprite.layers) {
    if (!layer.name.startsWith("spr_")) {
      layer.name = \`spr_\${String(index).padStart(2, "0")}_\${layer.name}\`;
    }
    index++;
  }
  console.info(\`Renamed \${sprite.layers.length} layers with 'spr_' prefix.\`);
});`,
  },
  {
    id: "sample.flip_horizontal_all_frames",
    fileName: "flip-horizontal-all-frames.ts",
    title: "6. Flip Horizontal All Frames",
    description: "Horizontally mirrors every frame cel on the active layer.",
    code: `// Sample Script 6: Flip Horizontal All Frames
app.transaction("Flip Horizontal All Frames", () => {
  const layer = app.activeLayer;
  if (!layer) return;

  for (const cel of layer.cels) {
    const img = cel.image;
    const w = img.width;
    const h = img.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < Math.floor(w / 2); x++) {
        const left = img.getPixel(x, y);
        const right = img.getPixel(w - 1 - x, y);
        img.setPixel(x, y, right);
        img.setPixel(w - 1 - x, y, left);
      }
    }
  }
  console.info(\`Flipped \${layer.cels.length} cels horizontally.\`);
});`,
  },
  {
    id: "sample.grid_overlay_demo",
    fileName: "grid-overlay-demo.ts",
    title: "7. Grid Overlay Demo",
    description: "Draws an 8x8 pixel guide grid onto the active cel.",
    code: `// Sample Script 7: Grid Overlay Demo
app.transaction("Grid Overlay Demo", () => {
  const cel = app.activeCel;
  if (!cel) return;
  const img = cel.image;
  const gridColor = { r: 72, g: 187, b: 255, a: 180 };

  for (let x = 0; x < img.width; x += 8) {
    img.drawLine(x, 0, x, img.height - 1, gridColor);
  }
  for (let y = 0; y < img.height; y += 8) {
    img.drawLine(0, y, img.width - 1, y, gridColor);
  }
  console.info(\`Drew 8x8 grid overlay across \${img.width}x\${img.height} cel.\`);
});`,
  },
  {
    id: "sample.palette_export_gpl",
    fileName: "palette-export-gpl.ts",
    title: "8. Export Palette to GIMP .gpl",
    description: "Exports the active sprite's palette to GIMP .gpl format.",
    code: `// Sample Script 8: Export Palette to GIMP .gpl
app.transaction("Export Palette to GPL", () => {
  const sprite = app.activeSprite;
  if (!sprite) return;
  const gplText = sprite.palette.save("exports/active-palette.gpl");
  sprite.userData = {
    text: \`gpl_exported:\${sprite.palette.size}\`,
    color: "#f59e0b",
  };
  console.info(\`Saved GIMP .gpl palette (\${sprite.palette.size} colors, \${gplText.length} bytes).\`);
});`,
  },
  {
    id: "sample.sprite_from_csv",
    fileName: "sprite-from-csv.ts",
    title: "9. Build Sprite from CSV of Pixels",
    description: "Parses a CSV matrix of color indices and draws the pixel art onto the active cel.",
    code: `// Sample Script 9: Sprite from CSV of Pixels
app.transaction("Sprite from CSV", () => {
  const cel = app.activeCel;
  if (!cel) return;

  const csv = [
    "0,1,1,1,1,0",
    "1,2,1,1,2,1",
    "1,1,1,1,1,1",
    "1,3,1,1,3,1",
    "0,1,3,3,1,0",
    "0,0,1,1,0,0",
  ].join("\\n");

  const paletteMap: Record<string, { r: number; g: number; b: number; a: number }> = {
    "0": { r: 0, g: 0, b: 0, a: 0 },
    "1": { r: 250, g: 204, b: 21, a: 255 },
    "2": { r: 24, g: 24, b: 27, a: 255 },
    "3": { r: 239, g: 68, b: 68, a: 255 },
  };

  const rows = csv.trim().split("\\n");
  for (let y = 0; y < rows.length; y++) {
    const cols = rows[y].split(",");
    for (let x = 0; x < cols.length; x++) {
      const code = cols[x].trim();
      const col = paletteMap[code];
      if (col && col.a > 0) {
        cel.image.setPixel(x, y, col);
      }
    }
  }
  console.info(\`Built \${rows[0].split(",").length}x\${rows.length} pixel art from CSV matrix.\`);
});`,
  },
  {
    id: "sample.stamp_brush",
    fileName: "stamp-brush.ts",
    title: "10. Stamp Brush Along Path",
    description: "Stamps a 3x3 cross brush along a diagonal path using the foreground color.",
    code: `// Sample Script 10: Stamp Brush Along Path
app.transaction("Stamp Brush Path", () => {
  const cel = app.activeCel;
  if (!cel) return;
  const img = cel.image;
  const fg = app.fgColor;

  const steps = Math.min(img.width, img.height);
  for (let i = 1; i < steps - 1; i += 2) {
    const cx = i;
    const cy = i;
    img.setPixel(cx, cy, fg);
    img.setPixel(cx - 1, cy, fg);
    img.setPixel(cx + 1, cy, fg);
    img.setPixel(cx, cy - 1, fg);
    img.setPixel(cx, cy + 1, fg);
  }
  console.info(\`Stamped 3x3 cross brush along diagonal path (\${steps}px).\`);
});`,
  },
  {
    id: "sample.stats_panel",
    fileName: "stats-panel.ts",
    title: "11. Sprite Statistics Dialog",
    description: "Computes opaque pixel count, unique color count, and layer count and opens a dialog.",
    code: `// Sample Script 11: Stats Panel Dialog
app.transaction("Sprite Stats Dialog", () => {
  const sprite = app.activeSprite;
  const cel = app.activeCel;
  if (!sprite || !cel) return;

  const img = cel.image;
  let opaquePixels = 0;
  const uniqueColors = new Set<string>();

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = img.getPixel(x, y);
      if (c.a > 0) {
        opaquePixels++;
        uniqueColors.add(\`\${c.r},\${c.g},\${c.b},\${c.a}\`);
      }
    }
  }

  sprite.userData = {
    text: \`stats:pixels=\${opaquePixels},colors=\${uniqueColors.size},layers=\${sprite.layers.length}\`,
    color: "#38bdf8",
  };

  app.dialog((dlg) => {
    dlg
      .title("Sprite Statistics")
      .label(\`Sprite: \${sprite.name} (\${sprite.width}x\${sprite.height})\`)
      .label(\`Opaque Pixels in Active Cel: \${opaquePixels}\`)
      .label(\`Unique Colors in Active Cel: \${uniqueColors.size}\`)
      .label(\`Total Layers: \${sprite.layers.length}\`)
      .button({ id: "ok", text: "Close" });
  });

  console.info(
    \`Stats -> Opaque Pixels: \${opaquePixels}, Unique Colors: \${uniqueColors.size}, Layers: \${sprite.layers.length}\`
  );
});`,
  },
  {
    id: "sample.hello_world",
    fileName: "hello-world.ts",
    title: "12. Hello World (Comment-Per-Line)",
    description: "Minimal example setting pixel (0,0) to red and drawing a gold rectangle.",
    code: `// 1. Start an atomic undoable transaction so Ctrl+Z can revert all changes in one step:
app.transaction("Hello World Pixel Art", () => {
  // 2. Access the currently active cel (intersection of active layer and active frame):
  const cel = app.activeCel;
  // 3. Guard against running when no cel is selected:
  if (!cel) return;
  // 4. Create a bright red RGBA color using the global Color helper:
  const red = Color.rgba(255, 0, 0, 255);
  // 5. Set the top-left pixel (0, 0) to red:
  cel.image.setPixel(0, 0, red);
  // 6. Draw a small 4x4 gold border starting at (2, 2):
  cel.image.drawRect(2, 2, 4, 4, Color.fromHex("#facc15"));
  // 7. Print a friendly confirmation message to the Script Editor console:
  console.info("Hello from Kekenik Pixel Scripting Engine! Pixel (0,0) is now red.");
});`,
  },
];

// ---------------------------------------------------------------------------
// Script Persistence Manager (`PlatformAPI.dataDir()/scripts/`)
// ---------------------------------------------------------------------------

export interface SavedScriptFile {
  name: string;
  code: string;
  shortcut?: string;
  updatedAt: string;
  builtIn?: boolean;
}

export class ScriptStorageManager {
  private cache: SavedScriptFile[] = [];

  public constructor() {
    this.seedDefaults();
  }

  private seedDefaults(): void {
    this.cache = BUILTIN_SAMPLE_SCRIPTS.map((s) => ({
      name: s.fileName,
      code: s.code,
      updatedAt: "2026-11-08",
      builtIn: true,
    }));
  }

  public getAll(): SavedScriptFile[] {
    return [...this.cache];
  }

  public getByName(name: string): SavedScriptFile | undefined {
    return this.cache.find((s) => s.name === name);
  }

  public async saveScript(
    name: string,
    code: string,
    shortcut?: string
  ): Promise<SavedScriptFile> {
    const cleanName =
      name.trim().endsWith(".ts") || name.trim().endsWith(".js")
        ? name.trim()
        : `${name.trim()}.ts`;
    const existingIdx = this.cache.findIndex((s) => s.name === cleanName);
    const entry: SavedScriptFile = {
      name: cleanName,
      code,
      shortcut:
        shortcut ?? (existingIdx >= 0 ? this.cache[existingIdx].shortcut : undefined),
      updatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
      builtIn: existingIdx >= 0 ? this.cache[existingIdx].builtIn : false,
    };
    if (existingIdx >= 0) {
      this.cache[existingIdx] = entry;
    } else {
      this.cache.push(entry);
    }
    const platform = getPlatform();
    await platform.writeTextFile(`${platform.dataDir()}/scripts/${cleanName}`, code);
    await platform.writeSetting("saved_scripts_index", this.cache);
    return entry;
  }

  public async renameScript(
    oldName: string,
    newName: string
  ): Promise<SavedScriptFile | null> {
    const idx = this.cache.findIndex((s) => s.name === oldName);
    if (idx < 0) return null;
    const cleanNew =
      newName.trim().endsWith(".ts") || newName.trim().endsWith(".js")
        ? newName.trim()
        : `${newName.trim()}.ts`;
    const item = this.cache[idx];
    const updated: SavedScriptFile = {
      ...item,
      name: cleanNew,
      updatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    };
    this.cache[idx] = updated;
    const platform = getPlatform();
    await platform.deleteFile(`${platform.dataDir()}/scripts/${oldName}`);
    await platform.writeTextFile(`${platform.dataDir()}/scripts/${cleanNew}`, updated.code);
    await platform.writeSetting("saved_scripts_index", this.cache);
    return updated;
  }

  public async deleteScript(name: string): Promise<boolean> {
    const idx = this.cache.findIndex((s) => s.name === name);
    if (idx < 0) return false;
    this.cache.splice(idx, 1);
    const platform = getPlatform();
    await platform.deleteFile(`${platform.dataDir()}/scripts/${name}`);
    await platform.writeSetting("saved_scripts_index", this.cache);
    return true;
  }

  public async rescanScriptsFolder(): Promise<SavedScriptFile[]> {
    const platform = getPlatform();
    const savedIndex = await platform.readSetting<SavedScriptFile[] | null>(
      "saved_scripts_index",
      null
    );
    if (savedIndex && savedIndex.length > 0) {
      this.cache = savedIndex;
    } else if (this.cache.length === 0) {
      this.seedDefaults();
    }
    return this.getAll();
  }
}

export const defaultScriptStorage = new ScriptStorageManager();
