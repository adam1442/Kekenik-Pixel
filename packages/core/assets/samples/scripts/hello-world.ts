/// <reference path="../../../src/scripting/kekenik.d.ts" />
/**
 * Sample Script 12: Hello World (Comment-Per-Line Tutorial)
 * Minimal example with a line-by-line explanation of the Kekenik Pixel Scripting API.
 */
// 1. Start an atomic undoable transaction so Ctrl+Z can revert all changes in one step:
app.transaction("Hello World Pixel Art", () => {
  // 2. Access the currently active cel (intersection of active layer and active frame):
  const cel = app.activeCel;
  // 3. Guard against running when no cel is selected:
  if (!cel) return;
  // 4. Create a bright red RGBA color using the global Color helper:
  const red = Color.rgba(255, 0, 0, 255);
  // 5. Set the top-left pixel (0, 0) to red:
  cel.image.setPixel(0, 0, red);
  // 6. Draw a small 4x4 gold border starting at (2, 2):
  cel.image.drawRect(2, 2, 4, 4, Color.fromHex("#facc15"));
  // 7. Print a friendly confirmation message to the Script Editor console:
  console.log("Hello from Kekenik Pixel Scripting Engine! Pixel (0,0) is now red.");
});

export {};
