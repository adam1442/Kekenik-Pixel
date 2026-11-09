/// <reference path="../../../src/scripting/kekenik.d.ts" />
/**
 * Sample Script 4: Random Noise Brush in Selection
 * Fills the active selection bounds (or the whole cel if no selection) with deterministic pseudo-random pixel noise.
 */
app.transaction("Random Noise Brush", () => {
  const sprite = app.activeSprite;
  const cel = app.activeCel;
  if (!sprite || !cel) return;

  const img = cel.image;
  const bounds = sprite.selection.bounds ?? {
    x: 0,
    y: 0,
    width: img.width,
    height: img.height,
  };

  let seed = 1337;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed & 0xff;
  };

  for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      if ((x + y) % 2 === 0) {
        img.setPixel(x, y, {
          r: nextRand(),
          g: nextRand(),
          b: nextRand(),
          a: 255,
        });
      }
    }
  }
  console.log(`Painted noise pattern in region (${bounds.width}x${bounds.height}).`);
});

export {};
