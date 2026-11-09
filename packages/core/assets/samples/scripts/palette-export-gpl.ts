/// <reference path="../../../src/scripting/kekenik.d.ts" />
/**
 * Sample Script 8: Export Palette to GIMP .gpl
 * Exports the active sprite's palette to a GIMP .gpl file in virtual storage and logs the result.
 */
app.transaction("Export Palette to GPL", () => {
  const sprite = app.activeSprite;
  if (!sprite) return;
  const gplText = sprite.palette.save("exports/active-palette.gpl");
  sprite.userData = {
    text: `gpl_exported:${sprite.palette.size}`,
    color: "#f59e0b",
  };
  console.log(`Saved GIMP .gpl palette (${sprite.palette.size} colors, ${gplText.length} bytes).`);
});

export {};
