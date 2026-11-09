/**
 * @module @kekenik/ui/skin
 * Original pixel-art skin tokens, 9-slice 1-px bevel styles, and 85 original 16x16 pixel SVG icons.
 */

import React from "react";
import { ThemeId, ThemeRegistry } from "../../../core/src/index.ts";

export interface ThemeTokens {
  readonly id: ThemeId;
  readonly name: string;
  readonly windowBg: string;
  readonly chromeBg: string;
  readonly panelBg: string;
  readonly headerBg: string;
  readonly headerActiveBg: string;
  readonly headerText: string;
  readonly canvasSurroundBg: string;
  readonly inputBg: string;
  readonly inputText: string;
  readonly textPrimary: string;
  readonly textMuted: string;
  readonly accentBg: string;
  readonly accentText: string;
  readonly borderOuter: string;
  readonly bevelLight: string;
  readonly bevelDark: string;
  readonly buttonBg: string;
  readonly buttonActiveBg: string;
  readonly tabActiveBg: string;
  readonly tabInactiveBg: string;
  readonly timelineRowBg: string;
  readonly timelineRowAltBg: string;
  readonly timelineSelectedBg: string;
}

export const THEME_TOKENS: Record<ThemeId, ThemeTokens> = {
  "default-dark": {
    id: "default-dark",
    name: "Default Dark (Slate & Warm Gray)",
    windowBg: "#49434d",
    chromeBg: "#7d929e",
    panelBg: "#c9c1b9",
    headerBg: "#6a8190",
    headerActiveBg: "#516b7d",
    headerText: "#ffffff",
    canvasSurroundBg: "#5b5360",
    inputBg: "#ffffff",
    inputText: "#18181b",
    textPrimary: "#141418",
    textMuted: "#47434a",
    accentBg: "#355d7a",
    accentText: "#ffffff",
    borderOuter: "#17151a",
    bevelLight: "#f2ece6",
    bevelDark: "#6d6661",
    buttonBg: "#d4cdc6",
    buttonActiveBg: "#6a8190",
    tabActiveBg: "#7d929e",
    tabInactiveBg: "#b5ada5",
    timelineRowBg: "#bab2aa",
    timelineRowAltBg: "#b0a8a0",
    timelineSelectedBg: "#6a8190",
  },
  "classic-light": {
    id: "classic-light",
    name: "Classic Light (Warm Putty)",
    windowBg: "#bdb5ad",
    chromeBg: "#8ba0ad",
    panelBg: "#dfd8d0",
    headerBg: "#788f9e",
    headerActiveBg: "#5a7586",
    headerText: "#ffffff",
    canvasSurroundBg: "#7a727e",
    inputBg: "#ffffff",
    inputText: "#111111",
    textPrimary: "#111111",
    textMuted: "#4f4a45",
    accentBg: "#2e5f85",
    accentText: "#ffffff",
    borderOuter: "#1c1917",
    bevelLight: "#ffffff",
    bevelDark: "#7c756e",
    buttonBg: "#e7e1da",
    buttonActiveBg: "#788f9e",
    tabActiveBg: "#8ba0ad",
    tabInactiveBg: "#c9c1b9",
    timelineRowBg: "#d4cdc5",
    timelineRowAltBg: "#c9c1b9",
    timelineSelectedBg: "#6d8696",
  },
  "high-contrast": {
    id: "high-contrast",
    name: "High Contrast (Midnight Pixel)",
    windowBg: "#0f1218",
    chromeBg: "#1b2432",
    panelBg: "#1e2633",
    headerBg: "#253449",
    headerActiveBg: "#0284c7",
    headerText: "#f8fafc",
    canvasSurroundBg: "#090b10",
    inputBg: "#0b0f17",
    inputText: "#f8fafc",
    textPrimary: "#f1f5f9",
    textMuted: "#94a3b8",
    accentBg: "#0284c7",
    accentText: "#ffffff",
    borderOuter: "#000000",
    bevelLight: "#475569",
    bevelDark: "#020617",
    buttonBg: "#283446",
    buttonActiveBg: "#0284c7",
    tabActiveBg: "#1b2432",
    tabInactiveBg: "#111722",
    timelineRowBg: "#18202c",
    timelineRowAltBg: "#141b26",
    timelineSelectedBg: "#0369a1",
  },
};

/**
 * Resolves theme tokens by ID from `ThemeRegistry` (including installed `.kpext` themes),
 * falling back to `THEME_TOKENS["default-dark"]`.
 */
export function getThemeTokens(themeId: string): ThemeTokens {
  const fromRegistry = ThemeRegistry.get(themeId);
  if (fromRegistry) {
    return fromRegistry as ThemeTokens;
  }
  return THEME_TOKENS[themeId] ?? THEME_TOKENS["default-dark"];
}

export type PixelIconName =
  | "home"
  | "pencil"
  | "spray"
  | "eraser"
  | "eyedropper"
  | "zoom"
  | "hand"
  | "move"
  | "marquee_rect"
  | "marquee_ellipse"
  | "lasso"
  | "polygonal_lasso"
  | "magic_wand"
  | "bucket"
  | "gradient"
  | "line"
  | "curve"
  | "rectangle"
  | "ellipse"
  | "contour"
  | "polygon"
  | "blur"
  | "jumble"
  | "text"
  | "slice"
  | "eye_open"
  | "eye_closed"
  | "lock_closed"
  | "lock_open"
  | "linked"
  | "unlinked"
  | "gear"
  | "onion"
  | "play"
  | "pause"
  | "first_frame"
  | "prev_frame"
  | "next_frame"
  | "last_frame"
  | "plus"
  | "minus"
  | "close"
  | "pin"
  | "unpin"
  | "float"
  | "dock"
  | "folder"
  | "layer_new"
  | "layer_group"
  | "layer_tilemap"
  | "trash"
  | "arrow_up"
  | "arrow_down"
  | "arrow_left"
  | "arrow_right"
  | "check"
  | "warning"
  | "error"
  | "info"
  | "history"
  | "palette"
  | "colorpicker"
  | "timeline"
  | "preview"
  | "layers"
  | "brush"
  | "navigator"
  | "log"
  | "symmetry_h"
  | "symmetry_v"
  | "grid"
  | "pixel_perfect"
  | "ink_flask"
  | "shape_square"
  | "shape_circle"
  | "swap"
  | "save"
  | "download"
  | "keyboard"
  | "workspace"
  | "rgb_circles"
  | "grayscale_bar"
  | "indexed_grid"
  | "checker_tile"
  | "menu_bars"
  | "one_to_one"
  | "tag";

export const ALL_ICON_NAMES: readonly PixelIconName[] = [
  "home",
  "pencil",
  "spray",
  "eraser",
  "eyedropper",
  "zoom",
  "hand",
  "move",
  "marquee_rect",
  "marquee_ellipse",
  "lasso",
  "polygonal_lasso",
  "magic_wand",
  "bucket",
  "gradient",
  "line",
  "curve",
  "rectangle",
  "ellipse",
  "contour",
  "polygon",
  "blur",
  "jumble",
  "text",
  "slice",
  "eye_open",
  "eye_closed",
  "lock_closed",
  "lock_open",
  "linked",
  "unlinked",
  "gear",
  "onion",
  "play",
  "pause",
  "first_frame",
  "prev_frame",
  "next_frame",
  "last_frame",
  "plus",
  "minus",
  "close",
  "pin",
  "unpin",
  "float",
  "dock",
  "folder",
  "layer_new",
  "layer_group",
  "layer_tilemap",
  "trash",
  "arrow_up",
  "arrow_down",
  "arrow_left",
  "arrow_right",
  "check",
  "warning",
  "error",
  "info",
  "history",
  "palette",
  "colorpicker",
  "timeline",
  "preview",
  "layers",
  "brush",
  "navigator",
  "log",
  "symmetry_h",
  "symmetry_v",
  "grid",
  "pixel_perfect",
  "ink_flask",
  "shape_square",
  "shape_circle",
  "swap",
  "save",
  "download",
  "keyboard",
  "workspace",
  "rgb_circles",
  "grayscale_bar",
  "indexed_grid",
  "checker_tile",
  "menu_bars",
  "one_to_one",
  "tag",
];

/**
 * Renders an original 16x16 crisp-edged pixel-art SVG icon.
 */
export const PixelIcon: React.FC<{
  name: PixelIconName | string;
  size?: number;
  className?: string;
}> = ({ name, size = 14, className = "" }) => {
  const renderPixels = () => {
    switch (name) {
      case "home":
        return (
          <>
            <path d="M7 2h2v1h2v1h2v2h1v2h-2v6H4V8H2V6h1V4h2V3h2V2z" fill="currentColor" />
            <rect x="7" y="10" width="2" height="4" fill="#c9c1b9" />
          </>
        );
      case "pencil":
        return (
          <>
            <path d="M11 2h3v3l-8 8H3v-3l8-8z" fill="currentColor" />
            <rect x="2" y="12" width="2" height="2" fill="currentColor" />
          </>
        );
      case "spray":
        return (
          <>
            <rect x="2" y="3" width="2" height="2" fill="currentColor" />
            <rect x="5" y="2" width="2" height="2" fill="currentColor" />
            <rect x="5" y="5" width="2" height="2" fill="currentColor" />
            <rect x="8" y="6" width="5" height="8" fill="currentColor" />
            <rect x="9" y="4" width="3" height="2" fill="currentColor" />
          </>
        );
      case "eraser":
        return (
          <>
            <path d="M7 3h6v5l-5 5H3V8l4-5z" fill="currentColor" />
            <rect x="4" y="9" width="4" height="3" fill="#ffffff" />
          </>
        );
      case "eyedropper":
        return (
          <>
            <path d="M10 2h4v4l-2 2-4-4 2-2zM7 5l4 4-6 5H2v-3l5-6z" fill="currentColor" />
          </>
        );
      case "zoom":
        return (
          <>
            <rect x="3" y="3" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="10" y="10" width="4" height="4" fill="currentColor" />
          </>
        );
      case "hand":
        return (
          <>
            <path d="M5 2h2v5h1V2h2v5h1V4h2v8H5V7H3V5h2V2z" fill="currentColor" />
          </>
        );
      case "move":
        return (
          <>
            <rect x="7" y="1" width="2" height="14" fill="currentColor" />
            <rect x="1" y="7" width="14" height="2" fill="currentColor" />
            <rect x="6" y="2" width="4" height="2" fill="currentColor" />
            <rect x="6" y="12" width="4" height="2" fill="currentColor" />
            <rect x="2" y="6" width="2" height="4" fill="currentColor" />
            <rect x="12" y="6" width="2" height="4" fill="currentColor" />
          </>
        );
      case "marquee_rect":
        return (
          <>
            <rect x="2" y="2" width="3" height="2" fill="currentColor" />
            <rect x="7" y="2" width="3" height="2" fill="currentColor" />
            <rect x="11" y="2" width="3" height="3" fill="currentColor" />
            <rect x="2" y="6" width="2" height="3" fill="currentColor" />
            <rect x="12" y="7" width="2" height="3" fill="currentColor" />
            <rect x="2" y="11" width="3" height="3" fill="currentColor" />
            <rect x="7" y="12" width="3" height="2" fill="currentColor" />
            <rect x="11" y="11" width="3" height="3" fill="currentColor" />
          </>
        );
      case "lasso":
      case "polygonal_lasso":
        return (
          <>
            <rect x="3" y="3" width="10" height="8" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="5" y="11" width="3" height="3" fill="currentColor" />
          </>
        );
      case "magic_wand":
        return (
          <>
            <path d="M3 12L11 4l2 2-8 8-2-2z" fill="currentColor" />
            <rect x="11" y="1" width="2" height="2" fill="currentColor" />
            <rect x="13" y="5" width="2" height="2" fill="currentColor" />
            <rect x="7" y="2" width="2" height="2" fill="currentColor" />
          </>
        );
      case "bucket":
        return (
          <>
            <path d="M4 5h7v7H4V5zm7 2h3v5h-2V9h-1V7z" fill="currentColor" />
            <rect x="5" y="3" width="5" height="2" fill="currentColor" />
          </>
        );
      case "gradient":
        return (
          <>
            <rect x="2" y="2" width="5" height="12" fill="currentColor" />
            <rect x="8" y="2" width="2" height="12" fill="currentColor" />
            <rect x="12" y="2" width="2" height="12" fill="currentColor" />
          </>
        );
      case "line":
        return <path d="M2 13L13 2l1 1L3 14l-1-1z" fill="currentColor" />;
      case "curve":
        return <path d="M2 13C2 6 8 2 14 2v2C9 4 4 7 4 13H2z" fill="currentColor" />;
      case "rectangle":
        return <rect x="2" y="3" width="12" height="10" fill="none" stroke="currentColor" strokeWidth="2" />;
      case "ellipse":
      case "marquee_ellipse":
        return (
          <path
            d="M5 2h6v2h2v2h1v4h-1v2h-2v2H5v-2H3v-2H2V6h1V4h2V2zm0 2v8h6V4H5z"
            fill="currentColor"
          />
        );
      case "contour":
      case "polygon":
        return <path d="M3 4h9l2 5-5 5H3V4z" fill="currentColor" />;
      case "blur":
      case "jumble":
        return <path d="M7 2h2v3h2v3h2v5H3V8h2V5h2V2z" fill="currentColor" />;
      case "text":
        return (
          <>
            <rect x="3" y="2" width="10" height="3" fill="currentColor" />
            <rect x="7" y="5" width="2" height="9" fill="currentColor" />
            <rect x="5" y="12" width="6" height="2" fill="currentColor" />
          </>
        );
      case "slice":
        return (
          <>
            <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <rect x="6" y="2" width="1" height="12" fill="currentColor" />
            <rect x="2" y="6" width="12" height="1" fill="currentColor" />
          </>
        );
      case "eye_open":
        return (
          <>
            <path d="M2 7h2V5h8v2h2v2h-2v2H4V9H2V7z" fill="currentColor" />
            <rect x="6" y="6" width="4" height="4" fill="#ffffff" />
            <rect x="7" y="7" width="2" height="2" fill="#000000" />
          </>
        );
      case "eye_closed":
        return <rect x="2" y="7" width="12" height="2" fill="currentColor" />;
      case "lock_closed":
        return (
          <>
            <rect x="5" y="3" width="6" height="4" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="3" y="7" width="10" height="7" fill="currentColor" />
          </>
        );
      case "lock_open":
        return (
          <>
            <rect x="8" y="2" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="3" y="7" width="10" height="7" fill="currentColor" />
          </>
        );
      case "linked":
        return (
          <>
            <rect x="2" y="6" width="4" height="4" fill="currentColor" />
            <rect x="10" y="6" width="4" height="4" fill="currentColor" />
            <rect x="6" y="7" width="4" height="2" fill="currentColor" />
          </>
        );
      case "unlinked":
        return (
          <>
            <rect x="2" y="6" width="4" height="4" fill="currentColor" />
            <rect x="10" y="6" width="4" height="4" fill="currentColor" />
          </>
        );
      case "gear":
        return (
          <>
            <rect x="6" y="2" width="4" height="12" fill="currentColor" />
            <rect x="2" y="6" width="12" height="4" fill="currentColor" />
            <rect x="6" y="6" width="4" height="4" fill="#c9c1b9" />
          </>
        );
      case "onion":
        return (
          <>
            <rect x="3" y="5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <rect x="6" y="3" width="7" height="7" fill="currentColor" />
          </>
        );
      case "play":
        return <path d="M5 3h2v1h2v1h2v2h1v2h-1v2H9v1H7v1H5V3z" fill="currentColor" />;
      case "pause":
        return (
          <>
            <rect x="4" y="3" width="3" height="10" fill="currentColor" />
            <rect x="9" y="3" width="3" height="10" fill="currentColor" />
          </>
        );
      case "first_frame":
        return (
          <>
            <rect x="3" y="3" width="2" height="10" fill="currentColor" />
            <path d="M12 3H10v2H8v2H6v2h2v2h2v2h2V3z" fill="currentColor" />
          </>
        );
      case "prev_frame":
        return (
          <>
            <path d="M10 3H8v2H6v2H4v2h2v2h2v2h2V3z" fill="currentColor" />
            <rect x="11" y="3" width="2" height="10" fill="currentColor" />
          </>
        );
      case "next_frame":
        return (
          <>
            <rect x="3" y="3" width="2" height="10" fill="currentColor" />
            <path d="M6 3h2v2h2v2h2v2h-2v2H8v2H6V3z" fill="currentColor" />
          </>
        );
      case "last_frame":
        return (
          <>
            <path d="M4 3h2v2h2v2h2v2H8v2H6v2H4V3z" fill="currentColor" />
            <rect x="11" y="3" width="2" height="10" fill="currentColor" />
          </>
        );
      case "plus":
        return (
          <>
            <rect x="7" y="3" width="2" height="10" fill="currentColor" />
            <rect x="3" y="7" width="10" height="2" fill="currentColor" />
          </>
        );
      case "minus":
        return <rect x="3" y="7" width="10" height="2" fill="currentColor" />;
      case "close":
        return (
          <>
            <path d="M3 4l1-1 9 9-1 1-9-9z" fill="currentColor" />
            <path d="M12 3l1 1-9 9-1-1 9-9z" fill="currentColor" />
          </>
        );
      case "check":
        return <path d="M3 8l3 3 7-7 1 1-8 8-4-4 1-1z" fill="currentColor" />;
      case "ink_flask":
        return <path d="M6 2h4v3l3 5v4H3v-4l3-5V2z" fill="currentColor" />;
      case "shape_square":
        return <rect x="4" y="4" width="8" height="8" fill="currentColor" />;
      case "shape_circle":
        return <path d="M6 3h4v1h2v2h1v4h-1v2h-2v1H6v-1H4v-2H3V6h1V4h2V3z" fill="currentColor" />;
      case "rgb_circles":
        return (
          <>
            <rect x="6" y="2" width="4" height="4" fill="#22c55e" />
            <rect x="3" y="6" width="5" height="5" fill="#ef4444" />
            <rect x="8" y="6" width="5" height="5" fill="#3b82f6" />
          </>
        );
      case "grayscale_bar":
        return (
          <>
            <rect x="2" y="4" width="3" height="8" fill="#111111" />
            <rect x="5" y="4" width="3" height="8" fill="#666666" />
            <rect x="8" y="4" width="3" height="8" fill="#aaaaaa" />
            <rect x="11" y="4" width="3" height="8" fill="#ffffff" />
          </>
        );
      case "indexed_grid":
        return (
          <>
            <rect x="3" y="3" width="4" height="4" fill="#15803d" />
            <rect x="8" y="3" width="4" height="4" fill="#ca8a04" />
            <rect x="3" y="8" width="4" height="4" fill="#4d7c0f" />
            <rect x="8" y="8" width="4" height="4" fill="#166534" />
          </>
        );
      case "checker_tile":
        return (
          <>
            <rect x="3" y="3" width="5" height="5" fill="#888888" />
            <rect x="8" y="3" width="5" height="5" fill="#cccccc" />
            <rect x="3" y="8" width="5" height="5" fill="#cccccc" />
            <rect x="8" y="8" width="5" height="5" fill="#888888" />
          </>
        );
      case "menu_bars":
        return (
          <>
            <rect x="3" y="4" width="10" height="2" fill="currentColor" />
            <rect x="3" y="7" width="10" height="2" fill="currentColor" />
            <rect x="3" y="10" width="10" height="2" fill="currentColor" />
          </>
        );
      case "one_to_one":
        return (
          <>
            <rect x="2" y="4" width="2" height="8" fill="currentColor" />
            <rect x="7" y="5" width="2" height="2" fill="currentColor" />
            <rect x="7" y="9" width="2" height="2" fill="currentColor" />
            <rect x="12" y="4" width="2" height="8" fill="currentColor" />
          </>
        );
      case "history":
        return (
          <>
            <rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" />
            <rect x="7" y="5" width="2" height="4" fill="currentColor" />
            <rect x="7" y="7" width="4" height="2" fill="currentColor" />
          </>
        );
      case "layers":
      case "layer_new":
        return (
          <>
            <rect x="3" y="4" width="10" height="3" fill="currentColor" />
            <rect x="3" y="9" width="10" height="3" fill="currentColor" />
          </>
        );
      case "trash":
        return (
          <>
            <rect x="3" y="3" width="10" height="2" fill="currentColor" />
            <rect x="4" y="6" width="8" height="8" fill="currentColor" />
          </>
        );
      default:
        return <rect x="4" y="4" width="8" height="8" fill="currentColor" />;
    }
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`inline-block shrink-0 select-none ${className}`}
      aria-hidden="true"
    >
      {renderPixels()}
    </svg>
  );
};

export {
  APP_ICON_GRID_16,
  KEKENIK_APP_VERSION,
  KekenikAppIcon,
  KPX_DOC_GRID_16,
  KpxFileIcon,
} from "./app-icon.tsx";
