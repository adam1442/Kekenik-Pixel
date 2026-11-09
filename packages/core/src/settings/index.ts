/**
 * @module @kekenik/core/settings
 * Preferences schema, Workspace layout serialization, and built-in workspace presets.
 */

import { getPlatform } from "../platform/index.ts";

declare global {
  interface ImportMetaEnv {
    readonly VITE_KP_FLAVOR?: string;
    readonly VITE_KP_UPDATER_CONFIGURED?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export type BuildFlavor = "release" | "qa";

/** Returns the active build flavor (`"release"` when `VITE_KP_FLAVOR === "release"`, otherwise `"qa"`). */
export function getBuildFlavor(): BuildFlavor {
  return import.meta.env.VITE_KP_FLAVOR === "release" ? "release" : "qa";
}

/** True when compiled with `VITE_KP_FLAVOR=release`. */
export function isReleaseFlavor(): boolean {
  return import.meta.env.VITE_KP_FLAVOR === "release";
}

/** True when compiled in QA / development / test mode (`VITE_KP_FLAVOR !== "release"`). */
export function isQaFlavor(): boolean {
  return import.meta.env.VITE_KP_FLAVOR !== "release";
}

export type ThemeId = string;
export type UIScale = 100 | 200 | 300;
export type LocaleCode = "en" | "fa" | "fa-IR";

import type { DockState } from "../layout/index.ts";

export interface FloatingPanelState {
  readonly panelId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pinned: boolean;
}

export interface WorkspaceLayout {
  readonly id: string;
  name: string;
  readonly builtIn: boolean;
  toolbarSide: "right" | "left";
  leftDockVisible: boolean;
  leftDockWidth: number;
  leftPanels: string[];
  rightDockVisible: boolean;
  rightDockWidth: number;
  rightPanels: string[];
  bottomDockVisible: boolean;
  bottomDockHeight: number;
  bottomPanels: string[];
  activeBottomPanel: string;
  activeRightPanel: string;
  floatingPanels: FloatingPanelState[];
  /** PanelLayout v2 (dock tree). Absent on layouts saved by Agents 1–5: migrated by `ensureDock`. */
  dock?: DockState;
}

export const BUILTIN_WORKSPACES: readonly WorkspaceLayout[] = [
  {
    id: "default",
    name: "Default",
    builtIn: true,
    toolbarSide: "right",
    leftDockVisible: true,
    leftDockWidth: 168,
    leftPanels: ["panel.colorbar", "panel.colorpicker"],
    rightDockVisible: false,
    rightDockWidth: 250,
    rightPanels: ["panel.history", "panel.layers", "panel.brushes", "panel.script_editor", "panel.extensions", "panel.tileset", "panel.tags", "panel.slices", "panel.info", "panel.navigator"],
    bottomDockVisible: true,
    bottomDockHeight: 185,
    bottomPanels:
      import.meta.env.VITE_KP_FLAVOR === "release"
        ? ["panel.timeline", "panel.history"]
        : ["panel.timeline", "panel.history", "panel.logviewer"],
    activeBottomPanel: "panel.timeline",
    activeRightPanel: "panel.history",
    floatingPanels: [
      {
        panelId: "panel.preview",
        x: 540,
        y: 120,
        width: 235,
        height: 185,
        pinned: true,
      },
    ],
  },
  {
    id: "animation",
    name: "Animation",
    builtIn: true,
    toolbarSide: "right",
    leftDockVisible: true,
    leftDockWidth: 156,
    leftPanels: ["panel.colorbar", "panel.colorpicker"],
    rightDockVisible: true,
    rightDockWidth: 245,
    rightPanels: ["panel.tags", "panel.layers", "panel.history", "panel.navigator", "panel.info"],
    bottomDockVisible: true,
    bottomDockHeight: 240,
    bottomPanels:
      import.meta.env.VITE_KP_FLAVOR === "release"
        ? ["panel.timeline", "panel.history"]
        : ["panel.timeline", "panel.history", "panel.logviewer"],
    activeBottomPanel: "panel.timeline",
    activeRightPanel: "panel.tags",
    floatingPanels: [
      {
        panelId: "panel.preview",
        x: 470,
        y: 105,
        width: 245,
        height: 190,
        pinned: true,
      },
    ],
  },
  {
    id: "compact",
    name: "Compact",
    builtIn: true,
    toolbarSide: "right",
    leftDockVisible: true,
    leftDockWidth: 140,
    leftPanels: ["panel.colorbar", "panel.colorpicker"],
    rightDockVisible: false,
    rightDockWidth: 210,
    rightPanels: ["panel.history"],
    bottomDockVisible: false,
    bottomDockHeight: 150,
    bottomPanels: ["panel.timeline"],
    activeBottomPanel: "panel.timeline",
    activeRightPanel: "panel.history",
    floatingPanels: [],
  },
  {
    id: "tile-editing",
    name: "Tile Editing",
    builtIn: true,
    toolbarSide: "left",
    leftDockVisible: true,
    leftDockWidth: 185,
    leftPanels: ["panel.colorbar", "panel.colorpicker", "panel.brushes"],
    rightDockVisible: true,
    rightDockWidth: 265,
    rightPanels: ["panel.tileset", "panel.layers", "panel.slices", "panel.history", "panel.info"],
    bottomDockVisible: true,
    bottomDockHeight: 175,
    bottomPanels:
      import.meta.env.VITE_KP_FLAVOR === "release"
        ? ["panel.timeline"]
        : ["panel.timeline", "panel.logviewer"],
    activeBottomPanel: "panel.timeline",
    activeRightPanel: "panel.tileset",
    floatingPanels: [
      {
        panelId: "panel.navigator",
        x: 520,
        y: 115,
        width: 200,
        height: 160,
        pinned: true,
      },
    ],
  },
];

export interface PreferencesState {
  theme: ThemeId;
  uiScale: UIScale;
  locale: LocaleCode;
  checkerSize: 8 | 16 | 32;
  checkerColor1: string;
  checkerColor2: string;
  showPixelGridAtZoom: boolean;
  cursorCrosshair: boolean;
  undoMaxMegabytes: number;
  customTitleBar: boolean;
  defaultGridWidth: number;
  defaultGridHeight: number;
  activeWorkspaceId: string;
  customWorkspaces: WorkspaceLayout[];
}

export const DEFAULT_PREFERENCES: PreferencesState = {
  theme: "default-dark",
  uiScale: 100,
  locale: "en",
  checkerSize: 8,
  checkerColor1: "#908694",
  checkerColor2: "#6e6573",
  showPixelGridAtZoom: true,
  cursorCrosshair: true,
  undoMaxMegabytes: 64,
  customTitleBar: true,
  defaultGridWidth: 16,
  defaultGridHeight: 16,
  activeWorkspaceId: "default",
  customWorkspaces: [],
};

/**
 * Deep-clones a WorkspaceLayout so mutations do not affect presets.
 */
export function cloneWorkspaceLayout(layout: WorkspaceLayout): WorkspaceLayout {
  return JSON.parse(JSON.stringify(layout)) as WorkspaceLayout;
}

/**
 * Loads user preferences from PlatformAPI.
 */
export async function loadPreferences(): Promise<PreferencesState> {
  const saved = await getPlatform().readSetting<Partial<PreferencesState>>("preferences", {});
  return {
    ...DEFAULT_PREFERENCES,
    ...saved,
  };
}

/**
 * Persists user preferences via PlatformAPI.
 */
export async function savePreferences(prefs: PreferencesState): Promise<void> {
  await getPlatform().writeSetting("preferences", prefs);
}
