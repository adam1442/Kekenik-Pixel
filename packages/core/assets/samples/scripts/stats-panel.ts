/// <reference path="../../../src/scripting/kekenik.d.ts" />
/**
 * Sample Script 11: Stats Panel Dialog
 * Computes non-empty pixel count, unique color count, and layer count, and opens a custom script dialog.
 */
app.transaction("Sprite Stats Dialog", () => {
  const sprite = app.activeSprite;
  const cel = app.activeCel;
  if (!sprite || !cel) return;

  const img = cel.image;
  let opaquePixels = 0;
  const uniqueColors = new Set<string>();

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const c = img.getPixel(x, y);
      if (c.a > 0) {
        opaquePixels++;
        uniqueColors.add(`${c.r},${c.g},${c.b},${c.a}`);
      }
    }
  }

  sprite.userData = {
    text: `stats:pixels=${opaquePixels},colors=${uniqueColors.size},layers=${sprite.layers.length}`,
    color: "#38bdf8",
  };

  app.dialog((dlg) => {
    dlg
      .title("Sprite Statistics")
      .label(`Sprite: ${sprite.name} (${sprite.width}x${sprite.height})`)
      .label(`Opaque Pixels in Active Cel: ${opaquePixels}`)
      .label(`Unique Colors in Active Cel: ${uniqueColors.size}`)
      .label(`Total Layers: ${sprite.layers.length}`)
      .button({ id: "ok", text: "Close" });
  });

  console.log(
    `Stats -> Opaque Pixels: ${opaquePixels}, Unique Colors: ${uniqueColors.size}, Layers: ${sprite.layers.length}`
  );
});

export {};
