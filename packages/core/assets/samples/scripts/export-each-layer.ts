/// <reference path="../../../src/scripting/kekenik.d.ts" />
/**
 * Sample Script 1: Export Every Visible Layer as PNG Metadata / Manifest
 * Iterates through all visible layers, writes exported layer descriptors to virtual FS,
 * and records the exported layer count in sprite.userData.
 */
app.transaction("Export Visible Layers", () => {
  const sprite = app.activeSprite;
  if (!sprite) return;
  const exported: string[] = [];
  for (const layer of sprite.layers) {
    if (layer.visible) {
      const fileName = `exports/${layer.name.toLowerCase().replace(/\s+/g, "_")}.png.json`;
      const cel = layer.cels[0];
      const width = cel ? cel.image.width : sprite.width;
      const height = cel ? cel.image.height : sprite.height;
      app.fs.writeText(
        fileName,
        app.json.encode({
          layer: layer.name,
          width,
          height,
          format: "png",
        })
      );
      exported.push(fileName);
    }
  }
  sprite.userData = {
    text: `exported_layers:${exported.length}`,
    color: "#22c55e",
  };
  console.log(`Exported ${exported.length} visible layers: ${exported.join(", ")}`);
});

export {};
