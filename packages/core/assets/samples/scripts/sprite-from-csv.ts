/// <reference path="../../../src/scripting/kekenik.d.ts" />
/**
 * Sample Script 9: Sprite from CSV of Pixels
 * Parses a CSV matrix of palette/hex codes and stamps the resulting pixel art onto the active cel.
 */
app.transaction("Sprite from CSV", () => {
  const cel = app.activeCel;
  if (!cel) return;

  const csv = [
    "0,1,1,1,1,0",
    "1,2,1,1,2,1",
    "1,1,1,1,1,1",
    "1,3,1,1,3,1",
    "0,1,3,3,1,0",
    "0,0,1,1,0,0",
  ].join("\n");

  const paletteMap: Record<string, { r: number; g: number; b: number; a: number }> = {
    "0": { r: 0, g: 0, b: 0, a: 0 },
    "1": { r: 250, g: 204, b: 21, a: 255 },
    "2": { r: 24, g: 24, b: 27, a: 255 },
    "3": { r: 239, g: 68, b: 68, a: 255 },
  };

  const rows = csv.trim().split("\n");
  for (let y = 0; y < rows.length; y++) {
    const cols = rows[y].split(",");
    for (let x = 0; x < cols.length; x++) {
      const code = cols[x].trim();
      const col = paletteMap[code];
      if (col && col.a > 0) {
        cel.image.setPixel(x, y, col);
      }
    }
  }
  console.log(`Built ${rows[0].split(",").length}x${rows.length} pixel art from CSV matrix.`);
});

export {};
