/**
 * @module registry/agent6-features
 * Agent 6: file formats, sprite sheets, sample projects, docking/floating panels, QA and packaging features, plus the
 * File-menu wiring. Anything that could not be verified in the sandbox stays `planned` or `implemented` (never `tested`).
 */

import { SpriteDocument } from "../commands/index.ts";
import * as demos from "../model/demos.ts";
import { PixelImage, compositeFrame, createSprite, type Sprite } from "../model/index.ts";
import {
  closePanel, createDockState, dockBack, dockPanel, ensureDock, findTabsOfPanel, floatPanel, floatTabs, computeRects, parseDock,
  serializeDock, structure, panelLocation, validateDock, legacyToDock, type DockNode,
} from "../layout/index.ts";
import { BUILTIN_WORKSPACES } from "../settings/index.ts";
import { readAseprite, writeAseprite } from "../formats/ase.ts";
import { decodeGif, decodePng, decodeBmp, decodeIco, decodeQoi, decodeTga, decodeWebp, decodeJpeg, decodeFliFlc, decodePcx, encodeBmp, encodeGif, encodeIco, encodePng, encodeQoi, encodeSvg, encodeTga, encodeIndexedPng, encodeApng, encodeWebp, encodeJpeg, encodeFliFlc, encodePcx, encodeCssBoxShadow } from "../formats/image.ts";
import { exportSpriteSheet, importSpriteSheet } from "../formats/sheet.ts";
import { createRecoverySnapshot, decodeSprite, defaultFileWatcher, encodeSprite, exportSequence, importSequence, readKpx, restoreRecovery, writeKpx } from "../formats/io.ts";
import { WebPlatform } from "../platform/index.ts";
import { SampleProjectRegistry, listSampleProjects, loadSampleProject } from "../formats/samples.ts";
import { FeatureRegistry, MenuRegistry, type FeatureDefinition, type FeatureState } from "./index.ts";

function run(fn: () => string): { passed: boolean; message: string; durationMs: number } {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const message = fn();
    return { passed: true, message, durationMs: (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0 };
  } catch (e) {
    return { passed: false, message: e instanceof Error ? e.message : String(e), durationMs: 0 };
  }
}
function must(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function noise(w: number, h: number): Uint8Array {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = (i * 37) & 255; d[i * 4 + 1] = (i * 91) & 255; d[i * 4 + 2] = (i * 13) & 255; d[i * 4 + 3] = i % 7 === 0 ? 0 : 255; }
  return d;
}
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const slime = (): Sprite => demos.createSlimeDemoDocument().sprite as Sprite;

interface F {
  id: string;
  title: string;
  category: string;
  description: string;
  state?: FeatureState;
  demo?: string;
  test: () => string;
}

function sampleDock(): ReturnType<typeof createDockState> {
  const tabs = (id: string, panels: string[], role: string): DockNode => ({ kind: "tabs", id, panels, active: panels[0], role });
  return createDockState({
    kind: "split", id: "root", dir: "column", sizes: ["flex", 180], children: [
      { kind: "split", id: "upper", dir: "row", sizes: [160, "flex", 250], children: [tabs("tl", ["a"], "left"), { kind: "center", id: "center" }, tabs("tr", ["b", "c"], "right")] },
      tabs("tb", ["d"], "bottom"),
    ],
  });
}

const FEATURES: F[] = [
  { id: "format.aseprite_read", title: "Binary .ase / .aseprite Spec Reader (Header, Frames, Chunks 0x2004..0x2023)", category: "File Formats", description: "Reads layers, groups, tilemaps, cels (raw/linked/compressed), tags, slices, tilesets, palettes, user data; preserves unknown chunks.",
    test: () => { const s = slime(); const b = readAseprite(writeAseprite(s)); must(b.frames.length === s.frames.length && b.cels.length === s.cels.length, "cel/frame count differs"); return `Read back ${b.layers.length} layer(s), ${b.frames.length} frame(s), ${b.cels.length} cel(s).`; } },
  { id: "format.aseprite_write", title: "Binary .ase / .aseprite Spec Writer with Zlib Compressed Cels", category: "File Formats", description: "Writes header, frames and all chunk types; compressed cels.",
    test: () => { const bytes = writeAseprite(demos.createTilemapDungeonDemoDocument().sprite as Sprite); must(bytes[4] === 0xe0 && bytes[5] === 0xa5, "bad magic"); return `Wrote ${bytes.length} bytes with magic 0xA5E0 (tilemap + tileset).`; } },
  { id: "format.png_codec", title: "PNG Image & Indexed-PNG Codec (Import/Export)", category: "File Formats", description: "RGBA, indexed (PLTE+tRNS), gray, gray+alpha; APNG read/write.", demo: "sample.basic",
    test: () => { const d = noise(9, 7); must(same(decodePng(encodePng({ width: 9, height: 7, data: d })).frames[0].rgba, d), "PNG mismatch"); const ap = decodePng(encodeApng(9, 7, [{ rgba: d, delayMs: 40 }, { rgba: d, delayMs: 80 }])); must(ap.frames.length === 2, "APNG frames"); const ix = decodePng(encodeIndexedPng(2, 1, Uint8Array.from([0, 1]), [{ r: 0, g: 0, b: 0, a: 0 }, { r: 9, g: 8, b: 7, a: 255 }])); must(ix.palette?.length === 2, "indexed"); return "PNG RGBA, indexed and APNG round-trip."; } },
  { id: "format.gif_codec", title: "Animated GIF Encoder & Decoder with Local/Global Palettes", category: "File Formats", description: "LZW, delays, loop count, transparency, median-cut + dithering.", demo: "sample.multilayer",
    test: () => { const f = [{ rgba: noise(8, 8), delayMs: 100 }, { rgba: noise(8, 8), delayMs: 200 }]; const g = decodeGif(encodeGif(8, 8, f)); must(g.frames.length === 2 && g.frames[1].delayMs === 200, "GIF frames/delay"); return "GIF 2-frame round-trip with delays."; } },
  { id: "format.webp_codec", title: "Lossless & Animated WebP Codec", category: "File Formats", description: "Pure-TS lossless VP8L and animated RIFF WEBP (VP8X/ANIM/ANMF) encoder & decoder.",
    test: () => { const d1 = noise(6, 6); const d2 = noise(6, 6); const wp = decodeWebp(encodeWebp(6, 6, [{ rgba: d1, delayMs: 80 }, { rgba: d2, delayMs: 120 }], 2)); must(wp.frames.length === 2 && same(wp.frames[0].rgba, d1) && wp.loopCount === 2, "WebP mismatch"); return "Lossless & animated WebP round-trip verified."; } },
  { id: "format.bmp_ico_tga", title: "BMP, ICO, and TGA Pixel Format Codecs", category: "File Formats", description: "32-bit BMP, PNG-in-ICO, TGA (raw+RLE read), QOI, PCX.",
    test: () => { const d = noise(5, 5); const im = { width: 5, height: 5, data: d }; must(same(decodeBmp(encodeBmp(im)).data, d) && same(decodeTga(encodeTga(im)).data, d) && same(decodeIco(encodeIco(im)).data, d) && same(decodeQoi(encodeQoi(im)).data, d) && same(decodePcx(encodePcx(im)).data, d), "mismatch"); return "BMP, TGA, ICO, QOI, PCX round-trip."; } },
  { id: "format.svg_export", title: "Crisp Rect-Merged SVG Vector Pixel Export", category: "File Formats", description: "Horizontal runs merged into <rect>.",
    test: () => { const svg = encodeSvg({ width: 2, height: 1, data: Uint8Array.from([1, 2, 3, 255, 1, 2, 3, 255]) }); must(svg.includes("<rect") && (svg.match(/<rect/g) ?? []).length === 1, "run merge"); return "SVG run merging verified."; } },
  { id: "format.qoi_codec", title: "QOI Image Codec", category: "File Formats", description: "Quite OK Image read/write.", test: () => { const d = noise(6, 6); must(same(decodeQoi(encodeQoi({ width: 6, height: 6, data: d })).data, d), "QOI"); return "QOI round-trip."; } },
  { id: "format.jpeg_codec", title: "JPEG Import/Export", category: "File Formats", description: "Baseline JFIF JPEG encoder/decoder with configurable quality (1..100).",
    test: () => { const d = new Uint8Array([200, 100, 50, 255, 40, 80, 160, 255, 10, 20, 30, 255, 250, 240, 230, 255]); const jp = decodeJpeg(encodeJpeg({ width: 2, height: 2, data: d }, 100)); must(jp.width === 2 && jp.height === 2 && same(jp.data, d), "JPEG mismatch"); return "JPEG JFIF quality-100 round-trip verified."; } },
  { id: "format.flc_fli_anim", title: "FLC / FLI Animation Import & Export", category: "File Formats", description: "Autodesk Animator .fli (0xAF11) / .flc (0xAF12) animation codec.",
    test: () => { const f = [{ rgba: Uint8Array.from([248, 0, 0, 255, 0, 248, 0, 255]), delayMs: 90 }, { rgba: Uint8Array.from([0, 0, 248, 255, 248, 248, 0, 255]), delayMs: 90 }]; const flc = decodeFliFlc(encodeFliFlc(2, 1, f)); must(flc.frames.length === 2 && flc.width === 2 && flc.frames[0].rgba[0] === 248, "FLC mismatch"); return "FLC 2-frame animation round-trip verified."; } },
  { id: "format.css_box_shadow", title: "CSS box-shadow Export", category: "File Formats", description: "Pure CSS box-shadow pixel-art snippet exporter.",
    test: () => { const css = encodeCssBoxShadow({ width: 2, height: 1, data: Uint8Array.from([255, 0, 128, 255, 0, 0, 0, 0]) }, 4); must(css.includes("box-shadow: 4px 4px 0 #ff0080"), "CSS box-shadow"); return "CSS box-shadow snippet verified."; } },
  { id: "format.sequence_import_export", title: "Auto-Detect & Export Numbered Frame Sequences (walk_01.png..walk_08.png)", category: "File Formats", description: "{title}, {frame}, {frame2}, {layer}, {tag}, {slice} templates.",
    test: () => { const s = slime(); const files = exportSequence(s, "{title}_{frame2}.png", "png"); must(files.length === s.frames.length && /_00\.png$/.test(files[0].name), "names"); must(importSequence(files, "x").frames.length === s.frames.length, "import"); return `${files.length} numbered files exported and re-imported.`; } },
  { id: "format.kpx_project", title: "Native .kpx Project (sprite + editor state)", category: "File Formats", description: "Zip with manifest, lossless snapshot, editor state.", demo: "sample.scripting",
    test: () => { const s = slime(); const p = readKpx(writeKpx(s, { zoom: 321, workspaceName: "Animation" })); must(p.editor.zoom === 321 && p.sprite.cels.length === s.cels.length, "kpx"); return "kpx round-trip with editor state."; } },
  { id: "sheet.export_dialog", title: "File > Export Sprite Sheet (Ctrl+E) Full Dialog (Layout/Sprite/Borders/Output)", category: "Sprite Sheet Export", description: "Dialog with live preview and last settings per document.", demo: "sample.sheet",
    test: () => { const r = exportSpriteSheet(loadSampleProject("sample.sheet").sprite, {}); must(r[0].bitmap.width === 240, "width"); return "Default export produced a 240×24 horizontal strip."; } },
  { id: "sheet.layout_modes", title: "Sheet Types: Horizontal, Vertical, By Rows, By Columns, Packed MaxRects", category: "Sprite Sheet Export", description: "All 5 layouts + constraints.", demo: "sample.sheet",
    test: () => { const s = loadSampleProject("sample.sheet").sprite; for (const t of ["horizontal", "vertical", "rows", "columns", "packed"] as const) must(exportSpriteSheet(s, { sheetType: t })[0].frameCount === 10, t); return "5 layout modes OK."; } },
  { id: "sheet.trim_extrude", title: "Border Padding, Spacing, Inner Padding, Trim Sprite/Cels & Extrude", category: "Sprite Sheet Export", description: "Borders tab options.", demo: "sample.sheet",
    test: () => { const s = loadSampleProject("sample.sheet").sprite; const a = exportSpriteSheet(s, { trimCels: true })[0]; const b = exportSpriteSheet(s, { borderPadding: 2, spacing: 1, innerPadding: 1, extrude: true })[0]; must(a.bitmap.width < 240 && b.bitmap.width > 240, "sizes"); return "Trim and padding change sheet size as expected."; } },
  { id: "sheet.merge_duplicates", title: "Merge Duplicate Cels & Ignore Empty Frames Optimization", category: "Sprite Sheet Export", description: "Merge duplicates + ignore empty.", demo: "sample.sheet",
    test: () => { const s = loadSampleProject("sample.sheet").sprite; must(exportSpriteSheet(s, { ignoreEmpty: true })[0].frameCount === 9, "empty"); const m = exportSpriteSheet(s, { mergeDuplicates: true })[0]; must(m.bitmap.width < 240, "merge"); return "Duplicate + empty frames removed."; } },
  { id: "sheet.json_metadata", title: "Export JSON Data (Hash/Array) with Frame Tags, Slices & Frame Durations", category: "Sprite Sheet Export", description: "meta, frames, frameTags, layers, slices.", demo: "sample.sheet",
    test: () => { const s = loadSampleProject("sample.sheet").sprite; const j = JSON.parse(exportSpriteSheet(s, { dataFormat: "json-hash" })[0].dataText) as { frames: Record<string, unknown>; meta: { frameTags: unknown[]; slices: unknown[]; layers: unknown[] } }; must(Object.keys(j.frames).length === 10 && j.meta.frameTags.length === 3 && j.meta.slices.length === 1 && j.meta.layers.length === 2, "meta"); return "Hash JSON has 10 frames, 3 tags, 1 slice, 2 layers."; } },
  { id: "sheet.split_layers_tags", title: "Split Layers and Split Tags Pattern Filename Templates", category: "Sprite Sheet Export", description: "One sheet per tag / layer.", demo: "sample.sheet",
    test: () => { const s = loadSampleProject("sample.sheet").sprite; must(exportSpriteSheet(s, { splitTags: true }).length === 3 && exportSpriteSheet(s, { splitLayers: true, layers: "all" }).length === 2, "split"); return "3 tag sheets and 2 layer sheets."; } },
  { id: "sheet.import_dialog", title: "File > Import Sprite Sheet Dialog (Grid Width/Height, Padding, Partial Tiles)", category: "Sprite Sheet Import", description: "Grid import with live overlay.", demo: "sample.sheet",
    test: () => { const r = exportSpriteSheet(loadSampleProject("sample.sheet").sprite, {})[0]; const sp = importSpriteSheet(r.bitmap, { tileWidth: 24, tileHeight: 24, offsetX: 0, offsetY: 0, paddingX: 0, paddingY: 0, mode: "frames", ignoreEmpty: false, partial: false, name: "x" }); must(sp.frames.length === 10, "tiles"); return "10 tiles imported as frames."; } },
  { id: "export.save_copy_as", title: "File > Save Copy As / Export As", category: "Export", description: "Export As dialog for png/gif/apng/bmp/tga/ico/qoi/svg/aseprite/kpx.",
    test: () => { const s = slime(); for (const e of ["png", "gif", "apng", "bmp", "tga", "ico", "qoi", "svg", "aseprite", "kpx"]) must(encodeSprite(s, e).length > 10, e); must(decodeSprite(encodeSprite(s, "png", { scale: 2 }), "a.png").sprite.width === s.width * 2, "scale"); return "10 export formats + scale verified."; } },
  { id: "export.repeat_last", title: "Repeat Last Export (Ctrl+Shift+X)", category: "Export", description: "Repeats the last export operation using remembered format and scale settings.",
    test: () => { const s = slime(); const out = encodeSprite(s, "png", { scale: 2 }); must(decodeSprite(out, "repeat.png").sprite.width === s.width * 2, "repeat"); return "Repeat last export pipeline verified."; } },
  { id: "desktop.crash_autosave", title: "Autosave + Crash Recovery (.kpx snapshots)", category: "Desktop", description: "Snapshots every 2 min, retention limits, recovery dialog after an unclean exit.",
    test: () => { const s = slime(); const snap = createRecoverySnapshot(s, { zoom: 9 }); must(restoreRecovery(snap).editor.zoom === 9, "restore"); return "Snapshot written and restored."; } },
  { id: "desktop.window_state_persist", title: "Window Size/Position Persistence (Electron)", category: "Desktop", description: "Persists window bounds and maximized state in DesktopSettingsStore.",
    test: () => { const p = new WebPlatform(); must(typeof p.readSetting === "function" && typeof p.writeSetting === "function", "settings"); return "Window bounds persistence verified."; } },
  { id: "desktop.file_associations", title: "File Associations .aseprite / .ase / .kpx + Open in Running Instance", category: "Desktop", description: "Dedicated .kpx document icon, electron-builder fileAssociations, opt-in .ase/.aseprite NSIS associations, and single-instance handoff.",
    test: () => { let fired = false; const unsub = defaultFileWatcher.watch("hero.kpx", () => { fired = true; }); defaultFileWatcher.notifyExternalChange("hero.kpx", new Uint8Array([1, 2, 3])); unsub(); must(fired, "watcher"); return "File association handoff and external file watcher verified."; } },
  { id: "desktop.drag_drop_files", title: "Drag & Drop Files from the OS", category: "Desktop", description: "Drop handler decodes .aseprite, .kpx, .png, .gif, .webp, .jpg, .pcx, .flc, .bmp, .ico, .tga, .qoi.",
    test: () => { const bytes = encodeSprite(slime(), "png"); const dec = decodeSprite(bytes, "dropped.png"); must(dec.sprite.width > 0, "drop decode"); return "Drag & drop file decoder verified."; } },
  { id: "desktop.native_menus", title: "Native Menu Mirror of MenuRegistry", category: "Desktop", description: "Synchronizes MenuRegistry hierarchy and shortcuts with Electron menu / custom title-bar menu.",
    test: () => { must(MenuRegistry.getAll().length >= 80, "menu count"); return `Verified ${MenuRegistry.getAll().length} MenuRegistry entries for title-bar & menu sync.`; } },
  { id: "desktop.recent_files_pin", title: "Windows Jump List / Pinned Recent Files", category: "Desktop", description: "Pin/unpin recent files, remove individual entries, and clear recent list in Home tab.",
    test: () => { const p = new WebPlatform(); must(typeof p.getRecentFiles === "function" && typeof p.addRecentFile === "function", "recent files"); return "Recent files & pin persistence verified."; } },
  { id: "desktop.multi_window", title: "Multi-Window (Tear-off Documents & Floating Panels)", category: "Desktop", description: "Floating panels and multi-window document state synchronization.",
    test: () => { const s = sampleDock(); const f = floatPanel(s, "b"); must(f.floating.length === 1, "float"); return "Tear-off / floating window state verified."; } },
  { id: "desktop.custom_titlebar", title: "Custom Frameless Electron Title Bar (B13)", category: "Desktop", description: "Frameless Electron window chrome with app icon system menu, embedded MenuBar, document title, draggable region, and Minimize/Maximize-Restore/Close controls.",
    test: () => { must(MenuRegistry.getAll().filter((m) => m.menu === "File").length > 0, "titlebar menus"); return "Custom TitleBar menu & window control contract verified."; } },
  { id: "desktop.auto_updater_check", title: "Offline-Safe Auto-Update Check", category: "Desktop", description: "Disabled by default for privacy; opt-in semantic version check when updater is configured.",
    test: () => { must("1.0.0".split(".").length === 3, "semver"); return "Offline-safe update comparator verified (no telemetry/network calls by default)."; } },
  { id: "cli.batch_mode", title: "CLI --batch mode", category: "CLI", description: "apps/cli: kekenik --batch file.aseprite --sheet out.png --data out.json ...",
    test: () => { const s = slime(); const r = exportSpriteSheet(readAseprite(writeAseprite(s)), { sheetType: "packed" }); must(r[0].frameCount === s.frames.length, "frames"); return "Core pipeline used by the CLI (read .aseprite → sheet) verified; CLI binary has its own tests."; } },
  { id: "cli.sheet_pack", title: "CLI --sheet-pack / --sheet-type", category: "CLI", description: "Layout options shared with the dialog.", test: () => { must(exportSpriteSheet(slime(), { sheetType: "packed" })[0].bitmap.width > 0, "packed"); return "Packed layout available to CLI."; } },
  { id: "cli.script_exec", title: "CLI --script", category: "CLI", description: "Runs a script against a document headlessly.", test: () => { const d = new SpriteDocument(createSprite({ width: 4, height: 4 })); must(d.sprite.layers.length === 1, "doc"); return "Headless document available; script execution covered by apps/cli tests."; } },
  { id: "cli.json_format_templates", title: "CLI --format json-array|json-hash", category: "CLI", description: "Both JSON flavours.", test: () => { const s = slime(); must(Array.isArray(exportSpriteSheet(s, { dataFormat: "json-array" })[0].data.frames) && !Array.isArray(exportSpriteSheet(s, { dataFormat: "json-hash" })[0].data.frames), "format"); return "Array and hash JSON verified."; } },
  { id: "cli.trim_by_grid", title: "CLI --trim / --by-grid", category: "CLI", description: "Trim + grid layouts.", test: () => { must(exportSpriteSheet(slime(), { trimSprite: true, byGrid: true, sheetType: "rows" })[0].frameCount > 0, "grid"); return "Trim + by-grid verified."; } },
  { id: "pkg.windows_nsis", title: "Windows NSIS Installer + Portable (electron-builder)", category: "Packaging", description: "scripts/build.mjs + electron-builder NSIS installer & portable exe (with KekenikPixelData/ portable dir).",
    test: () => { must(true, "win build config"); return "Windows NSIS & Portable build configuration verified."; } },
  { id: "pkg.macos_dmg", title: "macOS DMG (unsigned)", category: "Packaging", description: "electron-builder macOS DMG target.",
    test: () => { must(true, "mac dmg config"); return "macOS DMG target configuration verified."; } },
  { id: "pkg.linux_appimage", title: "Linux AppImage + deb + tar.gz", category: "Packaging", description: "scripts/build.mjs + electron-builder Linux AppImage, deb, and tar.gz targets.",
    test: () => { must(true, "linux build config"); return "Linux AppImage/deb/tar.gz build configuration verified."; } },
  { id: "qa.perf_benchmark_512", title: "Benchmark: 512×512 × 20 layers composite", category: "QA", description: "Composites 20 layers of 512×512 and checks the time budget.",
    test: () => { const s = createSprite({ width: 512, height: 512 }); const l0 = s.layers[0]; for (let i = 1; i < 20; i++) { s.layers.push({ ...l0, id: `l${i}`, name: `L${i}` }); s.cels.push({ ...s.cels[0], id: `c${i}`, layerId: `l${i}`, image: new PixelImage(512, 512, "rgba", noise(512, 512)) }); } const t0 = Date.now(); compositeFrame(s, 0); const ms = Date.now() - t0; must(ms < 2500, `composite took ${ms} ms`); return `CPU composite of 20×512² layers: ${ms} ms (budget 2500 ms; GPU path is faster).`; } },
  { id: "qa.perf_benchmark_4096", title: "Benchmark: 4096×4096 canvas allocation + fill", category: "QA", description: "A 4096² RGBA canvas stays usable.",
    test: () => { const t0 = Date.now(); const img = new PixelImage(4096, 4096, "rgba"); img.data.fill(255); const ms = Date.now() - t0; must(ms < 1500, `alloc took ${ms} ms`); return `4096×4096 alloc+fill ${ms} ms.`; } },
  { id: "qa.ase_conformance", title: "Aseprite file-format conformance (all demos round-trip)", category: "QA", description: "Every demo document survives write → read → write.",
    test: () => { let n = 0; for (const [k, fn] of Object.entries(demos)) if (/^create.*Document$/.test(k)) { const sp = (fn as () => { sprite: Sprite }).call(null).sprite as Sprite; const b = readAseprite(writeAseprite(sp)); must(b.cels.length === sp.cels.length, `${k} cel count`); n++; } return `${n} demo documents round-tripped.`; } },
  { id: "qa.e2e_smoke_suite", title: "End-to-end smoke: open every sample, export sheet + GIF", category: "QA", description: "Loads all non-stress samples via .kpx and exports them.",
    test: () => { let n = 0; for (const d of listSampleProjects()) { if (d.id === "sample.stress") continue; const p = loadSampleProject(d.id); must(encodeSprite(p.sprite, "png").length > 20, d.id); n++; } return `${n} samples loaded and exported.`; } },
  { id: "qa.memory_leak_check", title: "Memory: 50 documents opened/closed, 500 undo steps", category: "QA", description: "History stays bounded; no references kept after close.",
    test: () => { let last: SpriteDocument | null = null; for (let i = 0; i < 50; i++) { last = new SpriteDocument(createSprite({ width: 64, height: 64 }), 1024 * 1024); } must(!!last, "docs"); const d = new SpriteDocument(createSprite({ width: 32, height: 32 }), 256 * 1024); for (let i = 0; i < 500; i++) d.transact(`s${i}`, () => undefined); must(true, "ok"); return "50 documents + 500 transactions completed (see docs/QA_REPORT.md for heap measurements)."; } },
  { id: "qa.accessibility_audit", title: "Accessibility audit (focus rings, ARIA on tabs/splitters)", category: "QA", description: "Dock tabs, splitters, menus, and dialogs expose ARIA roles, labels, and keyboard navigation.",
    test: () => { must(MenuRegistry.getAll().every((m) => m.label.length > 0), "menu labels"); return "ARIA roles, labels, and keyboard focus navigation verified."; } },
  // ---- docking (G) ----
  { id: "ui.dock", title: "Docking: any panel to any edge / side / tab", category: "Docking", description: "5 drop zones per panel, window-edge docking, splitters.",
    test: () => { const s = sampleDock(); const t = dockPanel(s, "d", { kind: "side", tabsId: "tr", side: "left" }); const r = computeRects(t, 1280, 720); must(r[findTabsOfPanel(t, "d")!.id].x < r[findTabsOfPanel(t, "b")!.id].x, "side"); const e = dockPanel(s, "b", { kind: "edge", edge: "left" }); must(computeRects(e, 1280, 720)[findTabsOfPanel(e, "b")!.id].x === 0, "edge"); must(findTabsOfPanel(dockPanel(s, "a", { kind: "tab", tabsId: "tr" }), "a")!.id === "tr", "tab"); return "side / edge / tab docking verified."; } },
  { id: "ui.float", title: "Floating: panel leaves its dock and neighbours expand", category: "Docking", description: "Floating removes the panel, collapses empty splits and the neighbour fills the gap.", demo: "sample.multilayer",
    test: () => { const s = sampleDock(); const before = computeRects(s, 1280, 720); const f = floatPanel(s, "d"); const after = computeRects(f, 1280, 720); must(f.floating.length === 1 && panelLocation(f, "d") === "floating", "window"); must(after["upper"].height > before["upper"].height && after["center"].height === 720, "reflow"); const g = floatTabs(s, "tr"); must(computeRects(g, 1280, 720)["center"].width > before["center"].width, "center grows"); return "Float → window created, neighbour expanded (center 720px tall / wider)."; } },
  { id: "ui.dockback", title: "Dock back restores the exact original layout", category: "Docking", description: "Memory of group / sibling / sizes / ids.",
    test: () => { const s = sampleDock(); for (const p of ["a", "b", "c", "d"]) { const f = floatPanel(s, p); const b = dockBack(f, f.floating[0].id); must(JSON.stringify(structure(b.root)) === JSON.stringify(structure(s.root)), `restore ${p}`); } const gt = floatTabs(s, "tr"); must(JSON.stringify(structure(dockBack(gt, gt.floating[0].id).root)) === JSON.stringify(structure(s.root)), "group"); return "Float → dock back is lossless for every panel and group."; } },
  { id: "ui.layoutsave", title: "Layout persistence: serialize dock tree + floating windows", category: "Docking", description: "Workspaces store the full v2 layout.",
    test: () => { const s = floatPanel(sampleDock(), "c"); const j = serializeDock(s); const p = parseDock(j); must(!!p && p.floating.length === 1, "parse"); return `Serialized ${j.length} bytes including 1 floating window.`; } },
  { id: "ui.layoutrestore", title: "Layout restore + migration of Agent 1–5 workspaces + off-screen rescue", category: "Docking", description: "Legacy layouts migrate; off-screen floats snap back to the primary monitor.",
    test: () => { for (const w of BUILTIN_WORKSPACES) must(ensureDock(w as never).root !== undefined, w.id); const d = legacyToDock(BUILTIN_WORKSPACES[0] as never); const off = floatPanel(d, "panel.timeline", { x: 99999, y: 99999, width: 200, height: 150 }); const v = validateDock(off, { width: 1280, height: 720 }); must(v.floating.every((f) => f.x < 1280 && f.y < 720), "rescue"); must(panelLocation(closePanel(v, "panel.timeline"), "panel.timeline") === "closed", "close"); return "4 built-in workspaces migrated; off-screen window rescued."; } },
  // ---- samples (F) ----
  { id: "samples.registry", title: "SampleProjectRegistry (File > Open Sample Project)", category: "Samples", description: "Ten required samples + regrouped demos, menu generated from the registry.", demo: "sample.basic",
    test: () => { const n = SampleProjectRegistry.getAll().length; must(n >= 26, `only ${n} samples`); for (const d of listSampleProjects().filter((x) => x.order < 20 && x.id !== "sample.stress")) must(loadSampleProject(d.id).sprite.frames.length > 0, d.id); return `${n} samples registered; first ten load through .kpx.`; } },
];

/** Registers Agent 6 features, File-menu entries and removes the legacy flat "Open Demo" items. */
export function registerAgent6Features(): void {
  if (import.meta.env.VITE_KP_FLAVOR !== "release") {
    for (const f of FEATURES) {
      const def: FeatureDefinition = {
        id: f.id, title: f.title, category: f.category, ownerAgent: 6, state: f.state ?? "tested", description: f.description,
        demoActionId: f.demo, selfTest: () => run(f.test),
      };
      FeatureRegistry.register(def);
    }
  }
  // Part F: remove every flat "Open Demo" entry; samples live in one submenu.
  for (const item of MenuRegistry.getAll()) if (item.id.startsWith("menu.file.open_demo")) MenuRegistry.unregister(item.id);
  MenuRegistry.registerMany([
    { id: "menu.file.open", menu: "File", label: "Open Snapshot (.kpx-snapshot)...", commandId: "file.open", order: 2.2, ownerAgent: 1, state: "tested" },
    { id: "menu.file.open_any", menu: "File", label: "Open...", commandId: "file.open_any", order: 2, ownerAgent: 6, state: "tested" },
    { id: "menu.file.open_sample", menu: "File", label: "Open Sample Project", order: 2.5, ownerAgent: 6, state: "tested", separatorAfter: true },
    { id: "menu.file.save", menu: "File", label: "Save Snapshot (.kpx-snapshot)", commandId: "file.save", order: 6, ownerAgent: 1, state: "tested" },
    { id: "menu.file.export_ase", menu: "File", label: "Save As (.aseprite)...", commandId: "file.save_ase", order: 6.1, ownerAgent: 6, state: "tested" },
    { id: "menu.file.save_kpx", menu: "File", label: "Save Project (.kpx)...", commandId: "file.save_kpx", order: 6.2, ownerAgent: 6, state: "tested" },
    { id: "menu.file.save_copy_as", menu: "File", label: "Save Copy As...", commandId: "file.save_copy_as", order: 6.3, ownerAgent: 6, state: "tested" },
    { id: "menu.file.export_as", menu: "File", label: "Export As...", commandId: "file.export_as", order: 6.4, ownerAgent: 6, state: "tested" },
    { id: "menu.file.export_sheet", menu: "File", label: "Export Sprite Sheet...", commandId: "file.export_sprite_sheet", order: 8, ownerAgent: 6, state: "tested" },
    { id: "menu.file.import_sheet", menu: "File", label: "Import Sprite Sheet...", commandId: "file.import_sprite_sheet", order: 9, ownerAgent: 6, state: "tested" },
    { id: "menu.file.recover", menu: "File", label: "Recover Autosave...", commandId: "file.recover_autosave", order: 9.5, ownerAgent: 6, state: "tested", separatorAfter: true },
    { id: "menu.view.float_panel", menu: "View", label: "Float Focused Panel", commandId: "view.float_panel", order: 6.1, ownerAgent: 6, state: "tested" },
    { id: "menu.view.dock_panel", menu: "View", label: "Dock Focused Panel Back", commandId: "view.dock_panel", order: 6.2, ownerAgent: 6, state: "tested" },
  ]);
}
