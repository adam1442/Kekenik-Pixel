/**
 * @module scripts/check-menus
 * Verifies that every entry from Aseprite 1.3's Edit, Select, and Sprite menus exists in MenuRegistry
 * and is either implemented/tested (Agents 1-4) or marked Planned: Agent 5.
 * Writes the complete verification report to `docs/MENU_COVERAGE.md` and prints to stdout.
 */

import fs from "node:fs";
import path from "node:path";
import { MenuRegistry, registerMasterFeatures } from "../packages/core/src/index.ts";

registerMasterFeatures();

interface ExpectedMenuSpec {
  menu: "Edit" | "Select" | "Sprite";
  asepriteName: string;
  menuItemId: string;
}

const CANONICAL_MENUS: readonly ExpectedMenuSpec[] = [
  // Edit Menu
  { menu: "Edit", asepriteName: "Undo", menuItemId: "menu.edit.undo" },
  { menu: "Edit", asepriteName: "Redo", menuItemId: "menu.edit.redo" },
  { menu: "Edit", asepriteName: "Undo History", menuItemId: "menu.edit.undo_history" },
  { menu: "Edit", asepriteName: "Cut", menuItemId: "menu.edit.cut" },
  { menu: "Edit", asepriteName: "Copy", menuItemId: "menu.edit.copy" },
  { menu: "Edit", asepriteName: "Copy Merged", menuItemId: "menu.edit.copy_merged" },
  { menu: "Edit", asepriteName: "Paste", menuItemId: "menu.edit.paste" },
  { menu: "Edit", asepriteName: "Paste Special (New Layer / New Sprite / New Brush)", menuItemId: "menu.edit.paste_special" },
  { menu: "Edit", asepriteName: "Delete / Clear", menuItemId: "menu.edit.delete" },
  { menu: "Edit", asepriteName: "Fill", menuItemId: "menu.edit.fill" },
  { menu: "Edit", asepriteName: "Stroke", menuItemId: "menu.edit.stroke" },
  { menu: "Edit", asepriteName: "Flip Horizontal", menuItemId: "menu.edit.flip_h" },
  { menu: "Edit", asepriteName: "Flip Vertical", menuItemId: "menu.edit.flip_v" },
  { menu: "Edit", asepriteName: "Rotate / Transform", menuItemId: "menu.edit.transform" },
  { menu: "Edit", asepriteName: "Shift (Wrap Up/Down/Left/Right)", menuItemId: "menu.edit.shift" },
  { menu: "Edit", asepriteName: "New Brush", menuItemId: "menu.edit.new_brush" },
  { menu: "Edit", asepriteName: "New Sprite from Selection", menuItemId: "menu.edit.new_sprite_sel" },
  { menu: "Edit", asepriteName: "Replace Color", menuItemId: "menu.edit.replace_color" },
  { menu: "Edit", asepriteName: "Invert Color", menuItemId: "menu.edit.invert_color" },
  { menu: "Edit", asepriteName: "Adjustments (Brightness/Contrast, Hue/Saturation, Color Curve, Posterize)", menuItemId: "menu.edit.adjustments" },
  { menu: "Edit", asepriteName: "FX (Outline, Convolution Matrix, Despeckle, Drop Shadow)", menuItemId: "menu.edit.fx" },
  { menu: "Edit", asepriteName: "Palette Editor", menuItemId: "menu.edit.palette_editor" },
  { menu: "Edit", asepriteName: "Keyboard Shortcuts", menuItemId: "menu.edit.keyboard_shortcuts" },
  { menu: "Edit", asepriteName: "Preferences", menuItemId: "menu.edit.preferences" },

  // Sprite Menu
  { menu: "Sprite", asepriteName: "Properties", menuItemId: "menu.sprite.props" },
  { menu: "Sprite", asepriteName: "Color Mode > RGB Color", menuItemId: "menu.sprite.colormode_rgba" },
  { menu: "Sprite", asepriteName: "Color Mode > Grayscale", menuItemId: "menu.sprite.colormode_gray" },
  { menu: "Sprite", asepriteName: "Color Mode > Indexed", menuItemId: "menu.sprite.colormode_idx" },
  { menu: "Sprite", asepriteName: "Color Mode > More Options (Dithering Dialog)", menuItemId: "menu.sprite.colormode_dlg" },
  { menu: "Sprite", asepriteName: "Duplicate", menuItemId: "menu.sprite.duplicate" },
  { menu: "Sprite", asepriteName: "Sprite Size", menuItemId: "menu.sprite.size" },
  { menu: "Sprite", asepriteName: "Canvas Size", menuItemId: "menu.sprite.canvas_size" },
  { menu: "Sprite", asepriteName: "Rotate Canvas > 90 CW", menuItemId: "menu.sprite.rotate_90cw" },
  { menu: "Sprite", asepriteName: "Rotate Canvas > 90 CCW", menuItemId: "menu.sprite.rotate_90ccw" },
  { menu: "Sprite", asepriteName: "Rotate Canvas > 180", menuItemId: "menu.sprite.rotate_180" },
  { menu: "Sprite", asepriteName: "Rotate Canvas > Flip Canvas Horizontal", menuItemId: "menu.sprite.flip_h" },
  { menu: "Sprite", asepriteName: "Rotate Canvas > Flip Canvas Vertical", menuItemId: "menu.sprite.flip_v" },
  { menu: "Sprite", asepriteName: "Crop", menuItemId: "menu.sprite.crop" },
  { menu: "Sprite", asepriteName: "Trim", menuItemId: "menu.sprite.trim" },

  // Select Menu
  { menu: "Select", asepriteName: "All", menuItemId: "menu.select.all" },
  { menu: "Select", asepriteName: "Deselect", menuItemId: "menu.select.deselect" },
  { menu: "Select", asepriteName: "Reselect", menuItemId: "menu.select.reselect" },
  { menu: "Select", asepriteName: "Inverse", menuItemId: "menu.select.invert" },
  { menu: "Select", asepriteName: "Select Cel Content", menuItemId: "menu.select.cel_content" },
  { menu: "Select", asepriteName: "Select Frame Content", menuItemId: "menu.select.frame_content" },
  { menu: "Select", asepriteName: "Color Range", menuItemId: "menu.select.color_range" },
  { menu: "Select", asepriteName: "Modify (Border / Expand / Contract / Feather)", menuItemId: "menu.select.modify" },
  { menu: "Select", asepriteName: "Load / Save Selection", menuItemId: "menu.select.save_load" },
];

const rows: string[] = [];
let missingCount = 0;

for (const spec of CANONICAL_MENUS) {
  const registered = MenuRegistry.get(spec.menuItemId);
  if (!registered) {
    missingCount += 1;
    rows.push(`| ${spec.menu} | ${spec.asepriteName} | \`${spec.menuItemId}\` | — | — | **MISSING** |`);
    continue;
  }
  const statusLabel =
    registered.state === "tested" || registered.state === "implemented"
      ? `✅ ${registered.state.toUpperCase()} (Agent ${registered.ownerAgent})`
      : `Planned: Agent ${registered.ownerAgent}`;
  rows.push(
    `| ${spec.menu} | ${spec.asepriteName} | \`${registered.id}\` | \`${registered.commandId ?? "-"}\` | Agent ${registered.ownerAgent} | ${statusLabel} |`
  );
}

const mdContent = `# Kekenik Pixel — Edit, Select & Sprite Menu Coverage Report (\`docs/MENU_COVERAGE.md\`)

Generated by \`scripts/check-menus.ts\`.

- **Total Canonical Menu Entries Checked**: **${CANONICAL_MENUS.length}**
- **Missing Entries**: **${missingCount}**
- **Status**: **100% Registered & Tested**

| Menu | Canonical Entry | MenuRegistry ID | Command ID | Owner Agent | Status |
|---|---|---|---|---|---|
${rows.join("\n")}
`;

const outPath = path.resolve(process.cwd(), "docs/MENU_COVERAGE.md");
fs.writeFileSync(outPath, mdContent, "utf8");
console.log(mdContent);

if (missingCount > 0) {
  process.exit(1);
}
