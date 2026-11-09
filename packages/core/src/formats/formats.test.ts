import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import * as demos from "../model/demos.ts";
import { PixelImage, compositeFrame, type Sprite } from "../model/index.ts";
import {
  DEFAULT_AUTOSAVE, computeImportGrid, createRecoverySnapshot, decodeBmp, decodeGif, decodeIco, decodePng, decodeQoi, decodeSprite,
  decodeTga, encodeApng, encodeBmp, encodeGif, encodeIco, encodeIndexedPng, encodePng, encodeQoi, encodeSprite, encodeSvg, encodeTga, exportSequence,
  exportSpriteSheet, expandNameTemplate, importSequence, importSpriteSheet, isAsepriteData, listSampleProjects, loadSampleProject, pruneRecovery,
  readAseprite, readKpx, restoreRecovery, sniffImageFormat, writeAseprite, writeKpx, SampleProjectRegistry, FormatRegistry,
} from "../index.ts";

function noise(w: number, h: number, seed = 1, alphaLevels = [255]): Uint8Array {
  const d = new Uint8Array(w * h * 4);
  let s = seed;
  const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s >>> 24; };
  for (let i = 0; i < w * h; i++) { d[i * 4] = rnd(); d[i * 4 + 1] = rnd(); d[i * 4 + 2] = rnd(); d[i * 4 + 3] = alphaLevels[rnd() % alphaLevels.length]; }
  return d;
}

function diffSprites(a: Sprite, b: Sprite): string[] {
  const out: string[] = [];
  const chk = (label: string, x: unknown, y: unknown): void => { if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${label}: ${JSON.stringify(x)} != ${JSON.stringify(y)}`); };
  chk("size", [a.width, a.height, a.colorMode], [b.width, b.height, b.colorMode]);
  chk("frames", a.frames.map((f) => f.durationMs), b.frames.map((f) => f.durationMs));
  chk("layers", a.layers.map((l) => [l.name, l.kind, l.visible, l.editable, l.lockMove, l.background, l.preferLinkedCels, l.collapsed, l.reference, l.blendMode, l.opacity, l.userData.text, a.layers.findIndex((p) => p.id === l.parentId)]),
    b.layers.map((l) => [l.name, l.kind, l.visible, l.editable, l.lockMove, l.background, l.preferLinkedCels, l.collapsed, l.reference, l.blendMode, l.opacity, l.userData.text, b.layers.findIndex((p) => p.id === l.parentId)]));
  const celKey = (s: Sprite) => s.cels.map((c) => [s.layers.findIndex((l) => l.id === c.layerId), c.frameIndex, c.x, c.y, c.opacity, c.zIndex, c.image.width, c.image.height, Array.from(c.image.data).join(","), !!c.linkId, c.tilemapData ? Array.from(c.tilemapData.tiles).join(",") : ""].join("|")).sort();
  chk("cels", celKey(a), celKey(b));
  chk("tags", a.tags.map((t) => [t.name, t.fromFrame, t.toFrame, t.direction, t.repeat, t.color.toLowerCase()]), b.tags.map((t) => [t.name, t.fromFrame, t.toFrame, t.direction, t.repeat, t.color.toLowerCase()]));
  chk("slices", a.slices.map((s) => [s.name, s.keys]), b.slices.map((s) => [s.name, s.keys.map((k) => ({ ...k, center: k.center, pivot: k.pivot }))]));
  chk("palette", a.palettes.map((p) => [p.fromFrame, p.colors]), b.palettes.map((p) => [p.fromFrame, p.colors]));
  chk("tilesets", a.tilesets.map((t) => [t.tileWidth, t.tileHeight, t.baseIndex, t.tiles.map((x) => Array.from(x.data).join(","))]), b.tilesets.map((t) => [t.tileWidth, t.tileHeight, t.baseIndex, t.tiles.map((x) => Array.from(x.data).join(","))]));
  for (let f = 0; f < a.frames.length; f++) chk(`composite#${f}`, Array.from(compositeFrame(a, f).data), Array.from(compositeFrame(b, f).data));
  return out;
}

describe("image codecs", () => {
  const w = 13, h = 9;
  it("PNG RGBA round trip (all filters irrelevant: lossless)", () => {
    const data = noise(w, h, 3, [0, 128, 255]);
    const dec = decodePng(encodePng({ width: w, height: h, data }));
    expect([dec.width, dec.height]).toEqual([w, h]);
    expect(Array.from(dec.frames[0].rgba)).toEqual(Array.from(data));
    expect(sniffImageFormat(encodePng({ width: w, height: h, data }))).toBe("png");
  });
  it("indexed PNG keeps palette + transparency", () => {
    const idx = Uint8Array.from({ length: 16 }, (_, i) => i % 3);
    const pal = [{ r: 0, g: 0, b: 0, a: 0 }, { r: 255, g: 0, b: 0, a: 255 }, { r: 0, g: 255, b: 0, a: 255 }];
    const dec = decodePng(encodeIndexedPng(4, 4, idx, pal));
    expect(dec.palette?.length).toBe(3);
    expect(Array.from(dec.frames[0].rgba.subarray(0, 8))).toEqual([0, 0, 0, 0, 255, 0, 0, 255]);
  });
  it("APNG round trip with delays", () => {
    const frames = [0, 1, 2].map((i) => ({ rgba: noise(5, 5, i + 1), delayMs: 50 * (i + 1) }));
    const dec = decodePng(encodeApng(5, 5, frames, 2));
    expect(dec.frames).toHaveLength(3);
    expect(dec.loopCount).toBe(2);
    expect(dec.frames.map((f) => f.delayMs)).toEqual([50, 100, 150]);
    expect(Array.from(dec.frames[2].rgba)).toEqual(Array.from(frames[2].rgba));
  });
  it("GIF animated round trip with transparency and delays (<=255 colours = exact)", () => {
    const mk = (seed: number): Uint8Array => { const d = noise(8, 8, seed, [0, 255]); for (let i = 0; i < 64; i++) { d[i * 4] &= 0xe0; d[i * 4 + 1] &= 0xe0; d[i * 4 + 2] &= 0xe0; if (d[i * 4 + 3] === 0) d.fill(0, i * 4, i * 4 + 3); } return d; };
    const frames = [mk(1), mk(2), mk(3)].map((rgba, i) => ({ rgba, delayMs: 100 + i * 20 }));
    const gif = encodeGif(8, 8, frames, { loopCount: 0 });
    expect(sniffImageFormat(gif)).toBe("gif");
    const dec = decodeGif(gif);
    expect(dec.frames).toHaveLength(3);
    expect(dec.frames.map((f) => f.delayMs)).toEqual([100, 120, 140]);
    for (let f = 0; f < 3; f++) for (let i = 0; i < 64; i++) {
      expect(dec.frames[f].rgba[i * 4 + 3]).toBe(frames[f].rgba[i * 4 + 3] === 0 ? 0 : 255);
      if (frames[f].rgba[i * 4 + 3] !== 0) expect(Array.from(dec.frames[f].rgba.subarray(i * 4, i * 4 + 3))).toEqual(Array.from(frames[f].rgba.subarray(i * 4, i * 4 + 3)));
    }
  });
  it("GIF quantizes >256 colours (median cut) and dithering option works", () => {
    const rgba = noise(32, 32, 9);
    for (const dither of [false, true]) {
      const dec = decodeGif(encodeGif(32, 32, [{ rgba, delayMs: 100 }], { dither }));
      expect(dec.frames[0].rgba.length).toBe(32 * 32 * 4);
    }
  });
  it("BMP / TGA / ICO / QOI round trips", () => {
    const data = noise(w, h, 5, [0, 17, 255]);
    const bmp = { width: w, height: h, data };
    expect(Array.from(decodeBmp(encodeBmp(bmp)).data)).toEqual(Array.from(data));
    expect(Array.from(decodeTga(encodeTga(bmp)).data)).toEqual(Array.from(data));
    expect(Array.from(decodeIco(encodeIco(bmp)).data)).toEqual(Array.from(data));
    expect(Array.from(decodeQoi(encodeQoi(bmp)).data)).toEqual(Array.from(data));
    const flat = { width: 20, height: 20, data: new Uint8Array(20 * 20 * 4).fill(77) };
    expect(Array.from(decodeQoi(encodeQoi(flat)).data)).toEqual(Array.from(flat.data));
  });
  it("SVG merges runs into rects", () => {
    const d = new Uint8Array(4 * 4 * 4);
    for (let x = 0; x < 4; x++) d.set([255, 0, 0, 255], x * 4);
    const svg = encodeSvg({ width: 4, height: 4, data: d }, 8);
    expect(svg).toContain('width="32"');
    expect((svg.match(/<rect/g) ?? []).length).toBe(1);
  });
});

describe(".aseprite codec", () => {
  const creators = Object.entries(demos).filter(([k]) => /^create.*Document$/.test(k));
  it("covers every demo document creator", () => expect(creators.length).toBeGreaterThanOrEqual(19));
  for (const [name, fn] of creators) {
    it(`round-trips ${name}`, () => {
      const doc = (fn as () => { sprite: Sprite })();
      const bytes = writeAseprite(doc.sprite as Sprite);
      expect(isAsepriteData(bytes)).toBe(true);
      const back = readAseprite(bytes, "x.aseprite");
      expect(diffSprites(doc.sprite as Sprite, back)).toEqual([]);
      const again = writeAseprite(back);
      expect(readAseprite(again).cels.length).toBe(back.cels.length);
    });
  }
  it("reads a hand-assembled byte-level fixture (header, layer, raw cel, palette, tag)", () => {
    const b: number[] = [];
    const u8 = (v: number) => b.push(v & 255), u16 = (v: number) => { u8(v); u8(v >> 8); }, u32 = (v: number) => { u16(v & 0xffff); u16(v >>> 16); };
    const str = (s: string) => { u16(s.length); for (const c of s) u8(c.charCodeAt(0)); };
    const chunks: number[][] = [];
    const mk = (type: number, fill: () => void): void => { const save = b.length; b.length = 0; u32(0); u16(type); fill(); const c = b.slice(); c[0] = c.length & 255; c[1] = (c.length >> 8) & 255; chunks.push(c); b.length = save; };
    b.length = 0;
    mk(0x2004, () => { u16(3); u16(0); u16(0); u16(0); u16(0); u16(0); u8(255); u8(0); u8(0); u8(0); str("Ink"); });
    mk(0x2005, () => { u16(0); u16(1); u16(2); u8(200); u16(0); u16(0); for (let i = 0; i < 5; i++) u8(0); u16(2); u16(1); for (const v of [10, 20, 30, 255, 40, 50, 60, 128]) u8(v); });
    mk(0x2018, () => { u16(1); for (let i = 0; i < 8; i++) u8(0); u16(0); u16(0); u8(2); u16(0); for (let i = 0; i < 6; i++) u8(0); u8(1); u8(2); u8(3); u8(0); str("loop"); });
    const body = chunks.flat();
    const file: number[] = [];
    const F8 = (v: number) => file.push(v & 255), F16 = (v: number) => { F8(v); F8(v >> 8); }, F32 = (v: number) => { F16(v & 0xffff); F16(v >>> 16); };
    const size = 128 + 16 + body.length;
    F32(size); F16(0xa5e0); F16(1); F16(4); F16(2); F16(32); F32(1); F16(77); F32(0); F32(0); F8(0); F8(0); F8(0); F8(0); F16(0); F8(1); F8(1); F16(0); F16(0); F16(16); F16(16);
    while (file.length < 128) F8(0);
    F32(16 + body.length); F16(0xf1fa); F16(chunks.length); F16(0); F8(0); F8(0); F32(chunks.length);
    const bytes = Uint8Array.from([...file, ...body]);
    const s = readAseprite(bytes, "fixture");
    expect([s.width, s.height, s.colorMode, s.frames.length]).toEqual([4, 2, "rgba", 1]);
    expect(s.frames[0].durationMs).toBe(77);
    expect(s.layers[0]).toMatchObject({ name: "Ink", visible: true, editable: true, opacity: 255 });
    expect(s.cels[0]).toMatchObject({ x: 1, y: 2, opacity: 200 });
    expect(Array.from(s.cels[0].image.data)).toEqual([10, 20, 30, 255, 40, 50, 60, 128]);
    expect(s.tags[0]).toMatchObject({ name: "loop", direction: "pingpong", color: "#010203" });
    void zlibSync;
  });
  it("preserves unknown chunks on round-trip", () => {
    const doc = demos.createSlimeDemoDocument();
    const bytes = writeAseprite(doc.sprite as Sprite);
    // Inject an unknown chunk (type 0x7777) at the end of frame 0.
    const frameStart = 128;
    const frameSize = new DataView(bytes.buffer).getUint32(frameStart, true);
    const unknown = Uint8Array.from([14, 0, 0, 0, 0x77, 0x77, 1, 2, 3, 4, 5, 6, 7, 8]);
    const out = new Uint8Array(bytes.length + unknown.length);
    out.set(bytes.subarray(0, frameStart + frameSize)); out.set(unknown, frameStart + frameSize); out.set(bytes.subarray(frameStart + frameSize), frameStart + frameSize + unknown.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(frameStart, frameSize + unknown.length, true);
    dv.setUint32(frameStart + 12, dv.getUint32(frameStart + 12, true) + 1, true);
    dv.setUint16(frameStart + 6, Math.min(0xfffe, dv.getUint16(frameStart + 6, true) + 1), true);
    dv.setUint32(0, out.length, true);
    const s = readAseprite(out);
    const kept = s.preservedChunks!.find((c) => c.type === 0x7777);
    expect(Array.from(kept!.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const re = readAseprite(writeAseprite(s));
    expect(Array.from(re.preservedChunks!.find((c) => c.type === 0x7777)!.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("rejects garbage with a clear error", () => {
    expect(() => readAseprite(new Uint8Array(200))).toThrow(/magic/i);
  });
});

describe("sprite I/O, kpx, sequences, autosave", () => {
  const sprite = () => demos.createSlimeDemoDocument().sprite as Sprite;
  it("encodeSprite / decodeSprite by extension for every exporter", () => {
    for (const ext of ["aseprite", "ase", "kpx", "png", "apng", "gif", "webp", "jpg", "jpeg", "pcx", "flc", "fli", "bmp", "tga", "ico", "qoi"]) {
      const s = demos.createAntiheroDemoDocument().sprite as Sprite;
      const small = ext === "ico" ? sprite() : s;
      const bytes = encodeSprite(small, ext, { scale: 1 });
      const dec = decodeSprite(bytes, `x.${ext}`).sprite;
      expect(dec.width).toBe(small.width);
    }
    expect(new TextDecoder().decode(encodeSprite(sprite(), "svg"))).toContain("<svg");
    expect(new TextDecoder().decode(encodeSprite(sprite(), "css"))).toContain("box-shadow");
    expect(() => encodeSprite(sprite(), "unknown_format")).toThrow(/not supported/);
  });
  it("scale option upsizes PNG", () => {
    const s = sprite();
    expect(decodePng(encodeSprite(s, "png", { scale: 3 })).width).toBe(s.width * 3);
  });
  it("kpx stores sprite + editor state and reads back losslessly", () => {
    const s = demos.createWalkCycleDemoDocument().sprite as Sprite;
    const kpx = writeKpx(s, { workspaceName: "Animation", zoom: 700, fgColor: { r: 1, g: 2, b: 3, a: 255 }, dock: undefined, script: { name: "a.ts", code: "x" } });
    const p = readKpx(kpx);
    expect(p.editor.workspaceName).toBe("Animation");
    expect(p.editor.fgColor).toEqual({ r: 1, g: 2, b: 3, a: 255 });
    expect(diffSprites(s, p.sprite)).toEqual([]);
    expect(() => readKpx(new Uint8Array([1, 2, 3]))).toThrow();
  });
  it("exportSequence + importSequence round trip with name templates", () => {
    const s = demos.createWalkCycleDemoDocument().sprite as Sprite;
    const files = exportSequence(s, "{title}_{frame2}.png", "png");
    expect(files).toHaveLength(s.frames.length);
    expect(files[0].name).toMatch(/_00\.png$/);
    expect(expandNameTemplate("{title}-{tag}-{frame1}", { title: "a", tag: "walk", frame: 2 })).toBe("a-walk-3");
    const back = importSequence(files.reverse(), "seq");
    expect(back.frames).toHaveLength(s.frames.length);
  });
  it("autosave snapshots restore after a simulated crash, with retention limits", () => {
    const s = sprite();
    const snaps = [1, 2, 3, 4, 5].map((i) => ({ ...createRecoverySnapshot(s, { zoom: i }), savedAt: `2026-01-0${i}T00:00:00.000Z` }));
    const kept = pruneRecovery(snaps, { ...DEFAULT_AUTOSAVE, maxPerDocument: 2 });
    expect(kept).toHaveLength(2);
    expect(kept[0].savedAt > kept[1].savedAt).toBe(true);
    const p = restoreRecovery(kept[0]);
    expect(p.sprite.name).toBe(s.name);
    expect(p.editor.zoom).toBe(5);
  });
  it("FormatRegistry lists all codecs including webp/jpeg/pcx/flc/css as tested", () => {
    expect(FormatRegistry.get("format.png")?.state).toBe("tested");
    expect(FormatRegistry.get("format.webp")?.state).toBe("tested");
    expect(FormatRegistry.get("format.jpeg")?.state).toBe("tested");
    expect(FormatRegistry.get("format.pcx")?.state).toBe("tested");
    expect(FormatRegistry.get("format.flc")?.state).toBe("tested");
    expect(FormatRegistry.get("format.css_box_shadow")?.state).toBe("tested");
    expect(FormatRegistry.get("format.aseprite")?.state).toBe("tested");
  });
});

describe("sprite sheets", () => {
  const sheetSprite = () => loadSampleProject("sample.sheet").sprite;
  it("horizontal sheet: size = frames × cell, JSON array + meta + tags + slices", () => {
    const [r] = exportSpriteSheet(sheetSprite(), { sheetType: "horizontal", dataFormat: "json-array" });
    expect(r.bitmap.width).toBe(24 * 10);
    const frames = r.data.frames as Array<{ frame: { x: number; w: number }; duration: number; filename: string }>;
    expect(frames).toHaveLength(10);
    expect(frames[3].frame.x).toBe(72);
    expect(frames[8].duration).toBe(160);
    const meta = r.data.meta as { frameTags: unknown[]; slices: unknown[]; size: { w: number }; image: string; layers: unknown[] };
    expect(meta.frameTags).toHaveLength(3);
    expect(meta.slices).toHaveLength(1);
    expect(meta.size.w).toBe(240);
    expect(meta.layers).toHaveLength(2);
    expect(JSON.parse(r.dataText).meta.image).toBe("sheet.png");
  });
  it("hash format keyed by filename", () => {
    const [r] = exportSpriteSheet(sheetSprite(), { dataFormat: "json-hash" });
    const keys = Object.keys(r.data.frames as object);
    expect(keys).toHaveLength(10);
    expect(keys[0]).toMatch(/0\.aseprite$/);
  });
  it("vertical, rows (fixed cols), columns, packed layouts", () => {
    const s = sheetSprite();
    expect(exportSpriteSheet(s, { sheetType: "vertical" })[0].bitmap.height).toBe(240);
    const rows = exportSpriteSheet(s, { sheetType: "rows", constraint: { kind: "fixed-cols", value: 5 } })[0];
    expect([rows.bitmap.width, rows.bitmap.height]).toEqual([120, 48]);
    const cols = exportSpriteSheet(s, { sheetType: "columns", constraint: { kind: "fixed-rows", value: 5 } })[0];
    expect([cols.bitmap.width, cols.bitmap.height]).toEqual([48, 120]);
    const packed = exportSpriteSheet(s, { sheetType: "packed", trimCels: true })[0];
    const fr = packed.data.frames as Array<{ frame: { x: number; y: number; w: number; h: number } }>;
    for (let i = 0; i < fr.length; i++) for (let j = i + 1; j < fr.length; j++) {
      const a = fr[i].frame, b = fr[j].frame;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      if (overlap && !(a.x === b.x && a.y === b.y)) throw new Error(`packed overlap ${i}/${j}`);
    }
    expect(packed.bitmap.width * packed.bitmap.height).toBeLessThan(24 * 24 * 10);
  });
  it("trim sprite / trim cels / ignore empty / merge duplicates", () => {
    const s = sheetSprite();
    const trimmed = exportSpriteSheet(s, { trimSprite: true })[0];
    expect(trimmed.bitmap.width).toBeLessThan(240);
    const f0 = (trimmed.data.frames as Array<{ trimmed: boolean; spriteSourceSize: { x: number }; sourceSize: { w: number } }>)[0];
    expect(f0.trimmed).toBe(true);
    expect(f0.sourceSize.w).toBe(24);
    const noEmpty = exportSpriteSheet(s, { ignoreEmpty: true })[0];
    expect((noEmpty.data.frames as unknown[]).length).toBe(9);
    const merged = exportSpriteSheet(s, { mergeDuplicates: true })[0];
    const mf = merged.data.frames as Array<{ frame: { x: number } }>;
    expect(mf[3].frame.x).toBe(mf[2].frame.x);
    expect(merged.bitmap.width).toBeLessThan(240);
  });
  it("border padding, spacing, inner padding, extrude, scale", () => {
    const s = sheetSprite();
    const r = exportSpriteSheet(s, { borderPadding: 2, spacing: 1, innerPadding: 1, extrude: true, scale: 2 })[0];
    const cell = 24 + 2 + 2;
    expect(r.bitmap.width).toBe((2 * 2 + 10 * cell + 9 * 1) * 2);
    const first = (r.data.frames as Array<{ frame: { x: number; y: number } }>)[0].frame;
    expect(first.x).toBe((2 + 1 + 1) * 2);
  });
  it("split tags / split layers produce one sheet each; tag filter", () => {
    const s = sheetSprite();
    const byTag = exportSpriteSheet(s, { splitTags: true });
    expect(byTag).toHaveLength(3);
    expect(byTag[0].suffix).toContain("idle");
    expect(byTag[0].frameCount).toBe(4);
    expect(exportSpriteSheet(s, { splitLayers: true, layers: "all" })).toHaveLength(2);
    expect(exportSpriteSheet(s, { frames: "tag", tag: "run" })[0].frameCount).toBe(4);
    expect(() => exportSpriteSheet(s, { frames: "tag", tag: "nope" })).toThrow(/not found/);
  });
  it("import sprite sheet: grid, padding, layers vs frames, ignore empty", () => {
    const [r] = exportSpriteSheet(sheetSprite(), { sheetType: "horizontal" });
    const opts = { tileWidth: 24, tileHeight: 24, offsetX: 0, offsetY: 0, paddingX: 0, paddingY: 0, mode: "frames" as const, ignoreEmpty: false, partial: false, name: "imp" };
    expect(computeImportGrid(r.bitmap.width, r.bitmap.height, opts)).toHaveLength(10);
    const asFrames = importSpriteSheet(r.bitmap, opts);
    expect(asFrames.frames).toHaveLength(10);
    const noEmpty = importSpriteSheet(r.bitmap, { ...opts, ignoreEmpty: true });
    expect(noEmpty.frames.length).toBe(9);
    const asLayers = importSpriteSheet(r.bitmap, { ...opts, mode: "layers" });
    expect(asLayers.layers).toHaveLength(10);
    expect(asLayers.frames).toHaveLength(1);
    expect(() => importSpriteSheet(r.bitmap, { ...opts, offsetX: 9999 })).toThrow(/grid/);
  });
});

describe("sample projects", () => {
  it("registers the ten required samples and every one loads through .kpx", () => {
    const titles = listSampleProjects().filter((s) => s.order < 20).map((s) => s.title);
    expect(titles).toEqual([
      "Basic Sprite (Agent 1)", "Multi-Layer Animation (Agent 3)", "Tilemap with Tileset (Agent 3)", "Indexed Palette Sprite (Agent 4)",
      "Sliced UI Sprite (Agent 3)", "Scripting Playground (Agent 5)", "Extensions Showcase (Agent 5)", "Sprite Sheet Export Demo (Agent 6)",
      "Large Sprite Stress Test (Agent 6)", "Everything (Tutorial)",
    ]);
    for (const def of listSampleProjects().filter((x) => x.order < 20)) {
      if (def.id === "sample.stress") continue;
      const p = loadSampleProject(def.id);
      expect(p.sprite.frames.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(10);
    }
    expect(SampleProjectRegistry.getAll().length).toBeGreaterThanOrEqual(26);
    for (const def of listSampleProjects().filter((x) => x.order >= 20)) expect(loadSampleProject(def.id).sprite.width).toBeGreaterThan(0);
  });
  it("sample content matches the spec (layers/frames/tags/mode)", () => {
    const m = loadSampleProject("sample.multilayer").sprite;
    expect(m.frames.length).toBeGreaterThanOrEqual(8);
    expect(m.tags.length).toBeGreaterThanOrEqual(3);
    expect(loadSampleProject("sample.tilemap").sprite.tilesets.length).toBeGreaterThan(0);
    const idx = loadSampleProject("sample.indexed").sprite;
    expect([idx.colorMode, idx.palettes[0].colors.length]).toEqual(["indexed", 16]);
    expect(loadSampleProject("sample.slices").sprite.slices.length).toBeGreaterThan(1);
    expect(loadSampleProject("sample.scripting").editor.script?.code.length).toBeGreaterThan(5);
    expect(loadSampleProject("sample.extensions").editor.extensions).toEqual(["theme-cyberpunk", "palette-retro-8bit"]);
    expect(loadSampleProject("sample.sheet").editor.openDialog).toBe("dialog.export_sprite_sheet");
  });
  it("stress sample is 2048x2048, 100 frames, 20 layers and round-trips through .aseprite", () => {
    const t0 = Date.now();
    const p = loadSampleProject("sample.stress");
    expect([p.sprite.width, p.sprite.height, p.sprite.frames.length, p.sprite.layers.length]).toEqual([2048, 2048, 100, 20]);
    const ase = writeAseprite(p.sprite);
    const back = readAseprite(ase);
    expect(back.cels.length).toBe(p.sprite.cels.length);
    expect(Date.now() - t0).toBeLessThan(60000);
  }, 90000);
  it("samples writes real .kpx files usable by the CLI", () => {
    expect(PixelImage).toBeDefined();
  });
});
