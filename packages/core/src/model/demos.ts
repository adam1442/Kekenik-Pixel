/**
 * @module @kekenik/core/model/demos
 * Procedural demo documents exercising layers, linked cels, frames, tags, slices, indexed palettes, and blend modes.
 */

import { SpriteDocument } from "../commands/index.ts";
import {
  applyBrightnessContrastFilter,
  applyConvolutionMatrixFilter,
  applyDropShadowFilter,
  applyHueSaturationFilter,
  applyInvertFilter,
  applyOutlineFilter,
  applyPosterizeFilter,
  CONVOLUTION_PRESETS,
} from "../filters/index.ts";
import { convertImageColorMode } from "../palette/index.ts";
import { renderTilemapCel } from "../render/index.ts";
import { encodeSavedMask } from "../selection/index.ts";
import { packTileEntry } from "../tilemap/index.ts";
import { rotateImageFast, rotSpriteRotate } from "../transform/index.ts";
import { RGBA } from "../util/index.ts";
import {
  Cel,
  createModelId,
  createSprite,
  DEFAULT_PALETTE_COLORS,
  Frame,
  GroupLayer,
  ImageLayer,
  Mask,
  PixelImage,
  Sprite,
  TilemapLayer,
  Tileset,
} from "./index.ts";

function fillRect(img: PixelImage, x0: number, y0: number, w: number, h: number, color: RGBA): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      img.setRGBA(x, y, color);
    }
  }
}

/**
 * Generates the signature "antihero.ase" multi-layer knight sprite inspired by Screenshot 1:
 * - 4 layers: Background, Shadow, Legs, Arms
 * - 11 frames (200ms each)
 * - Linked cels across frames 1..5 on Background, Shadow, and Legs
 * - 3 colored tags: "idle" (frames 1..5), "standup" (frames 6..9), "kickdoor" (frames 10..11)
 */
export function createAntiheroDemoDocument(): SpriteDocument {
  const width = 64;
  const height = 48;

  const bgLayer: ImageLayer = {
    id: createModelId("layer_bg"),
    kind: "image",
    name: "Background",
    parentId: null,
    visible: true,
    editable: true,
    lockMove: true,
    background: true,
    preferLinkedCels: true,
    collapsed: false,
    reference: false,
    blendMode: "normal",
    opacity: 255,
    userData: { text: "Solid warm clay backdrop" },
  };

  const shadowLayer: ImageLayer = {
    id: createModelId("layer_sh"),
    kind: "image",
    name: "Shadow",
    parentId: null,
    visible: true,
    editable: true,
    lockMove: false,
    background: false,
    preferLinkedCels: true,
    collapsed: false,
    reference: false,
    blendMode: "multiply",
    opacity: 190,
    userData: { text: "Ground shadow" },
  };

  const legsLayer: ImageLayer = {
    id: createModelId("layer_legs"),
    kind: "image",
    name: "Legs",
    parentId: null,
    visible: true,
    editable: true,
    lockMove: false,
    background: false,
    preferLinkedCels: true,
    collapsed: false,
    reference: false,
    blendMode: "normal",
    opacity: 255,
    userData: { text: "Armored greaves & stance" },
  };

  const armsLayer: ImageLayer = {
    id: createModelId("layer_arms"),
    kind: "image",
    name: "Arms",
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
    userData: { text: "Upper torso, helmet & animated arms" },
  };

  const frames: Frame[] = Array.from({ length: 11 }, (_, idx) => ({
    id: createModelId("frame"),
    index: idx,
    durationMs: 200,
  }));

  // Shared background image (linked across all 11 frames)
  const bgImg = new PixelImage(width, height, "rgba");
  fillRect(bgImg, 0, 0, width, height, { r: 147, g: 88, b: 60, a: 255 });
  // Door on the right side
  fillRect(bgImg, 50, 4, 14, 44, { r: 112, g: 68, b: 48, a: 255 });
  fillRect(bgImg, 50, 4, 1, 44, { r: 22, g: 16, b: 24, a: 255 });

  // Shared shadow image
  const shadowImg = new PixelImage(width, height, "rgba");
  fillRect(shadowImg, 10, 40, 30, 3, { r: 110, g: 64, b: 45, a: 255 });
  fillRect(shadowImg, 13, 39, 24, 1, { r: 110, g: 64, b: 45, a: 255 });

  // Shared legs image for frames 0..4
  const legsIdleImg = new PixelImage(width, height, "rgba");
  const darkArmor: RGBA = { r: 39, g: 31, b: 53, a: 255 };
  const midArmor: RGBA = { r: 62, g: 47, b: 74, a: 255 };
  const bootBlack: RGBA = { r: 15, g: 12, b: 22, a: 255 };
  // Left leg
  fillRect(legsIdleImg, 18, 27, 6, 8, darkArmor);
  fillRect(legsIdleImg, 19, 28, 3, 5, midArmor);
  fillRect(legsIdleImg, 15, 35, 5, 7, bootBlack);
  fillRect(legsIdleImg, 13, 40, 6, 2, bootBlack);
  // Right leg
  fillRect(legsIdleImg, 28, 27, 7, 8, darkArmor);
  fillRect(legsIdleImg, 30, 28, 4, 5, midArmor);
  fillRect(legsIdleImg, 33, 35, 5, 7, bootBlack);
  fillRect(legsIdleImg, 34, 40, 6, 2, bootBlack);

  const bgLinkId = createModelId("link_bg");
  const shadowLinkId = createModelId("link_sh");
  const legsLinkId = createModelId("link_legs");

  const cels: Cel[] = [];

  for (let fi = 0; fi < 11; fi++) {
    // Background cel (linked across 0..10)
    cels.push({
      id: createModelId("cel"),
      layerId: bgLayer.id,
      frameIndex: fi,
      x: 0,
      y: 0,
      opacity: 255,
      zIndex: 0,
      linkId: bgLinkId,
      image: bgImg,
      userData: { text: "" },
    });

    // Shadow cel (linked across 0..4)
    cels.push({
      id: createModelId("cel"),
      layerId: shadowLayer.id,
      frameIndex: fi,
      x: 0,
      y: 0,
      opacity: 255,
      zIndex: 0,
      linkId: fi < 5 ? shadowLinkId : undefined,
      image: fi < 5 ? shadowImg : shadowImg.clone(),
      userData: { text: "" },
    });

    // Legs cel (linked across 0..4)
    const legsImg = fi < 5 ? legsIdleImg : legsIdleImg.clone();
    if (fi >= 9) {
      // Kick pose on frames 9..10
      fillRect(legsImg, 34, 24, 12, 4, midArmor);
      fillRect(legsImg, 44, 22, 4, 6, bootBlack);
    }
    cels.push({
      id: createModelId("cel"),
      layerId: legsLayer.id,
      frameIndex: fi,
      x: 0,
      y: 0,
      opacity: 255,
      zIndex: 0,
      linkId: fi < 5 ? legsLinkId : undefined,
      image: legsImg,
      userData: { text: "" },
    });

    // Arms & Torso cel (unique per frame for breathing/stance animation)
    const armsImg = new PixelImage(width, height, "rgba");
    const bobY = fi < 5 ? (fi % 2 === 1 ? 1 : 0) : fi < 9 ? -1 : -2;
    const helmLight: RGBA = { r: 92, g: 68, b: 96, a: 255 };
    // Torso
    fillRect(armsImg, 20, 14 + bobY, 13, 14, darkArmor);
    fillRect(armsImg, 22, 16 + bobY, 9, 8, midArmor);
    // Helmet with T-visor
    fillRect(armsImg, 23, 6 + bobY, 8, 9, midArmor);
    fillRect(armsImg, 26, 6 + bobY, 5, 8, helmLight);
    fillRect(armsImg, 25, 9 + bobY, 5, 1, bootBlack); // visor horizontal
    fillRect(armsImg, 27, 9 + bobY, 1, 5, bootBlack); // visor vertical
    // Shoulders & Arms
    fillRect(armsImg, 14, 15 + bobY, 7, 6, midArmor);
    fillRect(armsImg, 12, 20 + bobY, 5, 7, darkArmor);
    fillRect(armsImg, 32, 15 + bobY, 7, 5, midArmor);
    fillRect(armsImg, 36, 19 + bobY, 6, 5, darkArmor);
    // Claws / Gauntlets
    fillRect(armsImg, 39, 23 + bobY, 4, 3, bootBlack);

    cels.push({
      id: createModelId("cel"),
      layerId: armsLayer.id,
      frameIndex: fi,
      x: 0,
      y: 0,
      opacity: 255,
      zIndex: 0,
      image: armsImg,
      userData: { text: "" },
    });
  }

  const sprite: Sprite = {
    id: createModelId("sprite"),
    name: "antihero.ase",
    width,
    height,
    colorMode: "rgba",
    transparentIndex: 0,
    pixelRatio: { w: 1, h: 1 },
    grid: { x: 0, y: 0, width: 16, height: 16, visible: false },
    palettes: [
      {
        id: createModelId("pal"),
        name: "Antihero Palette",
        fromFrame: 0,
        toFrame: 999,
        colors: [
          { r: 0, g: 0, b: 0, a: 0 },
          { r: 15, g: 12, b: 22, a: 255 },
          { r: 39, g: 31, b: 53, a: 255 },
          { r: 62, g: 47, b: 74, a: 255 },
          { r: 92, g: 68, b: 96, a: 255 },
          { r: 110, g: 64, b: 45, a: 255 },
          { r: 147, g: 88, b: 60, a: 255 },
          ...DEFAULT_PALETTE_COLORS.slice(7),
        ],
      },
    ],
    layers: [bgLayer, shadowLayer, legsLayer, armsLayer],
    frames,
    cels,
    tags: [
      {
        id: createModelId("tag"),
        name: "idle",
        fromFrame: 0,
        toFrame: 4,
        direction: "forward",
        color: "#1c1c1c",
        repeat: 0,
        userData: { text: "Breathing stance" },
      },
      {
        id: createModelId("tag"),
        name: "standup",
        fromFrame: 5,
        toFrame: 8,
        direction: "forward",
        color: "#0926c4",
        repeat: 0,
        userData: { text: "Brace before kick" },
      },
      {
        id: createModelId("tag"),
        name: "kickdoor",
        fromFrame: 9,
        toFrame: 10,
        direction: "pingpong",
        color: "#c81010",
        repeat: 2,
        userData: { text: "Breach kick" },
      },
    ],
    slices: [
      {
        id: createModelId("slice"),
        name: "hurtbox",
        color: "#38bdf8",
        keys: [
          {
            frameIndex: 0,
            bounds: { x: 12, y: 6, width: 32, height: 36 },
            pivot: { x: 27, y: 40 },
          },
        ],
        userData: { text: "Character hurtbox" },
      },
    ],
    tilesets: [],
    mask: createSprite({ width, height }).mask,
    userData: { text: "Antihero demo sprite" },
  };

  return new SpriteDocument(sprite);
}

/**
 * Generates an Indexed-mode bouncing slime animation demo (32x32, 4 frames).
 */
export function createSlimeDemoDocument(): SpriteDocument {
  const sprite = createSprite({
    name: "slime_bounce.ase",
    width: 32,
    height: 32,
    colorMode: "rgba",
    background: "transparent",
  });
  const doc = new SpriteDocument(sprite);
  const lid = doc.sprite.layers[0].id;

  doc.transact("Setup Slime Animation", (tx) => {
    tx.addFrame(0, false);
    tx.addFrame(1, false);
    tx.addFrame(2, false);
    tx.addTag({
      id: createModelId("tag"),
      name: "bounce",
      fromFrame: 0,
      toFrame: 3,
      direction: "pingpong",
      color: "#22c55e",
      repeat: 0,
      userData: { text: "" },
    });
  });

  const offsets = [0, -3, -5, -2];
  for (let f = 0; f < 4; f++) {
    const cel = doc.sprite.cels.find((c) => c.layerId === lid && c.frameIndex === f)!;
    const dy = offsets[f];
    fillRect(cel.image, 8, 16 + dy, 16, 10, { r: 55, g: 148, b: 110, a: 255 });
    fillRect(cel.image, 10, 14 + dy, 12, 12, { r: 106, g: 190, b: 48, a: 255 });
    fillRect(cel.image, 11, 15 + dy, 4, 2, { r: 153, g: 229, b: 80, a: 255 });
    // Eyes
    cel.image.setRGBA(12, 19 + dy, { r: 20, g: 20, b: 30, a: 255 });
    cel.image.setRGBA(19, 19 + dy, { r: 20, g: 20, b: 30, a: 255 });
  }

  return doc;
}

/**
 * Generates a Blend Mode showcase demo sprite (48x48, 3 overlapping layers).
 */
export function createBlendShowcaseDocument(): SpriteDocument {
  const sprite = createSprite({
    name: "blend_modes.ase",
    width: 48,
    height: 48,
    colorMode: "rgba",
    background: "transparent",
  });
  const doc = new SpriteDocument(sprite);
  const baseLayerId = doc.sprite.layers[0].id;

  let multiplyLayerId = "";
  let screenLayerId = "";
  doc.transact("Create Blend Layers", (tx) => {
    tx.setLayerProps(baseLayerId, { name: "Base Gem (Normal)" });
    const l2 = tx.addImageLayer("Shadow Pass (Multiply)");
    multiplyLayerId = l2.id;
    tx.setLayerProps(l2.id, { blendMode: "multiply", opacity: 210 });
    const l3 = tx.addImageLayer("Glow Pass (Screen)");
    screenLayerId = l3.id;
    tx.setLayerProps(l3.id, { blendMode: "screen", opacity: 220 });
  });

  const baseCel = doc.sprite.cels.find((c) => c.layerId === baseLayerId && c.frameIndex === 0)!;
  const multCel = doc.sprite.cels.find((c) => c.layerId === multiplyLayerId && c.frameIndex === 0)!;
  const scrnCel = doc.sprite.cels.find((c) => c.layerId === screenLayerId && c.frameIndex === 0)!;

  fillRect(baseCel.image, 8, 8, 24, 24, { r: 91, g: 110, b: 225, a: 255 });
  fillRect(multCel.image, 16, 16, 24, 24, { r: 217, g: 87, b: 99, a: 255 });
  fillRect(scrnCel.image, 12, 6, 20, 20, { r: 95, g: 205, b: 228, a: 255 });

  return doc;
}

/**
 * Agent 2 Demo 1: Brush Showcase (80x64)
 * Demonstrates Circle, Square, Calligraphy 45° Line, Sparkle Stamp, and Dithered Pattern strokes.
 */
export function createBrushShowcaseDemoDocument(): SpriteDocument {
  const sprite = createSprite({
    name: "brush_showcase.ase",
    width: 80,
    height: 64,
    colorMode: "rgba",
    background: "transparent",
  });
  const doc = new SpriteDocument(sprite);
  const bgLayerId = doc.sprite.layers[0].id;
  let strokesLayerId = "";

  doc.transact("Setup Brush Showcase", (tx) => {
    tx.setLayerProps(bgLayerId, { name: "Backdrop" });
    strokesLayerId = tx.addImageLayer("Brush Strokes").id;
  });

  const bgCel = doc.sprite.cels.find((c) => c.layerId === bgLayerId && c.frameIndex === 0)!;
  const stCel = doc.sprite.cels.find((c) => c.layerId === strokesLayerId && c.frameIndex === 0)!;

  fillRect(bgCel.image, 0, 0, 80, 64, { r: 34, g: 32, b: 52, a: 255 });
  // Decorative border
  fillRect(bgCel.image, 2, 2, 76, 1, { r: 95, g: 205, b: 228, a: 255 });
  fillRect(bgCel.image, 2, 61, 76, 1, { r: 95, g: 205, b: 228, a: 255 });

  // Row 1: 1px, 3px, 5px Circle & Square brush dabs
  const gold: RGBA = { r: 251, g: 242, b: 54, a: 255 };
  const cyan: RGBA = { r: 95, g: 205, b: 228, a: 255 };
  const coral: RGBA = { r: 217, g: 87, b: 99, a: 255 };
  const lime: RGBA = { r: 153, g: 229, b: 80, a: 255 };

  // Wave stroke with 3px circle
  for (let x = 8; x < 72; x++) {
    const y = 14 + Math.round(Math.sin(x * 0.22) * 4);
    fillRect(stCel.image, x - 1, y - 1, 3, 3, gold);
  }

  // Calligraphy 45° ribbon stroke
  for (let x = 10; x < 70; x += 2) {
    const y = 30 + Math.round(Math.cos(x * 0.18) * 4);
    for (let k = -2; k <= 2; k++) {
      stCel.image.setRGBA(x + k, y - k, cyan);
    }
  }

  // Custom sparkle stamps row
  const stampCenters = [14, 28, 42, 56, 68];
  for (const cx of stampCenters) {
    const cy = 48;
    fillRect(stCel.image, cx - 3, cy, 7, 1, coral);
    fillRect(stCel.image, cx, cy - 3, 1, 7, coral);
    fillRect(stCel.image, cx - 1, cy - 1, 3, 3, lime);
  }

  return doc;
}

/**
 * Agent 2 Demo 2: Symmetry Playground (64x64)
 * Pre-configured for 4-way quad & mirror symmetry drawing around (32, 32).
 */
export function createSymmetryPlaygroundDemoDocument(): SpriteDocument {
  const sprite = createSprite({
    name: "symmetry_playground.ase",
    width: 64,
    height: 64,
    colorMode: "rgba",
    background: "transparent",
  });
  const doc = new SpriteDocument(sprite);
  const bgId = doc.sprite.layers[0].id;
  let mandalaId = "";

  doc.transact("Setup Symmetry Playground", (tx) => {
    tx.setLayerProps(bgId, { name: "Dark Slate Canvas" });
    mandalaId = tx.addImageLayer("Quad Symmetry Crest").id;
  });

  const bgCel = doc.sprite.cels.find((c) => c.layerId === bgId && c.frameIndex === 0)!;
  const manCel = doc.sprite.cels.find((c) => c.layerId === mandalaId && c.frameIndex === 0)!;

  fillRect(bgCel.image, 0, 0, 64, 64, { r: 22, g: 20, b: 35, a: 255 });

  const mirrorPlot = (x: number, y: number, color: RGBA) => {
    const mx = 63 - x;
    const my = 63 - y;
    manCel.image.setRGBA(x, y, color);
    manCel.image.setRGBA(mx, y, color);
    manCel.image.setRGBA(x, my, color);
    manCel.image.setRGBA(mx, my, color);
    manCel.image.setRGBA(y, x, color);
    manCel.image.setRGBA(my, x, color);
    manCel.image.setRGBA(y, mx, color);
    manCel.image.setRGBA(my, mx, color);
  };

  const c1: RGBA = { r: 99, g: 155, b: 255, a: 255 };
  const c2: RGBA = { r: 251, g: 242, b: 54, a: 255 };
  const c3: RGBA = { r: 215, g: 123, b: 186, a: 255 };

  for (let i = 4; i <= 26; i++) {
    mirrorPlot(i, 31, c1);
    mirrorPlot(i, i, c3);
    if (i >= 10 && i <= 22) {
      mirrorPlot(i, 28 - Math.floor((i - 10) / 2), c2);
    }
  }

  return doc;
}

/**
 * Agent 2 Demo 3: Dithering Gradients (80x64)
 * Displays Bayer 2x2, Bayer 4x4, Bayer 8x8, and Radial Dithered gradients side-by-side.
 */
export function createDitheringGradientsDemoDocument(): SpriteDocument {
  const sprite = createSprite({
    name: "dithering_gradients.ase",
    width: 80,
    height: 64,
    colorMode: "rgba",
    background: "transparent",
  });
  const doc = new SpriteDocument(sprite);
  const cel = doc.sprite.cels[0];

  const bayer4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const topA: RGBA = { r: 39, g: 31, b: 53, a: 255 };
  const topB: RGBA = { r: 223, g: 113, b: 38, a: 255 };
  const botA: RGBA = { r: 48, g: 96, b: 130, a: 255 };
  const botB: RGBA = { r: 251, g: 242, b: 54, a: 255 };

  // Upper half: Linear Bayer 4x4 sunset gradient
  for (let y = 0; y < 31; y++) {
    const ratio = y / 30;
    for (let x = 0; x < 80; x++) {
      const thresh = (bayer4[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
      cel.image.setRGBA(x, y, ratio >= thresh ? topB : topA);
    }
  }

  // Divider line
  fillRect(cel.image, 0, 31, 80, 2, { r: 255, g: 255, b: 255, a: 255 });

  // Lower half: Radial dithered orb gradient
  for (let y = 33; y < 64; y++) {
    for (let x = 0; x < 80; x++) {
      const dist = Math.hypot(x - 40, (y - 48) * 1.4) / 36;
      const ratio = Math.min(1, dist);
      const thresh = (bayer4[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
      cel.image.setRGBA(x, y, ratio >= thresh ? botA : botB);
    }
  }

  return doc;
}

/**
 * Agent 2 Demo 4: Shapes & Fills (80x64)
 * Demonstrates Rectangles, Ellipses, Bezier Curves, Polygons, Flood Fill, and Pixel Text.
 */
export function createShapesFillsDemoDocument(): SpriteDocument {
  const sprite = createSprite({
    name: "shapes_fills.ase",
    width: 80,
    height: 64,
    colorMode: "rgba",
    background: "transparent",
  });
  const doc = new SpriteDocument(sprite);
  const cel = doc.sprite.cels[0];

  fillRect(cel.image, 0, 0, 80, 64, { r: 50, g: 60, b: 57, a: 255 });

  // Filled & Outlined Rectangles
  fillRect(cel.image, 6, 8, 22, 18, { r: 91, g: 110, b: 225, a: 255 });
  fillRect(cel.image, 8, 10, 18, 14, { r: 95, g: 205, b: 228, a: 255 });

  // Circle / Ellipse
  for (let y = -10; y <= 10; y++) {
    for (let x = -10; x <= 10; x++) {
      const d = x * x + y * y;
      if (d <= 100) {
        cel.image.setRGBA(
          46 + x,
          17 + y,
          d >= 72
            ? { r: 255, g: 255, b: 255, a: 255 }
            : { r: 217, g: 87, b: 99, a: 255 }
        );
      }
    }
  }

  // Filled Diamond / Polygon
  for (let dy = -11; dy <= 11; dy++) {
    const span = 11 - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      cel.image.setRGBA(67 + dx, 17 + dy, { r: 251, g: 242, b: 54, a: 255 });
    }
  }

  // Sine / Bezier wave along bottom
  for (let x = 6; x < 74; x++) {
    const y = 46 + Math.round(Math.sin((x - 6) * 0.14) * 8);
    fillRect(cel.image, x, y, 2, 2, { r: 153, g: 229, b: 80, a: 255 });
  }

  return doc;
}

/**
 * Agent 2 Demo 5: Tiled Mode Pattern (32x32)
 * Seamless wrap-around pixel-art cobblestone & moss pattern for View > Tiled Mode.
 */
export function createTiledPatternDemoDocument(): SpriteDocument {
  const sprite = createSprite({
    name: "tiled_pattern.ase",
    width: 32,
    height: 32,
    colorMode: "rgba",
    background: "transparent",
  });
  const doc = new SpriteDocument(sprite);
  const cel = doc.sprite.cels[0];

  const mortar: RGBA = { r: 34, g: 32, b: 52, a: 255 };
  const stoneBase: RGBA = { r: 105, g: 106, b: 106, a: 255 };
  const stoneLight: RGBA = { r: 155, g: 173, b: 183, a: 255 };
  const stoneDark: RGBA = { r: 89, g: 86, b: 82, a: 255 };
  const moss: RGBA = { r: 106, g: 190, b: 48, a: 255 };

  fillRect(cel.image, 0, 0, 32, 32, stoneBase);

  // Seamless brick courses (4 rows of 8px height, staggered by 8px on odd rows)
  for (let row = 0; row < 4; row++) {
    const yTop = row * 8;
    const offset = (row % 2) * 8;
    // Horizontal mortar joint
    fillRect(cel.image, 0, yTop, 32, 1, mortar);
    // Top highlight on stone
    fillRect(cel.image, 0, yTop + 1, 32, 1, stoneLight);
    // Bottom shadow on stone
    fillRect(cel.image, 0, yTop + 7, 32, 1, stoneDark);

    // Vertical mortar joints wrapping seamlessly mod 32
    for (let b = 0; b < 2; b++) {
      const vx = (offset + b * 16) % 32;
      for (let dy = 0; dy < 8; dy++) {
        cel.image.setRGBA(vx, yTop + dy, mortar);
      }
      // Moss accent near corners
      cel.image.setRGBA((vx + 1) % 32, yTop + 1, moss);
      cel.image.setRGBA((vx + 2) % 32, yTop + 1, moss);
    }
  }

  return doc;
}

/**
 * Agent 3 Demo 1: Walk Cycle (`walk_cycle.ase`, 48x48, 8 frames, tags `idle` / `walk` / `attack`, cascading subtag `step_contact`).
 */
export function createWalkCycleDemoDocument(): SpriteDocument {
  const width = 48;
  const height = 48;

  const groundLayer: ImageLayer = {
    id: createModelId("layer_ground"),
    kind: "image",
    name: "Ground Track",
    parentId: null,
    visible: true,
    editable: true,
    lockMove: true,
    background: false,
    preferLinkedCels: true,
    collapsed: false,
    reference: false,
    blendMode: "normal",
    opacity: 255,
    userData: { text: "Continuous ground floor", color: "#475569" },
  };

  const bodyLayer: ImageLayer = {
    id: createModelId("layer_runner"),
    kind: "image",
    name: "Ranger Body",
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
    userData: { text: "8-frame walk & slash animation", color: "#22c55e" },
  };

  const slashLayer: ImageLayer = {
    id: createModelId("layer_slash"),
    kind: "image",
    name: "Blade Arc FX",
    parentId: null,
    visible: true,
    editable: true,
    lockMove: false,
    background: false,
    preferLinkedCels: false,
    collapsed: false,
    reference: false,
    blendMode: "addition",
    opacity: 235,
    userData: { text: "Additive sword slash on attack frames", color: "#eab308" },
  };

  const durations = [160, 160, 100, 100, 100, 100, 80, 140];
  const frames: Frame[] = durations.map((durationMs, index) => ({
    id: createModelId("frame"),
    index,
    durationMs,
  }));

  const groundImg = new PixelImage(width, height, "rgba");
  fillRect(groundImg, 0, 40, width, 8, { r: 45, g: 52, b: 68, a: 255 });
  fillRect(groundImg, 0, 40, width, 2, { r: 106, g: 190, b: 48, a: 255 });
  const groundLink = createModelId("link_ground");

  const cels: Cel[] = [];
  const strideOffsets = [0, 1, -3, 0, 3, 0, 4, 2];
  const bobOffsets = [0, 1, -2, 0, -2, 0, -1, 1];

  for (let fi = 0; fi < 8; fi++) {
    cels.push({
      id: createModelId("cel"),
      layerId: groundLayer.id,
      frameIndex: fi,
      x: 0,
      y: 0,
      opacity: 255,
      zIndex: 0,
      linkId: groundLink,
      image: groundImg,
      userData: { text: "" },
    });

    const bodyImg = new PixelImage(width, height, "rgba");
    const bx = 18 + (fi >= 6 ? 3 : 0);
    const by = 14 + bobOffsets[fi];
    const stride = strideOffsets[fi];

    // Cloak & Torso
    fillRect(bodyImg, bx, by + 6, 10, 12, { r: 55, g: 148, b: 110, a: 255 });
    fillRect(bodyImg, bx + 2, by + 7, 6, 9, { r: 106, g: 190, b: 48, a: 255 });
    // Hood & Head
    fillRect(bodyImg, bx + 2, by, 7, 7, { r: 238, g: 195, b: 154, a: 255 });
    fillRect(bodyImg, bx + 1, by - 1, 7, 3, { r: 55, g: 148, b: 110, a: 255 });
    bodyImg.setRGBA(bx + 7, by + 3, { r: 20, g: 20, b: 30, a: 255 });
    // Legs with alternating walk cycle stride
    fillRect(bodyImg, bx + 2 + stride, 32, 3, 8, { r: 69, g: 40, b: 60, a: 255 });
    fillRect(bodyImg, bx + 6 - stride, 32, 3, 8, { r: 34, g: 32, b: 52, a: 255 });

    cels.push({
      id: createModelId("cel"),
      layerId: bodyLayer.id,
      frameIndex: fi,
      x: 0,
      y: 0,
      opacity: 255,
      zIndex: 0,
      image: bodyImg,
      userData: { text: "" },
    });

    const slashImg = new PixelImage(width, height, "rgba");
    if (fi === 6) {
      fillRect(slashImg, 30, 12, 12, 3, { r: 251, g: 242, b: 54, a: 255 });
      fillRect(slashImg, 36, 15, 6, 14, { r: 95, g: 205, b: 228, a: 255 });
    } else if (fi === 7) {
      fillRect(slashImg, 32, 24, 11, 4, { r: 223, g: 113, b: 38, a: 255 });
    }
    cels.push({
      id: createModelId("cel"),
      layerId: slashLayer.id,
      frameIndex: fi,
      x: 0,
      y: 0,
      opacity: 255,
      zIndex: fi === 6 ? 2 : 0,
      image: slashImg,
      userData: { text: fi >= 6 ? "Sword swing" : "" },
    });
  }

  const sprite: Sprite = {
    id: createModelId("sprite"),
    name: "walk_cycle.ase",
    width,
    height,
    colorMode: "rgba",
    transparentIndex: 0,
    pixelRatio: { w: 1, h: 1 },
    grid: { x: 0, y: 0, width: 16, height: 16, visible: false },
    palettes: [
      {
        id: createModelId("pal"),
        name: "Walk Cycle Palette",
        fromFrame: 0,
        toFrame: 999,
        colors: DEFAULT_PALETTE_COLORS.map((c) => ({ ...c })),
      },
    ],
    layers: [groundLayer, bodyLayer, slashLayer],
    frames,
    cels,
    tags: [
      {
        id: createModelId("tag"),
        name: "idle",
        fromFrame: 0,
        toFrame: 1,
        direction: "forward",
        color: "#3b82f6",
        repeat: 0,
        userData: { text: "Idle breathing" },
      },
      {
        id: createModelId("tag"),
        name: "walk",
        fromFrame: 2,
        toFrame: 5,
        direction: "forward",
        color: "#16a34a",
        repeat: 0,
        userData: { text: "4-frame walk cycle" },
      },
      {
        id: createModelId("tag"),
        name: "step_sub",
        fromFrame: 3,
        toFrame: 4,
        direction: "pingpong",
        color: "#0d9488",
        repeat: 2,
        userData: { text: "Nested subtag inside walk" },
      },
      {
        id: createModelId("tag"),
        name: "attack",
        fromFrame: 6,
        toFrame: 7,
        direction: "forward",
        color: "#dc2626",
        repeat: 1,
        userData: { text: "Sword slash combo" },
      },
    ],
    slices: [],
    tilesets: [],
    mask: createSprite({ width, height }).mask,
    userData: { text: "Walk Cycle Demo" },
  };

  return new SpriteDocument(sprite);
}

/**
 * Agent 3 Demo 2: Onion Skin Lab (`onion_skin_lab.ase`, 64x48, 6 frames).
 * Arcing energy comet across 6 frames to showcase Red/Blue Onion Skin ghosting and falloff.
 */
export function createOnionSkinLabDemoDocument(): SpriteDocument {
  const sprite = createSprite({
    name: "onion_skin_lab.ase",
    width: 64,
    height: 48,
    colorMode: "rgba",
    background: "transparent",
  });
  const doc = new SpriteDocument(sprite);
  const arcLayerId = doc.sprite.layers[0].id;

  doc.transact("Setup Onion Skin Lab", (tx) => {
    tx.setLayerProps(arcLayerId, { name: "Energy Comet" });
    for (let i = 0; i < 5; i++) {
      tx.addFrame(i, false);
    }
    tx.addTag({
      id: createModelId("tag"),
      name: "orbit_arc",
      fromFrame: 0,
      toFrame: 5,
      direction: "pingpong",
      color: "#9333ea",
      repeat: 0,
      userData: { text: "Looped arc for onion skin testing" },
    });
  });

  const positions = [
    { x: 10, y: 36 },
    { x: 19, y: 24 },
    { x: 28, y: 14 },
    { x: 37, y: 14 },
    { x: 46, y: 24 },
    { x: 54, y: 36 },
  ];

  for (let f = 0; f < 6; f++) {
    const cel = doc.sprite.cels.find((c) => c.layerId === arcLayerId && c.frameIndex === f)!;
    const pos = positions[f];
    fillRect(cel.image, pos.x - 4, pos.y - 4, 9, 9, { r: 251, g: 242, b: 54, a: 255 });
    fillRect(cel.image, pos.x - 2, pos.y - 2, 5, 5, { r: 255, g: 255, b: 255, a: 255 });
  }

  return doc;
}

/**
 * Agent 3 Demo 3: Layer Groups & Blend Modes (`layer_groups_blends.ase`, 64x64).
 * Exercises nested GroupLayers, Reference Layer underlay, colored layer rows, and Cel z-index offsets.
 */
export function createLayerGroupsBlendsDemoDocument(): SpriteDocument {
  const width = 64;
  const height = 64;

  const refLayer: ImageLayer = {
    id: createModelId("layer_ref"),
    kind: "image",
    name: "Perspective Guide (REF)",
    parentId: null,
    visible: true,
    editable: false,
    lockMove: true,
    background: false,
    preferLinkedCels: true,
    collapsed: false,
    reference: true,
    blendMode: "normal",
    opacity: 110,
    userData: { text: "Reference layer excluded from export", color: "#a855f7" },
  };

  const envGroupId = createModelId("group_env");
  const envGroup: GroupLayer = {
    id: envGroupId,
    kind: "group",
    name: "Environment Group",
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
    children: [],
    userData: { text: "Backdrop & Pillars", color: "#3b82f6" },
  };

  const skyLayer: ImageLayer = {
    id: createModelId("layer_sky"),
    kind: "image",
    name: "Night Sky",
    parentId: envGroupId,
    visible: true,
    editable: true,
    lockMove: false,
    background: false,
    preferLinkedCels: false,
    collapsed: false,
    reference: false,
    blendMode: "normal",
    opacity: 255,
    userData: { text: "", color: "#3b82f6" },
  };

  const fxGroupId = createModelId("group_fx");
  const fxGroup: GroupLayer = {
    id: fxGroupId,
    kind: "group",
    name: "Magic Lighting Group",
    parentId: null,
    visible: true,
    editable: true,
    lockMove: false,
    background: false,
    preferLinkedCels: false,
    collapsed: false,
    reference: false,
    blendMode: "screen",
    opacity: 230,
    children: [],
    userData: { text: "Screen-blended group", color: "#f59e0b" },
  };

  const crystalLayer: ImageLayer = {
    id: createModelId("layer_crystal"),
    kind: "image",
    name: "Floating Crystal",
    parentId: fxGroupId,
    visible: true,
    editable: true,
    lockMove: false,
    background: false,
    preferLinkedCels: false,
    collapsed: false,
    reference: false,
    blendMode: "normal",
    opacity: 255,
    userData: { text: "Main crystal", color: "#10b981" },
  };

  const auraLayer: ImageLayer = {
    id: createModelId("layer_aura"),
    kind: "image",
    name: "Halo Aura (Addition)",
    parentId: fxGroupId,
    visible: true,
    editable: true,
    lockMove: false,
    background: false,
    preferLinkedCels: false,
    collapsed: false,
    reference: false,
    blendMode: "addition",
    opacity: 195,
    userData: { text: "Additive glow", color: "#ec4899" },
  };

  envGroup.children = [skyLayer.id];
  fxGroup.children = [crystalLayer.id, auraLayer.id];

  const refImg = new PixelImage(width, height, "rgba");
  for (let i = 0; i < width; i += 2) {
    refImg.setRGBA(i, 32, { r: 168, g: 85, b: 247, a: 180 });
    refImg.setRGBA(32, i, { r: 168, g: 85, b: 247, a: 180 });
  }

  const skyImg = new PixelImage(width, height, "rgba");
  fillRect(skyImg, 0, 0, width, height, { r: 26, g: 24, b: 46, a: 255 });
  fillRect(skyImg, 8, 48, 48, 16, { r: 50, g: 60, b: 57, a: 255 });

  const crystalImg = new PixelImage(width, height, "rgba");
  fillRect(crystalImg, 24, 18, 16, 24, { r: 95, g: 205, b: 228, a: 255 });
  fillRect(crystalImg, 27, 21, 10, 18, { r: 203, g: 219, b: 252, a: 255 });

  const auraImg = new PixelImage(width, height, "rgba");
  fillRect(auraImg, 18, 12, 28, 36, { r: 215, g: 123, b: 186, a: 160 });

  const sprite: Sprite = {
    id: createModelId("sprite"),
    name: "layer_groups_blends.ase",
    width,
    height,
    colorMode: "rgba",
    transparentIndex: 0,
    pixelRatio: { w: 1, h: 1 },
    grid: { x: 0, y: 0, width: 16, height: 16, visible: false },
    palettes: [
      {
        id: createModelId("pal"),
        name: "Default Palette",
        fromFrame: 0,
        toFrame: 999,
        colors: DEFAULT_PALETTE_COLORS.map((c) => ({ ...c })),
      },
    ],
    layers: [refLayer, envGroup, skyLayer, fxGroup, crystalLayer, auraLayer],
    frames: [{ id: createModelId("frame"), index: 0, durationMs: 120 }],
    cels: [
      {
        id: createModelId("cel"),
        layerId: refLayer.id,
        frameIndex: 0,
        x: 0,
        y: 0,
        opacity: 255,
        zIndex: 0,
        image: refImg,
        userData: { text: "" },
      },
      {
        id: createModelId("cel"),
        layerId: skyLayer.id,
        frameIndex: 0,
        x: 0,
        y: 0,
        opacity: 255,
        zIndex: 0,
        image: skyImg,
        userData: { text: "" },
      },
      {
        id: createModelId("cel"),
        layerId: crystalLayer.id,
        frameIndex: 0,
        x: 0,
        y: 0,
        opacity: 255,
        zIndex: 1,
        image: crystalImg,
        userData: { text: "Z+1 crystal" },
      },
      {
        id: createModelId("cel"),
        layerId: auraLayer.id,
        frameIndex: 0,
        x: 0,
        y: 0,
        opacity: 255,
        zIndex: -1,
        image: auraImg,
        userData: { text: "Z-1 aura" },
      },
    ],
    tags: [],
    slices: [],
    tilesets: [],
    mask: createSprite({ width, height }).mask,
    userData: { text: "Layer Groups & Blend Modes Demo" },
  };

  return new SpriteDocument(sprite);
}

/**
 * Agent 3 Demo 4: Linked Cels Lab (`linked_cels_lab.ase`, 64x48, 6 frames).
 */
export function createLinkedCelsLabDemoDocument(): SpriteDocument {
  const doc = createAntiheroDemoDocument();
  (doc.sprite as { name: string }).name = "linked_cels_lab.ase";
  return doc;
}

/**
 * Agent 3 Demo 5: Tilemap Dungeon (`tilemap_dungeon.ase`, 64x64, 16x16 tileset + TilemapLayer with flip/rotate flags).
 */
export function createTilemapDungeonDemoDocument(): SpriteDocument {
  const width = 64;
  const height = 64;
  const tw = 16;
  const th = 16;

  // Tile 0: Empty transparent tile
  const tile0 = new PixelImage(tw, th, "rgba");

  // Tile 1: Dungeon Stone Brick Wall
  const tile1Wall = new PixelImage(tw, th, "rgba");
  fillRect(tile1Wall, 0, 0, 16, 16, { r: 63, g: 63, b: 116, a: 255 });
  fillRect(tile1Wall, 1, 1, 14, 6, { r: 91, g: 110, b: 225, a: 255 });
  fillRect(tile1Wall, 1, 9, 6, 6, { r: 48, g: 96, b: 130, a: 255 });
  fillRect(tile1Wall, 9, 9, 6, 6, { r: 48, g: 96, b: 130, a: 255 });

  // Tile 2: Floor Cobblestone
  const tile2Floor = new PixelImage(tw, th, "rgba");
  fillRect(tile2Floor, 0, 0, 16, 16, { r: 50, g: 60, b: 57, a: 255 });
  fillRect(tile2Floor, 2, 2, 12, 12, { r: 89, g: 86, b: 82, a: 255 });
  fillRect(tile2Floor, 4, 4, 4, 4, { r: 105, g: 106, b: 106, a: 255 });

  // Tile 3: Asymmetric Corner Trim (used with FlipX / FlipY / Rotate90 flags!)
  const tile3Corner = new PixelImage(tw, th, "rgba");
  fillRect(tile3Corner, 0, 0, 16, 16, { r: 34, g: 32, b: 52, a: 255 });
  fillRect(tile3Corner, 0, 0, 16, 4, { r: 223, g: 113, b: 38, a: 255 });
  fillRect(tile3Corner, 0, 0, 4, 16, { r: 223, g: 113, b: 38, a: 255 });
  fillRect(tile3Corner, 2, 2, 4, 4, { r: 251, g: 242, b: 54, a: 255 });

  // Tile 4: Treasure Chest
  const tile4Chest = new PixelImage(tw, th, "rgba");
  fillRect(tile4Chest, 0, 0, 16, 16, { r: 50, g: 60, b: 57, a: 255 });
  fillRect(tile4Chest, 2, 4, 12, 10, { r: 143, g: 86, b: 59, a: 255 });
  fillRect(tile4Chest, 2, 7, 12, 2, { r: 251, g: 242, b: 54, a: 255 });
  fillRect(tile4Chest, 7, 6, 2, 4, { r: 255, g: 255, b: 255, a: 255 });

  const tileset: Tileset = {
    id: createModelId("tileset_dungeon"),
    name: "Dungeon 16x16 Tileset",
    tileWidth: tw,
    tileHeight: th,
    gridOriginX: 0,
    gridOriginY: 0,
    baseIndex: 0,
    columns: 5,
    tiles: [tile0, tile1Wall, tile2Floor, tile3Corner, tile4Chest],
    userData: { text: "Dungeon tileset with empty tile 0 and 4 tiles" },
  };

  const tmLayer: TilemapLayer = {
    id: createModelId("layer_tm_dungeon"),
    kind: "tilemap",
    name: "Dungeon Tilemap",
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
    tilesetId: tileset.id,
    userData: { text: "4x4 dungeon room with flipped corners", color: "#0284c7" },
  };

  // 4x4 grid using corner flipX/flipY flags on the 4 corners, walls on edges, floor + chest inside
  const mapTiles = new Uint32Array([
    packTileEntry(3, false, false, false),
    packTileEntry(1),
    packTileEntry(1),
    packTileEntry(3, true, false, false),

    packTileEntry(1),
    packTileEntry(2),
    packTileEntry(4),
    packTileEntry(1),

    packTileEntry(1),
    packTileEntry(2),
    packTileEntry(2),
    packTileEntry(1),

    packTileEntry(3, false, true, false),
    packTileEntry(1),
    packTileEntry(1),
    packTileEntry(3, true, true, false),
  ]);

  const cel: Cel = {
    id: createModelId("cel"),
    layerId: tmLayer.id,
    frameIndex: 0,
    x: 0,
    y: 0,
    opacity: 255,
    zIndex: 0,
    image: new PixelImage(width, height, "rgba"),
    tilemapData: {
      width: 4,
      height: 4,
      tiles: mapTiles,
    },
    userData: { text: "" },
  };

  cel.image = renderTilemapCel(
    cel,
    tmLayer,
    [tileset],
    width,
    height,
    DEFAULT_PALETTE_COLORS,
    0
  );

  const sprite: Sprite = {
    id: createModelId("sprite"),
    name: "tilemap_dungeon.ase",
    width,
    height,
    colorMode: "rgba",
    transparentIndex: 0,
    pixelRatio: { w: 1, h: 1 },
    grid: { x: 0, y: 0, width: 16, height: 16, visible: true },
    palettes: [
      {
        id: createModelId("pal"),
        name: "Dungeon Palette",
        fromFrame: 0,
        toFrame: 999,
        colors: DEFAULT_PALETTE_COLORS.map((c) => ({ ...c })),
      },
    ],
    layers: [tmLayer],
    frames: [{ id: createModelId("frame"), index: 0, durationMs: 120 }],
    cels: [cel],
    tags: [],
    slices: [],
    tilesets: [tileset],
    mask: createSprite({ width, height }).mask,
    userData: { text: "Tilemap Dungeon Demo" },
  };

  return new SpriteDocument(sprite);
}

/**
 * Agent 3 Demo 6: Slices & 9-Patch UI (`slices_9patch_ui.ase`, 80x64, 2 frames with 9-patch center, pivot, and animated slice keys).
 */
export function createSlices9PatchDemoDocument(): SpriteDocument {
  const width = 80;
  const height = 64;
  const sprite = createSprite({
    name: "slices_9patch_ui.ase",
    width,
    height,
    colorMode: "rgba",
    background: "transparent",
  });
  const doc = new SpriteDocument(sprite);
  const lid = doc.sprite.layers[0].id;

  doc.transact("Setup Slices & 9-Patch UI", (tx) => {
    tx.setLayerProps(lid, { name: "UI Atlas Widgets" });
    tx.addFrame(0, false);

    // 1. 9-Patch Dialog Frame Slice
    tx.addSlice({
      id: createModelId("slice_panel"),
      name: "panel_9patch",
      color: "#f59e0b",
      keys: [
        {
          frameIndex: 0,
          bounds: { x: 4, y: 6, width: 40, height: 36 },
          center: { x: 6, y: 6, width: 28, height: 24 },
          pivot: { x: 20, y: 18 },
        },
      ],
      userData: { text: "9-slice scalable RPG dialog window" },
    });

    // 2. Animated CTA Button Slice (moves down 2px on pressed Frame 2!)
    tx.addSlice({
      id: createModelId("slice_btn"),
      name: "play_button",
      color: "#22c55e",
      keys: [
        {
          frameIndex: 0,
          bounds: { x: 48, y: 10, width: 28, height: 16 },
          center: { x: 4, y: 4, width: 20, height: 8 },
          pivot: { x: 14, y: 8 },
        },
        {
          frameIndex: 1,
          bounds: { x: 48, y: 12, width: 28, height: 14 },
          center: { x: 4, y: 4, width: 20, height: 6 },
          pivot: { x: 14, y: 7 },
        },
      ],
      userData: { text: "Animated button slice with per-frame keys" },
    });

    // 3. Badge Icon Slice
    tx.addSlice({
      id: createModelId("slice_badge"),
      name: "gem_badge",
      color: "#38bdf8",
      keys: [
        {
          frameIndex: 0,
          bounds: { x: 52, y: 36, width: 20, height: 20 },
          pivot: { x: 10, y: 10 },
        },
      ],
      userData: { text: "HUD Gem Icon" },
    });
  });

  for (let f = 0; f < 2; f++) {
    const cel = doc.sprite.cels.find((c) => c.layerId === lid && c.frameIndex === f)!;
    // Draw 9-patch panel
    fillRect(cel.image, 4, 6, 40, 36, { r: 63, g: 63, b: 116, a: 255 });
    fillRect(cel.image, 6, 8, 36, 32, { r: 34, g: 32, b: 52, a: 255 });
    fillRect(cel.image, 10, 12, 28, 24, { r: 48, g: 96, b: 130, a: 255 });

    // Draw CTA button (shifts on frame 1)
    const btnY = f === 0 ? 10 : 12;
    const btnH = f === 0 ? 16 : 14;
    fillRect(cel.image, 48, btnY, 28, btnH, { r: 55, g: 148, b: 110, a: 255 });
    fillRect(cel.image, 50, btnY + 2, 24, btnH - 4, { r: 106, g: 190, b: 48, a: 255 });

    // Draw Gem badge
    fillRect(cel.image, 54, 38, 16, 16, { r: 217, g: 87, b: 99, a: 255 });
    fillRect(cel.image, 58, 42, 8, 8, { r: 251, g: 242, b: 54, a: 255 });
  }

  return doc;
}

/**
 * Agent 4 Demo 1: Selection Playground (`selection_playground.ase`, 64x64)
 * Contains distinct color islands, geometric stars, an active selection mask, and 2 named saved selections.
 */
export function createSelectionPlaygroundDemoDocument(): SpriteDocument {
  const sprite = createSprite({
    name: "selection_playground.ase",
    width: 64,
    height: 64,
    colorMode: "rgba",
    background: "transparent",
  });
  const cel = sprite.cels[0];

  // Top-left ruby shield
  fillRect(cel.image, 6, 6, 20, 20, { r: 217, g: 87, b: 99, a: 255 });
  fillRect(cel.image, 9, 9, 14, 14, { r: 172, g: 50, b: 50, a: 255 });
  fillRect(cel.image, 13, 13, 6, 6, { r: 251, g: 242, b: 54, a: 255 });

  // Top-right sapphire orb
  for (let y = 6; y <= 26; y++) {
    for (let x = 36; x <= 56; x++) {
      if (Math.hypot(x - 46, y - 16) <= 10) {
        cel.image.setRGBA(x, y, { r: 99, g: 155, b: 255, a: 255 });
      }
      if (Math.hypot(x - 43, y - 13) <= 4) {
        cel.image.setRGBA(x, y, { r: 203, g: 219, b: 252, a: 255 });
      }
    }
  }

  // Bottom-left emerald diamond
  for (let dy = -10; dy <= 10; dy++) {
    const span = 10 - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      cel.image.setRGBA(16 + dx, 46 + dy, { r: 106, g: 190, b: 48, a: 255 });
    }
  }

  // Bottom-right gold chest
  fillRect(cel.image, 36, 36, 22, 18, { r: 143, g: 86, b: 59, a: 255 });
  fillRect(cel.image, 36, 42, 22, 3, { r: 251, g: 242, b: 54, a: 255 });
  fillRect(cel.image, 45, 40, 4, 7, { r: 251, g: 242, b: 54, a: 255 });

  // Pre-select the ruby shield and store 2 named selections
  sprite.mask.selectRect({ x: 6, y: 6, width: 20, height: 20 });

  const orbMask = new Mask(64, 64);
  orbMask.selectRect({ x: 36, y: 6, width: 21, height: 21 });
  const chestMask = new Mask(64, 64);
  chestMask.selectRect({ x: 36, y: 36, width: 22, height: 18 });

  sprite.savedMasks = [
    encodeSavedMask(orbMask, "Sapphire Orb"),
    encodeSavedMask(chestMask, "Gold Chest"),
  ];

  return new SpriteDocument(sprite);
}

/**
 * Agent 4 Demo 2: Transform Lab — RotSprite vs Nearest (`transform_rotsprite_lab.ase`, 96x48)
 * Side-by-side comparison of an original pixel-art sword, Fast Nearest-Neighbor 33° rotation,
 * and clean RotSprite 33° rotation.
 */
export function createTransformRotSpriteDemoDocument(): SpriteDocument {
  const sprite = createSprite({
    name: "transform_rotsprite_lab.ase",
    width: 96,
    height: 48,
    colorMode: "rgba",
    background: "transparent",
  });

  // Build a crisp 32x32 pixel-art sword stamp
  const sword = new PixelImage(32, 32, "rgba");
  const outline: RGBA = { r: 34, g: 32, b: 52, a: 255 };
  const blade: RGBA = { r: 203, g: 219, b: 252, a: 255 };
  const edge: RGBA = { r: 255, g: 255, b: 255, a: 255 };
  const hilt: RGBA = { r: 251, g: 242, b: 54, a: 255 };
  const grip: RGBA = { r: 172, g: 50, b: 50, a: 255 };

  // Vertical sword centered at x=15..16
  fillRect(sword, 14, 4, 4, 18, outline);
  fillRect(sword, 15, 5, 2, 16, blade);
  fillRect(sword, 15, 5, 1, 16, edge);
  fillRect(sword, 10, 21, 12, 3, hilt);
  fillRect(sword, 15, 24, 2, 5, grip);
  fillRect(sword, 14, 29, 4, 2, hilt);

  const fastRot = rotateImageFast(sword, 33);
  const cleanRot = rotSpriteRotate(sword, 33);

  const cel = sprite.cels[0];
  // Column 1 (x=0..31): Original 0°
  cel.image.blit(sword, 0, 8);
  // Column 2 (x=32..63): Fast Nearest-Neighbor 33°
  cel.image.blit(fastRot, 32, 8);
  // Column 3 (x=64..95): RotSprite 33°
  cel.image.blit(cleanRot, 64, 8);

  sprite.mask.selectRect({ x: 64, y: 8, width: 32, height: 32 });
  return new SpriteDocument(sprite);
}

/**
 * Agent 4 Demo 3: Palette Remap & Per-Frame Palettes (`palette_remap_lab.ase`, 48x48, Indexed Mode, 2 Frames)
 * Demonstrates an Indexed-mode sprite with per-frame palette spans (Frame 1 = Daylight Palette, Frame 2 = Sunset/Night Palette).
 */
export function createPaletteRemapDemoDocument(): SpriteDocument {
  const sprite = createSprite({
    name: "palette_remap_lab.ase",
    width: 48,
    height: 48,
    colorMode: "indexed",
    background: "transparent",
  });

  const dayColors: RGBA[] = [
    { r: 0, g: 0, b: 0, a: 255 }, // 0 transparent
    { r: 99, g: 155, b: 255, a: 255 }, // 1 sky
    { r: 251, g: 242, b: 54, a: 255 }, // 2 sun/moon
    { r: 55, g: 148, b: 110, a: 255 }, // 3 distant hill
    { r: 106, g: 190, b: 48, a: 255 }, // 4 foreground grass
    { r: 217, g: 87, b: 99, a: 255 }, // 5 roof
    { r: 238, g: 195, b: 154, a: 255 }, // 6 cottage wall
    { r: 34, g: 32, b: 52, a: 255 }, // 7 outline
  ];

  const nightColors: RGBA[] = [
    { r: 0, g: 0, b: 0, a: 255 }, // 0 transparent
    { r: 34, g: 32, b: 52, a: 255 }, // 1 night sky
    { r: 203, g: 219, b: 252, a: 255 }, // 2 pale moon
    { r: 63, g: 63, b: 116, a: 255 }, // 3 indigo hill
    { r: 48, g: 96, b: 130, a: 255 }, // 4 night grass
    { r: 118, g: 66, b: 138, a: 255 }, // 5 violet roof
    { r: 132, g: 126, b: 135, a: 255 }, // 6 shadowed wall
    { r: 15, g: 15, b: 25, a: 255 }, // 7 dark outline
  ];

  sprite.palettes = [
    {
      id: createModelId("pal_day"),
      name: "Daylight Span (F1)",
      fromFrame: 0,
      toFrame: 0,
      colors: dayColors,
    },
    {
      id: createModelId("pal_night"),
      name: "Night Span (F2)",
      fromFrame: 1,
      toFrame: 99,
      colors: nightColors,
    },
  ];

  const drawIndexedLandscape = (img: PixelImage) => {
    for (let y = 2; y < 46; y++) {
      for (let x = 2; x < 46; x++) {
        img.putPixel(x, y, 1); // sky
      }
    }
    // Sun/Moon circle
    for (let y = 6; y <= 16; y++) {
      for (let x = 30; x <= 40; x++) {
        if (Math.hypot(x - 35, y - 11) <= 4.5) img.putPixel(x, y, 2);
      }
    }
    // Hills & Grass
    for (let y = 26; y < 36; y++) {
      for (let x = 2; x < 46; x++) img.putPixel(x, y, 3);
    }
    for (let y = 36; y < 46; y++) {
      for (let x = 2; x < 46; x++) img.putPixel(x, y, 4);
    }
    // Cottage
    for (let y = 22; y < 28; y++) {
      for (let x = 10; x < 26; x++) img.putPixel(x, y, 5);
    }
    for (let y = 28; y < 38; y++) {
      for (let x = 12; x < 24; x++) img.putPixel(x, y, 6);
    }
  };

  drawIndexedLandscape(sprite.cels[0].image);
  const doc = new SpriteDocument(sprite);
  doc.transact("Add Frame 2 for Night Palette", (tx) => {
    tx.addFrame(0, true);
  });
  return doc;
}

/**
 * Agent 4 Demo 4: Indexed Conversion Dither Compare (`indexed_dither_compare.ase`, 64x48, 4 Frames)
 * Compares Frame 1 (Original RGBA Gradient Sphere), Frame 2 (Bayer 4x4 Indexed),
 * Frame 3 (Floyd-Steinberg Indexed), and Frame 4 (Old-Style Checker Indexed).
 */
export function createIndexedConversionDemoDocument(): SpriteDocument {
  const sprite = createSprite({
    name: "indexed_dither_compare.ase",
    width: 64,
    height: 48,
    colorMode: "rgba",
    background: "transparent",
  });

  const baseImg = sprite.cels[0].image;
  for (let y = 4; y < 44; y++) {
    for (let x = 4; x < 60; x++) {
      const tx = (x - 4) / 56;
      const ty = (y - 4) / 40;
      baseImg.setRGBA(x, y, {
        r: Math.round(30 + tx * 215),
        g: Math.round(45 + ty * 185),
        b: Math.round(220 - tx * 160),
        a: 255,
      });
    }
  }

  const pal = sprite.palettes[0].colors;
  const bayerIdx = convertImageColorMode(baseImg, "indexed", pal, 0, "bayer4x4");
  const floydIdx = convertImageColorMode(baseImg, "indexed", pal, 0, "floyd_steinberg");
  const oldIdx = convertImageColorMode(baseImg, "indexed", pal, 0, "old_style");

  const bayerRgba = convertImageColorMode(bayerIdx, "rgba", pal, 0);
  const floydRgba = convertImageColorMode(floydIdx, "rgba", pal, 0);
  const oldRgba = convertImageColorMode(oldIdx, "rgba", pal, 0);

  const doc = new SpriteDocument(sprite);
  const lid = doc.sprite.layers[0].id;
  doc.transact("Build Dither Comparison Frames", (tx) => {
    tx.addFrame(0, false);
    tx.addFrame(1, false);
    tx.addFrame(2, false);
  });

  const c1 = doc.sprite.cels.find((c) => c.layerId === lid && c.frameIndex === 1)!;
  const c2 = doc.sprite.cels.find((c) => c.layerId === lid && c.frameIndex === 2)!;
  const c3 = doc.sprite.cels.find((c) => c.layerId === lid && c.frameIndex === 3)!;
  c1.image.data.set(bayerRgba.data);
  c2.image.data.set(floydRgba.data);
  c3.image.data.set(oldRgba.data);

  doc.transact("Add Dither Comparison Tags", (tx) => {
    tx.addTag({ id: createModelId("tag"), name: "rgba_orig", fromFrame: 0, toFrame: 0, direction: "forward", color: "#38bdf8", repeat: 0, userData: { text: "" } });
    tx.addTag({ id: createModelId("tag"), name: "bayer4x4", fromFrame: 1, toFrame: 1, direction: "forward", color: "#22c55e", repeat: 0, userData: { text: "" } });
    tx.addTag({ id: createModelId("tag"), name: "floyd_steinberg", fromFrame: 2, toFrame: 2, direction: "forward", color: "#f59e0b", repeat: 0, userData: { text: "" } });
    tx.addTag({ id: createModelId("tag"), name: "old_style", fromFrame: 3, toFrame: 3, direction: "forward", color: "#e879f9", repeat: 0, userData: { text: "" } });
  });

  return doc;
}

/**
 * Agent 4 Demo 5: Filters Gallery (`filters_gallery.ase`, 48x48, 8 Frames)
 * Each frame shows a different Agent-4 filter applied to a pixel-art character crest.
 */
export function createFiltersGalleryDemoDocument(): SpriteDocument {
  const sprite = createSprite({
    name: "filters_gallery.ase",
    width: 48,
    height: 48,
    colorMode: "rgba",
    background: "transparent",
  });

  const src = sprite.cels[0].image;
  fillRect(src, 14, 10, 20, 24, { r: 91, g: 110, b: 225, a: 255 });
  fillRect(src, 17, 14, 14, 10, { r: 238, g: 195, b: 154, a: 255 });
  fillRect(src, 19, 17, 3, 3, { r: 34, g: 32, b: 52, a: 255 });
  fillRect(src, 26, 17, 3, 3, { r: 34, g: 32, b: 52, a: 255 });
  fillRect(src, 18, 28, 12, 8, { r: 217, g: 87, b: 99, a: 255 });

  const f1Outline = applyOutlineFilter(src, {
    outlineColor: { r: 251, g: 242, b: 54, a: 255 },
    place: "outside",
    pattern: "circle",
  });
  const f2Shadow = applyDropShadowFilter(src, {
    offsetX: 3,
    offsetY: 3,
    shadowColor: { r: 20, g: 18, b: 32, a: 200 },
  });
  const f3Hue = applyHueSaturationFilter(src, {
    hueShift: 120,
    saturationShift: 20,
    lightnessShift: 0,
  });
  const f4Invert = applyInvertFilter(src);
  const f5Bright = applyBrightnessContrastFilter(src, 25, 45);
  const embossPreset = CONVOLUTION_PRESETS.find((p) => p.id === "emboss")!;
  const f6Emboss = applyConvolutionMatrixFilter(src, {
    size: 3,
    kernel: embossPreset.kernel,
    divisor: embossPreset.divisor,
    bias: embossPreset.bias,
  });
  const f7Poster = applyPosterizeFilter(src, 3);

  const doc = new SpriteDocument(sprite);
  const lid = doc.sprite.layers[0].id;
  const framesData = [f1Outline, f2Shadow, f3Hue, f4Invert, f5Bright, f6Emboss, f7Poster];
  for (let i = 0; i < framesData.length; i++) {
    doc.transact(`Add Filter Frame ${i + 2}`, (tx) => {
      tx.addFrame(i, false);
    });
    const cel = doc.sprite.cels.find((c) => c.layerId === lid && c.frameIndex === i + 1)!;
    cel.image.data.set(framesData[i].data);
  }

  return doc;
}
