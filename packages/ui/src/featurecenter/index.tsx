/**
 * @module @kekenik/ui/featurecenter
 * Feature Center modal (with live self-tests and "Show me" triggers) and all application dialogs.
 */

import React, { useMemo, useState } from "react";
import {
  AgentNumber,
  ColorMode,
  CropOrCanvasSizeCommand,
  defaultKeymap,
  detectKeymapConflicts,
  FeatureDefinition,
  FeatureRegistry,
  FeatureState,
  getPlatform,
  KeymapCategory,
  LocaleCode,
  normalizeKeyChord,
  SelfTestResult,
  t,
  ThemeId,
  ThemeRegistry,
  TransformSpriteOrCelCommand,
  UIScale,
  SampleProjectRegistry,
} from "../../../core/src/index.ts";
import { CursorStyleMode, useAppStore } from "../app/store.ts";
import { REPOSITORY_ISSUES_URL, REPOSITORY_URL, openExternalUrl } from "../app/external-links.ts";
import {
  ExtensionsManagerDialog,
  ExtensionsManagerPanel,
} from "../panels/extensions/index.tsx";
import {
  ScriptCustomDialog,
  ScriptPermissionDialog,
} from "../panels/scripts/index.tsx";
import { KekenikAppIcon, KEKENIK_APP_VERSION, PixelIcon } from "../skin/index.tsx";
import {
  ColorInputField,
  NumberField,
  PixelButton,
  PixelCheckbox,
  PixelDialog,
  PixelRadioGroup,
  PixelSelect,
  PixelTabs,
  SectionDivider,
  TextField,
} from "../widgets/index.tsx";
import {
  CelPropertiesDialog,
  ConstantFrameRateDialog,
  FramePropertiesDialog,
  LayerPropertiesDialog,
  NewTilemapLayerDialog,
  OnionSkinSettingsDialog,
  SlicePropertiesDialog,
  TagPropertiesDialog,
  TilesetPropertiesDialog,
} from "./agent3-dialogs.tsx";
import {
  ColorModeDialog,
  ColorRangeDialog,
  DuplicateSpriteDialog,
  FilterStudioDialog,
  PaletteEditorDialog,
  PasteSpecialDialog,
  RotateAngleDialog,
  SavedMasksDialog,
  SelectModifyDialog,
  ShiftPixelsDialog,
  SpritePropertiesDialog,
} from "./agent4-dialogs.tsx";

export {
  CelPropertiesDialog,
  ColorModeDialog,
  ColorRangeDialog,
  ConstantFrameRateDialog,
  DuplicateSpriteDialog,
  FilterStudioDialog,
  FramePropertiesDialog,
  LayerPropertiesDialog,
  NewTilemapLayerDialog,
  OnionSkinSettingsDialog,
  PaletteEditorDialog,
  PasteSpecialDialog,
  RotateAngleDialog,
  SavedMasksDialog,
  SelectModifyDialog,
  ShiftPixelsDialog,
  SlicePropertiesDialog,
  ExtensionsManagerDialog,
  ScriptCustomDialog,
  ScriptPermissionDialog,
  SpritePropertiesDialog,
  TagPropertiesDialog,
  TilesetPropertiesDialog,
};

/**
 * 1. Feature Center Dialog (`Help > Feature Center`)
 */
/** Maps a legacy demo action id to the id of the sample project that contains it. */
export function sampleIdForDemo(demoActionId: string): string {
  if (demoActionId.startsWith("sample.")) return demoActionId;
  const direct = `sample.demo_${demoActionId.replace(/^demo\./, "")}`;
  if (SampleProjectRegistry.has(direct)) return direct;
  if (/tilemap/.test(demoActionId)) return "sample.tilemap";
  if (/slices/.test(demoActionId)) return "sample.slices";
  if (/walk|onion|layer_groups|linked/.test(demoActionId)) return "sample.multilayer";
  if (/indexed|palette/.test(demoActionId)) return "sample.indexed";
  return "sample.basic";
}

export const FeatureCenterDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const openDemoDocument = useAppStore((s) => s.openDemoDocument);
  const openDialog = useAppStore((s) => s.openDialog);
  const setActiveDockTab = useAppStore((s) => s.setActiveDockTab);
  const togglePanelFloating = useAppStore((s) => s.togglePanelFloating);

  const [agentFilter, setAgentFilter] = useState<"all" | AgentNumber>("all");
  const [stateFilter, setStateFilter] = useState<"all" | FeatureState>("all");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Record<string, SelfTestResult>>({});

  const allFeatures = useMemo(() => FeatureRegistry.getAll(), []);

  const filtered = useMemo(() => {
    return allFeatures.filter((f) => {
      if (agentFilter !== "all" && f.ownerAgent !== agentFilter) return false;
      if (stateFilter !== "all" && f.state !== stateFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          f.title.toLowerCase().includes(q) ||
          f.id.toLowerCase().includes(q) ||
          f.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allFeatures, agentFilter, stateFilter, search]);

  const runSingleTest = async (feat: FeatureDefinition) => {
    const res = await feat.selfTest();
    setResults((prev) => ({ ...prev, [feat.id]: res }));
  };

  const runAllTestedFeatures = async () => {
    const next: Record<string, SelfTestResult> = { ...results };
    for (const f of allFeatures.filter((item) => item.state === "tested")) {
      next[f.id] = await f.selfTest();
    }
    setResults(next);
  };

  const runAgent2Tests = async () => {
    const next: Record<string, SelfTestResult> = { ...results };
    for (const f of allFeatures.filter((item) => item.ownerAgent === 2)) {
      next[f.id] = await f.selfTest();
    }
    setResults(next);
  };

  const runAgent3Tests = async () => {
    const next: Record<string, SelfTestResult> = { ...results };
    for (const f of allFeatures.filter((item) => item.ownerAgent === 3)) {
      next[f.id] = await f.selfTest();
    }
    setResults(next);
  };

  const runAgent4Tests = async () => {
    const next: Record<string, SelfTestResult> = { ...results };
    for (const f of allFeatures.filter((item) => item.ownerAgent === 4)) {
      next[f.id] = await f.selfTest();
    }
    setResults(next);
  };

  const runAgent5Tests = async () => {
    const next: Record<string, SelfTestResult> = { ...results };
    for (const f of allFeatures.filter((item) => item.ownerAgent === 5)) {
      next[f.id] = await f.selfTest();
    }
    setResults(next);
  };

  const handleShowMe = (demoActionId?: string) => {
    if (!demoActionId) return;
    if (demoActionId.startsWith("demo.") || demoActionId.startsWith("sample.")) {
      // Never open a raw document silently: reveal File > Open Sample Project > <entry> and activate it.
      useAppStore.getState().revealSampleEntry(sampleIdForDemo(demoActionId));
      onClose();
      return;
    }
    if (demoActionId === "demo.hero_knight") {
      openDemoDocument("antihero");
      onClose();
    } else if (demoActionId === "demo.indexed_palette") {
      openDemoDocument("slime");
      onClose();
    } else if (demoActionId === "demo.blend_showcase") {
      openDemoDocument("blend");
      onClose();
    } else if (demoActionId === "demo.brush_showcase") {
      openDemoDocument("brush_showcase");
      onClose();
    } else if (demoActionId === "demo.symmetry_playground") {
      openDemoDocument("symmetry_playground");
      onClose();
    } else if (demoActionId === "demo.dithering_gradients") {
      openDemoDocument("dithering_gradients");
      onClose();
    } else if (demoActionId === "demo.shapes_fills") {
      openDemoDocument("shapes_fills");
      onClose();
    } else if (demoActionId === "demo.tiled_pattern") {
      openDemoDocument("tiled_pattern");
      onClose();
    } else if (demoActionId === "demo.walk_cycle") {
      openDemoDocument("walk_cycle");
      onClose();
    } else if (demoActionId === "demo.onion_skin_lab") {
      openDemoDocument("onion_skin_lab");
      onClose();
    } else if (demoActionId === "demo.layer_groups_blends") {
      openDemoDocument("layer_groups_blends");
      onClose();
    } else if (demoActionId === "demo.linked_cels_lab") {
      openDemoDocument("linked_cels_lab");
      onClose();
    } else if (demoActionId === "demo.tilemap_dungeon") {
      openDemoDocument("tilemap_dungeon");
      onClose();
    } else if (demoActionId === "demo.slices_9patch_ui") {
      openDemoDocument("slices_9patch_ui");
      onClose();
    } else if (demoActionId === "demo.selection_playground") {
      openDemoDocument("selection_playground");
      onClose();
    } else if (demoActionId === "demo.transform_rotsprite_lab") {
      openDemoDocument("transform_rotsprite_lab");
      onClose();
    } else if (demoActionId === "demo.palette_remap_lab") {
      openDemoDocument("palette_remap_lab");
      onClose();
    } else if (demoActionId === "demo.indexed_dither_compare") {
      openDemoDocument("indexed_dither_compare");
      onClose();
    } else if (demoActionId === "demo.filters_gallery") {
      openDemoDocument("filters_gallery");
      onClose();
    } else if (demoActionId === "panel.history") {
      setActiveDockTab("right", "panel.history");
      onClose();
    } else if (demoActionId === "panel.brushes") {
      setActiveDockTab("right", "panel.brushes");
      onClose();
    } else if (demoActionId === "panel.brush_preview") {
      setActiveDockTab("right", "panel.brush_preview");
      onClose();
    } else if (demoActionId === "panel.tileset") {
      setActiveDockTab("right", "panel.tileset");
      onClose();
    } else if (demoActionId === "panel.tags") {
      setActiveDockTab("right", "panel.tags");
      onClose();
    } else if (demoActionId === "panel.slices") {
      setActiveDockTab("right", "panel.slices");
      onClose();
    } else if (demoActionId === "panel.script_editor") {
      setActiveDockTab("right", "panel.script_editor");
      onClose();
    } else if (demoActionId === "panel.extensions") {
      setActiveDockTab("right", "panel.extensions");
      onClose();
    } else if (demoActionId === "panel.preview") {
      togglePanelFloating("panel.preview");
      onClose();
    } else if (demoActionId.startsWith("dialog.")) {
      openDialog(demoActionId as Parameters<typeof openDialog>[0]);
    }
  };

  const testedCount = allFeatures.filter((f) => f.state === "tested").length;
  const agent2Count = allFeatures.filter((f) => f.ownerAgent === 2).length;
  const agent3Count = allFeatures.filter((f) => f.ownerAgent === 3).length;
  const agent4Count = allFeatures.filter((f) => f.ownerAgent === 4).length;
  const agent5Count = allFeatures.filter((f) => f.ownerAgent === 5).length;
  const passCount = Object.values(results).filter((r) => r.passed).length;

  return (
    <PixelDialog
      title={`Feature Center — ${allFeatures.length} Registered Features (${testedCount} Tested)`}
      onClose={onClose}
      widthClass="w-[880px]"
    >
      <div className="flex flex-col gap-2.5">
        {/* Top Summary & Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-black/10 border border-black/30">
          <div className="space-y-0.5">
            <div className="font-bold">
              Master Catalog: {allFeatures.length} features (Agents 1–5: {testedCount} tested, Agent 6:{" "}
              {allFeatures.length - testedCount} planned)
            </div>
            <div className="text-[11px] opacity-80">
              Click &quot;Run Agent 5 ({agent5Count})&quot; or &quot;Run All Tested ({testedCount})&quot; to execute live self-tests.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <PixelButton onClick={() => void runAgent2Tests()}>
              <PixelIcon name="check" size={12} />
              Run Agent 2 ({agent2Count})
            </PixelButton>
            <PixelButton onClick={() => void runAgent3Tests()}>
              <PixelIcon name="check" size={12} />
              Run Agent 3 ({agent3Count})
            </PixelButton>
            <PixelButton onClick={() => void runAgent4Tests()}>
              <PixelIcon name="check" size={12} />
              Run Agent 4 ({agent4Count})
            </PixelButton>
            <PixelButton onClick={() => void runAgent5Tests()}>
              <PixelIcon name="check" size={12} />
              Run Agent 5 ({agent5Count})
            </PixelButton>
            <PixelButton onClick={() => void runAllTestedFeatures()}>
              <PixelIcon name="check" size={12} />
              Run All Tested ({passCount}/{testedCount} PASS)
            </PixelButton>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {(["all", 1, 2, 3, 4, 5, 6] as const).map((ag) => (
              <PixelButton
                key={String(ag)}
                size="xs"
                active={agentFilter === ag}
                onClick={() => setAgentFilter(ag)}
              >
                {ag === "all" ? `All (${allFeatures.length})` : `Agent ${ag}`}
              </PixelButton>
            ))}
          </div>

          <div className="flex items-center gap-1">
            {(["all", "tested", "implemented", "planned"] as const).map((st) => (
              <PixelButton
                key={st}
                size="xs"
                active={stateFilter === st}
                onClick={() => setStateFilter(st)}
              >
                {st.toUpperCase()}
              </PixelButton>
            ))}
          </div>

          <TextField
            value={search}
            onChange={setSearch}
            placeholder="Search 261 features..."
            className="w-48"
          />
        </div>

        {/* Feature Table */}
        <div className="h-[360px] kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] overflow-y-auto">
          <table className="w-full text-left border-collapse text-[11px] font-mono">
            <thead className="sticky top-0 bg-[var(--kpx-header-bg)] text-white">
              <tr>
                <th className="p-1.5 border-b border-black">ID & Title</th>
                <th className="p-1.5 border-b border-black w-20">Agent</th>
                <th className="p-1.5 border-b border-black w-24">State</th>
                <th className="p-1.5 border-b border-black w-48">Actions / Self-Test Result</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((feat) => {
                const res = results[feat.id];
                return (
                  <tr
                    key={feat.id}
                    className="border-b border-black/15 hover:bg-black/5 align-top"
                  >
                    <td className="p-1.5">
                      <div className="font-bold">{feat.title}</div>
                      <div className="text-[10px] opacity-70">
                        [{feat.category}] {feat.id} — {feat.description}
                      </div>
                      {res && (
                        <div
                          className={`mt-1 text-[10px] font-bold ${
                            res.passed ? "text-emerald-700" : "text-red-600"
                          }`}
                        >
                          {res.passed ? "PASS" : "FAIL"} ({res.durationMs}ms): {res.message}
                        </div>
                      )}
                    </td>
                    <td className="p-1.5 font-bold">Agent {feat.ownerAgent}</td>
                    <td className="p-1.5">
                      <span
                        className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                          feat.state === "tested"
                            ? "bg-emerald-700 text-white"
                            : feat.state === "implemented"
                            ? "bg-sky-700 text-white"
                            : "bg-zinc-300 text-zinc-800"
                        }`}
                      >
                        {feat.state.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-1.5">
                      <div className="flex items-center gap-1">
                        <PixelButton
                          size="xs"
                          onClick={() => void runSingleTest(feat)}
                        >
                          Run self-test
                        </PixelButton>
                        {feat.demoActionId && (
                          <PixelButton
                            size="xs"
                            onClick={() => handleShowMe(feat.demoActionId)}
                          >
                            Show me
                          </PixelButton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <PixelButton onClick={onClose}>{t("common.close")}</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 2. New Sprite Dialog + Companion Canvas Presets Window (matching Screenshot 4)
 */
export const NewSpriteDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const createNewDocument = useAppStore((s) => s.createNewDocument);

  const [width, setWidth] = useState(64);
  const [height, setHeight] = useState(64);
  const [colorMode, setColorMode] = useState<ColorMode>("rgba");
  const [background, setBackground] = useState<"transparent" | "white" | "black">("transparent");
  const [advanced, setAdvanced] = useState(false);
  const [pixelRatio, setPixelRatio] = useState("1:1");
  const [preset, setPreset] = useState("64x64");

  const applyPreset = (val: string) => {
    setPreset(val);
    const [w, h] = val.split("x").map((n) => parseInt(n, 10));
    if (w && h) {
      setWidth(w);
      setHeight(h);
    }
  };

  const handleCreate = () => {
    const ratio =
      pixelRatio === "2:1"
        ? { w: 2, h: 1 }
        : pixelRatio === "1:2"
        ? { w: 1, h: 2 }
        : { w: 1, h: 1 };
    createNewDocument({
      name: `Sprite-${width}x${height}.ase`,
      width,
      height,
      colorMode,
      background,
      pixelRatio: ratio,
    });
    onClose();
  };

  const companionPresetsWindow = (
    <div className="kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] w-[330px] shadow-xl">
      <div className="flex items-center justify-between px-2 py-0.5 bg-[var(--kpx-header-bg)] text-white text-xs font-mono font-bold border-b border-black">
        <span>{t("dialog.canvas_presets")}</span>
        <PixelIcon name="close" size={10} />
      </div>
      <div className="p-2 flex items-center justify-around">
        <PixelRadioGroup
          value={preset}
          onChange={applyPreset}
          options={[
            { value: "64x64", label: "64x64" },
            { value: "96x96", label: "96x96" },
            { value: "214x120", label: "214x120" },
            { value: "240x135", label: "240x135" },
          ]}
        />
      </div>
    </div>
  );

  return (
    <PixelDialog
      title={t("dialog.new_sprite")}
      onClose={onClose}
      widthClass="w-[295px]"
      companionTop={companionPresetsWindow}
    >
      <div className="space-y-2.5">
        <SectionDivider label="Size:" />
        <div className="space-y-1.5 pl-1">
          <div className="flex items-center justify-between">
            <span>{t("common.width")}</span>
            <NumberField
              ariaLabel="New Sprite Width"
              value={width}
              onChange={setWidth}
              suffix="px"
              widthClass="w-36"
            />
          </div>
          <div className="flex items-center justify-between">
            <span>{t("common.height")}</span>
            <NumberField
              ariaLabel="New Sprite Height"
              value={height}
              onChange={setHeight}
              suffix="px"
              widthClass="w-36"
            />
          </div>
        </div>

        <SectionDivider label="Color Mode:" />
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              { id: "rgba", label: "RGBA", icon: "rgb_circles" },
              { id: "grayscale", label: "Grayscale", icon: "grayscale_bar" },
              { id: "indexed", label: "Indexed", icon: "indexed_grid" },
            ] as const
          ).map((item) => {
            const active = colorMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setColorMode(item.id)}
                className={`p-2 flex flex-col items-center gap-1.5 font-mono text-xs ${
                  active
                    ? "kpx-bevel-inset bg-white text-black font-bold"
                    : "kpx-bevel-outset bg-[var(--kpx-btn-bg)] text-black"
                }`}
              >
                <span>{item.label}</span>
                <PixelIcon name={item.icon} size={20} />
              </button>
            );
          })}
        </div>

        <SectionDivider label="Background:" />
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              { id: "transparent", label: "Transparent" },
              { id: "white", label: "White" },
              { id: "black", label: "Black" },
            ] as const
          ).map((bg) => {
            const active = background === bg.id;
            return (
              <button
                key={bg.id}
                type="button"
                onClick={() => setBackground(bg.id)}
                className={`p-2 flex flex-col items-center gap-1.5 font-mono text-xs ${
                  active
                    ? "kpx-bevel-inset bg-white text-black font-bold"
                    : "kpx-bevel-outset bg-[var(--kpx-btn-bg)] text-black"
                }`}
              >
                <span>{bg.label}</span>
                {bg.id === "transparent" ? (
                  <PixelIcon name="checker_tile" size={18} />
                ) : (
                  <span
                    className={`w-4 h-4 border border-black ${
                      bg.id === "white" ? "bg-white" : "bg-black"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="pt-1">
          <PixelCheckbox
            checked={advanced}
            onChange={setAdvanced}
            label="Advanced Options"
          />
        </div>

        {advanced && (
          <div className="p-2 bg-black/10 border border-black/25 space-y-1.5">
            <div className="flex items-center justify-between">
              <span>Pixel Ratio:</span>
              <PixelSelect
                value={pixelRatio}
                onChange={setPixelRatio}
                options={[
                  { value: "1:1", label: "Square (1:1)" },
                  { value: "2:1", label: "Double-wide (2:1)" },
                  { value: "1:2", label: "Double-high (1:2)" },
                ]}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <PixelButton onClick={handleCreate} className="flex-1 py-1 font-bold">
            {t("common.ok")}
          </PixelButton>
          <PixelButton onClick={onClose} className="flex-1 py-1">
            {t("common.cancel")}
          </PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 3. Sprite Size (Nearest / Scale2x / Eagle / Bilinear) & Canvas Size (9-Point Anchor) Dialog
 */
export const SpriteResizeDialog: React.FC<{
  scaleContent: boolean;
  onClose: () => void;
}> = ({ scaleContent, onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const origW = doc?.sprite.width ?? 64;
  const origH = doc?.sprite.height ?? 64;
  const [width, setWidth] = useState(origW);
  const [height, setHeight] = useState(origH);
  const [method, setMethod] = useState<"nearest" | "scale2x" | "eagle" | "bilinear">("nearest");
  const [anchor, setAnchor] = useState<{ ax: 0 | 1 | 2; ay: 0 | 1 | 2 }>({ ax: 1, ay: 1 });

  const handleApply = () => {
    if (doc) {
      if (scaleContent) {
        doc.execute(
          new TransformSpriteOrCelCommand({
            label: `Sprite Size (${width}x${height}, ${method})`,
            scope: "sprite",
            layerId: activeLayerId,
            frameIndex: activeFrameIndex,
            op: {
              kind: "scale",
              width,
              height,
              algorithm: method,
            },
          })
        );
      } else {
        const dw = width - origW;
        const dh = height - origH;
        const offsetX = anchor.ax === 0 ? 0 : anchor.ax === 1 ? Math.round(dw / 2) : dw;
        const offsetY = anchor.ay === 0 ? 0 : anchor.ay === 1 ? Math.round(dh / 2) : dh;
        doc.execute(
          new CropOrCanvasSizeCommand({
            label: `Canvas Size (${width}x${height})`,
            newWidth: width,
            newHeight: height,
            offsetX,
            offsetY,
          })
        );
      }
      bumpRevision();
    }
    onClose();
  };

  return (
    <PixelDialog
      title={scaleContent ? t("dialog.sprite_size") : t("dialog.canvas_size")}
      onClose={onClose}
      widthClass="w-[340px]"
    >
      <div className="space-y-2.5">
        <SectionDivider label={scaleContent ? "Scale Dimensions:" : "Canvas Bounds:"} />
        <div className="flex items-center justify-between">
          <span>{t("common.width")}</span>
          <NumberField value={width} onChange={setWidth} suffix="px" widthClass="w-32" />
        </div>
        <div className="flex items-center justify-between">
          <span>{t("common.height")}</span>
          <NumberField value={height} onChange={setHeight} suffix="px" widthClass="w-32" />
        </div>

        {scaleContent ? (
          <>
            <div className="flex items-center justify-between">
              <span>Method:</span>
              <PixelSelect
                ariaLabel="Sprite Scale Method"
                value={method}
                onChange={(v) => {
                  const m = v as "nearest" | "scale2x" | "eagle" | "bilinear";
                  setMethod(m);
                  if (m === "scale2x" || m === "eagle") {
                    setWidth(origW * 2);
                    setHeight(origH * 2);
                  }
                }}
                options={[
                  { value: "nearest", label: "Nearest-Neighbor" },
                  { value: "scale2x", label: "Scale2x (Pixel Art 2x)" },
                  { value: "eagle", label: "Eagle (Pixel Art 2x)" },
                  { value: "bilinear", label: "Bilinear Interpolation" },
                ]}
              />
            </div>
            <div className="flex gap-1">
              <PixelButton
                size="xs"
                onClick={() => {
                  setWidth(Math.max(1, Math.round(origW * 0.5)));
                  setHeight(Math.max(1, Math.round(origH * 0.5)));
                }}
              >
                50%
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => {
                  setWidth(origW * 2);
                  setHeight(origH * 2);
                }}
              >
                200% (2x)
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => {
                  setWidth(origW * 4);
                  setHeight(origH * 4);
                }}
              >
                400% (4x)
              </PixelButton>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between pt-1">
            <span>9-Point Anchor:</span>
            <div className="grid grid-cols-3 gap-1">
              {[0, 1, 2].map((ay) =>
                [0, 1, 2].map((ax) => {
                  const active = anchor.ax === ax && anchor.ay === ay;
                  return (
                    <button
                      key={`${ax}_${ay}`}
                      type="button"
                      onClick={() => setAnchor({ ax: ax as 0 | 1 | 2, ay: ay as 0 | 1 | 2 })}
                      className={`w-6 h-6 border border-black text-[10px] font-bold ${
                        active ? "bg-amber-400 text-black" : "bg-[var(--kpx-input-bg)] text-black"
                      }`}
                    >
                      {active ? "●" : "·"}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <PixelButton onClick={handleApply}>{t("common.ok")}</PixelButton>
          <PixelButton onClick={onClose}>{t("common.cancel")}</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 4. Keyboard Shortcuts Dialog (`Edit > Keyboard Shortcuts`)
 */
export const KeyboardShortcutsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const keyBindings = useAppStore((s) => s.keyBindings);
  const updateKeyBinding = useAppStore((s) => s.updateKeyBinding);
  const resetKeyBinding = useAppStore((s) => s.resetKeyBinding);
  const resetAllKeyBindings = useAppStore((s) => s.resetAllKeyBindings);

  const [activeTab, setActiveTab] = useState<KeymapCategory>("Menus");
  const [search, setSearch] = useState("");
  const [recordingId, setRecordingId] = useState<string | null>(null);

  const conflicts = useMemo(
    () => detectKeymapConflicts(keyBindings).filter((c) => !c.isToolCycle),
    [keyBindings]
  );

  const filtered = useMemo(() => {
    return keyBindings.filter((b) => {
      if (b.category !== activeTab) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          b.title.toLowerCase().includes(q) ||
          b.commandId.toLowerCase().includes(q) ||
          b.keys.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [keyBindings, activeTab, search]);

  const handleKeyCapture = (e: React.KeyboardEvent, commandId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setRecordingId(null);
      return;
    }
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

    const parts: string[] = [];
    if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);

    updateKeyBinding(commandId, normalizeKeyChord(parts.join("+")));
    setRecordingId(null);
  };

  const handleExportKeymap = async () => {
    const json = defaultKeymap.exportJson();
    await getPlatform().saveFileDialog(json, { defaultName: "kekenik-keymap.json" });
  };

  return (
    <PixelDialog
      title={t("dialog.shortcuts")}
      onClose={onClose}
      widthClass="w-[620px]"
    >
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <PixelTabs
            activeId={activeTab}
            onSelect={(id) => setActiveTab(id as KeymapCategory)}
            tabs={[
              { id: "Menus", label: "Menus" },
              { id: "Tools", label: "Tools" },
              { id: "Actions", label: "Actions" },
              { id: "Mouse", label: "Mouse" },
            ]}
          />
          <TextField
            value={search}
            onChange={setSearch}
            placeholder="Search shortcuts..."
            className="w-44"
          />
        </div>

        {conflicts.length > 0 && (
          <div className="p-1.5 bg-amber-200 border border-amber-700 text-black text-[11px] font-mono">
            <strong>Conflict Warning:</strong>{" "}
            {conflicts
              .map((c) => `${c.keys} bound to (${c.titles.join(" & ")})`)
              .join("; ")}
          </div>
        )}

        <div className="h-[290px] kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead className="sticky top-0 bg-[var(--kpx-header-bg)] text-white">
              <tr>
                <th className="p-1.5 border-b border-black">Action / Command</th>
                <th className="p-1.5 border-b border-black w-40">Shortcut (Click to Record)</th>
                <th className="p-1.5 border-b border-black w-20">Reset</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const isRec = recordingId === b.commandId;
                return (
                  <tr key={b.commandId} className="border-b border-black/15 hover:bg-black/5">
                    <td className="p-1.5">
                      <div className="font-bold">{b.title}</div>
                      <div className="text-[10px] opacity-65">
                        {b.commandId}
                        {b.cycleGroup ? ` (Cycle group: ${b.cycleGroup})` : ""}
                      </div>
                    </td>
                    <td className="p-1.5">
                      <button
                        type="button"
                        onClick={() => setRecordingId(b.commandId)}
                        onKeyDown={(e) => isRec && handleKeyCapture(e, b.commandId)}
                        className={`w-full px-2 py-0.5 text-left font-mono text-xs ${
                          isRec
                            ? "bg-amber-300 text-black font-bold ring-2 ring-black"
                            : "kpx-bevel-outset bg-[var(--kpx-btn-bg)] text-black"
                        }`}
                      >
                        {isRec ? "Press keys..." : b.keys || "Unbound"}
                      </button>
                    </td>
                    <td className="p-1.5">
                      <PixelButton
                        size="xs"
                        disabled={b.keys === b.defaultKeys}
                        onClick={() => resetKeyBinding(b.commandId)}
                      >
                        Reset
                      </PixelButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5">
            <PixelButton size="xs" onClick={resetAllKeyBindings}>
              Reset All Defaults
            </PixelButton>
            <PixelButton size="xs" onClick={() => void handleExportKeymap()}>
              Export Keymap JSON
            </PixelButton>
          </div>
          <PixelButton onClick={onClose}>{t("common.ok")}</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 5. Preferences Dialog (`Edit > Preferences`)
 */
export const PreferencesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const theme = useAppStore((s) => s.theme);
  const uiScale = useAppStore((s) => s.uiScale);
  const locale = useAppStore((s) => s.locale);
  const showGrid = useAppStore((s) => s.showGrid);
  const showPixelGrid = useAppStore((s) => s.showPixelGrid);
  const snapToGrid = useAppStore((s) => s.snapToGrid);
  const showLayerEdges = useAppStore((s) => s.showLayerEdges);
  const checkerSize = useAppStore((s) => s.checkerSize);
  const checkerColor1 = useAppStore((s) => s.checkerColor1);
  const checkerColor2 = useAppStore((s) => s.checkerColor2);
  const cursorStyle = useAppStore((s) => s.cursorStyle);
  const renderBackend = useAppStore((s) => s.renderBackend);
  const toolOptions = useAppStore((s) => s.toolOptions);

  const setTheme = useAppStore((s) => s.setTheme);
  const setUIScale = useAppStore((s) => s.setUIScale);
  const setLocaleCode = useAppStore((s) => s.setLocaleCode);
  const toggleGrid = useAppStore((s) => s.toggleGrid);
  const togglePixelGrid = useAppStore((s) => s.togglePixelGrid);
  const toggleSnapToGrid = useAppStore((s) => s.toggleSnapToGrid);
  const toggleLayerEdges = useAppStore((s) => s.toggleLayerEdges);
  const setCheckerSettings = useAppStore((s) => s.setCheckerSettings);
  const setCursorStyle = useAppStore((s) => s.setCursorStyle);
  const setRenderBackend = useAppStore((s) => s.setRenderBackend);
  const setToolOption = useAppStore((s) => s.setToolOption);

  const [section, setSection] = useState("theme");

  return (
    <PixelDialog
      title={t("dialog.preferences")}
      onClose={onClose}
      widthClass="w-[560px]"
    >
      <div className="flex gap-3 h-[300px]">
        {/* Left Navigation List */}
        <div className="w-36 kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] p-1 space-y-0.5 shrink-0">
          {[
            { id: "general", label: t("prefs.general", locale) },
            { id: "theme", label: t("prefs.theme", locale) },
            { id: "extensions", label: t("prefs.extensions", locale) },
            { id: "editor", label: t("prefs.editor", locale) },
            { id: "cursors", label: t("prefs.cursors", locale) },
            { id: "timeline", label: t("prefs.timeline", locale) },
            { id: "experimental", label: t("prefs.experimental", locale) },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`w-full text-left px-2 py-1 text-xs font-mono ${
                section === item.id
                  ? "bg-[var(--kpx-accent-bg)] text-white font-bold"
                  : "hover:bg-black/10"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Right Section Content */}
        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {section === "theme" && (
            <>
              <SectionDivider label="Skin & Theme:" />
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span>Active Theme:</span>
                  <PixelSelect
                    ariaLabel="Active Theme"
                    value={theme}
                    onChange={(val) => setTheme(val as ThemeId)}
                    options={ThemeRegistry.getAll().map((th) => ({
                      value: th.id,
                      label: th.name,
                    }))}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>UI Scale Factor:</span>
                  <div className="flex items-center gap-1">
                    {([100, 200, 300] as UIScale[]).map((sc) => (
                      <PixelButton
                        key={sc}
                        size="xs"
                        active={uiScale === sc}
                        onClick={() => setUIScale(sc)}
                      >
                        {sc}%
                      </PixelButton>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {section === "extensions" && <ExtensionsManagerPanel />}

          {section === "general" && (
            <>
              <SectionDivider label="Language & Localization (i18n):" />
              <div className="flex items-center justify-between">
                <span>{t("prefs.language", locale)}</span>
                <PixelSelect
                  ariaLabel="UI Language"
                  value={locale}
                  onChange={(val) => setLocaleCode(val as LocaleCode)}
                  options={[
                    { value: "en", label: "English (Default - LTR)" },
                    { value: "fa", label: "فارسی (Persian - RTL)" },
                    { value: "fa-IR", label: "فارسی با ارقام فارسی (fa-IR Numerals)" },
                  ]}
                />
              </div>
              <div className="text-[11px] opacity-80">
                Supports Right-to-Left (RTL) text direction and Persian numerals (۰۱۲۳۴۵۶۷۸۹) while preserving LTR pixel coordinates on the canvas.
              </div>
            </>
          )}

          {section === "editor" && (
            <>
              <SectionDivider label="Canvas Grids & Overlays:" />
              <div className="space-y-1.5">
                <PixelCheckbox
                  checked={showPixelGrid}
                  onChange={() => togglePixelGrid()}
                  label="Show Adaptive Pixel Grid at >= 800% Zoom"
                />
                <PixelCheckbox
                  checked={showGrid}
                  onChange={() => toggleGrid()}
                  label="Show Custom Tile Grid Overlay"
                />
                <PixelCheckbox
                  checked={snapToGrid}
                  onChange={() => toggleSnapToGrid()}
                  label="Snap Drawing Coordinates to Grid"
                />
                <PixelCheckbox
                  checked={showLayerEdges}
                  onChange={() => toggleLayerEdges()}
                  label="Show Active Layer Cel Content Edges"
                />
              </div>

              <SectionDivider label="Checkerboard Transparency Background:" />
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span>Tile Size:</span>
                  <PixelSelect
                    ariaLabel="Checkerboard Tile Size"
                    value={String(checkerSize)}
                    onChange={(v) =>
                      setCheckerSettings(parseInt(v, 10) as 4 | 8 | 16 | 32)
                    }
                    options={[
                      { value: "4", label: "4x4 px" },
                      { value: "8", label: "8x8 px" },
                      { value: "16", label: "16x16 px" },
                      { value: "32", label: "32x32 px" },
                    ]}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>Checker Colors:</span>
                  <div className="flex items-center gap-1">
                    <ColorInputField
                      ariaLabel="Checker Color 1"
                      value={checkerColor1}
                      onChange={(hex) =>
                        setCheckerSettings(checkerSize, hex, checkerColor2)
                      }
                      className="w-8 h-5"
                    />
                    <ColorInputField
                      ariaLabel="Checker Color 2"
                      value={checkerColor2}
                      onChange={(hex) =>
                        setCheckerSettings(checkerSize, checkerColor1, hex)
                      }
                      className="w-8 h-5"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {section === "cursors" && (
            <>
              <SectionDivider label="Brush Cursor & Right-Click Behavior:" />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span>Brush Cursor Type:</span>
                  <PixelSelect
                    ariaLabel="Brush Cursor Style"
                    value={cursorStyle}
                    onChange={(v) => setCursorStyle(v as CursorStyleMode)}
                    options={[
                      { value: "footprint_outline", label: "Exact Footprint Outline" },
                      { value: "crosshair", label: "Crosshair + Footprint" },
                      { value: "bounds", label: "Bounding Box" },
                      { value: "simple", label: "System Crosshair Only" },
                    ]}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Right-Click with Pencil:</span>
                  <PixelSelect
                    ariaLabel="Right Click Behavior"
                    value={toolOptions.rightClickMode}
                    onChange={(v) =>
                      setToolOption("rightClickMode", v as "bg_color" | "eraser")
                    }
                    options={[
                      { value: "bg_color", label: "Paint with Background Color" },
                      { value: "eraser", label: "Erase Foreground" },
                    ]}
                  />
                </div>
              </div>
            </>
          )}

          {section === "experimental" && (
            <>
              <SectionDivider label="Rendering Engine Backend:" />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span>Canvas Renderer:</span>
                  <PixelSelect
                    ariaLabel="Canvas Renderer Backend"
                    value={renderBackend}
                    onChange={(v) => setRenderBackend(v as "webgl2" | "canvas2d")}
                    options={[
                      { value: "webgl2", label: "WebGL2 Tile-Accelerated" },
                      { value: "canvas2d", label: "Canvas2D Dirty-Rect Fallback" },
                    ]}
                  />
                </div>
                <div className="text-[11px] opacity-80">
                  WebGL2 uses hardware-accelerated nearest-neighbor textured quads with zero pixel smoothing; Canvas2D uses dirty-rect ImageData blitting.
                </div>
              </div>
            </>
          )}

          {section === "timeline" && (
            <>
              <SectionDivider label="TIMELINE & ONION SKIN Settings:" />
              <div className="space-y-2 text-xs">
                <div>
                  Non-linear Undo History branching is enabled (64 MB region-patch budget).
                </div>
                <div className="flex items-center gap-2">
                  <PixelButton
                    size="xs"
                    onClick={() => useAppStore.getState().openDialog("dialog.onion_skin")}
                  >
                    Open Onion Skin Settings...
                  </PixelButton>
                  <PixelButton
                    size="xs"
                    onClick={() =>
                      useAppStore.getState().openDialog("dialog.constant_frame_rate")
                    }
                  >
                    Constant Frame Rate...
                  </PixelButton>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-2 border-t border-black/20 mt-2">
        <PixelButton onClick={onClose}>{t("common.ok")}</PixelButton>
      </div>
    </PixelDialog>
  );
};

/**
 * 6. Custom Dither Matrix Editor Dialog (`dialog.dither_matrix`)
 */
export const CustomDitherMatrixDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const toolOptions = useAppStore((s) => s.toolOptions);
  const setToolOption = useAppStore((s) => s.setToolOption);
  const mat = toolOptions.customDitherMatrix;
  const [values, setValues] = useState<number[]>(() => [...mat.values]);
  const [ratio, setRatio] = useState<number>(toolOptions.ditherRatio);

  const handleCellChange = (idx: number, val: number) => {
    const next = [...values];
    next[idx] = Math.max(0, Math.min(15, val));
    setValues(next);
  };

  const handleApply = () => {
    setToolOption("customDitherMatrix", {
      id: "custom",
      name: "Custom 4x4 Matrix",
      width: 4,
      height: 4,
      maxVal: 16,
      values,
    });
    setToolOption("ditherMatrixId", "custom");
    setToolOption("ditherRatio", ratio);
    onClose();
  };

  return (
    <PixelDialog
      title="Custom Dither Matrix Editor (4x4)"
      onClose={onClose}
      widthClass="w-[340px]"
    >
      <div className="space-y-3 text-xs font-mono">
        <SectionDivider label="4x4 Threshold Matrix (0..15):" />
        <div className="grid grid-cols-4 gap-1.5 p-2 bg-black/10 border border-black/25">
          {values.map((v, idx) => (
            <NumberField
              key={idx}
              ariaLabel={`Matrix Cell ${idx}`}
              value={v}
              min={0}
              max={15}
              widthClass="w-16"
              onChange={(nv) => handleCellChange(idx, nv)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <span>FG / BG Dither Ratio (%):</span>
          <NumberField
            ariaLabel="Dither Ratio Percentage"
            value={ratio}
            min={0}
            max={100}
            suffix="%"
            widthClass="w-20"
            onChange={setRatio}
          />
        </div>

        <div className="flex justify-end gap-1.5 pt-1">
          <PixelButton onClick={handleApply}>{t("common.ok")}</PixelButton>
          <PixelButton onClick={onClose}>{t("common.cancel")}</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 7. Grid Settings Dialog (`View > Grid Settings...`)
 */
export const GridSettingsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const showGrid = useAppStore((s) => s.showGrid);
  const snapToGrid = useAppStore((s) => s.snapToGrid);
  const gridColor = useAppStore((s) => s.gridColor);
  const gridOpacity = useAppStore((s) => s.gridOpacity);
  const gridThickness = useAppStore((s) => s.gridThickness);
  const updateSpriteGrid = useAppStore((s) => s.updateSpriteGrid);
  const setGridAppearance = useAppStore((s) => s.setGridAppearance);
  const toggleSnapToGrid = useAppStore((s) => s.toggleSnapToGrid);

  const [gx, setGx] = useState(doc?.sprite.grid.x ?? 0);
  const [gy, setGy] = useState(doc?.sprite.grid.y ?? 0);
  const [gw, setGw] = useState(doc?.sprite.grid.width ?? 16);
  const [gh, setGh] = useState(doc?.sprite.grid.height ?? 16);
  const [visible, setVisible] = useState(showGrid);
  const [snap, setSnap] = useState(snapToGrid);
  const [color, setColor] = useState(gridColor);
  const [opacity, setOpacity] = useState(gridOpacity);
  const [thickness, setThickness] = useState(gridThickness);

  const handleApply = () => {
    updateSpriteGrid({ x: gx, y: gy, width: gw, height: gh, visible });
    setGridAppearance(color, opacity, thickness);
    if (snap !== snapToGrid) {
      toggleSnapToGrid();
    }
    onClose();
  };

  return (
    <PixelDialog title="Grid Settings" onClose={onClose} widthClass="w-[320px]">
      <div className="space-y-2.5 text-xs font-mono">
        <SectionDivider label="Grid Bounds & Origin:" />
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between">
            <span>X:</span>
            <NumberField ariaLabel="Grid X" value={gx} min={0} max={512} widthClass="w-16" onChange={setGx} />
          </div>
          <div className="flex items-center justify-between">
            <span>Y:</span>
            <NumberField ariaLabel="Grid Y" value={gy} min={0} max={512} widthClass="w-16" onChange={setGy} />
          </div>
          <div className="flex items-center justify-between">
            <span>Width:</span>
            <NumberField ariaLabel="Grid Width" value={gw} min={1} max={512} widthClass="w-16" onChange={setGw} />
          </div>
          <div className="flex items-center justify-between">
            <span>Height:</span>
            <NumberField ariaLabel="Grid Height" value={gh} min={1} max={512} widthClass="w-16" onChange={setGh} />
          </div>
        </div>

        <SectionDivider label="Appearance & Snapping:" />
        <div className="flex items-center justify-between">
          <span>Grid Color:</span>
          <ColorInputField
            ariaLabel="Grid Color"
            value={color}
            onChange={setColor}
            className="w-10 h-5"
          />
        </div>
        <div className="flex items-center justify-between">
          <span>Opacity (%):</span>
          <NumberField
            ariaLabel="Grid Opacity"
            value={opacity}
            min={5}
            max={100}
            widthClass="w-16"
            onChange={setOpacity}
          />
        </div>
        <div className="flex items-center justify-between">
          <span>Thickness (px):</span>
          <NumberField
            ariaLabel="Grid Line Thickness"
            dataTestId="grid-thickness-input"
            value={thickness}
            min={1}
            max={8}
            suffix="px"
            widthClass="w-16"
            onChange={setThickness}
          />
        </div>
        <PixelCheckbox checked={visible} onChange={setVisible} label="Show Tile Grid" />
        <PixelCheckbox
          checked={snap}
          onChange={setSnap}
          label="Snap Drawing Coordinates to Grid"
        />

        <div className="flex justify-end gap-1.5 pt-2">
          <PixelButton dataTestId="grid-settings-ok" onClick={handleApply}>
            {t("common.ok")}
          </PixelButton>
          <PixelButton onClick={onClose}>{t("common.cancel")}</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * Unsaved Changes Prompt Dialog when closing a modified document tab (B03)
 */
export const UnsavedChangesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const pendingCloseDocId = useAppStore((s) => s.pendingCloseDocId);
  const documents = useAppStore((s) => s.documents);
  const confirmSaveAndClose = useAppStore((s) => s.confirmSaveAndClose);
  const confirmDiscardAndClose = useAppStore((s) => s.confirmDiscardAndClose);
  const cancelPendingClose = useAppStore((s) => s.cancelPendingClose);

  const doc = documents.find((d) => d.id === pendingCloseDocId);
  const docName = doc?.sprite.name ?? "Untitled.ase";

  return (
    <PixelDialog
      title="Unsaved Changes"
      onClose={() => {
        cancelPendingClose();
        onClose();
      }}
      widthClass="w-[380px]"
    >
      <div className="space-y-3 text-xs font-mono">
        <div>
          Save changes to <strong>&quot;{docName}&quot;</strong> before closing?
        </div>
        <div className="text-[11px] opacity-80">
          Your modifications will be lost if you close this tab without saving.
        </div>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-black/25">
          <PixelButton
            dataTestId="unsaved-save-btn"
            active
            onClick={() => void confirmSaveAndClose()}
          >
            Save
          </PixelButton>
          <PixelButton
            dataTestId="unsaved-discard-btn"
            onClick={() => confirmDiscardAndClose()}
          >
            Don&apos;t Save
          </PixelButton>
          <PixelButton
            dataTestId="unsaved-cancel-btn"
            onClick={() => {
              cancelPendingClose();
              onClose();
            }}
          >
            Cancel
          </PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 8. About Kekenik Pixel Dialog
 */
export const AboutDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <PixelDialog title={t("dialog.about")} onClose={onClose} widthClass="w-[460px]">
    <div className="space-y-2 text-xs font-mono">
      <div className="flex items-center gap-3 pb-1 border-b border-black/20">
        <KekenikAppIcon size={32} dataTestId="about-app-icon" />
        <div className="font-bold text-sm">
          Kekenik Pixel v{KEKENIK_APP_VERSION} — Desktop &amp; Web Sprite Studio
        </div>
      </div>
      <p>
        Commercial-grade pixel-art &amp; sprite animation editor built with TypeScript, React,
        Zustand, Vite, and Electron.
      </p>
      <p className="text-[11px] opacity-80">
        WebGL2/Canvas2D Renderer, 19 Tools, Timeline, Layer Groups, Linked Cels, Animation Playback
        Engine, Onion Skin, Tags, Slices &amp; 9-Patch, and Tilemap/Tileset Studio.
      </p>
      <div className="text-[11px] space-y-1 pt-1 border-t border-black/20">
        <div className="flex items-center gap-2">
          <span className="opacity-70">Repository:</span>
          <button
            type="button"
            data-testid="about-repo-link"
            onClick={() => openExternalUrl(REPOSITORY_URL)}
            title={REPOSITORY_URL}
            className="underline cursor-pointer text-[var(--kpx-text)] break-all text-left"
          >
            {REPOSITORY_URL}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="opacity-70">Issues &amp; feedback:</span>
          <button
            type="button"
            data-testid="about-issues-link"
            onClick={() => openExternalUrl(REPOSITORY_ISSUES_URL)}
            title={REPOSITORY_ISSUES_URL}
            className="underline cursor-pointer text-[var(--kpx-text)] break-all text-left"
          >
            {REPOSITORY_ISSUES_URL}
          </button>
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <PixelButton onClick={onClose}>{t("common.ok")}</PixelButton>
      </div>
    </div>
  </PixelDialog>
);
