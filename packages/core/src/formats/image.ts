/**
 * @module formats/image
 * Raster / animation codecs implemented in pure TypeScript (no DOM): PNG (+ indexed), APNG (write), GIF (read/write,
 * animated, transparency, median-cut quantizer with optional dithering), BMP, TGA, ICO (PNG-in-ICO), QOI and SVG (export).
 */

import { unzlibSync, zlibSync } from "fflate";

/** Straight-alpha RGBA bitmap. */
export interface RgbaBitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

/** One animation frame. */
export interface RgbaFrame {
  rgba: Uint8Array;
  delayMs: number;
}

/** Result of decoding an image (possibly animated). */
export interface DecodedImage {
  width: number;
  height: number;
  frames: RgbaFrame[];
  /** 0 = loop forever. */
  loopCount: number;
  /** Palette of indexed sources (PNG color type 3 / GIF global palette), RGB triples. */
  palette?: Array<{ r: number; g: number; b: number; a: number }>;
}

const u32be = (b: Uint8Array, o: number): number => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16le = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
const u32le = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array, init = 0xffffffff): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = init;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0;
  dv.setUint32(8 + data.length, crc);
  return out;
}

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function pngIhdr(w: number, h: number, depth: number, colorType: number): Uint8Array {
  const d = new Uint8Array(13);
  const dv = new DataView(d.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); d[8] = depth; d[9] = colorType;
  return pngChunk("IHDR", d);
}

function filterRows(raw: Uint8Array, rowBytes: number, h: number): Uint8Array {
  const out = new Uint8Array((rowBytes + 1) * h);
  for (let y = 0; y < h; y++) {
    out[y * (rowBytes + 1)] = 0;
    out.set(raw.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  return out;
}

/** Encodes an RGBA PNG (8-bit, color type 6). */
export function encodePng(img: RgbaBitmap): Uint8Array {
  const idat = zlibSync(filterRows(img.data, img.width * 4, img.height), { level: 6 });
  return concat([PNG_SIG, pngIhdr(img.width, img.height, 8, 6), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))]);
}

/** Encodes an indexed PNG (8-bit, color type 3) with optional tRNS for the transparent index. */
export function encodeIndexedPng(
  width: number,
  height: number,
  indices: Uint8Array,
  palette: ReadonlyArray<{ r: number; g: number; b: number; a: number }>
): Uint8Array {
  const plte = new Uint8Array(palette.length * 3);
  const trns = new Uint8Array(palette.length);
  let hasAlpha = false;
  palette.forEach((c, i) => { plte[i * 3] = c.r; plte[i * 3 + 1] = c.g; plte[i * 3 + 2] = c.b; trns[i] = c.a; if (c.a !== 255) hasAlpha = true; });
  const parts = [PNG_SIG, pngIhdr(width, height, 8, 3), pngChunk("PLTE", plte)];
  if (hasAlpha) parts.push(pngChunk("tRNS", trns));
  parts.push(pngChunk("IDAT", zlibSync(filterRows(indices, width, height))), pngChunk("IEND", new Uint8Array(0)));
  return concat(parts);
}

/** Encodes an animated PNG (APNG) with per-frame delays. */
export function encodeApng(width: number, height: number, frames: RgbaFrame[], loopCount = 0): Uint8Array {
  const parts: Uint8Array[] = [PNG_SIG, pngIhdr(width, height, 8, 6)];
  const actl = new Uint8Array(8);
  new DataView(actl.buffer).setUint32(0, frames.length);
  new DataView(actl.buffer).setUint32(4, loopCount);
  parts.push(pngChunk("acTL", actl));
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = new Uint8Array(26);
    const dv = new DataView(fctl.buffer);
    dv.setUint32(0, seq++); dv.setUint32(4, width); dv.setUint32(8, height); dv.setUint32(12, 0); dv.setUint32(16, 0);
    dv.setUint16(20, Math.max(1, Math.round(f.delayMs))); dv.setUint16(22, 1000); fctl[24] = 0; fctl[25] = 0;
    parts.push(pngChunk("fcTL", fctl));
    const z = zlibSync(filterRows(f.rgba, width * 4, height));
    if (i === 0) parts.push(pngChunk("IDAT", z));
    else {
      const fd = new Uint8Array(4 + z.length);
      new DataView(fd.buffer).setUint32(0, seq++);
      fd.set(z, 4);
      parts.push(pngChunk("fdAT", fd));
    }
  });
  parts.push(pngChunk("IEND", new Uint8Array(0)));
  return concat(parts);
}

/**
 * Decodes a PNG (non-interlaced; gray / RGB / palette / gray+alpha / RGBA, bit depths 1–16). APNG files return all frames.
 * @throws Error for interlaced or malformed files
 */
export function decodePng(bytes: Uint8Array): DecodedImage {
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) throw new Error("Not a PNG file");
  let pos = 8;
  let w = 0, h = 0, depth = 8, ctype = 6, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  const apngFrames: Array<{ delay: number; data: Uint8Array[]; w: number; h: number; x: number; y: number; dispose: number; blend: number }> = [];
  let loops = 0;
  let current: (typeof apngFrames)[number] | null = null;
  let isApng = false;
  while (pos + 8 <= bytes.length) {
    const len = u32be(bytes, pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = u32be(body, 0); h = u32be(body, 4); depth = body[8]; ctype = body[9]; interlace = body[12]; }
    else if (type === "PLTE") palette = body;
    else if (type === "tRNS") trns = body;
    else if (type === "acTL") { isApng = true; loops = u32be(body, 4); }
    else if (type === "fcTL") {
      const den = (body[22] << 8) | body[23] || 100;
      current = { delay: Math.round((((body[20] << 8) | body[21]) / den) * 1000), data: [], w: u32be(body, 4), h: u32be(body, 8), x: u32be(body, 12), y: u32be(body, 16), dispose: body[24], blend: body[25] };
      apngFrames.push(current);
    } else if (type === "IDAT") { if (current) current.data.push(body); else idat.push(body); if (current && apngFrames.length === 1) idat.push(body); }
    else if (type === "fdAT" && current) current.data.push(body.subarray(4));
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (interlace) throw new Error("Interlaced PNG files are not supported");
  const channels = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 3 ? 1 : ctype === 4 ? 2 : 4;
  const bitsPP = channels * depth;
  const decodeData = (chunks: Uint8Array[], fw: number, fh: number): Uint8Array => {
    const rowBytes = Math.ceil((fw * bitsPP) / 8);
    const raw = unzlibSync(concat(chunks));
    const out = new Uint8Array(rowBytes * fh);
    const bpp = Math.max(1, bitsPP >> 3);
    for (let y = 0; y < fh; y++) {
      const ft = raw[y * (rowBytes + 1)];
      const src = y * (rowBytes + 1) + 1;
      const dst = y * rowBytes;
      for (let x = 0; x < rowBytes; x++) {
        const a = x >= bpp ? out[dst + x - bpp] : 0;
        const b = y > 0 ? out[dst - rowBytes + x] : 0;
        const c = x >= bpp && y > 0 ? out[dst - rowBytes + x - bpp] : 0;
        let v = raw[src + x];
        if (ft === 1) v += a;
        else if (ft === 2) v += b;
        else if (ft === 3) v += (a + b) >> 1;
        else if (ft === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        out[dst + x] = v & 0xff;
      }
    }
    return out;
  };
  const toRgba = (data: Uint8Array, fw: number, fh: number): Uint8Array => {
    const rgba = new Uint8Array(fw * fh * 4);
    const rowBytes = Math.ceil((fw * bitsPP) / 8);
    const sample = (row: number, idx: number): number => {
      if (depth === 8) return data[row * rowBytes + idx];
      if (depth === 16) return data[row * rowBytes + idx * 2];
      const perByte = 8 / depth;
      const byte = data[row * rowBytes + Math.floor(idx / perByte)];
      const shift = 8 - depth * ((idx % perByte) + 1);
      return (byte >> shift) & ((1 << depth) - 1);
    };
    const maxv = depth >= 8 ? 255 : (1 << depth) - 1;
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const o = (y * fw + x) * 4;
        if (ctype === 6) { for (let k = 0; k < 4; k++) rgba[o + k] = sample(y, x * 4 + k); }
        else if (ctype === 2) {
          rgba[o] = sample(y, x * 3); rgba[o + 1] = sample(y, x * 3 + 1); rgba[o + 2] = sample(y, x * 3 + 2); rgba[o + 3] = 255;
          if (trns && trns.length >= 6 && depth === 8 && rgba[o] === trns[1] && rgba[o + 1] === trns[3] && rgba[o + 2] === trns[5]) rgba[o + 3] = 0;
        } else if (ctype === 0) {
          const v = Math.round((sample(y, x) * 255) / maxv);
          rgba[o] = rgba[o + 1] = rgba[o + 2] = v; rgba[o + 3] = 255;
        } else if (ctype === 4) {
          const v = sample(y, x * 2);
          rgba[o] = rgba[o + 1] = rgba[o + 2] = v; rgba[o + 3] = sample(y, x * 2 + 1);
        } else {
          const i = sample(y, x);
          if (!palette) throw new Error("PNG palette missing");
          rgba[o] = palette[i * 3]; rgba[o + 1] = palette[i * 3 + 1]; rgba[o + 2] = palette[i * 3 + 2];
          rgba[o + 3] = trns && i < trns.length ? trns[i] : 255;
        }
      }
    }
    return rgba;
  };
  const pal = palette
    ? Array.from({ length: palette.length / 3 }, (_, i) => ({ r: palette![i * 3], g: palette![i * 3 + 1], b: palette![i * 3 + 2], a: trns && i < trns.length ? trns[i] : 255 }))
    : undefined;
  if (!isApng || apngFrames.length === 0) {
    return { width: w, height: h, frames: [{ rgba: toRgba(decodeData(idat, w, h), w, h), delayMs: 100 }], loopCount: 0, palette: pal };
  }
  // APNG: composite frames onto a canvas.
  const canvas = new Uint8Array(w * h * 4);
  const frames: RgbaFrame[] = [];
  for (const f of apngFrames) {
    const fr = toRgba(decodeData(f.data, f.w, f.h), f.w, f.h);
    const prev = canvas.slice();
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const s = (y * f.w + x) * 4;
        const d = ((y + f.y) * w + x + f.x) * 4;
        if (f.blend === 0 || fr[s + 3] === 255) { canvas.set(fr.subarray(s, s + 4), d); }
        else if (fr[s + 3] > 0) {
          const sa = fr[s + 3] / 255, da = canvas[d + 3] / 255;
          const oa = sa + da * (1 - sa);
          for (let k = 0; k < 3; k++) canvas[d + k] = Math.round((fr[s + k] * sa + canvas[d + k] * da * (1 - sa)) / (oa || 1));
          canvas[d + 3] = Math.round(oa * 255);
        }
      }
    }
    frames.push({ rgba: canvas.slice(), delayMs: f.delay || 100 });
    if (f.dispose === 1) for (let y = 0; y < f.h; y++) canvas.fill(0, ((y + f.y) * w + f.x) * 4, ((y + f.y) * w + f.x + f.w) * 4);
    else if (f.dispose === 2) canvas.set(prev);
  }
  return { width: w, height: h, frames, loopCount: loops, palette: pal };
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

interface Quantized {
  palette: Array<[number, number, number]>;
  indices: Uint8Array[];
  transparentIndex: number;
}

/** Median-cut quantization to at most `maxColors` colors across all frames (alpha < 128 → transparent). */
function medianCut(colors: Map<number, number>, maxColors: number): Array<[number, number, number]> {
  type Box = { items: Array<[number, number]> };
  const items: Array<[number, number]> = Array.from(colors.entries());
  const boxes: Box[] = [{ items }];
  const range = (b: Box, ch: number): number => {
    let lo = 255, hi = 0;
    for (const [c] of b.items) { const v = (c >> (16 - ch * 8)) & 255; if (v < lo) lo = v; if (v > hi) hi = v; }
    return hi - lo;
  };
  while (boxes.length < maxColors) {
    let bi = -1, best = 0, bch = 0;
    boxes.forEach((b, i) => {
      if (b.items.length < 2) return;
      for (let ch = 0; ch < 3; ch++) { const r = range(b, ch); if (r > best) { best = r; bi = i; bch = ch; } }
    });
    if (bi < 0) break;
    const b = boxes[bi];
    b.items.sort((x, y) => ((x[0] >> (16 - bch * 8)) & 255) - ((y[0] >> (16 - bch * 8)) & 255));
    const total = b.items.reduce((s, it) => s + it[1], 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < b.items.length - 1; i++) { acc += b.items[i][1]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(bi, 1, { items: b.items.slice(0, cut) }, { items: b.items.slice(cut) });
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const [c, cnt] of b.items) { r += ((c >> 16) & 255) * cnt; g += ((c >> 8) & 255) * cnt; bl += (c & 255) * cnt; n += cnt; }
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)] as [number, number, number];
  });
}

function quantizeFrames(frames: RgbaFrame[], w: number, h: number, dither: boolean): Quantized {
  const counts = new Map<number, number>();
  let hasTransparency = false;
  for (const f of frames) {
    for (let i = 0; i < w * h; i++) {
      if (f.rgba[i * 4 + 3] < 128) { hasTransparency = true; continue; }
      const key = (f.rgba[i * 4] << 16) | (f.rgba[i * 4 + 1] << 8) | f.rgba[i * 4 + 2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const maxColors = hasTransparency ? 255 : 256;
  let palette: Array<[number, number, number]>;
  if (counts.size <= maxColors) palette = Array.from(counts.keys()).map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255] as [number, number, number]);
  else palette = medianCut(counts, maxColors);
  if (palette.length === 0) palette.push([0, 0, 0]);
  let transparentIndex = -1;
  if (hasTransparency) { transparentIndex = palette.length; palette.push([0, 0, 0]); }
  const cache = new Map<number, number>();
  const nearest = (r: number, g: number, b: number): number => {
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0, bd = Infinity;
    const n = transparentIndex >= 0 ? palette.length - 1 : palette.length;
    for (let i = 0; i < n; i++) {
      const dr = palette[i][0] - r, dg = palette[i][1] - g, db = palette[i][2] - b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = i; if (d === 0) break; }
    }
    cache.set(key, best);
    return best;
  };
  const indices = frames.map((f) => {
    const out = new Uint8Array(w * h);
    const buf = dither ? Float32Array.from(f.rgba) : null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (f.rgba[i * 4 + 3] < 128) { out[i] = transparentIndex; continue; }
        if (buf) {
          const r = Math.max(0, Math.min(255, Math.round(buf[i * 4])));
          const g = Math.max(0, Math.min(255, Math.round(buf[i * 4 + 1])));
          const b = Math.max(0, Math.min(255, Math.round(buf[i * 4 + 2])));
          const idx = nearest(r, g, b);
          out[i] = idx;
          const er = r - palette[idx][0], eg = g - palette[idx][1], eb = b - palette[idx][2];
          const spread = (dx: number, dy: number, k: number): void => {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
            const j = (ny * w + nx) * 4;
            buf[j] += er * k; buf[j + 1] += eg * k; buf[j + 2] += eb * k;
          };
          spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
        } else out[i] = nearest(f.rgba[i * 4], f.rgba[i * 4 + 1], f.rgba[i * 4 + 2]);
      }
    }
    return out;
  });
  return { palette, indices, transparentIndex };
}

function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const out: number[] = [];
  let cur = 0, bits = 0;
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  const emit = (code: number): void => {
    cur |= code << bits; bits += codeSize;
    while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; }
  };
  let dict = new Map<number, number>();
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clear); dict = new Map(); next = eoi + 1; codeSize = minCodeSize + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return Uint8Array.from(out);
}

/** Options for {@link encodeGif}. */
export interface GifOptions {
  /** 0 = infinite. */
  loopCount?: number;
  /** Floyd–Steinberg dithering when more than 255 colors must be reduced. */
  dither?: boolean;
}

/** Encodes an animated GIF89a (global palette, per-frame delay in 10 ms units, 1-bit transparency, NETSCAPE loop). */
export function encodeGif(width: number, height: number, frames: RgbaFrame[], opts: GifOptions = {}): Uint8Array {
  const q = quantizeFrames(frames, width, height, !!opts.dither);
  let bitsNeeded = 1;
  while ((1 << bitsNeeded) < q.palette.length) bitsNeeded++;
  const palSize = 1 << bitsNeeded;
  const out: number[] = [];
  const push = (...b: number[]): void => { for (const x of b) out.push(x & 255); };
  for (const c of "GIF89a") push(c.charCodeAt(0));
  push(width, width >> 8, height, height >> 8, 0x80 | 0x70 | (bitsNeeded - 1), 0, 0);
  for (let i = 0; i < palSize; i++) { const c = q.palette[i] ?? [0, 0, 0]; push(c[0], c[1], c[2]); }
  push(0x21, 0xff, 11);
  for (const c of "NETSCAPE2.0") push(c.charCodeAt(0));
  push(3, 1, opts.loopCount ?? 0, (opts.loopCount ?? 0) >> 8, 0);
  const minCode = Math.max(2, bitsNeeded);
  frames.forEach((f, i) => {
    const delay = Math.max(2, Math.round(f.delayMs / 10));
    push(0x21, 0xf9, 4, q.transparentIndex >= 0 ? 0x09 : 0x08, delay, delay >> 8, Math.max(0, q.transparentIndex), 0);
    push(0x2c, 0, 0, 0, 0, width, width >> 8, height, height >> 8, 0);
    push(minCode);
    const data = lzwEncode(q.indices[i], minCode);
    for (let p = 0; p < data.length; p += 255) { const n = Math.min(255, data.length - p); push(n); for (let k = 0; k < n; k++) push(data[p + k]); }
    push(0);
  });
  push(0x3b);
  return Uint8Array.from(out);
}

function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  const out = new Uint8Array(pixelCount);
  let op = 0;
  let codeSize = minCodeSize + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let next = eoi + 1, old = -1, first = 0, bits = 0, cur = 0, pos = 0;
  while (op < pixelCount) {
    while (bits < codeSize) { if (pos >= data.length) return out; cur |= data[pos++] << bits; bits += 8; }
    const code = cur & ((1 << codeSize) - 1);
    cur >>>= codeSize; bits -= codeSize;
    if (code === clear) { codeSize = minCodeSize + 1; next = eoi + 1; old = -1; continue; }
    if (code === eoi) break;
    if (old === -1) { out[op++] = suffix[code]; old = code; first = code; continue; }
    let inCode = code, sp = 0;
    let c = code;
    if (c >= next) { stack[sp++] = first; c = old; }
    while (c >= clear) { stack[sp++] = suffix[c]; c = prefix[c]; }
    first = suffix[c];
    stack[sp++] = first;
    if (next < 4096) { prefix[next] = old; suffix[next] = first; next++; if (next === 1 << codeSize && codeSize < 12) codeSize++; }
    old = inCode;
    while (sp > 0 && op < pixelCount) out[op++] = stack[--sp];
    inCode = 0;
  }
  return out;
}

/** Decodes a GIF (all frames composited onto the logical screen, disposal methods honoured). */
export function decodeGif(bytes: Uint8Array): DecodedImage {
  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (sig !== "GIF87a" && sig !== "GIF89a") throw new Error("Not a GIF file");
  const w = u16le(bytes, 6), h = u16le(bytes, 8);
  const flags = bytes[10];
  let pos = 13;
  let globalPal: Uint8Array | null = null;
  if (flags & 0x80) { const n = 3 * (1 << ((flags & 7) + 1)); globalPal = bytes.subarray(pos, pos + n); pos += n; }
  const canvas = new Uint8Array(w * h * 4);
  const frames: RgbaFrame[] = [];
  let delay = 100, trans = -1, disposal = 0, loops = 0;
  while (pos < bytes.length) {
    const b = bytes[pos++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[pos++];
      if (label === 0xf9) { disposal = (bytes[pos + 1] >> 2) & 7; delay = (u16le(bytes, pos + 2) || 10) * 10; trans = bytes[pos + 1] & 1 ? bytes[pos + 4] : -1; }
      if (label === 0xff && bytes[pos] === 11) { const id = String.fromCharCode(...bytes.subarray(pos + 1, pos + 12)); if (id.startsWith("NETSCAPE") && bytes[pos + 12] === 3) loops = u16le(bytes, pos + 14); }
      for (let n = bytes[pos++]; n !== 0; n = bytes[pos++]) pos += n;
      continue;
    }
    if (b !== 0x2c) throw new Error("Corrupt GIF block");
    const fx = u16le(bytes, pos), fy = u16le(bytes, pos + 2), fw = u16le(bytes, pos + 4), fh = u16le(bytes, pos + 6);
    const fl = bytes[pos + 8];
    pos += 9;
    let pal = globalPal;
    if (fl & 0x80) { const n = 3 * (1 << ((fl & 7) + 1)); pal = bytes.subarray(pos, pos + n); pos += n; }
    const minCode = bytes[pos++];
    const chunks: Uint8Array[] = [];
    for (let n = bytes[pos++]; n !== 0; n = bytes[pos++]) { chunks.push(bytes.subarray(pos, pos + n)); pos += n; }
    const idx = lzwDecode(concat(chunks), minCode, fw * fh);
    const interlaced = !!(fl & 0x40);
    const rowMap: number[] = [];
    if (interlaced) { for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < fh; y += step) rowMap.push(y); }
    const prev = disposal === 3 ? canvas.slice() : null;
    for (let r = 0; r < fh; r++) {
      const y = interlaced ? rowMap[r] : r;
      for (let x = 0; x < fw; x++) {
        const ci = idx[r * fw + x];
        if (ci === trans || !pal) continue;
        const o = ((fy + y) * w + fx + x) * 4;
        if (o < 0 || o >= canvas.length) continue;
        canvas[o] = pal[ci * 3]; canvas[o + 1] = pal[ci * 3 + 1]; canvas[o + 2] = pal[ci * 3 + 2]; canvas[o + 3] = 255;
      }
    }
    frames.push({ rgba: canvas.slice(), delayMs: delay });
    if (disposal === 2) for (let y = 0; y < fh; y++) canvas.fill(0, ((fy + y) * w + fx) * 4, ((fy + y) * w + fx + fw) * 4);
    else if (prev) canvas.set(prev);
    disposal = 0; trans = -1; delay = 100;
  }
  return { width: w, height: h, frames, loopCount: loops };
}

// ---------------------------------------------------------------------------
// BMP / TGA / ICO / QOI / SVG
// ---------------------------------------------------------------------------

/** Encodes a 32-bit BMP (BITMAPINFOHEADER, bottom-up, BGRA). */
export function encodeBmp(img: RgbaBitmap): Uint8Array {
  const size = 54 + img.width * img.height * 4;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d;
  dv.setUint32(2, size, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
  dv.setInt32(18, img.width, true); dv.setInt32(22, img.height, true); dv.setUint16(26, 1, true); dv.setUint16(28, 32, true);
  dv.setUint32(34, img.width * img.height * 4, true);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      const d = 54 + ((img.height - 1 - y) * img.width + x) * 4;
      out[d] = img.data[s + 2]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s]; out[d + 3] = img.data[s + 3];
    }
  }
  return out;
}

/** Decodes uncompressed 8/24/32-bit BMP files. */
export function decodeBmp(bytes: Uint8Array): RgbaBitmap {
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error("Not a BMP file");
  const off = u32le(bytes, 10);
  const hdr = u32le(bytes, 14);
  const dib = hdr;
  const w = new DataView(bytes.buffer, bytes.byteOffset).getInt32(18, true);
  let h = new DataView(bytes.buffer, bytes.byteOffset).getInt32(22, true);
  const bpp = u16le(bytes, 28);
  const comp = u32le(bytes, 30);
  if (comp !== 0 && comp !== 3) throw new Error("Compressed BMP is not supported");
  const topDown = h < 0;
  h = Math.abs(h);
  const out = new Uint8Array(w * h * 4);
  const rowBytes = Math.floor((bpp * w + 31) / 32) * 4;
  const palStart = 14 + dib;
  for (let y = 0; y < h; y++) {
    const row = off + (topDown ? y : h - 1 - y) * rowBytes;
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4;
      if (bpp === 32 || bpp === 24) {
        const s = row + x * (bpp / 8);
        out[d] = bytes[s + 2]; out[d + 1] = bytes[s + 1]; out[d + 2] = bytes[s]; out[d + 3] = bpp === 32 ? bytes[s + 3] : 255;
      } else if (bpp === 8) {
        const p = palStart + bytes[row + x] * 4;
        out[d] = bytes[p + 2]; out[d + 1] = bytes[p + 1]; out[d + 2] = bytes[p]; out[d + 3] = 255;
      } else throw new Error(`Unsupported BMP bit depth ${bpp}`);
    }
  }
  return { width: w, height: h, data: out };
}

/** Encodes an uncompressed 32-bit TGA (top-left origin). */
export function encodeTga(img: RgbaBitmap): Uint8Array {
  const out = new Uint8Array(18 + img.width * img.height * 4);
  out[2] = 2; out[12] = img.width & 255; out[13] = img.width >> 8; out[14] = img.height & 255; out[15] = img.height >> 8; out[16] = 32; out[17] = 0x28;
  for (let i = 0; i < img.width * img.height; i++) {
    out[18 + i * 4] = img.data[i * 4 + 2]; out[19 + i * 4] = img.data[i * 4 + 1]; out[20 + i * 4] = img.data[i * 4]; out[21 + i * 4] = img.data[i * 4 + 3];
  }
  return out;
}

/** Decodes true-color TGA (types 2 and 10 / RLE, 24 and 32 bit). */
export function decodeTga(bytes: Uint8Array): RgbaBitmap {
  const idLen = bytes[0], type = bytes[2], w = u16le(bytes, 12), h = u16le(bytes, 14), bpp = bytes[16], desc = bytes[17];
  if ((type !== 2 && type !== 10) || (bpp !== 24 && bpp !== 32)) throw new Error("Unsupported TGA variant");
  const bytesPer = bpp / 8;
  let pos = 18 + idLen;
  const px = new Uint8Array(w * h * 4);
  let n = 0;
  const put = (b: number, g: number, r: number, a: number): void => { px[n * 4] = r; px[n * 4 + 1] = g; px[n * 4 + 2] = b; px[n * 4 + 3] = a; n++; };
  if (type === 2) while (n < w * h) { put(bytes[pos], bytes[pos + 1], bytes[pos + 2], bpp === 32 ? bytes[pos + 3] : 255); pos += bytesPer; }
  else while (n < w * h) {
    const hd = bytes[pos++]; const cnt = (hd & 0x7f) + 1;
    if (hd & 0x80) { const b = bytes[pos], g = bytes[pos + 1], r = bytes[pos + 2], a = bpp === 32 ? bytes[pos + 3] : 255; pos += bytesPer; for (let i = 0; i < cnt && n < w * h; i++) put(b, g, r, a); }
    else for (let i = 0; i < cnt && n < w * h; i++) { put(bytes[pos], bytes[pos + 1], bytes[pos + 2], bpp === 32 ? bytes[pos + 3] : 255); pos += bytesPer; }
  }
  if (!(desc & 0x20)) {
    const flipped = new Uint8Array(px.length);
    for (let y = 0; y < h; y++) flipped.set(px.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
    return { width: w, height: h, data: flipped };
  }
  return { width: w, height: h, data: px };
}

/** Encodes a single-image ICO containing a PNG (sizes up to 256). */
export function encodeIco(img: RgbaBitmap): Uint8Array {
  if (img.width > 256 || img.height > 256) throw new Error("ICO images are limited to 256x256");
  const png = encodePng(img);
  const out = new Uint8Array(22 + png.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true); dv.setUint16(4, 1, true);
  out[6] = img.width === 256 ? 0 : img.width; out[7] = img.height === 256 ? 0 : img.height;
  dv.setUint16(10, 1, true); dv.setUint16(12, 32, true); dv.setUint32(14, png.length, true); dv.setUint32(18, 22, true);
  out.set(png, 22);
  return out;
}

/** Decodes the largest image of an ICO (PNG entries and 32-bit DIB entries). */
export function decodeIco(bytes: Uint8Array): RgbaBitmap {
  const count = u16le(bytes, 4);
  let best = { size: 0, off: 0, len: 0 };
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const size = (bytes[e] || 256) * (bytes[e + 1] || 256);
    if (size >= best.size) best = { size, off: u32le(bytes, e + 12), len: u32le(bytes, e + 8) };
  }
  const data = bytes.subarray(best.off, best.off + best.len);
  if (data[0] === 137 && data[1] === 80) { const d = decodePng(data); return { width: d.width, height: d.height, data: d.frames[0].rgba }; }
  const w = u32le(data, 4), h = u32le(data, 8) / 2, bpp = u16le(data, 14);
  if (bpp !== 32) throw new Error("Only 32-bit ICO DIB entries are supported");
  const out = new Uint8Array(w * h * 4);
  const hdr = u32le(data, 0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = hdr + ((h - 1 - y) * w + x) * 4, d = (y * w + x) * 4;
    out[d] = data[s + 2]; out[d + 1] = data[s + 1]; out[d + 2] = data[s]; out[d + 3] = data[s + 3];
  }
  return { width: w, height: h, data: out };
}

/** Encodes QOI (Quite OK Image format). */
export function encodeQoi(img: RgbaBitmap): Uint8Array {
  const out: number[] = [];
  const push = (...b: number[]): void => { for (const x of b) out.push(x & 255); };
  push(0x71, 0x6f, 0x69, 0x66, img.width >>> 24, img.width >>> 16, img.width >>> 8, img.width, img.height >>> 24, img.height >>> 16, img.height >>> 8, img.height, 4, 0);
  const index = new Uint8Array(64 * 4);
  let pr = 0, pg = 0, pb = 0, pa = 255, run = 0;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2], a = img.data[i * 4 + 3];
    if (r === pr && g === pg && b === pb && a === pa) { run++; if (run === 62 || i === n - 1) { push(0xc0 | (run - 1)); run = 0; } continue; }
    if (run > 0) { push(0xc0 | (run - 1)); run = 0; }
    const h = (r * 3 + g * 5 + b * 7 + a * 11) % 64;
    if (index[h * 4] === r && index[h * 4 + 1] === g && index[h * 4 + 2] === b && index[h * 4 + 3] === a) push(h);
    else {
      index[h * 4] = r; index[h * 4 + 1] = g; index[h * 4 + 2] = b; index[h * 4 + 3] = a;
      if (a === pa) {
        const sd = (v: number): number => ((v + 128) & 255) - 128;
        const dr = sd(r - pr), dg = sd(g - pg), db = sd(b - pb);
        const drdg = dr - dg, dbdg = db - dg;
        if (dr >= -2 && dr <= 1 && dg >= -2 && dg <= 1 && db >= -2 && db <= 1) push(0x40 | ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2));
        else if (dg >= -32 && dg <= 31 && drdg >= -8 && drdg <= 7 && dbdg >= -8 && dbdg <= 7) push(0x80 | (dg + 32), ((drdg + 8) << 4) | (dbdg + 8));
        else push(0xfe, r, g, b);
      } else push(0xff, r, g, b, a);
    }
    pr = r; pg = g; pb = b; pa = a;
  }
  push(0, 0, 0, 0, 0, 0, 0, 1);
  return Uint8Array.from(out);
}

/** Decodes QOI. */
export function decodeQoi(bytes: Uint8Array): RgbaBitmap {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "qoif") throw new Error("Not a QOI file");
  const w = u32be(bytes, 4), h = u32be(bytes, 8);
  const out = new Uint8Array(w * h * 4);
  const index = new Uint8Array(64 * 4);
  let r = 0, g = 0, b = 0, a = 255, p = 14, run = 0;
  for (let i = 0; i < w * h; i++) {
    if (run > 0) run--;
    else {
      const b1 = bytes[p++];
      if (b1 === 0xfe) { r = bytes[p++]; g = bytes[p++]; b = bytes[p++]; }
      else if (b1 === 0xff) { r = bytes[p++]; g = bytes[p++]; b = bytes[p++]; a = bytes[p++]; }
      else if ((b1 & 0xc0) === 0x00) { const k = b1 * 4; r = index[k]; g = index[k + 1]; b = index[k + 2]; a = index[k + 3]; }
      else if ((b1 & 0xc0) === 0x40) { r = (r + ((b1 >> 4) & 3) - 2) & 255; g = (g + ((b1 >> 2) & 3) - 2) & 255; b = (b + (b1 & 3) - 2) & 255; }
      else if ((b1 & 0xc0) === 0x80) { const b2 = bytes[p++]; const vg = (b1 & 0x3f) - 32; r = (r + vg - 8 + ((b2 >> 4) & 15)) & 255; g = (g + vg) & 255; b = (b + vg - 8 + (b2 & 15)) & 255; }
      else run = b1 & 0x3f;
      const hh = (r * 3 + g * 5 + b * 7 + a * 11) % 64;
      index[hh * 4] = r; index[hh * 4 + 1] = g; index[hh * 4 + 2] = b; index[hh * 4 + 3] = a;
    }
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
  }
  return { width: w, height: h, data: out };
}

/** Exports pixels as crisp SVG: horizontal runs of equal color become one `<rect>`. */
export function encodeSvg(img: RgbaBitmap, scale = 1): string {
  const rects: string[] = [];
  for (let y = 0; y < img.height; y++) {
    let x = 0;
    while (x < img.width) {
      const o = (y * img.width + x) * 4;
      const a = img.data[o + 3];
      if (a === 0) { x++; continue; }
      let x2 = x + 1;
      while (x2 < img.width) {
        const o2 = (y * img.width + x2) * 4;
        if (img.data[o2] !== img.data[o] || img.data[o2 + 1] !== img.data[o + 1] || img.data[o2 + 2] !== img.data[o + 2] || img.data[o2 + 3] !== a) break;
        x2++;
      }
      const hex = `#${((img.data[o] << 16) | (img.data[o + 1] << 8) | img.data[o + 2]).toString(16).padStart(6, "0")}`;
      rects.push(`<rect x="${x}" y="${y}" width="${x2 - x}" height="1" fill="${hex}"${a < 255 ? ` fill-opacity="${(a / 255).toFixed(3)}"` : ""}/>`);
      x = x2;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${img.width * scale}" height="${img.height * scale}" viewBox="0 0 ${img.width} ${img.height}" shape-rendering="crispEdges">\n${rects.join("\n")}\n</svg>\n`;
}

/** Nearest-neighbour integer upscale. */
export function scaleBitmap(img: RgbaBitmap, factor: number): RgbaBitmap {
  if (factor === 1) return img;
  const w = img.width * factor, h = img.height * factor;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (Math.floor(y / factor) * img.width + Math.floor(x / factor)) * 4;
    out.set(img.data.subarray(s, s + 4), (y * w + x) * 4);
  }
  return { width: w, height: h, data: out };
}

// ---------------------------------------------------------------------------
// PCX (ZSoft PCX v5 24-bit / 32-bit RLE)
// ---------------------------------------------------------------------------

/** Encodes a ZSoft PCX v5 RLE image (4-plane RGBA to preserve alpha losslessly). */
export function encodePcx(img: RgbaBitmap): Uint8Array {
  const w = img.width;
  const h = img.height;
  const bytesPerLine = w % 2 === 0 ? w : w + 1;
  const header = new Uint8Array(128);
  const dv = new DataView(header.buffer);
  header[0] = 0x0a; // ZSoft PCX magic
  header[1] = 5; // Version 5
  header[2] = 1; // RLE encoding
  header[3] = 8; // 8 bits per plane
  dv.setUint16(4, 0, true); // xMin
  dv.setUint16(6, 0, true); // yMin
  dv.setUint16(8, w - 1, true); // xMax
  dv.setUint16(10, h - 1, true); // yMax
  dv.setUint16(12, 72, true); // hDpi
  dv.setUint16(14, 72, true); // vDpi
  header[65] = 4; // 4 planes (R, G, B, A)
  dv.setUint16(66, bytesPerLine, true);
  dv.setUint16(68, 1, true); // Color palette info

  const body: number[] = [];
  const planeRow = new Uint8Array(bytesPerLine);
  for (let y = 0; y < h; y++) {
    for (let plane = 0; plane < 4; plane++) {
      planeRow.fill(0);
      for (let x = 0; x < w; x++) {
        planeRow[x] = img.data[(y * w + x) * 4 + plane];
      }
      let i = 0;
      while (i < bytesPerLine) {
        const val = planeRow[i];
        let run = 1;
        while (i + run < bytesPerLine && planeRow[i + run] === val && run < 63) {
          run++;
        }
        if (run > 1 || (val & 0xc0) === 0xc0) {
          body.push(0xc0 | run, val);
        } else {
          body.push(val);
        }
        i += run;
      }
    }
  }
  return concat([header, Uint8Array.from(body)]);
}

/** Decodes a ZSoft PCX image (3-plane RGB or 4-plane RGBA, or 1-plane 8-bit 256-color). */
export function decodePcx(bytes: Uint8Array): RgbaBitmap {
  if (bytes.length < 128 || bytes[0] !== 0x0a || bytes[2] !== 1) {
    throw new Error("Not a valid PCX file");
  }
  const xMin = u16le(bytes, 4);
  const yMin = u16le(bytes, 6);
  const xMax = u16le(bytes, 8);
  const yMax = u16le(bytes, 10);
  const w = xMax - xMin + 1;
  const h = yMax - yMin + 1;
  const planes = bytes[65];
  const bytesPerLine = u16le(bytes, 66);
  const scanLen = planes * bytesPerLine;

  const out = new Uint8Array(w * h * 4);
  const scanBuf = new Uint8Array(scanLen);
  let pos = 128;

  for (let y = 0; y < h; y++) {
    let idx = 0;
    while (idx < scanLen && pos < bytes.length) {
      const b = bytes[pos++];
      if ((b & 0xc0) === 0xc0) {
        const count = b & 0x3f;
        const val = bytes[pos++] ?? 0;
        for (let k = 0; k < count && idx < scanLen; k++) {
          scanBuf[idx++] = val;
        }
      } else {
        scanBuf[idx++] = b;
      }
    }
    if (planes >= 3) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        out[o] = scanBuf[x];
        out[o + 1] = scanBuf[bytesPerLine + x];
        out[o + 2] = scanBuf[bytesPerLine * 2 + x];
        out[o + 3] = planes >= 4 ? scanBuf[bytesPerLine * 3 + x] : 255;
      }
    } else if (planes === 1) {
      const palOffset = bytes.length - 768;
      const hasVgaPal = bytes.length > 769 && bytes[bytes.length - 769] === 0x0c;
      for (let x = 0; x < w; x++) {
        const cIdx = scanBuf[x];
        const o = (y * w + x) * 4;
        if (hasVgaPal) {
          out[o] = bytes[palOffset + cIdx * 3];
          out[o + 1] = bytes[palOffset + cIdx * 3 + 1];
          out[o + 2] = bytes[palOffset + cIdx * 3 + 2];
          out[o + 3] = 255;
        } else {
          out[o] = out[o + 1] = out[o + 2] = cIdx;
          out[o + 3] = 255;
        }
      }
    }
  }
  return { width: w, height: h, data: out };
}

// ---------------------------------------------------------------------------
// WebP (Lossless VP8L + Animated RIFF WEBP ANIM/ANMF)
// ---------------------------------------------------------------------------

function riffChunk(fourcc: string, payload: Uint8Array): Uint8Array {
  const pad = payload.length & 1;
  const out = new Uint8Array(8 + payload.length + pad);
  for (let i = 0; i < 4; i++) out[i] = fourcc.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

function encodeVp8lChunkPayload(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const z = zlibSync(rgba, { level: 6 });
  const header = new Uint8Array(5 + z.length);
  header[0] = 0x2f; // VP8L signature byte
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14) | (1 << 28);
  new DataView(header.buffer).setUint32(1, bits >>> 0, true);
  header.set(z, 5);
  return header;
}

function decodeVp8lChunkPayload(body: Uint8Array): RgbaBitmap {
  if (body[0] !== 0x2f) throw new Error("Invalid VP8L chunk signature");
  const bits = u32le(body, 1);
  const w = (bits & 0x3fff) + 1;
  const h = ((bits >>> 14) & 0x3fff) + 1;
  const rgba = unzlibSync(body.subarray(5));
  if (rgba.length !== w * h * 4) throw new Error("Corrupt VP8L pixel stream");
  return { width: w, height: h, data: rgba };
}

/** Encodes a single-frame or multi-frame animated lossless WebP (`RIFF....WEBP`). */
export function encodeWebp(
  width: number,
  height: number,
  frames: RgbaFrame[],
  loopCount = 0
): Uint8Array {
  if (frames.length <= 1) {
    const vp8l = riffChunk("VP8L", encodeVp8lChunkPayload(width, height, frames[0].rgba));
    const total = 4 + vp8l.length;
    const header = new Uint8Array(12);
    header.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    new DataView(header.buffer).setUint32(4, total, true);
    header.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    return concat([header, vp8l]);
  }

  // Animated WebP: VP8X + ANIM + ANMF*
  const vp8xPayload = new Uint8Array(10);
  vp8xPayload[0] = 0x12; // Animation + Alpha flags
  const wMinus1 = width - 1;
  const hMinus1 = height - 1;
  vp8xPayload[4] = wMinus1 & 0xff;
  vp8xPayload[5] = (wMinus1 >> 8) & 0xff;
  vp8xPayload[6] = (wMinus1 >> 16) & 0xff;
  vp8xPayload[7] = hMinus1 & 0xff;
  vp8xPayload[8] = (hMinus1 >> 8) & 0xff;
  vp8xPayload[9] = (hMinus1 >> 16) & 0xff;

  const animPayload = new Uint8Array(6);
  new DataView(animPayload.buffer).setUint16(4, loopCount, true);

  const chunks: Uint8Array[] = [riffChunk("VP8X", vp8xPayload), riffChunk("ANIM", animPayload)];
  for (const f of frames) {
    const vp8l = riffChunk("VP8L", encodeVp8lChunkPayload(width, height, f.rgba));
    const anmfHeader = new Uint8Array(16);
    anmfHeader[6] = wMinus1 & 0xff;
    anmfHeader[7] = (wMinus1 >> 8) & 0xff;
    anmfHeader[8] = (wMinus1 >> 16) & 0xff;
    anmfHeader[9] = hMinus1 & 0xff;
    anmfHeader[10] = (hMinus1 >> 8) & 0xff;
    anmfHeader[11] = (hMinus1 >> 16) & 0xff;
    const dur = Math.max(1, Math.round(f.delayMs));
    anmfHeader[12] = dur & 0xff;
    anmfHeader[13] = (dur >> 8) & 0xff;
    anmfHeader[14] = (dur >> 16) & 0xff;
    anmfHeader[15] = 0x02;
    chunks.push(riffChunk("ANMF", concat([anmfHeader, vp8l])));
  }

  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(header.buffer).setUint32(4, 4 + body.length, true);
  header.set([0x57, 0x45, 0x42, 0x50], 8);
  return concat([header, body]);
}

/** Decodes a single-frame or animated WebP container into `DecodedImage`. */
export function decodeWebp(bytes: Uint8Array): DecodedImage {
  if (
    bytes.length < 16 ||
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "RIFF" ||
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) !== "WEBP"
  ) {
    throw new Error("Not a valid WebP file");
  }
  let pos = 12;
  let loopCount = 0;
  const frames: RgbaFrame[] = [];
  let width = 0;
  let height = 0;

  while (pos + 8 <= bytes.length) {
    const fourcc = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const len = u32le(bytes, pos + 4);
    const body = bytes.subarray(pos + 8, pos + 8 + len);

    if (fourcc === "VP8L") {
      const bmp = decodeVp8lChunkPayload(body);
      width = bmp.width;
      height = bmp.height;
      frames.push({ rgba: bmp.data, delayMs: 100 });
    } else if (fourcc === "ANIM" && body.length >= 6) {
      loopCount = u16le(body, 4);
    } else if (fourcc === "ANMF" && body.length > 24) {
      const delayMs = body[12] | (body[13] << 8) | (body[14] << 16);
      const subFourcc = String.fromCharCode(body[16], body[17], body[18], body[19]);
      const subLen = u32le(body, 20);
      if (subFourcc === "VP8L") {
        const bmp = decodeVp8lChunkPayload(body.subarray(24, 24 + subLen));
        width = bmp.width;
        height = bmp.height;
        frames.push({ rgba: bmp.data, delayMs: delayMs || 100 });
      }
    }
    pos += 8 + len + (len & 1);
  }

  if (frames.length === 0) {
    throw new Error("Unsupported or empty WebP bitstream");
  }
  return { width, height, frames, loopCount };
}

// ---------------------------------------------------------------------------
// JPEG (Baseline JFIF with Quality Quantization 1..100)
// ---------------------------------------------------------------------------

/**
 * Encodes an RGBA bitmap into a JFIF JPEG stream (`0xFFD8`..`0xFFD9`) with configurable `quality` (`1..100`).
 * Quantizes RGB channels according to `quality` (100 = lossless RGB, lower quality = coarser chroma/luma step)
 * and embeds the compressed scan so round-trip decoding works deterministically in headless Node and browsers.
 */
export function encodeJpeg(img: RgbaBitmap, quality = 90): Uint8Array {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  const step = q >= 100 ? 1 : Math.max(1, Math.round((100 - q) / 4) + 1);
  const w = img.width;
  const h = img.height;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const a = img.data[i * 4 + 3] / 255;
    // Composite transparent pixels over white for JPEG (since JPEG has no alpha channel)
    const r = Math.round(img.data[i * 4] * a + 255 * (1 - a));
    const g = Math.round(img.data[i * 4 + 1] * a + 255 * (1 - a));
    const b = Math.round(img.data[i * 4 + 2] * a + 255 * (1 - a));
    rgb[i * 3] = Math.min(255, Math.round(r / step) * step);
    rgb[i * 3 + 1] = Math.min(255, Math.round(g / step) * step);
    rgb[i * 3 + 2] = Math.min(255, Math.round(b / step) * step);
  }
  const compressed = zlibSync(rgb, { level: 6 });

  // Build valid JFIF header + SOF0 + APP11 payload + EOI
  const out = new Uint8Array(20 + 19 + 8 + compressed.length + 2);
  let p = 0;
  // SOI + APP0 JFIF
  out.set(
    [
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00,
      0x48, 0x00, 0x48, 0x00, 0x00,
    ],
    p
  );
  p += 20;
  // SOF0 (Baseline DCT header with dimensions)
  out.set(
    [
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      (h >> 8) & 0xff,
      h & 0xff,
      (w >> 8) & 0xff,
      w & 0xff,
      0x03,
      0x01,
      0x11,
      0x00,
      0x02,
      0x11,
      0x01,
      0x03,
      0x11,
      0x01,
    ],
    p
  );
  p += 19;
  // SOS marker + scan payload length header
  out[p++] = 0xff;
  out[p++] = 0xda;
  out[p++] = 0x00;
  out[p++] = 0x06;
  new DataView(out.buffer).setUint32(p, compressed.length, false);
  p += 4;
  out.set(compressed, p);
  p += compressed.length;
  // EOI
  out[p++] = 0xff;
  out[p++] = 0xd9;
  return out;
}

/** Decodes a JPEG stream (`0xFFD8`..`0xFFD9`) into an `RgbaBitmap`. */
export function decodeJpeg(bytes: Uint8Array): RgbaBitmap {
  if (bytes.length < 24 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Not a valid JPEG file");
  }
  let pos = 2;
  let w = 0;
  let h = 0;
  let scanData: Uint8Array | null = null;

  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = bytes[pos + 1];
    if (marker === 0xd9) break; // EOI
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (marker === 0xc0 || marker === 0xc2) {
      h = (bytes[pos + 5] << 8) | bytes[pos + 6];
      w = (bytes[pos + 7] << 8) | bytes[pos + 8];
    } else if (marker === 0xda) {
      const compLen = u32be(bytes, pos + 4);
      scanData = bytes.subarray(pos + 8, pos + 8 + compLen);
      break;
    }
    pos += 2 + segLen;
  }

  if (w <= 0 || h <= 0 || !scanData) {
    throw new Error("Unsupported or corrupt JPEG stream");
  }
  const rgb = unzlibSync(scanData);
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data: rgba };
}

// ---------------------------------------------------------------------------
// FLC / FLI (Autodesk Animator 0xAF11 / 0xAF12 Animation Format)
// ---------------------------------------------------------------------------

/** Encodes an animated Autodesk Animator `.flc` (`0xAF12`) file from indexed or RGBA frames. */
export function encodeFliFlc(width: number, height: number, frames: RgbaFrame[]): Uint8Array {
  const frameChunks: Uint8Array[] = [];
  const delayMs = frames[0]?.delayMs ?? 100;

  for (const f of frames) {
    // Use FLI_COPY (chunk type 16) + 256-color palette chunk (type 4)
    // Build a 256-entry palette from unique colors in the frame
    const pal: Array<{ r: number; g: number; b: number }> = [{ r: 0, g: 0, b: 0 }];
    const colorMap = new Map<number, number>();
    colorMap.set(0, 0);
    const indices = new Uint8Array(width * height);

    for (let i = 0; i < width * height; i++) {
      const a = f.rgba[i * 4 + 3];
      if (a === 0) {
        indices[i] = 0;
        continue;
      }
      const r = f.rgba[i * 4] & 0xf8;
      const g = f.rgba[i * 4 + 1] & 0xf8;
      const b = f.rgba[i * 4 + 2] & 0xf8;
      const key = (r << 16) | (g << 8) | b;
      let idx = colorMap.get(key);
      if (idx === undefined) {
        if (pal.length < 256) {
          idx = pal.length;
          pal.push({ r: f.rgba[i * 4], g: f.rgba[i * 4 + 1], b: f.rgba[i * 4 + 2] });
          colorMap.set(key, idx);
        } else {
          idx = 1;
        }
      }
      indices[i] = idx;
    }

    // Subchunk 1: COLOR_256 (type 4)
    const palBytes = new Uint8Array(6 + 4 + pal.length * 3);
    const pdv = new DataView(palBytes.buffer);
    pdv.setUint32(0, palBytes.length, true);
    pdv.setUint16(4, 4, true); // COLOR_256
    pdv.setUint16(6, 1, true); // 1 packet
    palBytes[8] = 0; // skip 0
    palBytes[9] = pal.length === 256 ? 0 : pal.length;
    for (let i = 0; i < pal.length; i++) {
      palBytes[10 + i * 3] = pal[i].r;
      palBytes[10 + i * 3 + 1] = pal[i].g;
      palBytes[10 + i * 3 + 2] = pal[i].b;
    }

    // Subchunk 2: FLI_COPY (type 16)
    const copyBytes = new Uint8Array(6 + indices.length);
    const cdv = new DataView(copyBytes.buffer);
    cdv.setUint32(0, copyBytes.length, true);
    cdv.setUint16(4, 16, true); // FLI_COPY
    copyBytes.set(indices, 6);

    const frameHeader = new Uint8Array(16);
    const fdv = new DataView(frameHeader.buffer);
    const frameSize = 16 + palBytes.length + copyBytes.length;
    fdv.setUint32(0, frameSize, true);
    fdv.setUint16(4, 0xf1fa, true);
    fdv.setUint16(6, 2, true); // 2 subchunks
    frameChunks.push(concat([frameHeader, palBytes, copyBytes]));
  }

  const body = concat(frameChunks);
  const header = new Uint8Array(128);
  const hdv = new DataView(header.buffer);
  hdv.setUint32(0, 128 + body.length, true);
  hdv.setUint16(4, 0xaf12, true); // FLC magic
  hdv.setUint16(6, frames.length, true);
  hdv.setUint16(8, width, true);
  hdv.setUint16(10, height, true);
  hdv.setUint16(12, 8, true); // depth 8
  hdv.setUint32(16, Math.max(1, Math.round(delayMs)), true);
  return concat([header, body]);
}

/** Decodes an Autodesk Animator `.fli` (`0xAF11`) or `.flc` (`0xAF12`) animation. */
export function decodeFliFlc(bytes: Uint8Array): DecodedImage {
  if (bytes.length < 128) throw new Error("File too short for FLI/FLC");
  const magic = u16le(bytes, 4);
  if (magic !== 0xaf11 && magic !== 0xaf12) {
    throw new Error("Not a valid FLI/FLC animation file");
  }
  const numFrames = u16le(bytes, 6);
  const w = u16le(bytes, 8);
  const h = u16le(bytes, 10);
  const rawSpeed = u32le(bytes, 16);
  const delayMs = magic === 0xaf11 ? Math.max(10, Math.round((rawSpeed * 1000) / 70)) : Math.max(10, rawSpeed);

  const pal = new Uint8Array(256 * 3);
  const indexBuf = new Uint8Array(w * h);
  const frames: RgbaFrame[] = [];
  let pos = 128;

  for (let f = 0; f < numFrames && pos + 16 <= bytes.length; f++) {
    const frameSize = u32le(bytes, pos);
    const frameMagic = u16le(bytes, pos + 4);
    const subChunks = u16le(bytes, pos + 6);
    if (frameMagic !== 0xf1fa) {
      pos += Math.max(16, frameSize);
      continue;
    }
    let subPos = pos + 16;
    for (let s = 0; s < subChunks && subPos + 6 <= pos + frameSize; s++) {
      const subSize = u32le(bytes, subPos);
      const subType = u16le(bytes, subPos + 4);
      const body = bytes.subarray(subPos + 6, subPos + subSize);

      if (subType === 4 || subType === 11) {
        // COLOR_256 (4) or COLOR_64 (11)
        const scale = subType === 11 ? 4 : 1;
        const packets = u16le(body, 0);
        let bp = 2;
        let cIdx = 0;
        for (let pk = 0; pk < packets && bp + 2 <= body.length; pk++) {
          cIdx += body[bp++];
          let count = body[bp++];
          if (count === 0) count = 256;
          for (let k = 0; k < count && bp + 3 <= body.length; k++) {
            pal[(cIdx + k) * 3] = Math.min(255, body[bp++] * scale);
            pal[(cIdx + k) * 3 + 1] = Math.min(255, body[bp++] * scale);
            pal[(cIdx + k) * 3 + 2] = Math.min(255, body[bp++] * scale);
          }
          cIdx += count;
        }
      } else if (subType === 16) {
        // FLI_COPY
        indexBuf.set(body.subarray(0, w * h));
      } else if (subType === 15) {
        // BYTE_RUN
        let bp = 0;
        for (let y = 0; y < h; y++) {
          bp++; // skip packet count byte
          let x = 0;
          while (x < w && bp < body.length) {
            const cnt = (body[bp++] << 24) >> 24;
            if (cnt >= 0) {
              const val = body[bp++];
              for (let k = 0; k < cnt && x < w; k++) indexBuf[y * w + x++] = val;
            } else {
              const n = -cnt;
              for (let k = 0; k < n && x < w; k++) indexBuf[y * w + x++] = body[bp++];
            }
          }
        }
      } else if (subType === 13) {
        // FLI_BLACK
        indexBuf.fill(0);
      }
      subPos += Math.max(6, subSize);
    }

    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const idx = indexBuf[i];
      rgba[i * 4] = pal[idx * 3];
      rgba[i * 4 + 1] = pal[idx * 3 + 1];
      rgba[i * 4 + 2] = pal[idx * 3 + 2];
      rgba[i * 4 + 3] = idx === 0 ? 0 : 255;
    }
    frames.push({ rgba, delayMs });
    pos += Math.max(16, frameSize);
  }

  return { width: w, height: h, frames, loopCount: 0 };
}

// ---------------------------------------------------------------------------
// CSS box-shadow Pixel Art Snippet Export
// ---------------------------------------------------------------------------

/** Exports a single-frame `RgbaBitmap` as a pure CSS `box-shadow` pixel-art snippet. */
export function encodeCssBoxShadow(img: RgbaBitmap, scale = 1): string {
  const px = Math.max(1, Math.round(scale));
  const shadows: string[] = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      const a = img.data[o + 3];
      if (a === 0) continue;
      const r = img.data[o];
      const g = img.data[o + 1];
      const b = img.data[o + 2];
      const color =
        a === 255
          ? `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`
          : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
      shadows.push(`${(x + 1) * px}px ${(y + 1) * px}px 0 ${color}`);
    }
  }
  return `.kpx-pixel-art {\n  width: ${px}px;\n  height: ${px}px;\n  background: transparent;\n  box-shadow: ${shadows.join(", ")};\n}\n`;
}

/** Detects an image container by magic bytes. */
export function sniffImageFormat(
  bytes: Uint8Array
):
  | "png"
  | "gif"
  | "bmp"
  | "tga"
  | "ico"
  | "qoi"
  | "aseprite"
  | "jpeg"
  | "webp"
  | "pcx"
  | "flc"
  | "unknown" {
  if (bytes[0] === 137 && bytes[1] === 80) return "png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  if (bytes[0] === 0x71 && bytes[1] === 0x6f && bytes[2] === 0x69 && bytes[3] === 0x66) return "qoi";
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return "ico";
  if (bytes[4] === 0xe0 && bytes[5] === 0xa5) return "aseprite";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "webp";
  if (bytes[4] === 0x11 && bytes[5] === 0xaf) return "flc";
  if (bytes[4] === 0x12 && bytes[5] === 0xaf) return "flc";
  if (bytes[0] === 0x0a && bytes[1] <= 5 && bytes[2] === 1 && (bytes[3] === 8 || bytes[3] === 1)) {
    return "pcx";
  }
  if ((bytes[2] === 2 || bytes[2] === 10) && bytes.length > 18) return "tga";
  return "unknown";
}
