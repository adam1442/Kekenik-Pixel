/// <reference path="../../../src/scripting/kekenik.d.ts" />
/**
 * Sample Script 2: Build Palette from Unique Colors in Active Cel
 * Scans the active cel's pixels and updates the sprite palette with all unique colors found.
 */
app.transaction("Palette from Image", () => {
  const sprite = app.activeSprite;
  const cel = app.activeCel;
  if (!sprite || !cel) return;

  const img = cel.image;
  const seen = new Set<string>();
  const uniqueColors: Array<{ r: number; g: number; b: number; a: number }> = [
    { r: 0, g: 0, b: 0, a: 0 },
  ];

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = img.getPixel(x, y);
      if (c.a > 0) {
        const key = `${c.r},${c.g},${c.b},${c.a}`;
        if (!seen.has(key) && uniqueColors.length < 64) {
          seen.add(key);
          uniqueColors.push(c);
        }
      }
    }
  }

  sprite.palette.resize(Math.max(2, uniqueColors.length));
  for (let i = 0; i < uniqueColors.length; i++) {
    sprite.palette.setColor(i, uniqueColors[i]);
  }
  console.log(`Extracted ${uniqueColors.length} unique colors into palette.`);
});

export {};
