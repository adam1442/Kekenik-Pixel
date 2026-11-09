/**
 * @module formats/io
 * High-level file I/O on sprites: encode / decode by extension, numbered sequences, the `.kpx` native project
 * container (zip: manifest + lossless sprite snapshot + editor state), autosave snapshots and crash-recovery helpers.
 */

import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import {
  Mask,
  PixelImage,
  base64ToUint8,
  compositeFrame,
  createModelId,
  deserializeSnapshot,
  getPaletteForFrame,
  serializeSnapshot,
  uint8ToBase64,
  type PreservedChunk,
  type Sprite,
} from "../model/index.ts";
import { FormatRegistry } from "../registry/index.ts";
import type { DockState } from "../layout/index.ts";
import { isAsepriteData, readAseprite, writeAseprite } from "./ase.ts";
import {
  decodeBmp, decodeFliFlc, decodeGif, decodeIco, decodeJpeg, decodePcx, decodePng, decodeQoi, decodeTga, decodeWebp,
  encodeApng, encodeBmp, encodeCssBoxShadow, encodeFliFlc, encodeGif, encodeIco, encodeIndexedPng, encodeJpeg, encodePcx,
  encodePng, encodeQoi, encodeSvg, encodeTga, encodeWebp, scaleBitmap, sniffImageFormat,
  type DecodedImage, type RgbaBitmap, type RgbaFrame,
} from "./image.ts";

/** Editor state saved inside `.kpx` projects (everything is optional so old files keep loading). */
export interface KpxEditorState {
  workspaceName?: string;
  dock?: DockState;
  zoom?: number;
  panX?: number;
  panY?: number;
  activeFrameIndex?: number;
  activeLayerIndex?: number;
  fgColor?: { r: number; g: number; b: number; a: number };
  bgColor?: { r: number; g: number; b: number; a: number };
  toolId?: string;
  toolOptions?: Record<string, unknown>;
  openPanels?: string[];
  theme?: string;
  /** Script open in the Script Editor. */
  script?: { name: string; code: string };
  /** Sample extensions that must be installed + enabled when the project opens. */
  extensions?: string[];
  /** Dialog to open after loading (e.g. `dialog.export_sprite_sheet`). */
  openDialog?: string;
  /** Free text shown in the log when the project opens. */
  note?: string;
}

/** Everything restored from a `.kpx` project. */
export interface KpxProject {
  sprite: Sprite;
  editor: KpxEditorState;
  manifest: { format: "kpx"; version: number; app: string; createdAt: string; name: string };
}

/**
 * Writes a `.kpx` native project: a zip with `manifest.json`, `sprite.snapshot.json` (lossless), optional `preserved.json`
 * (unmodelled .aseprite chunks) and `editor.json`.
 */
export function writeKpx(sprite: Sprite, editor: KpxEditorState = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify({ format: "kpx", version: 1, app: "Kekenik Pixel", createdAt: new Date().toISOString(), name: sprite.name })),
    "sprite.snapshot.json": strToU8(serializeSnapshot(sprite)),
    "editor.json": strToU8(JSON.stringify(editor)),
  };
  if (sprite.preservedChunks?.length) {
    files["preserved.json"] = strToU8(JSON.stringify(sprite.preservedChunks.map((c) => ({ ...c, data: uint8ToBase64(c.data) }))));
  }
  return zipSync(files, { level: 6 });
}

/** Reads a `.kpx` project. @throws Error when the archive is not a valid kpx container. */
export function readKpx(bytes: Uint8Array): KpxProject {
  const files = unzipSync(bytes);
  const m = files["manifest.json"];
  if (!m) throw new Error("Not a .kpx project (manifest.json missing)");
  const manifest = JSON.parse(strFromU8(m)) as KpxProject["manifest"];
  if (manifest.format !== "kpx") throw new Error("Not a .kpx project (wrong manifest format)");
  if (manifest.version > 1) throw new Error(`This .kpx was written by a newer version (${manifest.version})`);
  const snap = files["sprite.snapshot.json"];
  if (!snap) throw new Error("Corrupt .kpx project: sprite data missing");
  const sprite = deserializeSnapshot(strFromU8(snap));
  if (files["preserved.json"]) {
    const raw = JSON.parse(strFromU8(files["preserved.json"])) as Array<Omit<PreservedChunk, "data"> & { data: string }>;
    sprite.preservedChunks = raw.map((c) => ({ ...c, data: base64ToUint8(c.data) }));
  }
  const editor = files["editor.json"] ? (JSON.parse(strFromU8(files["editor.json"])) as KpxEditorState) : {};
  return { sprite, editor, manifest };
}

/** Renders every frame of a sprite as straight-alpha RGBA. */
export function spriteToFrames(sprite: Sprite): RgbaFrame[] {
  return sprite.frames.map((f, i) => ({ rgba: compositeFrame(sprite, i).data, delayMs: f.durationMs }));
}

/** Builds a new RGBA sprite from decoded frames (one layer, one cel per frame). */
export function spriteFromDecoded(name: string, img: DecodedImage): Sprite {
  const layerId = createModelId("layer");
  const sprite: Sprite = {
    id: createModelId("sprite"), name, width: img.width, height: img.height, colorMode: "rgba", transparentIndex: 0,
    pixelRatio: { w: 1, h: 1 }, grid: { x: 0, y: 0, width: 16, height: 16, visible: false },
    palettes: [{ id: createModelId("pal"), name: "Palette", fromFrame: 0, toFrame: 9999, colors: img.palette?.length ? img.palette.map((c) => ({ ...c })) : [{ r: 0, g: 0, b: 0, a: 0 }] }],
    layers: [{ id: layerId, kind: "image", name: "Layer 1", parentId: null, visible: true, editable: true, lockMove: false, background: false, preferLinkedCels: false, collapsed: false, reference: false, blendMode: "normal", opacity: 255, userData: { text: "" } }],
    frames: [], cels: [], tags: [], slices: [], tilesets: [], mask: new Mask(img.width, img.height), userData: { text: "" },
  };
  img.frames.forEach((f, i) => {
    sprite.frames.push({ id: createModelId("frame"), index: i, durationMs: f.delayMs });
    sprite.cels.push({ id: createModelId("cel"), layerId, frameIndex: i, x: 0, y: 0, opacity: 255, zIndex: 0, image: new PixelImage(img.width, img.height, "rgba", Uint8Array.from(f.rgba)), userData: { text: "" } });
  });
  return sprite;
}

/** Options for {@link encodeSprite}. */
export interface EncodeOptions {
  /** Frame to export for single-image formats (default 0). */
  frame?: number;
  /** Integer upscale factor. */
  scale?: number;
  /** GIF/APNG loop count (0 = forever). */
  loopCount?: number;
  /** GIF dithering. */
  dither?: boolean;
  /** Write palette-based PNG for indexed sprites. */
  indexedPng?: boolean;
  /** JPEG quality (1..100, default 90). */
  quality?: number;
  /** Editor state stored in `.kpx`. */
  editor?: KpxEditorState;
}

/** Lowercase extension without dot. */
export function extOf(fileName: string): string {
  const m = /\.([a-z0-9-]+)$/i.exec(fileName);
  return m ? m[1].toLowerCase() : "";
}

function frameBitmap(sprite: Sprite, frame: number, scale: number): RgbaBitmap {
  const img = compositeFrame(sprite, Math.max(0, Math.min(frame, sprite.frames.length - 1)));
  return scaleBitmap({ width: img.width, height: img.height, data: img.data }, scale);
}

/**
 * Encodes a sprite for the given extension: `aseprite|ase`, `kpx`, `png`, `apng`, `gif`, `bmp`, `tga`, `ico`, `qoi`, `svg`.
 * @throws Error for unsupported extensions (e.g. WebP / JPEG, see docs/KNOWN_ISSUES.md)
 */
export function encodeSprite(sprite: Sprite, ext: string, opts: EncodeOptions = {}): Uint8Array {
  const scale = Math.max(1, Math.round(opts.scale ?? 1));
  const e = ext.toLowerCase().replace(/^\./, "");
  switch (e) {
    case "aseprite":
    case "ase":
      return writeAseprite(sprite);
    case "kpx":
      return writeKpx(sprite, opts.editor);
    case "png": {
      if (opts.indexedPng && sprite.colorMode === "indexed" && scale === 1) {
        const pal = getPaletteForFrame(sprite, opts.frame ?? 0);
        const bmp = frameBitmap(sprite, opts.frame ?? 0, 1);
        const idx = new Uint8Array(bmp.width * bmp.height);
        const lookup = new Map<number, number>();
        pal.forEach((c, i) => { if (!lookup.has((c.r << 16) | (c.g << 8) | c.b)) lookup.set((c.r << 16) | (c.g << 8) | c.b, i); });
        for (let i = 0; i < idx.length; i++) {
          if (bmp.data[i * 4 + 3] === 0) { idx[i] = sprite.transparentIndex; continue; }
          idx[i] = lookup.get((bmp.data[i * 4] << 16) | (bmp.data[i * 4 + 1] << 8) | bmp.data[i * 4 + 2]) ?? 0;
        }
        return encodeIndexedPng(bmp.width, bmp.height, idx, pal.map((c, i) => (i === sprite.transparentIndex ? { ...c, a: 0 } : c)));
      }
      return encodePng(frameBitmap(sprite, opts.frame ?? 0, scale));
    }
    case "apng":
    case "gif":
    case "webp":
    case "flc":
    case "fli": {
      const frames = spriteToFrames(sprite).map((f) => {
        const b = scaleBitmap({ width: sprite.width, height: sprite.height, data: f.rgba }, scale);
        return { rgba: b.data, delayMs: f.delayMs };
      });
      const w = sprite.width * scale, h = sprite.height * scale;
      if (e === "gif") return encodeGif(w, h, frames, { loopCount: opts.loopCount, dither: opts.dither });
      if (e === "webp") return encodeWebp(w, h, frames, opts.loopCount ?? 0);
      if (e === "flc" || e === "fli") return encodeFliFlc(w, h, frames);
      return encodeApng(w, h, frames, opts.loopCount ?? 0);
    }
    case "jpg":
    case "jpeg":
      return encodeJpeg(frameBitmap(sprite, opts.frame ?? 0, scale), opts.quality ?? 90);
    case "pcx":
      return encodePcx(frameBitmap(sprite, opts.frame ?? 0, scale));
    case "bmp":
      return encodeBmp(frameBitmap(sprite, opts.frame ?? 0, scale));
    case "tga":
      return encodeTga(frameBitmap(sprite, opts.frame ?? 0, scale));
    case "ico":
      return encodeIco(frameBitmap(sprite, opts.frame ?? 0, scale));
    case "qoi":
      return encodeQoi(frameBitmap(sprite, opts.frame ?? 0, scale));
    case "svg":
      return strToU8(encodeSvg(frameBitmap(sprite, opts.frame ?? 0, 1), scale));
    case "css":
      return strToU8(encodeCssBoxShadow(frameBitmap(sprite, opts.frame ?? 0, 1), scale));
    default:
      throw new Error(`Cannot export .${e}: format not supported (supported: aseprite, ase, kpx, png, apng, gif, webp, jpg, jpeg, pcx, flc, fli, bmp, tga, ico, qoi, svg, css)`);
  }
}

/**
 * Decodes any supported file (detected by magic bytes first, extension second) into a sprite.
 * @throws Error with an actionable message when the format is unsupported or corrupt
 */
export function decodeSprite(bytes: Uint8Array, fileName: string): { sprite: Sprite; editor?: KpxEditorState } {
  const name = fileName.replace(/^.*[\\/]/, "");
  const ext = extOf(name);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const p = readKpx(bytes);
    return { sprite: p.sprite, editor: p.editor };
  }
  if (isAsepriteData(bytes)) return { sprite: readAseprite(bytes, name) };
  const kind = sniffImageFormat(bytes);
  const one = (b: RgbaBitmap): { sprite: Sprite } => ({ sprite: spriteFromDecoded(name, { width: b.width, height: b.height, frames: [{ rgba: b.data, delayMs: 100 }], loopCount: 0 }) });
  switch (kind) {
    case "png": return { sprite: spriteFromDecoded(name, decodePng(bytes)) };
    case "gif": return { sprite: spriteFromDecoded(name, decodeGif(bytes)) };
    case "webp": return { sprite: spriteFromDecoded(name, decodeWebp(bytes)) };
    case "jpeg": return one(decodeJpeg(bytes));
    case "pcx": return one(decodePcx(bytes));
    case "flc": return { sprite: spriteFromDecoded(name, decodeFliFlc(bytes)) };
    case "bmp": return one(decodeBmp(bytes));
    case "ico": return one(decodeIco(bytes));
    case "qoi": return one(decodeQoi(bytes));
    default:
      if (ext === "tga") return one(decodeTga(bytes));
      if (ext === "pcx") return one(decodePcx(bytes));
      throw new Error(`Unrecognized file format for "${name}". Supported: .aseprite .ase .kpx .png .gif .apng .webp .jpg .jpeg .pcx .flc .fli .bmp .ico .tga .qoi`);
  }
}

/** Expands `{title}`, `{frame}`, `{frame1}`, `{layer}`, `{tag}`, `{slice}` in an export name template. */
export function expandNameTemplate(tpl: string, vars: { title: string; frame: number; layer?: string; tag?: string; slice?: string }): string {
  return tpl
    .replace(/\{title\}/g, vars.title)
    .replace(/\{frame1\}/g, String(vars.frame + 1))
    .replace(/\{frame(\d+)?\}/g, (_m, pad: string | undefined) => String(vars.frame).padStart(pad ? Number(pad) : 0, "0"))
    .replace(/\{layer\}/g, vars.layer ?? "")
    .replace(/\{tag\}/g, vars.tag ?? "")
    .replace(/\{slice\}/g, vars.slice ?? "");
}

/** Exports one file per frame using a name template such as `{title}_{frame2}.png`. */
export function exportSequence(sprite: Sprite, template: string, ext: string, opts: EncodeOptions = {}): Array<{ name: string; bytes: Uint8Array }> {
  const title = sprite.name.replace(/\.[a-z0-9-]+$/i, "");
  return sprite.frames.map((_f, i) => {
    const tag = sprite.tags.find((t) => i >= t.fromFrame && i <= t.toFrame)?.name ?? "";
    const base = expandNameTemplate(template.includes("{frame") ? template : `${template}{frame}`, { title, frame: i, tag });
    return { name: /\.[a-z0-9]+$/i.test(base) ? base : `${base}.${ext}`, bytes: encodeSprite(sprite, ext, { ...opts, frame: i }) };
  });
}

/** Imports an image sequence (natural-sorted by name) as animation frames of one sprite. */
export function importSequence(files: Array<{ name: string; bytes: Uint8Array }>, name = "Sequence"): Sprite {
  const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!sorted.length) throw new Error("No files given for sequence import");
  const frames: RgbaFrame[] = [];
  let w = 0, h = 0;
  for (const f of sorted) {
    const { sprite } = decodeSprite(f.bytes, f.name);
    w = Math.max(w, sprite.width); h = Math.max(h, sprite.height);
    frames.push({ rgba: compositeFrame(sprite, 0).data, delayMs: 100 });
    if (frames.length === 1) { w = sprite.width; h = sprite.height; }
  }
  const first = decodeSprite(sorted[0].bytes, sorted[0].name).sprite;
  const out = spriteFromDecoded(name, { width: first.width, height: first.height, frames: frames.map((f) => ({ rgba: f.rgba.length === first.width * first.height * 4 ? f.rgba : new Uint8Array(first.width * first.height * 4), delayMs: 100 })), loopCount: 0 });
  return out;
}

// ---------------------------------------------------------------------------
// Autosave + crash recovery
// ---------------------------------------------------------------------------

/** A recovery snapshot written periodically by the autosave service. */
export interface RecoverySnapshot {
  key: string;
  docName: string;
  savedAt: string;
  /** `.kpx` bytes. */
  kpx: Uint8Array;
}

/** Autosave configuration (Preferences > General). */
export interface AutosaveConfig {
  enabled: boolean;
  intervalSeconds: number;
  /** Maximum snapshots kept per document. */
  maxPerDocument: number;
  /** Maximum snapshots kept overall. */
  maxTotal: number;
}

/** Defaults: every 2 minutes, 3 per document, 20 overall. */
export const DEFAULT_AUTOSAVE: AutosaveConfig = { enabled: true, intervalSeconds: 120, maxPerDocument: 3, maxTotal: 20 };

/** Creates a recovery snapshot for a sprite. */
export function createRecoverySnapshot(sprite: Sprite, editor: KpxEditorState = {}): RecoverySnapshot {
  const savedAt = new Date().toISOString();
  return { key: `${sprite.id}__${savedAt.replace(/[:.]/g, "-")}`, docName: sprite.name, savedAt, kpx: writeKpx(sprite, editor) };
}

/** Applies retention limits (oldest removed first); returns the snapshots to keep. */
export function pruneRecovery(all: RecoverySnapshot[], cfg: AutosaveConfig): RecoverySnapshot[] {
  const sorted = all.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const perDoc = new Map<string, number>();
  const kept: RecoverySnapshot[] = [];
  for (const s of sorted) {
    const docKey = s.key.split("__")[0];
    const n = perDoc.get(docKey) ?? 0;
    if (n >= cfg.maxPerDocument || kept.length >= cfg.maxTotal) continue;
    perDoc.set(docKey, n + 1);
    kept.push(s);
  }
  return kept;
}

/** Restores a document from a recovery snapshot. */
export function restoreRecovery(s: RecoverySnapshot): KpxProject {
  return readKpx(s.kpx);
}

// ---------------------------------------------------------------------------
// FormatRegistry
// ---------------------------------------------------------------------------

/** Registers all Agent 6 codecs in the `FormatRegistry` (idempotent). */
export function registerAgent6Formats(): void {
  const def = (id: string, name: string, extensions: string[], canRead: boolean, canWrite: boolean, anim: boolean, layers: boolean, ext: string, state: "tested" | "planned" = "tested") =>
    FormatRegistry.register({
      id, name, extensions, canRead, canWrite, supportsAnimation: anim, supportsLayers: layers, ownerAgent: 6, state,
      ...(state === "tested"
        ? {
            read: async (bytes: Uint8Array) => decodeSprite(bytes, `file.${ext}`).sprite,
            write: async (sprite: Sprite) => encodeSprite(sprite, ext),
          }
        : {}),
    });
  def("format.aseprite", "Aseprite (.ase, .aseprite)", ["ase", "aseprite"], true, true, true, true, "aseprite");
  def("format.kpx", "Kekenik Project (.kpx)", ["kpx"], true, true, true, true, "kpx");
  def("format.png", "PNG Image (.png)", ["png"], true, true, false, false, "png");
  def("format.apng", "Animated PNG (.apng)", ["apng"], true, true, true, false, "apng");
  def("format.gif", "CompuServe GIF (.gif)", ["gif"], true, true, true, false, "gif");
  def("format.bmp", "Windows Bitmap (.bmp)", ["bmp"], true, true, false, false, "bmp");
  def("format.tga", "Targa (.tga)", ["tga"], true, true, false, false, "tga");
  def("format.ico", "Windows Icon (.ico)", ["ico"], true, true, false, false, "ico");
  def("format.qoi", "Quite OK Image (.qoi)", ["qoi"], true, true, false, false, "qoi");
  def("format.svg", "SVG pixel export (.svg)", ["svg"], false, true, false, false, "svg");
  def("format.webp", "Lossless & Animated WebP (.webp)", ["webp"], true, true, true, false, "webp");
  def("format.jpeg", "JPEG Image (.jpg, .jpeg)", ["jpg", "jpeg"], true, true, false, false, "jpg");
  def("format.pcx", "ZSoft PCX (.pcx)", ["pcx"], true, true, false, false, "pcx");
  def("format.flc", "Autodesk Animator (.flc, .fli)", ["flc", "fli"], true, true, true, false, "flc");
  def("format.css_box_shadow", "CSS box-shadow Snippet (.css)", ["css"], false, true, false, false, "css");
}

registerAgent6Formats();

// ---------------------------------------------------------------------------
// File Watcher for Open Documents (M4)
// ---------------------------------------------------------------------------

export interface WatchedFileEvent {
  readonly filePath: string;
  readonly eventType: "change" | "rename";
  readonly timestamp: number;
  readonly bytes?: Uint8Array;
}

/**
 * Watches open document file paths for external modifications on disk (or simulated in-memory VFS updates)
 * and notifies subscribers so open tabs can reload or prompt on external file edits.
 */
export class FileWatcherManager {
  private readonly watchers = new Map<
    string,
    Set<(ev: WatchedFileEvent) => void>
  >();
  private readonly lastHashes = new Map<string, number>();

  private computeHash(bytes: Uint8Array): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }

  /** Registers a listener for external changes to `filePath`. Returns an unsubscribe function. */
  public watch(
    filePath: string,
    onChange: (ev: WatchedFileEvent) => void,
    initialBytes?: Uint8Array
  ): () => void {
    if (initialBytes) {
      this.lastHashes.set(filePath, this.computeHash(initialBytes));
    }
    let set = this.watchers.get(filePath);
    if (!set) {
      set = new Set();
      this.watchers.set(filePath, set);
    }
    set.add(onChange);
    return () => {
      set?.delete(onChange);
      if (set && set.size === 0) {
        this.watchers.delete(filePath);
      }
    };
  }

  /** Notifies watchers when `filePath` is modified externally (ignores no-op writes with identical bytes). */
  public notifyExternalChange(
    filePath: string,
    newBytes?: Uint8Array,
    eventType: "change" | "rename" = "change"
  ): boolean {
    const listeners = this.watchers.get(filePath);
    if (!listeners || listeners.size === 0) return false;
    if (newBytes) {
      const nextHash = this.computeHash(newBytes);
      const prevHash = this.lastHashes.get(filePath);
      if (prevHash !== undefined && prevHash === nextHash) {
        return false;
      }
      this.lastHashes.set(filePath, nextHash);
    }
    const ev: WatchedFileEvent = {
      filePath,
      eventType,
      timestamp: Date.now(),
      bytes: newBytes,
    };
    for (const fn of listeners) {
      fn(ev);
    }
    return true;
  }

  /** Returns all currently watched file paths. */
  public getWatchedPaths(): string[] {
    return Array.from(this.watchers.keys());
  }
}

export const defaultFileWatcher = new FileWatcherManager();
