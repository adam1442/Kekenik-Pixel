/// <reference path="../../../src/scripting/kekenik.d.ts" />
/**
 * Sample Script 10: Stamp Brush Along a Sine / Diagonal Path
 * Stamps a 3x3 cross brush along a path across the active cel.
 */
app.transaction("Stamp Brush Path", () => {
  const cel = app.activeCel;
  if (!cel) return;
  const img = cel.image;
  const fg = app.fgColor;

  const steps = Math.min(img.width, img.height);
  for (let i = 1; i < steps - 1; i += 2) {
    const cx = i;
    const cy = i;
    img.setPixel(cx, cy, fg);
    img.setPixel(cx - 1, cy, fg);
    img.setPixel(cx + 1, cy, fg);
    img.setPixel(cx, cy - 1, fg);
    img.setPixel(cx, cy + 1, fg);
  }
  console.log(`Stamped 3x3 cross brush along diagonal path (${steps}px).`);
});

export {};
