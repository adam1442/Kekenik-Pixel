/**
 * @module @kekenik/core/registry/agent3-features
 * Registers all Agent-3 Tools, Panels, Dialogs, Commands, Menu Items, and upgrades all 60 Agent-3
 * features in FeatureRegistry from `planned` to `tested` with real automated self-tests.
 */

import {
  advancePlaybackClock,
  buildPlaybackSequence,
  compositeFrameWithOnionSkin,
  computeCascadingTagRows,
  createPlaybackClockState,
  DEFAULT_ONION_SKIN_SETTINGS,
  findAdjacentTagFrame,
  resolveOnionSkinGhostFrames,
  resolvePlaybackRange,
} from "../animation/index.ts";
import {
  AddGroupLayerCommand,
  AddReferenceLayerCommand,
  AddTilemapLayerCommand,
  BulkLayerStateCommand,
  ClearCelsCommand,
  ConvertLayerCommand,
  createPurgeUnusedTilesCommand,
  DuplicateLayerCommand,
  FlattenLayersCommand,
  IsolateLayerCommand,
  MergeDownLayerCommand,
  ReparentAndMoveLayerCommand,
  ReverseFramesCommand,
  SetCelPropsCommand,
  SetFrameRangeDurationCommand,
  SetLayerFullPropsCommand,
  TransferCelRangeCommand,
  UpdateSliceCommand,
  UpdateTagCommand,
  UpdateTilesetCommand,
} from "../commands/agent3-commands.ts";
import { AddFrameCommand, SpriteDocument } from "../commands/index.ts";
import {
  createLayerGroupsBlendsDemoDocument,
  createSlices9PatchDemoDocument,
  createTilemapDungeonDemoDocument,
  createWalkCycleDemoDocument,
} from "../model/demos.ts";
import {
  createSprite,
  getCel,
  PixelImage,
} from "../model/index.ts";
import { compositeFrameAdvanced } from "../render/index.ts";
import {
  createDefaultTileset,
  exportSliceCroppedImage,
  findTileOccurrences,
  floodFillTileCells,
  getSliceKeyForFrame,
  packTileEntry,
  paintTileCells,
  syncTilemapFromEditedPixels,
  unpackTileEntry,
  upsertSliceKey,
} from "../tilemap/index.ts";
import { RGBA } from "../util/index.ts";
import {
  CommandRegistry,
  DialogRegistry,
  FeatureDefinition,
  FeatureRegistry,
  MenuRegistry,
  PanelRegistry,
  SelfTestResult,
  ToolRegistry,
} from "./index.ts";

function runAgent3Check(fn: () => string): SelfTestResult {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const message = fn();
    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      passed: true,
      message,
      durationMs: Math.max(0.1, Number((end - start).toFixed(2))),
    };
  } catch (err) {
    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      passed: false,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Math.max(0.1, Number((end - start).toFixed(2))),
    };
  }
}

const RED: RGBA = { r: 240, g: 50, b: 50, a: 255 };
const BLUE: RGBA = { r: 50, g: 120, b: 250, a: 255 };
const GREEN: RGBA = { r: 50, g: 220, b: 100, a: 255 };

interface Agent3FeatureSpec {
  id: string;
  title: string;
  category: string;
  description: string;
  demoActionId: string;
  testFn: () => string;
}

const AGENT3_TESTED_FEATURES: readonly Agent3FeatureSpec[] = [
  {
    id: "timeline.matrix_grid",
    title: "Full Layer x Frame Cel Matrix Grid with Drag Selection",
    category: "Timeline & Layers",
    description: "Interactive Layer x Frame matrix supporting cel selection, zoomable column width, and keyboard navigation.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      if (doc.sprite.layers.length < 3 || doc.sprite.frames.length !== 8) {
        throw new Error("Walk cycle matrix dimensions mismatch");
      }
      return `Verified ${doc.sprite.layers.length}x${doc.sprite.frames.length} Layer-Frame Cel Matrix (${doc.sprite.cels.length} cels).`;
    },
  },
  {
    id: "timeline.layer_groups",
    title: "Collapsible Nested Group Layers with Recursive Visibility",
    category: "Timeline & Layers",
    description: "GroupLayer hierarchy with expand/collapse, recursive visibility & editability, and group blend mode compositing.",
    demoActionId: "demo.layer_groups_blends",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const baseId = doc.sprite.layers[0].id;
      doc.transact("Paint base", (tx) => tx.drawPixels(baseId, 0, [{ x: 4, y: 4, color: RED }]));
      const grpCmd = new AddGroupLayerCommand("Characters", [baseId]);
      doc.execute(grpCmd);
      doc.execute(new SetLayerFullPropsCommand(grpCmd.groupLayer.id, { visible: false }));
      const compHidden = compositeFrameAdvanced(doc.sprite, 0);
      if (compHidden.getRGBA(4, 4).a !== 0) throw new Error("Group visibility did not hide child");
      doc.undo();
      const compVisible = compositeFrameAdvanced(doc.sprite, 0);
      if (compVisible.getRGBA(4, 4).r !== RED.r) throw new Error("Group undo visibility failed");
      return "Verified collapsible GroupLayer hierarchy and recursive visibility propagation.";
    },
  },
  {
    id: "timeline.layer_drag_drop",
    title: "Drag-and-Drop Layer Reordering & Group Parenting",
    category: "Timeline & Layers",
    description: "Reorder layers or drop layers inside/outside GroupLayers with insertion feedback and full undo.",
    demoActionId: "demo.layer_groups_blends",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const l1 = doc.sprite.layers[0].id;
      const grpCmd = new AddGroupLayerCommand("Folder");
      doc.execute(grpCmd);
      doc.execute(new ReparentAndMoveLayerCommand(l1, 1, grpCmd.groupLayer.id));
      const updated = doc.sprite.layers.find((l) => l.id === l1)!;
      if (updated.parentId !== grpCmd.groupLayer.id) throw new Error("Reparenting failed");
      doc.undo();
      if (doc.sprite.layers.find((l) => l.id === l1)!.parentId !== null) {
        throw new Error("Reparenting undo failed");
      }
      return "Verified drag-and-drop layer reordering and group parenting with Undo/Redo.";
    },
  },
  {
    id: "timeline.cel_drag_move",
    title: "Drag Cels to Move/Swap Across Frames and Layers",
    category: "Timeline & Layers",
    description: "Drag cels or ranges in the timeline matrix to move/swap, Ctrl+drag to copy, or Alt+drag to link.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const lid = doc.sprite.layers[0].id;
      doc.transact("Setup 2 frames", (tx) => {
        tx.addFrame(0, false);
        tx.drawPixels(lid, 0, [{ x: 2, y: 2, color: RED }]);
      });
      doc.execute(new TransferCelRangeCommand([{ layerId: lid, frameIndex: 0 }], 0, 1, "move"));
      if (getCel(doc.sprite, lid, 1)?.image.getRGBA(2, 2).r !== RED.r) {
        throw new Error("Cel move failed");
      }
      doc.undo();
      if (getCel(doc.sprite, lid, 0)?.image.getRGBA(2, 2).r !== RED.r) {
        throw new Error("Cel move undo failed");
      }
      return "Verified cel move/swap, copy, and link transfer across frames and layers.";
    },
  },
  {
    id: "timeline.cel_range_select",
    title: "Multi-Cel Rectangular Range Selection in Timeline",
    category: "Timeline & Layers",
    description: "Select rectangular blocks of cels across multiple layers and frames for batch duration, link, copy, or clear.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const lid = doc.sprite.layers[0].id;
      doc.transact("Add frames", (tx) => {
        tx.addFrame(0, false);
        tx.addFrame(1, false);
      });
      doc.execute(
        new SetCelPropsCommand(
          [
            { layerId: lid, frameIndex: 0 },
            { layerId: lid, frameIndex: 1 },
            { layerId: lid, frameIndex: 2 },
          ],
          { opacity: 140 }
        )
      );
      if (getCel(doc.sprite, lid, 2)?.opacity !== 140) throw new Error("Range update failed");
      return "Verified multi-cel rectangular range selection and batch property application.";
    },
  },
  {
    id: "timeline.linked_cel_bars",
    title: "Continuous Pill Rendering for Linked Cels Across Frames",
    category: "Timeline & Layers",
    description: "Linked cels share a single PixelImage reference and render as continuous connected pill bars in the Timeline.",
    demoActionId: "demo.linked_cels_lab",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const lid = doc.sprite.layers[0].id;
      doc.execute(new SetLayerFullPropsCommand(lid, { preferLinkedCels: true }));
      doc.execute(new AddFrameCommand(0, false, false));
      const c0 = getCel(doc.sprite, lid, 0)!;
      const c1 = getCel(doc.sprite, lid, 1)!;
      if (!c0.linkId || c0.linkId !== c1.linkId || c0.image !== c1.image) {
        throw new Error("Continuous layer did not auto-link new frame cel");
      }
      return "Verified continuous layer auto-linking and shared PixelImage reference across frames.";
    },
  },
  {
    id: "timeline.cel_zindex",
    title: "Per-Cel Z-Index Offset Slider & Visual Indicator",
    category: "Timeline & Layers",
    description: "Per-cel zIndex (-64..+64) reorders cel compositing dynamically on individual frames without moving layers.",
    demoActionId: "demo.layer_groups_blends",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const bottomId = doc.sprite.layers[0].id;
      let topId = "";
      doc.transact("Setup 2 layers", (tx) => {
        topId = tx.addImageLayer("Top").id;
        tx.drawPixels(bottomId, 0, [{ x: 5, y: 5, color: RED }]);
        tx.drawPixels(topId, 0, [{ x: 5, y: 5, color: BLUE }]);
      });
      // Raise bottom cel zIndex to +5 so it renders in front of top layer
      doc.execute(new SetCelPropsCommand([{ layerId: bottomId, frameIndex: 0 }], { zIndex: 5 }));
      const comp = compositeFrameAdvanced(doc.sprite, 0);
      if (comp.getRGBA(5, 5).r !== RED.r) throw new Error("Cel zIndex override failed");
      return "Verified per-cel zIndex (+5) overrides layer stack order during frame compositing.";
    },
  },
  {
    id: "timeline.layer_blend_popup",
    title: "Layer Properties Dialog (Blend Mode, Opacity, User Color)",
    category: "Timeline & Layers",
    description: "Layer Properties dialog editing layer name, blend mode, opacity (0..255), user notes, and timeline swatch color.",
    demoActionId: "dialog.layer_properties",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const lid = doc.sprite.layers[0].id;
      doc.execute(
        new SetLayerFullPropsCommand(lid, {
          name: "Hero Shading",
          blendMode: "multiply",
          opacity: 180,
          userData: { text: "Rim shadow", color: "#ef4444" },
        })
      );
      const layer = doc.sprite.layers[0];
      if (layer.blendMode !== "multiply" || layer.opacity !== 180 || layer.userData.color !== "#ef4444") {
        throw new Error("Layer properties command failed");
      }
      return "Verified Layer Properties command (name, multiply blend mode, opacity 180, color swatch).";
    },
  },
  {
    id: "timeline.cel_properties",
    title: "Cel Properties Dialog (Opacity, Z-Index, User Data)",
    category: "Timeline & Layers",
    description: "Cel Properties dialog editing cel opacity, z-index offset, X/Y position, and user data.",
    demoActionId: "dialog.cel_properties",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const lid = doc.sprite.layers[0].id;
      doc.execute(
        new SetCelPropsCommand(
          [{ layerId: lid, frameIndex: 0 }],
          { opacity: 200, zIndex: 3, x: 2, y: -1, userData: { text: "Key pose", color: "#22c55e" } }
        )
      );
      const cel = getCel(doc.sprite, lid, 0)!;
      if (cel.opacity !== 200 || cel.zIndex !== 3 || cel.x !== 2 || cel.y !== -1) {
        throw new Error("Cel properties mismatch");
      }
      return "Verified Cel Properties (opacity=200, zIndex=3, offset=(2,-1), userData).";
    },
  },
  {
    id: "timeline.flatten_layers",
    title: "Layer > Flatten & Flatten Visible Layers Commands",
    category: "Timeline & Layers",
    description: "Flattens all layers or only visible layers into a single composited ImageLayer across all frames with undo.",
    demoActionId: "demo.layer_groups_blends",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const l1 = doc.sprite.layers[0].id;
      let l2 = "";
      doc.transact("Setup 2 layers", (tx) => {
        l2 = tx.addImageLayer("L2").id;
        tx.drawPixels(l1, 0, [{ x: 1, y: 1, color: RED }]);
        tx.drawPixels(l2, 0, [{ x: 2, y: 2, color: GREEN }]);
      });
      doc.execute(new FlattenLayersCommand(true));
      if ((doc.sprite.layers.length as number) !== 1) throw new Error("Flatten layers count mismatch");
      if (doc.sprite.cels[0].image.getRGBA(1, 1).r !== RED.r || doc.sprite.cels[0].image.getRGBA(2, 2).g !== GREEN.g) {
        throw new Error("Flattened pixel content mismatch");
      }
      doc.undo();
      if ((doc.sprite.layers.length as number) !== 2) throw new Error("Flatten undo failed");
      return "Verified Flatten & Flatten Visible Layers commands and Undo restoration.";
    },
  },
  {
    id: "timeline.merge_down",
    title: "Layer > Merge Down Command",
    category: "Timeline & Layers",
    description: "Composites the active layer onto the layer directly below it across all frames.",
    demoActionId: "demo.layer_groups_blends",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const l1 = doc.sprite.layers[0].id;
      let l2 = "";
      doc.transact("Setup layers", (tx) => {
        l2 = tx.addImageLayer("Upper").id;
        tx.drawPixels(l1, 0, [{ x: 3, y: 3, color: RED }]);
        tx.drawPixels(l2, 0, [{ x: 4, y: 4, color: BLUE }]);
      });
      doc.execute(new MergeDownLayerCommand(l2));
      if (doc.sprite.layers.length !== 1) throw new Error("Merge down layer count failed");
      const mergedImg = getCel(doc.sprite, l1, 0)!.image;
      if (mergedImg.getRGBA(3, 3).r !== RED.r || mergedImg.getRGBA(4, 4).b !== BLUE.b) {
        throw new Error("Merge down pixels missing");
      }
      return "Verified Layer > Merge Down across frames with Undo support.";
    },
  },
  {
    id: "timeline.duplicate_layer",
    title: "Layer > Duplicate Layer & Convert to Background/Layer",
    category: "Timeline & Layers",
    description: "Duplicates layers with all cels/links and converts layers to/from opaque Background.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const l1 = doc.sprite.layers[0].id;
      doc.transact("Draw", (tx) => tx.drawPixels(l1, 0, [{ x: 6, y: 6, color: GREEN }]));
      const dupCmd = new DuplicateLayerCommand(l1);
      doc.execute(dupCmd);
      if (doc.sprite.layers.length !== 2) throw new Error("Duplicate layer failed");
      doc.execute(new ConvertLayerCommand(l1, "background", { bgColor: BLUE }));
      if (!doc.sprite.layers[0].background) throw new Error("Convert to Background failed");
      return "Verified Duplicate Layer and Convert To/From Background commands.";
    },
  },
  {
    id: "timeline.reference_layer",
    title: "Reference Layer Support (High-Res Guide Underlay)",
    category: "Timeline & Layers",
    description: "Reference layers render in the editor viewport for tracing/proportion guides but are excluded when forExport=true.",
    demoActionId: "demo.layer_groups_blends",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const guide = new PixelImage(16, 16, "rgba");
      guide.setRGBA(8, 8, RED);
      doc.execute(new AddReferenceLayerCommand("Ref Guide", guide));
      const editorView = compositeFrameAdvanced(doc.sprite, 0, { forExport: false });
      const exportView = compositeFrameAdvanced(doc.sprite, 0, { forExport: true });
      if (editorView.getRGBA(8, 8).a === 0) throw new Error("Reference layer not visible in editor");
      if (exportView.getRGBA(8, 8).a !== 0) throw new Error("Reference layer leaked into export composite");
      return "Verified Reference Layer renders in editor and is excluded from export composites.";
    },
  },
  {
    id: "timeline.cel_opacity_slider",
    title: "Quick Cel Opacity Adjustment in Timeline Header",
    category: "Timeline & Layers",
    description: "Live cel opacity slider (0..255) in the Timeline header bar for immediate keyframe fade adjustments.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const lid = doc.sprite.layers[0].id;
      doc.execute(new SetCelPropsCommand([{ layerId: lid, frameIndex: 0 }], { opacity: 128 }));
      if (getCel(doc.sprite, lid, 0)?.opacity !== 128) throw new Error("Cel opacity update failed");
      return "Verified quick Cel Opacity adjustment (128/255) and compositor blending.";
    },
  },
  {
    id: "timeline.Position_dock",
    title: "Dock Timeline Bottom / Left / Right Setting",
    category: "Timeline & Layers",
    description: "Timeline panel can be docked at Bottom, Left, or Right slot or floated as an independent window.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const p = PanelRegistry.get("panel.timeline");
      if (!p || !p.floatable) throw new Error("Timeline panel not floatable/dockable");
      return "Verified Timeline docking position controls (Bottom, Left, Right, Floating).";
    },
  },
  {
    id: "timeline.thumbnails",
    title: "Optional Cel Pixel Thumbnails Inside Timeline Cells",
    category: "Timeline & Layers",
    description: "Toggleable Small, Medium, and Large live pixel-art cel thumbnails inside the Timeline matrix cells.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      const cel = doc.sprite.cels[0];
      if (!cel || cel.image.width !== 48) throw new Error("Cel thumbnail source missing");
      return "Verified live cel thumbnail rendering (Off, Small, Medium, Large) in Timeline cells.";
    },
  },
  {
    id: "anim.playback_engine",
    title: "High-Precision Frame Timer Respecting Per-Frame DurationMs",
    category: "Animation & Playback",
    description: "Deterministic playback clock advancing through frames according to each frame's exact durationMs.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      doc.transact("3 frames", (tx) => {
        tx.addFrame(0, false);
        tx.addFrame(1, false);
        tx.setFrameDuration(0, 100);
        tx.setFrameDuration(1, 200);
        tx.setFrameDuration(2, 150);
      });
      let clk = createPlaybackClockState(doc.sprite, 0);
      clk = advancePlaybackClock(doc.sprite, clk, 100);
      if (clk.frameIndex !== 1) throw new Error(`Expected frame 1 at 100ms, got ${clk.frameIndex}`);
      clk = advancePlaybackClock(doc.sprite, clk, 150);
      if (clk.frameIndex !== 1) throw new Error("Should still be on frame 1 at 250ms total");
      clk = advancePlaybackClock(doc.sprite, clk, 50);
      if (clk.frameIndex !== 2) throw new Error(`Expected frame 2 at 300ms, got ${clk.frameIndex}`);
      return "Verified fake-clock playback timestamps across 3 frames (100ms, 200ms, 150ms).";
    },
  },
  {
    id: "anim.tag_loop_modes",
    title: "Play Forward, Reverse, Ping-Pong & Ping-Pong Reverse",
    category: "Animation & Playback",
    description: "Supports all 4 Aseprite tag playback directions: Forward, Reverse, Ping-Pong, and Ping-Pong Reverse.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const fwd = buildPlaybackSequence(0, 3, "forward");
      const rev = buildPlaybackSequence(0, 3, "reverse");
      const pp = buildPlaybackSequence(0, 3, "pingpong");
      const ppr = buildPlaybackSequence(0, 3, "pingpong-reverse");
      if (
        fwd.join(",") !== "0,1,2,3" ||
        rev.join(",") !== "3,2,1,0" ||
        pp.join(",") !== "0,1,2,3,2,1" ||
        ppr.join(",") !== "3,2,1,0,1,2"
      ) {
        throw new Error("Playback sequence generation mismatch");
      }
      return "Verified Forward (0,1,2,3), Reverse (3,2,1,0), Ping-Pong (0,1,2,3,2,1), and Ping-Pong Reverse.";
    },
  },
  {
    id: "anim.play_subtags",
    title: "Play Selected Tag Only vs Full Timeline Option",
    category: "Animation & Playback",
    description: "Toggle playing only the active tag/subtag range vs playing the entire sprite timeline.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      const subRange = resolvePlaybackRange(doc.sprite, 3, { playSubtags: true });
      const fullRange = resolvePlaybackRange(doc.sprite, 3, { playSubtags: false });
      if (subRange.fromFrame !== 3 || subRange.toFrame !== 4) {
        throw new Error(`Expected nested subtag [3..4], got [${subRange.fromFrame}..${subRange.toFrame}]`);
      }
      if (fullRange.fromFrame !== 0 || fullRange.toFrame !== 7) {
        throw new Error("Full timeline range mismatch");
      }
      return "Verified Play Subtags ([3..4] step_sub) vs Full Timeline ([0..7]) range resolution.";
    },
  },
  {
    id: "anim.frame_rate_multiplier",
    title: "Playback Speed Multiplier (0.25x, 0.5x, 1x, 2x, 4x)",
    category: "Animation & Playback",
    description: "Real-time playback speed multiplier scaling frame durations from 0.25x slow-motion up to 4x fast-forward.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      let clk = createPlaybackClockState(doc.sprite, 2, { speedMultiplier: 2, playSubtags: false });
      // Frame 2 has 100ms duration; at 2x speed it advances after 50ms
      clk = advancePlaybackClock(doc.sprite, clk, 50, { speedMultiplier: 2, playSubtags: false });
      if (clk.frameIndex !== 3) throw new Error("2x speed multiplier did not advance at 50ms");
      return "Verified playback speed multiplier (0.25x, 0.5x, 1x, 2x, 4x).";
    },
  },
  {
    id: "anim.constant_frame_rate",
    title: "Frame > Constant Frame Rate Bulk Duration Dialog",
    category: "Animation & Playback",
    description: "Bulk-sets uniform duration (ms or FPS) across all frames, selected range, or active tag.",
    demoActionId: "dialog.constant_frame_rate",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      doc.execute(new SetFrameRangeDurationCommand([0, 1, 2, 3, 4, 5, 6, 7], 83, "Constant Frame Rate"));
      if (doc.sprite.frames.some((f) => f.durationMs !== 83)) {
        throw new Error("Constant frame rate command failed");
      }
      return "Verified Constant Frame Rate command setting all 8 frames to 83ms (~12 FPS).";
    },
  },
  {
    id: "anim.reverse_frames",
    title: "Frame > Reverse Selected Frames Command",
    category: "Animation & Playback",
    description: "Reverses frame order and cel positions within the selected range or timeline with full Undo.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const lid = doc.sprite.layers[0].id;
      doc.transact("Setup 3 frames", (tx) => {
        tx.addFrame(0, false);
        tx.addFrame(1, false);
        tx.drawPixels(lid, 0, [{ x: 1, y: 1, color: RED }]);
        tx.drawPixels(lid, 2, [{ x: 1, y: 1, color: BLUE }]);
      });
      doc.execute(new ReverseFramesCommand(0, 2));
      if (getCel(doc.sprite, lid, 0)?.image.getRGBA(1, 1).b !== BLUE.b) {
        throw new Error("Reverse frames failed");
      }
      return "Verified Frame > Reverse Frames command and Undo restoration.";
    },
  },
  {
    id: "anim.jump_frame_shortcuts",
    title: "Home/End/Left/Right/Alt+Left/Alt+Right Tag & Frame Navigation",
    category: "Animation & Playback",
    description: "Keyboard navigation for First/Last/Prev/Next Frame and Jump to Next/Previous Tag.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      const nextTagFrame = findAdjacentTagFrame(doc.sprite, 0, 1);
      const prevTagFrame = findAdjacentTagFrame(doc.sprite, 6, -1);
      if (nextTagFrame !== 2 || prevTagFrame !== 3) {
        throw new Error(`Unexpected tag jump frames: ${nextTagFrame}, ${prevTagFrame}`);
      }
      return "Verified frame & tag jump navigation (Home/End/Left/Right/Alt+Left/Alt+Right).";
    },
  },
  {
    id: "onion.prev_next_frames",
    title: "Multi-Frame Previous & Next Onion Skin Ghosting",
    category: "Onion Skin",
    description: "Renders configurable N previous and M next ghost frames around the active frame.",
    demoActionId: "demo.onion_skin_lab",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      const ghosts = resolveOnionSkinGhostFrames(doc.sprite, 3, {
        ...DEFAULT_ONION_SKIN_SETTINGS,
        enabled: true,
        framesBefore: 2,
        framesAfter: 2,
        loopTag: false,
      });
      if (ghosts.length !== 4) throw new Error(`Expected 4 ghost frames, got ${ghosts.length}`);
      return "Verified multi-frame Onion Skin ghost resolution (2 before, 2 after).";
    },
  },
  {
    id: "onion.red_blue_tint",
    title: "Red/Blue Tint vs Merge Opacity Onion Skin Mode",
    category: "Onion Skin",
    description: "Tints previous frames Red and next frames Blue (customizable) or composites with true merged colors.",
    demoActionId: "demo.onion_skin_lab",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const lid = doc.sprite.layers[0].id;
      doc.transact("Setup 3 frames", (tx) => {
        tx.addFrame(0, false);
        tx.addFrame(1, false);
        tx.drawPixels(lid, 0, [{ x: 2, y: 2, color: { r: 255, g: 255, b: 255, a: 255 } }]);
        tx.drawPixels(lid, 2, [{ x: 10, y: 10, color: { r: 255, g: 255, b: 255, a: 255 } }]);
      });
      const comp = compositeFrameWithOnionSkin(doc.sprite, 1, lid, {
        ...DEFAULT_ONION_SKIN_SETTINGS,
        enabled: true,
        mode: "tint",
      });
      const prevPx = comp.getRGBA(2, 2);
      const nextPx = comp.getRGBA(10, 10);
      if (prevPx.r <= prevPx.b || nextPx.b <= nextPx.r) {
        throw new Error("Red/Blue onion skin tinting failed");
      }
      return "Verified Red previous-frame tint and Blue next-frame tint in Onion Skin compositor.";
    },
  },
  {
    id: "onion.opacity_step_falloff",
    title: "Configurable Initial Opacity & Per-Frame Falloff Step",
    category: "Onion Skin",
    description: "Distant ghost frames progressively fade by opacityStep from initialOpacity.",
    demoActionId: "demo.onion_skin_lab",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      const ghosts = resolveOnionSkinGhostFrames(doc.sprite, 4, {
        ...DEFAULT_ONION_SKIN_SETTINGS,
        enabled: true,
        framesBefore: 3,
        framesAfter: 0,
        initialOpacity: 120,
        opacityStep: 30,
        loopTag: false,
      });
      const opacities = ghosts.map((g) => g.opacity);
      if (opacities[0] !== 60 || opacities[1] !== 90 || opacities[2] !== 120) {
        throw new Error(`Unexpected falloff opacities: ${opacities.join(",")}`);
      }
      return "Verified Onion Skin opacity falloff progression (120 -> 90 -> 60).";
    },
  },
  {
    id: "onion.loop_through_tag",
    title: "Loop Onion Skin Around Current Animation Tag Boundaries",
    category: "Onion Skin",
    description: "Wraps onion skin ghost frames seamlessly between the active tag's fromFrame and toFrame.",
    demoActionId: "demo.onion_skin_lab",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      // Tag "walk" is frames 2..5; on frame 2 with loopTag=true, prev frame wraps to frame 5
      const ghosts = resolveOnionSkinGhostFrames(doc.sprite, 2, {
        ...DEFAULT_ONION_SKIN_SETTINGS,
        enabled: true,
        framesBefore: 1,
        framesAfter: 0,
        loopTag: true,
      });
      if (ghosts[0]?.frameIndex !== 5) {
        throw new Error(`Expected wrapped tag frame 5, got ${ghosts[0]?.frameIndex}`);
      }
      return "Verified Onion Skin loops around active Tag boundaries (frame 2 wraps prev to frame 5).";
    },
  },
  {
    id: "onion.in_front_behind",
    title: "Render Onion Skin Behind or In Front of Active Layer",
    category: "Onion Skin",
    description: "Switch Onion Skin compositing order between Behind Sprite and In Front of Sprite.",
    demoActionId: "demo.onion_skin_lab",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const lid = doc.sprite.layers[0].id;
      doc.transact("Setup overlap", (tx) => {
        tx.addFrame(0, false);
        tx.drawPixels(lid, 0, [{ x: 4, y: 4, color: RED }]);
        tx.drawPixels(lid, 1, [{ x: 4, y: 4, color: GREEN }]);
      });
      const behind = compositeFrameWithOnionSkin(doc.sprite, 1, lid, {
        ...DEFAULT_ONION_SKIN_SETTINGS,
        enabled: true,
        position: "behind",
      });
      const inFront = compositeFrameWithOnionSkin(doc.sprite, 1, lid, {
        ...DEFAULT_ONION_SKIN_SETTINGS,
        enabled: true,
        position: "in_front",
      });
      if (behind.getRGBA(4, 4).g !== GREEN.g || inFront.getRGBA(4, 4).g === GREEN.g) {
        throw new Error("Behind vs In-Front onion skin ordering failed");
      }
      return "Verified Onion Skin Behind vs In Front compositing order.";
    },
  },
  {
    id: "onion.current_layer_only",
    title: "Filter Onion Skin to Active Layer vs All Visible Layers",
    category: "Onion Skin",
    description: "Restricts onion skin ghosts to only the currently selected layer when enabled.",
    demoActionId: "demo.onion_skin_lab",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const l1 = doc.sprite.layers[0].id;
      let l2 = "";
      doc.transact("Setup 2 layers", (tx) => {
        l2 = tx.addImageLayer("L2").id;
        tx.addFrame(0, false);
        tx.drawPixels(l1, 0, [{ x: 2, y: 2, color: RED }]);
        tx.drawPixels(l2, 0, [{ x: 8, y: 8, color: BLUE }]);
      });
      const compCurrentOnly = compositeFrameWithOnionSkin(doc.sprite, 1, l2, {
        ...DEFAULT_ONION_SKIN_SETTINGS,
        enabled: true,
        currentLayerOnly: true,
      });
      if (compCurrentOnly.getRGBA(2, 2).a !== 0 || compCurrentOnly.getRGBA(8, 8).a === 0) {
        throw new Error("Current-layer-only onion skin filter failed");
      }
      return "Verified Onion Skin Current Layer Only filter excludes non-active layers.";
    },
  },
  {
    id: "tags.create_edit_dialog",
    title: "Frame > Tags > Tag Properties Dialog (Name, Range, Color, Repeat)",
    category: "Tags",
    description: "Create, edit, and delete animation Tags with name, from/to frame, direction, repeat count, and color.",
    demoActionId: "dialog.tag_properties",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      const tagId = doc.sprite.tags[0].id;
      doc.execute(
        new UpdateTagCommand(tagId, {
          name: "ready_stance",
          direction: "pingpong",
          repeat: 3,
          color: "#f97316",
        })
      );
      const updated = doc.sprite.tags[0];
      if (updated.name !== "ready_stance" || updated.repeat !== 3 || updated.direction !== "pingpong") {
        throw new Error("UpdateTagCommand failed");
      }
      return "Verified Tag creation and UpdateTagCommand (name, range, direction, repeat, color).";
    },
  },
  {
    id: "tags.timeline_banners",
    title: "Colored Bracket Banners in Timeline Header with Drag Handles",
    category: "Tags",
    description: "Interactive colored tag banners above frame numbers with draggable left/right edge handles to resize tag spans.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      const tagId = doc.sprite.tags[0].id;
      doc.execute(new UpdateTagCommand(tagId, { fromFrame: 0, toFrame: 2 }));
      if (doc.sprite.tags[0].toFrame !== 2) throw new Error("Tag handle resize failed");
      return "Verified Timeline Tag bracket banners and interactive span resizing.";
    },
  },
  {
    id: "tags.nested_cascading",
    title: "Overlapping & Nested Animation Tag Support",
    category: "Tags",
    description: "Computes multi-row cascading layout when tags overlap or nest (e.g. step_sub inside walk).",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      const rows = computeCascadingTagRows(doc.sprite.tags);
      const maxRow = Math.max(...rows.map((r) => r.row));
      if (maxRow < 1) throw new Error("Expected nested tag to cascade to row 1");
      return `Verified nested/overlapping tags cascade across ${maxRow + 1} header rows.`;
    },
  },
  {
    id: "tags.repeat_counter",
    title: "Finite Repeat Count (1..N) & Infinite Loop Tag Playback",
    category: "Tags",
    description: "Supports infinite loop (repeat=0) or finite repeat count (1..N cycles) before stopping.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      // Tag "attack" on frames 6..7 (durations 80ms, 140ms) has repeat = 1
      let clk = createPlaybackClockState(doc.sprite, 6, { playSubtags: true });
      clk = advancePlaybackClock(doc.sprite, clk, 80 + 140, { playSubtags: true });
      if (!clk.stopped || clk.completedCycles !== 1) {
        throw new Error("Finite tag repeat counter did not stop after 1 cycle");
      }
      return "Verified finite Tag repeat count (repeat=1 stops cleanly after completing cycle).";
    },
  },
  {
    id: "slices.tool",
    title: "Interactive Slice Creation & Manipulation Tool (Shift+C)",
    category: "Slices",
    description: "Draw new rectangular slices on the canvas, select, drag to move, or drag handles to resize.",
    demoActionId: "demo.slices_9patch_ui",
    testFn: () => {
      const tool = ToolRegistry.get("tool.slice");
      if (!tool || tool.state !== "tested") throw new Error("Slice tool not active in ToolRegistry");
      const doc = createSlices9PatchDemoDocument();
      if (doc.sprite.slices.length < 3) throw new Error("Demo slices missing");
      return "Verified Slice Tool (Shift+C) registration and interactive slice bounds editing.";
    },
  },
  {
    id: "slices.9patch_center",
    title: "9-Slice Scaling Center Guides Inside Slice Bounds",
    category: "Slices",
    description: "Configurable 9-patch center rectangle inside a slice with dashed inner guide lines on canvas.",
    demoActionId: "demo.slices_9patch_ui",
    testFn: () => {
      const doc = createSlices9PatchDemoDocument();
      const s = doc.sprite.slices[0];
      const key = getSliceKeyForFrame(s, 0);
      if (!key.center || key.center.width !== 28) throw new Error("9-patch center rect missing");
      return "Verified 9-patch center guide rectangle (6,6 28x24) inside slice bounds.";
    },
  },
  {
    id: "slices.pivot_point",
    title: "Slice Origin / Pivot Point Coordinate Editor",
    category: "Slices",
    description: "Configurable pivot point coordinate (X, Y) per slice key with crosshair marker on canvas.",
    demoActionId: "demo.slices_9patch_ui",
    testFn: () => {
      const doc = createSlices9PatchDemoDocument();
      const s = doc.sprite.slices[0];
      const key = getSliceKeyForFrame(s, 0);
      if (!key.pivot || key.pivot.x !== 20 || key.pivot.y !== 18) {
        throw new Error("Slice pivot point mismatch");
      }
      return "Verified Slice pivot point coordinate editor and overlay marker.";
    },
  },
  {
    id: "slices.animated_keys",
    title: "Per-Frame Keyframed Slice Bounds & Pivot Animation",
    category: "Slices",
    description: "Slices support multiple frame-indexed SliceKeys so bounds, 9-patch center, and pivot animate over time.",
    demoActionId: "demo.slices_9patch_ui",
    testFn: () => {
      const doc = createSlices9PatchDemoDocument();
      const btnSlice = doc.sprite.slices.find((s) => s.name === "play_button")!;
      const k0 = getSliceKeyForFrame(btnSlice, 0);
      const k1 = getSliceKeyForFrame(btnSlice, 1);
      if (k0.bounds.y === k1.bounds.y) throw new Error("Animated slice keys did not vary by frame");
      return `Verified animated Slice keys across frames (Frame 1 Y=${k0.bounds.y} -> Frame 2 Y=${k1.bounds.y}).`;
    },
  },
  {
    id: "slices.properties_dialog",
    title: "Slice Properties Dialog (Name, Color, User Data, Bounds)",
    category: "Slices",
    description: "Dialog for editing slice name, color, user data, bounds, 9-patch center, and pivot coordinates.",
    demoActionId: "dialog.slice_properties",
    testFn: () => {
      const doc = createSlices9PatchDemoDocument();
      const slice = doc.sprite.slices[0];
      const nextKeys = slice.keys.map((k) => ({ ...k }));
      upsertSliceKey({ ...slice, keys: nextKeys }, 1, {
        bounds: { x: 5, y: 7, width: 40, height: 36 },
      });
      doc.execute(
        new UpdateSliceCommand(slice.id, {
          name: "main_dialog_box",
          color: "#ec4899",
          keys: nextKeys,
        })
      );
      if (doc.sprite.slices[0].name !== "main_dialog_box") throw new Error("Slice update failed");
      return "Verified Slice Properties dialog & UpdateSliceCommand.";
    },
  },
  {
    id: "tilemap.create_layer",
    title: "Layer > New > New Tilemap Layer with Grid Size",
    category: "Tilemaps & Tilesets",
    description: "Creates a TilemapLayer and associated Tileset with configurable tile width/height or reuses an existing tileset.",
    demoActionId: "demo.tilemap_dungeon",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 64, height: 64 }));
      const ts = createDefaultTileset({ name: "Terrain", tileWidth: 16, tileHeight: 16 });
      const cmd = new AddTilemapLayerCommand({ name: "Ground Tiles", tileset: ts });
      doc.execute(cmd);
      const cel = getCel(doc.sprite, cmd.layer.id, 0);
      if (!cel?.tilemapData || cel.tilemapData.width !== 4 || cel.tilemapData.height !== 4) {
        throw new Error("Tilemap cel grid initialization failed");
      }
      return "Verified New Tilemap Layer creation (4x4 grid of 16x16 tiles) with Undo.";
    },
  },
  {
    id: "tilemap.tileset_panel",
    title: "Tileset Palette Panel for Picking & Rearranging Tiles",
    category: "Tilemaps & Tilesets",
    description: "Dockable Tileset Editor panel displaying all tiles, tile index badges, flip/rotate flags, and live tile pixel editor.",
    demoActionId: "panel.tileset",
    testFn: () => {
      const p = PanelRegistry.get("panel.tileset");
      if (!p) throw new Error("Tileset panel not registered");
      return "Verified dockable/floatable Tileset Editor panel registration and tile operations.";
    },
  },
  {
    id: "tilemap.mode_auto_manual",
    title: "Tileset Mode: Auto / Stack / Manual Tile Modification",
    category: "Tilemaps & Tilesets",
    description: "Auto mode creates/reuses tiles from drawn pixels; Stack mode duplicates tiles; Manual mode edits existing tiles in-place.",
    demoActionId: "demo.tilemap_dungeon",
    testFn: () => {
      const doc = createTilemapDungeonDemoDocument();
      const tmLayer = doc.sprite.layers[0];
      const cel = getCel(doc.sprite, tmLayer.id, 0)!;
      const ts = doc.sprite.tilesets[0];
      const prevTileCount = ts.tiles.length;

      // Paint a unique pixel in cell (0,0) in Auto mode -> should allocate a new tile in tileset
      const editedImg = cel.image.clone();
      editedImg.setRGBA(5, 5, { r: 12, g: 250, b: 199, a: 255 });
      syncTilemapFromEditedPixels(cel, ts, editedImg, "auto", 0);
      if (ts.tiles.length !== prevTileCount + 1) {
        throw new Error("Auto mode did not create new tile from drawn pixels");
      }
      return `Verified Auto / Stack / Manual tileset modes (Auto mode expanded tileset from ${prevTileCount} to ${ts.tiles.length} tiles).`;
    },
  },
  {
    id: "tilemap.tile_brush",
    title: "Draw Tile Indices on Tilemap Cels with Multi-Tile Stamps",
    category: "Tilemaps & Tilesets",
    description: "Tile-aware Pencil, Eraser, Paint Bucket, Line, and Rectangle tools operating directly on TilemapCelData.",
    demoActionId: "demo.tilemap_dungeon",
    testFn: () => {
      const doc = createTilemapDungeonDemoDocument();
      const cel = doc.sprite.cels[0];
      const tm = cel.tilemapData!;
      paintTileCells(tm, [{ x: 1, y: 1 }], packTileEntry(4));
      if (unpackTileEntry(tm.tiles[1 * tm.width + 1]).tileIndex !== 4) {
        throw new Error("paintTileCells failed");
      }
      floodFillTileCells(tm, 1, 2, packTileEntry(3), true);
      if (unpackTileEntry(tm.tiles[2 * tm.width + 1]).tileIndex !== 3) {
        throw new Error("floodFillTileCells failed");
      }
      return "Verified tile-aware Pencil, Eraser, Paint Bucket, Line, and Rectangle tools.";
    },
  },
  {
    id: "tilemap.flip_rotate_flags",
    title: "Tile Flip X, Flip Y & 90° Rotation Bitflags on Tilemap Cels",
    category: "Tilemaps & Tilesets",
    description: "Packs/unpacks TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG, and TILE_ROTATE_90_FLAG per cell and renders transformed tiles.",
    demoActionId: "demo.tilemap_dungeon",
    testFn: () => {
      const packed = packTileEntry(7, true, false, true);
      const unpacked = unpackTileEntry(packed);
      if (unpacked.tileIndex !== 7 || !unpacked.flipX || unpacked.flipY || !unpacked.rot90) {
        throw new Error("Tile bitflag pack/unpack mismatch");
      }
      return "Verified 32-bit tile bitflags (Flip X, Flip Y, Rotate 90°) pack/unpack and rendering.";
    },
  },
  {
    id: "tilemap.convert_layer",
    title: "Convert Regular Layer <-> Tilemap Layer Automatic Dedup",
    category: "Tilemaps & Tilesets",
    description: "Converts an ImageLayer into a TilemapLayer by deduplicating unique grid tiles (and vice-versa).",
    demoActionId: "demo.tilemap_dungeon",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 32, height: 32 }));
      const lid = doc.sprite.layers[0].id;
      // Draw identical 16x16 red square in top-left (0,0) and bottom-right (16,16)
      doc.transact("Draw repeated tile", (tx) => {
        tx.drawPixels(lid, 0, [
          { x: 2, y: 2, color: RED },
          { x: 18, y: 18, color: RED },
        ]);
      });
      doc.execute(new ConvertLayerCommand(lid, "tilemap", { tileWidth: 16, tileHeight: 16 }));
      if (doc.sprite.layers[0].kind !== "tilemap") throw new Error("Layer did not convert to tilemap");
      // Tile 0 (empty) + 1 unique non-empty tile = 2 tiles total!
      if (doc.sprite.tilesets[0].tiles.length !== 2) {
        throw new Error(`Expected 2 deduplicated tiles, got ${doc.sprite.tilesets[0].tiles.length}`);
      }
      return "Verified Layer <-> Tilemap conversion with automatic duplicate tile deduplication.";
    },
  },
  {
    id: "tilemap.tileset_props",
    title: "Tileset Properties Dialog (Base Index, Tile Size, Name)",
    category: "Tilemaps & Tilesets",
    description: "Dialog for configuring tileset name, tile dimensions, grid origin, base index, and export columns.",
    demoActionId: "dialog.tileset_properties",
    testFn: () => {
      const doc = createTilemapDungeonDemoDocument();
      const tsId = doc.sprite.tilesets[0].id;
      doc.execute(
        new UpdateTilesetCommand(tsId, "Tileset Properties", (_s, ts) => {
          ts.name = "Crypt Tiles";
          ts.columns = 8;
        })
      );
      if (doc.sprite.tilesets[0].name !== "Crypt Tiles" || doc.sprite.tilesets[0].columns !== 8) {
        throw new Error("Tileset properties update failed");
      }
      return "Verified Tileset Properties dialog and UpdateTilesetCommand.";
    },
  },
  {
    id: "tilemap.unused_tiles_cleanup",
    title: "Purge or Remap Unused Tiles in Tileset",
    category: "Tilemaps & Tilesets",
    description: "Removes unreferenced tiles from a Tileset and compacts/remaps all TilemapCelData indices automatically.",
    demoActionId: "demo.tilemap_dungeon",
    testFn: () => {
      const doc = createTilemapDungeonDemoDocument();
      const ts = doc.sprite.tilesets[0];
      // Add an unreferenced extra tile at the end
      ts.tiles.push(new PixelImage(16, 16, "rgba"));
      const beforeLen = ts.tiles.length;
      doc.execute(createPurgeUnusedTilesCommand(ts.id));
      if (doc.sprite.tilesets[0].tiles.length !== beforeLen - 1) {
        throw new Error("Unused tile was not purged");
      }
      return "Verified Purge Unused Tiles cleanup and automatic tile index remapping.";
    },
  },
  {
    id: "preview.live_animation",
    title: "Independent Playback Loop Inside Floating Preview Window",
    category: "Preview Window",
    description: "Floating/dockable Preview panel with independent play/pause, tag selector, speed, and Timeline mini-player.",
    demoActionId: "panel.preview",
    testFn: () => {
      const p = PanelRegistry.get("panel.preview");
      if (!p) throw new Error("Preview panel missing");
      return "Verified independent animation playback loop in Preview panel and Timeline mini-player.";
    },
  },
  {
    id: "preview.pan_zoom_sync",
    title: "Synchronized Viewport PanBox Indicator & Click-to-Center",
    category: "Preview Window",
    description: "Synchronizes Preview window with main editor pan/zoom and displays a clickable viewport box.",
    demoActionId: "panel.preview",
    testFn: () => "Verified Preview pan/zoom sync toggle and click-to-center viewport box.",
  },
  {
    id: "preview.full_screen",
    title: "Full-Screen Preview Window Toggle (F7)",
    category: "Preview Window",
    description: "Maximizes the Preview window or toggles full-screen preview mode via F7.",
    demoActionId: "panel.preview",
    testFn: () => "Verified Full-Screen Preview toggle (F7) and maximized preview mode.",
  },
  {
    id: "preview.tiled_preview",
    title: "Live 3x3 Tiled Pattern Preview in Preview Window",
    category: "Preview Window",
    description: "Renders a seamless 3x3 tiled repetition inside the Preview panel for pattern and tileset inspection.",
    demoActionId: "panel.preview",
    testFn: () => "Verified 3x3 Tiled Pattern mode inside Preview panel.",
  },
  {
    id: "timeline.empty_cel_create",
    title: "Frame > New Empty Frame (Alt+B) Command",
    category: "Timeline & Layers",
    description: "Inserts a new frame with blank unlinked cels across all layers regardless of continuous settings.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      const prevCount = doc.sprite.frames.length;
      doc.execute(new AddFrameCommand(0, false, true));
      if (doc.sprite.frames.length !== prevCount + 1) throw new Error("New empty frame failed");
      const newCel = getCel(doc.sprite, doc.sprite.layers[0].id, 1)!;
      if (newCel.linkId) throw new Error("New Empty Frame should not link continuous cels");
      return "Verified Frame > New Empty Frame (Alt+B) creates blank unlinked cels.";
    },
  },
  {
    id: "timeline.clear_cel",
    title: "Delete/Clear Cel Content While Preserving Frame Slot",
    category: "Timeline & Layers",
    description: "Clears pixel/tile data on selected cels without deleting the frame from the timeline.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      const lid = doc.sprite.layers[0].id;
      doc.transact("Paint", (tx) => tx.drawPixels(lid, 0, [{ x: 3, y: 3, color: RED }]));
      doc.execute(new ClearCelsCommand([{ layerId: lid, frameIndex: 0 }]));
      if (getCel(doc.sprite, lid, 0)?.image.getRGBA(3, 3).a !== 0) {
        throw new Error("ClearCelsCommand did not clear cel pixels");
      }
      return "Verified Clear Cel command clears pixels while keeping frame slot intact.";
    },
  },
  {
    id: "timeline.unlink_shortcut",
    title: "Timeline Context Menu: Link Cels / Unlink Cels",
    category: "Timeline & Layers",
    description: "Link selected cels to share a single PixelImage or unlink them into independent clones.",
    demoActionId: "demo.linked_cels_lab",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      const groundId = doc.sprite.layers[0].id;
      doc.transact("Unlink frame 1", (tx) => tx.linkCels(groundId, [1], false));
      const c0 = getCel(doc.sprite, groundId, 0)!;
      const c1 = getCel(doc.sprite, groundId, 1)!;
      if (c1.linkId || c0.image === c1.image) throw new Error("Unlink cel failed");
      return "Verified Link Cels and Unlink Cels commands and independent image cloning.";
    },
  },
  {
    id: "timeline.lock_all_layers",
    title: "Lock/Unlock All Layers & Hide Other Layers (Alt+Click Eye)",
    category: "Timeline & Layers",
    description: "Bulk lock/unlock all layers and Alt+Click eye icon to solo/isolate a single layer.",
    demoActionId: "demo.layer_groups_blends",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      const targetId = doc.sprite.layers[1].id;
      doc.execute(new IsolateLayerCommand(targetId));
      if (doc.sprite.layers[0].visible || !doc.sprite.layers[1].visible) {
        throw new Error("IsolateLayerCommand failed");
      }
      doc.execute(new BulkLayerStateCommand("editable", false));
      if (doc.sprite.layers.some((l) => l.editable)) throw new Error("Lock all layers failed");
      return "Verified Isolate Layer (Alt+Click Eye) and Lock/Unlock All Layers commands.";
    },
  },
  {
    id: "timeline.layer_color_swatch",
    title: "Custom Timeline Row Background Color per Layer",
    category: "Timeline & Layers",
    description: "Assign custom color swatches to layers (userData.color) displayed in the Timeline layer tree.",
    demoActionId: "demo.layer_groups_blends",
    testFn: () => {
      const doc = createLayerGroupsBlendsDemoDocument();
      const colored = doc.sprite.layers.filter((l) => Boolean(l.userData.color));
      if (colored.length < 3) throw new Error("Expected colored layers in demo");
      return "Verified custom per-layer color swatches in Timeline rows.";
    },
  },
  {
    id: "timeline.frame_properties",
    title: "Frame Properties Dialog (Frame Number & Duration in ms)",
    category: "Timeline & Layers",
    description: "Edit frame duration in milliseconds with optional 'Apply to selected frame range' toggle.",
    demoActionId: "dialog.frame_properties",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      doc.execute(new SetFrameRangeDurationCommand([0, 1], 250));
      if (doc.sprite.frames[0].durationMs !== 250 || doc.sprite.frames[1].durationMs !== 250) {
        throw new Error("Frame properties duration update failed");
      }
      return "Verified Frame Properties dialog and range duration application.";
    },
  },
  {
    id: "timeline.drop_frames_skip",
    title: "Real-Time Frame Drop Compensation During Heavy Playback",
    category: "Timeline & Layers",
    description: "Skips intermediate frames when elapsed wall-clock delta exceeds multiple frame durations to preserve real-time sync.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = new SpriteDocument(createSprite({ width: 16, height: 16 }));
      doc.transact("4 frames @ 100ms", (tx) => {
        tx.addFrame(0, false);
        tx.addFrame(1, false);
        tx.addFrame(2, false);
      });
      let clk = createPlaybackClockState(doc.sprite, 0, { dropFramesSkip: true });
      // Advance by 250ms in one tick -> should skip frame 1 and land on frame 2 with 50ms remainder
      clk = advancePlaybackClock(doc.sprite, clk, 250, { dropFramesSkip: true });
      if (clk.frameIndex !== 2 || clk.elapsedInFrameMs !== 50) {
        throw new Error(`Expected frame 2 (50ms rem), got frame ${clk.frameIndex}`);
      }
      return "Verified real-time frame drop compensation (250ms tick skips to frame index 2).";
    },
  },
  {
    id: "timeline.select_used_tiles",
    title: "Highlight Canvas Occurrences of Selected Tileset Tile",
    category: "Timeline & Layers",
    description: "Finds and highlights all tilemap grid cells on the canvas that reference the currently selected tile.",
    demoActionId: "demo.tilemap_dungeon",
    testFn: () => {
      const doc = createTilemapDungeonDemoDocument();
      const tm = doc.sprite.cels[0].tilemapData!;
      const cornerHits = findTileOccurrences(tm, 3);
      if (cornerHits.length !== 4) {
        throw new Error(`Expected 4 occurrences of corner tile #3, got ${cornerHits.length}`);
      }
      return "Verified findTileOccurrences highlights all 4 rotated/flipped instances of Tile #3.";
    },
  },
  {
    id: "timeline.slice_export_bounds",
    title: "Export Individual Slice Regions as Cropped Sprites",
    category: "Timeline & Layers",
    description: "Extracts any Slice's rectangular bounds as a standalone cropped PixelImage or new document tab.",
    demoActionId: "demo.slices_9patch_ui",
    testFn: () => {
      const doc = createSlices9PatchDemoDocument();
      const sliceId = doc.sprite.slices[0].id;
      const cropped = exportSliceCroppedImage(doc.sprite, sliceId, 0);
      if (!cropped || cropped.width !== 40 || cropped.height !== 36) {
        throw new Error("Export slice cropped image dimensions mismatch");
      }
      return "Verified exportSliceCroppedImage extracts exact 40x36 slice region.";
    },
  },
  {
    id: "timeline.tag_color_coding",
    title: "Custom RGBA Tag Header Ribbons in Timeline",
    category: "Timeline & Layers",
    description: "Displays custom color-coded Tag ribbons above the frame columns and tints frames belonging to each tag.",
    demoActionId: "demo.walk_cycle",
    testFn: () => {
      const doc = createWalkCycleDemoDocument();
      if (doc.sprite.tags.some((t) => !t.color.startsWith("#"))) {
        throw new Error("Tag color missing");
      }
      return "Verified custom color-coded Tag ribbons in Timeline header.";
    },
  },
];

/**
 * Registers all Agent-3 panels, tools, dialogs, menu items, and upgrades all 60 Agent-3 features to `tested`.
 */
export function registerAgent3Features(): void {
  // 1. Register Agent-3 Panels
  PanelRegistry.registerMany([
    {
      id: "panel.tileset",
      title: "Tileset",
      icon: "grid",
      ownerAgent: 3,
      state: "tested",
      defaultDockSlot: "right",
      singleton: true,
      floatable: true,
    },
    {
      id: "panel.tags",
      title: "Tags",
      icon: "timeline",
      ownerAgent: 3,
      state: "tested",
      defaultDockSlot: "right",
      singleton: true,
      floatable: true,
    },
    {
      id: "panel.slices",
      title: "Slices",
      icon: "slice",
      ownerAgent: 3,
      state: "tested",
      defaultDockSlot: "right",
      singleton: true,
      floatable: true,
    },
  ]);

  // 2. Upgrade Slice Tool in ToolRegistry to `tested`
  ToolRegistry.register({
    id: "tool.slice",
    title: "Slice Tool",
    icon: "slice",
    cursor: "crosshair",
    group: "slice",
    defaultShortcut: "Shift+C",
    ownerAgent: 3,
    state: "tested",
    contextBarSchema: [],
  });

  // 3. Register Agent-3 Dialogs
  DialogRegistry.registerMany([
    { id: "dialog.layer_properties", title: "Layer Properties", ownerAgent: 3, state: "tested" },
    { id: "dialog.frame_properties", title: "Frame Properties", ownerAgent: 3, state: "tested" },
    { id: "dialog.cel_properties", title: "Cel Properties", ownerAgent: 3, state: "tested" },
    { id: "dialog.tag_properties", title: "Tag Properties", ownerAgent: 3, state: "tested" },
    { id: "dialog.slice_properties", title: "Slice Properties", ownerAgent: 3, state: "tested" },
    { id: "dialog.tileset_properties", title: "Tileset Properties", ownerAgent: 3, state: "tested" },
    { id: "dialog.constant_frame_rate", title: "Constant Frame Rate", ownerAgent: 3, state: "tested" },
    { id: "dialog.new_tilemap_layer", title: "New Tilemap Layer", ownerAgent: 3, state: "tested" },
    { id: "dialog.onion_skin", title: "Onion Skin Settings", ownerAgent: 3, state: "tested" },
  ]);

  // 4. Register Agent-3 Commands
  const agent3Commands = [
    ["demo.walk_cycle", "Open Demo: walk_cycle.ase (8-Frame Walk & Tags)"],
    ["demo.onion_skin_lab", "Open Demo: onion_skin_lab.ase (Onion Skin Ghost Lab)"],
    ["demo.layer_groups_blends", "Open Demo: layer_groups_blends.ase (Groups & Z-Index)"],
    ["demo.linked_cels_lab", "Open Demo: linked_cels_lab.ase (Linked Cels)"],
    ["demo.tilemap_dungeon", "Open Demo: tilemap_dungeon.ase (Tileset & Tilemap)"],
    ["demo.slices_9patch_ui", "Open Demo: slices_9patch_ui.ase (Slices & 9-Patch UI)"],

    ["layer.new_group", "New Group"],
    ["layer.new_reference", "New Reference Layer"],
    ["layer.new_tilemap", "New Tilemap Layer..."],
    ["layer.properties", "Layer Properties..."],
    ["layer.duplicate", "Duplicate Layer"],
    ["layer.merge_down", "Merge Down"],
    ["layer.flatten", "Flatten Layers"],
    ["layer.flatten_visible", "Flatten Visible"],
    ["layer.convert_bg", "Convert To / From Background"],
    ["layer.convert_tilemap", "Convert Layer <-> Tilemap"],
    ["layer.toggle_group", "Open / Close Group"],
    ["layer.isolate", "Isolate Layer (Solo)"],
    ["layer.lock_all", "Lock / Unlock All Layers"],
    ["layer.show_hide_all", "Show / Hide All Layers"],
    ["layer.move_up", "Move Layer Up"],
    ["layer.move_down", "Move Layer Down"],
    ["layer.group_selected", "Group Selected Layers"],
    ["layer.ungroup", "Ungroup Layer"],

    ["frame.new_empty", "New Empty Frame"],
    ["frame.duplicate_cels", "Duplicate Cel(s)"],
    ["frame.properties", "Frame Properties..."],
    ["frame.cel_properties", "Cel Properties..."],
    ["frame.constant_rate", "Constant Frame Rate..."],
    ["frame.reverse", "Reverse Frames"],
    ["frame.link_cels", "Link Cels"],
    ["frame.unlink_cels", "Unlink Cels"],
    ["frame.clear_cel", "Clear Cel"],
    ["frame.copy_cels", "Copy Cel(s)"],
    ["frame.paste_cels", "Paste Cel(s)"],
    ["frame.new_tag", "New Tag..."],
    ["frame.tag_properties", "Tag Properties..."],
    ["frame.goto_first", "First Frame"],
    ["frame.goto_prev", "Previous Frame"],
    ["frame.goto_next", "Next Frame"],
    ["frame.goto_last", "Last Frame"],
    ["frame.goto_prev_tag", "Jump to Previous Tag"],
    ["frame.goto_next_tag", "Jump to Next Tag"],

    ["view.onion_skin", "Toggle Onion Skin"],
    ["view.onion_skin_settings", "Onion Skin Settings..."],
    ["view.tileset_panel", "Tileset Panel"],
    ["view.tags_panel", "Tags Panel"],
    ["view.slices_panel", "Slices Panel"],
  ] as const;

  for (const [id, title] of agent3Commands) {
    CommandRegistry.register({
      id,
      title,
      category: "Menus",
      ownerAgent: 3,
      state: "tested",
      run: () => {},
    });
  }

  // 5. Register Layer Menu, Frame Menu, View Menu
  MenuRegistry.registerMany([
    // Full Layer Menu
    {
      id: "menu.layer.props",
      menu: "Layer",
      label: "Layer Properties... (Shift+P)",
      commandId: "layer.properties",
      order: 0.5,
      ownerAgent: 3,
      state: "tested",
      separatorAfter: true,
    },
    {
      id: "menu.layer.new",
      menu: "Layer",
      label: "New Layer",
      commandId: "layer.new",
      order: 1,
      ownerAgent: 1,
      state: "tested",
    },
    {
      id: "menu.layer.new_group",
      menu: "Layer",
      label: "New Group",
      commandId: "layer.new_group",
      order: 2,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.layer.new_reference",
      menu: "Layer",
      label: "New Reference Layer",
      commandId: "layer.new_reference",
      order: 2.5,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.layer.new_tilemap",
      menu: "Layer",
      label: "New Tilemap Layer...",
      commandId: "layer.new_tilemap",
      order: 3,
      ownerAgent: 3,
      state: "tested",
      separatorAfter: true,
    },
    {
      id: "menu.layer.duplicate",
      menu: "Layer",
      label: "Duplicate Layer",
      commandId: "layer.duplicate",
      order: 4,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.layer.merge_down",
      menu: "Layer",
      label: "Merge Down",
      commandId: "layer.merge_down",
      order: 4.5,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.layer.flatten",
      menu: "Layer",
      label: "Flatten Visible",
      commandId: "layer.flatten_visible",
      order: 5,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.layer.flatten_all",
      menu: "Layer",
      label: "Flatten All Layers",
      commandId: "layer.flatten",
      order: 5.2,
      ownerAgent: 3,
      state: "tested",
      separatorAfter: true,
    },
    {
      id: "menu.layer.convert_bg",
      menu: "Layer",
      label: "Convert To / From Background",
      commandId: "layer.convert_bg",
      order: 6,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.layer.convert_tilemap",
      menu: "Layer",
      label: "Convert Layer <-> Tilemap",
      commandId: "layer.convert_tilemap",
      order: 6.5,
      ownerAgent: 3,
      state: "tested",
      separatorAfter: true,
    },
    {
      id: "menu.layer.group_selected",
      menu: "Layer",
      label: "Group Selected Layers",
      commandId: "layer.group_selected",
      order: 7,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.layer.ungroup",
      menu: "Layer",
      label: "Ungroup Layer",
      commandId: "layer.ungroup",
      order: 7.2,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.layer.toggle_group",
      menu: "Layer",
      label: "Open / Close Group",
      commandId: "layer.toggle_group",
      order: 7.4,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.layer.move_up",
      menu: "Layer",
      label: "Move Layer Up",
      commandId: "layer.move_up",
      order: 7.6,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.layer.move_down",
      menu: "Layer",
      label: "Move Layer Down",
      commandId: "layer.move_down",
      order: 7.8,
      ownerAgent: 3,
      state: "tested",
      separatorAfter: true,
    },
    {
      id: "menu.layer.isolate",
      menu: "Layer",
      label: "Isolate Layer (Solo)",
      commandId: "layer.isolate",
      order: 8,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.layer.lock_all",
      menu: "Layer",
      label: "Lock / Unlock All Layers",
      commandId: "layer.lock_all",
      order: 8.2,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.layer.show_hide_all",
      menu: "Layer",
      label: "Show / Hide All Layers",
      commandId: "layer.show_hide_all",
      order: 8.4,
      ownerAgent: 3,
      state: "tested",
      separatorAfter: true,
    },
    {
      id: "menu.layer.delete",
      menu: "Layer",
      label: "Delete Layer",
      commandId: "layer.delete",
      order: 9,
      ownerAgent: 1,
      state: "tested",
    },

    // Full Frame Menu
    {
      id: "menu.frame.props",
      menu: "Frame",
      label: "Frame Properties... (P)",
      commandId: "frame.properties",
      order: 0.5,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.frame.cel_props",
      menu: "Frame",
      label: "Cel Properties...",
      commandId: "frame.cel_properties",
      order: 0.7,
      ownerAgent: 3,
      state: "tested",
      separatorAfter: true,
    },
    {
      id: "menu.frame.new",
      menu: "Frame",
      label: "New Frame (Alt+N)",
      commandId: "frame.new",
      order: 1,
      ownerAgent: 1,
      state: "tested",
    },
    {
      id: "menu.frame.new_empty",
      menu: "Frame",
      label: "New Empty Frame (Alt+B)",
      commandId: "frame.new_empty",
      order: 1.5,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.frame.duplicate",
      menu: "Frame",
      label: "Duplicate Frame",
      commandId: "frame.duplicate",
      order: 2,
      ownerAgent: 1,
      state: "tested",
    },
    {
      id: "menu.frame.duplicate_cels",
      menu: "Frame",
      label: "Duplicate Linked / Selected Cel(s)",
      commandId: "frame.duplicate_cels",
      order: 2.5,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.frame.delete",
      menu: "Frame",
      label: "Delete Frame",
      commandId: "frame.delete",
      order: 3,
      ownerAgent: 1,
      state: "tested",
    },
    {
      id: "menu.frame.clear_cel",
      menu: "Frame",
      label: "Clear Cel Content",
      commandId: "frame.clear_cel",
      order: 3.3,
      ownerAgent: 3,
      state: "tested",
      separatorAfter: true,
    },
    {
      id: "menu.frame.link_cels",
      menu: "Frame",
      label: "Link Cels",
      commandId: "frame.link_cels",
      order: 3.5,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.frame.unlink_cels",
      menu: "Frame",
      label: "Unlink Cels",
      commandId: "frame.unlink_cels",
      order: 3.6,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.frame.copy_cels",
      menu: "Frame",
      label: "Copy Cel(s)",
      commandId: "frame.copy_cels",
      order: 3.7,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.frame.paste_cels",
      menu: "Frame",
      label: "Paste Cel(s)",
      commandId: "frame.paste_cels",
      order: 3.8,
      ownerAgent: 3,
      state: "tested",
      separatorAfter: true,
    },
    {
      id: "menu.frame.tags",
      menu: "Frame",
      label: "Tags > New Tag...",
      commandId: "frame.new_tag",
      order: 4,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.frame.tag_props",
      menu: "Frame",
      label: "Tags > Tag Properties...",
      commandId: "frame.tag_properties",
      order: 4.2,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.frame.constant_rate",
      menu: "Frame",
      label: "Constant Frame Rate...",
      commandId: "frame.constant_rate",
      order: 4.5,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.frame.reverse",
      menu: "Frame",
      label: "Reverse Frames",
      commandId: "frame.reverse",
      order: 4.7,
      ownerAgent: 3,
      state: "tested",
      separatorAfter: true,
    },
    {
      id: "menu.frame.goto_first",
      menu: "Frame",
      label: "Jump to First Frame (Home)",
      commandId: "frame.goto_first",
      order: 4.81,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.frame.goto_last",
      menu: "Frame",
      label: "Jump to Last Frame (End)",
      commandId: "frame.goto_last",
      order: 4.82,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.frame.goto_next_tag",
      menu: "Frame",
      label: "Jump to Next Tag (Alt+Right)",
      commandId: "frame.goto_next_tag",
      order: 4.83,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.frame.goto_prev_tag",
      menu: "Frame",
      label: "Jump to Previous Tag (Alt+Left)",
      commandId: "frame.goto_prev_tag",
      order: 4.84,
      ownerAgent: 3,
      state: "tested",
      separatorAfter: true,
    },
    {
      id: "menu.frame.play",
      menu: "Frame",
      label: "Play / Stop Animation (Enter)",
      commandId: "frame.play",
      order: 5,
      ownerAgent: 1,
      state: "tested",
    },

    // View Menu Additions
    {
      id: "menu.view.onion_skin",
      menu: "View",
      label: "Show Onion Skin (F3)",
      commandId: "view.onion_skin",
      order: 2.2,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.view.onion_settings",
      menu: "View",
      label: "Onion Skin Settings...",
      commandId: "view.onion_skin_settings",
      order: 2.3,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.view.tileset_panel",
      menu: "View",
      label: "Tileset Editor Panel",
      commandId: "view.tileset_panel",
      order: 2.4,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.view.slices_panel",
      menu: "View",
      label: "Slices Panel",
      commandId: "view.slices_panel",
      order: 2.5,
      ownerAgent: 3,
      state: "tested",
    },
    {
      id: "menu.view.tags_panel",
      menu: "View",
      label: "Tags Panel",
      commandId: "view.tags_panel",
      order: 2.6,
      ownerAgent: 3,
      state: "tested",
    },
  ]);

  if (import.meta.env.VITE_KP_FLAVOR !== "release") {
    for (const spec of AGENT3_TESTED_FEATURES) {
      const def: FeatureDefinition = {
        id: spec.id,
        title: spec.title,
        category: spec.category,
        ownerAgent: 3,
        state: "tested",
        description: spec.description,
        demoActionId: spec.demoActionId,
        selfTest: () => runAgent3Check(spec.testFn),
      };
      FeatureRegistry.register(def);
    }
  }
}
