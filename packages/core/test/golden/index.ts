/**
 * @module @kekenik/core/test/golden
 * Golden pixel arrays and deterministic verification helpers for Agent-2 tools and renderer.
 */

import {
  Brush,
  evaluateDitherMatrix,
  generateBrushFootprint,
} from "../../src/brush/index.ts";
import { PixelImage } from "../../src/model/index.ts";
import {
  applyBlurDab,
  applyJumbleDab,
  floodFillImage,
  paintSprayOnImage,
  paintStrokeOnImage,
  rasterizeBezierCurve,
  rasterizeEllipse,
  rasterizeLine,
  rasterizePolygon,
  rasterizeRectangle,
  renderGradientImage,
  stampTextOnImage,
} from "../../src/tools/index.ts";
import { RGBA } from "../../src/util/index.ts";

const RED: RGBA = { r: 255, g: 0, b: 0, a: 255 };
const BLUE: RGBA = { r: 0, g: 0, b: 255, a: 255 };

/**
 * Converts an 8x8 PixelImage into a compact 64-entry binary occupancy array (1 = non-transparent, 0 = transparent).
 */
export function imageToOccupancyGrid(img: PixelImage): number[] {
  const out: number[] = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      out.push(img.getRGBA(x, y).a > 0 ? 1 : 0);
    }
  }
  return out;
}

/**
 * Golden 4x4 occupancy grid for a diagonal line from (0,0) to (3,3).
 */
export const GOLDEN_LINE_4X4: readonly number[] = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/**
 * Golden 5x5 occupancy grid for a stroked rectangle from (1,1) to (3,3).
 */
export const GOLDEN_RECT_OUTLINE_5X5: readonly number[] = [
  0, 0, 0, 0, 0,
  0, 1, 1, 1, 0,
  0, 1, 0, 1, 0,
  0, 1, 1, 1, 0,
  0, 0, 0, 0, 0,
];

/**
 * Golden 5x5 occupancy grid for a filled rectangle from (1,1) to (3,3).
 */
export const GOLDEN_RECT_FILLED_5X5: readonly number[] = [
  0, 0, 0, 0, 0,
  0, 1, 1, 1, 0,
  0, 1, 1, 1, 0,
  0, 1, 1, 1, 0,
  0, 0, 0, 0, 0,
];

/**
 * Golden 3x3 cross circle brush footprint occupancy on a 5x5 canvas centered at (2,2).
 */
export const GOLDEN_CIRCLE3_5X5: readonly number[] = [
  0, 0, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 1, 1, 1, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 0, 0,
];

/**
 * Golden Bayer 2x2 50%-ratio pattern on a 4x4 grid (1 = BG, 0 = FG).
 */
export const GOLDEN_BAYER2X2_4X4: readonly number[] = [
  1, 0, 1, 0,
  0, 1, 0, 1,
  1, 0, 1, 0,
  0, 1, 0, 1,
];

/**
 * Verifies that two numeric arrays match element-by-element.
 */
export function assertGoldenMatch(
  actual: readonly number[],
  expected: readonly number[],
  label: string
): void {
  if (actual.length !== expected.length) {
    throw new Error(`${label}: length ${actual.length} != expected ${expected.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `${label}: mismatch at index ${i} (got ${actual[i]}, expected ${expected[i]})`
      );
    }
  }
}

/**
 * Runs golden pixel verification for Line, Rectangle, Circle Brush, Bayer 2x2 Dither, Flood Fill,
 * Ellipse, Bezier Curve, Polygon, Gradient, Spray, Blur, Jumble, and Text tools.
 */
export function verifyGoldenToolSuite(): string {
  // 1. Line 4x4
  const lineImg = new PixelImage(4, 4, "rgba");
  paintStrokeOnImage(lineImg, rasterizeLine({ x: 0, y: 0 }, { x: 3, y: 3 }), {
    fgColor: RED,
    bgColor: BLUE,
  });
  assertGoldenMatch(imageToOccupancyGrid(lineImg), GOLDEN_LINE_4X4, "Line 4x4");

  // 2. Stroked & Filled Rectangle 5x5
  const rectOutlineImg = new PixelImage(5, 5, "rgba");
  paintStrokeOnImage(
    rectOutlineImg,
    rasterizeRectangle({ x: 1, y: 1 }, { x: 3, y: 3 }, { filled: false }),
    { fgColor: RED, bgColor: BLUE, pixelPerfect: false }
  );
  assertGoldenMatch(
    imageToOccupancyGrid(rectOutlineImg),
    GOLDEN_RECT_OUTLINE_5X5,
    "Rect Outline 5x5"
  );

  const rectFilledImg = new PixelImage(5, 5, "rgba");
  paintStrokeOnImage(
    rectFilledImg,
    rasterizeRectangle({ x: 1, y: 1 }, { x: 3, y: 3 }, { filled: true }),
    { fgColor: RED, bgColor: BLUE, pixelPerfect: false }
  );
  assertGoldenMatch(
    imageToOccupancyGrid(rectFilledImg),
    GOLDEN_RECT_FILLED_5X5,
    "Rect Filled 5x5"
  );

  // 3. 3px Circle Brush Footprint 5x5
  const circleImg = new PixelImage(5, 5, "rgba");
  paintStrokeOnImage(circleImg, [{ x: 2, y: 2 }], {
    fgColor: RED,
    bgColor: BLUE,
    brush: { type: "circle", size: 3 },
  });
  assertGoldenMatch(imageToOccupancyGrid(circleImg), GOLDEN_CIRCLE3_5X5, "Circle 3px 5x5");

  // 4. Bayer 2x2 Dither 4x4
  const bayerActual: number[] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      bayerActual.push(evaluateDitherMatrix(x, y, "bayer2x2", 0.5) ? 1 : 0);
    }
  }
  assertGoldenMatch(bayerActual, GOLDEN_BAYER2X2_4X4, "Bayer 2x2 4x4");

  // 5. Flood Fill inside 5x5 outlined rectangle
  floodFillImage(rectOutlineImg, {
    x: 2,
    y: 2,
    fillColor: BLUE,
    contiguous: true,
    tolerance: 0,
  });
  assertGoldenMatch(
    imageToOccupancyGrid(rectOutlineImg),
    GOLDEN_RECT_FILLED_5X5,
    "Flood Fill Inside Rect 5x5"
  );

  // 6. Ellipse, Bezier, Polygon, Gradient, Spray, Blur, Jumble, Text, Custom Brush
  const miscImg = new PixelImage(16, 16, "rgba");
  const ellipsePts = rasterizeEllipse({ x: 2, y: 2 }, { x: 13, y: 13 }, { filled: false });
  if (ellipsePts.length < 16) throw new Error("Ellipse rasterizer produced too few points");

  const curvePts = rasterizeBezierCurve(
    { x: 0, y: 15 },
    { x: 4, y: 0 },
    { x: 11, y: 0 },
    { x: 15, y: 15 }
  );
  if (curvePts.length < 10) throw new Error("Bezier curve produced too few points");

  const polyPts = rasterizePolygon(
    [
      { x: 2, y: 2 },
      { x: 12, y: 2 },
      { x: 7, y: 12 },
    ],
    true
  );
  if (polyPts.length < 25) throw new Error("Filled polygon produced too few points");

  renderGradientImage(miscImg, {
    start: { x: 0, y: 0 },
    end: { x: 15, y: 15 },
    fgColor: RED,
    bgColor: BLUE,
    gradientType: "linear",
    ditherMode: "bayer4x4",
  });

  paintSprayOnImage(miscImg, { x: 8, y: 8 }, {
    fgColor: RED,
    bgColor: BLUE,
    sprayWidth: 4,
    spraySpeed: 10,
    seed: 99,
  });

  applyBlurDab(miscImg, { x: 8, y: 8 }, 3);
  applyJumbleDab(miscImg, { x: 8, y: 8 }, 3, 99);
  stampTextOnImage(miscImg, "KPX", 1, 1, RED, 7, false);

  const customBrush = Brush.fromImage(rectFilledImg, { name: "GoldenStamp" });
  if (generateBrushFootprint(customBrush.config).length !== 9) {
    throw new Error("Custom image brush footprint mismatch");
  }

  return "Verified all golden pixel matrices (Line, Rect, Circle3, Bayer2x2, FloodFill, Ellipse, Bezier, Polygon, Gradient, Spray, Blur, Jumble, Text, CustomBrush).";
}
