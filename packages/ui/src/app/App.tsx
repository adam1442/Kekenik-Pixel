/**
 * @module @kekenik/ui/app/App
 * Root application component for Kekenik Pixel.
 */

import React, { useEffect, useRef } from "react";
import {
  advancePlaybackClock,
  createPlaybackClockState,
  defaultKeymap,
  normalizeKeyChord,
  PlaybackClockState,
  ToolRegistry,
} from "../../../core/src/index.ts";
import { SpriteEditor } from "../editor/index.tsx";
import {
  AboutDialog,
  CelPropertiesDialog,
  ColorModeDialog,
  ColorRangeDialog,
  ConstantFrameRateDialog,
  CustomDitherMatrixDialog,
  DuplicateSpriteDialog,
  ExtensionsManagerDialog,
  FeatureCenterDialog,
  FilterStudioDialog,
  FramePropertiesDialog,
  GridSettingsDialog,
  KeyboardShortcutsDialog,
  LayerPropertiesDialog,
  NewSpriteDialog,
  NewTilemapLayerDialog,
  OnionSkinSettingsDialog,
  PaletteEditorDialog,
  PasteSpecialDialog,
  PreferencesDialog,
  RotateAngleDialog,
  SavedMasksDialog,
  ScriptCustomDialog,
  ScriptPermissionDialog,
  SelectModifyDialog,
  ShiftPixelsDialog,
  SlicePropertiesDialog,
  SpritePropertiesDialog,
  SpriteResizeDialog,
  TagPropertiesDialog,
  TilesetPropertiesDialog,
  UnsavedChangesDialog,
} from "../featurecenter/index.tsx";
import { ExportAsDialog, ExportSpriteSheetDialog, ImportSpriteSheetDialog, RecoveryDialog, useStartupRecovery } from "../featurecenter/agent6-dialogs.tsx";
import { startAutosave } from "./agent6-actions.ts";
import { useDirection } from "../i18n/index.ts";
import {
  ContextBar,
  DockManager,
  DocumentTabsBar,
  StatusBar,
  TitleBar,
} from "../shell/index.tsx";
import { getThemeTokens } from "../skin/index.tsx";
import { GlobalErrorBoundary } from "./ErrorBoundary.tsx";
import { HomeTab } from "./HomeTab.tsx";
import { useAppStore } from "./store.ts";
import { isTextEntryTarget } from "./keyboard.ts";

export const KekenikPixelApp: React.FC = () => {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const activeToolId = useAppStore((s) => s.activeToolId);
  const activeDialog = useAppStore((s) => s.activeDialog);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const playbackConfig = useAppStore((s) => s.playbackConfig);
  const activeTagId = useAppStore((s) => s.activeTagId);
  const theme = useAppStore((s) => s.theme);
  const uiScale = useAppStore((s) => s.uiScale);
  const { dir, canvasDir } = useDirection();

  const openDialog = useAppStore((s) => s.openDialog);
  const runCommandById = useAppStore((s) => s.runCommandById);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const setActiveFrame = useAppStore((s) => s.setActiveFrame);
  const setIsPlaying = useAppStore((s) => s.setIsPlaying);
  const getActiveDocument = useAppStore((s) => s.getActiveDocument);

  const clockRef = useRef<PlaybackClockState | null>(null);
  const lastTickRef = useRef<number>(Date.now());

  const tokens = getThemeTokens(theme);

  // Full Agent-3 Animation Playback Engine Timer (respecting per-frame durations, tags, pingpong/reverse, speed, and repeat count)
  useEffect(() => {
    if (!isPlaying) {
      clockRef.current = null;
      return;
    }
    const doc = getActiveDocument();
    if (!doc || doc.sprite.frames.length <= 1) return;

    const cfg = { ...playbackConfig, activeTagId };
    clockRef.current = createPlaybackClockState(doc.sprite, activeFrameIndex, cfg);
    lastTickRef.current = Date.now();

    const timer = window.setInterval(() => {
      const currDoc = getActiveDocument();
      if (!currDoc || !clockRef.current) return;
      const now = Date.now();
      const deltaMs = Math.max(1, now - lastTickRef.current);
      lastTickRef.current = now;

      const nextClock = advancePlaybackClock(
        currDoc.sprite,
        clockRef.current,
        deltaMs,
        { ...playbackConfig, activeTagId }
      );
      clockRef.current = nextClock;
      setActiveFrame(nextClock.frameIndex);
      if (nextClock.stopped) {
        setIsPlaying(false);
      }
    }, 25);

    return () => window.clearInterval(timer);
  }, [isPlaying, playbackConfig, activeTagId, getActiveDocument, setActiveFrame, setIsPlaying]);

  // Preferences and layout are restored before the app mounts; start document autosave.
  useEffect(() => {
    return startAutosave({ get: useAppStore.getState, set: useAppStore.setState } as never);
  }, []);
  useStartupRecovery();

  // Global keyboard shortcut listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Never steal keystrokes from a text-entry surface (CodeMirror script editor, dialogs,
      // inline fields...). Those widgets own their own keymap.
      if (isTextEntryTarget(e.target)) return;
      if (activeDialog === "dialog.shortcuts") return;
      if (["Control", "Shift", "Alt", "Meta", " "].includes(e.key)) return;

      if (e.key === "F11") {
        e.preventDefault();
        useAppStore.getState().toggleZenMode();
        void window.kekenikElectron?.toggleFullScreen();
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);

      const chord = normalizeKeyChord(parts.join("+"));
      const resolvedCmd = defaultKeymap.resolveChord(chord, activeToolId);
      if (!resolvedCmd) return;

      e.preventDefault();
      if (resolvedCmd.startsWith("tool.")) {
        const toolDef = ToolRegistry.get(resolvedCmd);
        if (toolDef && toolDef.state !== "planned") {
          setActiveTool(resolvedCmd);
        }
      } else {
        runCommandById(resolvedCmd);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeDialog, activeToolId, runCommandById, setActiveTool]);

  const zoomCssScale = uiScale === 100 ? 1 : uiScale === 200 ? 1.18 : 1.32;

  return (
    <GlobalErrorBoundary>
      <div
        dir={dir}
        style={
          {
            "--kpx-window-bg": tokens.windowBg,
            "--kpx-chrome-bg": tokens.chromeBg,
            "--kpx-panel-bg": tokens.panelBg,
            "--kpx-header-bg": tokens.headerBg,
            "--kpx-header-active": tokens.headerActiveBg,
            "--kpx-header-text": tokens.headerText,
            "--kpx-canvas-surround": tokens.canvasSurroundBg,
            "--kpx-input-bg": tokens.inputBg,
            "--kpx-input-text": tokens.inputText,
            "--kpx-text": tokens.textPrimary,
            "--kpx-text-muted": tokens.textMuted,
            "--kpx-accent-bg": tokens.accentBg,
            "--kpx-bevel-light": tokens.bevelLight,
            "--kpx-bevel-dark": tokens.bevelDark,
            "--kpx-btn-bg": tokens.buttonBg,
            "--kpx-btn-active": tokens.buttonActiveBg,
            "--kpx-tab-active": tokens.tabActiveBg,
            "--kpx-tab-inactive": tokens.tabInactiveBg,
            "--kpx-timeline-row": tokens.timelineRowBg,
            "--kpx-timeline-selected": tokens.timelineSelectedBg,
            fontSize: `${Math.round(12 * zoomCssScale)}px`,
          } as React.CSSProperties
        }
        className="h-screen w-screen overflow-hidden flex flex-col bg-[var(--kpx-window-bg)] text-[var(--kpx-text)] font-mono"
      >
        <TitleBar />
        <DocumentTabsBar />
        <ContextBar />
        <DockManager
          centerContent={
            activeTabId === "home" ? (
              <HomeTab />
            ) : (
              <div dir={canvasDir} className="h-full w-full overflow-hidden">
                <SpriteEditor />
              </div>
            )
          }
        />
        <StatusBar />

        {/* Active Modal Dialogs */}
        {activeDialog === "dialog.new_sprite" && (
          <NewSpriteDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.sprite_size" && (
          <SpriteResizeDialog scaleContent={true} onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.canvas_size" && (
          <SpriteResizeDialog scaleContent={false} onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.shortcuts" && (
          <KeyboardShortcutsDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.preferences" && (
          <PreferencesDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.feature_center" && (
          <FeatureCenterDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.dither_matrix" && (
          <CustomDitherMatrixDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.grid_settings" && (
          <GridSettingsDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.layer_properties" && (
          <LayerPropertiesDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.frame_properties" && (
          <FramePropertiesDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.cel_properties" && (
          <CelPropertiesDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.tag_properties" && (
          <TagPropertiesDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.slice_properties" && (
          <SlicePropertiesDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.tileset_properties" && (
          <TilesetPropertiesDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.constant_frame_rate" && (
          <ConstantFrameRateDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.new_tilemap_layer" && (
          <NewTilemapLayerDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.onion_skin" && (
          <OnionSkinSettingsDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.palette_editor" && (
          <PaletteEditorDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.color_mode" && (
          <ColorModeDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.select_modify" && (
          <SelectModifyDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.color_range" && (
          <ColorRangeDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.saved_masks" && (
          <SavedMasksDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.rotate_angle" && (
          <RotateAngleDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.shift_pixels" && (
          <ShiftPixelsDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.paste_special" && (
          <PasteSpecialDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.filter_fx" && (
          <FilterStudioDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.sprite_properties" && (
          <SpritePropertiesDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.duplicate_sprite" && (
          <DuplicateSpriteDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.extensions_manager" && (
          <ExtensionsManagerDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.script_custom" && (
          <ScriptCustomDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.script_permissions" && (
          <ScriptPermissionDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.export_as" && <ExportAsDialog onClose={() => openDialog(null)} />}
        {activeDialog === "dialog.export_sprite_sheet" && <ExportSpriteSheetDialog onClose={() => openDialog(null)} />}
        {activeDialog === "dialog.import_sprite_sheet" && <ImportSpriteSheetDialog onClose={() => openDialog(null)} />}
        {activeDialog === "dialog.recovery" && <RecoveryDialog onClose={() => openDialog(null)} />}
        {activeDialog === "dialog.unsaved_changes" && (
          <UnsavedChangesDialog onClose={() => openDialog(null)} />
        )}
        {activeDialog === "dialog.about" && (
          <AboutDialog onClose={() => openDialog(null)} />
        )}
      </div>
    </GlobalErrorBoundary>
  );
};
