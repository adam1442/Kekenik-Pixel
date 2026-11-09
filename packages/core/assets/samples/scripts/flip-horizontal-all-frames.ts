/// <reference path="../../../src/scripting/kekenik.d.ts" />
/**
 * Sample Script 6: Flip Horizontal All Frames
 * Horizontally mirrors the pixels of every cel on the active layer across all frames.
 */
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
  console.log(`Flipped ${layer.cels.length} cels horizontally.`);
});

export {};
