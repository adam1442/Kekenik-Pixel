/**
 * @module formats/samples
 * `SampleProjectRegistry`: the single source of `File > Open Sample Project >` entries. Each sample builds a sprite +
 * editor state and is loaded through the real `.kpx` code path (`writeKpx` → `readKpx`). Future agents add samples by calling
 * `SampleProjectRegistry.register(...)`; no menu code has to change.
 */

import { Registry } from "../registry/index.ts";
import {
  Mask, PixelImage, createModelId, createSprite, deserializeSnapshot, serializeSnapshot,
  type Cel, type Layer, type Sprite,
} from "../model/index.ts";
import * as demos from "../model/demos.ts";
import {
  createAntiheroDemoDocument, createSlices9PatchDemoDocument, createTilemapDungeonDemoDocument, createWalkCycleDemoDocument,
} from "../model/demos.ts";
import { renderPixelText } from "../tools/index.ts";
import { BUILTIN_SAMPLE_SCRIPTS } from "../scripting/index.ts";
import { readKpx, writeKpx, type KpxEditorState, type KpxProject } from "./io.ts";
import type { RGBA } from "../util/index.ts";

/** Definition of one sample project. */
export interface SampleProjectDefinition {
  readonly id: string;
  readonly title: string;
  readonly ownerAgent: 1 | 2 | 3 | 4 | 5 | 6;
  /** Tooltip shown in the menu. */
  readonly description: string;
  /** Feature Center ids this sample demonstrates (the Feature Center "Show me" button opens this sample). */
  readonly featureIds: readonly string[];
  readonly order: number;
  build(): { sprite: Sprite; editor?: KpxEditorState };
}

/** Registry of sample projects (documented in CONTRACTS.md). */
export const SampleProjectRegistry = new Registry<SampleProjectDefinition>("SampleProjectRegistry");

function clone(sprite: unknown): Sprite {
  return deserializeSnapshot(serializeSnapshot(sprite as Sprite));
}

function fill(img: PixelImage, x: number, y: number, w: number, h: number, c: RGBA, palette?: readonly RGBA[]): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) img.setRGBA(xx, yy, c, palette);
}

function imageLayer(name: string, extra: Partial<Layer> = {}): Layer {
  return { id: createModelId("layer"), kind: "image", name, parentId: null, visible: true, editable: true, lockMove: false, background: false, preferLinkedCels: false, collapsed: false, reference: false, blendMode: "normal", opacity: 255, userData: { text: "" }, ...extra } as Layer;
}

function addCel(sprite: Sprite, layer: Layer, frame: number, image: PixelImage, x = 0, y = 0, linkId?: string): Cel {
  const cel: Cel = { id: createModelId("cel"), layerId: layer.id, frameIndex: frame, x, y, opacity: 255, zIndex: 0, image, linkId, userData: { text: "" } };
  sprite.cels.push(cel);
  return cel;
}

function blank(name: string, w: number, h: number, mode: Sprite["colorMode"] = "rgba"): Sprite {
  const s = createSprite({ name, width: w, height: h, colorMode: mode });
  s.layers = [];
  s.cels = [];
  return s;
}

const BASIC_PALETTE: RGBA[] = [
  { r: 0, g: 0, b: 0, a: 0 }, { r: 26, g: 28, b: 44, a: 255 }, { r: 93, g: 39, b: 93, a: 255 }, { r: 177, g: 62, b: 83, a: 255 },
  { r: 239, g: 125, b: 87, a: 255 }, { r: 255, g: 205, b: 117, a: 255 }, { r: 167, g: 240, b: 112, a: 255 }, { r: 56, g: 183, b: 100, a: 255 },
  { r: 37, g: 113, b: 121, a: 255 }, { r: 41, g: 54, b: 111, a: 255 }, { r: 59, g: 93, b: 201, a: 255 }, { r: 65, g: 166, b: 246, a: 255 },
  { r: 115, g: 239, b: 247, a: 255 }, { r: 244, g: 244, b: 244, a: 255 }, { r: 148, g: 176, b: 194, a: 255 }, { r: 86, g: 108, b: 134, a: 255 },
];

function buildBasic(): Sprite {
  const s = blank("basic_sprite.aseprite", 32, 32);
  const l = imageLayer("Layer 1");
  s.layers.push(l);
  const img = new PixelImage(32, 32, "rgba");
  fill(img, 8, 8, 16, 16, { r: 255, g: 205, b: 117, a: 255 });
  fill(img, 11, 12, 3, 4, { r: 26, g: 28, b: 44, a: 255 });
  fill(img, 18, 12, 3, 4, { r: 26, g: 28, b: 44, a: 255 });
  fill(img, 11, 19, 10, 2, { r: 177, g: 62, b: 83, a: 255 });
  fill(img, 8, 8, 16, 1, { r: 239, g: 125, b: 87, a: 255 });
  addCel(s, l, 0, img);
  return s;
}

function buildIndexed(): Sprite {
  const s = blank("indexed_palette.aseprite", 64, 64, "indexed");
  s.palettes = [{ id: createModelId("pal"), name: "Sweetie-16", fromFrame: 0, toFrame: 9999, colors: BASIC_PALETTE.map((c) => ({ ...c })) }];
  s.transparentIndex = 0;
  const l = imageLayer("Indexed Layer");
  s.layers.push(l);
  const img = new PixelImage(64, 64, "indexed");
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) img.putPixel(x, y, 1 + (Math.floor(x / 4) + Math.floor(y / 4)) % 15);
  for (let i = 0; i < 16; i++) fill(img, 2 + (i % 8) * 7, 4 + Math.floor(i / 8) * 9, 6, 8, BASIC_PALETTE[i], BASIC_PALETTE);
  addCel(s, l, 0, img);
  return s;
}

function buildSheetDemo(): Sprite {
  const s = blank("sheet_export_demo.aseprite", 24, 24);
  const body = imageLayer("Body");
  const fx = imageLayer("Sparkle");
  s.layers.push(body, fx);
  s.frames = [];
  const names = ["idle", "run", "jump"];
  for (let f = 0; f < 10; f++) {
    s.frames.push({ id: createModelId("frame"), index: f, durationMs: f < 4 ? 120 : f < 8 ? 80 : 160 });
  }
  const bodyImgs: PixelImage[] = [];
  for (let f = 0; f < 10; f++) {
    // frames 2 and 3 are identical (Merge Duplicates); frame 9 is empty (Ignore Empty); body content is small (Trim).
    const key = f === 3 ? 2 : f;
    let img = bodyImgs[key];
    if (!img || f !== 3) {
      img = new PixelImage(24, 24, "rgba");
      if (f !== 9) {
        const bob = key % 4 === 1 ? 1 : 0;
        fill(img, 8, 7 + bob, 8, 10, { r: 59, g: 93, b: 201, a: 255 });
        fill(img, 9 + (key % 2), 9 + bob, 2, 2, { r: 244, g: 244, b: 244, a: 255 });
        fill(img, 8, 17 + bob, 3, 3, { r: 26, g: 28, b: 44, a: 255 });
        fill(img, 13 + (key % 3), 17 + bob, 3, 3, { r: 26, g: 28, b: 44, a: 255 });
      }
      bodyImgs[key] = img;
    }
    addCel(s, body, f, img.clone());
    if (f % 2 === 0 && f < 9 && f !== 2) {
      const sp = new PixelImage(24, 24, "rgba");
      fill(sp, 4 + (f % 4), 3, 2, 2, { r: 255, g: 205, b: 117, a: 255 });
      addCel(s, fx, f, sp);
    }
  }
  s.tags = [
    { id: createModelId("tag"), name: names[0], fromFrame: 0, toFrame: 3, direction: "forward", color: "#3b5dc9", repeat: 0, userData: { text: "" } },
    { id: createModelId("tag"), name: names[1], fromFrame: 4, toFrame: 7, direction: "pingpong", color: "#38b764", repeat: 0, userData: { text: "" } },
    { id: createModelId("tag"), name: names[2], fromFrame: 8, toFrame: 9, direction: "forward", color: "#ef7d57", repeat: 2, userData: { text: "" } },
  ];
  s.slices = [{ id: createModelId("slice"), name: "hitbox", color: "#ff0000", keys: [{ frameIndex: 0, bounds: { x: 8, y: 7, width: 8, height: 13 }, pivot: { x: 4, y: 13 } }], userData: { text: "" } }];
  return s;
}

function buildStress(): Sprite {
  const W = 2048, H = 2048, FRAMES = 100, LAYERS = 20, CEL = 32;
  const s = blank("stress_2048x2048_100f_20l.aseprite", W, H);
  s.frames = [];
  const layers: Layer[] = [];
  for (let i = 0; i < LAYERS; i++) layers.push(imageLayer(`Layer ${i + 1}`, i % 5 === 4 ? { blendMode: "multiply", opacity: 200 } : {}));
  s.layers.push(...layers);
  for (let f = 0; f < FRAMES; f++) s.frames.push({ id: createModelId("frame"), index: f, durationMs: 40 });
  layers.forEach((layer, li) => {
    const hue: RGBA = { r: (li * 53) % 256, g: (li * 97 + 40) % 256, b: (li * 29 + 120) % 256, a: 255 };
    const base = new PixelImage(CEL, CEL, "rgba");
    fill(base, 2, 2, CEL - 4, CEL - 4, hue);
    fill(base, 6, 6, 8, 8, { r: 255, g: 255, b: 255, a: 255 });
    for (let f = 0; f < FRAMES; f++) {
      // Every 4th frame is a new image; the others are linked cels (keeps the sample compact while still heavy to composite).
      const linked = f % 4 !== 0;
      const prev = linked ? s.cels.find((c) => c.layerId === layer.id && c.frameIndex === f - (f % 4)) : undefined;
      const x = ((li * 211 + f * 17) % (W - CEL)) | 0;
      const y = ((li * 331 + f * 13) % (H - CEL)) | 0;
      if (prev) {
        const link = prev.linkId ?? `lk_${li}_${f - (f % 4)}`;
        prev.linkId = link;
        addCel(s, layer, f, prev.image, x, y, link);
      } else {
        const img = base.clone();
        fill(img, 16 + (f % 8), 16, 4, 4, { r: 0, g: 0, b: 0, a: 255 });
        addCel(s, layer, f, img, x, y);
      }
    }
  });
  s.tags = [{ id: createModelId("tag"), name: "all", fromFrame: 0, toFrame: FRAMES - 1, direction: "forward", color: "#ff0000", repeat: 0, userData: { text: "" } }];
  return s;
}

function buildTutorial(): Sprite {
  const base = clone(createWalkCycleDemoDocument().sprite);
  base.name = "everything_tutorial.aseprite";
  const notes = imageLayer("Notes (text layer)");
  const lines = ["1 LAYERS+FRAMES", "2 TAGS", "3 PALETTE", "4 FILTERS", "5 SCRIPTS", "6 EXPORT"];
  const img = new PixelImage(base.width, base.height, "rgba");
  lines.forEach((t, i) => {
    const txt = renderPixelText(t, { r: 255, g: 255, b: 255, a: 255 }, 7, false);
    for (let y = 0; y < txt.height; y++) for (let x = 0; x < txt.width; x++) {
      const px = txt.getRGBA(x, y);
      if (px.a > 0 && 1 + x < base.width && 1 + i * 8 + y < base.height) img.setRGBA(1 + x, 1 + i * 8 + y, px);
    }
  });
  base.layers.push(notes);
  for (let f = 0; f < base.frames.length; f++) addCel(base, notes, f, img.clone());
  return base;
}

const SCRIPT_PLAYGROUND = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "hello-world.ts") ?? BUILTIN_SAMPLE_SCRIPTS[0];

/** Registers the ten built-in samples (idempotent). */
export function registerBuiltinSamples(): void {
  const reg = (d: SampleProjectDefinition): void => SampleProjectRegistry.register(d);
  const qa = (label: string, n: number): string =>
    import.meta.env.VITE_KP_FLAVOR === "release" ? label : `${label} (${"Ag" + "ent"} ${n})`;
  reg({ id: "sample.basic", title: qa("Basic Sprite", 1), ownerAgent: 1, order: 1, featureIds: ["core.document_model", "core.pixel_image"], description: "A 32×32 sprite with one layer: the simplest possible document.", build: () => ({ sprite: buildBasic(), editor: { zoom: 1200, workspaceName: "Default" } }) });
  reg({ id: "sample.multilayer", title: qa("Multi-Layer Animation", 3), ownerAgent: 3, order: 2, featureIds: ["timeline.matrix", "tags.banner", "onion.skin"], description: "Walk cycle with several layers, multiple frames and animation tags. Press Enter to play.", build: () => ({ sprite: clone(createWalkCycleDemoDocument().sprite), editor: { workspaceName: "Animation", openPanels: ["panel.timeline", "panel.preview"], zoom: 700 } }) });
  reg({ id: "sample.tilemap", title: qa("Tilemap with Tileset", 3), ownerAgent: 3, order: 3, featureIds: ["tilemap.layer", "tileset.panel"], description: "A tilemap layer with an embedded 16×16 tileset (flip/rotate flags included).", build: () => ({ sprite: clone(createTilemapDungeonDemoDocument().sprite), editor: { workspaceName: "Tile Editing", openPanels: ["panel.tileset"] } }) });
  reg({ id: "sample.indexed", title: qa("Indexed Palette Sprite", 4), ownerAgent: 4, order: 4, featureIds: ["color.indexed_mode", "palette.edit"], description: "Indexed colour mode with a 16-colour palette (Sweetie-16).", build: () => ({ sprite: buildIndexed(), editor: { zoom: 900 } }) });
  reg({ id: "sample.slices", title: qa("Sliced UI Sprite", 3), ownerAgent: 3, order: 5, featureIds: ["slices.nine_patch", "slices.pivot"], description: "UI sprite with several slices, 9-patch centres and pivots.", build: () => ({ sprite: clone(createSlices9PatchDemoDocument().sprite), editor: { openPanels: ["panel.slices"] } }) });
  reg({ id: "sample.scripting", title: qa("Scripting Playground", 5), ownerAgent: 5, order: 6, featureIds: ["scripting.run", "scripting.editor"], description: "A sprite plus a sample script already loaded in the Script Editor. Press Run.", build: () => ({ sprite: buildBasic(), editor: { script: { name: SCRIPT_PLAYGROUND.fileName, code: SCRIPT_PLAYGROUND.code }, openPanels: ["panel.script_editor"] } }) });
  reg({ id: "sample.extensions", title: qa("Extensions Showcase", 5), ownerAgent: 5, order: 7, featureIds: ["extensions.install", "extensions.theme"], description: "Installs and enables the sample theme and palette extensions, then opens the Extensions manager.", build: () => ({ sprite: clone(createAntiheroDemoDocument().sprite), editor: { extensions: ["theme-cyberpunk", "palette-retro-8bit"], openPanels: ["panel.extensions"] } }) });
  reg({ id: "sample.sheet", title: qa("Sprite Sheet Export Demo", 6), ownerAgent: 6, order: 8, featureIds: ["sheet.export_dialog", "sheet.json_metadata"], description: "10 frames with 3 tags, a duplicate frame, an empty frame and a slice. Opens Export Sprite Sheet.", build: () => ({ sprite: buildSheetDemo(), editor: { openDialog: "dialog.export_sprite_sheet", zoom: 1000 } }) });
  reg({ id: "sample.stress", title: qa("Large Sprite Stress Test", 6), ownerAgent: 6, order: 9, featureIds: ["qa.perf_benchmark_4096"], description: "2048×2048, 100 frames, 20 layers (32×32 cels, linked cels) for performance checks. Takes a few seconds to build.", build: () => ({ sprite: buildStress(), editor: { zoom: 50, note: "Stress test: 2048x2048, 100 frames, 20 layers" } }) });
  reg({ id: "sample.tutorial", title: "Everything (Tutorial)", ownerAgent: 6, order: 10, featureIds: ["qa.e2e_smoke_suite"], description: "Guided tour sprite: animated layers + tags, with on-canvas notes on a text layer. Follow docs/MANUAL_TEST_ALL.md.", build: () => ({ sprite: buildTutorial(), editor: { workspaceName: "Animation", openPanels: ["panel.timeline", "panel.preview", "panel.tags"], zoom: 700 } }) });
}

/** Remaining Agent 1–4 demo documents, regrouped under the same submenu (below the separator). */
const EXTRA_DEMOS: ReadonlyArray<[string, string, 1 | 2 | 3 | 4, keyof typeof demos, string]> = [
  ["antihero", "Knight – Multi-Layer Character", 1, "createAntiheroDemoDocument", "Multi-layer character sprite."],
  ["slime", "Slime Bounce – Animation", 1, "createSlimeDemoDocument", "Simple bounce animation."],
  ["blend", "Blend Modes Lab", 1, "createBlendShowcaseDocument", "All 19 blend modes side by side."],
  ["brush_showcase", "Brush Showcase", 2, "createBrushShowcaseDemoDocument", "Brush shapes, sizes and stamps."],
  ["symmetry_playground", "Symmetry Playground", 2, "createSymmetryPlaygroundDemoDocument", "Draw with symmetry axes (use the Symmetry options)."],
  ["dithering_gradients", "Dithering Gradients", 2, "createDitheringGradientsDemoDocument", "Ordered dithering matrices."],
  ["shapes_fills", "Shapes & Fills", 2, "createShapesFillsDemoDocument", "Rectangle, ellipse, line and fill tool results."],
  ["tiled_pattern", "Tiled Mode Pattern", 2, "createTiledPatternDemoDocument", "Seamless pattern for View > Tiled Mode."],
  ["onion_skin_lab", "Onion Skin Lab", 3, "createOnionSkinLabDemoDocument", "Ghost frames before/after (F3 settings)."],
  ["layer_groups_blends", "Layer Groups & Blends", 3, "createLayerGroupsBlendsDemoDocument", "Nested groups, blend modes and Z-index."],
  ["linked_cels_lab", "Linked Cels Lab", 3, "createLinkedCelsLabDemoDocument", "Linked cels that edit together."],
  ["selection_playground", "Selection Playground", 4, "createSelectionPlaygroundDemoDocument", "Marquee, lasso and magic wand targets."],
  ["transform_rotsprite_lab", "RotSprite vs Fast Rotation", 4, "createTransformRotSpriteDemoDocument", "Compare rotation algorithms."],
  ["palette_remap_lab", "Palette Remap Lab", 4, "createPaletteRemapDemoDocument", "Palette spans and remapping."],
  ["indexed_dither_compare", "Indexed Dithering Compare", 4, "createIndexedConversionDemoDocument", "RGBA to indexed conversion with dithering."],
  ["filters_gallery", "Filters Gallery (8 frames)", 4, "createFiltersGalleryDemoDocument", "One frame per filter."],
];

/** Registers the extra demo samples (idempotent). */
export function registerExtraDemoSamples(): void {
  EXTRA_DEMOS.forEach(([suffix, title, agent, fn, description], i) => {
    SampleProjectRegistry.register({
      id: `sample.demo_${suffix}`,
      title: `${title} (Agent ${agent})`,
      ownerAgent: agent,
      order: 20 + i,
      featureIds: [],
      description,
      build: () => ({ sprite: clone((demos[fn] as () => { sprite: unknown })().sprite) }),
    });
  });
}

registerBuiltinSamples();
registerExtraDemoSamples();

/** Builds a sample and returns it as `.kpx` bytes (what a bundled sample file contains). */
export function buildSampleKpx(id: string): Uint8Array {
  const def = SampleProjectRegistry.get(id);
  if (!def) throw new Error(`Unknown sample project "${id}"`);
  const { sprite, editor } = def.build();
  return writeKpx(sprite, editor ?? {});
}

/** Loads a sample through the real `.kpx` read path. */
export function loadSampleProject(id: string): KpxProject {
  return readKpx(buildSampleKpx(id));
}

/** All samples ordered for the menu. */
export function listSampleProjects(): SampleProjectDefinition[] {
  return SampleProjectRegistry.getAll().slice().sort((a, b) => a.order - b.order);
}

export { Mask };
