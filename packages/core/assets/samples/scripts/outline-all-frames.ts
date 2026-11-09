/// <reference path="../../../src/scripting/kekenik.d.ts" />
/**
 * Sample Script 3: Outline All Frames
 * Adds a 1px dark outline around every opaque pixel on every cel of the active layer.
 */
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
  console.log(`Outlined ${layer.cels.length} frame cels on layer "${layer.name}".`);
});

export {};
