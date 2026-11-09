/**
 * @module formats/ase
 * `.ase` / `.aseprite` binary codec (public file-format specification).
 * Reads and writes: header, frames, old palette (0x0004 / 0x0011, read), layer (0x2004, incl. groups & tilemaps),
 * cel (0x2005: raw / linked / compressed image / compressed tilemap), cel extra (0x2006, preserved), color profile
 * (0x2007, preserved), external files (0x2008, preserved), tags (0x2018), palette (0x2019), user data (0x2020),
 * slice (0x2022 with 9-patch + pivot), tileset (0x2023 with embedded tiles). Unknown chunks are preserved.
 */

import { unzlibSync, zlibSync } from "fflate";
import {
  Mask,
  PixelImage,
  type BlendMode,
  type Cel,
  type ColorMode,
  type Layer,
  type PaletteSpan,
  type PreservedChunk,
  type Slice,
  type Sprite,
  type Tag,
  type TagDirection,
  type Tileset,
  type UserData,
} from "../model/index.ts";
import { syncCelImageFromTilemap } from "../tilemap/index.ts";
import type { RGBA } from "../util/index.ts";

const MAGIC_FILE = 0xa5e0;
const MAGIC_FRAME = 0xf1fa;

const BLEND_ORDER: readonly BlendMode[] = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light",
  "soft-light", "difference", "exclusion", "hsl-hue", "hsl-saturation", "hsl-color", "hsl-luminosity",
  "addition", "subtract", "divide",
];
const DIRECTIONS: readonly TagDirection[] = ["forward", "reverse", "pingpong", "pingpong-reverse"];

/** Little-endian byte writer with a growable buffer. */
class ByteWriter {
  private buf = new Uint8Array(1024);
  public length = 0;
  private ensure(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.length + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.length));
    this.buf = nb;
  }
  public u8(v: number): void { this.ensure(1); this.buf[this.length++] = v & 0xff; }
  public u16(v: number): void { this.u8(v); this.u8(v >> 8); }
  public i16(v: number): void { this.u16(v & 0xffff); }
  public u32(v: number): void { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff); }
  public i32(v: number): void { this.u32(v >>> 0); }
  public bytes(b: Uint8Array): void { this.ensure(b.length); this.buf.set(b, this.length); this.length += b.length; }
  public zeros(n: number): void { this.ensure(n); this.length += n; }
  public str(s: string): void { const b = new TextEncoder().encode(s); this.u16(b.length); this.bytes(b); }
  public patch32(at: number, v: number): void {
    this.buf[at] = v & 0xff; this.buf[at + 1] = (v >> 8) & 0xff; this.buf[at + 2] = (v >> 16) & 0xff; this.buf[at + 3] = (v >>> 24) & 0xff;
  }
  public result(): Uint8Array { return this.buf.slice(0, this.length); }
}

/** Little-endian byte reader. */
class ByteReader {
  public pos = 0;
  public constructor(public readonly data: Uint8Array, start = 0, public readonly end = data.length) { this.pos = start; }
  private need(n: number): void { if (this.pos + n > this.end) throw new Error(`Unexpected end of .aseprite data at ${this.pos}`); }
  public u8(): number { this.need(1); return this.data[this.pos++]; }
  public u16(): number { const a = this.u8(); return a | (this.u8() << 8); }
  public i16(): number { const v = this.u16(); return v >= 0x8000 ? v - 0x10000 : v; }
  public u32(): number { const a = this.u16(); return (a | (this.u16() << 16)) >>> 0; }
  public i32(): number { return this.u32() | 0; }
  public skip(n: number): void { this.need(n); this.pos += n; }
  public bytes(n: number): Uint8Array { this.need(n); const b = this.data.slice(this.pos, this.pos + n); this.pos += n; return b; }
  public str(): string { const n = this.u16(); return new TextDecoder().decode(this.bytes(n)); }
}

function hexToRgb(hex: string | undefined): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})/i.exec(hex ?? "");
  if (!m) return { r: 0, g: 0, b: 0 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}
function rgbToHex(r: number, g: number, b: number): string {
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function depthOf(mode: ColorMode): number { return mode === "rgba" ? 32 : mode === "grayscale" ? 16 : 8; }

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

function chunk(type: number, fill: (w: ByteWriter) => void): Uint8Array {
  const w = new ByteWriter();
  w.u32(0);
  w.u16(type);
  fill(w);
  const out = w.result();
  new DataView(out.buffer).setUint32(0, out.length, true);
  return out;
}

function userDataChunk(ud: UserData): Uint8Array | null {
  const hasText = !!ud.text;
  const hasColor = !!ud.color && /^#?[0-9a-f]{6}/i.test(ud.color);
  if (!hasText && !hasColor) return null;
  return chunk(0x2020, (w) => {
    w.u32((hasText ? 1 : 0) | (hasColor ? 2 : 0));
    if (hasText) w.str(ud.text);
    if (hasColor) { const c = hexToRgb(ud.color); w.u8(c.r); w.u8(c.g); w.u8(c.b); w.u8(255); }
  });
}

/** Orders layers as the file requires: pre-order traversal, children listed bottom→top after their group. */
function orderLayers(sprite: Sprite): Array<{ layer: Layer; level: number }> {
  const out: Array<{ layer: Layer; level: number }> = [];
  const byParent = new Map<string | null, Layer[]>();
  for (const l of sprite.layers) {
    const key = l.parentId && sprite.layers.some((p) => p.id === l.parentId) ? l.parentId : null;
    const arr = byParent.get(key) ?? [];
    arr.push(l);
    byParent.set(key, arr);
  }
  const walk = (parent: string | null, level: number): void => {
    for (const l of byParent.get(parent) ?? []) {
      out.push({ layer: l, level });
      if (l.kind === "group") walk(l.id, level + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * Encodes a sprite as a `.aseprite` file.
 * @param sprite sprite to encode
 * @returns file bytes
 */
export function writeAseprite(sprite: Sprite): Uint8Array {
  const out = new ByteWriter();
  const bpp = sprite.colorMode === "rgba" ? 4 : sprite.colorMode === "grayscale" ? 2 : 1;
  const ordered = orderLayers(sprite);
  const layerIndex = new Map(ordered.map((o, i) => [o.layer.id, i]));
  const tilesetIndex = new Map(sprite.tilesets.map((t, i) => [t.id, i]));
  const preserved = sprite.preservedChunks ?? [];
  const firstPal = sprite.palettes[0];

  out.u32(0); out.u16(MAGIC_FILE); out.u16(sprite.frames.length); out.u16(sprite.width); out.u16(sprite.height);
  out.u16(depthOf(sprite.colorMode)); out.u32(1); out.u16(sprite.frames[0]?.durationMs ?? 100);
  out.u32(0); out.u32(0); out.u8(sprite.transparentIndex & 255); out.zeros(3);
  out.u16(firstPal ? firstPal.colors.length : 256); out.u8(sprite.pixelRatio.w); out.u8(sprite.pixelRatio.h);
  out.i16(sprite.grid.x); out.i16(sprite.grid.y); out.u16(sprite.grid.width); out.u16(sprite.grid.height);
  out.zeros(84);

  const palByFrame = new Map<number, PaletteSpan>();
  for (const span of sprite.palettes) palByFrame.set(Math.min(span.fromFrame, sprite.frames.length - 1), span);

  // Index of first frame holding each linked image
  const firstOfLink = new Map<string, number>();

  sprite.frames.forEach((frame, fi) => {
    const chunks: Uint8Array[] = [];
    const pushUD = (ud: UserData): void => { const u = userDataChunk(ud); if (u) chunks.push(u); };

    for (const p of preserved) if (p.frameIndex === fi && p.type !== 0x2006) chunks.push(chunk(p.type, (w) => w.bytes(p.data)));
    if (fi === 0 && !preserved.some((p) => p.type === 0x2007)) {
      chunks.push(chunk(0x2007, (w) => { w.u16(1); w.u16(0); w.u32(0); w.zeros(8); }));
    }
    if (fi === 0) pushUD(sprite.userData);

    const span = palByFrame.get(fi);
    if (span) {
      chunks.push(chunk(0x2019, (w) => {
        w.u32(span.colors.length); w.u32(0); w.u32(Math.max(0, span.colors.length - 1)); w.zeros(8);
        span.colors.forEach((c, i) => {
          const name = span.entryNames?.[i];
          w.u16(name ? 1 : 0); w.u8(c.r); w.u8(c.g); w.u8(c.b); w.u8(c.a);
          if (name) w.str(name);
        });
      }));
    }

    if (fi === 0) {
      sprite.tilesets.forEach((ts, ti) => {
        const tw = ts.tileWidth, th = ts.tileHeight;
        const pixels = new Uint8Array(tw * th * ts.tiles.length * bpp);
        ts.tiles.forEach((tile, k) => pixels.set(tile.data.subarray(0, tw * th * bpp), k * tw * th * bpp));
        const z = zlibSync(pixels);
        chunks.push(chunk(0x2023, (w) => {
          w.u32(ti); w.u32(2 | 4); w.u32(ts.tiles.length); w.u16(tw); w.u16(th); w.i16(ts.baseIndex); w.zeros(14);
          w.str(ts.name); w.u32(z.length); w.bytes(z);
        }));
        pushUD(ts.userData);
      });
      for (const { layer, level } of ordered) {
        const flags =
          (layer.visible ? 1 : 0) | (layer.editable ? 2 : 0) | (layer.lockMove ? 4 : 0) | (layer.background ? 8 : 0) |
          (layer.preferLinkedCels ? 16 : 0) | (layer.collapsed ? 32 : 0) | (layer.reference ? 64 : 0);
        chunks.push(chunk(0x2004, (w) => {
          w.u16(flags); w.u16(layer.kind === "group" ? 1 : layer.kind === "tilemap" ? 2 : 0); w.u16(level);
          w.u16(0); w.u16(0); w.u16(Math.max(0, BLEND_ORDER.indexOf(layer.blendMode))); w.u8(layer.opacity); w.zeros(3);
          w.str(layer.name);
          if (layer.kind === "tilemap") w.u32(tilesetIndex.get(layer.tilesetId) ?? 0);
        }));
        pushUD(layer.userData);
      }
      if (sprite.tags.length) {
        chunks.push(chunk(0x2018, (w) => {
          w.u16(sprite.tags.length); w.zeros(8);
          for (const tag of sprite.tags) {
            const c = hexToRgb(tag.color);
            w.u16(tag.fromFrame); w.u16(tag.toFrame); w.u8(Math.max(0, DIRECTIONS.indexOf(tag.direction)));
            w.u16(tag.repeat); w.zeros(6); w.u8(c.r); w.u8(c.g); w.u8(c.b); w.u8(0); w.str(tag.name);
          }
        }));
        for (const tag of sprite.tags) {
          const u = userDataChunk(tag.userData);
          chunks.push(u ?? chunk(0x2020, (w) => w.u32(0)));
        }
      }
      for (const sl of sprite.slices) {
        const nine = sl.keys.some((k) => k.center);
        const pivot = sl.keys.some((k) => k.pivot);
        chunks.push(chunk(0x2022, (w) => {
          w.u32(sl.keys.length); w.u32((nine ? 1 : 0) | (pivot ? 2 : 0)); w.u32(0); w.str(sl.name);
          for (const k of sl.keys) {
            w.u32(k.frameIndex); w.i32(k.bounds.x); w.i32(k.bounds.y); w.u32(k.bounds.width); w.u32(k.bounds.height);
            if (nine) { const c = k.center ?? { x: 0, y: 0, width: k.bounds.width, height: k.bounds.height }; w.i32(c.x); w.i32(c.y); w.u32(c.width); w.u32(c.height); }
            if (pivot) { const pv = k.pivot ?? { x: 0, y: 0 }; w.i32(pv.x); w.i32(pv.y); }
          }
        }));
        const ud: UserData = { text: sl.userData.text, color: sl.userData.color ?? sl.color };
        pushUD(ud);
      }
    }

    // Cels
    const frameCels = sprite.cels.filter((c) => c.frameIndex === fi && layerIndex.has(c.layerId))
      .sort((a, b) => layerIndex.get(a.layerId)! - layerIndex.get(b.layerId)!);
    for (const cel of frameCels) {
      const li = layerIndex.get(cel.layerId)!;
      const layer = ordered[li].layer;
      const linkKey = cel.linkId ? `${cel.layerId}|${cel.linkId}` : null;
      const first = linkKey ? firstOfLink.get(linkKey) : undefined;
      chunks.push(chunk(0x2005, (w) => {
        w.u16(li); w.i16(cel.x); w.i16(cel.y); w.u8(cel.opacity);
        const type = first !== undefined ? 1 : layer.kind === "tilemap" && cel.tilemapData ? 3 : 2;
        w.u16(type); w.i16(cel.zIndex); w.zeros(5);
        if (type === 1) { w.u16(first!); return; }
        if (type === 3 && cel.tilemapData) {
          const td = cel.tilemapData;
          const raw = new Uint8Array(td.tiles.length * 4);
          new Uint32Array(raw.buffer).set(td.tiles);
          w.u16(td.width); w.u16(td.height); w.u16(32); w.u32(0x1fffffff); w.u32(0x80000000); w.u32(0x40000000); w.u32(0x20000000);
          w.zeros(10); w.bytes(zlibSync(raw));
          return;
        }
        w.u16(cel.image.width); w.u16(cel.image.height); w.bytes(zlibSync(cel.image.data));
      }));
      if (linkKey && first === undefined) firstOfLink.set(linkKey, fi);
      pushUD(cel.userData);
      for (const p of preserved) if (p.frameIndex === fi && p.type === 0x2006 && p.celLayerIndex === li) chunks.push(chunk(0x2006, (w) => w.bytes(p.data)));
    }

    const frameStart = out.length;
    out.u32(0); out.u16(MAGIC_FRAME); out.u16(Math.min(chunks.length, 0xfffe)); out.u16(frame.durationMs); out.zeros(2); out.u32(chunks.length);
    for (const c of chunks) out.bytes(c);
    out.patch32(frameStart, out.length - frameStart);
  });

  out.patch32(0, out.length);
  return out.result();
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

type LastObj =
  | { kind: "sprite" }
  | { kind: "layer"; index: number }
  | { kind: "cel"; cel: Cel }
  | { kind: "tag"; index: number }
  | { kind: "slice"; index: number }
  | { kind: "tileset"; index: number }
  | { kind: "none" };

/**
 * Decodes a `.ase` / `.aseprite` file.
 * @param bytes file contents
 * @param name sprite name to assign
 * @throws Error when the magic number is wrong or the data is truncated
 */
export function readAseprite(bytes: Uint8Array, name = "Sprite"): Sprite {
  const r = new ByteReader(bytes);
  r.u32();
  if (r.u16() !== MAGIC_FILE) throw new Error("Not an .aseprite file (bad magic number)");
  const frameCount = r.u16();
  const width = r.u16();
  const height = r.u16();
  const depth = r.u16();
  const colorMode: ColorMode = depth === 32 ? "rgba" : depth === 16 ? "grayscale" : "indexed";
  if (![32, 16, 8].includes(depth)) throw new Error(`Unsupported color depth ${depth}`);
  const bpp = depth / 8;
  r.u32();
  const defaultSpeed = r.u16();
  r.skip(8);
  const transparentIndex = r.u8();
  r.skip(3);
  r.u16();
  let pw = r.u8();
  let ph = r.u8();
  if (pw === 0) pw = 1;
  if (ph === 0) ph = 1;
  const gx = r.i16(), gy = r.i16(), gw = r.u16(), gh = r.u16();
  r.pos = 128;

  const layers: Layer[] = [];
  const cels: Cel[] = [];
  const tags: Tag[] = [];
  const slices: Slice[] = [];
  const tilesets: Tileset[] = [];
  const tilesetFileIds: number[] = [];
  const frames: Sprite["frames"] = [];
  const palettes: PaletteSpan[] = [];
  const preserved: PreservedChunk[] = [];
  const levelStack: Layer[] = [];
  const celByKey = new Map<string, Cel>();
  const userData: UserData = { text: "" };
  let sawNewPalette = false;
  const paletteColors = (): RGBA[] => palettes[palettes.length - 1]?.colors ?? [];

  for (let fi = 0; fi < frameCount; fi++) {
    const frameStart = r.pos;
    const frameBytes = r.u32();
    if (r.u16() !== MAGIC_FRAME) throw new Error(`Bad frame magic at frame ${fi}`);
    const oldCount = r.u16();
    let duration = r.u16();
    r.skip(2);
    const newCount = r.u32();
    const count = newCount !== 0 ? newCount : oldCount;
    if (duration === 0) duration = defaultSpeed;
    frames.push({ id: `frame_${fi}`, index: fi, durationMs: duration });
    let last: LastObj = fi === 0 ? { kind: "sprite" } : { kind: "none" };
    let tagUserIdx = -1;
    let lastCelLayer = -1;
    const frameEnd = frameStart + frameBytes;

    for (let c = 0; c < count && r.pos < frameEnd; c++) {
      const start = r.pos;
      const size = r.u32();
      const type = r.u16();
      const end = start + size;
      const body = new ByteReader(bytes, r.pos, end);
      switch (type) {
        case 0x0004:
        case 0x0011: {
          if (sawNewPalette) break;
          let span = palettes[palettes.length - 1];
          if (!span || span.fromFrame !== fi) {
            span = { id: `pal_${fi}`, name: "Palette", fromFrame: fi, toFrame: 9999, colors: span ? span.colors.map((x) => ({ ...x })) : [] };
            palettes.push(span);
          }
          const packets = body.u16();
          let idx = 0;
          for (let p = 0; p < packets; p++) {
            idx += body.u8();
            let n = body.u8();
            if (n === 0) n = 256;
            for (let k = 0; k < n; k++) {
              let rr = body.u8(), gg = body.u8(), bb = body.u8();
              if (type === 0x0011) { rr = Math.min(255, rr * 4); gg = Math.min(255, gg * 4); bb = Math.min(255, bb * 4); }
              span.colors[idx++] = { r: rr, g: gg, b: bb, a: 255 };
            }
          }
          break;
        }
        case 0x2019: {
          sawNewPalette = true;
          const newSize = body.u32();
          const from = body.u32();
          const to = body.u32();
          body.skip(8);
          const prev = palettes[palettes.length - 1];
          let span: PaletteSpan;
          if (prev && prev.fromFrame === fi) span = prev;
          else {
            span = { id: `pal_${fi}`, name: "Palette", fromFrame: fi, toFrame: 9999, colors: prev ? prev.colors.map((x) => ({ ...x })) : [] };
            palettes.push(span);
          }
          span.colors.length = newSize;
          for (let k = 0; k < newSize; k++) if (!span.colors[k]) span.colors[k] = { r: 0, g: 0, b: 0, a: 255 };
          for (let k = from; k <= to; k++) {
            const flags = body.u16();
            const col = { r: body.u8(), g: body.u8(), b: body.u8(), a: body.u8() };
            span.colors[k] = col;
            if (flags & 1) { span.entryNames = span.entryNames ?? {}; span.entryNames[k] = body.str(); }
          }
          break;
        }
        case 0x2004: {
          const flags = body.u16();
          const ltype = body.u16();
          const level = body.u16();
          body.skip(4);
          const blend = body.u16();
          const opacity = body.u8();
          body.skip(3);
          const lname = body.str();
          const parent = level > 0 ? levelStack[level - 1] : undefined;
          const base = {
            id: `layer_${layers.length}`,
            name: lname,
            parentId: parent ? parent.id : null,
            visible: !!(flags & 1),
            editable: !!(flags & 2),
            lockMove: !!(flags & 4),
            background: !!(flags & 8),
            preferLinkedCels: !!(flags & 16),
            collapsed: !!(flags & 32),
            reference: !!(flags & 64),
            blendMode: BLEND_ORDER[blend] ?? "normal",
            opacity,
            userData: { text: "" } as UserData,
          };
          let layer: Layer;
          if (ltype === 1) layer = { ...base, kind: "group", children: [] };
          else if (ltype === 2) layer = { ...base, kind: "tilemap", tilesetId: `tileset_${body.u32()}` };
          else layer = { ...base, kind: "image" };
          if (parent && parent.kind === "group") parent.children.push(layer.id);
          levelStack[level] = layer;
          levelStack.length = level + 1;
          layers.push(layer);
          last = { kind: "layer", index: layers.length - 1 };
          break;
        }
        case 0x2005: {
          const li = body.u16();
          const x = body.i16(), y = body.i16();
          const opacity = body.u8();
          const ctype = body.u16();
          const z = body.i16();
          body.skip(5);
          lastCelLayer = li;
          const layer = layers[li];
          if (!layer) break;
          let cel: Cel;
          const common = { id: `cel_${fi}_${li}`, layerId: layer.id, frameIndex: fi, x, y, opacity, zIndex: z, userData: { text: "" } as UserData };
          if (ctype === 1) {
            const src = celByKey.get(`${li}:${body.u16()}`);
            if (!src) break;
            const linkId = src.linkId ?? `link_${li}_${src.frameIndex}`;
            src.linkId = linkId;
            cel = { ...common, linkId, image: src.image, tilemapData: src.tilemapData };
          } else if (ctype === 3) {
            const w = body.u16(), h = body.u16();
            body.u16();
            body.skip(16 + 10);
            const raw = unzlibSync(body.bytes(end - body.pos));
            const tiles = new Uint32Array(w * h);
            new Uint8Array(tiles.buffer).set(raw.subarray(0, w * h * 4));
            cel = { ...common, image: new PixelImage(Math.max(1, w), Math.max(1, h), colorMode), tilemapData: { width: w, height: h, tiles } };
          } else {
            const w = body.u16(), h = body.u16();
            const px = ctype === 2 ? unzlibSync(body.bytes(end - body.pos)) : body.bytes(w * h * bpp);
            const data = new Uint8Array(Math.max(1, w) * Math.max(1, h) * bpp);
            data.set(px.subarray(0, Math.min(px.length, data.length)));
            cel = { ...common, image: new PixelImage(Math.max(1, w), Math.max(1, h), colorMode, data) };
          }
          cels.push(cel);
          celByKey.set(`${li}:${fi}`, cel);
          last = { kind: "cel", cel };
          break;
        }
        case 0x2018: {
          const n = body.u16();
          body.skip(8);
          for (let k = 0; k < n; k++) {
            const from = body.u16(), to = body.u16(), dir = body.u8(), repeat = body.u16();
            body.skip(6);
            const cr = body.u8(), cg = body.u8(), cb = body.u8();
            body.skip(1);
            tags.push({ id: `tag_${tags.length}`, name: body.str(), fromFrame: from, toFrame: to, direction: DIRECTIONS[dir] ?? "forward", color: rgbToHex(cr, cg, cb), repeat, userData: { text: "" } });
          }
          tagUserIdx = 0;
          last = { kind: "tag", index: 0 };
          break;
        }
        case 0x2022: {
          const n = body.u32();
          const flags = body.u32();
          body.skip(4);
          const sname = body.str();
          const keys: Slice["keys"] = [];
          for (let k = 0; k < n; k++) {
            const frameIndex = body.u32();
            const bounds = { x: body.i32(), y: body.i32(), width: body.u32(), height: body.u32() };
            const key: Slice["keys"][number] = { frameIndex, bounds };
            if (flags & 1) key.center = { x: body.i32(), y: body.i32(), width: body.u32(), height: body.u32() };
            if (flags & 2) key.pivot = { x: body.i32(), y: body.i32() };
            keys.push(key);
          }
          slices.push({ id: `slice_${slices.length}`, name: sname, color: "#0000ff", keys, userData: { text: "" } });
          last = { kind: "slice", index: slices.length - 1 };
          break;
        }
        case 0x2023: {
          const id = body.u32();
          const flags = body.u32();
          const nTiles = body.u32();
          const tw = body.u16(), th = body.u16();
          const base = body.i16();
          body.skip(14);
          const tname = body.str();
          if (flags & 1) { body.u32(); body.u32(); }
          const tiles: PixelImage[] = [];
          if (flags & 2) {
            const len = body.u32();
            const raw = unzlibSync(body.bytes(len));
            const per = tw * th * bpp;
            for (let k = 0; k < nTiles; k++) tiles.push(new PixelImage(tw, th, colorMode, raw.slice(k * per, (k + 1) * per)));
          }
          tilesets.push({ id: `tileset_${id}`, name: tname, tileWidth: tw, tileHeight: th, gridOriginX: 0, gridOriginY: 0, baseIndex: base, tiles, userData: { text: "" } });
          tilesetFileIds.push(id);
          last = { kind: "tileset", index: tilesets.length - 1 };
          break;
        }
        case 0x2020: {
          const flags = body.u32();
          const ud: UserData = { text: "" };
          if (flags & 1) ud.text = body.str();
          if (flags & 2) { const rr = body.u8(), gg = body.u8(), bb = body.u8(); body.u8(); ud.color = rgbToHex(rr, gg, bb); }
          if (last.kind === "sprite") Object.assign(userData, ud);
          else if (last.kind === "layer") layers[last.index].userData = ud;
          else if (last.kind === "cel") last.cel.userData = ud;
          else if (last.kind === "slice") { slices[last.index].userData = ud; if (ud.color) slices[last.index].color = ud.color; }
          else if (last.kind === "tileset") tilesets[last.index].userData = ud;
          else if (last.kind === "tag") {
            if (tags[tagUserIdx]) tags[tagUserIdx].userData = ud;
            tagUserIdx += 1;
            if (tagUserIdx >= tags.length) last = { kind: "none" };
          }
          break;
        }
        default:
          preserved.push({
            frameIndex: fi,
            type,
            data: bytes.slice(r.pos, end),
            celLayerIndex: type === 0x2006 ? lastCelLayer : undefined,
          });
      }
      r.pos = end;
    }
    r.pos = frameEnd;
  }

  if (palettes.length === 0) {
    const colors: RGBA[] = [];
    for (let i = 0; i < 256; i++) colors.push({ r: i, g: i, b: i, a: 255 });
    palettes.push({ id: "pal_0", name: "Palette", fromFrame: 0, toFrame: 9999, colors });
  }
  void paletteColors;
  for (let i = 0; i < palettes.length - 1; i++) palettes[i].toFrame = palettes[i + 1].fromFrame - 1;

  const sprite: Sprite = {
    id: `sprite_${Date.now().toString(36)}`,
    name,
    width,
    height,
    colorMode,
    transparentIndex,
    pixelRatio: { w: pw, h: ph },
    grid: { x: gx, y: gy, width: gw || 16, height: gh || 16, visible: false },
    palettes,
    layers,
    frames,
    cels,
    tags,
    slices,
    tilesets,
    mask: new Mask(width, height),
    userData,
    preservedChunks: preserved,
  };
  for (const cel of sprite.cels) {
    const layer = sprite.layers.find((l) => l.id === cel.layerId);
    if (layer && layer.kind === "tilemap" && cel.tilemapData) syncCelImageFromTilemap(cel, layer, sprite);
  }
  return sprite;
}

/** Quick signature check for `.aseprite` data. */
export function isAsepriteData(bytes: Uint8Array): boolean {
  return bytes.length >= 128 && bytes[4] === 0xe0 && bytes[5] === 0xa5;
}
