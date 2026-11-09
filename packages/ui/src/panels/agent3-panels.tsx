/**
 * @module @kekenik/ui/panels/agent3-panels
 * Agent 3 Panels:
 * - Full Aseprite 1.3-class TimelinePanel (hierarchical layer tree, drag-and-drop layers & cels,
 *   rectangular cel range selection, cel thumbnails, z-index badges, cascading tag banners with
 *   drag-resize handles, onion skin settings popup, and embedded mini-player)
 * - PreviewPanel (independent playback timer, tag selector, 3x3 tiled preview, pan/zoom sync box, full-screen toggle)
 * - LayersPanel (hierarchical group tree, blend mode, opacity, color swatches, merge/flatten/convert)
 * - TilesetPanel (Tiles vs Pixels mode, Auto/Stack/Manual mode, FlipX/FlipY/Rot90 flags, tile grid, live tile pixel editor)
 * - TagsPanel & SlicesPanel
 */

import React, { useEffect, useRef, useState } from "react";
import {
  AddSliceCommand,
  AddTagCommand,
  advancePlaybackClock,
  ALL_BLEND_MODES,
  BlendMode,
  compositeFrameAdvanced,
  computeCascadingTagRows,
  createModelId,
  createPlaybackClockState,
  createPurgeUnusedTilesCommand,
  findTileOccurrences,
  getCel,
  getPaletteForFrame,
  getSliceKeyForFrame,
  Layer,
  PixelImage,
  PlaybackClockState,
  RemoveSliceCommand,
  RemoveTagCommand,
  rgbaToHex,
  SetCelPropsCommand,
  SetLayerFullPropsCommand,
  Tag,
  TilemapEditMode,
  TilemapLayer,
  TilesetModificationMode,
  UpdateTagCommand,
  UpdateTilesetCommand,
} from "../../../core/src/index.ts";
import { useAppStore } from "../app/store.ts";
import { PixelIcon } from "../skin/index.tsx";
import {
  ColorInputField,
  NumberField,
  PixelButton,
  PixelCheckbox,
  PixelSelect,
  PixelSlider,
  TextField,
} from "../widgets/index.tsx";

const LAYER_SWATCH_COLORS = [
  "",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
];

/**
 * Small canvas component that renders any `PixelImage` (used for Timeline cel thumbnails & Tileset tiles).
 */
export const MiniPixelCanvas: React.FC<{
  image: PixelImage;
  width: number;
  height: number;
  className?: string;
}> = ({ image, width, height, className = "" }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, image.width, image.height);

    if (image.colorMode === "rgba") {
      const imgData = new ImageData(
        new Uint8ClampedArray(image.data),
        image.width,
        image.height
      );
      ctx.putImageData(imgData, 0, 0);
    } else {
      const rgbaImg = new PixelImage(image.width, image.height, "rgba");
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          rgbaImg.setRGBA(x, y, image.getRGBA(x, y));
        }
      }
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(rgbaImg.data), image.width, image.height),
        0,
        0
      );
    }
  }, [image, image.data]);

  return (
    <canvas
      ref={ref}
      style={{ width, height, imageRendering: "pixelated" }}
      className={className}
    />
  );
};

interface FlattenedTreeLayer {
  layer: Layer;
  depth: number;
  stackIndex: number;
}

/**
 * Builds the top-to-bottom visible layer tree for the Timeline & Layers panel,
 * respecting `parentId` hierarchy and `GroupLayer.collapsed`.
 */
function buildDisplayLayerTree(layers: readonly Layer[]): FlattenedTreeLayer[] {
  const result: FlattenedTreeLayer[] = [];

  const visitChildren = (parentId: string | null, depth: number) => {
    // Render top-to-bottom (reverse of stack order)
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (layer.parentId !== parentId) continue;
      result.push({ layer, depth, stackIndex: i });
      if (layer.kind === "group" && !layer.collapsed) {
        visitChildren(layer.id, depth + 1);
      }
    }
  };

  visitChildren(null, 0);
  return result;
}

/**
 * 1. Full Agent-3 Timeline Panel
 */
export const TimelinePanel: React.FC = () => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const selectedLayerIds = useAppStore((s) => s.selectedLayerIds);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const selectedCelRange = useAppStore((s) => s.selectedCelRange);
  const isPlaying = useAppStore((s) => s.isPlaying);
  const playbackConfig = useAppStore((s) => s.playbackConfig);
  const onionSkin = useAppStore((s) => s.onionSkin);
  const timelinePosition = useAppStore((s) => s.timelinePosition);
  const timelineCelWidth = useAppStore((s) => s.timelineCelWidth);
  const timelineThumbnails = useAppStore((s) => s.timelineThumbnails);
  const activeTagId = useAppStore((s) => s.activeTagId);

  const selectLayerWithModifiers = useAppStore((s) => s.selectLayerWithModifiers);
  const setActiveLayer = useAppStore((s) => s.setActiveLayer);
  const setActiveFrame = useAppStore((s) => s.setActiveFrame);
  const setSelectedCelRange = useAppStore((s) => s.setSelectedCelRange);
  const setIsPlaying = useAppStore((s) => s.setIsPlaying);
  const stepFrame = useAppStore((s) => s.stepFrame);
  const jumpToTag = useAppStore((s) => s.jumpToTag);
  const setPlaybackConfig = useAppStore((s) => s.setPlaybackConfig);
  const setOnionSkin = useAppStore((s) => s.setOnionSkin);
  const toggleOnionSkin = useAppStore((s) => s.toggleOnionSkin);
  const setTimelinePosition = useAppStore((s) => s.setTimelinePosition);
  const setTimelineCelWidth = useAppStore((s) => s.setTimelineCelWidth);
  const setTimelineThumbnails = useAppStore((s) => s.setTimelineThumbnails);
  const setActiveTagId = useAppStore((s) => s.setActiveTagId);
  const openDialog = useAppStore((s) => s.openDialog);
  const runCommandById = useAppStore((s) => s.runCommandById);
  const bumpRevision = useAppStore((s) => s.bumpRevision);
  const isolateLayer = useAppStore((s) => s.isolateLayer);
  const reparentAndMoveLayer = useAppStore((s) => s.reparentAndMoveLayer);
  const transferCelRange = useAppStore((s) => s.transferCelRange);

  const [showSettingsPopup, setShowSettingsPopup] = useState(false);
  const [showOnionPopup, setShowOnionPopup] = useState(false);
  const [showMiniPlayer, setShowMiniPlayer] = useState(true);
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [dropTargetLayerId, setDropTargetLayerId] = useState<string | null>(null);
  const [dragCelStart, setDragCelStart] = useState<{ layerId: string; frameIndex: number } | null>(
    null
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    kind: "layer" | "cel" | "frame";
    layerId?: string;
    frameIndex?: number;
  } | null>(null);

  void rev;

  useEffect(() => {
    const closeMenus = () => setContextMenu(null);
    window.addEventListener("click", closeMenus);
    return () => window.removeEventListener("click", closeMenus);
  }, []);

  if (!doc) {
    return <div className="p-3 text-xs font-mono opacity-70">No active sprite document.</div>;
  }

  const sprite = doc.sprite;
  const treeRows = buildDisplayLayerTree(sprite.layers);
  const activeCel = getCel(sprite, activeLayerId, activeFrameIndex);
  const cascadingTags = computeCascadingTagRows(sprite.tags);
  const maxTagRow = cascadingTags.reduce((m, r) => Math.max(m, r.row), 0);

  const rowHeight =
    timelineThumbnails === "large"
      ? 40
      : timelineThumbnails === "medium"
      ? 32
      : timelineThumbnails === "small"
      ? 26
      : 22;

  const colW = Math.max(
    timelineCelWidth,
    timelineThumbnails === "large" ? 42 : timelineThumbnails === "medium" ? 34 : 24
  );

  const toggleLayerVisible = (layerId: string, current: boolean, altKey: boolean) => {
    if (altKey) {
      isolateLayer(layerId);
      return;
    }
    doc.transact("Toggle Layer Visibility", (tx) =>
      tx.setLayerProps(layerId, { visible: !current })
    );
    bumpRevision();
  };

  const toggleLayerLock = (layerId: string, current: boolean) => {
    doc.transact("Toggle Layer Lock", (tx) =>
      tx.setLayerProps(layerId, { editable: !current })
    );
    bumpRevision();
  };

  const toggleLayerPreferLinked = (layer: Layer) => {
    if (layer.kind === "group") {
      doc.execute(new SetLayerFullPropsCommand(layer.id, { collapsed: !layer.collapsed }));
      bumpRevision();
      return;
    }
    doc.transact("Toggle Prefer Linked Cels", (tx) =>
      tx.setLayerProps(layer.id, { preferLinkedCels: !layer.preferLinkedCels })
    );
    bumpRevision();
  };

  const handleRenameCommit = (layerId: string) => {
    if (renameText.trim()) {
      doc.transact("Rename Layer", (tx) =>
        tx.setLayerProps(layerId, { name: renameText.trim() })
      );
      bumpRevision();
    }
    setRenamingLayerId(null);
  };

  const handleTagEdgeResize = (tag: Tag, side: "from" | "to", delta: number) => {
    const nextFrom = side === "from" ? tag.fromFrame + delta : tag.fromFrame;
    const nextTo = side === "to" ? tag.toFrame + delta : tag.toFrame;
    if (nextFrom < 0 || nextTo >= sprite.frames.length || nextFrom > nextTo) return;
    doc.execute(new UpdateTagCommand(tag.id, { fromFrame: nextFrom, toFrame: nextTo }));
    bumpRevision();
  };

  const isCellInSelection = (layerId: string, frameIndex: number): boolean => {
    if (!selectedCelRange) return false;
    const f0 = Math.min(selectedCelRange.fromFrame, selectedCelRange.toFrame);
    const f1 = Math.max(selectedCelRange.fromFrame, selectedCelRange.toFrame);
    return (
      selectedCelRange.layerIds.includes(layerId) &&
      frameIndex >= f0 &&
      frameIndex <= f1
    );
  };

  const miniComp = compositeFrameAdvanced(sprite, activeFrameIndex);

  return (
    <div className="flex flex-col h-full bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] select-none overflow-hidden relative">
      {/* Top Row: Transport + Playback Speed + Quick Cel Opacity/Z-Index + Cascading Tag Banners */}
      <div className="flex items-end border-b border-black bg-[var(--kpx-chrome-bg)] px-1.5 pt-1 pb-0.5 gap-2">
        {/* Left column controls aligned with 225px Layer header */}
        <div className="flex flex-wrap items-center gap-0.5 w-[225px] shrink-0">
          <PixelButton
            size="xs"
            title="First Frame (Home)"
            onClick={() => setActiveFrame(0)}
          >
            <PixelIcon name="first_frame" size={11} />
          </PixelButton>
          <PixelButton
            size="xs"
            title="Previous Frame (Left)"
            onClick={() => stepFrame(-1)}
          >
            <PixelIcon name="prev_frame" size={11} />
          </PixelButton>
          <PixelButton
            size="xs"
            active={isPlaying}
            title="Play / Stop Animation (Enter)"
            onClick={() => setIsPlaying(!isPlaying)}
          >
            <PixelIcon name={isPlaying ? "pause" : "play"} size={11} />
          </PixelButton>
          <PixelButton
            size="xs"
            title="Next Frame (Right)"
            onClick={() => stepFrame(1)}
          >
            <PixelIcon name="next_frame" size={11} />
          </PixelButton>
          <PixelButton
            size="xs"
            title="Last Frame (End)"
            onClick={() => setActiveFrame(sprite.frames.length - 1)}
          >
            <PixelIcon name="last_frame" size={11} />
          </PixelButton>
          <PixelButton
            size="xs"
            title="Jump to Next Tag (Alt+Right)"
            onClick={() => jumpToTag(1)}
          >
            T»
          </PixelButton>

          {/* Playback Speed Multiplier */}
          <PixelSelect
            ariaLabel="Playback Speed Multiplier"
            value={String(playbackConfig.speedMultiplier)}
            onChange={(v) => setPlaybackConfig({ speedMultiplier: parseFloat(v) })}
            options={[
              { value: "0.25", label: "0.25x" },
              { value: "0.5", label: "0.5x" },
              { value: "1", label: "1x" },
              { value: "2", label: "2x" },
              { value: "4", label: "4x" },
            ]}
          />

          <div className="ml-auto flex items-center gap-0.5">
            <PixelButton
              size="xs"
              title="New Layer (Shift+N)"
              onClick={() => runCommandById("layer.new")}
            >
              +L
            </PixelButton>
            <PixelButton
              size="xs"
              title="New Group Folder"
              onClick={() => runCommandById("layer.new_group")}
            >
              +G
            </PixelButton>
            <PixelButton
              size="xs"
              title="New Frame (Alt+N)"
              onClick={() => runCommandById("frame.new")}
            >
              +F
            </PixelButton>
            <PixelButton
              size="xs"
              title="New Tag..."
              onClick={() => openDialog("dialog.tag_properties")}
            >
              +Tag
            </PixelButton>
          </div>
        </div>

        {/* Cascading Tag Ribbons directly above frame columns */}
        <div className="flex-1 flex flex-col gap-0.5 overflow-x-auto pb-0.5">
          {sprite.tags.length === 0 ? (
            <div className="text-[10px] font-mono opacity-60 px-1">
              No tags — click +Tag or Frame &gt; Tags &gt; New Tag
            </div>
          ) : (
            Array.from({ length: maxTagRow + 1 }, (_, rowIdx) => {
              const tagsInRow = cascadingTags.filter((t) => t.row === rowIdx);
              return (
                <div key={rowIdx} className="relative h-5 min-w-max flex items-center">
                  {tagsInRow.map(({ tag }) => {
                    const spanFrames = tag.toFrame - tag.fromFrame + 1;
                    const leftPx = tag.fromFrame * colW;
                    const widthPx = Math.max(24, spanFrames * colW - 2);
                    const isSelectedTag = activeTagId === tag.id;
                    return (
                      <div
                        key={tag.id}
                        style={{
                          left: leftPx,
                          width: widthPx,
                          backgroundColor: tag.color,
                        }}
                        onClick={() => {
                          setActiveTagId(tag.id);
                          setActiveFrame(tag.fromFrame);
                        }}
                        onDoubleClick={() => {
                          setActiveTagId(tag.id);
                          openDialog("dialog.tag_properties");
                        }}
                        title={`Tag "${tag.name}" [${tag.fromFrame + 1}..${tag.toFrame + 1}] (${tag.direction}, repeat=${
                          tag.repeat === 0 ? "∞" : tag.repeat
                        }) — Double-click to edit, click < / > to resize`}
                        className={`absolute top-0 h-4 px-1 text-[10px] font-mono text-white font-bold cursor-pointer rounded-t border border-black flex items-center justify-between overflow-hidden ${
                          isSelectedTag ? "ring-1 ring-yellow-300" : ""
                        }`}
                      >
                        <button
                          type="button"
                          title="Expand/shrink tag start frame"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTagEdgeResize(tag, "from", e.shiftKey ? 1 : -1);
                          }}
                          className="px-0.5 hover:bg-black/30 text-[9px]"
                        >
                          [
                        </button>
                        <span className="truncate px-0.5">
                          {tag.name}
                          {tag.repeat > 0 ? `×${tag.repeat}` : ""}
                        </span>
                        <button
                          type="button"
                          title="Expand/shrink tag end frame"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTagEdgeResize(tag, "to", e.shiftKey ? -1 : 1);
                          }}
                          className="px-0.5 hover:bg-black/30 text-[9px]"
                        >
                          ]
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Right Quick Cel Opacity & Z-Index + Mini-Player */}
        <div className="flex items-center gap-1.5 shrink-0">
          {activeCel && (
            <div className="hidden md:flex items-center gap-1 bg-black/15 px-1.5 py-0.5 border border-black/30 text-[10px]">
              <span title="Active Cel Opacity (0..255)">Cel Op:</span>
              <PixelSlider
                ariaLabel="Timeline Cel Opacity"
                min={0}
                max={255}
                value={activeCel.opacity}
                onChange={(val) => {
                  doc.execute(
                    new SetCelPropsCommand(
                      [{ layerId: activeLayerId, frameIndex: activeFrameIndex }],
                      { opacity: val },
                      "Cel Opacity"
                    )
                  );
                  bumpRevision();
                }}
                className="w-14"
              />
              <span>Z:</span>
              <NumberField
                ariaLabel="Timeline Cel Z-Index"
                value={activeCel.zIndex}
                min={-32}
                max={32}
                widthClass="w-11"
                onChange={(val) => {
                  doc.execute(
                    new SetCelPropsCommand(
                      [{ layerId: activeLayerId, frameIndex: activeFrameIndex }],
                      { zIndex: val },
                      "Cel Z-Index"
                    )
                  );
                  bumpRevision();
                }}
              />
            </div>
          )}

          {showMiniPlayer && (
            <div
              onClick={() => setIsPlaying(!isPlaying)}
              title="Timeline Mini-Player (Click to Play/Pause)"
              className="flex items-center gap-1 bg-[#27232c] border border-black px-1 py-0.5 cursor-pointer"
            >
              <MiniPixelCanvas image={miniComp} width={22} height={22} />
              <span className="text-[9px] text-white font-mono">
                {activeFrameIndex + 1}/{sprite.frames.length}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Header Row: Layer Column Icons + Frame Numbers 1..N */}
      <div className="flex items-center border-b border-black bg-[#b5ada5] text-black text-[11px] font-mono relative">
        <div className="w-[225px] shrink-0 flex items-center gap-1.5 px-2 py-0.5 border-r border-black">
          <button
            type="button"
            title="Show / Hide All Layers"
            onClick={() => runCommandById("layer.show_hide_all")}
            className="hover:bg-black/15 p-0.5 rounded"
          >
            <PixelIcon name="eye_open" size={11} />
          </button>
          <button
            type="button"
            title="Lock / Unlock All Layers"
            onClick={() => runCommandById("layer.lock_all")}
            className="hover:bg-black/15 p-0.5 rounded"
          >
            <PixelIcon name="lock_closed" size={11} />
          </button>
          <span title="Continuous / Prefer Linked Cels">
            <PixelIcon name="linked" size={11} />
          </span>
          <button
            type="button"
            title="Timeline Settings (Dock Position, Thumbnails, Zoom, Playback)"
            onClick={() => {
              setShowSettingsPopup(!showSettingsPopup);
              setShowOnionPopup(false);
            }}
            className={`p-0.5 rounded ${showSettingsPopup ? "bg-black/25" : "hover:bg-black/15"}`}
          >
            <PixelIcon name="gear" size={11} />
          </button>
          <button
            type="button"
            title="Toggle Onion Skin (F3) — Right-click for Onion Skin Settings"
            onClick={() => toggleOnionSkin()}
            onContextMenu={(e) => {
              e.preventDefault();
              setShowOnionPopup(!showOnionPopup);
              setShowSettingsPopup(false);
            }}
            className={`p-0.5 rounded ${
              onionSkin.enabled ? "bg-red-600 text-white" : "hover:bg-black/15"
            }`}
          >
            <PixelIcon name="onion" size={11} />
          </button>
          <button
            type="button"
            title="Onion Skin Options Popup"
            onClick={() => {
              setShowOnionPopup(!showOnionPopup);
              setShowSettingsPopup(false);
            }}
            className="text-[9px] px-1 hover:bg-black/15 rounded"
          >
            ▾
          </button>
          <span className="ml-auto text-[10px] opacity-75">Layers ({sprite.layers.length})</span>
        </div>

        {/* Frame Number Headers */}
        <div className="flex items-center overflow-x-auto">
          {sprite.frames.map((frame) => {
            const isSelectedFrame = frame.index === activeFrameIndex;
            const inPrevOnion =
              onionSkin.enabled &&
              frame.index < activeFrameIndex &&
              activeFrameIndex - frame.index <= onionSkin.framesBefore;
            const inNextOnion =
              onionSkin.enabled &&
              frame.index > activeFrameIndex &&
              frame.index - activeFrameIndex <= onionSkin.framesAfter;

            return (
              <button
                key={frame.id}
                type="button"
                style={{ width: colW }}
                onClick={(e) => {
                  if (e.shiftKey) {
                    setSelectedCelRange({
                      layerIds: sprite.layers.map((l) => l.id),
                      fromFrame: activeFrameIndex,
                      toFrame: frame.index,
                    });
                  }
                  setActiveFrame(frame.index);
                }}
                onDoubleClick={() => {
                  setActiveFrame(frame.index);
                  openDialog("dialog.frame_properties");
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActiveFrame(frame.index);
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    kind: "frame",
                    frameIndex: frame.index,
                  });
                }}
                title={`Frame ${frame.index + 1} (${frame.durationMs} ms) — Double-click for Frame Properties`}
                className={`shrink-0 h-5 flex items-center justify-center border-r border-[#8d857d] text-[10px] font-mono ${
                  isSelectedFrame
                    ? "bg-[var(--kpx-header-bg)] text-white font-bold"
                    : inPrevOnion
                    ? "bg-red-500/35 text-black"
                    : inNextOnion
                    ? "bg-blue-500/35 text-black"
                    : "hover:bg-black/10"
                }`}
              >
                {frame.index + 1}
              </button>
            );
          })}
        </div>

        {/* Timeline Settings Popup */}
        {showSettingsPopup && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute left-12 top-6 z-50 w-72 kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] p-2.5 shadow-2xl space-y-2 text-xs font-mono"
          >
            <div className="font-bold flex items-center justify-between border-b border-black/30 pb-1">
              <span>Timeline &amp; Playback Options</span>
              <button type="button" onClick={() => setShowSettingsPopup(false)}>
                ×
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span>Dock Position:</span>
              <PixelSelect
                ariaLabel="Timeline Dock Position"
                value={timelinePosition}
                onChange={(v) => setTimelinePosition(v as "bottom" | "left" | "right")}
                options={[
                  { value: "bottom", label: "Bottom" },
                  { value: "left", label: "Left" },
                  { value: "right", label: "Right" },
                ]}
              />
            </div>
            <div className="flex items-center justify-between">
              <span>Cel Thumbnails:</span>
              <PixelSelect
                ariaLabel="Timeline Cel Thumbnails"
                value={timelineThumbnails}
                onChange={(v) =>
                  setTimelineThumbnails(v as "off" | "small" | "medium" | "large")
                }
                options={[
                  { value: "off", label: "Off (Dots/Pills)" },
                  { value: "small", label: "Small (16px)" },
                  { value: "medium", label: "Medium (24px)" },
                  { value: "large", label: "Large (32px)" },
                ]}
              />
            </div>
            <PixelSlider
              label="Cel Column Width"
              value={timelineCelWidth}
              min={18}
              max={64}
              onChange={(w) => setTimelineCelWidth(w)}
            />
            <PixelCheckbox
              checked={playbackConfig.playSubtags}
              onChange={(v) => setPlaybackConfig({ playSubtags: v })}
              label="Play Active Tag / Subtag Only"
            />
            <PixelCheckbox
              checked={playbackConfig.playOnce}
              onChange={(v) => setPlaybackConfig({ playOnce: v })}
              label="Play Once (Do Not Loop)"
            />
            <PixelCheckbox
              checked={playbackConfig.constantFrameRate}
              onChange={(v) => setPlaybackConfig({ constantFrameRate: v })}
              label="Constant Frame Rate Override"
            />
            <PixelCheckbox
              checked={playbackConfig.dropFramesSkip}
              onChange={(v) => setPlaybackConfig({ dropFramesSkip: v })}
              label="Real-Time Frame Drop Skip"
            />
            <PixelCheckbox
              checked={showMiniPlayer}
              onChange={setShowMiniPlayer}
              label="Show Mini-Player in Timeline"
            />
          </div>
        )}

        {/* Onion Skin Settings Popup */}
        {showOnionPopup && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute left-24 top-6 z-50 w-72 kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] p-2.5 shadow-2xl space-y-2 text-xs font-mono"
          >
            <div className="font-bold flex items-center justify-between border-b border-black/30 pb-1">
              <span>Onion Skin Settings</span>
              <button type="button" onClick={() => setShowOnionPopup(false)}>
                ×
              </button>
            </div>
            <PixelCheckbox
              checked={onionSkin.enabled}
              onChange={(enabled) => setOnionSkin({ enabled })}
              label="Enable Onion Skin (F3)"
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center justify-between">
                <span>Prev:</span>
                <NumberField
                  ariaLabel="Onion Frames Before"
                  value={onionSkin.framesBefore}
                  min={0}
                  max={8}
                  widthClass="w-14"
                  onChange={(framesBefore) => setOnionSkin({ framesBefore })}
                />
              </div>
              <div className="flex items-center justify-between">
                <span>Next:</span>
                <NumberField
                  ariaLabel="Onion Frames After"
                  value={onionSkin.framesAfter}
                  min={0}
                  max={8}
                  widthClass="w-14"
                  onChange={(framesAfter) => setOnionSkin({ framesAfter })}
                />
              </div>
            </div>
            <PixelSlider
              label="Initial Opacity"
              value={onionSkin.initialOpacity}
              min={16}
              max={255}
              onChange={(initialOpacity) => setOnionSkin({ initialOpacity })}
            />
            <PixelSlider
              label="Falloff Step"
              value={onionSkin.opacityStep}
              min={0}
              max={100}
              onChange={(opacityStep) => setOnionSkin({ opacityStep })}
            />
            <div className="flex items-center justify-between">
              <span>Ghost Mode:</span>
              <PixelSelect
                ariaLabel="Onion Skin Mode"
                value={onionSkin.mode}
                onChange={(v) => setOnionSkin({ mode: v as "tint" | "merge" })}
                options={[
                  { value: "tint", label: "Red / Blue Tint" },
                  { value: "merge", label: "Merge True Colors" },
                ]}
              />
            </div>
            <div className="flex items-center justify-between">
              <span>Position:</span>
              <PixelSelect
                ariaLabel="Onion Skin Position"
                value={onionSkin.position}
                onChange={(v) => setOnionSkin({ position: v as "behind" | "in_front" })}
                options={[
                  { value: "behind", label: "Behind Sprite" },
                  { value: "in_front", label: "In Front of Sprite" },
                ]}
              />
            </div>
            <PixelCheckbox
              checked={onionSkin.loopTag}
              onChange={(loopTag) => setOnionSkin({ loopTag })}
              label="Loop Through Active Tag"
            />
            <PixelCheckbox
              checked={onionSkin.currentLayerOnly}
              onChange={(currentLayerOnly) => setOnionSkin({ currentLayerOnly })}
              label="Current Layer Only"
            />
          </div>
        )}
      </div>

      {/* Matrix Rows: Hierarchical Layer Tree x Frame Cells */}
      <div className="flex-1 overflow-auto">
        {treeRows.map(({ layer, depth, stackIndex }) => {
          const isSelectedLayer =
            layer.id === activeLayerId || selectedLayerIds.includes(layer.id);
          const isDropTarget = dropTargetLayerId === layer.id;

          return (
            <div
              key={layer.id}
              style={{ height: rowHeight }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragLayerId && dragLayerId !== layer.id) {
                  setDropTargetLayerId(layer.id);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragLayerId && dragLayerId !== layer.id) {
                  const newParentId =
                    layer.kind === "group" ? layer.id : layer.parentId;
                  reparentAndMoveLayer(dragLayerId, stackIndex, newParentId);
                }
                setDragLayerId(null);
                setDropTargetLayerId(null);
              }}
              className={`flex items-center border-b border-[#8d857d] text-xs font-mono ${
                isDropTarget ? "border-t-2 border-t-yellow-300" : ""
              } ${
                isSelectedLayer
                  ? "bg-[var(--kpx-timeline-selected)] text-white"
                  : "bg-[var(--kpx-timeline-row)] text-black"
              }`}
            >
              {/* Left Layer Tree Cell */}
              <div
                draggable
                onDragStart={() => setDragLayerId(layer.id)}
                onDragEnd={() => {
                  setDragLayerId(null);
                  setDropTargetLayerId(null);
                }}
                onClick={(e) =>
                  selectLayerWithModifiers(
                    layer.id,
                    e.shiftKey,
                    e.ctrlKey || e.metaKey
                  )
                }
                onDoubleClick={() => {
                  setActiveLayer(layer.id);
                  openDialog("dialog.layer_properties");
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActiveLayer(layer.id);
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    kind: "layer",
                    layerId: layer.id,
                  });
                }}
                style={{
                  backgroundColor:
                    !isSelectedLayer && layer.userData.color
                      ? `${layer.userData.color}33`
                      : undefined,
                }}
                className="w-[225px] shrink-0 h-full flex items-center gap-1.5 px-2 border-r border-black cursor-pointer"
              >
                {/* Color swatch indicator bar */}
                {layer.userData.color && (
                  <span
                    style={{ backgroundColor: layer.userData.color }}
                    className="w-1.5 h-3.5 rounded-sm border border-black/40 shrink-0"
                  />
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerVisible(layer.id, layer.visible, e.altKey);
                  }}
                  title={
                    layer.visible
                      ? "Hide Layer (Alt+Click to Isolate/Solo)"
                      : "Show Layer (Alt+Click to Isolate/Solo)"
                  }
                >
                  <PixelIcon name={layer.visible ? "eye_open" : "eye_closed"} size={11} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerLock(layer.id, layer.editable);
                  }}
                  title={layer.editable ? "Lock Layer" : "Unlock Layer"}
                >
                  <PixelIcon name={layer.editable ? "lock_open" : "lock_closed"} size={11} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerPreferLinked(layer);
                  }}
                  title={
                    layer.kind === "group"
                      ? layer.collapsed
                        ? "Expand Group"
                        : "Collapse Group"
                      : "Continuous / Prefer Linked Cels"
                  }
                >
                  {layer.kind === "group" ? (
                    <span className="font-bold text-[11px]">
                      {layer.collapsed ? "▸" : "▾"}
                    </span>
                  ) : (
                    <PixelIcon
                      name={layer.preferLinkedCels ? "linked" : "unlinked"}
                      size={11}
                    />
                  )}
                </button>

                {/* Indentation + Layer Kind Badge + Name */}
                <div
                  style={{ paddingLeft: depth * 10 }}
                  className="flex items-center gap-1 flex-1 min-w-0"
                >
                  {layer.kind === "group" && (
                    <PixelIcon name="folder" size={11} />
                  )}
                  {layer.kind === "tilemap" && (
                    <span className="px-0.5 bg-sky-700 text-white text-[9px] rounded">
                      TM
                    </span>
                  )}
                  {layer.reference && (
                    <span className="px-0.5 bg-purple-700 text-white text-[9px] rounded">
                      REF
                    </span>
                  )}

                  {renamingLayerId === layer.id ? (
                    <TextField
                      autoFocus
                      value={renameText}
                      onChange={setRenameText}
                      onBlur={() => handleRenameCommit(layer.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameCommit(layer.id);
                        if (e.key === "Escape") setRenamingLayerId(null);
                      }}
                      className="w-full px-1 text-[11px]"
                    />
                  ) : (
                    <span
                      onKeyDown={(e) => {
                        if (e.key === "F2") {
                          setRenamingLayerId(layer.id);
                          setRenameText(layer.name);
                        }
                      }}
                      className={`truncate flex-1 ${layer.background ? "underline" : ""} ${
                        layer.kind === "group" ? "font-bold" : ""
                      }`}
                    >
                      {layer.name}
                    </span>
                  )}
                </div>
              </div>

              {/* Right Cel Cells across Frames */}
              <div className="flex items-center h-full">
                {sprite.frames.map((frame) => {
                  if (layer.kind === "group") {
                    return (
                      <div
                        key={frame.id}
                        style={{ width: colW }}
                        className="shrink-0 h-full border-r border-[#8d857d] bg-black/10"
                      />
                    );
                  }

                  const cel = getCel(sprite, layer.id, frame.index);
                  const prevCel =
                    frame.index > 0 ? getCel(sprite, layer.id, frame.index - 1) : undefined;
                  const nextCel =
                    frame.index < sprite.frames.length - 1
                      ? getCel(sprite, layer.id, frame.index + 1)
                      : undefined;

                  const linkedLeft = Boolean(cel?.linkId && prevCel?.linkId === cel.linkId);
                  const linkedRight = Boolean(cel?.linkId && nextCel?.linkId === cel.linkId);
                  const isActiveCell =
                    layer.id === activeLayerId && frame.index === activeFrameIndex;
                  const inRange = isCellInSelection(layer.id, frame.index);

                  return (
                    <button
                      key={frame.id}
                      type="button"
                      draggable
                      style={{ width: colW }}
                      onDragStart={() =>
                        setDragCelStart({ layerId: layer.id, frameIndex: frame.index })
                      }
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!dragCelStart) return;
                        const srcLayerIdx = sprite.layers.findIndex(
                          (l) => l.id === dragCelStart.layerId
                        );
                        const dstLayerIdx = sprite.layers.findIndex((l) => l.id === layer.id);
                        const layerDelta = dstLayerIdx - srcLayerIdx;
                        const frameDelta = frame.index - dragCelStart.frameIndex;
                        const mode = e.altKey ? "link" : e.ctrlKey ? "copy" : "move";
                        transferCelRange(layerDelta, frameDelta, mode);
                        setDragCelStart(null);
                      }}
                      onClick={(e) => {
                        if (e.shiftKey) {
                          const allLayerIds = sprite.layers.map((l) => l.id);
                          const i0 = allLayerIds.indexOf(activeLayerId);
                          const i1 = allLayerIds.indexOf(layer.id);
                          const rangeLayers =
                            i0 >= 0 && i1 >= 0
                              ? allLayerIds.slice(Math.min(i0, i1), Math.max(i0, i1) + 1)
                              : [layer.id];
                          setSelectedCelRange({
                            layerIds: rangeLayers,
                            fromFrame: activeFrameIndex,
                            toFrame: frame.index,
                          });
                        } else {
                          setSelectedCelRange(null);
                        }
                        setActiveLayer(layer.id);
                        setActiveFrame(frame.index);
                      }}
                      onDoubleClick={() => {
                        setActiveLayer(layer.id);
                        setActiveFrame(frame.index);
                        openDialog("dialog.cel_properties");
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setActiveLayer(layer.id);
                        setActiveFrame(frame.index);
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          kind: "cel",
                          layerId: layer.id,
                          frameIndex: frame.index,
                        });
                      }}
                      title={`Layer "${layer.name}", Frame ${frame.index + 1}${
                        cel?.linkId ? " [Linked]" : ""
                      }${
                        cel && cel.zIndex !== 0 ? ` [Z=${cel.zIndex}]` : ""
                      } — Drag to Move, Ctrl+Drag to Copy, Alt+Drag to Link, Double-click for Cel Properties`}
                      className={`shrink-0 h-full flex items-center justify-center border-r border-[#8d857d] relative ${
                        isActiveCell
                          ? "ring-2 ring-[#fef08a] z-10"
                          : inRange
                          ? "bg-sky-400/35 ring-1 ring-sky-300"
                          : ""
                      }`}
                    >
                      {timelineThumbnails !== "off" && cel ? (
                        <MiniPixelCanvas
                          image={cel.image}
                          width={rowHeight - 6}
                          height={rowHeight - 6}
                          className="border border-black/40 bg-black/20"
                        />
                      ) : linkedLeft || linkedRight ? (
                        <div
                          className={`h-3 bg-[#141418] flex items-center justify-center ${
                            linkedLeft && linkedRight
                              ? "w-full"
                              : linkedRight
                              ? "w-5 ml-auto rounded-l-full"
                              : "w-5 mr-auto rounded-r-full"
                          }`}
                        >
                          {!linkedLeft && (
                            <span className="w-2 h-2 rounded-full bg-white inline-block ml-1" />
                          )}
                        </div>
                      ) : (
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            isSelectedLayer ? "bg-white" : "bg-[#141418]"
                          }`}
                        />
                      )}

                      {/* Z-Index Indicator Badge */}
                      {cel && cel.zIndex !== 0 && (
                        <span className="absolute top-0 right-0.5 text-[8px] font-bold text-amber-300 bg-black/70 px-0.5 rounded">
                          {cel.zIndex > 0 ? `+${cel.zIndex}` : cel.zIndex}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Context Menu for Layer / Cel / Frame */}
      {contextMenu && (
        <div
          style={{
            left: Math.min(window.innerWidth - 210, contextMenu.x),
            top: Math.min(window.innerHeight - 260, contextMenu.y - 180),
          }}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-52 kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] py-1 shadow-2xl text-xs font-mono"
        >
          {contextMenu.kind === "layer" && contextMenu.layerId && (
            <>
              <button
                type="button"
                onClick={() => {
                  openDialog("dialog.layer_properties");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Layer Properties...
              </button>
              <button
                type="button"
                onClick={() => {
                  const l = sprite.layers.find((i) => i.id === contextMenu.layerId);
                  if (l) {
                    setRenamingLayerId(l.id);
                    setRenameText(l.name);
                  }
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Rename Layer (F2)
              </button>
              <button
                type="button"
                onClick={() => {
                  runCommandById("layer.duplicate");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Duplicate Layer
              </button>
              <button
                type="button"
                onClick={() => {
                  runCommandById("layer.merge_down");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Merge Down
              </button>
              <button
                type="button"
                onClick={() => {
                  runCommandById("layer.flatten_visible");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Flatten Visible
              </button>
              <button
                type="button"
                onClick={() => {
                  runCommandById("layer.convert_tilemap");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Convert Layer &lt;-&gt; Tilemap
              </button>
              <div className="px-3 py-1 flex items-center gap-1 border-t border-black/20">
                <span className="text-[10px]">Color:</span>
                {LAYER_SWATCH_COLORS.map((hex, i) => (
                  <button
                    key={i}
                    type="button"
                    style={{ backgroundColor: hex || "#fff" }}
                    onClick={() => {
                      const l = sprite.layers.find((it) => it.id === contextMenu.layerId);
                      if (l) {
                        doc.execute(
                          new SetLayerFullPropsCommand(l.id, {
                            userData: { ...l.userData, color: hex || undefined },
                          })
                        );
                        bumpRevision();
                      }
                      setContextMenu(null);
                    }}
                    className="w-3.5 h-3.5 border border-black"
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  runCommandById("layer.delete");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left text-red-700 hover:bg-red-600 hover:text-white border-t border-black/20"
              >
                Delete Layer
              </button>
            </>
          )}

          {(contextMenu.kind === "cel" || contextMenu.kind === "frame") && (
            <>
              <button
                type="button"
                onClick={() => {
                  openDialog("dialog.cel_properties");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Cel Properties...
              </button>
              <button
                type="button"
                onClick={() => {
                  openDialog("dialog.frame_properties");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Frame Properties...
              </button>
              <button
                type="button"
                onClick={() => {
                  runCommandById("frame.link_cels");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Link Cels
              </button>
              <button
                type="button"
                onClick={() => {
                  runCommandById("frame.unlink_cels");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Unlink Cels
              </button>
              <button
                type="button"
                onClick={() => {
                  runCommandById("frame.copy_cels");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Copy Cel(s)
              </button>
              <button
                type="button"
                onClick={() => {
                  runCommandById("frame.paste_cels");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Paste Cel(s)
              </button>
              <button
                type="button"
                onClick={() => {
                  runCommandById("frame.clear_cel");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Clear Cel Content
              </button>
              <button
                type="button"
                onClick={() => {
                  runCommandById("frame.reverse");
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1 text-left hover:bg-[var(--kpx-header-bg)] hover:text-white"
              >
                Reverse Frames
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * 2. Full Agent-3 Preview Panel (Independent playback loop, tag filter, 3x3 tiled preview, pan/zoom sync box, full-screen toggle)
 */
export const PreviewPanel: React.FC = () => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const editorZoom = useAppStore((s) => s.zoom);
  const editorPanX = useAppStore((s) => s.panX);
  const editorPanY = useAppStore((s) => s.panY);
  const previewSettings = useAppStore((s) => s.previewSettings);
  const setPreviewSettings = useAppStore((s) => s.setPreviewSettings);
  const setPan = useAppStore((s) => s.setPan);

  const [previewFrame, setPreviewFrame] = useState(0);
  const clockRef = useRef<PlaybackClockState | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Independent Preview Playback Loop
  useEffect(() => {
    if (!doc) return;
    if (!previewSettings.playing || doc.sprite.frames.length <= 1) {
      setPreviewFrame(activeFrameIndex);
      return;
    }

    const cfg = {
      playSubtags: previewSettings.tagId !== "all",
      activeTagId: previewSettings.tagId === "all" ? null : previewSettings.tagId,
    };
    clockRef.current = createPlaybackClockState(doc.sprite, activeFrameIndex, cfg);

    const timer = window.setInterval(() => {
      if (!clockRef.current) return;
      clockRef.current = advancePlaybackClock(doc.sprite, clockRef.current, 40, cfg);
      setPreviewFrame(clockRef.current.frameIndex);
    }, 40);

    return () => window.clearInterval(timer);
  }, [doc, previewSettings.playing, previewSettings.tagId, activeFrameIndex]);

  const effectiveFrame = previewSettings.playing
    ? Math.min(previewFrame, (doc?.sprite.frames.length ?? 1) - 1)
    : activeFrameIndex;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    const comp = compositeFrameAdvanced(doc.sprite, effectiveFrame);
    const mult = previewSettings.tiledPreview ? 3 : 1;
    canvas.width = comp.width * mult;
    canvas.height = comp.height * mult;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const tile = document.createElement("canvas");
    tile.width = comp.width;
    tile.height = comp.height;
    const tCtx = tile.getContext("2d");
    if (tCtx) {
      tCtx.putImageData(
        new ImageData(new Uint8ClampedArray(comp.data), comp.width, comp.height),
        0,
        0
      );
      for (let ty = 0; ty < mult; ty++) {
        for (let tx = 0; tx < mult; tx++) {
          ctx.drawImage(tile, tx * comp.width, ty * comp.height);
        }
      }
    }
  }, [doc, rev, effectiveFrame, previewSettings.tiledPreview]);

  if (!doc) return <div className="p-2 text-xs">No active document</div>;
  const sprite = doc.sprite;
  const mult = previewSettings.tiledPreview ? 3 : 1;
  const scale = previewSettings.syncWithEditor
    ? Math.max(1, Math.round(editorZoom / 200))
    : previewSettings.zoom;

  return (
    <div
      className={`flex flex-col h-full kpx-bevel-inset relative overflow-hidden select-none ${
        previewSettings.fullScreen ? "fixed inset-4 z-50 border-2 border-yellow-400 shadow-2xl" : ""
      }`}
      style={{ backgroundColor: previewSettings.bgColor }}
    >
      {/* Top Mini Toolbar */}
      <div className="flex items-center justify-between px-1.5 py-0.5 bg-[var(--kpx-chrome-bg)] border-b border-black text-[10px] font-mono text-black gap-1">
        <PixelSelect
          ariaLabel="Preview Tag Selector"
          value={previewSettings.tagId}
          onChange={(tagId) => setPreviewSettings({ tagId })}
          options={[
            { value: "all", label: "All Frames" },
            ...sprite.tags.map((t) => ({ value: t.id, label: `Tag: ${t.name}` })),
          ]}
        />
        <div className="flex items-center gap-0.5">
          <PixelButton
            size="xs"
            active={previewSettings.tiledPreview}
            title="Toggle 3x3 Tiled Preview"
            onClick={() =>
              setPreviewSettings({ tiledPreview: !previewSettings.tiledPreview })
            }
          >
            3x3
          </PixelButton>
          <PixelButton
            size="xs"
            active={previewSettings.syncWithEditor}
            title="Synchronize Viewport Pan/Zoom Indicator"
            onClick={() =>
              setPreviewSettings({ syncWithEditor: !previewSettings.syncWithEditor })
            }
          >
            Sync
          </PixelButton>
          <PixelButton
            size="xs"
            active={previewSettings.fullScreen}
            title="Full-Screen Preview Toggle (F7)"
            onClick={() =>
              setPreviewSettings({ fullScreen: !previewSettings.fullScreen })
            }
          >
            Max
          </PixelButton>
        </div>
      </div>

      {/* Center Canvas + Synchronized PanBox Indicator */}
      <div
        onClick={() => setPan(0, 0)}
        title="Click to recenter main editor viewport"
        className="flex-1 flex items-center justify-center overflow-hidden relative cursor-pointer"
      >
        <div className="relative">
          <canvas
            ref={canvasRef}
            style={{
              width: sprite.width * mult * scale,
              height: sprite.height * mult * scale,
              imageRendering: "pixelated",
            }}
            className="border border-black shadow block"
          />
          {previewSettings.syncWithEditor && (
            <div
              style={{
                transform: `translate(${-editorPanX * 0.15}px, ${-editorPanY * 0.15}px)`,
              }}
              className="absolute inset-1 border border-dashed border-amber-300 pointer-events-none"
            />
          )}
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="flex items-center justify-between px-1.5 py-0.5 bg-[var(--kpx-chrome-bg)] border-t border-black text-[10px] font-mono text-white">
        <button
          type="button"
          onClick={() =>
            setPreviewSettings({
              zoom: previewSettings.zoom >= 4 ? 1 : previewSettings.zoom + 1,
            })
          }
          className="px-1 bg-black/30 rounded hover:bg-black/50"
        >
          {scale}x
        </button>
        <span>
          F{effectiveFrame + 1}/{sprite.frames.length}
        </span>
        <ColorInputField
          ariaLabel="Preview Background Color"
          value={previewSettings.bgColor}
          onChange={(hex) => setPreviewSettings({ bgColor: hex })}
          className="w-4 h-3.5"
        />
        <button
          type="button"
          onClick={() => setPreviewSettings({ playing: !previewSettings.playing })}
          className="px-1.5 bg-black/35 rounded hover:bg-black/55 font-bold"
        >
          {previewSettings.playing ? "Pause" : "Play"}
        </button>
      </div>
    </div>
  );
};

/**
 * 3. Upgraded Hierarchical Layers Panel
 */
export const LayersPanel: React.FC = () => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const setActiveLayer = useAppStore((s) => s.setActiveLayer);
  const bumpRevision = useAppStore((s) => s.bumpRevision);
  const runCommandById = useAppStore((s) => s.runCommandById);
  const openDialog = useAppStore((s) => s.openDialog);

  void rev;
  if (!doc) return <div className="p-2 text-xs">No active document</div>;

  const activeLayer = doc.sprite.layers.find((l) => l.id === activeLayerId);
  const treeRows = buildDisplayLayerTree(doc.sprite.layers);

  return (
    <div className="flex flex-col h-full p-1.5 gap-1.5 select-none text-xs font-mono">
      {activeLayer && (
        <div className="space-y-1 bg-black/10 p-1.5 border border-black/30">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px]">Blend:</span>
            <PixelSelect
              ariaLabel="Layer Blend Mode"
              value={activeLayer.blendMode}
              options={ALL_BLEND_MODES.map((m) => ({ value: m, label: m }))}
              onChange={(val) => {
                doc.transact("Change Blend Mode", (tx) =>
                  tx.setLayerProps(activeLayer.id, { blendMode: val as BlendMode })
                );
                bumpRevision();
              }}
              className="flex-1"
            />
          </div>
          <PixelSlider
            label="Opacity"
            value={activeLayer.opacity}
            min={0}
            max={255}
            onChange={(val) => {
              doc.transact("Layer Opacity", (tx) =>
                tx.setLayerProps(activeLayer.id, { opacity: val })
              );
              bumpRevision();
            }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <PixelButton size="xs" onClick={() => runCommandById("layer.new")}>
          + Layer
        </PixelButton>
        <PixelButton size="xs" onClick={() => runCommandById("layer.new_group")}>
          + Group
        </PixelButton>
        <PixelButton size="xs" onClick={() => runCommandById("layer.new_tilemap")}>
          + Tilemap
        </PixelButton>
        <PixelButton size="xs" onClick={() => openDialog("dialog.layer_properties")}>
          Props
        </PixelButton>
        <PixelButton size="xs" onClick={() => runCommandById("layer.merge_down")}>
          Merge
        </PixelButton>
        <PixelButton
          size="xs"
          disabled={doc.sprite.layers.length <= 1}
          onClick={() => runCommandById("layer.delete")}
        >
          Del
        </PixelButton>
      </div>

      <div className="flex-1 kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] overflow-y-auto p-1 space-y-0.5">
        {treeRows.map(({ layer, depth }) => (
          <div
            key={layer.id}
            style={{ paddingLeft: 6 + depth * 12 }}
            onClick={() => setActiveLayer(layer.id)}
            onDoubleClick={() => {
              setActiveLayer(layer.id);
              openDialog("dialog.layer_properties");
            }}
            className={`px-1.5 py-1 text-xs font-mono flex items-center justify-between cursor-pointer ${
              layer.id === activeLayerId
                ? "bg-[var(--kpx-accent-bg)] text-white font-bold"
                : "hover:bg-black/10"
            }`}
          >
            <div className="flex items-center gap-1 truncate">
              {layer.userData.color && (
                <span
                  style={{ backgroundColor: layer.userData.color }}
                  className="w-2 h-2 rounded-full border border-black"
                />
              )}
              <span className="truncate">
                {layer.kind === "group" ? `[G] ${layer.name}` : layer.name}
              </span>
            </div>
            <span className="text-[10px] opacity-75 ml-1">{layer.blendMode}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * 4. Full Agent-3 Tileset Editor Panel (`panel.tileset`)
 */
export const TilesetPanel: React.FC = () => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const fgColor = useAppStore((s) => s.fgColor);
  const tilemapEditMode = useAppStore((s) => s.tilemapEditMode);
  const tilesetModMode = useAppStore((s) => s.tilesetModMode);
  const activeTileIndex = useAppStore((s) => s.activeTileIndex);
  const tileFlipX = useAppStore((s) => s.tileFlipX);
  const tileFlipY = useAppStore((s) => s.tileFlipY);
  const tileRot90 = useAppStore((s) => s.tileRot90);
  const highlightUsedTiles = useAppStore((s) => s.highlightUsedTiles);

  const setTilemapEditMode = useAppStore((s) => s.setTilemapEditMode);
  const setTilesetModMode = useAppStore((s) => s.setTilesetModMode);
  const setActiveTileIndex = useAppStore((s) => s.setActiveTileIndex);
  const toggleTileFlag = useAppStore((s) => s.toggleTileFlag);
  const setHighlightUsedTiles = useAppStore((s) => s.setHighlightUsedTiles);
  const createTilemapLayer = useAppStore((s) => s.createTilemapLayer);
  const openDialog = useAppStore((s) => s.openDialog);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const tileEditorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPaintingTileRef = useRef(false);

  void rev;

  if (!doc) return <div className="p-2 text-xs">No active document</div>;
  const sprite = doc.sprite;
  const activeLayer = sprite.layers.find((l) => l.id === activeLayerId);
  const tileset =
    activeLayer && activeLayer.kind === "tilemap"
      ? sprite.tilesets.find((ts) => ts.id === (activeLayer as TilemapLayer).tilesetId) ??
        sprite.tilesets[0]
      : sprite.tilesets[0];

  const activeCel = getCel(sprite, activeLayerId, activeFrameIndex);
  const selectedTileImg =
    tileset && tileset.tiles[activeTileIndex] ? tileset.tiles[activeTileIndex] : null;

  // Render selected tile in the dedicated "Edit Tile" pixel editor canvas
  useEffect(() => {
    const canvas = tileEditorCanvasRef.current;
    if (!canvas || !selectedTileImg) return;
    canvas.width = selectedTileImg.width;
    canvas.height = selectedTileImg.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#27232c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const palette = getPaletteForFrame(sprite, activeFrameIndex);
    for (let y = 0; y < selectedTileImg.height; y++) {
      for (let x = 0; x < selectedTileImg.width; x++) {
        const rgba = selectedTileImg.getRGBA(x, y, palette, sprite.transparentIndex);
        if (rgba.a > 0) {
          ctx.fillStyle = rgbaToHex(rgba);
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }, [selectedTileImg, rev, activeTileIndex, sprite, activeFrameIndex]);

  if (!tileset) {
    return (
      <div className="p-2.5 flex flex-col gap-2 text-xs font-mono select-none">
        <div>No Tileset in this sprite yet.</div>
        <PixelButton onClick={() => createTilemapLayer({ name: "Tilemap 1", tileWidth: 16, tileHeight: 16 })}>
          + Create Tilemap Layer (16x16)
        </PixelButton>
        <PixelButton onClick={() => openDialog("dialog.new_tilemap_layer")}>
          New Tilemap Layer Dialog...
        </PixelButton>
      </div>
    );
  }

  const handleAddBlankTile = () => {
    doc.execute(
      new UpdateTilesetCommand(tileset.id, "Add Blank Tile", (_s, ts) => {
        ts.tiles.push(new PixelImage(ts.tileWidth, ts.tileHeight, sprite.colorMode));
      })
    );
    setActiveTileIndex(tileset.tiles.length - 1);
    bumpRevision();
  };

  const handleDuplicateTile = () => {
    if (activeTileIndex <= 0 || !tileset.tiles[activeTileIndex]) return;
    doc.execute(
      new UpdateTilesetCommand(tileset.id, "Duplicate Tile", (_s, ts) => {
        ts.tiles.push(ts.tiles[activeTileIndex].clone());
      })
    );
    setActiveTileIndex(tileset.tiles.length - 1);
    bumpRevision();
  };

  const handleDeleteTile = () => {
    if (activeTileIndex <= 0 || tileset.tiles.length <= 1) return;
    doc.execute(
      new UpdateTilesetCommand(tileset.id, "Delete Tile", (_s, ts) => {
        ts.tiles.splice(activeTileIndex, 1);
      })
    );
    setActiveTileIndex(Math.max(0, activeTileIndex - 1));
    bumpRevision();
  };

  const handlePurgeUnused = () => {
    doc.execute(createPurgeUnusedTilesCommand(tileset.id));
    setActiveTileIndex(0);
    bumpRevision();
  };

  const handlePaintSelectedTilePixel = (clientX: number, clientY: number, button: number) => {
    if (activeTileIndex <= 0) return; // Tile 0 is strictly empty/transparent rule
    const canvas = tileEditorCanvasRef.current;
    if (!canvas || !selectedTileImg) return;
    const rect = canvas.getBoundingClientRect();
    const tx = Math.floor(((clientX - rect.left) / Math.max(1, rect.width)) * selectedTileImg.width);
    const ty = Math.floor(((clientY - rect.top) / Math.max(1, rect.height)) * selectedTileImg.height);
    if (tx < 0 || ty < 0 || tx >= selectedTileImg.width || ty >= selectedTileImg.height) return;

    const color = button === 2 ? { r: 0, g: 0, b: 0, a: 0 } : fgColor;
    const pal = getPaletteForFrame(sprite, activeFrameIndex);
    doc.execute(
      new UpdateTilesetCommand(tileset.id, `Edit Tile #${activeTileIndex}`, (_s, ts) => {
        const target = ts.tiles[activeTileIndex];
        if (target) {
          target.setRGBA(tx, ty, color, pal, sprite.transparentIndex);
        }
      })
    );
    bumpRevision();
  };

  const usageCount =
    activeCel?.tilemapData
      ? findTileOccurrences(activeCel.tilemapData, activeTileIndex).length
      : 0;

  return (
    <div className="p-1.5 flex flex-col h-full gap-1.5 text-xs font-mono select-none overflow-y-auto">
      {/* Mode & Modification Mode Controls */}
      <div className="grid grid-cols-2 gap-1 bg-black/10 p-1 border border-black/25">
        <PixelSelect
          ariaLabel="Tilemap Edit Mode"
          value={tilemapEditMode}
          onChange={(v) => setTilemapEditMode(v as TilemapEditMode)}
          options={[
            { value: "tiles", label: "Mode: Tiles" },
            { value: "pixels", label: "Mode: Pixels" },
          ]}
        />
        <PixelSelect
          ariaLabel="Tileset Modification Mode"
          value={tilesetModMode}
          onChange={(v) => setTilesetModMode(v as TilesetModificationMode)}
          options={[
            { value: "auto", label: "Auto Tiles" },
            { value: "stack", label: "Stack Tiles" },
            { value: "manual", label: "Manual Tiles" },
          ]}
        />
      </div>

      {/* Flip / Rotate Flags & Highlight Used */}
      <div className="flex flex-wrap items-center gap-1">
        <PixelButton
          size="xs"
          active={tileFlipX}
          title="Flip Tile Horizontally (TILE_FLIP_X_FLAG)"
          onClick={() => toggleTileFlag("flipX")}
        >
          FlipX
        </PixelButton>
        <PixelButton
          size="xs"
          active={tileFlipY}
          title="Flip Tile Vertically (TILE_FLIP_Y_FLAG)"
          onClick={() => toggleTileFlag("flipY")}
        >
          FlipY
        </PixelButton>
        <PixelButton
          size="xs"
          active={tileRot90}
          title="Rotate Tile 90° (TILE_ROTATE_90_FLAG)"
          onClick={() => toggleTileFlag("rot90")}
        >
          Rot90°
        </PixelButton>
        <PixelButton
          size="xs"
          active={highlightUsedTiles}
          title="Highlight Occurrences of Selected Tile on Canvas"
          onClick={() => setHighlightUsedTiles(!highlightUsedTiles)}
        >
          Used ({usageCount})
        </PixelButton>
        <PixelButton
          size="xs"
          title="Tileset Properties..."
          onClick={() => openDialog("dialog.tileset_properties")}
        >
          Props
        </PixelButton>
      </div>

      {/* Tileset Grid */}
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-bold truncate">
          {tileset.name} ({tileset.tileWidth}x{tileset.tileHeight})
        </span>
        <span>{tileset.tiles.length} tiles</span>
      </div>

      <div className="grid grid-cols-4 gap-1 p-1.5 kpx-bevel-inset bg-[#27232c] max-h-40 overflow-y-auto">
        {tileset.tiles.map((tImg, idx) => {
          const isSelected = idx === activeTileIndex;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveTileIndex(idx)}
              title={
                idx === 0
                  ? "Tile #0 (Empty / Transparent Tile Rule)"
                  : `Tile #${idx} (${tImg.width}x${tImg.height})`
              }
              className={`p-1 flex flex-col items-center justify-center border cursor-pointer relative ${
                isSelected
                  ? "border-yellow-300 bg-white/15 ring-1 ring-yellow-300"
                  : "border-black/60 bg-black/30 hover:bg-white/10"
              }`}
            >
              <MiniPixelCanvas image={tImg} width={28} height={28} />
              <span className="text-[9px] text-white mt-0.5">
                #{idx}
                {idx === 0 ? " (Empty)" : ""}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tile Management Actions */}
      <div className="flex flex-wrap items-center gap-1">
        <PixelButton size="xs" onClick={handleAddBlankTile}>
          + Tile
        </PixelButton>
        <PixelButton
          size="xs"
          disabled={activeTileIndex === 0}
          onClick={handleDuplicateTile}
        >
          Dup
        </PixelButton>
        <PixelButton
          size="xs"
          disabled={activeTileIndex === 0}
          onClick={handleDeleteTile}
        >
          Del
        </PixelButton>
        <PixelButton
          size="xs"
          title="Purge Unused Tiles and Remap Indices"
          onClick={handlePurgeUnused}
        >
          Purge Unused
        </PixelButton>
      </div>

      {/* Dedicated "Edit Tile" Live Pixel Editor */}
      <div className="border-t border-black/30 pt-1.5 space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold">
            Edit Tile #{activeTileIndex} Pixels:
          </span>
          <span className="text-[10px] opacity-75">
            {activeTileIndex === 0 ? "Tile #0 is Empty" : "L-click: FG, R-click: Erase"}
          </span>
        </div>
        <div className="kpx-bevel-inset bg-[#1e1b24] p-1.5 flex items-center justify-center">
          {activeTileIndex === 0 ? (
            <div className="text-[10px] text-white/70 py-4 text-center">
              Tile #0 is reserved as Transparent Empty Tile. Select Tile #1..N to edit pixels.
            </div>
          ) : (
            <canvas
              ref={tileEditorCanvasRef}
              onMouseDown={(e) => {
                isPaintingTileRef.current = true;
                handlePaintSelectedTilePixel(e.clientX, e.clientY, e.button);
              }}
              onMouseMove={(e) => {
                if (isPaintingTileRef.current) {
                  handlePaintSelectedTilePixel(
                    e.clientX,
                    e.clientY,
                    e.buttons === 2 ? 2 : 0
                  );
                }
              }}
              onMouseUp={() => {
                isPaintingTileRef.current = false;
              }}
              onMouseLeave={() => {
                isPaintingTileRef.current = false;
              }}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                width: 96,
                height: 96,
                imageRendering: "pixelated",
              }}
              className="border border-white/40 cursor-crosshair block"
            />
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * 5. Animation Tags Panel (`panel.tags`)
 */
export const TagsPanel: React.FC = () => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const activeTagId = useAppStore((s) => s.activeTagId);
  const setActiveTagId = useAppStore((s) => s.setActiveTagId);
  const setActiveFrame = useAppStore((s) => s.setActiveFrame);
  const setIsPlaying = useAppStore((s) => s.setIsPlaying);
  const openDialog = useAppStore((s) => s.openDialog);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  void rev;
  if (!doc) return <div className="p-2 text-xs">No active document</div>;
  const sprite = doc.sprite;

  const handleQuickAddTag = () => {
    const newTag: Tag = {
      id: createModelId("tag"),
      name: `tag_${sprite.tags.length + 1}`,
      fromFrame: activeFrameIndex,
      toFrame: Math.min(sprite.frames.length - 1, activeFrameIndex + 2),
      direction: "forward",
      color: "#22c55e",
      repeat: 0,
      userData: { text: "" },
    };
    doc.execute(new AddTagCommand(newTag));
    setActiveTagId(newTag.id);
    bumpRevision();
  };

  return (
    <div className="p-1.5 flex flex-col h-full gap-1.5 text-xs font-mono select-none">
      <div className="flex items-center justify-between gap-1">
        <PixelButton size="xs" onClick={handleQuickAddTag}>
          + Quick Tag
        </PixelButton>
        <PixelButton size="xs" onClick={() => openDialog("dialog.tag_properties")}>
          Tag Properties...
        </PixelButton>
      </div>

      <div className="flex-1 kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] overflow-y-auto p-1 space-y-1">
        {sprite.tags.length === 0 ? (
          <div className="p-2 text-[11px] opacity-70">No animation tags defined.</div>
        ) : (
          sprite.tags.map((tag) => {
            const selected = tag.id === activeTagId;
            return (
              <div
                key={tag.id}
                onClick={() => {
                  setActiveTagId(tag.id);
                  setActiveFrame(tag.fromFrame);
                }}
                className={`p-1.5 border flex items-center justify-between cursor-pointer ${
                  selected
                    ? "bg-[var(--kpx-accent-bg)] text-white border-black font-bold"
                    : "bg-black/5 border-black/20 hover:bg-black/10"
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span
                    style={{ backgroundColor: tag.color }}
                    className="w-3 h-3 rounded-sm border border-black shrink-0"
                  />
                  <div className="truncate">
                    <div>{tag.name}</div>
                    <div className="text-[10px] opacity-80">
                      F{tag.fromFrame + 1}..F{tag.toFrame + 1} • {tag.direction} •{" "}
                      {tag.repeat === 0 ? "∞" : `${tag.repeat}x`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <PixelButton
                    size="xs"
                    title="Play this Tag"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveTagId(tag.id);
                      setActiveFrame(tag.fromFrame);
                      setIsPlaying(true);
                    }}
                  >
                    ▶
                  </PixelButton>
                  <PixelButton
                    size="xs"
                    title="Edit Tag"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveTagId(tag.id);
                      openDialog("dialog.tag_properties");
                    }}
                  >
                    Edit
                  </PixelButton>
                  <PixelButton
                    size="xs"
                    title="Delete Tag"
                    onClick={(e) => {
                      e.stopPropagation();
                      doc.execute(new RemoveTagCommand(tag.id));
                      bumpRevision();
                    }}
                  >
                    ×
                  </PixelButton>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

/**
 * 6. Slices & 9-Patch Panel (`panel.slices`)
 */
export const SlicesPanel: React.FC = () => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const activeSliceId = useAppStore((s) => s.activeSliceId);
  const showSlicesOverlay = useAppStore((s) => s.showSlicesOverlay);
  const setActiveSliceId = useAppStore((s) => s.setActiveSliceId);
  const setShowSlicesOverlay = useAppStore((s) => s.setShowSlicesOverlay);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const selectSliceBounds = useAppStore((s) => s.selectSliceBounds);
  const exportSliceAsNewDocument = useAppStore((s) => s.exportSliceAsNewDocument);
  const openDialog = useAppStore((s) => s.openDialog);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  void rev;
  if (!doc) return <div className="p-2 text-xs">No active document</div>;
  const sprite = doc.sprite;

  const handleQuickAddSlice = () => {
    const newSlice = {
      id: createModelId("slice"),
      name: `slice_${sprite.slices.length + 1}`,
      color: "#f59e0b",
      keys: [
        {
          frameIndex: activeFrameIndex,
          bounds: {
            x: 8,
            y: 8,
            width: Math.max(8, Math.floor(sprite.width / 2)),
            height: Math.max(8, Math.floor(sprite.height / 2)),
          },
          center: {
            x: 2,
            y: 2,
            width: Math.max(4, Math.floor(sprite.width / 2) - 4),
            height: Math.max(4, Math.floor(sprite.height / 2) - 4),
          },
          pivot: {
            x: Math.floor(sprite.width / 4),
            y: Math.floor(sprite.height / 4),
          },
        },
      ],
      userData: { text: "" },
    };
    doc.execute(new AddSliceCommand(newSlice));
    setActiveSliceId(newSlice.id);
    bumpRevision();
  };

  return (
    <div className="p-1.5 flex flex-col h-full gap-1.5 text-xs font-mono select-none">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <PixelButton size="xs" onClick={() => setActiveTool("tool.slice")}>
          Slice Tool (Shift+C)
        </PixelButton>
        <PixelButton size="xs" onClick={handleQuickAddSlice}>
          + Slice
        </PixelButton>
        <PixelButton size="xs" onClick={() => openDialog("dialog.slice_properties")}>
          Props...
        </PixelButton>
      </div>

      <PixelCheckbox
        checked={showSlicesOverlay}
        onChange={setShowSlicesOverlay}
        label="Show Slice Overlays & 9-Patch Guides"
      />

      <div className="flex-1 kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] overflow-y-auto p-1 space-y-1">
        {sprite.slices.length === 0 ? (
          <div className="p-2 text-[11px] opacity-70">
            No slices yet. Select Slice Tool (Shift+C) and drag on canvas, or click + Slice.
          </div>
        ) : (
          sprite.slices.map((slice) => {
            const selected = slice.id === activeSliceId;
            const key = getSliceKeyForFrame(slice, activeFrameIndex);
            return (
              <div
                key={slice.id}
                onClick={() => setActiveSliceId(slice.id)}
                className={`p-1.5 border flex flex-col gap-1 cursor-pointer ${
                  selected
                    ? "bg-[var(--kpx-accent-bg)] text-white border-black font-bold"
                    : "bg-black/5 border-black/20 hover:bg-black/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      style={{ backgroundColor: slice.color }}
                      className="w-3 h-3 rounded-sm border border-black shrink-0"
                    />
                    <span className="truncate">{slice.name}</span>
                  </div>
                  <span className="text-[10px] opacity-80">
                    {key.bounds.width}×{key.bounds.height}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span>
                    ({key.bounds.x},{key.bounds.y}){key.center ? " • 9-Patch" : ""}
                    {key.pivot ? " • Pivot" : ""} • {slice.keys.length}k
                  </span>
                  <div className="flex items-center gap-0.5">
                    <PixelButton
                      size="xs"
                      title="Select Slice Bounds as Mask"
                      onClick={(e) => {
                        e.stopPropagation();
                        selectSliceBounds(slice.id);
                      }}
                    >
                      Sel
                    </PixelButton>
                    <PixelButton
                      size="xs"
                      title="Export Slice Region as New Sprite Tab"
                      onClick={(e) => {
                        e.stopPropagation();
                        exportSliceAsNewDocument(slice.id);
                      }}
                    >
                      Export
                    </PixelButton>
                    <PixelButton
                      size="xs"
                      title="Slice Properties..."
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveSliceId(slice.id);
                        openDialog("dialog.slice_properties");
                      }}
                    >
                      Edit
                    </PixelButton>
                    <PixelButton
                      size="xs"
                      title="Delete Slice"
                      onClick={(e) => {
                        e.stopPropagation();
                        doc.execute(new RemoveSliceCommand(slice.id));
                        bumpRevision();
                      }}
                    >
                      ×
                    </PixelButton>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
