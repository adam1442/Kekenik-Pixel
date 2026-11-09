/// <reference path="../../../src/scripting/kekenik.d.ts" />
/**
 * Sample Script 5: Batch Rename Layers with Prefix
 * Renames every layer in the active sprite with a numbered "spr_" prefix.
 */
app.transaction("Batch Rename Layers", () => {
  const sprite = app.activeSprite;
  if (!sprite) return;
  let index = 1;
  for (const layer of sprite.layers) {
    if (!layer.name.startsWith("spr_")) {
      layer.name = `spr_${String(index).padStart(2, "0")}_${layer.name}`;
    }
    index++;
  }
  console.log(`Renamed ${sprite.layers.length} layers with 'spr_' prefix.`);
});

export {};
