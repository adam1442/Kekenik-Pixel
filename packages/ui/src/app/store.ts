/**
 * @module @kekenik/ui/app/store
 * Central Zustand store driving the Kekenik Pixel UI shell, Rendering Engine, Drawing Tools, and Brush Library.
 */

import { create } from "zustand";
import {
  AddFrameCommand,
  AddGroupLayerCommand,
  AddReferenceLayerCommand,
  AddTilemapLayerCommand,
  appLogger,
  BAYER_4X4,
  Brush,
  BrushCategory,
  BrushConfig,
  BrushType,
  BUILTIN_WORKSPACES,
  BulkLayerStateCommand,
  ClearCelsCommand,
  cloneWorkspaceLayout,
  ColorMode,
  computeCelContentBounds,
  ConvertLayerCommand,
  createAntiheroDemoDocument,
  createBlendShowcaseDocument,
  createBrushShowcaseDemoDocument,
  createDefaultTileset,
  createDitheringGradientsDemoDocument,
  createLayerGroupsBlendsDemoDocument,
  createLinkedCelsLabDemoDocument,
  createOnionSkinLabDemoDocument,
  createShapesFillsDemoDocument,
  createSlices9PatchDemoDocument,
  createSlimeDemoDocument,
  createSprite,
  createSymmetryPlaygroundDemoDocument,
  createTiledPatternDemoDocument,
  createTilemapDungeonDemoDocument,
  createWalkCycleDemoDocument,
  DEFAULT_ONION_SKIN_SETTINGS,
  DEFAULT_PLAYBACK_CONFIG,
  defaultBrushLibrary,
  defaultKeymap,
  deserializeSnapshot,
  DitherMatrix,
  DitherMatrixId,
  DuplicateLayerCommand,
  exportSliceCroppedImage,
  findAdjacentTagFrame,
  FlattenLayersCommand,
  getCel,
  getNextZoomStep,
  getPlatform,
  getPrevZoomStep,
  getSliceKeyForFrame,
  GradientDitherMode,
  GradientType,
  InkMode,
  IsolateLayerCommand,
  KeyBinding,
  LocaleCode,
  MergeDownLayerCommand,
  OnionSkinSettings,
  PatternAlignMode,
  PanelRegistry,
  PixelImage,
  PlaybackConfig,
  registerMasterFeatures,
  ReparentAndMoveLayerCommand,
  ReverseFramesCommand,
  RGBA,
  serializeSnapshot,
  SetLayerFullPropsCommand,
  setLocale,
  SpriteDocument,
  SymmetryMode,
  ThemeId,
  TiledMode,
  TilemapEditMode,
  TilesetModificationMode,
  TransferCelRangeCommand,
  UIScale,
  applyInvertFilter,
  CommitFloatingSelectionCommand,
  commitFloatingSelectionToImage,
  compositeFrame,
  computeSpriteNonEmptyBounds,
  ConvertColorModeAdvancedCommand,
  createFiltersGalleryDemoDocument,
  createIndexedConversionDemoDocument,
  createModelId,
  createPaletteRemapDemoDocument,
  createSelectionPlaygroundDemoDocument,
  createTransformRotSpriteDemoDocument,
  CropOrCanvasSizeCommand,
  fillSelectionOnImage,
  flipFloatingSelectionHorizontal,
  flipFloatingSelectionVertical,
  flipMaskHorizontal,
  flipMaskVertical,
  FloatingSelectionState,
  getPaletteForFrame,
  getPaletteSpanForFrame,
  IndexedDitherAlgorithm,
  liftSelectionFromImage,
  MarqueeConstraintMode,
  Mask,
  SelectionCombineMode,
  selectNonEmptyPixelsMask,
  strokeSelectionOnImage,
  TransformSpriteOrCelCommand,
  translateMask,
  UpdateSpritePropertiesCommand,
  BUILTIN_SAMPLE_SCRIPTS,
  CommandRegistry,
  defaultExtensionManager,
  defaultScriptPermissionStore,
  defaultScriptStorage,
  executeKekenikScript,
  ExtensionConflictWarning,
  InstalledExtensionRecord,
  packKpextZip,
  SAMPLE_EXTENSION_BUNDLES,
  SavedScriptFile,
  ScriptConsoleEntry,
  ScriptDialogResult,
  type ScriptExecutionResult,
  scriptEventsBus,
  ScriptPermissionRequest,
  ThemeRegistry,
  UngroupLayerCommand,
  UpdatePaletteAndRemapCommand,
  WorkspaceLayout,
} from "../../../core/src/index.ts";
import { handleAgent6Command } from "./agent6-actions.ts";
import {
  activatePanel,
  closeFloating,
  closePanel,
  dockBack,
  dockFloating,
  dockPanel,
  ensureDock,
  findTabsOfPanel,
  floatPanel,
  floatTabs,
  hideSlot,
  isSlotVisible,
  openPanel,
  panelLocation,
  reorderTab,
  setActiveTab as setDockActiveTab,
  setChildSize,
  setFloatingActive,
  showSlot,
  tearOffFromFloating,
  updateFloating,
  validateDock,
  type DockState,
  type DropTarget,
  type FloatingWindowState,
  type LayoutRect,
} from "../../../core/src/layout/index.ts";

registerMasterFeatures();

/** Live state of a dock drag (tab or floating window) used to render drop-zone highlights. */
export interface DockDragState {
  label: string;
  x: number;
  y: number;
  target: DropTarget | null;
  /** Highlight rectangle in viewport pixels. */
  hint: LayoutRect | null;
}

/** Clones a layout and guarantees it carries a v2 dock tree (migrating Agent 1-5 layouts on the fly). */
function withDock(layout: WorkspaceLayout): WorkspaceLayout {
  const copy = cloneWorkspaceLayout(layout);
  copy.dock = ensureDock(copy as never);
  return copy;
}


export type ActiveDialogId =
  | "dialog.new_sprite"
  | "dialog.sprite_size"
  | "dialog.canvas_size"
  | "dialog.preferences"
  | "dialog.shortcuts"
  | "dialog.feature_center"
  | "dialog.export_sprite_sheet"
  | "dialog.dither_matrix"
  | "dialog.grid_settings"
  | "dialog.layer_properties"
  | "dialog.frame_properties"
  | "dialog.cel_properties"
  | "dialog.tag_properties"
  | "dialog.slice_properties"
  | "dialog.tileset_properties"
  | "dialog.constant_frame_rate"
  | "dialog.new_tilemap_layer"
  | "dialog.onion_skin"
  | "dialog.palette_editor"
  | "dialog.color_mode"
  | "dialog.select_modify"
  | "dialog.color_range"
  | "dialog.saved_masks"
  | "dialog.rotate_angle"
  | "dialog.shift_pixels"
  | "dialog.paste_special"
  | "dialog.filter_fx"
  | "dialog.sprite_properties"
  | "dialog.duplicate_sprite"
  | "dialog.extensions_manager"
  | "dialog.script_custom"
  | "dialog.script_permissions"
  | "dialog.about"
  | "dialog.export_as"
  | "dialog.import_sprite_sheet"
  | "dialog.recovery"
  | "dialog.unsaved_changes"
  | null;

export type DemoDocumentKind =
  | "antihero"
  | "slime"
  | "blend"
  | "brush_showcase"
  | "symmetry_playground"
  | "dithering_gradients"
  | "shapes_fills"
  | "tiled_pattern"
  | "walk_cycle"
  | "onion_skin_lab"
  | "layer_groups_blends"
  | "linked_cels_lab"
  | "tilemap_dungeon"
  | "slices_9patch_ui"
  | "selection_playground"
  | "transform_rotsprite_lab"
  | "palette_remap_lab"
  | "indexed_dither_compare"
  | "filters_gallery";

export interface CelClipboardEntry {
  layerOffset: number;
  frameOffset: number;
  image: PixelImage;
  opacity: number;
  zIndex: number;
  x: number;
  y: number;
  tilemapData?: {
    width: number;
    height: number;
    tiles: Uint32Array;
  };
}

export interface PreviewPanelSettings {
  playing: boolean;
  zoom: number;
  syncWithEditor: boolean;
  tiledPreview: boolean;
  fullScreen: boolean;
  bgColor: string;
  tagId: string | "all";
}

export type CursorStyleMode = "footprint_outline" | "crosshair" | "simple" | "bounds";

export interface ToolOptionsState {
  brushSize: number;
  brushShape: BrushType;
  brushAngle: number;
  brushSpacing: number;
  patternAlign: PatternAlignMode;
  flipH: boolean;
  flipV: boolean;
  pressureSize: boolean;
  pressureAngle: boolean;
  velocitySize: boolean;
  gradientDither: boolean;
  customBrushImage?: PixelImage;

  opacity: number;
  pixelPerfect: boolean;
  stabilizerFactor: number;
  sampleMode: "composite" | "current";
  contiguous: boolean;
  eightConnected: boolean;
  tolerance: number;

  inkMode: InkMode;
  shadingRampFrom: number;
  shadingRampTo: number;

  ditherMatrixId: DitherMatrixId;
  ditherRatio: number; // 0..100
  customDitherMatrix: DitherMatrix;

  symmetryMode: SymmetryMode;
  symmetryX: number | null;
  symmetryY: number | null;

  shapeFilled: boolean;
  gradientType: GradientType;
  gradientDitherMode: GradientDitherMode;

  sprayWidth: number;
  spraySpeed: number;

  textContent: string;
  textFontSize: number;
  textAntiAlias: boolean;

  rightClickMode: "bg_color" | "eraser";

  // Agent 4 Selection & Move Tool options
  selectionMode: SelectionCombineMode;
  marqueeConstraint: MarqueeConstraintMode;
  marqueeRatioW: number;
  marqueeRatioH: number;
  marqueeFixedW: number;
  marqueeFixedH: number;
  moveTargetMode: "auto" | "selection_pixels" | "selection_mask" | "cel";
  transformAlgorithm: "fast" | "rotsprite" | "bilinear";
}

export interface ToolPresetEntry {
  id: string;
  name: string;
  toolId: string;
  options: Partial<ToolOptionsState>;
}

export interface AppStoreState {
  documents: SpriteDocument[];
  activeTabId: string; // "home" or document.id
  docRevision: number;

  activeLayerId: string;
  selectedLayerIds: string[];
  activeFrameIndex: number;
  selectedCelRange: {
    layerIds: string[];
    fromFrame: number;
    toFrame: number;
  } | null;
  celClipboard: CelClipboardEntry[];
  isPlaying: boolean;
  playbackConfig: PlaybackConfig;
  onionSkin: OnionSkinSettings;
  previewSettings: PreviewPanelSettings;

  timelinePosition: "bottom" | "left" | "right";
  timelineCelWidth: number;
  timelineThumbnails: "off" | "small" | "medium" | "large";

  activeTagId: string | null;
  activeSliceId: string | null;
  showSlicesOverlay: boolean;

  tilemapEditMode: TilemapEditMode;
  tilesetModMode: TilesetModificationMode;
  activeTileIndex: number;
  tileFlipX: boolean;
  tileFlipY: boolean;
  tileRot90: boolean;
  highlightUsedTiles: boolean;

  activeToolId: string;
  toolOptions: ToolOptionsState;
  lastStrokePoint: { x: number; y: number } | null;

  fgColor: RGBA;
  bgColor: RGBA;
  fgPaletteIndex: number;
  bgPaletteIndex: number;
  paletteLocked: boolean;
  selectedSwatchIndices: number[];
  colorHistory: RGBA[];
  remapOnPaletteEdit: boolean;

  // Agent 4 Selection, Floating Transform, Clipboard & Filter Studio state
  floatingSelection: FloatingSelectionState | null;
  floatingBeforeImage: PixelImage | null;
  floatingBeforeMask: Mask | null;
  pixelClipboard: { image: PixelImage; x: number; y: number } | null;
  lastDeselectedMask: Mask | null;
  showSelectionEdges: boolean;
  activeFilterTab: string;

  zoom: number; // percentage, e.g. 600 = 600%
  panX: number;
  panY: number;
  cursorPos: { x: number; y: number } | null;

  theme: ThemeId;
  uiScale: UIScale;
  locale: LocaleCode;
  checkerSize: 4 | 8 | 16 | 32;
  checkerColor1: string;
  checkerColor2: string;

  renderBackend: "webgl2" | "canvas2d";
  showGrid: boolean;
  showPixelGrid: boolean;
  snapToGrid: boolean;
  gridColor: string;
  gridOpacity: number;
  gridThickness: number;
  tiledMode: TiledMode;
  showExtras: boolean;
  showLayerEdges: boolean;
  zenMode: boolean;
  cursorStyle: CursorStyleMode;

  brushes: BrushConfig[];
  activeBrushId: string;
  toolPresets: ToolPresetEntry[];

  workspaces: WorkspaceLayout[];
  activeWorkspaceId: string;
  currentLayout: WorkspaceLayout;
  focusedPanelId: string | null;
  floatCloseBehavior: "close" | "redock";
  dockDrag: DockDragState | null;
  workspaceModified: boolean;

  keyBindings: KeyBinding[];
  activeDialog: ActiveDialogId;
  pendingCloseDocId: string | null;

  // Agent 5 Scripting & Extensions State
  activeScriptName: string;
  activeScriptCode: string;
  scriptDirty: boolean;
  scriptRunning: boolean;
  scriptConsoleLogs: ScriptConsoleEntry[];
  savedScripts: SavedScriptFile[];
  activeScriptDialog: ScriptDialogResult | null;
  pendingPermissionRequest: ScriptPermissionRequest | null;
  installedExtensions: InstalledExtensionRecord[];
  extensionConflicts: ExtensionConflictWarning[];

  // Actions
  getActiveDocument: () => SpriteDocument | null;
  bumpRevision: () => void;
  setActiveTab: (tabId: string) => void;
  createNewDocument: (opts: {
    name?: string;
    width: number;
    height: number;
    colorMode: ColorMode;
    background: "transparent" | "white" | "black";
    pixelRatio?: { w: number; h: number };
  }) => SpriteDocument;
  openDemoDocument: (demoKind: DemoDocumentKind) => void;
  closeDocument: (docId: string, force?: boolean) => void;
  confirmSaveAndClose: () => Promise<void>;
  confirmDiscardAndClose: () => void;
  cancelPendingClose: () => void;
  saveActiveSnapshot: () => Promise<void>;
  openSnapshotFromDisk: () => Promise<void>;

  setActiveLayer: (layerId: string) => void;
  selectLayerWithModifiers: (layerId: string, shiftKey: boolean, ctrlKey: boolean) => void;
  setActiveFrame: (frameIndex: number) => void;
  setSelectedCelRange: (
    range: { layerIds: string[]; fromFrame: number; toFrame: number } | null
  ) => void;
  setIsPlaying: (playing: boolean) => void;
  stepFrame: (delta: number) => void;
  jumpToTag: (dir: -1 | 1) => void;

  setPlaybackConfig: (patch: Partial<PlaybackConfig>) => void;
  setOnionSkin: (patch: Partial<OnionSkinSettings>) => void;
  toggleOnionSkin: () => void;
  setPreviewSettings: (patch: Partial<PreviewPanelSettings>) => void;

  setTimelinePosition: (pos: "bottom" | "left" | "right") => void;
  setTimelineCelWidth: (w: number) => void;
  setTimelineThumbnails: (mode: "off" | "small" | "medium" | "large") => void;

  setActiveTagId: (tagId: string | null) => void;
  setActiveSliceId: (sliceId: string | null) => void;
  setShowSlicesOverlay: (show: boolean) => void;
  selectSliceBounds: (sliceId: string) => void;
  exportSliceAsNewDocument: (sliceId: string) => void;

  setTilemapEditMode: (mode: TilemapEditMode) => void;
  setTilesetModMode: (mode: TilesetModificationMode) => void;
  setActiveTileIndex: (idx: number) => void;
  toggleTileFlag: (flag: "flipX" | "flipY" | "rot90") => void;
  setHighlightUsedTiles: (val: boolean) => void;

  createGroupLayer: (name?: string) => void;
  createReferenceLayer: (name?: string, image?: PixelImage) => void;
  createTilemapLayer: (opts?: { name?: string; tileWidth?: number; tileHeight?: number; existingTilesetId?: string }) => void;
  duplicateActiveLayer: () => void;
  mergeDownActiveLayer: () => void;
  flattenLayers: (visibleOnly: boolean) => void;
  convertActiveLayer: (targetType: "background" | "image" | "tilemap") => void;
  reparentAndMoveLayer: (layerId: string, toIndex: number, newParentId: string | null) => void;
  groupSelectedLayers: () => void;
  ungroupActiveLayer: () => void;
  isolateLayer: (layerId: string) => void;
  lockUnlockAllLayers: () => void;
  showHideAllLayers: () => void;
  moveActiveLayerStep: (delta: -1 | 1) => void;

  addEmptyFrame: () => void;
  transferCelRange: (layerDelta: number, frameDelta: number, mode: "move" | "copy" | "link") => void;
  clearSelectedCels: () => void;
  copySelectedCels: () => void;
  pasteCelsAtActive: () => void;
  duplicateSelectedCels: () => void;
  linkSelectedCels: (link: boolean) => void;
  reverseSelectedFrames: () => void;

  setActiveTool: (toolId: string) => void;
  setToolOption: <K extends keyof ToolOptionsState>(key: K, value: ToolOptionsState[K]) => void;
  setLastStrokePoint: (pt: { x: number; y: number } | null) => void;

  setFgColor: (color: RGBA, paletteIdx?: number) => void;
  setBgColor: (color: RGBA, paletteIdx?: number) => void;
  swapColors: () => void;
  setPaletteLocked: (locked: boolean) => void;

  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  setCursorPos: (pos: { x: number; y: number } | null) => void;

  setTheme: (theme: ThemeId) => void;
  setUIScale: (scale: UIScale) => void;
  setLocaleCode: (locale: LocaleCode) => void;
  setCheckerSettings: (size: 4 | 8 | 16 | 32, color1?: string, color2?: string) => void;
  setRenderBackend: (backend: "webgl2" | "canvas2d") => void;
  setCursorStyle: (style: CursorStyleMode) => void;

  toggleGrid: () => void;
  togglePixelGrid: () => void;
  toggleSnapToGrid: () => void;
  toggleShowExtras: () => void;
  toggleLayerEdges: () => void;
  toggleZenMode: () => void;
  setTiledMode: (mode: TiledMode) => void;
  cycleTiledMode: () => void;
  setGridAppearance: (color: string, opacity: number, thickness?: number) => void;
  updateSpriteGrid: (grid: Partial<{ x: number; y: number; width: number; height: number; visible: boolean }>) => void;

  selectBrushPreset: (brushId: string) => void;
  selectBrushSlot: (slot: number) => void;
  saveCurrentBrushToLibrary: (name?: string, category?: BrushCategory) => BrushConfig;
  captureCustomBrushFromCanvas: (name?: string) => BrushConfig | null;
  deleteBrushFromLibrary: (brushId: string) => void;
  renameBrushInLibrary: (brushId: string, name: string) => void;
  reorderBrushInLibrary: (fromIndex: number, toIndex: number) => void;
  exportBrushLibraryToDisk: () => Promise<void>;
  importBrushLibraryFromJson: (json: string) => void;

  saveToolPreset: (name: string) => void;
  applyToolPreset: (presetId: string) => void;
  deleteToolPreset: (presetId: string) => void;

  switchWorkspace: (workspaceId: string) => void;
  saveWorkspaceAs: (name: string) => void;
  deleteWorkspace: (workspaceId: string) => void;
  resetCurrentWorkspace: () => void;
  /** Floats a docked panel, docks back a floating one, or opens a closed one as floating. */
  togglePanelFloating: (panelId: string, rect?: LayoutRect) => void;
  /** True when the panel is docked or floating (i.e. not hidden/closed). */
  isPanelOpenIn: (panelId: string) => boolean;
  /** Opens a closed panel in its default dock slot, or closes it when already visible. */
  togglePanelVisible: (panelId: string) => void;
  dockPanelToSlot: (panelId: string, slot: "left" | "right" | "bottom") => void;
  toggleDockSlot: (slot: "left" | "right" | "bottom") => void;
  setActiveDockTab: (slot: "right" | "bottom", panelId: string) => void;
  /** Replaces the current dock state (all layout actions funnel through here). */
  commitDock: (dock: DockState) => void;
  floatPanelAt: (panelId: string, rect?: LayoutRect) => void;
  floatTabGroup: (tabsId: string, rect?: LayoutRect) => void;
  dockBackFloating: (floatingId: string) => void;
  dockPanelAt: (panelId: string, target: DropTarget) => void;
  dockFloatingAt: (floatingId: string, target: DropTarget) => void;
  updateFloatingWindow: (floatingId: string, patch: Partial<FloatingWindowState>) => void;
  closeFloatingWindow: (floatingId: string) => void;
  closeDockedPanel: (panelId: string) => void;
  tearOffFloatingTab: (floatingId: string, panelId: string, rect?: LayoutRect) => void;
  setDockChildSize: (splitId: string, childIndex: number, px: number) => void;
  setDockTabActive: (tabsId: string, panelId: string) => void;
  setFloatingTabActive: (floatingId: string, panelId: string) => void;
  reorderDockTab: (panelId: string, toIndex: number) => void;
  setFocusedPanel: (panelId: string | null) => void;
  floatFocusedPanel: () => boolean;
  dockBackFocusedPanel: () => boolean;
  setFloatCloseBehavior: (mode: "close" | "redock") => void;
  setDockDrag: (drag: DockDragState | null) => void;
  persistLayout: () => void;
  /** Menu entry the UI should open + highlight before activating it (Feature Center "Show me"). */
  menuReveal: { menu: "File"; submenuId: string; entryId: string; commandId: string } | null;
  revealSampleEntry: (sampleId: string) => void;
  clearMenuReveal: () => void;
  restoreLayout: () => Promise<void>;

  updateKeyBinding: (commandId: string, newKeys: string) => void;
  resetKeyBinding: (commandId: string) => void;
  resetAllKeyBindings: () => void;

  openDialog: (dialogId: ActiveDialogId) => void;
  setActiveFilterTab: (tabId: string) => void;

  // Agent 4 Actions
  setSelectedSwatchIndices: (indices: number[]) => void;
  selectSwatchWithModifiers: (idx: number, shiftKey: boolean, ctrlKey: boolean) => void;
  setRemapOnPaletteEdit: (remap: boolean) => void;
  addColorToPalette: (color: RGBA) => void;
  resetDefaultColors: () => void;
  setShowSelectionEdges: (show: boolean) => void;

  setFloatingSelection: (
    floating: FloatingSelectionState | null,
    beforeImage?: PixelImage | null,
    beforeMask?: Mask | null
  ) => void;
  updateFloatingSelection: (patch: Partial<FloatingSelectionState>) => void;
  commitFloatingSelection: () => void;
  cancelFloatingSelection: () => void;
  liftActiveSelectionToFloating: (copyMode?: boolean) => FloatingSelectionState | null;
  nudgeSelectionOrCel: (dx: number, dy: number, maskOnly?: boolean) => void;

  copySelectionToClipboard: (merged?: boolean) => void;
  cutSelectionToClipboard: () => void;
  pasteFromClipboard: (atX?: number, atY?: number) => void;
  pasteAsNewLayer: () => void;
  pasteAsNewSprite: () => void;
  pasteAsNewBrush: () => void;
  deleteSelectionPixels: () => void;
  fillSelectionWithFg: () => void;
  strokeSelectionBorder: (borderWidth?: number, shape?: "square" | "circle") => void;
  newSpriteFromSelection: () => void;
  duplicateActiveSprite: (flatten?: boolean, newName?: string) => void;
  cropToSelection: () => void;
  trimSpriteBorders: () => void;
  convertActiveSpriteColorMode: (
    targetMode: ColorMode,
    dither?: IndexedDitherAlgorithm,
    customPalette?: readonly RGBA[],
    transparentIndex?: number
  ) => void;

  // Agent 5 Scripting & Extensions Actions
  setActiveScript: (name: string, code?: string) => void;
  updateActiveScriptCode: (code: string) => void;
  runActiveScript: (overrideCode?: string, overrideName?: string) => Promise<void>;
  stopActiveScript: () => void;
  clearScriptConsole: () => void;
  saveCurrentScript: (asName?: string) => Promise<void>;
  renameCurrentScript: (newName: string) => Promise<void>;
  deleteScriptByName: (name: string) => Promise<void>;
  rescanScripts: () => Promise<void>;
  assignShortcutToScript: (scriptName: string, shortcutKeys: string) => void;
  closeScriptDialog: () => void;
  resolvePermissionPrompt: (granted: boolean) => void;
  installExtensionFromDisk: () => Promise<void>;
  installSampleExtensionById: (idOrFolder: string) => void;
  toggleExtensionEnabled: (extId: string) => void;
  uninstallExtensionById: (extId: string) => void;
  reloadAllExtensions: () => void;
  exportSampleKpextToDisk: (idOrFolder: string) => Promise<void>;

  runCommandById: (commandId: string) => void;
}

appLogger.info("App", "Initialized Kekenik Pixel v1.2.0 (Agent 1 Shell + Agent 2 Render/Tools/Brush Engine)");
appLogger.info("Document", "First launch: no document loaded — showing the Home tab");

export const useAppStore = create<AppStoreState>((set, get) => ({
  // Cold start: the editor opens on the Home tab with no document loaded.
  documents: [],
  activeTabId: "home",
  docRevision: 0,

  activeLayerId: "",
  selectedLayerIds: [],
  activeFrameIndex: 0,
  selectedCelRange: null,
  celClipboard: [],
  isPlaying: false,
  playbackConfig: { ...DEFAULT_PLAYBACK_CONFIG },
  onionSkin: { ...DEFAULT_ONION_SKIN_SETTINGS },
  previewSettings: {
    playing: true,
    zoom: 2,
    syncWithEditor: false,
    tiledPreview: false,
    fullScreen: false,
    bgColor: "#27232c",
    tagId: "all",
  },

  timelinePosition: "bottom",
  timelineCelWidth: 28,
  timelineThumbnails: "off",

  activeTagId: null,
  activeSliceId: null,
  showSlicesOverlay: true,

  tilemapEditMode: "tiles",
  tilesetModMode: "auto",
  activeTileIndex: 1,
  tileFlipX: false,
  tileFlipY: false,
  tileRot90: false,
  highlightUsedTiles: false,

  activeToolId: "tool.pencil",
  lastStrokePoint: null,
  toolOptions: {
    brushSize: 1,
    brushShape: "square",
    brushAngle: 0,
    brushSpacing: 10,
    patternAlign: "none",
    flipH: false,
    flipV: false,
    pressureSize: false,
    pressureAngle: false,
    velocitySize: false,
    gradientDither: false,
    customBrushImage: undefined,

    opacity: 255,
    pixelPerfect: true,
    stabilizerFactor: 0,
    sampleMode: "composite",
    contiguous: true,
    eightConnected: false,
    tolerance: 16,

    inkMode: "simple",
    shadingRampFrom: 1,
    shadingRampTo: 6,

    ditherMatrixId: "none",
    ditherRatio: 50,
    customDitherMatrix: { ...BAYER_4X4, id: "custom", name: "Custom 4x4" },

    symmetryMode: "none",
    symmetryX: null,
    symmetryY: null,

    shapeFilled: false,
    gradientType: "linear",
    gradientDitherMode: "bayer4x4",

    sprayWidth: 6,
    spraySpeed: 14,

    textContent: "KEKENIK",
    textFontSize: 7,
    textAntiAlias: false,

    rightClickMode: "bg_color",

    selectionMode: "replace",
    marqueeConstraint: "free",
    marqueeRatioW: 1,
    marqueeRatioH: 1,
    marqueeFixedW: 16,
    marqueeFixedH: 16,
    moveTargetMode: "auto",
    transformAlgorithm: "rotsprite",
  },

  fgColor: { r: 15, g: 12, b: 22, a: 255 },
  bgColor: { r: 255, g: 255, b: 255, a: 255 },
  fgPaletteIndex: 1,
  bgPaletteIndex: 0,
  paletteLocked: true,
  selectedSwatchIndices: [1],
  colorHistory: [
    { r: 15, g: 12, b: 22, a: 255 },
    { r: 217, g: 87, b: 99, a: 255 },
    { r: 251, g: 242, b: 54, a: 255 },
    { r: 106, g: 190, b: 48, a: 255 },
    { r: 99, g: 155, b: 255, a: 255 },
    { r: 255, g: 255, b: 255, a: 255 },
  ],
  remapOnPaletteEdit: true,

  floatingSelection: null,
  floatingBeforeImage: null,
  floatingBeforeMask: null,
  pixelClipboard: null,
  lastDeselectedMask: null,
  showSelectionEdges: true,
  activeFilterTab: "outline",

  zoom: 600,
  panX: 0,
  panY: 0,
  cursorPos: { x: 27, y: 18 },

  theme: "default-dark",
  uiScale: 100,
  locale: "en",
  checkerSize: 8,
  checkerColor1: "#8e8593",
  checkerColor2: "#6c6371",

  renderBackend: "webgl2",
  showGrid: false,
  showPixelGrid: true,
  snapToGrid: false,
  gridColor: "#38bdf8",
  gridOpacity: 45,
  gridThickness: 1,
  tiledMode: "none",
  showExtras: true,
  showLayerEdges: false,
  zenMode: false,
  cursorStyle: "footprint_outline",

  brushes: defaultBrushLibrary.getAll(),
  activeBrushId: "brush.preset.1px_pixel",
  toolPresets: [
    {
      id: "preset.1px_clean",
      name: "1px Pixel-Perfect Outline",
      toolId: "tool.pencil",
      options: { brushSize: 1, brushShape: "square", pixelPerfect: true, stabilizerFactor: 0, ditherMatrixId: "none" },
    },
    {
      id: "preset.bayer_shade",
      name: "4px Bayer 4x4 Dither Brush",
      toolId: "tool.pencil",
      options: { brushSize: 4, brushShape: "circle", pixelPerfect: false, ditherMatrixId: "bayer4x4" },
    },
    {
      id: "preset.calligraphy",
      name: "5px Calligraphy 45° Pen",
      toolId: "tool.pencil",
      options: { brushSize: 5, brushShape: "line", brushAngle: 45, pixelPerfect: false },
    },
  ],

  workspaces: BUILTIN_WORKSPACES.map(cloneWorkspaceLayout),
  activeWorkspaceId: "default",
  currentLayout: withDock(BUILTIN_WORKSPACES[0]),
  focusedPanelId: null,
  floatCloseBehavior: "close",
  dockDrag: null,
  menuReveal: null,
  workspaceModified: true,

  keyBindings: defaultKeymap.getAll(),
  activeDialog: null,
  pendingCloseDocId: null,

  activeScriptName: "hello-world.ts",
  activeScriptCode: BUILTIN_SAMPLE_SCRIPTS[11].code,
  scriptDirty: false,
  scriptRunning: false,
  scriptConsoleLogs: [
    {
      level: "log",
      message: "Kekenik Pixel TS/JS Sandbox ready. Hit Run (F5) or choose a Sample Script!",
      timestamp: "00:00:00",
    },
  ],
  savedScripts: defaultScriptStorage.getAll(),
  activeScriptDialog: null,
  pendingPermissionRequest: null,
  installedExtensions: defaultExtensionManager.getAll(),
  extensionConflicts: defaultExtensionManager.detectConflicts(),

  getActiveDocument: () => {
    const state = get();
    if (state.activeTabId === "home") return null;
    return state.documents.find((d) => d.id === state.activeTabId) ?? null;
  },

  bumpRevision: () => set((s) => ({ docRevision: s.docRevision + 1 })),

  setActiveTab: (tabId) => {
    const state = get();
    if (tabId === "home") {
      set({ activeTabId: "home", isPlaying: false });
      return;
    }
    const doc = state.documents.find((d) => d.id === tabId);
    if (doc) {
      const topLayer = doc.sprite.layers[doc.sprite.layers.length - 1];
      set({
        activeTabId: doc.id,
        activeLayerId: topLayer ? topLayer.id : "",
        activeFrameIndex: 0,
        isPlaying: false,
        docRevision: state.docRevision + 1,
      });
    }
  },

  createNewDocument: (opts) => {
    const sprite = createSprite(opts);
    const doc = new SpriteDocument(sprite);
    const topLayer = doc.sprite.layers[doc.sprite.layers.length - 1];
    appLogger.info(
      "Document",
      `Created new sprite "${sprite.name}" (${sprite.width}x${sprite.height}, ${sprite.colorMode.toUpperCase()})`
    );
    set((s) => ({
      documents: [...s.documents, doc],
      activeTabId: doc.id,
      activeLayerId: topLayer.id,
      activeFrameIndex: 0,
      isPlaying: false,
      panX: 0,
      panY: 0,
      zoom: sprite.width <= 64 ? 600 : 300,
      docRevision: s.docRevision + 1,
    }));
    return doc;
  },

  openDemoDocument: (demoKind) => {
    let doc: SpriteDocument;
    let nextTiled: TiledMode = get().tiledMode;
    let nextSymmetry: SymmetryMode = get().toolOptions.symmetryMode;
    let nextOnionEnabled = get().onionSkin.enabled;
    let nextFrame = 0;

    switch (demoKind) {
      case "antihero":
        doc = createAntiheroDemoDocument();
        break;
      case "slime":
        doc = createSlimeDemoDocument();
        break;
      case "blend":
        doc = createBlendShowcaseDocument();
        break;
      case "brush_showcase":
        doc = createBrushShowcaseDemoDocument();
        break;
      case "symmetry_playground":
        doc = createSymmetryPlaygroundDemoDocument();
        nextSymmetry = "both";
        break;
      case "dithering_gradients":
        doc = createDitheringGradientsDemoDocument();
        break;
      case "shapes_fills":
        doc = createShapesFillsDemoDocument();
        break;
      case "tiled_pattern":
        doc = createTiledPatternDemoDocument();
        nextTiled = "both";
        break;
      case "walk_cycle":
        doc = createWalkCycleDemoDocument();
        break;
      case "onion_skin_lab":
        doc = createOnionSkinLabDemoDocument();
        nextOnionEnabled = true;
        nextFrame = 2;
        break;
      case "layer_groups_blends":
        doc = createLayerGroupsBlendsDemoDocument();
        break;
      case "linked_cels_lab":
        doc = createLinkedCelsLabDemoDocument();
        break;
      case "tilemap_dungeon":
        doc = createTilemapDungeonDemoDocument();
        break;
      case "slices_9patch_ui":
        doc = createSlices9PatchDemoDocument();
        break;
      case "selection_playground":
        doc = createSelectionPlaygroundDemoDocument();
        break;
      case "transform_rotsprite_lab":
        doc = createTransformRotSpriteDemoDocument();
        break;
      case "palette_remap_lab":
        doc = createPaletteRemapDemoDocument();
        break;
      case "indexed_dither_compare":
        doc = createIndexedConversionDemoDocument();
        break;
      case "filters_gallery":
        doc = createFiltersGalleryDemoDocument();
        break;
    }

    const topLayer = doc.sprite.layers[doc.sprite.layers.length - 1];
    appLogger.info("Demo", `Opened demo document "${doc.sprite.name}"`);
    set((s) => ({
      documents: [...s.documents, doc],
      activeTabId: doc.id,
      activeLayerId: topLayer.id,
      selectedLayerIds: [topLayer.id],
      activeFrameIndex: nextFrame,
      selectedCelRange: null,
      activeTagId: doc.sprite.tags[0]?.id ?? null,
      activeSliceId: doc.sprite.slices[0]?.id ?? null,
      isPlaying: false,
      panX: 0,
      panY: 0,
      zoom: doc.sprite.width <= 48 ? 600 : 500,
      tiledMode: nextTiled,
      onionSkin: {
        ...s.onionSkin,
        enabled: nextOnionEnabled,
      },
      toolOptions: {
        ...s.toolOptions,
        symmetryMode: nextSymmetry,
        symmetryX: doc.sprite.width / 2,
        symmetryY: doc.sprite.height / 2,
      },
      docRevision: s.docRevision + 1,
    }));
    if (demoKind === "tilemap_dungeon") {
      get().setActiveDockTab("right", "panel.tileset");
    } else if (demoKind === "slices_9patch_ui") {
      get().setActiveDockTab("right", "panel.slices");
      get().setActiveTool("tool.slice");
    }
  },

  closeDocument: (docId, force = false) => {
    const targetDoc = get().documents.find((d) => d.id === docId);
    if (!targetDoc) return;
    // B03: If document has unsaved changes and force is false, prompt before closing
    if (targetDoc.isDirty && !force) {
      set({
        pendingCloseDocId: docId,
        activeDialog: "dialog.unsaved_changes",
      });
      return;
    }
    scriptEventsBus.emit("beforeClose", { docId });
    set((s) => {
      const nextDocs = s.documents.filter((d) => d.id !== docId);
      const nextActive =
        s.activeTabId === docId
          ? nextDocs[nextDocs.length - 1]?.id ?? "home"
          : s.activeTabId;
      return {
        documents: nextDocs,
        activeTabId: nextActive,
        pendingCloseDocId: s.pendingCloseDocId === docId ? null : s.pendingCloseDocId,
        activeDialog:
          s.activeDialog === "dialog.unsaved_changes" && s.pendingCloseDocId === docId
            ? null
            : s.activeDialog,
        isPlaying: false,
        docRevision: s.docRevision + 1,
      };
    });
  },

  confirmSaveAndClose: async () => {
    const state = get();
    const docId = state.pendingCloseDocId;
    if (!docId) return;
    const doc = state.documents.find((d) => d.id === docId);
    if (doc) {
      if (state.activeTabId !== docId) {
        state.setActiveTab(docId);
      }
      await state.saveActiveSnapshot();
    }
    state.closeDocument(docId, true);
  },

  confirmDiscardAndClose: () => {
    const docId = get().pendingCloseDocId;
    if (!docId) return;
    get().closeDocument(docId, true);
  },

  cancelPendingClose: () => {
    set({
      pendingCloseDocId: null,
      activeDialog: null,
    });
  },

  saveActiveSnapshot: async () => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const baseName = doc.sprite.name.replace(/\.(ase|aseprite|kpx-snapshot)$/i, "");
    const defaultName = `${baseName}.kpx-snapshot`;
    scriptEventsBus.emit("beforeSave", { path: defaultName, spriteName: doc.sprite.name });
    const json = serializeSnapshot(doc.sprite);
    await getPlatform().saveFileDialog(json, {
      defaultName,
    });
    doc.markSaved();
    scriptEventsBus.emit("afterSave", { path: defaultName, spriteName: doc.sprite.name });
    set((s) => ({ docRevision: s.docRevision + 1 }));
  },

  openSnapshotFromDisk: async () => {
    const res = await getPlatform().openFileDialog();
    if (!res || !res.text) return;
    try {
      const sprite = deserializeSnapshot(res.text);
      const doc = new SpriteDocument(sprite);
      const topLayer = doc.sprite.layers[doc.sprite.layers.length - 1];
      appLogger.info("Document", `Opened snapshot "${res.name}"`);
      set((s) => ({
        documents: [...s.documents, doc],
        activeTabId: doc.id,
        activeLayerId: topLayer ? topLayer.id : "",
        activeFrameIndex: 0,
        docRevision: s.docRevision + 1,
      }));
    } catch (err) {
      appLogger.error(
        "Document",
        `Failed to parse snapshot "${res.name}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },

  setActiveLayer: (layerId) =>
    set({ activeLayerId: layerId, selectedLayerIds: [layerId] }),

  selectLayerWithModifiers: (layerId, shiftKey, ctrlKey) => {
    const doc = get().getActiveDocument();
    if (!doc) {
      set({ activeLayerId: layerId, selectedLayerIds: [layerId] });
      return;
    }
    const allIds = doc.sprite.layers.map((l) => l.id);
    const currSelected = get().selectedLayerIds;

    if (shiftKey && currSelected.length > 0) {
      const anchor = get().activeLayerId || currSelected[0];
      const idxA = allIds.indexOf(anchor);
      const idxB = allIds.indexOf(layerId);
      if (idxA >= 0 && idxB >= 0) {
        const minI = Math.min(idxA, idxB);
        const maxI = Math.max(idxA, idxB);
        set({
          activeLayerId: layerId,
          selectedLayerIds: allIds.slice(minI, maxI + 1),
        });
        return;
      }
    }

    if (ctrlKey) {
      const exists = currSelected.includes(layerId);
      const next = exists
        ? currSelected.length > 1
          ? currSelected.filter((id) => id !== layerId)
          : currSelected
        : [...currSelected, layerId];
      set({
        activeLayerId: layerId,
        selectedLayerIds: next,
      });
      return;
    }

    set({ activeLayerId: layerId, selectedLayerIds: [layerId] });
  },

  setActiveFrame: (frameIndex) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const clamped = Math.max(0, Math.min(doc.sprite.frames.length - 1, frameIndex));
    set({ activeFrameIndex: clamped });
  },

  setSelectedCelRange: (selectedCelRange) => set({ selectedCelRange }),

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  stepFrame: (delta) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const count = doc.sprite.frames.length;
    if (count <= 0) return;
    const next = (get().activeFrameIndex + delta + count) % count;
    set({ activeFrameIndex: next });
  },

  jumpToTag: (dir) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const targetFrame = findAdjacentTagFrame(doc.sprite, get().activeFrameIndex, dir);
    set({ activeFrameIndex: targetFrame });
  },

  setPlaybackConfig: (patch) =>
    set((s) => ({
      playbackConfig: { ...s.playbackConfig, ...patch },
    })),

  setOnionSkin: (patch) =>
    set((s) => ({
      onionSkin: { ...s.onionSkin, ...patch },
    })),

  toggleOnionSkin: () =>
    set((s) => ({
      onionSkin: { ...s.onionSkin, enabled: !s.onionSkin.enabled },
    })),

  setPreviewSettings: (patch) =>
    set((s) => ({
      previewSettings: { ...s.previewSettings, ...patch },
    })),

  setTimelinePosition: (pos) => {
    set({ timelinePosition: pos });
    if (pos === "bottom") {
      get().dockPanelToSlot("panel.timeline", "bottom");
    } else if (pos === "left") {
      get().dockPanelToSlot("panel.timeline", "left");
    } else {
      get().dockPanelToSlot("panel.timeline", "right");
    }
  },

  setTimelineCelWidth: (w) =>
    set({ timelineCelWidth: Math.max(18, Math.min(64, Math.round(w))) }),

  setTimelineThumbnails: (timelineThumbnails) => set({ timelineThumbnails }),

  setActiveTagId: (activeTagId) => set({ activeTagId }),
  setActiveSliceId: (activeSliceId) => set({ activeSliceId }),
  setShowSlicesOverlay: (showSlicesOverlay) => set({ showSlicesOverlay }),

  selectSliceBounds: (sliceId) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const slice = doc.sprite.slices.find((s) => s.id === sliceId);
    if (!slice) return;
    const key = getSliceKeyForFrame(slice, get().activeFrameIndex);
    const nextMask = doc.sprite.mask.clone();
    nextMask.selectRect(key.bounds, false);
    doc.transact(`Select Slice Bounds (${slice.name})`, (tx) =>
      tx.setMask(nextMask, `Select Slice (${slice.name})`)
    );
    set((s) => ({ activeSliceId: sliceId, docRevision: s.docRevision + 1 }));
  },

  exportSliceAsNewDocument: (sliceId) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const slice = doc.sprite.slices.find((s) => s.id === sliceId);
    if (!slice) return;
    const cropped = exportSliceCroppedImage(doc.sprite, sliceId, get().activeFrameIndex);
    if (!cropped) return;

    const newSprite = createSprite({
      name: `${slice.name}.ase`,
      width: cropped.width,
      height: cropped.height,
      colorMode: "rgba",
      background: "transparent",
    });
    newSprite.cels[0].image.data.set(cropped.data);
    const newDoc = new SpriteDocument(newSprite);
    appLogger.info("Slices", `Exported slice "${slice.name}" (${cropped.width}x${cropped.height}) as new sprite tab`);
    set((s) => ({
      documents: [...s.documents, newDoc],
      activeTabId: newDoc.id,
      activeLayerId: newDoc.sprite.layers[0].id,
      selectedLayerIds: [newDoc.sprite.layers[0].id],
      activeFrameIndex: 0,
      docRevision: s.docRevision + 1,
    }));
  },

  setTilemapEditMode: (tilemapEditMode) => set({ tilemapEditMode }),
  setTilesetModMode: (tilesetModMode) => set({ tilesetModMode }),
  setActiveTileIndex: (activeTileIndex) =>
    set({ activeTileIndex: Math.max(0, activeTileIndex) }),

  toggleTileFlag: (flag) =>
    set((s) => ({
      tileFlipX: flag === "flipX" ? !s.tileFlipX : s.tileFlipX,
      tileFlipY: flag === "flipY" ? !s.tileFlipY : s.tileFlipY,
      tileRot90: flag === "rot90" ? !s.tileRot90 : s.tileRot90,
    })),

  setHighlightUsedTiles: (highlightUsedTiles) => set({ highlightUsedTiles }),

  createGroupLayer: (name) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const grpCount = doc.sprite.layers.filter((l) => l.kind === "group").length;
    const cmd = new AddGroupLayerCommand(name ?? `Group ${grpCount + 1}`);
    doc.execute(cmd);
    set((s) => ({
      activeLayerId: cmd.groupLayer.id,
      selectedLayerIds: [cmd.groupLayer.id],
      docRevision: s.docRevision + 1,
    }));
  },

  createReferenceLayer: (name, image) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const cmd = new AddReferenceLayerCommand(name ?? "Reference Guide", image);
    doc.execute(cmd);
    set((s) => ({
      activeLayerId: cmd.layer.id,
      selectedLayerIds: [cmd.layer.id],
      docRevision: s.docRevision + 1,
    }));
  },

  createTilemapLayer: (opts = {}) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const ts = opts.existingTilesetId
      ? undefined
      : createDefaultTileset({
          name: `${opts.name ?? "Tilemap"} Tileset`,
          tileWidth: opts.tileWidth ?? 16,
          tileHeight: opts.tileHeight ?? 16,
          colorMode: doc.sprite.colorMode,
        });
    const cmd = new AddTilemapLayerCommand({
      name: opts.name ?? `Tilemap ${doc.sprite.layers.length + 1}`,
      tileset: ts,
      existingTilesetId: opts.existingTilesetId,
    });
    doc.execute(cmd);
    set((s) => ({
      activeLayerId: cmd.layer.id,
      selectedLayerIds: [cmd.layer.id],
      docRevision: s.docRevision + 1,
    }));
    get().setActiveDockTab("right", "panel.tileset");
  },

  duplicateActiveLayer: () => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const cmd = new DuplicateLayerCommand(get().activeLayerId);
    doc.execute(cmd);
    set((s) => ({
      activeLayerId: cmd.duplicatedLayerId || s.activeLayerId,
      selectedLayerIds: [cmd.duplicatedLayerId || s.activeLayerId],
      docRevision: s.docRevision + 1,
    }));
  },

  mergeDownActiveLayer: () => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const cmd = new MergeDownLayerCommand(get().activeLayerId);
    doc.execute(cmd);
    if (cmd.targetLowerLayerId) {
      set((s) => ({
        activeLayerId: cmd.targetLowerLayerId,
        selectedLayerIds: [cmd.targetLowerLayerId],
        docRevision: s.docRevision + 1,
      }));
    }
  },

  flattenLayers: (visibleOnly) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const cmd = new FlattenLayersCommand(visibleOnly);
    doc.execute(cmd);
    set((s) => ({
      activeLayerId: cmd.flattenedLayerId || doc.sprite.layers[0].id,
      selectedLayerIds: [cmd.flattenedLayerId || doc.sprite.layers[0].id],
      docRevision: s.docRevision + 1,
    }));
  },

  convertActiveLayer: (targetType) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const state = get();
    const layer = doc.sprite.layers.find((l) => l.id === state.activeLayerId);
    if (!layer || layer.kind === "group") return;
    const effectiveTarget =
      targetType === "background" && layer.background
        ? "image"
        : targetType === "tilemap" && layer.kind === "tilemap"
        ? "image"
        : targetType;
    doc.execute(
      new ConvertLayerCommand(layer.id, effectiveTarget, {
        bgColor: state.bgColor,
        tileWidth: doc.sprite.grid.width || 16,
        tileHeight: doc.sprite.grid.height || 16,
      })
    );
    state.bumpRevision();
  },

  reparentAndMoveLayer: (layerId, toIndex, newParentId) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    doc.execute(new ReparentAndMoveLayerCommand(layerId, toIndex, newParentId));
    get().bumpRevision();
  },

  groupSelectedLayers: () => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const selected =
      get().selectedLayerIds.length > 0 ? get().selectedLayerIds : [get().activeLayerId];
    const cmd = new AddGroupLayerCommand("Group", selected);
    doc.execute(cmd);
    set((s) => ({
      activeLayerId: cmd.groupLayer.id,
      selectedLayerIds: [cmd.groupLayer.id],
      docRevision: s.docRevision + 1,
    }));
  },

  ungroupActiveLayer: () => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const layer = doc.sprite.layers.find((l) => l.id === get().activeLayerId);
    const groupId =
      layer?.kind === "group" ? layer.id : layer?.parentId ?? null;
    if (!groupId) return;
    doc.execute(new UngroupLayerCommand(groupId));
    const fallback = doc.sprite.layers[doc.sprite.layers.length - 1]?.id ?? "";
    set((s) => ({
      activeLayerId: fallback,
      selectedLayerIds: fallback ? [fallback] : [],
      docRevision: s.docRevision + 1,
    }));
  },

  isolateLayer: (layerId) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    doc.execute(new IsolateLayerCommand(layerId));
    get().bumpRevision();
  },

  lockUnlockAllLayers: () => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const anyEditable = doc.sprite.layers.some((l) => l.editable);
    doc.execute(new BulkLayerStateCommand("editable", !anyEditable));
    get().bumpRevision();
  },

  showHideAllLayers: () => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const allVisible = doc.sprite.layers.every((l) => l.visible);
    doc.execute(new BulkLayerStateCommand("visible", !allVisible));
    get().bumpRevision();
  },

  moveActiveLayerStep: (delta) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const idx = doc.sprite.layers.findIndex((l) => l.id === get().activeLayerId);
    if (idx < 0) return;
    const target = Math.max(0, Math.min(doc.sprite.layers.length - 1, idx + delta));
    if (target === idx) return;
    doc.transact(delta > 0 ? "Move Layer Up" : "Move Layer Down", (tx) =>
      tx.moveLayer(get().activeLayerId, target)
    );
    get().bumpRevision();
  },

  addEmptyFrame: () => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const state = get();
    doc.execute(new AddFrameCommand(state.activeFrameIndex, false, true));
    state.setActiveFrame(state.activeFrameIndex + 1);
    state.bumpRevision();
  },

  transferCelRange: (layerDelta, frameDelta, mode) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const state = get();
    const range = state.selectedCelRange;
    const coords: Array<{ layerId: string; frameIndex: number }> = [];
    if (range && range.layerIds.length > 0) {
      const f0 = Math.min(range.fromFrame, range.toFrame);
      const f1 = Math.max(range.fromFrame, range.toFrame);
      for (const lid of range.layerIds) {
        for (let f = f0; f <= f1; f++) {
          coords.push({ layerId: lid, frameIndex: f });
        }
      }
    } else {
      coords.push({ layerId: state.activeLayerId, frameIndex: state.activeFrameIndex });
    }
    doc.execute(new TransferCelRangeCommand(coords, layerDelta, frameDelta, mode));
    state.bumpRevision();
  },

  clearSelectedCels: () => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const state = get();
    const range = state.selectedCelRange;
    const coords: Array<{ layerId: string; frameIndex: number }> = [];
    if (range && range.layerIds.length > 0) {
      const f0 = Math.min(range.fromFrame, range.toFrame);
      const f1 = Math.max(range.fromFrame, range.toFrame);
      for (const lid of range.layerIds) {
        for (let f = f0; f <= f1; f++) {
          coords.push({ layerId: lid, frameIndex: f });
        }
      }
    } else {
      coords.push({ layerId: state.activeLayerId, frameIndex: state.activeFrameIndex });
    }
    doc.execute(new ClearCelsCommand(coords));
    state.bumpRevision();
  },

  copySelectedCels: () => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const state = get();
    const range = state.selectedCelRange;
    const entries: CelClipboardEntry[] = [];

    if (range && range.layerIds.length > 0) {
      const f0 = Math.min(range.fromFrame, range.toFrame);
      const f1 = Math.max(range.fromFrame, range.toFrame);
      const baseLayerIdx = doc.sprite.layers.findIndex((l) => l.id === range.layerIds[0]);
      for (const lid of range.layerIds) {
        const lIdx = doc.sprite.layers.findIndex((l) => l.id === lid);
        for (let f = f0; f <= f1; f++) {
          const cel = getCel(doc.sprite, lid, f);
          if (!cel) continue;
          entries.push({
            layerOffset: lIdx - baseLayerIdx,
            frameOffset: f - f0,
            image: cel.image.clone(),
            opacity: cel.opacity,
            zIndex: cel.zIndex,
            x: cel.x,
            y: cel.y,
            tilemapData: cel.tilemapData
              ? {
                  width: cel.tilemapData.width,
                  height: cel.tilemapData.height,
                  tiles: new Uint32Array(cel.tilemapData.tiles),
                }
              : undefined,
          });
        }
      }
    } else {
      const cel = getCel(doc.sprite, state.activeLayerId, state.activeFrameIndex);
      if (cel) {
        entries.push({
          layerOffset: 0,
          frameOffset: 0,
          image: cel.image.clone(),
          opacity: cel.opacity,
          zIndex: cel.zIndex,
          x: cel.x,
          y: cel.y,
          tilemapData: cel.tilemapData
            ? {
                width: cel.tilemapData.width,
                height: cel.tilemapData.height,
                tiles: new Uint32Array(cel.tilemapData.tiles),
              }
            : undefined,
        });
      }
    }

    set({ celClipboard: entries });
    appLogger.info("Timeline", `Copied ${entries.length} cel(s) to timeline clipboard`);
  },

  pasteCelsAtActive: () => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const state = get();
    if (state.celClipboard.length === 0) return;
    const anchorLayerIdx = doc.sprite.layers.findIndex((l) => l.id === state.activeLayerId);
    const anchorFrameIdx = state.activeFrameIndex;

    doc.transact("Paste Cel(s)", (tx) => {
      for (const item of state.celClipboard) {
        const dstLayer = doc.sprite.layers[anchorLayerIdx + item.layerOffset];
        const dstFrame = anchorFrameIdx + item.frameOffset;
        if (!dstLayer || dstLayer.kind === "group" || dstFrame < 0 || dstFrame >= doc.sprite.frames.length) {
          continue;
        }
        const dstCel = getCel(doc.sprite, dstLayer.id, dstFrame);
        if (!dstCel) continue;
        // Unlink before overwriting
        tx.linkCels(dstLayer.id, [dstFrame], false);
        const beforePatch = dstCel.image.extractPatch({
          x: 0,
          y: 0,
          width: dstCel.image.width,
          height: dstCel.image.height,
        });
        dstCel.image.data.set(item.image.data);
        const afterPatch = dstCel.image.extractPatch({
          x: 0,
          y: 0,
          width: dstCel.image.width,
          height: dstCel.image.height,
        });
        tx.run({
          id: `paste_${dstFrame}`,
          label: "Paste Cel",
          timestamp: Date.now(),
          byteSize: afterPatch.data.byteLength,
          do(s) {
            const c = getCel(s, dstLayer.id, dstFrame);
            if (c) c.image.applyPatch(afterPatch);
          },
          undo(s) {
            const c = getCel(s, dstLayer.id, dstFrame);
            if (c) c.image.applyPatch(beforePatch);
          },
        });
      }
    });
    state.bumpRevision();
  },

  duplicateSelectedCels: () => {
    const state = get();
    state.copySelectedCels();
    const doc = state.getActiveDocument();
    if (!doc) return;
    if (state.activeFrameIndex >= doc.sprite.frames.length - 1) {
      doc.transact("Add Frame for Duplicate Cel", (tx) =>
        tx.addFrame(state.activeFrameIndex, false)
      );
    }
    state.setActiveFrame(state.activeFrameIndex + 1);
    get().pasteCelsAtActive();
  },

  linkSelectedCels: (link) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const state = get();
    const range = state.selectedCelRange;
    doc.transact(link ? "Link Cels" : "Unlink Cels", (tx) => {
      if (range && range.layerIds.length > 0) {
        const f0 = Math.min(range.fromFrame, range.toFrame);
        const f1 = Math.max(range.fromFrame, range.toFrame);
        const frames: number[] = [];
        for (let f = f0; f <= f1; f++) frames.push(f);
        for (const lid of range.layerIds) {
          tx.linkCels(lid, frames, link);
        }
      } else {
        const nextFrame = Math.min(doc.sprite.frames.length - 1, state.activeFrameIndex + 1);
        const frames =
          link && nextFrame !== state.activeFrameIndex
            ? [state.activeFrameIndex, nextFrame]
            : [state.activeFrameIndex];
        tx.linkCels(state.activeLayerId, frames, link);
      }
    });
    state.bumpRevision();
  },

  reverseSelectedFrames: () => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const state = get();
    const range = state.selectedCelRange;
    const f0 = range ? Math.min(range.fromFrame, range.toFrame) : 0;
    const f1 = range ? Math.max(range.fromFrame, range.toFrame) : doc.sprite.frames.length - 1;
    doc.execute(new ReverseFramesCommand(f0, f1));
    state.bumpRevision();
  },

  setActiveTool: (toolId) => {
    // If switching away from move/selection while a floating selection is active, commit it automatically!
    const currFloating = get().floatingSelection;
    if (currFloating && toolId !== "tool.move") {
      get().commitFloatingSelection();
    }
    appLogger.info("Tool", `Selected tool ${toolId}`);
    set((s) => ({
      activeToolId: toolId,
      toolOptions:
        toolId === "tool.shading"
          ? { ...s.toolOptions, inkMode: "shading" }
          : toolId === "tool.gradient"
          ? { ...s.toolOptions, contiguous: false }
          : toolId === "tool.paint_bucket"
          ? { ...s.toolOptions, contiguous: true }
          : s.toolOptions,
    }));
  },

  setToolOption: (key, value) => {
    if (key === "symmetryMode") {
      void getPlatform().writeSetting("kpx_default_symmetry", value);
    }
    set((s) => ({
      toolOptions: { ...s.toolOptions, [key]: value },
    }));
  },

  setLastStrokePoint: (lastStrokePoint) => set({ lastStrokePoint }),

  setFgColor: (color, paletteIdx) => {
    const state = get();
    const doc = state.getActiveDocument();
    const targetIdx = paletteIdx !== undefined ? paletteIdx : state.fgPaletteIndex;

    // If palette is unlocked and user edits color in picker without clicking a new swatch, live-update active swatch
    if (doc && !state.paletteLocked && paletteIdx === undefined) {
      const span = getPaletteSpanForFrame(doc.sprite, state.activeFrameIndex);
      if (span && targetIdx >= 0 && targetIdx < span.colors.length) {
        span.colors[targetIdx] = { ...color };
      }
    }

    set((s) => {
      const existsInHistory = s.colorHistory.some(
        (c) => c.r === color.r && c.g === color.g && c.b === color.b && c.a === color.a
      );
      const nextHistory = existsInHistory
        ? s.colorHistory
        : [{ ...color }, ...s.colorHistory].slice(0, 16);
      return {
        fgColor: color,
        fgPaletteIndex: targetIdx,
        selectedSwatchIndices: paletteIdx !== undefined ? [paletteIdx] : s.selectedSwatchIndices,
        colorHistory: nextHistory,
        docRevision: !s.paletteLocked && paletteIdx === undefined ? s.docRevision + 1 : s.docRevision,
      };
    });
  },

  setBgColor: (color, paletteIdx) =>
    set((s) => ({
      bgColor: color,
      bgPaletteIndex: paletteIdx !== undefined ? paletteIdx : s.bgPaletteIndex,
    })),

  swapColors: () =>
    set((s) => ({
      fgColor: s.bgColor,
      bgColor: s.fgColor,
      fgPaletteIndex: s.bgPaletteIndex,
      bgPaletteIndex: s.fgPaletteIndex,
    })),

  setPaletteLocked: (locked) => set({ paletteLocked: locked }),

  setZoom: (zoom) => set({ zoom: Math.max(1.5625, Math.min(6400, Number(zoom))) }),
  setPan: (panX, panY) => set({ panX, panY }),
  setCursorPos: (cursorPos) => set({ cursorPos }),

  setTheme: (theme) => {
    appLogger.info("Theme", `Switched UI theme to ${theme}`);
    set({ theme });
  },

  setUIScale: (uiScale) => {
    appLogger.info("Theme", `Changed UI scale to ${uiScale}%`);
    set({ uiScale });
  },

  setLocaleCode: (locale) => {
    setLocale(locale);
    appLogger.info("i18n", `Changed language to ${locale}`);
    set({ locale });
  },

  setCheckerSettings: (checkerSize, color1, color2) =>
    set((s) => ({
      checkerSize,
      checkerColor1: color1 ?? s.checkerColor1,
      checkerColor2: color2 ?? s.checkerColor2,
    })),

  setRenderBackend: (renderBackend) => {
    appLogger.info("Renderer", `Switched canvas backend to ${renderBackend.toUpperCase()}`);
    set({ renderBackend });
  },

  setCursorStyle: (cursorStyle) => set({ cursorStyle }),

  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  togglePixelGrid: () => set((s) => ({ showPixelGrid: !s.showPixelGrid })),
  toggleSnapToGrid: () => set((s) => ({ snapToGrid: !s.snapToGrid })),
  toggleShowExtras: () => set((s) => ({ showExtras: !s.showExtras })),
  toggleLayerEdges: () => set((s) => ({ showLayerEdges: !s.showLayerEdges })),
  toggleZenMode: () => set((s) => ({ zenMode: !s.zenMode })),

  setTiledMode: (tiledMode) => {
    appLogger.info("Viewport", `Set Tiled Mode to ${tiledMode}`);
    set({ tiledMode });
  },

  cycleTiledMode: () => {
    const order: TiledMode[] = ["none", "both", "x", "y"];
    const curr = get().tiledMode;
    const next = order[(order.indexOf(curr) + 1) % order.length];
    get().setTiledMode(next);
  },

  setGridAppearance: (gridColor, gridOpacity, gridThickness) =>
    set((s) => ({
      gridColor,
      gridOpacity,
      gridThickness:
        gridThickness !== undefined
          ? Math.max(1, Math.min(8, Math.round(gridThickness)))
          : s.gridThickness,
    })),

  updateSpriteGrid: (patch) => {
    const doc = get().getActiveDocument();
    if (!doc) return;
    const nextGrid = { ...doc.sprite.grid, ...patch };
    doc.execute(new UpdateSpritePropertiesCommand({ grid: nextGrid }));
    set((s) => ({
      showGrid: patch.visible !== undefined ? patch.visible : s.showGrid,
      docRevision: s.docRevision + 1,
    }));
  },

  selectBrushPreset: (brushId) => {
    const found = defaultBrushLibrary.getById(brushId);
    if (!found) return;
    set((s) => ({
      activeBrushId: found.id,
      toolOptions: {
        ...s.toolOptions,
        brushShape: found.type,
        brushSize: found.size,
        brushAngle: found.angle,
        brushSpacing: found.spacing,
        patternAlign: found.patternAlign,
        flipH: found.flipH,
        flipV: found.flipV,
        pressureSize: found.dynamics.pressureSize,
        pressureAngle: found.dynamics.pressureAngle,
        velocitySize: found.dynamics.velocitySize,
        gradientDither: found.dynamics.gradientDither,
        customBrushImage: found.image ? found.image.clone() : undefined,
      },
    }));
  },

  selectBrushSlot: (slot) => {
    const found = defaultBrushLibrary.getBySlot(slot);
    if (found) {
      get().selectBrushPreset(found.id);
    }
  },

  saveCurrentBrushToLibrary: (name, category) => {
    const opts = get().toolOptions;
    const created = defaultBrushLibrary.addBrush({
      name: name?.trim() || `${opts.brushSize}px ${opts.brushShape}`,
      category: category ?? (opts.brushShape === "image" ? "Custom Stamps" : "Basic"),
      type: opts.brushShape,
      size: opts.brushSize,
      angle: opts.brushAngle,
      spacing: opts.brushSpacing,
      patternAlign: opts.patternAlign,
      flipH: opts.flipH,
      flipV: opts.flipV,
      dynamics: {
        pressureSize: opts.pressureSize,
        pressureAngle: opts.pressureAngle,
        velocitySize: opts.velocitySize,
        gradientDither: opts.gradientDither,
      },
      image: opts.customBrushImage ? opts.customBrushImage.clone() : undefined,
    });
    void getPlatform().writeSetting("kpx_brush_library", defaultBrushLibrary.exportJson());
    set({
      brushes: defaultBrushLibrary.getAll(),
      activeBrushId: created.id,
    });
    appLogger.info("BrushLibrary", `Saved brush "${created.name}" to library`);
    return created;
  },

  captureCustomBrushFromCanvas: (name) => {
    const doc = get().getActiveDocument();
    if (!doc) return null;
    const state = get();
    const sprite = doc.sprite;
    const cel = getCel(sprite, state.activeLayerId, state.activeFrameIndex);
    if (!cel) return null;

    const bounds =
      sprite.mask.bounds ??
      computeCelContentBounds(sprite, state.activeLayerId, state.activeFrameIndex) ?? {
        x: 0,
        y: 0,
        width: Math.min(16, sprite.width),
        height: Math.min(16, sprite.height),
      };

    const cropped = cel.image.crop(bounds);
    const stampBrush = Brush.fromImage(cropped, {
      name: name ?? `Stamp ${bounds.width}x${bounds.height}`,
    });
    const added = defaultBrushLibrary.addBrush(stampBrush.config);
    void getPlatform().writeSetting("kpx_brush_library", defaultBrushLibrary.exportJson());
    set((s) => ({
      brushes: defaultBrushLibrary.getAll(),
      activeBrushId: added.id,
      toolOptions: {
        ...s.toolOptions,
        brushShape: "image",
        brushSize: added.size,
        customBrushImage: added.image?.clone(),
      },
    }));
    appLogger.info("BrushLibrary", `Captured custom stamp brush "${added.name}" (${bounds.width}x${bounds.height})`);
    return added;
  },

  deleteBrushFromLibrary: (brushId) => {
    defaultBrushLibrary.removeBrush(brushId);
    void getPlatform().writeSetting("kpx_brush_library", defaultBrushLibrary.exportJson());
    set({ brushes: defaultBrushLibrary.getAll() });
  },

  renameBrushInLibrary: (brushId, name) => {
    defaultBrushLibrary.renameBrush(brushId, name);
    void getPlatform().writeSetting("kpx_brush_library", defaultBrushLibrary.exportJson());
    set({ brushes: defaultBrushLibrary.getAll() });
  },

  reorderBrushInLibrary: (fromIndex, toIndex) => {
    defaultBrushLibrary.reorderBrush(fromIndex, toIndex);
    void getPlatform().writeSetting("kpx_brush_library", defaultBrushLibrary.exportJson());
    set({ brushes: defaultBrushLibrary.getAll() });
  },

  exportBrushLibraryToDisk: async () => {
    const json = defaultBrushLibrary.exportJson();
    await getPlatform().saveFileDialog(json, { defaultName: "kekenik-brushes.kpbrushes" });
  },

  importBrushLibraryFromJson: (json) => {
    defaultBrushLibrary.importJson(json);
    void getPlatform().writeSetting("kpx_brush_library", defaultBrushLibrary.exportJson());
    set({ brushes: defaultBrushLibrary.getAll() });
  },

  saveToolPreset: (name) => {
    const state = get();
    const id = `tp_${Date.now().toString(36)}`;
    const entry: ToolPresetEntry = {
      id,
      name: name.trim() || `${state.activeToolId} Preset`,
      toolId: state.activeToolId,
      options: { ...state.toolOptions },
    };
    set((s) => ({ toolPresets: [...s.toolPresets, entry] }));
  },

  applyToolPreset: (presetId) => {
    const found = get().toolPresets.find((p) => p.id === presetId);
    if (!found) return;
    set((s) => ({
      activeToolId: found.toolId,
      toolOptions: { ...s.toolOptions, ...found.options },
    }));
  },

  deleteToolPreset: (presetId) => {
    set((s) => ({ toolPresets: s.toolPresets.filter((p) => p.id !== presetId) }));
  },

  switchWorkspace: (workspaceId) => {
    const target = get().workspaces.find((w) => w.id === workspaceId);
    if (!target) return;
    appLogger.info("Workspace", `Switched workspace to "${target.name}"`);
    set({
      activeWorkspaceId: target.id,
      currentLayout: withDock(target),
      workspaceModified: false,
    });
  },

  saveWorkspaceAs: (name) => {
    const clean = name.trim() || "Custom Workspace";
    const id = `ws_${Date.now().toString(36)}`;
    const saved: WorkspaceLayout = {
      ...cloneWorkspaceLayout(get().currentLayout),
      id,
      name: clean,
      builtIn: false,
    };
    appLogger.info("Workspace", `Saved workspace "${clean}"`);
    set((s) => ({
      workspaces: [...s.workspaces, saved],
      activeWorkspaceId: id,
      currentLayout: withDock(saved),
      workspaceModified: false,
    }));
  },

  deleteWorkspace: (workspaceId) => {
    set((s) => {
      const target = s.workspaces.find((w) => w.id === workspaceId);
      if (!target || target.builtIn) return s;
      const next = s.workspaces.filter((w) => w.id !== workspaceId);
      const fallback = next[0];
      return {
        workspaces: next,
        activeWorkspaceId: fallback.id,
        currentLayout: withDock(fallback),
        workspaceModified: false,
      };
    });
  },

  resetCurrentWorkspace: () => {
    const activeId = get().activeWorkspaceId;
    const preset =
      BUILTIN_WORKSPACES.find((w) => w.id === activeId) ??
      get().workspaces.find((w) => w.id === activeId) ??
      BUILTIN_WORKSPACES[0];
    appLogger.info("Workspace", `Reset workspace "${preset.name}" to default layout`);
    set({
      currentLayout: withDock(preset),
      workspaceModified: false,
    });
  },

  commitDock: (dock) => {
    set((s) => ({
      currentLayout: { ...s.currentLayout, dock },
      workspaceModified: true,
    }));
  },

  togglePanelFloating: (panelId, rect) => {
    const dock = ensureDock(get().currentLayout as never);
    const loc = panelLocation(dock, panelId);
    if (loc === "docked") get().floatPanelAt(panelId, rect);
    else if (loc === "floating") {
      const win = dock.floating.find((f) => f.panels.includes(panelId));
      if (win) get().dockBackFloating(win.id);
    } else {
      get().commitDock(openPanel(dock, panelId, "floating"));
    }
  },

  isPanelOpenIn: (panelId) => {
    const dock = ensureDock(get().currentLayout as never);
    return panelLocation(dock, panelId) !== "closed";
  },

  togglePanelVisible: (panelId) => {
    const dock = ensureDock(get().currentLayout as never);
    const loc = panelLocation(dock, panelId);
    if (loc === "docked") {
      get().commitDock(closePanel(dock, panelId));
      appLogger.info("Layout", `Hid panel ${panelId}`);
      return;
    }
    if (loc === "floating") {
      get().commitDock(closePanel(dock, panelId));
      appLogger.info("Layout", `Hid floating panel ${panelId}`);
      return;
    }
    const definition = PanelRegistry.get(panelId);
    const preferred = definition?.defaultDockSlot ?? "right";
    const slot: "left" | "right" | "bottom" | "floating" =
      preferred === "left" || preferred === "bottom" || preferred === "floating"
        ? preferred
        : "right";
    get().commitDock(openPanel(dock, panelId, slot));
    appLogger.info("Layout", `Opened panel ${panelId} in ${slot}`);
  },

  floatPanelAt: (panelId, rect) => {
    const dock = ensureDock(get().currentLayout as never);
    get().commitDock(floatPanel(dock, panelId, rect));
    appLogger.info("Layout", `Floated panel ${panelId}`);
  },

  floatTabGroup: (tabsId, rect) => {
    const dock = ensureDock(get().currentLayout as never);
    get().commitDock(floatTabs(dock, tabsId, rect));
  },

  dockBackFloating: (floatingId) => {
    const dock = ensureDock(get().currentLayout as never);
    get().commitDock(dockBack(dock, floatingId));
    appLogger.info("Layout", `Docked back floating window ${floatingId}`);
  },

  dockPanelAt: (panelId, target) => {
    const dock = ensureDock(get().currentLayout as never);
    get().commitDock(dockPanel(dock, panelId, target));
  },

  dockFloatingAt: (floatingId, target) => {
    const dock = ensureDock(get().currentLayout as never);
    get().commitDock(dockFloating(dock, floatingId, target));
  },

  updateFloatingWindow: (floatingId, patch) => {
    const dock = ensureDock(get().currentLayout as never);
    get().commitDock(updateFloating(dock, floatingId, patch));
  },

  closeFloatingWindow: (floatingId) => {
    const dock = ensureDock(get().currentLayout as never);
    if (get().floatCloseBehavior === "redock") get().commitDock(dockBack(dock, floatingId));
    else get().commitDock(closeFloating(dock, floatingId));
  },

  closeDockedPanel: (panelId) => {
    const dock = ensureDock(get().currentLayout as never);
    get().commitDock(closePanel(dock, panelId));
  },

  tearOffFloatingTab: (floatingId, panelId, rect) => {
    const dock = ensureDock(get().currentLayout as never);
    get().commitDock(tearOffFromFloating(dock, floatingId, panelId, rect));
  },

  setDockChildSize: (splitId, childIndex, px) => {
    const dock = ensureDock(get().currentLayout as never);
    get().commitDock(setChildSize(dock, splitId, childIndex, px));
  },

  setDockTabActive: (tabsId, panelId) => {
    const dock = ensureDock(get().currentLayout as never);
    get().commitDock(setDockActiveTab(dock, tabsId, panelId));
  },

  setFloatingTabActive: (floatingId, panelId) => {
    const dock = ensureDock(get().currentLayout as never);
    get().commitDock(setFloatingActive(dock, floatingId, panelId));
  },

  reorderDockTab: (panelId, toIndex) => {
    const dock = ensureDock(get().currentLayout as never);
    get().commitDock(reorderTab(dock, panelId, toIndex));
  },

  setFocusedPanel: (panelId) => {
    if (get().focusedPanelId !== panelId) set({ focusedPanelId: panelId });
  },

  floatFocusedPanel: () => {
    const id = get().focusedPanelId;
    if (!id) return false;
    const dock = ensureDock(get().currentLayout as never);
    if (panelLocation(dock, id) !== "docked") return false;
    get().floatPanelAt(id);
    return true;
  },

  dockBackFocusedPanel: () => {
    const id = get().focusedPanelId;
    if (!id) return false;
    const dock = ensureDock(get().currentLayout as never);
    const win = dock.floating.find((f) => f.panels.includes(id));
    if (!win) return false;
    get().dockBackFloating(win.id);
    return true;
  },

  setFloatCloseBehavior: (mode) => set({ floatCloseBehavior: mode }),

  setDockDrag: (drag) => set({ dockDrag: drag }),

  revealSampleEntry: (sampleId) => {
    set({ menuReveal: { menu: "File", submenuId: "menu.file.open_sample", entryId: sampleId, commandId: `sample.open.${sampleId.replace(/^sample\./, "")}` } });
  },

  clearMenuReveal: () => set({ menuReveal: null }),

  dockPanelToSlot: (panelId, slot) => {
    const dock = ensureDock(get().currentLayout as never);
    if (panelLocation(dock, panelId) === "docked" && findTabsOfPanel(dock, panelId)?.role === slot) {
      get().commitDock(activatePanel(dock, panelId));
      return;
    }
    get().commitDock(dockPanel(dock, panelId, { kind: "edge", edge: slot }));
  },

  toggleDockSlot: (slot) => {
    const dock = ensureDock(get().currentLayout as never);
    if (isSlotVisible(dock, slot)) {
      get().commitDock(hideSlot(dock, slot));
    } else {
      const fallback =
        slot === "bottom"
          ? ["panel.timeline"]
          : slot === "left"
            ? ["panel.colorbar", "panel.colorpicker"]
            : ["panel.history", "panel.layers"];
      get().commitDock(showSlot(dock, slot, fallback));
    }
  },

  setActiveDockTab: (slot, panelId) => {
    const dock = ensureDock(get().currentLayout as never);
    get().commitDock(openPanel(dock, panelId, slot));
  },

  persistLayout: () => {
    const s = get();
    void getPlatform().writeSetting("layout.v2", {
      activeWorkspaceId: s.activeWorkspaceId,
      floatCloseBehavior: s.floatCloseBehavior,
      layout: s.currentLayout,
      customWorkspaces: s.workspaces.filter((w) => !w.builtIn),
    }).catch((err) => appLogger.error("Layout", `Could not save layout: ${String(err)}`));
  },

  restoreLayout: async () => {
    try {
      const saved = await getPlatform().readSetting<{
        activeWorkspaceId?: string;
        floatCloseBehavior?: "close" | "redock";
        layout?: WorkspaceLayout;
        customWorkspaces?: WorkspaceLayout[];
      } | null>("layout.v2", null);
      if (!saved || !saved.layout) return;
      const layout = withDock(saved.layout);
      const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
      const vh = typeof window !== "undefined" ? window.innerHeight : 720;
      layout.dock = validateDock(layout.dock as DockState, { width: vw, height: vh });
      set((s) => ({
        currentLayout: layout,
        activeWorkspaceId: saved.activeWorkspaceId ?? s.activeWorkspaceId,
        floatCloseBehavior: saved.floatCloseBehavior ?? s.floatCloseBehavior,
        workspaces: [...BUILTIN_WORKSPACES.map(cloneWorkspaceLayout), ...(saved.customWorkspaces ?? []).map(withDock)],
        workspaceModified: false,
      }));
    } catch (err) {
      appLogger.warn("Layout", `Could not restore layout: ${String(err)}`);
    }
  },

  updateKeyBinding: (commandId, newKeys) => {
    defaultKeymap.setBinding(commandId, newKeys);
    appLogger.info("Keymap", `Bound ${commandId} -> ${newKeys}`);
    set({ keyBindings: defaultKeymap.getAll() });
  },

  resetKeyBinding: (commandId) => {
    defaultKeymap.resetOne(commandId);
    set({ keyBindings: defaultKeymap.getAll() });
  },

  resetAllKeyBindings: () => {
    defaultKeymap.resetAll();
    set({ keyBindings: defaultKeymap.getAll() });
  },

  openDialog: (dialogId) => set({ activeDialog: dialogId }),
  setActiveFilterTab: (activeFilterTab) => set({ activeFilterTab }),

  setSelectedSwatchIndices: (selectedSwatchIndices) => set({ selectedSwatchIndices }),

  selectSwatchWithModifiers: (idx, shiftKey, ctrlKey) => {
    const state = get();
    const doc = state.getActiveDocument();
    const pal = doc ? getPaletteForFrame(doc.sprite, state.activeFrameIndex) : [];
    const c = pal[idx] ?? state.fgColor;

    if (shiftKey && state.selectedSwatchIndices.length > 0) {
      const anchor = state.selectedSwatchIndices[0];
      const lo = Math.min(anchor, idx);
      const hi = Math.max(anchor, idx);
      const range = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
      set({
        selectedSwatchIndices: range,
        fgColor: c,
        fgPaletteIndex: idx,
      });
      return;
    }

    if (ctrlKey) {
      const has = state.selectedSwatchIndices.includes(idx);
      const next = has
        ? state.selectedSwatchIndices.filter((i) => i !== idx)
        : [...state.selectedSwatchIndices, idx];
      set({
        selectedSwatchIndices: next.length > 0 ? next : [idx],
        fgColor: c,
        fgPaletteIndex: idx,
      });
      return;
    }

    state.setFgColor(c, idx);
  },

  setRemapOnPaletteEdit: (remapOnPaletteEdit) => set({ remapOnPaletteEdit }),

  addColorToPalette: (color) => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc) return;
    const nextPalettes = doc.sprite.palettes.map((p, i) =>
      i === 0 ? { ...p, colors: [...p.colors, { ...color }] } : { ...p, colors: [...p.colors] }
    );
    doc.execute(
      new UpdatePaletteAndRemapCommand({
        label: "Add Color to Palette",
        nextPalettes,
      })
    );
    const newIdx = nextPalettes[0].colors.length - 1;
    set((s) => ({
      fgColor: { ...color },
      fgPaletteIndex: newIdx,
      selectedSwatchIndices: [newIdx],
      docRevision: s.docRevision + 1,
    }));
  },

  resetDefaultColors: () =>
    set({
      fgColor: { r: 0, g: 0, b: 0, a: 255 },
      bgColor: { r: 255, g: 255, b: 255, a: 255 },
      fgPaletteIndex: 0,
      bgPaletteIndex: 21,
    }),

  setShowSelectionEdges: (showSelectionEdges) => set({ showSelectionEdges }),

  setFloatingSelection: (floating, beforeImage, beforeMask) =>
    set((s) => ({
      floatingSelection: floating,
      floatingBeforeImage: beforeImage !== undefined ? beforeImage : s.floatingBeforeImage,
      floatingBeforeMask: beforeMask !== undefined ? beforeMask : s.floatingBeforeMask,
      docRevision: s.docRevision + 1,
    })),

  updateFloatingSelection: (patch) =>
    set((s) => {
      if (!s.floatingSelection) return s;
      return {
        floatingSelection: { ...s.floatingSelection, ...patch },
        docRevision: s.docRevision + 1,
      };
    }),

  commitFloatingSelection: () => {
    const state = get();
    const doc = state.getActiveDocument();
    const floating = state.floatingSelection;
    if (!doc || !floating) return;

    const cel = getCel(doc.sprite, state.activeLayerId, state.activeFrameIndex);
    if (!cel) {
      set({ floatingSelection: null, floatingBeforeImage: null, floatingBeforeMask: null });
      return;
    }

    const pal = getPaletteForFrame(doc.sprite, state.activeFrameIndex);
    const { image: afterImage, mask: afterMask } = commitFloatingSelectionToImage(
      cel.image,
      floating,
      pal,
      doc.sprite.transparentIndex
    );

    const beforeImage = state.floatingBeforeImage ?? cel.image.clone();
    const beforeMask = state.floatingBeforeMask ?? doc.sprite.mask.clone();

    // Restore base before executing command so undo restores exact pre-lift state
    cel.image = beforeImage.clone();
    doc.sprite.mask.bits.set(beforeMask.bits);
    doc.sprite.mask.recalcBounds();

    doc.execute(
      new CommitFloatingSelectionCommand({
        label: "Transform / Move Selection",
        layerId: state.activeLayerId,
        frameIndex: state.activeFrameIndex,
        beforeImage,
        afterImage,
        beforeMask,
        afterMask,
      })
    );

    set((s) => ({
      floatingSelection: null,
      floatingBeforeImage: null,
      floatingBeforeMask: null,
      docRevision: s.docRevision + 1,
    }));
  },

  cancelFloatingSelection: () => {
    const state = get();
    const doc = state.getActiveDocument();
    if (doc && state.floatingSelection) {
      const cel = getCel(doc.sprite, state.activeLayerId, state.activeFrameIndex);
      if (cel && state.floatingBeforeImage) {
        cel.image = state.floatingBeforeImage.clone();
      }
      if (state.floatingBeforeMask) {
        doc.sprite.mask.bits.set(state.floatingBeforeMask.bits);
        doc.sprite.mask.recalcBounds();
      }
    }
    set((s) => ({
      floatingSelection: null,
      floatingBeforeImage: null,
      floatingBeforeMask: null,
      docRevision: s.docRevision + 1,
    }));
  },

  liftActiveSelectionToFloating: (copyMode = false) => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc) return null;
    if (state.floatingSelection) return state.floatingSelection;

    const cel = getCel(doc.sprite, state.activeLayerId, state.activeFrameIndex);
    if (!cel) return null;

    const beforeImage = cel.image.clone();
    const beforeMask = doc.sprite.mask.clone();
    const { floating, clearedBase } = liftSelectionFromImage(
      cel.image,
      doc.sprite.mask,
      copyMode,
      doc.sprite.transparentIndex
    );
    floating.algorithm = state.toolOptions.transformAlgorithm;
    cel.image = clearedBase;

    set((s) => ({
      floatingSelection: floating,
      floatingBeforeImage: beforeImage,
      floatingBeforeMask: beforeMask,
      docRevision: s.docRevision + 1,
    }));
    return floating;
  },

  nudgeSelectionOrCel: (dx, dy, maskOnly = false) => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc) return;

    if (maskOnly || state.toolOptions.moveTargetMode === "selection_mask") {
      if (doc.sprite.mask.isEmpty) return;
      const moved = translateMask(doc.sprite.mask, dx, dy);
      doc.transact("Move Selection Mask", (tx) => tx.setMask(moved, "Move Selection Mask"));
      state.bumpRevision();
      return;
    }

    const floating = state.floatingSelection ?? state.liftActiveSelectionToFloating(false);
    if (floating) {
      state.updateFloatingSelection({
        x: floating.x + dx,
        y: floating.y + dy,
      });
    }
  },

  copySelectionToClipboard: (merged = false) => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc) return;
    if (state.floatingSelection) {
      state.commitFloatingSelection();
    }
    const sprite = doc.sprite;
    const srcImg = merged
      ? compositeFrame(sprite, state.activeFrameIndex)
      : getCel(sprite, state.activeLayerId, state.activeFrameIndex)?.image;
    if (!srcImg) return;

    const { floating } = liftSelectionFromImage(
      srcImg,
      sprite.mask,
      true,
      sprite.transparentIndex
    );
    set({
      pixelClipboard: {
        image: floating.sourceImage.clone(),
        x: floating.originX,
        y: floating.originY,
      },
    });
    void getPlatform().writeClipboardText(
      JSON.stringify({
        kpxClipboard: true,
        width: floating.sourceImage.width,
        height: floating.sourceImage.height,
        x: floating.originX,
        y: floating.originY,
      })
    );
    appLogger.info(
      "Clipboard",
      `${merged ? "Copied Merged" : "Copied"} ${floating.sourceImage.width}x${floating.sourceImage.height}px`
    );
  },

  cutSelectionToClipboard: () => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc) return;
    if (state.floatingSelection) {
      state.commitFloatingSelection();
    }
    const cel = getCel(doc.sprite, state.activeLayerId, state.activeFrameIndex);
    if (!cel) return;

    const beforeImage = cel.image.clone();
    const beforeMask = doc.sprite.mask.clone();
    const { floating, clearedBase } = liftSelectionFromImage(
      cel.image,
      doc.sprite.mask,
      false,
      doc.sprite.transparentIndex
    );

    const emptyMask = new Mask(doc.sprite.width, doc.sprite.height);
    doc.execute(
      new CommitFloatingSelectionCommand({
        label: "Cut Selection",
        layerId: state.activeLayerId,
        frameIndex: state.activeFrameIndex,
        beforeImage,
        afterImage: clearedBase,
        beforeMask,
        afterMask: emptyMask,
      })
    );

    set((s) => ({
      pixelClipboard: {
        image: floating.sourceImage.clone(),
        x: floating.originX,
        y: floating.originY,
      },
      docRevision: s.docRevision + 1,
    }));
    appLogger.info(
      "Clipboard",
      `Cut ${floating.sourceImage.width}x${floating.sourceImage.height}px to clipboard`
    );
  },

  pasteFromClipboard: (atX, atY) => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc || !state.pixelClipboard) return;
    if (state.floatingSelection) {
      state.commitFloatingSelection();
    }

    const cel = getCel(doc.sprite, state.activeLayerId, state.activeFrameIndex);
    if (!cel) return;

    const clip = state.pixelClipboard;
    const dstX = atX !== undefined ? atX : clip.x;
    const dstY = atY !== undefined ? atY : clip.y;

    const localMask = new Mask(clip.image.width, clip.image.height);
    localMask.selectAll();

    const floating: FloatingSelectionState = {
      sourceImage: clip.image.clone(),
      localMask,
      originX: dstX,
      originY: dstY,
      x: dstX,
      y: dstY,
      width: clip.image.width,
      height: clip.image.height,
      angleDeg: 0,
      skewXDeg: 0,
      skewYDeg: 0,
      pivotRelX: 0.5,
      pivotRelY: 0.5,
      algorithm: state.toolOptions.transformAlgorithm,
    };

    const nextMask = new Mask(doc.sprite.width, doc.sprite.height);
    nextMask.selectRect({
      x: dstX,
      y: dstY,
      width: clip.image.width,
      height: clip.image.height,
    });

    set((s) => ({
      activeToolId: "tool.move",
      floatingSelection: floating,
      floatingBeforeImage: cel.image.clone(),
      floatingBeforeMask: doc.sprite.mask.clone(),
      docRevision: s.docRevision + 1,
    }));
    appLogger.info("Clipboard", `Pasted floating selection at (${dstX}, ${dstY})`);
  },

  pasteAsNewLayer: () => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc) return;
    if (!state.pixelClipboard) {
      state.copySelectionToClipboard(false);
    }
    const clip = get().pixelClipboard;
    if (!clip) return;

    let createdLayerId = "";
    doc.transact("Paste as New Layer", (tx) => {
      const layer = tx.addImageLayer("Pasted Layer");
      createdLayerId = layer.id;
    });
    const newCel = getCel(doc.sprite, createdLayerId, state.activeFrameIndex);
    if (newCel) {
      const pal = getPaletteForFrame(doc.sprite, state.activeFrameIndex);
      newCel.image.blit(clip.image, clip.x, clip.y, "normal", 255, pal, doc.sprite.transparentIndex);
    }
    set((s) => ({
      activeLayerId: createdLayerId || s.activeLayerId,
      docRevision: s.docRevision + 1,
    }));
  },

  pasteAsNewSprite: () => {
    const state = get();
    if (!state.pixelClipboard) {
      state.copySelectionToClipboard(true);
    }
    const clip = get().pixelClipboard;
    if (!clip) return;

    const newDoc = state.createNewDocument({
      name: `Pasted-${clip.image.width}x${clip.image.height}.ase`,
      width: clip.image.width,
      height: clip.image.height,
      colorMode: clip.image.colorMode,
      background: "transparent",
    });
    newDoc.sprite.cels[0].image.data.set(clip.image.data);
    state.bumpRevision();
  },

  pasteAsNewBrush: () => {
    const state = get();
    if (!state.pixelClipboard) {
      state.copySelectionToClipboard(false);
    }
    const clip = get().pixelClipboard;
    if (!clip) {
      state.captureCustomBrushFromCanvas();
      return;
    }
    const stampBrush = Brush.fromImage(clip.image, {
      name: `Clip ${clip.image.width}x${clip.image.height}`,
    });
    const added = defaultBrushLibrary.addBrush(stampBrush.config);
    set((s) => ({
      brushes: defaultBrushLibrary.getAll(),
      activeBrushId: added.id,
      activeToolId: "tool.pencil",
      toolOptions: {
        ...s.toolOptions,
        brushShape: "image",
        brushSize: added.size,
        customBrushImage: added.image?.clone(),
      },
    }));
  },

  deleteSelectionPixels: () => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc) return;
    if (state.floatingSelection) {
      state.cancelFloatingSelection();
    }
    const cel = getCel(doc.sprite, state.activeLayerId, state.activeFrameIndex);
    if (!cel) return;

    const beforeImage = cel.image.clone();
    const beforeMask = doc.sprite.mask.clone();
    const { clearedBase } = liftSelectionFromImage(
      cel.image,
      doc.sprite.mask,
      false,
      doc.sprite.transparentIndex
    );

    doc.execute(
      new CommitFloatingSelectionCommand({
        label: "Clear Selection",
        layerId: state.activeLayerId,
        frameIndex: state.activeFrameIndex,
        beforeImage,
        afterImage: clearedBase,
        beforeMask,
        afterMask: beforeMask,
      })
    );
    state.bumpRevision();
  },

  fillSelectionWithFg: () => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc) return;
    if (state.floatingSelection) state.commitFloatingSelection();
    const cel = getCel(doc.sprite, state.activeLayerId, state.activeFrameIndex);
    if (!cel) return;
    const pal = getPaletteForFrame(doc.sprite, state.activeFrameIndex);
    const beforeImage = cel.image.clone();
    const afterImage = fillSelectionOnImage(
      cel.image,
      doc.sprite.mask,
      state.fgColor,
      pal,
      doc.sprite.transparentIndex
    );
    doc.execute(
      new CommitFloatingSelectionCommand({
        label: "Fill Selection",
        layerId: state.activeLayerId,
        frameIndex: state.activeFrameIndex,
        beforeImage,
        afterImage,
        beforeMask: doc.sprite.mask,
        afterMask: doc.sprite.mask,
      })
    );
    state.bumpRevision();
  },

  strokeSelectionBorder: (borderWidth, shape = "square") => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc) return;
    if (state.floatingSelection) state.commitFloatingSelection();
    const cel = getCel(doc.sprite, state.activeLayerId, state.activeFrameIndex);
    if (!cel) return;
    const pal = getPaletteForFrame(doc.sprite, state.activeFrameIndex);
    const beforeImage = cel.image.clone();
    const bw = borderWidth ?? Math.max(1, state.toolOptions.brushSize);
    const afterImage = strokeSelectionOnImage(
      cel.image,
      doc.sprite.mask,
      state.fgColor,
      bw,
      shape,
      pal,
      doc.sprite.transparentIndex
    );
    doc.execute(
      new CommitFloatingSelectionCommand({
        label: "Stroke Selection",
        layerId: state.activeLayerId,
        frameIndex: state.activeFrameIndex,
        beforeImage,
        afterImage,
        beforeMask: doc.sprite.mask,
        afterMask: doc.sprite.mask,
      })
    );
    state.bumpRevision();
  },

  newSpriteFromSelection: () => {
    const state = get();
    state.copySelectionToClipboard(true);
    state.pasteAsNewSprite();
  },

  duplicateActiveSprite: (flatten = false, newName) => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc) return;
    const snap = serializeSnapshot(doc.sprite);
    const clonedSprite = deserializeSnapshot(snap);
    clonedSprite.id = createModelId("sprite");
    clonedSprite.name = newName?.trim() || `${doc.sprite.name.replace(/\.ase$/i, "")}-copy.ase`;

    const newDoc = new SpriteDocument(clonedSprite);
    if (flatten) {
      newDoc.execute(new FlattenLayersCommand(false));
    }
    const topLayer = newDoc.sprite.layers[newDoc.sprite.layers.length - 1];
    set((s) => ({
      documents: [...s.documents, newDoc],
      activeTabId: newDoc.id,
      activeLayerId: topLayer.id,
      activeFrameIndex: 0,
      docRevision: s.docRevision + 1,
    }));
  },

  cropToSelection: () => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc) return;
    if (state.floatingSelection) state.commitFloatingSelection();
    const bounds = doc.sprite.mask.bounds ?? computeSpriteNonEmptyBounds(doc.sprite);
    doc.execute(
      new CropOrCanvasSizeCommand({
        label: "Crop to Selection",
        newWidth: bounds.width,
        newHeight: bounds.height,
        offsetX: -bounds.x,
        offsetY: -bounds.y,
      })
    );
    state.bumpRevision();
  },

  trimSpriteBorders: () => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc) return;
    if (state.floatingSelection) state.commitFloatingSelection();
    const bounds = computeSpriteNonEmptyBounds(doc.sprite);
    doc.execute(
      new CropOrCanvasSizeCommand({
        label: "Trim Sprite Borders",
        newWidth: bounds.width,
        newHeight: bounds.height,
        offsetX: -bounds.x,
        offsetY: -bounds.y,
      })
    );
    state.bumpRevision();
  },

  convertActiveSpriteColorMode: (targetMode, dither = "none", customPalette, transparentIndex) => {
    const state = get();
    const doc = state.getActiveDocument();
    if (!doc) return;
    doc.execute(
      new ConvertColorModeAdvancedCommand({
        targetMode,
        dither,
        customPalette,
        transparentIndex,
      })
    );
    state.bumpRevision();
  },

  // Agent 5 Scripting & Extensions Actions
  setActiveScript: (name, code) => {
    const found = defaultScriptStorage.getByName(name);
    const resolvedCode = code ?? found?.code ?? "";
    set({
      activeScriptName: name,
      activeScriptCode: resolvedCode,
      scriptDirty: false,
    });
  },

  updateActiveScriptCode: (code) => {
    void getPlatform().writeSetting("kpx_script_draft", {
      name: get().activeScriptName,
      code,
    });
    set({
      activeScriptCode: code,
      scriptDirty: true,
    });
  },

  runActiveScript: async (overrideCode, overrideName) => {
    const state = get();
    const doc = state.getActiveDocument();
    const code = overrideCode ?? state.activeScriptCode;
    const scriptName = overrideName ?? state.activeScriptName;

    set({ scriptRunning: true });
    let pendingPerm: ScriptPermissionRequest | null = null;
    let renderedDialog: ScriptDialogResult | null = null;

    // The sandbox compiles user code through a `blob:` module (CSP: no 'unsafe-eval'),
    // which is asynchronous, so the whole run is awaited before logging the summary.
    const runSandbox = async (): Promise<ScriptExecutionResult> =>
      executeKekenikScript(code, {
      doc,
      activeLayerId: state.activeLayerId,
      activeFrameIndex: state.activeFrameIndex,
      activeToolId: state.activeToolId,
      fgColor: state.fgColor,
      bgColor: state.bgColor,
      scriptName,
      onPermissionRequest: (req) => {
        pendingPerm = req;
        return true;
      },
      onSelectTool: (toolId) => state.setActiveTool(toolId),
      onSetFgColor: (c) => state.setFgColor(c),
      onSetBgColor: (c) => state.setBgColor(c),
      onSetActiveFrame: (f) => state.setActiveFrame(f),
      onOpenNewDoc: (newDoc) => {
        const topLayer = newDoc.sprite.layers[newDoc.sprite.layers.length - 1];
        set((s) => ({
          documents: [...s.documents, newDoc],
          activeTabId: newDoc.id,
          activeLayerId: topLayer ? topLayer.id : "",
          activeFrameIndex: 0,
        }));
      },
      onDialogRender: (dlg) => {
        renderedDialog = dlg;
      },
        onAlert: (msg) => {
          appLogger.info("ScriptAlert", msg);
        },
      });

    const res = await runSandbox();

    const summaryLog: ScriptConsoleEntry = res.success
      ? {
          level: "log",
          message: `[PASS] Executed "${scriptName}" in ${res.durationMs}ms`,
          timestamp: new Date().toISOString().slice(11, 19),
        }
      : {
          level: "error",
          message: `[FAIL] ${res.error ?? "Script error"}`,
          line: res.errorLine,
          timestamp: new Date().toISOString().slice(11, 19),
        };

    set((s) => ({
      scriptRunning: false,
      scriptConsoleLogs: [...s.scriptConsoleLogs, ...res.logs, summaryLog].slice(-200),
      activeScriptDialog: renderedDialog ?? s.activeScriptDialog,
      pendingPermissionRequest: pendingPerm,
      activeDialog: renderedDialog
        ? "dialog.script_custom"
        : pendingPerm
        ? "dialog.script_permissions"
        : s.activeDialog,
      docRevision: s.docRevision + 1,
    }));
  },

  stopActiveScript: () => {
    set((s) => ({
      scriptRunning: false,
      scriptConsoleLogs: [
        ...s.scriptConsoleLogs,
        {
          level: "warn",
          message: "[Cancelled] Script execution stopped by user.",
          timestamp: new Date().toISOString().slice(11, 19),
        },
      ],
    }));
  },

  clearScriptConsole: () => set({ scriptConsoleLogs: [] }),

  saveCurrentScript: async (asName) => {
    const state = get();
    const targetName = asName?.trim() || state.activeScriptName;
    const saved = await defaultScriptStorage.saveScript(targetName, state.activeScriptCode);
    set({
      activeScriptName: saved.name,
      savedScripts: defaultScriptStorage.getAll(),
      scriptDirty: false,
    });
    appLogger.info("ScriptEditor", `Saved script "${saved.name}" to scripts/`);
  },

  renameCurrentScript: async (newName) => {
    const state = get();
    const updated = await defaultScriptStorage.renameScript(state.activeScriptName, newName);
    if (updated) {
      set({
        activeScriptName: updated.name,
        savedScripts: defaultScriptStorage.getAll(),
      });
    }
  },

  deleteScriptByName: async (name) => {
    await defaultScriptStorage.deleteScript(name);
    const all = defaultScriptStorage.getAll();
    const next = all[0] ?? { name: "hello-world.ts", code: BUILTIN_SAMPLE_SCRIPTS[11].code };
    set({
      savedScripts: all,
      activeScriptName: next.name,
      activeScriptCode: next.code,
      scriptDirty: false,
    });
  },

  rescanScripts: async () => {
    const all = await defaultScriptStorage.rescanScriptsFolder();
    set({ savedScripts: all });
    appLogger.info("ScriptEditor", `Rescanned scripts folder (${all.length} scripts found)`);
  },

  assignShortcutToScript: (scriptName, shortcutKeys) => {
    const cmdId = `script.user.${scriptName.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    CommandRegistry.register({
      id: cmdId,
      title: `Run Script: ${scriptName}`,
      category: "Actions",
      ownerAgent: 5,
      state: "tested",
      run: () => {
        const script = defaultScriptStorage.getByName(scriptName);
        if (script) {
          get().runActiveScript(script.code, script.name);
        }
      },
    });
    defaultKeymap.setBinding(cmdId, shortcutKeys);
    void defaultScriptStorage.saveScript(
      scriptName,
      defaultScriptStorage.getByName(scriptName)?.code ?? get().activeScriptCode,
      shortcutKeys
    );
    set({
      keyBindings: defaultKeymap.getAll(),
      savedScripts: defaultScriptStorage.getAll(),
    });
    appLogger.info("ScriptEditor", `Assigned shortcut ${shortcutKeys} to script "${scriptName}"`);
  },

  closeScriptDialog: () =>
    set((s) => ({
      activeScriptDialog: null,
      activeDialog: s.activeDialog === "dialog.script_custom" ? null : s.activeDialog,
    })),

  resolvePermissionPrompt: (granted) => {
    const req = get().pendingPermissionRequest;
    if (req) {
      defaultScriptPermissionStore.setDecision(req.scriptHash, req.permission, granted);
      appLogger.info(
        "ScriptPermissions",
        `Permission '${req.permission}' ${granted ? "GRANTED" : "DENIED"} for ${req.scriptName} (${req.scriptHash})`
      );
    }
    set((s) => ({
      pendingPermissionRequest: null,
      activeDialog: s.activeDialog === "dialog.script_permissions" ? null : s.activeDialog,
    }));
  },

  installExtensionFromDisk: async () => {
    const res = await getPlatform().openFileDialog({
      title: "Install Extension (.kpext)",
      extensions: ["kpext", "zip", "json"],
    });
    if (!res) return;
    try {
      const rec = defaultExtensionManager.installKpext(res.data, true);
      const firstTheme = rec.contributedIds.themes[0];
      set((s) => ({
        installedExtensions: defaultExtensionManager.getAll(),
        extensionConflicts: defaultExtensionManager.detectConflicts(),
        keyBindings: defaultKeymap.getAll(),
        brushes: defaultBrushLibrary.getAll(),
        theme: firstTheme && ThemeRegistry.has(firstTheme) ? firstTheme : s.theme,
        docRevision: s.docRevision + 1,
      }));
    } catch (err) {
      appLogger.error(
        "Extensions",
        `Failed to install .kpext: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },

  installSampleExtensionById: (idOrFolder) => {
    const rec = defaultExtensionManager.installSampleExtension(idOrFolder, true);
    const firstTheme = rec.contributedIds.themes[0];
    set((s) => ({
      installedExtensions: defaultExtensionManager.getAll(),
      extensionConflicts: defaultExtensionManager.detectConflicts(),
      keyBindings: defaultKeymap.getAll(),
      brushes: defaultBrushLibrary.getAll(),
      theme: firstTheme && ThemeRegistry.has(firstTheme) ? firstTheme : s.theme,
      docRevision: s.docRevision + 1,
    }));
  },

  toggleExtensionEnabled: (extId) => {
    const rec = defaultExtensionManager.get(extId);
    if (!rec) return;
    const prevThemes = [...rec.contributedIds.themes];
    if (rec.enabled) {
      defaultExtensionManager.disableExtension(extId);
    } else {
      defaultExtensionManager.enableExtension(extId);
    }
    const updated = defaultExtensionManager.get(extId);
    const firstEnabledTheme = updated?.enabled ? updated.contributedIds.themes[0] : undefined;
    set((s) => ({
      installedExtensions: defaultExtensionManager.getAll(),
      extensionConflicts: defaultExtensionManager.detectConflicts(),
      keyBindings: defaultKeymap.getAll(),
      brushes: defaultBrushLibrary.getAll(),
      theme: firstEnabledTheme
        ? firstEnabledTheme
        : prevThemes.includes(s.theme)
        ? "default-dark"
        : s.theme,
      docRevision: s.docRevision + 1,
    }));
  },

  uninstallExtensionById: (extId) => {
    const rec = defaultExtensionManager.get(extId);
    const prevThemes = rec ? [...rec.contributedIds.themes] : [];
    defaultExtensionManager.uninstallExtension(extId);
    set((s) => ({
      installedExtensions: defaultExtensionManager.getAll(),
      extensionConflicts: defaultExtensionManager.detectConflicts(),
      keyBindings: defaultKeymap.getAll(),
      brushes: defaultBrushLibrary.getAll(),
      theme: prevThemes.includes(s.theme) ? "default-dark" : s.theme,
      docRevision: s.docRevision + 1,
    }));
  },

  reloadAllExtensions: () => {
    defaultExtensionManager.reloadAll();
    set((s) => ({
      installedExtensions: defaultExtensionManager.getAll(),
      extensionConflicts: defaultExtensionManager.detectConflicts(),
      keyBindings: defaultKeymap.getAll(),
      brushes: defaultBrushLibrary.getAll(),
      docRevision: s.docRevision + 1,
    }));
  },

  exportSampleKpextToDisk: async (idOrFolder) => {
    const found = SAMPLE_EXTENSION_BUNDLES.find(
      (b) => b.id === idOrFolder || b.folderName === idOrFolder
    );
    if (!found) return;
    const zipBytes = packKpextZip(found.files);
    await getPlatform().saveFileDialog(zipBytes, {
      defaultName: `${found.folderName}.kpext`,
    });
  },

  runCommandById: (commandId) => {
    if (handleAgent6Command(commandId, { get, set } as never)) return;
    const state = get();
    const doc = state.getActiveDocument();
    switch (commandId) {
      case "file.new":
        state.openDialog("dialog.new_sprite");
        break;
      case "file.open":
        void state.openSnapshotFromDisk();
        break;
      case "file.save":
        void state.saveActiveSnapshot();
        break;
      case "demo.antihero":
        state.openDemoDocument("antihero");
        break;
      case "demo.slime":
        state.openDemoDocument("slime");
        break;
      case "demo.blend":
        state.openDemoDocument("blend");
        break;
      case "demo.brush_showcase":
        state.openDemoDocument("brush_showcase");
        break;
      case "demo.symmetry_playground":
        state.openDemoDocument("symmetry_playground");
        break;
      case "demo.dithering_gradients":
        state.openDemoDocument("dithering_gradients");
        break;
      case "demo.shapes_fills":
        state.openDemoDocument("shapes_fills");
        break;
      case "demo.tiled_pattern":
        state.openDemoDocument("tiled_pattern");
        break;
      case "demo.walk_cycle":
        state.openDemoDocument("walk_cycle");
        break;
      case "demo.onion_skin_lab":
        state.openDemoDocument("onion_skin_lab");
        break;
      case "demo.layer_groups_blends":
        state.openDemoDocument("layer_groups_blends");
        break;
      case "demo.linked_cels_lab":
        state.openDemoDocument("linked_cels_lab");
        break;
      case "demo.tilemap_dungeon":
        state.openDemoDocument("tilemap_dungeon");
        break;
      case "demo.slices_9patch_ui":
        state.openDemoDocument("slices_9patch_ui");
        break;
      case "demo.selection_playground":
        state.openDemoDocument("selection_playground");
        break;
      case "demo.transform_rotsprite_lab":
        state.openDemoDocument("transform_rotsprite_lab");
        break;
      case "demo.palette_remap_lab":
        state.openDemoDocument("palette_remap_lab");
        break;
      case "demo.indexed_dither_compare":
        state.openDemoDocument("indexed_dither_compare");
        break;
      case "demo.filters_gallery":
        state.openDemoDocument("filters_gallery");
        break;
      case "file.close":
        if (doc) state.closeDocument(doc.id);
        break;
      case "file.exit":
        state.setActiveTab("home");
        break;
      case "edit.undo":
        if (doc && doc.undo()) state.bumpRevision();
        break;
      case "edit.redo":
        if (doc && doc.redo()) state.bumpRevision();
        break;
      case "edit.undo_history":
        state.setActiveDockTab("right", "panel.history");
        break;
      case "edit.keyboard_shortcuts":
        state.openDialog("dialog.shortcuts");
        break;
      case "edit.preferences":
        state.openDialog("dialog.preferences");
        break;
      case "sprite.size":
        state.openDialog("dialog.sprite_size");
        break;
      case "sprite.canvas_size":
        state.openDialog("dialog.canvas_size");
        break;
      case "sprite.mode_rgba":
        state.convertActiveSpriteColorMode("rgba");
        break;
      case "sprite.mode_gray":
        state.convertActiveSpriteColorMode("grayscale");
        break;
      case "sprite.mode_idx":
        state.openDialog("dialog.color_mode");
        break;
      case "sprite.colormode_dialog":
        state.openDialog("dialog.color_mode");
        break;
      case "sprite.props":
        state.openDialog("dialog.sprite_properties");
        break;
      case "sprite.duplicate":
        state.openDialog("dialog.duplicate_sprite");
        break;
      case "sprite.crop":
        state.cropToSelection();
        break;
      case "sprite.trim":
        state.trimSpriteBorders();
        break;
      case "sprite.rotate_180":
        if (doc) {
          doc.execute(
            new TransformSpriteOrCelCommand({
              label: "Rotate Canvas 180°",
              scope: "sprite",
              layerId: state.activeLayerId,
              frameIndex: state.activeFrameIndex,
              op: { kind: "rotate_ortho", dir: "180" },
            })
          );
          state.bumpRevision();
        }
        break;
      case "sprite.rotate_90cw":
        if (doc) {
          doc.execute(
            new TransformSpriteOrCelCommand({
              label: "Rotate Canvas 90° CW",
              scope: "sprite",
              layerId: state.activeLayerId,
              frameIndex: state.activeFrameIndex,
              op: { kind: "rotate_ortho", dir: "90cw" },
            })
          );
          state.bumpRevision();
        }
        break;
      case "sprite.rotate_90ccw":
        if (doc) {
          doc.execute(
            new TransformSpriteOrCelCommand({
              label: "Rotate Canvas 90° CCW",
              scope: "sprite",
              layerId: state.activeLayerId,
              frameIndex: state.activeFrameIndex,
              op: { kind: "rotate_ortho", dir: "90ccw" },
            })
          );
          state.bumpRevision();
        }
        break;
      case "sprite.flip_h":
        if (doc) {
          doc.execute(
            new TransformSpriteOrCelCommand({
              label: "Flip Canvas Horizontal",
              scope: "sprite",
              layerId: state.activeLayerId,
              frameIndex: state.activeFrameIndex,
              op: { kind: "flip_h" },
            })
          );
          state.bumpRevision();
        }
        break;
      case "sprite.flip_v":
        if (doc) {
          doc.execute(
            new TransformSpriteOrCelCommand({
              label: "Flip Canvas Vertical",
              scope: "sprite",
              layerId: state.activeLayerId,
              frameIndex: state.activeFrameIndex,
              op: { kind: "flip_v" },
            })
          );
          state.bumpRevision();
        }
        break;
      case "layer.new":
        if (doc) {
          let createdId = "";
          doc.transact("New Layer", (tx) => {
            createdId = tx.addImageLayer().id;
          });
          if (createdId) state.setActiveLayer(createdId);
          state.bumpRevision();
        }
        break;
      case "layer.delete":
        if (doc && doc.sprite.layers.length > 1) {
          doc.transact("Delete Layer", (tx) => tx.removeLayer(state.activeLayerId));
          state.setActiveLayer(doc.sprite.layers[doc.sprite.layers.length - 1].id);
          state.bumpRevision();
        }
        break;
      case "layer.new_group":
        state.createGroupLayer();
        break;
      case "layer.new_reference":
        state.createReferenceLayer();
        break;
      case "layer.new_tilemap":
        state.openDialog("dialog.new_tilemap_layer");
        break;
      case "layer.properties":
        state.openDialog("dialog.layer_properties");
        break;
      case "layer.duplicate":
        state.duplicateActiveLayer();
        break;
      case "layer.merge_down":
        state.mergeDownActiveLayer();
        break;
      case "layer.flatten":
        state.flattenLayers(false);
        break;
      case "layer.flatten_visible":
        state.flattenLayers(true);
        break;
      case "layer.convert_bg":
        state.convertActiveLayer("background");
        break;
      case "layer.convert_tilemap":
        state.convertActiveLayer("tilemap");
        break;
      case "layer.toggle_group":
        if (doc) {
          const l = doc.sprite.layers.find((item) => item.id === state.activeLayerId);
          if (l && l.kind === "group") {
            doc.execute(new SetLayerFullPropsCommand(l.id, { collapsed: !l.collapsed }));
            state.bumpRevision();
          }
        }
        break;
      case "layer.isolate":
        state.isolateLayer(state.activeLayerId);
        break;
      case "layer.lock_all":
        state.lockUnlockAllLayers();
        break;
      case "layer.show_hide_all":
        state.showHideAllLayers();
        break;
      case "layer.move_up":
      case "action.layer_up":
        state.moveActiveLayerStep(1);
        break;
      case "layer.move_down":
      case "action.layer_down":
        state.moveActiveLayerStep(-1);
        break;
      case "layer.group_selected":
        state.groupSelectedLayers();
        break;
      case "layer.ungroup":
        state.ungroupActiveLayer();
        break;
      case "frame.new":
        if (doc) {
          doc.transact("New Frame", (tx) => tx.addFrame(state.activeFrameIndex, false));
          state.setActiveFrame(state.activeFrameIndex + 1);
          state.bumpRevision();
        }
        break;
      case "frame.new_empty":
        state.addEmptyFrame();
        break;
      case "frame.duplicate":
        if (doc) {
          doc.transact("Duplicate Frame", (tx) => tx.addFrame(state.activeFrameIndex, true));
          state.setActiveFrame(state.activeFrameIndex + 1);
          state.bumpRevision();
        }
        break;
      case "frame.duplicate_cels":
        state.duplicateSelectedCels();
        break;
      case "frame.delete":
        if (doc && doc.sprite.frames.length > 1) {
          doc.transact("Delete Frame", (tx) => tx.removeFrame(state.activeFrameIndex));
          state.setActiveFrame(Math.max(0, state.activeFrameIndex - 1));
          state.bumpRevision();
        }
        break;
      case "frame.properties":
        state.openDialog("dialog.frame_properties");
        break;
      case "frame.cel_properties":
        state.openDialog("dialog.cel_properties");
        break;
      case "frame.constant_rate":
        state.openDialog("dialog.constant_frame_rate");
        break;
      case "frame.reverse":
        state.reverseSelectedFrames();
        break;
      case "frame.link_cels":
        state.linkSelectedCels(true);
        break;
      case "frame.unlink_cels":
        state.linkSelectedCels(false);
        break;
      case "frame.clear_cel":
        state.clearSelectedCels();
        break;
      case "frame.copy_cels":
        state.copySelectedCels();
        break;
      case "frame.paste_cels":
        state.pasteCelsAtActive();
        break;
      case "frame.new_tag":
      case "frame.tag_properties":
        state.openDialog("dialog.tag_properties");
        break;
      case "frame.goto_first":
        state.setActiveFrame(0);
        break;
      case "frame.goto_prev":
        state.stepFrame(-1);
        break;
      case "frame.goto_next":
        state.stepFrame(1);
        break;
      case "frame.goto_last":
        if (doc) state.setActiveFrame(doc.sprite.frames.length - 1);
        break;
      case "frame.goto_prev_tag":
        state.jumpToTag(-1);
        break;
      case "frame.goto_next_tag":
        state.jumpToTag(1);
        break;
      case "frame.play":
        state.setIsPlaying(!state.isPlaying);
        break;
      case "view.onion_skin":
        state.toggleOnionSkin();
        break;
      case "view.onion_skin_settings":
        state.openDialog("dialog.onion_skin");
        break;
      case "view.tileset_panel":
        state.setActiveDockTab("right", "panel.tileset");
        break;
      case "view.tags_panel":
        state.setActiveDockTab("right", "panel.tags");
        break;
      case "view.slices_panel":
        state.setActiveDockTab("right", "panel.slices");
        break;
      case "edit.cut":
        state.cutSelectionToClipboard();
        break;
      case "edit.copy":
        state.copySelectionToClipboard(false);
        break;
      case "edit.copy_merged":
        state.copySelectionToClipboard(true);
        break;
      case "edit.paste":
        state.pasteFromClipboard();
        break;
      case "edit.paste_special":
        state.openDialog("dialog.paste_special");
        break;
      case "edit.paste_new_layer":
        state.pasteAsNewLayer();
        break;
      case "edit.paste_new_sprite":
        state.pasteAsNewSprite();
        break;
      case "edit.paste_new_brush":
      case "edit.new_brush":
        state.pasteAsNewBrush();
        break;
      case "edit.delete":
      case "edit.clear":
        state.deleteSelectionPixels();
        break;
      case "edit.fill_selection":
        state.fillSelectionWithFg();
        break;
      case "edit.stroke_selection":
        state.strokeSelectionBorder();
        break;
      case "edit.new_sprite_from_sel":
        state.newSpriteFromSelection();
        break;
      case "edit.flip_h":
        if (doc) {
          if (state.floatingSelection) {
            const flipped = flipFloatingSelectionHorizontal(state.floatingSelection);
            const b = {
              x: Math.round(flipped.x),
              y: Math.round(flipped.y),
              width: Math.round(flipped.width),
              height: Math.round(flipped.height),
            };
            const nextMask = flipMaskHorizontal(doc.sprite.mask, b);
            doc.sprite.mask.bits.set(nextMask.bits);
            doc.sprite.mask.recalcBounds();
            state.setFloatingSelection(flipped);
          } else {
            doc.execute(
              new TransformSpriteOrCelCommand({
                label: "Flip Horizontal",
                scope: "cel",
                layerId: state.activeLayerId,
                frameIndex: state.activeFrameIndex,
                op: { kind: "flip_h" },
              })
            );
            state.bumpRevision();
          }
        }
        break;
      case "edit.flip_v":
        if (doc) {
          if (state.floatingSelection) {
            const flipped = flipFloatingSelectionVertical(state.floatingSelection);
            const b = {
              x: Math.round(flipped.x),
              y: Math.round(flipped.y),
              width: Math.round(flipped.width),
              height: Math.round(flipped.height),
            };
            const nextMask = flipMaskVertical(doc.sprite.mask, b);
            doc.sprite.mask.bits.set(nextMask.bits);
            doc.sprite.mask.recalcBounds();
            state.setFloatingSelection(flipped);
          } else {
            doc.execute(
              new TransformSpriteOrCelCommand({
                label: "Flip Vertical",
                scope: "cel",
                layerId: state.activeLayerId,
                frameIndex: state.activeFrameIndex,
                op: { kind: "flip_v" },
              })
            );
            state.bumpRevision();
          }
        }
        break;
      case "edit.rotate_180":
        if (doc) {
          doc.execute(
            new TransformSpriteOrCelCommand({
              label: "Rotate 180°",
              scope: "cel",
              layerId: state.activeLayerId,
              frameIndex: state.activeFrameIndex,
              op: { kind: "rotate_ortho", dir: "180" },
            })
          );
          state.bumpRevision();
        }
        break;
      case "edit.rotate_90cw":
        if (doc) {
          doc.execute(
            new TransformSpriteOrCelCommand({
              label: "Rotate 90° CW",
              scope: "cel",
              layerId: state.activeLayerId,
              frameIndex: state.activeFrameIndex,
              op: { kind: "rotate_ortho", dir: "90cw" },
            })
          );
          state.bumpRevision();
        }
        break;
      case "edit.rotate_90ccw":
        if (doc) {
          doc.execute(
            new TransformSpriteOrCelCommand({
              label: "Rotate 90° CCW",
              scope: "cel",
              layerId: state.activeLayerId,
              frameIndex: state.activeFrameIndex,
              op: { kind: "rotate_ortho", dir: "90ccw" },
            })
          );
          state.bumpRevision();
        }
        break;
      case "edit.transform":
        state.openDialog("dialog.rotate_angle");
        break;
      case "edit.shift_pixels":
        state.openDialog("dialog.shift_pixels");
        break;
      case "edit.replace_color":
        state.setActiveFilterTab("replace_color");
        state.openDialog("dialog.filter_fx");
        break;
      case "edit.invert_color":
        if (doc) {
          const cel = getCel(doc.sprite, state.activeLayerId, state.activeFrameIndex);
          if (cel) {
            const pal = getPaletteForFrame(doc.sprite, state.activeFrameIndex);
            const before = cel.image.clone();
            const after = applyInvertFilter(cel.image, {
              mask: doc.sprite.mask,
              palette: pal,
              transparentIndex: doc.sprite.transparentIndex,
            });
            doc.execute(
              new CommitFloatingSelectionCommand({
                label: "Invert Color",
                layerId: state.activeLayerId,
                frameIndex: state.activeFrameIndex,
                beforeImage: before,
                afterImage: after,
                beforeMask: doc.sprite.mask,
                afterMask: doc.sprite.mask,
              })
            );
            state.bumpRevision();
          }
        }
        break;
      case "edit.adjustments":
        state.setActiveFilterTab("hue_sat");
        state.openDialog("dialog.filter_fx");
        break;
      case "edit.fx":
        state.setActiveFilterTab("outline");
        state.openDialog("dialog.filter_fx");
        break;
      case "edit.palette_editor":
        state.openDialog("dialog.palette_editor");
        break;
      case "select.all":
        if (doc) {
          if (state.floatingSelection) state.commitFloatingSelection();
          const m = doc.sprite.mask.clone();
          m.selectAll();
          doc.transact("Select All", (tx) => tx.setMask(m, "Select All"));
          state.bumpRevision();
        }
        break;
      case "select.deselect":
        if (doc) {
          if (state.floatingSelection) state.commitFloatingSelection();
          const prevMask = doc.sprite.mask.isEmpty ? state.lastDeselectedMask : doc.sprite.mask.clone();
          const m = doc.sprite.mask.clone();
          m.clear();
          doc.transact("Deselect", (tx) => tx.setMask(m, "Deselect"));
          set((s) => ({
            lastDeselectedMask: prevMask,
            docRevision: s.docRevision + 1,
          }));
        }
        break;
      case "select.reselect":
        if (doc && state.lastDeselectedMask && !state.lastDeselectedMask.isEmpty) {
          const m = state.lastDeselectedMask.clone();
          doc.transact("Reselect", (tx) => tx.setMask(m, "Reselect"));
          state.bumpRevision();
        }
        break;
      case "select.invert":
        if (doc) {
          if (state.floatingSelection) state.commitFloatingSelection();
          const m = doc.sprite.mask.clone();
          m.invert();
          doc.transact("Invert Selection", (tx) => tx.setMask(m, "Invert Selection"));
          state.bumpRevision();
        }
        break;
      case "select.cel_content":
        if (doc) {
          const m = selectNonEmptyPixelsMask(doc.sprite, state.activeFrameIndex, state.activeLayerId);
          doc.transact("Select Cel Content", (tx) => tx.setMask(m, "Select Cel Content"));
          state.bumpRevision();
        }
        break;
      case "select.frame_content":
        if (doc) {
          const m = selectNonEmptyPixelsMask(doc.sprite, state.activeFrameIndex);
          doc.transact("Select Frame Content", (tx) => tx.setMask(m, "Select Frame Content"));
          state.bumpRevision();
        }
        break;
      case "select.modify":
        state.openDialog("dialog.select_modify");
        break;
      case "select.color_range":
        state.openDialog("dialog.color_range");
        break;
      case "select.save_load_mask":
        state.openDialog("dialog.saved_masks");
        break;
      case "action.reset_colors":
        state.resetDefaultColors();
        break;
      case "view.float_panel":
        if (!state.floatFocusedPanel()) appLogger.info("Layout", "Click a panel first, then use View > Float Focused Panel");
        break;
      case "view.dock_panel":
        if (!state.dockBackFocusedPanel()) appLogger.info("Layout", "Focus a floating panel first, then use View > Dock Focused Panel Back");
        break;
      case "view.timeline":
        state.toggleDockSlot("bottom");
        break;
      case "view.preview":
        state.togglePanelFloating("panel.preview");
        break;
      case "view.grid":
        state.toggleGrid();
        break;
      case "view.pixel_grid":
        state.togglePixelGrid();
        break;
      case "view.grid_settings":
        state.openDialog("dialog.grid_settings");
        break;
      case "view.layer_edges":
        state.toggleLayerEdges();
        break;
      case "view.show_extras":
        state.toggleShowExtras();
        break;
      case "view.symmetry":
        state.setToolOption(
          "symmetryMode",
          state.toolOptions.symmetryMode === "none" ? "horizontal" : "none"
        );
        break;
      case "view.symmetry_none":
        state.setToolOption("symmetryMode", "none");
        break;
      case "view.symmetry_h":
        state.setToolOption("symmetryMode", "horizontal");
        break;
      case "view.symmetry_v":
        state.setToolOption("symmetryMode", "vertical");
        break;
      case "view.symmetry_both":
        state.setToolOption("symmetryMode", "both");
        break;
      case "view.symmetry_diag_pos":
        state.setToolOption("symmetryMode", "diagonal_pos");
        break;
      case "view.symmetry_diag_neg":
        state.setToolOption("symmetryMode", "diagonal_neg");
        break;
      case "view.symmetry_8way":
        state.setToolOption(
          "symmetryMode",
          state.toolOptions.symmetryMode === "eight_way" ? "none" : "eight_way"
        );
        break;
      case "view.tiled_mode":
        state.cycleTiledMode();
        break;
      case "view.tiled_none":
        state.setTiledMode("none");
        break;
      case "view.tiled_both":
        state.setTiledMode("both");
        break;
      case "view.tiled_x":
        state.setTiledMode("x");
        break;
      case "view.tiled_y":
        state.setTiledMode("y");
        break;
      case "view.fullscreen_preview":
        state.toggleZenMode();
        break;
      case "view.workspace_reset":
        state.resetCurrentWorkspace();
        break;
      case "action.swap_colors":
        state.swapColors();
        break;
      case "action.brush_size_dec":
        state.setToolOption("brushSize", Math.max(1, state.toolOptions.brushSize - 1));
        break;
      case "action.brush_size_inc":
        state.setToolOption("brushSize", Math.min(128, state.toolOptions.brushSize + 1));
        break;
      case "action.new_brush":
        state.captureCustomBrushFromCanvas();
        break;
      case "action.zoom_fit":
        state.setPan(0, 0);
        state.setZoom(400);
        break;
      case "action.zoom_100":
        state.setZoom(100);
        break;
      case "action.zoom_200":
        state.setZoom(200);
        break;
      case "action.zoom_300":
        state.setZoom(300);
        break;
      case "action.zoom_400":
        state.setZoom(400);
        break;
      case "action.zoom_in":
        state.setZoom(getNextZoomStep(state.zoom));
        break;
      case "action.zoom_out":
        state.setZoom(getPrevZoomStep(state.zoom));
        break;
      case "action.frame_prev":
        state.stepFrame(-1);
        break;
      case "action.frame_next":
        state.stepFrame(1);
        break;
      case "help.feature_center":
        state.openDialog("dialog.feature_center");
        break;
      case "help.log_viewer":
        state.setActiveDockTab("bottom", "panel.logviewer");
        break;
      case "help.about":
        state.openDialog("dialog.about");
        break;
      case "script.console":
      case "view.panel.script_editor":
        state.setActiveDockTab("right", "panel.script_editor");
        break;
      case "script.run_active":
        state.runActiveScript();
        break;
      case "script.rescan":
        void state.rescanScripts();
        break;
      case "ext.manage":
        state.openDialog("dialog.extensions_manager");
        break;
      case "view.panel.extensions":
        state.setActiveDockTab("right", "panel.extensions");
        break;
      case "ext.install":
        void state.installExtensionFromDisk();
        break;
      case "ext.install_cyberpunk":
        state.installSampleExtensionById("theme-cyberpunk");
        break;
      case "ext.install_retro_palette":
        state.installSampleExtensionById("palette-retro-8bit");
        break;
      case "ext.install_fa_pack":
        state.installSampleExtensionById("lang-fa-improved");
        break;
      case "ext.install_vim_keymap":
        state.installSampleExtensionById("keymap-vim");
        break;
      case "tool.pencil":
      case "tool.spray":
      case "tool.eraser":
      case "tool.eyedropper":
      case "tool.zoom":
      case "tool.hand":
      case "tool.paint_bucket":
      case "tool.gradient":
      case "tool.line":
      case "tool.curve":
      case "tool.rectangle":
      case "tool.ellipse":
      case "tool.contour":
      case "tool.polygon":
      case "tool.blur":
      case "tool.jumble":
      case "tool.shading":
      case "tool.marquee_rect":
      case "tool.marquee_ellipse":
      case "tool.lasso":
      case "tool.polygonal_lasso":
      case "tool.magic_wand":
      case "tool.move":
      case "tool.text":
      case "tool.slice":
        state.setActiveTool(commandId);
        break;
      default: {
        if (commandId.startsWith("view.toggle_panel.")) {
          state.togglePanelVisible(commandId.slice("view.toggle_panel.".length));
          break;
        }
        if (commandId.startsWith("script.sample.")) {
          const sampleId = commandId.replace("script.sample.", "");
          const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.id === sampleId);
          if (sample) {
            state.setActiveScript(sample.fileName, sample.code);
            state.setActiveDockTab("right", "panel.script_editor");
            state.runActiveScript(sample.code, sample.fileName);
            break;
          }
        }
        const registeredCmd = CommandRegistry.get(commandId);
        if (registeredCmd && registeredCmd.state !== "planned") {
          void registeredCmd.run({ activeDoc: doc });
          break;
        }
        appLogger.warn("Command", `Command "${commandId}" is planned for a subsequent agent.`);
        break;
      }
    }
  },
}));
