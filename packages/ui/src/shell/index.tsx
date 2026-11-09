/**
 * @module @kekenik/ui/shell
 * Full UI shell: MenuBar (with hierarchical submenus & chevrons, B19), DocumentTabsBar,
 * WorkspaceManager, ContextBar (cleaned per B20, with 8-way symmetry B22 & grid double-click B07),
 * ToolBar, DockManager, and StatusBar.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BrushType,
  BUILTIN_SAMPLE_SCRIPTS,
  decodeSprite,
  DitherMatrixId,
  formatLocalizedNumber,
  GradientDitherMode,
  GradientType,
  InkMode,
  listSampleProjects,
  MarqueeConstraintMode,
  Mask,
  MenuItemDefinition,
  ensureDock,
  MenuRegistry,
  PanelRegistry,
  panelLocation,
  PatternAlignMode,
  SelectionCombineMode,
  SymmetryMode,
  t,
  TiledMode,
  TilemapEditMode,
  TilesetModificationMode,
  ToolRegistry,
  TopLevelMenu,
} from "../../../core/src/index.ts";
import { useAppStore } from "../app/store.ts";
import { openSpriteAsDocument } from "../app/agent6-actions.ts";
import { DockView } from "./dock.tsx";
import { PixelIcon } from "../skin/index.tsx";
import {
  NumberField,
  PixelButton,
  PixelCheckbox,
  PixelSelect,
  TextField,
} from "../widgets/index.tsx";

/**
 * Extensions that the tab strip accepts when the user drags files in from the OS.
 * Mirrors the formats `decodeSprite()` can read.
 */
const DROPPABLE_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "aseprite",
  "ase",
  "kpx",
  "png",
  "gif",
  "webp",
  "jpg",
  "jpeg",
  "bmp",
  "ico",
  "pcx",
  "qoi",
  "flc",
]);

const TOP_MENUS: readonly TopLevelMenu[] = [
  "File",
  "Edit",
  "Sprite",
  "Layer",
  "Frame",
  "Select",
  "View",
  "Script",
  "Extensions",
  "Help",
];

/**
 * Builds the hierarchical menu tree for `menuName` (B19), attaching `children` to parent items
 * across all 10 top-level menus (`File > Open Sample Project`, `Edit`, `Sprite`, `Layer`, `Frame`,
 * `Select`, `View`, `Script`, `Extensions`, `Help`).
 */
export function buildMenuHierarchy(
  menuName: TopLevelMenu,
  allItems: readonly MenuItemDefinition[],
  state: {
    symmetryMode: SymmetryMode;
    tiledMode: TiledMode;
    showGrid: boolean;
    showPixelGrid: boolean;
    showExtras: boolean;
    showLayerEdges: boolean;
    onionSkinEnabled: boolean;
    /** Optional probe used to tick/untick `View > Panels` entries (see MenuBar). */
    isPanelOpen?: (panelId: string) => boolean;
  }
): MenuItemDefinition[] {
  const raw = allItems
    .filter((m) => m.menu === menuName)
    .sort((a, b) => a.order - b.order);

  if (menuName === "File") {
    const samples = listSampleProjects();
    const sampleChildren: MenuItemDefinition[] = samples.map((sp, idx) => ({
      id: `menu.file.sample.${sp.id}`,
      menu: "File",
      label: sp.title,
      commandId: `sample.open.${sp.id.replace(/^sample\./, "")}`,
      order: idx + 1,
      ownerAgent: 6,
      state: "tested",
      separatorAfter: idx === 9,
    }));

    const scriptItems = raw.filter((it) => it.label.startsWith("Scripts > "));
    const scriptChildren: MenuItemDefinition[] = scriptItems.map((it) => ({
      ...it,
      label: it.label.replace(/^Scripts > /, ""),
    }));

    const result: MenuItemDefinition[] = [];
    let addedScriptsSubmenu = false;
    for (const item of raw) {
      if (item.id === "menu.file.open_sample") {
        result.push({
          ...item,
          label: "Open Sample Project",
          children: sampleChildren,
        });
        continue;
      }
      if (item.label.startsWith("Scripts > ")) {
        if (!addedScriptsSubmenu) {
          addedScriptsSubmenu = true;
          result.push({
            id: "menu.file.scripts_submenu",
            menu: "File",
            label: "Scripts",
            commandId: "script.console",
            order: item.order,
            ownerAgent: 5,
            state: "tested",
            children: scriptChildren,
            separatorAfter: true,
          });
        }
        continue;
      }
      result.push(item);
    }
    if (!result.some((r) => r.id === "menu.file.repeat_last")) {
      const sheetIdx = result.findIndex((r) => r.id === "menu.file.export_sheet");
      const repeatItem: MenuItemDefinition = {
        id: "menu.file.repeat_last",
        menu: "File",
        label: "Repeat Last Export",
        commandId: "file.repeat_last_export",
        order: 8.5,
        ownerAgent: 6,
        state: "tested",
      };
      if (sheetIdx >= 0) {
        result.splice(sheetIdx + 1, 0, repeatItem);
      } else {
        result.push(repeatItem);
      }
    }
    return result;
  }

  if (menuName === "Edit") {
    return raw.map((item) => {
      if (item.id === "menu.edit.paste_special") {
        return {
          ...item,
          label: "Paste Special",
          children: [
            {
              id: "menu.edit.paste_special.new_sprite",
              menu: "Edit",
              label: "Paste as New Sprite",
              commandId: "edit.paste_new_sprite",
              order: 1,
              ownerAgent: 4,
              state: "tested",
            },
            {
              id: "menu.edit.paste_special.new_layer",
              menu: "Edit",
              label: "Paste as New Layer",
              commandId: "edit.paste_new_layer",
              order: 2,
              ownerAgent: 4,
              state: "tested",
            },
            {
              id: "menu.edit.paste_special.new_brush",
              menu: "Edit",
              label: "Paste as New Custom Brush",
              commandId: "edit.paste_new_brush",
              order: 3,
              ownerAgent: 4,
              state: "tested",
              separatorAfter: true,
            },
            {
              id: "menu.edit.paste_special.dialog",
              menu: "Edit",
              label: "Paste Special Dialog...",
              commandId: "edit.paste_special",
              order: 4,
              ownerAgent: 4,
              state: "tested",
            },
          ],
        };
      }
      if (item.id === "menu.edit.transform") {
        return {
          ...item,
          label: "Rotate",
          children: [
            {
              id: "menu.edit.rotate.180",
              menu: "Edit",
              label: "Rotate 180°",
              commandId: "edit.rotate_180",
              order: 1,
              ownerAgent: 4,
              state: "tested",
            },
            {
              id: "menu.edit.rotate.90cw",
              menu: "Edit",
              label: "Rotate 90° CW",
              commandId: "edit.rotate_90cw",
              order: 2,
              ownerAgent: 4,
              state: "tested",
            },
            {
              id: "menu.edit.rotate.90ccw",
              menu: "Edit",
              label: "Rotate 90° CCW",
              commandId: "edit.rotate_90ccw",
              order: 3,
              ownerAgent: 4,
              state: "tested",
              separatorAfter: true,
            },
            {
              id: "menu.edit.rotate.custom",
              menu: "Edit",
              label: "Rotate / Transform (RotSprite)...",
              commandId: "edit.transform",
              order: 4,
              ownerAgent: 4,
              state: "tested",
            },
          ],
        };
      }
      if (item.id === "menu.edit.shift") {
        return {
          ...item,
          label: "Shift",
          children: [
            {
              id: "menu.edit.shift.dlg",
              menu: "Edit",
              label: "Shift / Wrap Pixels...",
              commandId: "edit.shift_pixels",
              order: 1,
              ownerAgent: 4,
              state: "tested",
            },
          ],
        };
      }
      if (item.id === "menu.edit.adjustments") {
        return {
          ...item,
          label: "Adjustments",
          children: [
            {
              id: "menu.edit.adj.brightness",
              menu: "Edit",
              label: "Brightness / Contrast...",
              commandId: "edit.adjustments",
              order: 1,
              ownerAgent: 4,
              state: "tested",
            },
            {
              id: "menu.edit.adj.hue_sat",
              menu: "Edit",
              label: "Hue / Saturation...",
              commandId: "edit.adjustments",
              order: 2,
              ownerAgent: 4,
              state: "tested",
            },
            {
              id: "menu.edit.adj.curve",
              menu: "Edit",
              label: "Color Curve...",
              commandId: "edit.adjustments",
              order: 3,
              ownerAgent: 4,
              state: "tested",
              separatorAfter: true,
            },
            {
              id: "menu.edit.adj.invert",
              menu: "Edit",
              label: "Invert Color",
              commandId: "edit.invert_color",
              order: 4,
              ownerAgent: 4,
              state: "tested",
            },
            {
              id: "menu.edit.adj.replace",
              menu: "Edit",
              label: "Replace Color...",
              commandId: "edit.replace_color",
              order: 5,
              ownerAgent: 4,
              state: "tested",
            },
          ],
        };
      }
      if (item.id === "menu.edit.fx") {
        return {
          ...item,
          label: "FX",
          children: [
            {
              id: "menu.edit.fx.outline",
              menu: "Edit",
              label: "Outline...",
              commandId: "edit.fx",
              order: 1,
              ownerAgent: 4,
              state: "tested",
            },
            {
              id: "menu.edit.fx.convolution",
              menu: "Edit",
              label: "Convolution Matrix...",
              commandId: "edit.fx",
              order: 2,
              ownerAgent: 4,
              state: "tested",
            },
            {
              id: "menu.edit.fx.despeckle",
              menu: "Edit",
              label: "Despeckle...",
              commandId: "edit.fx",
              order: 3,
              ownerAgent: 4,
              state: "tested",
            },
            {
              id: "menu.edit.fx.shadow",
              menu: "Edit",
              label: "Drop Shadow...",
              commandId: "edit.fx",
              order: 4,
              ownerAgent: 4,
              state: "tested",
            },
          ],
        };
      }
      return item;
    });
  }

  if (menuName === "Sprite") {
    const colorModeChildren: MenuItemDefinition[] = [
      {
        id: "menu.sprite.colormode_rgba",
        menu: "Sprite",
        label: "RGB Color",
        commandId: "sprite.mode_rgba",
        order: 1,
        ownerAgent: 1,
        state: "tested",
      },
      {
        id: "menu.sprite.colormode_gray",
        menu: "Sprite",
        label: "Grayscale",
        commandId: "sprite.mode_gray",
        order: 2,
        ownerAgent: 1,
        state: "tested",
      },
      {
        id: "menu.sprite.colormode_idx",
        menu: "Sprite",
        label: "Indexed",
        commandId: "sprite.mode_idx",
        order: 3,
        ownerAgent: 1,
        state: "tested",
        separatorAfter: true,
      },
      {
        id: "menu.sprite.colormode_dlg",
        menu: "Sprite",
        label: "More Options (Convert & Dither)...",
        commandId: "sprite.colormode_dialog",
        order: 4,
        ownerAgent: 4,
        state: "tested",
      },
    ];

    const rotateCanvasChildren: MenuItemDefinition[] = [
      {
        id: "menu.sprite.rotate_180",
        menu: "Sprite",
        label: "Rotate Canvas 180°",
        commandId: "sprite.rotate_180",
        order: 1,
        ownerAgent: 4,
        state: "tested",
      },
      {
        id: "menu.sprite.rotate_90cw",
        menu: "Sprite",
        label: "Rotate Canvas 90° CW",
        commandId: "sprite.rotate_90cw",
        order: 2,
        ownerAgent: 4,
        state: "tested",
      },
      {
        id: "menu.sprite.rotate_90ccw",
        menu: "Sprite",
        label: "Rotate Canvas 90° CCW",
        commandId: "sprite.rotate_90ccw",
        order: 3,
        ownerAgent: 4,
        state: "tested",
        separatorAfter: true,
      },
      {
        id: "menu.sprite.flip_h",
        menu: "Sprite",
        label: "Flip Canvas Horizontal",
        commandId: "sprite.flip_h",
        order: 4,
        ownerAgent: 4,
        state: "tested",
      },
      {
        id: "menu.sprite.flip_v",
        menu: "Sprite",
        label: "Flip Canvas Vertical",
        commandId: "sprite.flip_v",
        order: 5,
        ownerAgent: 4,
        state: "tested",
      },
    ];

    const out: MenuItemDefinition[] = [];
    let addedColorMode = false;
    let addedRotate = false;
    for (const item of raw) {
      if (item.id.startsWith("menu.sprite.colormode_")) {
        if (!addedColorMode) {
          addedColorMode = true;
          out.push({
            id: "menu.sprite.colormode_submenu",
            menu: "Sprite",
            label: "Color Mode",
            commandId: "sprite.colormode_dialog",
            order: 2,
            ownerAgent: 4,
            state: "tested",
            children: colorModeChildren,
            separatorAfter: true,
          });
        }
        continue;
      }
      if (
        item.id.startsWith("menu.sprite.rotate_") ||
        item.id === "menu.sprite.flip_h" ||
        item.id === "menu.sprite.flip_v"
      ) {
        if (!addedRotate) {
          addedRotate = true;
          out.push({
            id: "menu.sprite.rotate_canvas_submenu",
            menu: "Sprite",
            label: "Rotate Canvas",
            commandId: "sprite.rotate_90cw",
            order: 8,
            ownerAgent: 4,
            state: "tested",
            children: rotateCanvasChildren,
          });
        }
        continue;
      }
      out.push(item);
    }
    return out;
  }

  if (menuName === "Layer") {
    const newChildren: MenuItemDefinition[] = [
      {
        id: "menu.layer.new.image",
        menu: "Layer",
        label: "New Layer",
        commandId: "layer.new",
        order: 1,
        ownerAgent: 1,
        state: "tested",
      },
      {
        id: "menu.layer.new.group",
        menu: "Layer",
        label: "New Group",
        commandId: "layer.new_group",
        order: 2,
        ownerAgent: 3,
        state: "tested",
      },
      {
        id: "menu.layer.new.tilemap",
        menu: "Layer",
        label: "New Tilemap Layer...",
        commandId: "layer.new_tilemap",
        order: 3,
        ownerAgent: 3,
        state: "tested",
      },
      {
        id: "menu.layer.new.ref",
        menu: "Layer",
        label: "New Reference Layer",
        commandId: "layer.new_reference",
        order: 4,
        ownerAgent: 3,
        state: "tested",
      },
    ];
    return raw.map((item) => {
      if (item.id === "menu.layer.new") {
        return {
          ...item,
          label: "New",
          children: newChildren,
        };
      }
      return item;
    });
  }

  if (menuName === "Frame") {
    return raw.map((item) => {
      if (item.id === "menu.frame.tags") {
        return {
          ...item,
          label: "Tags",
          children: [
            {
              id: "menu.frame.tags.new",
              menu: "Frame",
              label: "New Tag / Tag Properties...",
              commandId: "frame.new_tag",
              order: 1,
              ownerAgent: 3,
              state: "tested",
            },
            {
              id: "menu.frame.tags.panel",
              menu: "Frame",
              label: "Open Tags Panel",
              commandId: "view.tags_panel",
              order: 2,
              ownerAgent: 3,
              state: "tested",
            },
          ],
        };
      }
      return item;
    });
  }

  if (menuName === "Select") {
    return raw.map((item) => {
      if (item.id === "menu.select.modify") {
        return {
          ...item,
          label: "Modify",
          children: [
            {
              id: "menu.select.modify.expand",
              menu: "Select",
              label: "Expand / Contract / Border...",
              commandId: "select.modify",
              order: 1,
              ownerAgent: 4,
              state: "tested",
            },
            {
              id: "menu.select.modify.color_range",
              menu: "Select",
              label: "Color Range...",
              commandId: "select.color_range",
              order: 2,
              ownerAgent: 4,
              state: "tested",
            },
            {
              id: "menu.select.modify.save_load",
              menu: "Select",
              label: "Save / Load Selection...",
              commandId: "select.save_load_mask",
              order: 3,
              ownerAgent: 4,
              state: "tested",
            },
          ],
        };
      }
      return item;
    });
  }

  if (menuName === "View") {
    const symmetryChildren: MenuItemDefinition[] = [
      {
        id: "menu.view.sym.none",
        menu: "View",
        label: "Off",
        commandId: "view.symmetry_none",
        order: 1,
        ownerAgent: 2,
        state: "tested",
        checked: state.symmetryMode === "none",
      },
      {
        id: "menu.view.sym.horiz",
        menu: "View",
        label: "Horizontal Mirror (X)",
        commandId: "view.symmetry_h",
        order: 2,
        ownerAgent: 2,
        state: "tested",
        checked: state.symmetryMode === "horizontal",
      },
      {
        id: "menu.view.sym.vert",
        menu: "View",
        label: "Vertical Mirror (Y)",
        commandId: "view.symmetry_v",
        order: 3,
        ownerAgent: 2,
        state: "tested",
        checked: state.symmetryMode === "vertical",
      },
      {
        id: "menu.view.sym.both",
        menu: "View",
        label: "Quad Mirror (Both X & Y)",
        commandId: "view.symmetry_both",
        order: 4,
        ownerAgent: 2,
        state: "tested",
        checked: state.symmetryMode === "both",
      },
      {
        id: "menu.view.sym.diag_pos",
        menu: "View",
        label: "Diagonal \\",
        commandId: "view.symmetry_diag_pos",
        order: 5,
        ownerAgent: 2,
        state: "tested",
        checked: state.symmetryMode === "diagonal_pos",
      },
      {
        id: "menu.view.sym.diag_neg",
        menu: "View",
        label: "Diagonal /",
        commandId: "view.symmetry_diag_neg",
        order: 6,
        ownerAgent: 2,
        state: "tested",
        checked: state.symmetryMode === "diagonal_neg",
      },
      {
        id: "menu.view.sym.eight_way",
        menu: "View",
        label: "8-Way (All Axes)",
        commandId: "view.symmetry_8way",
        order: 7,
        ownerAgent: 2,
        state: "tested",
        checked: state.symmetryMode === "eight_way",
      },
    ];

    const tiledChildren: MenuItemDefinition[] = [
      {
        id: "menu.view.tiled.none",
        menu: "View",
        label: "None",
        commandId: "view.tiled_none",
        order: 1,
        ownerAgent: 2,
        state: "tested",
        checked: state.tiledMode === "none",
      },
      {
        id: "menu.view.tiled.both",
        menu: "View",
        label: "Both Axes (3x3)",
        commandId: "view.tiled_both",
        order: 2,
        ownerAgent: 2,
        state: "tested",
        checked: state.tiledMode === "both",
      },
      {
        id: "menu.view.tiled.x",
        menu: "View",
        label: "X Axis",
        commandId: "view.tiled_x",
        order: 3,
        ownerAgent: 2,
        state: "tested",
        checked: state.tiledMode === "x",
      },
      {
        id: "menu.view.tiled.y",
        menu: "View",
        label: "Y Axis",
        commandId: "view.tiled_y",
        order: 4,
        ownerAgent: 2,
        state: "tested",
        checked: state.tiledMode === "y",
      },
    ];

    // Real "Panels" submenu: every registered panel is listed with its live visibility
    // state; the legacy flat "Panels > X" labels registered by feature packs are dropped.
    const panelChildren: MenuItemDefinition[] = PanelRegistry.getAll()
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((panel, idx) => ({
        id: `menu.view.panels.${panel.id}`,
        menu: "View",
        label: panel.title,
        commandId: `view.toggle_panel.${panel.id}`,
        order: idx + 1,
        ownerAgent: 1,
        state: "tested",
        checked: Boolean(state.isPanelOpen?.(panel.id)),
      }));

    const tree: MenuItemDefinition[] = raw
      .filter((item) => !item.label.startsWith("Panels > "))
      .map((item) => {
        if (item.id === "menu.view.symmetry") {
          return {
            ...item,
            label: "Symmetry Options",
            children: symmetryChildren,
          };
        }
        if (item.id === "menu.view.tiled_mode") {
          return {
            ...item,
            label: "Tiled Mode",
            children: tiledChildren,
          };
        }
        return item;
      });

    if (panelChildren.length > 0) {
      tree.push({
        id: "menu.view.panels",
        menu: "View",
        label: "Panels",
        commandId: "view.panels",
        order: 2.1,
        ownerAgent: 1,
        state: "tested",
        children: panelChildren,
      });
    }

    return tree.sort((a, b) => a.order - b.order);
  }

  if (menuName === "Script") {
    const sampleChildren: MenuItemDefinition[] = BUILTIN_SAMPLE_SCRIPTS.map((s, idx) => ({
      id: `menu.script.sample.${s.id}`,
      menu: "Script",
      label: s.title,
      commandId: `script.sample.${s.id}`,
      order: idx + 1,
      ownerAgent: 5,
      state: "tested",
    }));

    const filtered = raw.filter((item) => !item.label.startsWith("Sample Scripts > "));
    filtered.push({
      id: "menu.script.samples_submenu",
      menu: "Script",
      label: "Sample Scripts",
      commandId: "script.sample.hello_world",
      order: 3,
      ownerAgent: 5,
      state: "tested",
      children: sampleChildren,
    });
    return filtered;
  }

  if (menuName === "Extensions") {
    const sampleItems = raw.filter((item) => item.label.startsWith("Install Sample:"));
    const filtered = raw.filter((item) => !item.label.startsWith("Install Sample:"));
    if (sampleItems.length > 0) {
      filtered.push({
        id: "menu.ext.samples_submenu",
        menu: "Extensions",
        label: "Install Sample",
        commandId: "ext.install_cyberpunk",
        order: 3,
        ownerAgent: 5,
        state: "tested",
        children: sampleItems.map((it) => ({
          ...it,
          label: it.label.replace(/^Install Sample:\s*/, ""),
        })),
      });
    }
    return filtered;
  }

  // NOTE: the Help menu intentionally has no "Feature Center" entry — the diagnostic
  // self-test console stays reachable through F1 only (it is developer tooling, not a
  // user-facing feature of the shipped editor).

  return raw;
}

/**
 * Recursive cascading menu list component supporting submenus, right-aligned `▸` chevron,
 * viewport overflow flip (right -> left) & vertical clamping, hover/click opening, and keyboard navigation (B19).
 */
export const CascadingMenuList: React.FC<{
  items: readonly MenuItemDefinition[];
  onActivateCommand: (commandId: string) => void;
  getShortcutLabel: (commandId?: string) => string;
  level?: number;
  forceOpenSubmenuId?: string | null;
  highlightedEntryCommandId?: string | null;
  onRequestCloseParent?: () => void;
}> = ({
  items,
  onActivateCommand,
  getShortcutLabel,
  level = 0,
  forceOpenSubmenuId = null,
  highlightedEntryCommandId = null,
  onRequestCloseParent,
}) => {
  const [openSubId, setOpenSubId] = useState<string | null>(forceOpenSubmenuId);
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const [flipLeft, setFlipLeft] = useState(false);
  const [clampOffsetY, setClampOffsetY] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (forceOpenSubmenuId) {
      setOpenSubId(forceOpenSubmenuId);
    }
  }, [forceOpenSubmenuId]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  // Measure viewport overflow for nested submenus (level > 0)
  useEffect(() => {
    if (level === 0 || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 720;

    if (rect.right > vw - 8) {
      setFlipLeft(true);
    }
    if (rect.bottom > vh - 8) {
      setClampOffsetY(Math.max(-(rect.top - 8), vh - 8 - rect.bottom));
    }
  }, [level, items]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setFocusIdx((prev) => (prev + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setFocusIdx((prev) => (prev - 1 + items.length) % items.length);
    } else if (e.key === "ArrowRight") {
      const curr = items[focusIdx];
      if (curr && curr.children && curr.children.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        setOpenSubId(curr.id);
      }
    } else if (e.key === "ArrowLeft") {
      if (level > 0 && onRequestCloseParent) {
        e.preventDefault();
        e.stopPropagation();
        onRequestCloseParent();
      }
    } else if (e.key === "Enter") {
      const curr = items[focusIdx];
      if (curr && curr.state !== "planned") {
        e.preventDefault();
        e.stopPropagation();
        if (curr.children && curr.children.length > 0 && openSubId !== curr.id) {
          setOpenSubId(curr.id);
        } else if (curr.commandId) {
          onActivateCommand(curr.commandId);
        }
      }
    }
  };

  const posClass =
    level === 0
      ? "left-0 top-full mt-0.5"
      : flipLeft
      ? "right-full top-0 mr-0.5"
      : "left-full top-0 ml-0.5";

  return (
    <div
      ref={containerRef}
      role="menu"
      tabIndex={-1}
      data-testid={level === 0 ? "menu-dropdown" : "menu-submenu"}
      data-submenu-flipped={flipLeft ? "left" : "right"}
      onKeyDown={handleKeyDown}
      style={
        level > 0 && clampOffsetY !== 0
          ? { transform: `translateY(${clampOffsetY}px)` }
          : undefined
      }
      className={`absolute ${posClass} w-64 max-h-[82vh] overflow-y-visible kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] shadow-xl py-1 z-50`}
    >
      {items.map((item, idx) => {
        const isPlanned = item.state === "planned";
        const hasChildren = Boolean(item.children && item.children.length > 0);
        const isSubOpen = hasChildren && openSubId === item.id;
        const isFocused = focusIdx === idx || isSubOpen;
        const isHighlighted =
          Boolean(highlightedEntryCommandId) && item.commandId === highlightedEntryCommandId;
        const shortcut = getShortcutLabel(item.commandId);

        return (
          <div
            key={item.id}
            className="relative"
            onMouseEnter={() => {
              if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
              setFocusIdx(idx);
              if (hasChildren) {
                setOpenSubId(item.id);
              } else {
                setOpenSubId(null);
              }
            }}
          >
            {item.separatorBefore && <div className="my-1 border-t border-black/25" />}
            <button
              type="button"
              role="menuitem"
              aria-haspopup={hasChildren ? "menu" : undefined}
              aria-expanded={hasChildren ? isSubOpen : undefined}
              disabled={isPlanned}
              data-menu-item-id={item.id}
              title={isPlanned ? `Planned: Agent ${item.ownerAgent}` : item.label}
              onClick={(e) => {
                e.stopPropagation();
                if (isPlanned) return;
                if (hasChildren) {
                  setOpenSubId(isSubOpen ? null : item.id);
                  return;
                }
                if (item.commandId) {
                  onActivateCommand(item.commandId);
                }
              }}
              className={`w-full px-2.5 py-1 text-left text-xs font-mono flex items-center justify-between gap-2 ${
                isPlanned
                  ? "opacity-50 cursor-not-allowed"
                  : isFocused || isHighlighted
                  ? "bg-[var(--kpx-header-bg)] text-white cursor-pointer"
                  : "hover:bg-[var(--kpx-header-bg)] hover:text-white cursor-pointer"
              }`}
            >
              <span className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="w-3 inline-block text-center shrink-0">
                  {item.checked ? "✓" : ""}
                </span>
                <span className="truncate">{item.label}</span>
              </span>

              <span className="flex items-center gap-1.5 shrink-0">
                {!hasChildren && (
                  <span className="text-[10px] opacity-75">
                    {isPlanned ? `Planned: Agent ${item.ownerAgent}` : shortcut}
                  </span>
                )}
                {hasChildren && (
                  <span
                    data-testid="submenu-chevron"
                    className={`text-[11px] leading-none select-none ${
                      isPlanned ? "opacity-45" : "opacity-90"
                    }`}
                  >
                    ▸
                  </span>
                )}
              </span>
            </button>

            {hasChildren && isSubOpen && !isPlanned && (
              <CascadingMenuList
                items={item.children!}
                onActivateCommand={onActivateCommand}
                getShortcutLabel={getShortcutLabel}
                level={level + 1}
                highlightedEntryCommandId={highlightedEntryCommandId}
                onRequestCloseParent={() => setOpenSubId(null)}
              />
            )}

            {item.separatorAfter && <div className="my-1 border-t border-black/25" />}
          </div>
        );
      })}
    </div>
  );
};

/**
 * 1. Top MenuBar driven by MenuRegistry with full cascading submenus (B19)
 */
export const MenuBar: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const [openMenu, setOpenMenu] = useState<TopLevelMenu | null>(null);
  const runCommandById = useAppStore((s) => s.runCommandById);
  const keyBindings = useAppStore((s) => s.keyBindings);
  const locale = useAppStore((s) => s.locale);
  const toolOptions = useAppStore((s) => s.toolOptions);
  const tiledMode = useAppStore((s) => s.tiledMode);
  const showGrid = useAppStore((s) => s.showGrid);
  const showPixelGrid = useAppStore((s) => s.showPixelGrid);
  const showExtras = useAppStore((s) => s.showExtras);
  const showLayerEdges = useAppStore((s) => s.showLayerEdges);
  const onionSkin = useAppStore((s) => s.onionSkin);
  const menuReveal = useAppStore((s) => s.menuReveal);
  const clearMenuReveal = useAppStore((s) => s.clearMenuReveal);
  const currentLayout = useAppStore((s) => s.currentLayout);

  // Live "is this panel currently docked or floating?" probe for `View > Panels`.
  const isPanelOpen = useCallback(
    (panelId: string) => panelLocation(ensureDock(currentLayout as never), panelId) !== "closed",
    [currentLayout]
  );

  // Close menus on outside click, Escape, or window blur (B19)
  useEffect(() => {
    const close = () => setOpenMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null);
      } else if (openMenu && e.key === "ArrowRight") {
        const idx = TOP_MENUS.indexOf(openMenu);
        if (idx >= 0) setOpenMenu(TOP_MENUS[(idx + 1) % TOP_MENUS.length]);
      } else if (openMenu && e.key === "ArrowLeft") {
        const idx = TOP_MENUS.indexOf(openMenu);
        if (idx >= 0) setOpenMenu(TOP_MENUS[(idx - 1 + TOP_MENUS.length) % TOP_MENUS.length]);
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  // Support Feature Center "Show me" menu reveal
  useEffect(() => {
    if (!menuReveal) return;
    setOpenMenu(menuReveal.menu);
    const timer = setTimeout(() => {
      runCommandById(menuReveal.commandId);
      setOpenMenu(null);
      clearMenuReveal();
    }, 320);
    return () => clearTimeout(timer);
  }, [menuReveal, runCommandById, clearMenuReveal]);

  const menuItems = MenuRegistry.getAll();

  const getShortcutLabel = useCallback(
    (commandId?: string): string => {
      if (!commandId) return "";
      return keyBindings.find((k) => k.commandId === commandId)?.keys ?? "";
    },
    [keyBindings]
  );

  const handleActivateCommand = useCallback(
    (commandId: string) => {
      runCommandById(commandId);
      setOpenMenu(null);
    },
    [runCommandById]
  );

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={
        embedded
          ? "h-full px-1 bg-transparent text-[var(--kpx-text)] flex items-center gap-3 select-none text-xs font-mono relative z-40"
          : "h-6 px-2 bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] border-b border-black flex items-center justify-between select-none text-xs font-mono relative z-40"
      }
    >
      <div className="flex items-center gap-1" role="menubar">
        {TOP_MENUS.map((menuName) => {
          const isOpen = openMenu === menuName;
          const itemsForMenu = buildMenuHierarchy(menuName, menuItems, {
            symmetryMode: toolOptions.symmetryMode,
            tiledMode,
            showGrid,
            showPixelGrid,
            showExtras,
            showLayerEdges,
            onionSkinEnabled: onionSkin.enabled,
            isPanelOpen,
          });

          return (
            <div key={menuName} className="relative">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                data-testid={`menubar-item-${menuName.toLowerCase()}`}
                onClick={() => setOpenMenu(isOpen ? null : menuName)}
                onMouseEnter={() => openMenu && setOpenMenu(menuName)}
                className={`px-2 py-0.5 font-mono text-xs cursor-pointer ${
                  isOpen
                    ? "bg-[var(--kpx-header-bg)] text-white font-bold"
                    : "hover:bg-black/10"
                }`}
              >
                <span className="underline">{t(`menu.${menuName.toLowerCase()}`, locale)[0]}</span>
                {t(`menu.${menuName.toLowerCase()}`, locale).slice(1)}
              </button>

              {isOpen && (
                <CascadingMenuList
                  items={itemsForMenu}
                  onActivateCommand={handleActivateCommand}
                  getShortcutLabel={getShortcutLabel}
                  forceOpenSubmenuId={
                    menuReveal?.menu === menuName ? menuReveal.submenuId : null
                  }
                  highlightedEntryCommandId={
                    menuReveal?.menu === menuName ? menuReveal.commandId : null
                  }
                />
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
};

/**
 * 2. Document Tabs Bar + Top-Right Workspace Switcher (matching Screenshot 1 & 2)
 */
export const DocumentTabsBar: React.FC = () => {
  const documents = useAppStore((s) => s.documents);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const rev = useAppStore((s) => s.docRevision);
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const workspaceModified = useAppStore((s) => s.workspaceModified);

  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeDocument = useAppStore((s) => s.closeDocument);
  const openDialog = useAppStore((s) => s.openDialog);
  const switchWorkspace = useAppStore((s) => s.switchWorkspace);
  const saveWorkspaceAs = useAppStore((s) => s.saveWorkspaceAs);
  const resetCurrentWorkspace = useAppStore((s) => s.resetCurrentWorkspace);
  const togglePanelFloating = useAppStore((s) => s.togglePanelFloating);
  const floatCloseBehavior = useAppStore((s) => s.floatCloseBehavior);
  const setFloatCloseBehavior = useAppStore((s) => s.setFloatCloseBehavior);

  const [showWsModal, setShowWsModal] = useState(false);
  const [newWsName, setNewWsName] = useState("Mine");
  const [isFileDragOver, setIsFileDragOver] = useState(false);

  void rev;

  // Dropping a sprite/image file onto the tab strip opens it in a brand-new tab.
  const handleFileDrop = useCallback(async (dropped: FileList | null) => {
    if (!dropped || dropped.length === 0) return;
    for (const file of Array.from(dropped)) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!DROPPABLE_FILE_EXTENSIONS.has(ext)) continue;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { sprite, editor } = decodeSprite(bytes, file.name);
        openSpriteAsDocument(
          { get: useAppStore.getState, set: useAppStore.setState },
          sprite,
          editor ?? {}
        );
      } catch {
        // decodeSprite() already logs the reason; keep the rest of the drop going.
      }
    }
  }, []);

  return (
    <div
      data-testid="document-tabs-bar"
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!isFileDragOver) setIsFileDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsFileDragOver(false);
      }}
      onDrop={(e) => {
        if (e.dataTransfer?.files?.length) {
          e.preventDefault();
          setIsFileDragOver(false);
          void handleFileDrop(e.dataTransfer.files);
        }
      }}
      className={`h-7 px-1.5 pt-1 bg-[var(--kpx-panel-bg)] border-b border-black flex items-end justify-between select-none text-xs font-mono ${
        isFileDragOver ? "outline outline-2 outline-dashed outline-[var(--kpx-accent-bg)]" : ""
      }`}
    >
      {/* Document Tabs */}
      <div className="flex items-end gap-0.5 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("home")}
          className={`px-2.5 py-0.5 flex items-center gap-1.5 border border-b-0 border-black rounded-t ${
            activeTabId === "home"
              ? "bg-[var(--kpx-tab-active)] text-white font-bold"
              : "bg-[var(--kpx-tab-inactive)] text-black hover:brightness-105"
          }`}
        >
          <PixelIcon name="home" size={12} />
          <span>Home</span>
        </button>

        {documents.map((doc) => {
          const active = activeTabId === doc.id;
          return (
            <div
              key={doc.id}
              data-testid={`doc-tab-${doc.id}`}
              onClick={() => setActiveTab(doc.id)}
              className={`px-2.5 py-0.5 flex items-center gap-2 border border-b-0 border-black rounded-t cursor-pointer ${
                active
                  ? "bg-[var(--kpx-tab-active)] text-white font-bold"
                  : "bg-[var(--kpx-tab-inactive)] text-black hover:brightness-105"
              }`}
            >
              <span>{doc.sprite.name}</span>
              {doc.isDirty && (
                <span
                  data-testid="dirty-tab-indicator"
                  title="Unsaved modifications"
                  className="w-2 h-2 rounded-full bg-white inline-block"
                />
              )}
              <button
                type="button"
                aria-label={`Close ${doc.sprite.name}`}
                data-testid={`close-tab-${doc.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeDocument(doc.id);
                }}
                className="hover:bg-black/25 p-0.5 rounded"
              >
                <PixelIcon name="close" size={9} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          title="New Sprite (Ctrl+N)"
          onClick={() => openDialog("dialog.new_sprite")}
          className="px-2 py-0.5 ml-1 mb-0.5 kpx-bevel-outset bg-[var(--kpx-btn-bg)] text-black text-xs font-bold"
        >
          +
        </button>
      </div>

      {/* Workspace Layout Switcher in top-right corner ("Default*" combo as in Screenshot 1 & 2) */}
      <div className="flex items-center gap-1 pb-0.5 relative">
        <PixelSelect
          ariaLabel="Workspace Layout"
          value={activeWorkspaceId}
          onChange={(val) => switchWorkspace(val)}
          options={workspaces.map((w) => ({
            value: w.id,
            label:
              w.id === activeWorkspaceId && workspaceModified ? `${w.name}*` : w.name,
          }))}
        />
        <PixelButton
          size="xs"
          title="Manage / Save Workspace Layout or Float Panels"
          onClick={() => setShowWsModal(!showWsModal)}
        >
          <PixelIcon name="workspace" size={11} />
          Layout
        </PixelButton>

        {showWsModal && (
          <div className="absolute right-0 top-full mt-1 w-64 kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] p-2.5 shadow-2xl z-50 space-y-2">
            <div className="font-bold text-xs border-b border-black/30 pb-1 flex items-center justify-between">
              <span>Workspace &amp; Panels</span>
              <button type="button" onClick={() => setShowWsModal(false)}>
                <PixelIcon name="close" size={10} />
              </button>
            </div>

            <div className="space-y-1">
              <div className="text-[11px]">Save current layout as:</div>
              <div className="flex items-center gap-1">
                <TextField
                  ariaLabel="Workspace Name"
                  value={newWsName}
                  onChange={setNewWsName}
                  className="flex-1 px-1.5 py-0.5 text-xs"
                />
                <PixelButton
                  size="xs"
                  onClick={() => {
                    saveWorkspaceAs(newWsName);
                    setShowWsModal(false);
                  }}
                >
                  Save
                </PixelButton>
              </div>
            </div>

            <div className="space-y-1 border-t border-black/20 pt-1.5">
              <div className="text-[11px] font-bold">Float / Toggle Builtin Panels:</div>
              <div className="grid grid-cols-2 gap-1">
                {PanelRegistry.getAll().map((p) => (
                  <PixelButton
                    key={p.id}
                    size="xs"
                    onClick={() => togglePanelFloating(p.id)}
                  >
                    {p.title}
                  </PixelButton>
                ))}
              </div>
            </div>

            <div className="border-t border-black/20 pt-1.5">
              <PixelCheckbox
                checked={floatCloseBehavior === "redock"}
                onChange={(checked) => setFloatCloseBehavior(checked ? "redock" : "close")}
                label="Closing a floating window re-docks it"
              />
            </div>
            <div className="flex justify-between pt-1 border-t border-black/20">
              <PixelButton size="xs" onClick={resetCurrentWorkspace}>
                Reset Layout
              </PixelButton>
              <PixelButton size="xs" onClick={() => setShowWsModal(false)}>
                Done
              </PixelButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * 3. Context Bar (B20: Undo/Redo, active tool label, and presets removed from DOM;
 *    remaining controls reflow to the left; includes 8-way symmetry B22 & Grid double-click B07).
 */
export const ContextBar: React.FC = () => {
  const activeToolId = useAppStore((s) => s.activeToolId);
  const toolOptions = useAppStore((s) => s.toolOptions);
  const tiledMode = useAppStore((s) => s.tiledMode);
  const showGrid = useAppStore((s) => s.showGrid);
  const setToolOption = useAppStore((s) => s.setToolOption);
  const setTiledMode = useAppStore((s) => s.setTiledMode);
  const toggleGrid = useAppStore((s) => s.toggleGrid);
  const captureCustomBrushFromCanvas = useAppStore((s) => s.captureCustomBrushFromCanvas);
  const saveCurrentBrushToLibrary = useAppStore((s) => s.saveCurrentBrushToLibrary);
  const openDialog = useAppStore((s) => s.openDialog);
  const runCommandById = useAppStore((s) => s.runCommandById);
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const tilemapEditMode = useAppStore((s) => s.tilemapEditMode);
  const tilesetModMode = useAppStore((s) => s.tilesetModMode);
  const activeTileIndex = useAppStore((s) => s.activeTileIndex);
  const tileFlipX = useAppStore((s) => s.tileFlipX);
  const tileFlipY = useAppStore((s) => s.tileFlipY);
  const tileRot90 = useAppStore((s) => s.tileRot90);
  const setTilemapEditMode = useAppStore((s) => s.setTilemapEditMode);
  const setTilesetModMode = useAppStore((s) => s.setTilesetModMode);
  const setActiveTileIndex = useAppStore((s) => s.setActiveTileIndex);
  const toggleTileFlag = useAppStore((s) => s.toggleTileFlag);
  const activeSliceId = useAppStore((s) => s.activeSliceId);
  const selectSliceBounds = useAppStore((s) => s.selectSliceBounds);
  const exportSliceAsNewDocument = useAppStore((s) => s.exportSliceAsNewDocument);
  const showSelectionEdges = useAppStore((s) => s.showSelectionEdges);
  const setShowSelectionEdges = useAppStore((s) => s.setShowSelectionEdges);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const activeLayer = doc?.sprite.layers.find((l) => l.id === activeLayerId);
  const isSelectionTool =
    activeToolId === "tool.marquee_rect" ||
    activeToolId === "tool.marquee_ellipse" ||
    activeToolId === "tool.lasso" ||
    activeToolId === "tool.polygonal_lasso" ||
    activeToolId === "tool.magic_wand";

  const [showBrushPopup, setShowBrushPopup] = useState(false);
  const [showSymPopup, setShowSymPopup] = useState(false);

  void rev;

  return (
    <div
      data-testid="context-bar"
      className="min-h-8 px-2 py-0.5 bg-[var(--kpx-chrome-bg)] border-b border-black flex flex-wrap items-center justify-start gap-1.5 select-none text-xs font-mono text-black relative z-30"
    >
      {/* 1. Brush Type Popup Trigger + Shape Selector */}
      <div className="relative flex items-center gap-1">
        <PixelButton
          size="xs"
          active={showBrushPopup}
          title="Brush Type, Angle, Spacing, Flip & Tablet Dynamics Popup"
          onClick={() => {
            setShowBrushPopup(!showBrushPopup);
            setShowSymPopup(false);
          }}
        >
          <PixelIcon
            name={
              toolOptions.brushShape === "circle"
                ? "shape_circle"
                : toolOptions.brushShape === "line"
                ? "line"
                : "shape_square"
            }
            size={12}
          />
          <span>Brush</span>
        </PixelButton>

        {showBrushPopup && (
          <div className="absolute left-0 top-full mt-1 w-72 kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] p-2.5 shadow-2xl z-50 space-y-2">
            <div className="font-bold text-xs border-b border-black/30 pb-1 flex items-center justify-between">
              <span>Brush Type &amp; Dynamics</span>
              <button type="button" onClick={() => setShowBrushPopup(false)}>
                <PixelIcon name="close" size={10} />
              </button>
            </div>

            <div className="flex items-center justify-between gap-1">
              <span>Type:</span>
              <PixelSelect
                ariaLabel="Brush Type"
                value={toolOptions.brushShape}
                onChange={(v) => setToolOption("brushShape", v as BrushType)}
                options={[
                  { value: "square", label: "Square" },
                  { value: "circle", label: "Circle" },
                  { value: "line", label: "Angled Line" },
                  { value: "image", label: "Custom Image Stamp" },
                ]}
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex items-center justify-between">
                <span>Angle:</span>
                <NumberField
                  ariaLabel="Brush Angle"
                  value={toolOptions.brushAngle}
                  min={-180}
                  max={180}
                  suffix="°"
                  widthClass="w-16"
                  onChange={(v) => setToolOption("brushAngle", v)}
                />
              </div>
              <div className="flex items-center justify-between">
                <span>Spacing:</span>
                <NumberField
                  ariaLabel="Brush Spacing"
                  value={toolOptions.brushSpacing}
                  min={1}
                  max={200}
                  suffix="%"
                  widthClass="w-16"
                  onChange={(v) => setToolOption("brushSpacing", v)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-1">
              <span>Pattern Align:</span>
              <PixelSelect
                ariaLabel="Pattern Alignment"
                value={toolOptions.patternAlign}
                onChange={(v) => setToolOption("patternAlign", v as PatternAlignMode)}
                options={[
                  { value: "none", label: "Paint Brush (Normal)" },
                  { value: "source", label: "Aligned to Source" },
                  { value: "destination", label: "Aligned to Destination" },
                ]}
              />
            </div>

            <div className="flex items-center gap-2">
              <PixelCheckbox
                checked={toolOptions.flipH}
                onChange={(v) => setToolOption("flipH", v)}
                label="Flip H"
              />
              <PixelCheckbox
                checked={toolOptions.flipV}
                onChange={(v) => setToolOption("flipV", v)}
                label="Flip V"
              />
            </div>

            <div className="border-t border-black/20 pt-1.5 space-y-1">
              <div className="text-[11px] font-bold">Tablet &amp; Stroke Dynamics:</div>
              <div className="grid grid-cols-2 gap-1">
                <PixelCheckbox
                  checked={toolOptions.pressureSize}
                  onChange={(v) => setToolOption("pressureSize", v)}
                  label="Pressure->Size"
                />
                <PixelCheckbox
                  checked={toolOptions.pressureAngle}
                  onChange={(v) => setToolOption("pressureAngle", v)}
                  label="Pressure->Angle"
                />
                <PixelCheckbox
                  checked={toolOptions.velocitySize}
                  onChange={(v) => setToolOption("velocitySize", v)}
                  label="Velocity->Size"
                />
                <PixelCheckbox
                  checked={toolOptions.gradientDither}
                  onChange={(v) => setToolOption("gradientDither", v)}
                  label="Stroke Dither"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-black/20 gap-1">
              <PixelButton
                size="xs"
                onClick={() => {
                  captureCustomBrushFromCanvas();
                  setShowBrushPopup(false);
                }}
              >
                Capture Stamp (Ctrl+B)
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => {
                  saveCurrentBrushToLibrary();
                  setShowBrushPopup(false);
                }}
              >
                + Save Brush
              </PixelButton>
            </div>
          </div>
        )}
      </div>

      {/* 2. Brush Size Input (1..128px) */}
      <NumberField
        ariaLabel="Brush Size"
        value={toolOptions.brushSize}
        min={1}
        max={128}
        suffix="px"
        widthClass="w-14"
        onChange={(v) => setToolOption("brushSize", v)}
      />

      {/* 3. Ink Mode Selector */}
      <div className="flex items-center gap-1">
        <PixelIcon name="ink_flask" size={12} />
        <PixelSelect
          ariaLabel="Ink Mode"
          value={toolOptions.inkMode}
          onChange={(v) => setToolOption("inkMode", v as InkMode)}
          options={[
            { value: "simple", label: "Ink: Simple" },
            { value: "alpha_compositing", label: "Ink: Alpha Compositing" },
            { value: "copy_color_alpha", label: "Ink: Copy Color+Alpha" },
            { value: "lock_alpha", label: "Ink: Lock Alpha" },
            { value: "shading", label: "Ink: Shading Ramp" },
          ]}
        />
      </div>

      {toolOptions.inkMode === "shading" && (
        <div className="flex items-center gap-1 bg-black/15 px-1.5 py-0.5 rounded">
          <span className="text-[10px]">Ramp:</span>
          <NumberField
            ariaLabel="Shading Ramp Start Index"
            value={toolOptions.shadingRampFrom}
            min={0}
            max={31}
            widthClass="w-10"
            onChange={(v) => setToolOption("shadingRampFrom", v)}
          />
          <span>..</span>
          <NumberField
            ariaLabel="Shading Ramp End Index"
            value={toolOptions.shadingRampTo}
            min={0}
            max={31}
            widthClass="w-10"
            onChange={(v) => setToolOption("shadingRampTo", v)}
          />
        </div>
      )}

      {/* 4. Opacity */}
      <div className="flex items-center gap-1">
        <span className="text-[11px]">Op:</span>
        <NumberField
          ariaLabel="Brush Opacity"
          value={toolOptions.opacity}
          min={1}
          max={255}
          widthClass="w-12"
          onChange={(v) => setToolOption("opacity", v)}
        />
      </div>

      {/* 5. Ordered Dither Matrix Selector */}
      <div className="flex items-center gap-1">
        <PixelSelect
          ariaLabel="Dither Matrix"
          value={toolOptions.ditherMatrixId}
          onChange={(v) => setToolOption("ditherMatrixId", v as DitherMatrixId)}
          options={[
            { value: "none", label: "Dither: Off" },
            { value: "bayer2x2", label: "Bayer 2x2" },
            { value: "bayer4x4", label: "Bayer 4x4" },
            { value: "bayer8x8", label: "Bayer 8x8" },
            { value: "checkerboard", label: "Checkerboard" },
            { value: "horizontal_lines", label: "Horiz Lines" },
            { value: "vertical_lines", label: "Vert Lines" },
            { value: "diagonal_lines", label: "Diag Lines" },
            { value: "custom", label: "Custom Matrix" },
          ]}
        />
        {toolOptions.ditherMatrixId !== "none" && (
          <PixelButton
            size="xs"
            title="Open Custom Dither Matrix Editor"
            onClick={() => openDialog("dialog.dither_matrix")}
          >
            Matrix...
          </PixelButton>
        )}
      </div>

      {/* 6. Symmetry / Mirror Selector & Options Popup (B05, B22) */}
      <div className="relative flex items-center gap-1">
        <PixelSelect
          ariaLabel="Symmetry Mode"
          value={toolOptions.symmetryMode}
          onChange={(v) => setToolOption("symmetryMode", v as SymmetryMode)}
          options={[
            {
              value: "none",
              label: `${toolOptions.symmetryMode === "none" ? "✓ " : ""}Sym: Off`,
            },
            {
              value: "horizontal",
              label: `${toolOptions.symmetryMode === "horizontal" ? "✓ " : ""}Sym: Horiz`,
            },
            {
              value: "vertical",
              label: `${toolOptions.symmetryMode === "vertical" ? "✓ " : ""}Sym: Vert`,
            },
            {
              value: "both",
              label: `${toolOptions.symmetryMode === "both" ? "✓ " : ""}Sym: Quad (4x)`,
            },
            {
              value: "diagonal_pos",
              label: `${toolOptions.symmetryMode === "diagonal_pos" ? "✓ " : ""}Sym: Diag \\`,
            },
            {
              value: "diagonal_neg",
              label: `${toolOptions.symmetryMode === "diagonal_neg" ? "✓ " : ""}Sym: Diag /`,
            },
            {
              value: "eight_way",
              label: `${toolOptions.symmetryMode === "eight_way" ? "✓ " : ""}Sym: 8-Way (All)`,
            },
          ]}
        />
        {toolOptions.symmetryMode !== "none" && (
          <PixelButton
            size="xs"
            title="Symmetry Axis Position Options"
            onClick={() => {
              setShowSymPopup(!showSymPopup);
              setShowBrushPopup(false);
            }}
          >
            Axis
          </PixelButton>
        )}

        {showSymPopup && doc && (
          <div className="absolute left-0 top-full mt-1 w-60 kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] p-2 shadow-2xl z-50 space-y-1.5">
            <div className="font-bold text-xs border-b border-black/30 pb-1 flex items-center justify-between">
              <span>Symmetry Axis Position</span>
              <button type="button" onClick={() => setShowSymPopup(false)}>
                <PixelIcon name="close" size={10} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span>Axis X:</span>
              <NumberField
                ariaLabel="Symmetry Axis X"
                value={toolOptions.symmetryX ?? doc.sprite.width / 2}
                min={0.5}
                max={doc.sprite.width - 0.5}
                step={0.5}
                suffix="px"
                widthClass="w-20"
                onChange={(v) => setToolOption("symmetryX", v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <span>Axis Y:</span>
              <NumberField
                ariaLabel="Symmetry Axis Y"
                value={toolOptions.symmetryY ?? doc.sprite.height / 2}
                min={0.5}
                max={doc.sprite.height - 0.5}
                step={0.5}
                suffix="px"
                widthClass="w-20"
                onChange={(v) => setToolOption("symmetryY", v)}
              />
            </div>
            <PixelButton
              size="xs"
              onClick={() => {
                setToolOption("symmetryX", doc.sprite.width / 2);
                setToolOption("symmetryY", doc.sprite.height / 2);
              }}
            >
              Reset to Center
            </PixelButton>
          </div>
        )}
      </div>

      {/* 7. Tiled Mode Selector (B04) */}
      <PixelSelect
        ariaLabel="Tiled Mode"
        value={tiledMode}
        onChange={(v) => setTiledMode(v as TiledMode)}
        options={[
          { value: "none", label: "Tiled: Off" },
          { value: "both", label: "Tiled: Both (3x3)" },
          { value: "x", label: "Tiled: X Axis" },
          { value: "y", label: "Tiled: Y Axis" },
        ]}
      />

      {/* 7b. Grid Quick Button: Click toggles Grid, Double-Click opens Grid Settings Dialog (B07) */}
      <PixelButton
        size="xs"
        dataTestId="contextbar-grid-btn"
        active={showGrid}
        title="Click: Toggle Grid (Ctrl+') | Double-Click: Grid Settings..."
        onClick={() => toggleGrid()}
        onDoubleClick={() => openDialog("dialog.grid_settings")}
      >
        <PixelIcon name="grid" size={11} />
        <span>Grid</span>
      </PixelButton>

      {/* 8. Pixel-Perfect & Stabilizer */}
      {(activeToolId === "tool.pencil" || activeToolId === "tool.eraser") && (
        <>
          <PixelCheckbox
            checked={toolOptions.pixelPerfect}
            onChange={(v) => setToolOption("pixelPerfect", v)}
            label={t("common.pixel_perfect")}
          />
          <div className="flex items-center gap-1" title="Stroke Stabilizer Factor (0..32)">
            <span className="text-[11px]">Stab:</span>
            <NumberField
              ariaLabel="Stabilizer Factor"
              value={toolOptions.stabilizerFactor}
              min={0}
              max={32}
              widthClass="w-11"
              onChange={(v) => setToolOption("stabilizerFactor", v)}
            />
          </div>
        </>
      )}

      {/* Tool-specific controls */}
      {activeToolId === "tool.spray" && (
        <div className="flex items-center gap-1.5">
          <span>Width:</span>
          <NumberField
            ariaLabel="Spray Width"
            value={toolOptions.sprayWidth}
            min={1}
            max={64}
            widthClass="w-12"
            onChange={(v) => setToolOption("sprayWidth", v)}
          />
          <span>Speed:</span>
          <NumberField
            ariaLabel="Spray Speed"
            value={toolOptions.spraySpeed}
            min={1}
            max={100}
            widthClass="w-12"
            onChange={(v) => setToolOption("spraySpeed", v)}
          />
        </div>
      )}

      {activeToolId === "tool.paint_bucket" && (
        <div className="flex items-center gap-1.5">
          <span>Tol:</span>
          <NumberField
            ariaLabel="Flood Fill Tolerance"
            value={toolOptions.tolerance}
            min={0}
            max={255}
            widthClass="w-12"
            onChange={(v) => setToolOption("tolerance", v)}
          />
          <PixelCheckbox
            checked={toolOptions.contiguous}
            onChange={(v) => setToolOption("contiguous", v)}
            label="Contiguous"
          />
          <PixelCheckbox
            checked={toolOptions.eightConnected}
            onChange={(v) => setToolOption("eightConnected", v)}
            label="8-Way"
          />
        </div>
      )}

      {activeToolId === "tool.gradient" && (
        <div className="flex items-center gap-1.5">
          <PixelSelect
            ariaLabel="Gradient Type"
            value={toolOptions.gradientType}
            onChange={(v) => setToolOption("gradientType", v as GradientType)}
            options={[
              { value: "linear", label: "Linear" },
              { value: "radial", label: "Radial" },
            ]}
          />
          <PixelSelect
            ariaLabel="Gradient Dither Mode"
            value={toolOptions.gradientDitherMode}
            onChange={(v) => setToolOption("gradientDitherMode", v as GradientDitherMode)}
            options={[
              { value: "bayer4x4", label: "Bayer 4x4" },
              { value: "bayer2x2", label: "Bayer 2x2" },
              { value: "bayer8x8", label: "Bayer 8x8" },
              { value: "floyd_steinberg", label: "Floyd-Steinberg" },
              { value: "old_style", label: "Old-Style" },
              { value: "none", label: "No Dither" },
            ]}
          />
          <PixelCheckbox
            checked={toolOptions.contiguous}
            onChange={(v) => setToolOption("contiguous", v)}
            label="Contiguous"
          />
        </div>
      )}

      {(activeToolId === "tool.rectangle" ||
        activeToolId === "tool.ellipse" ||
        activeToolId === "tool.polygon") && (
        <PixelCheckbox
          checked={toolOptions.shapeFilled}
          onChange={(v) => setToolOption("shapeFilled", v)}
          label="Filled Shape"
        />
      )}

      {activeToolId === "tool.slice" && (
        <div className="flex items-center gap-1 bg-black/10 px-1.5 py-0.5 border border-black/25">
          <span className="font-bold">Slices:</span>
          <PixelButton size="xs" onClick={() => openDialog("dialog.slice_properties")}>
            Slice Properties...
          </PixelButton>
          {activeSliceId && (
            <>
              <PixelButton size="xs" onClick={() => selectSliceBounds(activeSliceId)}>
                Select Bounds
              </PixelButton>
              <PixelButton size="xs" onClick={() => exportSliceAsNewDocument(activeSliceId)}>
                Export Slice
              </PixelButton>
            </>
          )}
        </div>
      )}

      {activeLayer && activeLayer.kind === "tilemap" && (
        <div className="flex items-center gap-1 bg-sky-900/20 px-1.5 py-0.5 border border-black/30">
          <PixelSelect
            ariaLabel="ContextBar Tilemap Mode"
            value={tilemapEditMode}
            onChange={(v) => setTilemapEditMode(v as TilemapEditMode)}
            options={[
              { value: "tiles", label: "Tiles Mode" },
              { value: "pixels", label: "Pixels Mode" },
            ]}
          />
          <PixelSelect
            ariaLabel="ContextBar Tileset Mod Mode"
            value={tilesetModMode}
            onChange={(v) => setTilesetModMode(v as TilesetModificationMode)}
            options={[
              { value: "auto", label: "Auto" },
              { value: "stack", label: "Stack" },
              { value: "manual", label: "Manual" },
            ]}
          />
          <span>Tile#:</span>
          <NumberField
            ariaLabel="ContextBar Active Tile Index"
            value={activeTileIndex}
            min={0}
            max={255}
            widthClass="w-12"
            onChange={setActiveTileIndex}
          />
          <PixelButton
            size="xs"
            active={tileFlipX}
            onClick={() => toggleTileFlag("flipX")}
            title="Tile Flip X"
          >
            FX
          </PixelButton>
          <PixelButton
            size="xs"
            active={tileFlipY}
            onClick={() => toggleTileFlag("flipY")}
            title="Tile Flip Y"
          >
            FY
          </PixelButton>
          <PixelButton
            size="xs"
            active={tileRot90}
            onClick={() => toggleTileFlag("rot90")}
            title="Tile Rotate 90°"
          >
            R90
          </PixelButton>
        </div>
      )}

      {activeToolId === "tool.text" && (
        <div className="flex items-center gap-1.5">
          <TextField
            ariaLabel="Text Tool String"
            value={toolOptions.textContent}
            onChange={(val) => setToolOption("textContent", val)}
            className="px-1.5 py-0.5 text-xs w-24"
            placeholder="Text..."
          />
          <NumberField
            ariaLabel="Text Font Size"
            value={toolOptions.textFontSize}
            min={7}
            max={56}
            suffix="px"
            widthClass="w-14"
            onChange={(v) => setToolOption("textFontSize", v)}
          />
          <PixelCheckbox
            checked={toolOptions.textAntiAlias}
            onChange={(v) => setToolOption("textAntiAlias", v)}
            label="Anti-Alias"
          />
        </div>
      )}

      {(activeToolId === "tool.eyedropper" ||
        activeToolId === "tool.paint_bucket" ||
        activeToolId === "tool.magic_wand") && (
        <PixelSelect
          ariaLabel="Sample Mode"
          value={toolOptions.sampleMode}
          onChange={(v) => setToolOption("sampleMode", v as "composite" | "current")}
          options={[
            { value: "composite", label: "Sample: All Layers" },
            { value: "current", label: "Sample: Current Layer" },
          ]}
        />
      )}

      {/* Agent 4 Selection Tools Context Bar */}
      {isSelectionTool && (
        <div className="flex flex-wrap items-center gap-1 bg-amber-950/20 px-1.5 py-0.5 border border-black/30">
          <span className="font-bold text-[11px]">Sel:</span>
          {(
            [
              ["replace", "Replace", "Replace Selection"],
              ["add", "+Add", "Add to Selection (Shift)"],
              ["subtract", "-Sub", "Subtract from Selection (Alt)"],
              ["intersect", "∩Int", "Intersect Selection (Shift+Alt)"],
            ] as const
          ).map(([mId, label, tip]) => (
            <PixelButton
              key={mId}
              size="xs"
              active={toolOptions.selectionMode === mId}
              title={tip}
              onClick={() => setToolOption("selectionMode", mId as SelectionCombineMode)}
            >
              {label}
            </PixelButton>
          ))}

          {(activeToolId === "tool.marquee_rect" ||
            activeToolId === "tool.marquee_ellipse") && (
            <>
              <PixelSelect
                ariaLabel="Marquee Constraint"
                value={toolOptions.marqueeConstraint}
                onChange={(v) =>
                  setToolOption("marqueeConstraint", v as MarqueeConstraintMode)
                }
                options={[
                  { value: "free", label: "Free Size" },
                  { value: "fixed_ratio", label: "Fixed Ratio" },
                  { value: "fixed_size", label: "Fixed Size" },
                ]}
              />
              {toolOptions.marqueeConstraint === "fixed_ratio" && (
                <>
                  <NumberField
                    ariaLabel="Marquee Ratio Width"
                    value={toolOptions.marqueeRatioW}
                    min={1}
                    max={64}
                    widthClass="w-10"
                    onChange={(v) => setToolOption("marqueeRatioW", v)}
                  />
                  <span>:</span>
                  <NumberField
                    ariaLabel="Marquee Ratio Height"
                    value={toolOptions.marqueeRatioH}
                    min={1}
                    max={64}
                    widthClass="w-10"
                    onChange={(v) => setToolOption("marqueeRatioH", v)}
                  />
                </>
              )}
              {toolOptions.marqueeConstraint === "fixed_size" && (
                <>
                  <NumberField
                    ariaLabel="Marquee Fixed Width"
                    value={toolOptions.marqueeFixedW}
                    min={1}
                    max={1024}
                    suffix="px"
                    widthClass="w-14"
                    onChange={(v) => setToolOption("marqueeFixedW", v)}
                  />
                  <span>×</span>
                  <NumberField
                    ariaLabel="Marquee Fixed Height"
                    value={toolOptions.marqueeFixedH}
                    min={1}
                    max={1024}
                    suffix="px"
                    widthClass="w-14"
                    onChange={(v) => setToolOption("marqueeFixedH", v)}
                  />
                </>
              )}
            </>
          )}

          {activeToolId === "tool.magic_wand" && (
            <>
              <span>Tol:</span>
              <NumberField
                ariaLabel="Magic Wand Tolerance"
                value={toolOptions.tolerance}
                min={0}
                max={255}
                widthClass="w-12"
                onChange={(v) => setToolOption("tolerance", v)}
              />
              <PixelCheckbox
                checked={toolOptions.contiguous}
                onChange={(v) => setToolOption("contiguous", v)}
                label="Contiguous"
              />
              <PixelCheckbox
                checked={toolOptions.eightConnected}
                onChange={(v) => setToolOption("eightConnected", v)}
                label="8-Way"
              />
            </>
          )}

          {/* Live Numeric Position / Size Fields for Active Selection Bounds */}
          {doc && doc.sprite.mask.bounds && (
            <div className="flex items-center gap-1 border-l border-black/25 pl-1.5">
              <span>X:</span>
              <NumberField
                ariaLabel="Selection Bounds X"
                value={doc.sprite.mask.bounds.x}
                min={0}
                max={doc.sprite.width - 1}
                widthClass="w-11"
                onChange={(nx) => {
                  const b = doc.sprite.mask.bounds!;
                  const m = new Mask(doc.sprite.width, doc.sprite.height);
                  m.selectRect({ x: nx, y: b.y, width: b.width, height: b.height });
                  doc.transact("Set Selection X", (tx) => tx.setMask(m, "Set Selection X"));
                  bumpRevision();
                }}
              />
              <span>Y:</span>
              <NumberField
                ariaLabel="Selection Bounds Y"
                value={doc.sprite.mask.bounds.y}
                min={0}
                max={doc.sprite.height - 1}
                widthClass="w-11"
                onChange={(ny) => {
                  const b = doc.sprite.mask.bounds!;
                  const m = new Mask(doc.sprite.width, doc.sprite.height);
                  m.selectRect({ x: b.x, y: ny, width: b.width, height: b.height });
                  doc.transact("Set Selection Y", (tx) => tx.setMask(m, "Set Selection Y"));
                  bumpRevision();
                }}
              />
              <span>W:</span>
              <NumberField
                ariaLabel="Selection Bounds Width"
                value={doc.sprite.mask.bounds.width}
                min={1}
                max={doc.sprite.width}
                widthClass="w-11"
                onChange={(nw) => {
                  const b = doc.sprite.mask.bounds!;
                  const m = new Mask(doc.sprite.width, doc.sprite.height);
                  m.selectRect({ x: b.x, y: b.y, width: nw, height: b.height });
                  doc.transact("Set Selection Width", (tx) =>
                    tx.setMask(m, "Set Selection Width")
                  );
                  bumpRevision();
                }}
              />
              <span>H:</span>
              <NumberField
                ariaLabel="Selection Bounds Height"
                value={doc.sprite.mask.bounds.height}
                min={1}
                max={doc.sprite.height}
                widthClass="w-11"
                onChange={(nh) => {
                  const b = doc.sprite.mask.bounds!;
                  const m = new Mask(doc.sprite.width, doc.sprite.height);
                  m.selectRect({ x: b.x, y: b.y, width: b.width, height: nh });
                  doc.transact("Set Selection Height", (tx) =>
                    tx.setMask(m, "Set Selection Height")
                  );
                  bumpRevision();
                }}
              />
            </div>
          )}

          <PixelCheckbox
            checked={showSelectionEdges}
            onChange={(v) => setShowSelectionEdges(v)}
            label="Edges"
          />
          <PixelButton size="xs" onClick={() => openDialog("dialog.select_modify")}>
            Modify...
          </PixelButton>
          <PixelButton size="xs" onClick={() => openDialog("dialog.color_range")}>
            Color Range...
          </PixelButton>
        </div>
      )}

      {/* Agent 4 Move & Transform Tool Context Bar */}
      {activeToolId === "tool.move" && (
        <div className="flex flex-wrap items-center gap-1 bg-sky-950/20 px-1.5 py-0.5 border border-black/30">
          <span className="font-bold text-[11px]">Move:</span>
          <PixelSelect
            ariaLabel="Move Target Mode"
            value={toolOptions.moveTargetMode}
            onChange={(v) =>
              setToolOption(
                "moveTargetMode",
                v as "auto" | "selection_pixels" | "selection_mask" | "cel"
              )
            }
            options={[
              { value: "auto", label: "Auto (Pixels / Cel)" },
              { value: "selection_pixels", label: "Selection Pixels" },
              { value: "selection_mask", label: "Selection Mask Only" },
              { value: "cel", label: "Whole Cel" },
            ]}
          />
          <PixelSelect
            ariaLabel="Transform Interpolation Algorithm"
            value={toolOptions.transformAlgorithm}
            onChange={(v) =>
              setToolOption("transformAlgorithm", v as "fast" | "rotsprite" | "bilinear")
            }
            options={[
              { value: "rotsprite", label: "Alg: RotSprite" },
              { value: "fast", label: "Alg: Fast Nearest" },
              { value: "bilinear", label: "Alg: Bilinear" },
            ]}
          />
          <PixelButton
            size="xs"
            dataTestId="move-flip-h-btn"
            onClick={() => runCommandById("edit.flip_h")}
          >
            Flip H
          </PixelButton>
          <PixelButton
            size="xs"
            dataTestId="move-flip-v-btn"
            onClick={() => runCommandById("edit.flip_v")}
          >
            Flip V
          </PixelButton>
          <PixelButton size="xs" onClick={() => openDialog("dialog.rotate_angle")}>
            Rotate...
          </PixelButton>
        </div>
      )}
    </div>
  );
};

/**
 * 4. Right / Left Vertical ToolBar Strip (matching Screenshot 1 & 2)
 */
export const ToolBar: React.FC = () => {
  const activeToolId = useAppStore((s) => s.activeToolId);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const tools = ToolRegistry.getAll();

  return (
    <div className="w-9 bg-[var(--kpx-chrome-bg)] border-l border-r border-black p-1 flex flex-col items-center gap-1 select-none shrink-0 overflow-y-auto">
      {tools.map((tool) => {
        const isPlanned = tool.state === "planned";
        const isActive = activeToolId === tool.id;
        const tooltip = isPlanned
          ? `${tool.title} (${tool.defaultShortcut}) — Planned: Agent ${tool.ownerAgent}`
          : `${tool.title} (${tool.defaultShortcut})`;

        return (
          <button
            key={tool.id}
            type="button"
            disabled={isPlanned}
            title={tooltip}
            aria-label={tool.title}
            data-testid={`toolbar-${tool.id}`}
            onClick={() => !isPlanned && setActiveTool(tool.id)}
            className={`w-7 h-7 flex items-center justify-center ${
              isActive
                ? "kpx-bevel-inset bg-[#516b7d] text-white"
                : "kpx-bevel-outset bg-[var(--kpx-btn-bg)] text-black"
            } ${
              isPlanned
                ? "opacity-45 cursor-not-allowed"
                : "hover:brightness-105 cursor-pointer"
            }`}
          >
            <PixelIcon name={tool.icon} size={14} />
          </button>
        );
      })}
    </div>
  );
};

/**
 * 5. DockManager: renders the v2 dock tree (see `./dock.tsx`) around the canvas + toolbar,
 * floating windows and the drag-to-dock overlay.
 */
export const DockManager: React.FC<{ centerContent: React.ReactNode }> = ({ centerContent }) => {
  const toolbarSide = useAppStore((s) => s.currentLayout.toolbarSide);
  const center = (
    <div className="flex h-full w-full overflow-hidden">
      {toolbarSide === "left" && <ToolBar />}
      <div className="flex-1 min-w-0 h-full overflow-hidden">{centerContent}</div>
      {toolbarSide === "right" && <ToolBar />}
    </div>
  );
  return <DockView center={center} />;
};

/**
 * 7. Bottom Status Bar (matching Screenshot 1 & 2)
 */
export const StatusBar: React.FC = () => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const cursorPos = useAppStore((s) => s.cursorPos);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const zoom = useAppStore((s) => s.zoom);
  const locale = useAppStore((s) => s.locale);
  const renderBackend = useAppStore((s) => s.renderBackend);
  const setRenderBackend = useAppStore((s) => s.setRenderBackend);
  const setActiveFrame = useAppStore((s) => s.setActiveFrame);
  const setZoom = useAppStore((s) => s.setZoom);
  const runCommandById = useAppStore((s) => s.runCommandById);

  void rev;

  const sprite = doc?.sprite;
  const frameDuration = sprite?.frames[activeFrameIndex]?.durationMs ?? 100;

  return (
    <div className="h-7 px-2 bg-[var(--kpx-chrome-bg)] border-t border-black flex items-center justify-between text-xs font-mono text-black select-none shrink-0">
      {/* Left coordinate & sprite metrics */}
      <div className="flex items-center gap-3 truncate">
        {sprite ? (
          <span>
            {t("status.pos", locale)}{" "}
            {cursorPos
              ? `${formatLocalizedNumber(cursorPos.x, locale)} ${formatLocalizedNumber(
                  cursorPos.y,
                  locale
                )}`
              : "-- --"}
            , {t("status.size", locale)} {formatLocalizedNumber(sprite.width, locale)}{" "}
            {formatLocalizedNumber(sprite.height, locale)}, {t("status.ratio", locale)}{" "}
            {formatLocalizedNumber(sprite.pixelRatio.w, locale)}:
            {formatLocalizedNumber(sprite.pixelRatio.h, locale)}, {t("status.frame", locale)}{" "}
            {formatLocalizedNumber(activeFrameIndex + 1, locale)} [
            {formatLocalizedNumber(frameDuration, locale)} msecs]
          </span>
        ) : (
          <span>{t("app.ready", locale)}</span>
        )}
      </div>

      {/* Right Frame input + "+" button + Renderer toggle + Zoom field */}
      {sprite && (
        <div className="flex items-center gap-1.5 shrink-0">
          <PixelButton
            size="xs"
            title="Switch Renderer Backend (WebGL2 vs Canvas2D)"
            onClick={() =>
              setRenderBackend(renderBackend === "webgl2" ? "canvas2d" : "webgl2")
            }
          >
            {renderBackend.toUpperCase()}
          </PixelButton>
          <span>Frame:</span>
          <NumberField
            ariaLabel="Active Frame Number"
            value={activeFrameIndex + 1}
            min={1}
            max={sprite.frames.length}
            widthClass="w-14"
            onChange={(val) => setActiveFrame(val - 1)}
          />
          <PixelButton
            size="xs"
            title="New Frame (Alt+N)"
            onClick={() => runCommandById("frame.new")}
          >
            +
          </PixelButton>
          <PixelSelect
            ariaLabel="Canvas Zoom Percentage"
            value={String(zoom)}
            onChange={(val) => setZoom(parseFloat(val))}
            options={[
              { value: "25", label: "25.0% (1:4)" },
              { value: "50", label: "50.0% (1:2)" },
              { value: "100", label: "100.0% (1:1)" },
              { value: "200", label: "200.0% (2:1)" },
              { value: "300", label: "300.0% (3:1)" },
              { value: "400", label: "400.0% (4:1)" },
              { value: "600", label: "600.0% (6:1)" },
              { value: "800", label: "800.0% (8:1)" },
              { value: "1200", label: "1200.0% (12:1)" },
              { value: "1600", label: "1600.0% (16:1)" },
              { value: "3200", label: "3200.0% (32:1)" },
              { value: "6400", label: "6400.0% (64:1)" },
            ]}
          />
        </div>
      )}
    </div>
  );
};

export {
  formatWindowDocumentTitle,
  TitleBar,
  type TitleBarProps,
} from "./TitleBar.tsx";
