/// <reference path="../../../src/scripting/kekenik.d.ts" />
/**
 * Sample Script 7: Grid Overlay Demo
 * Draws an 8x8 pixel guide grid onto a new or active cel.
 */
app.transaction("Grid Overlay Demo", () => {
  const cel = app.activeCel;
  if (!cel) return;
  const img = cel.image;
  const gridColor = { r: 72, g: 187, b: 255, a: 180 };

  for (let x = 0; x < img.width; x += 8) {
    img.drawLine(x, 0, x, img.height - 1, gridColor);
  }
  for (let y = 0; y < img.height; y += 8) {
    img.drawLine(0, y, img.width - 1, y, gridColor);
  }
  console.log(`Drew 8x8 grid overlay across ${img.width}x${img.height} cel.`);
});

export {};
