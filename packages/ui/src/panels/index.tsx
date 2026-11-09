/**
 * @module @kekenik/ui/panels
 * All 11 built-in panels registered in PanelRegistry.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  appLogger,
  BrushCategory,
  BUILTIN_PALETTE_PRESETS,
  ColorHarmonyMode,
  computeColorHarmonies,
  decodeGplPalette,
  decodeHexPalette,
  decodeJascPalPalette,
  encodeGplPalette,
  encodeHexPalette,
  encodeJascPalPalette,
  extractPaletteFromSprite,
  FeatureRegistry,
  generateBrushFootprint,
  generatePaletteRamp,
  generateTintShadeRamp,
  getPaletteForFrame,
  getPaletteSpanForFrame,
  getPlatform,
  hslToRgba,
  hsvToRgba,
  LogEntry,
  paintStrokeOnImage,
  PaletteRampColorSpace,
  PaletteSortCriterion,
  PixelImage,
  reorderPaletteSwatches,
  reversePaletteColors,
  rgbaToHex,
  rgbToHsl,
  rgbToHsv,
  sortPaletteColors,
  UpdatePaletteAndRemapCommand,
} from "../../../core/src/index.ts";
import { useAppStore } from "../app/store.ts";
import { PixelIcon } from "../skin/index.tsx";
import {
  ColorSwatch,
  HexField,
  NumberField,
  PixelButton,
  PixelCheckbox,
  PixelSelect,
  PixelSlider,
  TextField,
} from "../widgets/index.tsx";
import {
  LayersPanel,
  PreviewPanel,
  SlicesPanel,
  TagsPanel,
  TilesetPanel,
  TimelinePanel,
} from "./agent3-panels.tsx";
import { ExtensionsManagerPanel } from "./extensions/index.tsx";
import { ScriptEditorPanel } from "./scripts/index.tsx";

export {
  LayersPanel,
  PreviewPanel,
  SlicesPanel,
  TagsPanel,
  TilesetPanel,
  TimelinePanel,
};

/**
 * 1. Color Bar (Palette Swatches, Multi-Select, Drag Reorder, Ramp, Sort, Presets & Formats)
 */
export const ColorBarPanel: React.FC = () => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const frameIndex = useAppStore((s) => s.activeFrameIndex);
  const fgPaletteIndex = useAppStore((s) => s.fgPaletteIndex);
  const selectedSwatchIndices = useAppStore((s) => s.selectedSwatchIndices);
  const paletteLocked = useAppStore((s) => s.paletteLocked);
  const remapOnPaletteEdit = useAppStore((s) => s.remapOnPaletteEdit);
  const setPaletteLocked = useAppStore((s) => s.setPaletteLocked);
  const selectSwatchWithModifiers = useAppStore((s) => s.selectSwatchWithModifiers);
  const setRemapOnPaletteEdit = useAppStore((s) => s.setRemapOnPaletteEdit);
  const setBgColor = useAppStore((s) => s.setBgColor);
  const openDialog = useAppStore((s) => s.openDialog);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const [swatchSize, setSwatchSize] = useState<number>(18);
  const [showPalMenu, setShowPalMenu] = useState(false);
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [rampSpace, setRampSpace] = useState<PaletteRampColorSpace>("rgb");

  void rev;
  const palette = doc ? getPaletteForFrame(doc.sprite, frameIndex) : [];
  const activeSpan = doc ? getPaletteSpanForFrame(doc.sprite, frameIndex) : null;

  const commitPaletteChange = (
    label: string,
    nextColors: typeof palette,
    oldToNewIndexMap?: number[]
  ) => {
    if (!doc) return;
    const nextPalettes = doc.sprite.palettes.map((p) =>
      p.id === activeSpan?.id
        ? { ...p, colors: nextColors.map((c) => ({ ...c })) }
        : { ...p, colors: p.colors.map((c) => ({ ...c })) }
    );
    doc.execute(
      new UpdatePaletteAndRemapCommand({
        label,
        nextPalettes,
        oldToNewIndexMap,
        remapPixels: remapOnPaletteEdit && doc.sprite.colorMode === "indexed",
      })
    );
    bumpRevision();
  };

  const handleSort = (criterion: PaletteSortCriterion, ascending = true) => {
    if (!doc) return;
    const { colors: sorted, oldToNewIndexMap } = sortPaletteColors(
      palette,
      criterion,
      ascending
    );
    commitPaletteChange(`Sort Palette (${criterion})`, sorted, oldToNewIndexMap);
  };

  const handleReverse = () => {
    if (!doc) return;
    const { colors: revCols, oldToNewIndexMap } = reversePaletteColors(
      palette,
      selectedSwatchIndices.length >= 2 ? selectedSwatchIndices : undefined
    );
    commitPaletteChange("Reverse Palette", revCols, oldToNewIndexMap);
  };

  const handleRamp = () => {
    if (!doc || selectedSwatchIndices.length < 2) return;
    const lo = Math.min(...selectedSwatchIndices);
    const hi = Math.max(...selectedSwatchIndices);
    const ramped = generatePaletteRamp(palette, lo, hi, rampSpace);
    commitPaletteChange(`Gradient Ramp (${rampSpace.toUpperCase()})`, ramped);
  };

  const handlePresetLoad = (presetId: string) => {
    const found = BUILTIN_PALETTE_PRESETS.find((p) => p.id === presetId);
    if (!found || !doc) return;
    commitPaletteChange(`Load Preset "${found.name}"`, [...found.colors]);
    setShowPalMenu(false);
  };

  const handleQuantizeFromSprite = (alg: "median_cut" | "kmeans") => {
    if (!doc) return;
    const extracted = extractPaletteFromSprite(doc.sprite, 16, alg);
    commitPaletteChange(`Extract Palette (${alg})`, extracted);
    setShowPalMenu(false);
  };

  const handleSavePaletteFile = async (ext: "gpl" | "pal" | "hex") => {
    if (!doc) return;
    const content =
      ext === "gpl"
        ? encodeGplPalette(palette, doc.sprite.name)
        : ext === "pal"
        ? encodeJascPalPalette(palette)
        : encodeHexPalette(palette);
    await getPlatform().saveFileDialog(content, {
      defaultName: `palette.${ext}`,
    });
    setShowPalMenu(false);
  };

  const handleLoadPaletteFile = async () => {
    if (!doc) return;
    const res = await getPlatform().openFileDialog();
    if (!res || !res.text) return;
    try {
      const lower = res.name.toLowerCase();
      let loaded = palette;
      if (lower.endsWith(".gpl")) {
        loaded = decodeGplPalette(res.text).colors;
      } else if (lower.endsWith(".pal")) {
        loaded = decodeJascPalPalette(res.text);
      } else {
        loaded = decodeHexPalette(res.text);
      }
      if (loaded.length > 0) {
        commitPaletteChange(`Import Palette "${res.name}"`, loaded);
      }
    } catch (err) {
      appLogger.error(
        "Palette",
        `Failed to load palette: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    setShowPalMenu(false);
  };

  return (
    <div className="flex flex-col h-full select-none relative">
      {/* Top Color Bar Controls */}
      <div className="flex items-center justify-between gap-1 px-1.5 py-1 bg-[var(--kpx-chrome-bg)] border-b border-black">
        <div className="flex items-center gap-1">
          <PixelButton
            size="xs"
            active={!paletteLocked}
            onClick={() => setPaletteLocked(!paletteLocked)}
            title={
              paletteLocked
                ? "Palette Locked (click to unlock live swatch editing)"
                : "Palette Editable (Color Picker updates active swatch)"
            }
          >
            <PixelIcon name={paletteLocked ? "lock_closed" : "lock_open"} size={11} />
          </PixelButton>
          <PixelButton
            size="xs"
            onClick={() => handleSort("luminance", true)}
            title="Sort Palette by Luminance"
          >
            <PixelIcon name="arrow_down" size={11} />
          </PixelButton>
          <PixelButton
            size="xs"
            onClick={() => setSwatchSize((s) => (s === 18 ? 14 : s === 14 ? 22 : 18))}
            title="Cycle Swatch Zoom Size (14px / 18px / 22px)"
          >
            <PixelIcon name="shape_square" size={11} />
          </PixelButton>
          <PixelButton
            size="xs"
            active={showPalMenu}
            onClick={() => setShowPalMenu(!showPalMenu)}
            title="Palette Menu (Presets, Ramp, Sort, Quantize, Save/Load, Palette Editor)"
          >
            <PixelIcon name="menu_bars" size={11} />
          </PixelButton>
        </div>
        <PixelButton
          size="xs"
          onClick={() => openDialog("dialog.palette_editor")}
          title="Open Full Palette Editor & Per-Frame Spans Dialog"
        >
          Edit...
        </PixelButton>
      </div>

      {/* Multi-Select Ramp & Remap Quick Bar when >= 2 swatches selected */}
      {selectedSwatchIndices.length >= 2 && (
        <div className="px-1.5 py-1 bg-amber-950/40 border-b border-black flex items-center justify-between gap-1 text-[10px] font-mono">
          <span>
            Range [{Math.min(...selectedSwatchIndices)}..{Math.max(...selectedSwatchIndices)}]
          </span>
          <div className="flex items-center gap-1">
            <PixelSelect
              ariaLabel="Palette Ramp Space"
              value={rampSpace}
              onChange={(v) => setRampSpace(v as PaletteRampColorSpace)}
              options={[
                { value: "rgb", label: "RGB" },
                { value: "hsv", label: "HSV" },
                { value: "hsl", label: "HSL" },
              ]}
            />
            <PixelButton size="xs" onClick={handleRamp} title="Interpolate Gradient Ramp">
              Ramp
            </PixelButton>
          </div>
        </div>
      )}

      {/* Palette Options Popover Menu */}
      {showPalMenu && (
        <div className="absolute left-1 right-1 top-8 z-50 kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] p-2 shadow-2xl space-y-1.5 text-[11px] font-mono max-h-[340px] overflow-y-auto">
          <div className="font-bold border-b border-black/30 pb-1 flex items-center justify-between">
            <span>Palette Options ({palette.length} cols)</span>
            <button type="button" onClick={() => setShowPalMenu(false)}>
              <PixelIcon name="close" size={10} />
            </button>
          </div>

          <PixelCheckbox
            checked={remapOnPaletteEdit}
            onChange={(v) => setRemapOnPaletteEdit(v)}
            label="Remap Indexed Pixels on Sort/Move"
          />

          <div className="space-y-1 border-t border-black/20 pt-1">
            <div className="font-bold text-[10px]">Built-in Presets (12):</div>
            <div className="grid grid-cols-2 gap-1">
              {BUILTIN_PALETTE_PRESETS.map((p) => (
                <PixelButton
                  key={p.id}
                  size="xs"
                  onClick={() => handlePresetLoad(p.id)}
                  title={`${p.name} (${p.colors.length} colors — ${p.license})`}
                >
                  {p.name.split(" ")[0]}
                </PixelButton>
              ))}
            </div>
          </div>

          <div className="space-y-1 border-t border-black/20 pt-1">
            <div className="font-bold text-[10px]">Sort &amp; Order:</div>
            <div className="grid grid-cols-3 gap-1">
              <PixelButton size="xs" onClick={() => handleSort("hue", true)}>
                Sort Hue
              </PixelButton>
              <PixelButton size="xs" onClick={() => handleSort("luminance", true)}>
                Sort Luma
              </PixelButton>
              <PixelButton size="xs" onClick={() => handleSort("saturation", false)}>
                Sort Sat
              </PixelButton>
              <PixelButton size="xs" onClick={() => handleSort("value", false)}>
                Sort Val
              </PixelButton>
              <PixelButton size="xs" onClick={handleReverse}>
                Reverse
              </PixelButton>
              <PixelButton size="xs" onClick={handleRamp}>
                Ramp
              </PixelButton>
            </div>
          </div>

          <div className="space-y-1 border-t border-black/20 pt-1">
            <div className="font-bold text-[10px]">Quantize from Sprite:</div>
            <div className="flex gap-1">
              <PixelButton size="xs" onClick={() => handleQuantizeFromSprite("median_cut")}>
                Median-Cut 16
              </PixelButton>
              <PixelButton size="xs" onClick={() => handleQuantizeFromSprite("kmeans")}>
                K-Means 16
              </PixelButton>
            </div>
          </div>

          <div className="space-y-1 border-t border-black/20 pt-1">
            <div className="font-bold text-[10px]">Palette Files (.gpl / .pal / .hex):</div>
            <div className="flex flex-wrap gap-1">
              <PixelButton size="xs" onClick={() => void handleLoadPaletteFile()}>
                Load...
              </PixelButton>
              <PixelButton size="xs" onClick={() => void handleSavePaletteFile("gpl")}>
                Save .gpl
              </PixelButton>
              <PixelButton size="xs" onClick={() => void handleSavePaletteFile("pal")}>
                Save .pal
              </PixelButton>
              <PixelButton size="xs" onClick={() => void handleSavePaletteFile("hex")}>
                Save .hex
              </PixelButton>
            </div>
          </div>
        </div>
      )}

      {/* Swatches Area in dark slate container */}
      <div className="flex-1 p-1.5 bg-[#5b5360] kpx-bevel-inset overflow-y-auto">
        <div className="flex flex-wrap gap-0">
          {palette.map((c, idx) => {
            const isMultiSelected = selectedSwatchIndices.includes(idx);
            return (
              <div
                key={idx}
                draggable
                onDragStart={() => setDragFromIdx(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFromIdx === null || dragFromIdx === idx) return;
                  const sourceIndices = selectedSwatchIndices.includes(dragFromIdx)
                    ? selectedSwatchIndices
                    : [dragFromIdx];
                  const { colors: reordered, oldToNewIndexMap } = reorderPaletteSwatches(
                    palette,
                    sourceIndices,
                    idx,
                    e.ctrlKey || e.altKey
                  );
                  commitPaletteChange(
                    e.ctrlKey || e.altKey ? "Copy Palette Swatches" : "Reorder Palette Swatches",
                    reordered,
                    oldToNewIndexMap
                  );
                  setDragFromIdx(null);
                }}
                className={isMultiSelected && selectedSwatchIndices.length > 1 ? "ring-1 ring-yellow-300 z-10" : ""}
              >
                <ColorSwatch
                  color={c}
                  size={swatchSize}
                  selected={fgPaletteIndex === idx || isMultiSelected}
                  isTransparentIndex={idx === (doc?.sprite.transparentIndex ?? 0)}
                  title={`Idx-${idx} ${rgbaToHex(c)} (Click: FG, Shift+Click: Range, Right-click: BG, Drag: Reorder)`}
                  onClick={(e) =>
                    selectSwatchWithModifiers(idx, Boolean(e?.shiftKey), Boolean(e?.ctrlKey || e?.metaKey))
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setBgColor(c, idx);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/**
 * 2. Color Picker Panel (Spectrum / Wheel / HSV / HSL / RGB / Gray + Alpha + Tint/Shade + History)
 */
export const ColorPickerPanel: React.FC = () => {
  const fgColor = useAppStore((s) => s.fgColor);
  const bgColor = useAppStore((s) => s.bgColor);
  const fgPaletteIndex = useAppStore((s) => s.fgPaletteIndex);
  const colorHistory = useAppStore((s) => s.colorHistory);
  const setFgColor = useAppStore((s) => s.setFgColor);
  const swapColors = useAppStore((s) => s.swapColors);
  const resetDefaultColors = useAppStore((s) => s.resetDefaultColors);
  const addColorToPalette = useAppStore((s) => s.addColorToPalette);
  const setActiveTool = useAppStore((s) => s.setActiveTool);

  const hsv = rgbToHsv(fgColor.r, fgColor.g, fgColor.b);
  const hsl = rgbToHsl(fgColor.r, fgColor.g, fgColor.b);
  const [pickerTab, setPickerTab] = useState<"spectrum" | "wheel" | "sliders">("spectrum");
  const [sliderMode, setSliderMode] = useState<"rgb" | "hsv" | "hsl" | "gray">("rgb");
  const [hexInput, setHexInput] = useState(rgbaToHex(fgColor));
  const [harmonyMode, setHarmonyMode] = useState<ColorHarmonyMode>("triadic");
  const harmonies = computeColorHarmonies(fgColor, harmonyMode);
  const tintShadeRamp = generateTintShadeRamp(fgColor, 7);

  useEffect(() => {
    setHexInput(rgbaToHex(fgColor));
  }, [fgColor]);

  const handleSvDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const update = (clientX: number, clientY: number) => {
      const s = Math.round(
        Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))) * 100
      );
      const v = Math.round(
        (1 - Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)))) * 100
      );
      setFgColor(hsvToRgba(hsv.h, s, v, fgColor.a));
    };
    update(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => update(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleHueDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const update = (clientX: number) => {
      const h = Math.round(
        Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))) * 360
      );
      setFgColor(hsvToRgba(h, Math.max(15, hsv.s), Math.max(15, hsv.v), fgColor.a));
    };
    update(e.clientX);
    const onMove = (ev: MouseEvent) => update(ev.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleWheelDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const update = (clientX: number, clientY: number) => {
      const dx = clientX - cx;
      const dy = clientY - cy;
      const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const sat = Math.min(100, Math.round((Math.hypot(dx, dy) / radius) * 100));
      setFgColor(hsvToRgba(angle, sat, Math.max(25, hsv.v), fgColor.a));
    };
    update(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => update(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const pureHueHex = rgbaToHex(hsvToRgba(hsv.h, 100, 100, 255));

  return (
    <div className="p-1.5 bg-[var(--kpx-chrome-bg)] flex flex-col gap-1 select-none border-t border-black">
      {/* Picker Mode Selector Tabs */}
      <div className="flex items-center justify-between gap-0.5">
        <div className="flex items-center gap-0.5">
          {(
            [
              ["spectrum", "Spec"],
              ["wheel", "Wheel"],
              ["sliders", "Sliders"],
            ] as const
          ).map(([id, label]) => (
            <PixelButton
              key={id}
              size="xs"
              active={pickerTab === id}
              onClick={() => setPickerTab(id)}
            >
              {label}
            </PixelButton>
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          <PixelButton
            size="xs"
            title="Eyedropper Tool (I)"
            onClick={() => setActiveTool("tool.eyedropper")}
          >
            <PixelIcon name="eyedropper" size={10} />
          </PixelButton>
          <PixelButton
            size="xs"
            title="Add Current FG Color to Palette"
            onClick={() => addColorToPalette(fgColor)}
          >
            +Pal
          </PixelButton>
          <PixelButton
            size="xs"
            title="Reset FG/BG to Black/White (D)"
            onClick={resetDefaultColors}
          >
            D
          </PixelButton>
        </div>
      </div>

      {/* 1. Spectrum Mode */}
      {pickerTab === "spectrum" && (
        <div className="kpx-bevel-inset bg-black p-0.5">
          <div
            onMouseDown={handleSvDrag}
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureHueHex})`,
            }}
            className="relative h-20 w-full cursor-crosshair"
          >
            <div
              style={{
                left: `${hsv.s}%`,
                top: `${100 - hsv.v}%`,
              }}
              className="absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 border border-white ring-1 ring-black pointer-events-none"
            />
          </div>
          {/* Hue Rainbow Bar */}
          <div
            onMouseDown={handleHueDrag}
            style={{
              background:
                "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
            }}
            className="relative h-3 w-full mt-0.5 cursor-ew-resize"
          >
            <div
              style={{ left: `${(hsv.h / 360) * 100}%` }}
              className="absolute top-0 bottom-0 w-1.5 -translate-x-1/2 border border-black bg-white/80 pointer-events-none"
            />
          </div>
        </div>
      )}

      {/* 2. Hue Wheel Mode */}
      {pickerTab === "wheel" && (
        <div className="kpx-bevel-inset bg-[#1e1b22] p-1 flex items-center justify-center">
          <div
            onMouseDown={handleWheelDrag}
            style={{
              background:
                "radial-gradient(circle, #ffffff 0%, transparent 70%), conic-gradient(from 90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
            }}
            className="relative w-24 h-24 rounded-full border border-black cursor-crosshair"
          >
            <div
              style={{
                left: `${50 + Math.cos((hsv.h * Math.PI) / 180) * (hsv.s * 0.45)}%`,
                top: `${50 + Math.sin((hsv.h * Math.PI) / 180) * (hsv.s * 0.45)}%`,
              }}
              className="absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white ring-1 ring-black pointer-events-none"
            />
          </div>
        </div>
      )}

      {/* 3. RGB / HSV / HSL / Gray Sliders Mode */}
      {pickerTab === "sliders" && (
        <div className="kpx-bevel-inset bg-[var(--kpx-panel-bg)] p-1.5 space-y-1 text-[10px]">
          <div className="flex gap-0.5 mb-1">
            {(["rgb", "hsv", "hsl", "gray"] as const).map((m) => (
              <PixelButton
                key={m}
                size="xs"
                active={sliderMode === m}
                onClick={() => setSliderMode(m)}
              >
                {m.toUpperCase()}
              </PixelButton>
            ))}
          </div>

          {sliderMode === "rgb" && (
            <>
              <PixelSlider
                label="R"
                value={fgColor.r}
                min={0}
                max={255}
                onChange={(r) => setFgColor({ ...fgColor, r })}
              />
              <PixelSlider
                label="G"
                value={fgColor.g}
                min={0}
                max={255}
                onChange={(g) => setFgColor({ ...fgColor, g })}
              />
              <PixelSlider
                label="B"
                value={fgColor.b}
                min={0}
                max={255}
                onChange={(b) => setFgColor({ ...fgColor, b })}
              />
            </>
          )}

          {sliderMode === "hsv" && (
            <>
              <PixelSlider
                label="H"
                value={hsv.h}
                min={0}
                max={360}
                onChange={(h) => setFgColor(hsvToRgba(h, hsv.s, hsv.v, fgColor.a))}
              />
              <PixelSlider
                label="S"
                value={hsv.s}
                min={0}
                max={100}
                onChange={(s) => setFgColor(hsvToRgba(hsv.h, s, hsv.v, fgColor.a))}
              />
              <PixelSlider
                label="V"
                value={hsv.v}
                min={0}
                max={100}
                onChange={(v) => setFgColor(hsvToRgba(hsv.h, hsv.s, v, fgColor.a))}
              />
            </>
          )}

          {sliderMode === "hsl" && (
            <>
              <PixelSlider
                label="H"
                value={hsl.h}
                min={0}
                max={360}
                onChange={(h) => setFgColor(hslToRgba(h, hsl.s, hsl.l, fgColor.a))}
              />
              <PixelSlider
                label="S"
                value={hsl.s}
                min={0}
                max={100}
                onChange={(s) => setFgColor(hslToRgba(hsl.h, s, hsl.l, fgColor.a))}
              />
              <PixelSlider
                label="L"
                value={hsl.l}
                min={0}
                max={100}
                onChange={(l) => setFgColor(hslToRgba(hsl.h, hsl.s, l, fgColor.a))}
              />
            </>
          )}

          {sliderMode === "gray" && (
            <PixelSlider
              label="Gray"
              value={Math.round(0.299 * fgColor.r + 0.587 * fgColor.g + 0.114 * fgColor.b)}
              min={0}
              max={255}
              onChange={(v) => setFgColor({ r: v, g: v, b: v, a: fgColor.a })}
            />
          )}
        </div>
      )}

      {/* Alpha Slider */}
      <div className="flex items-center gap-1 text-[10px]">
        <span className="w-4">A:</span>
        <PixelSlider
          ariaLabel="Color Alpha"
          min={0}
          max={255}
          value={fgColor.a}
          onChange={(v) => setFgColor({ ...fgColor, a: v })}
          className="flex-1"
        />
        <span className="w-6 text-right">{fgColor.a}</span>
      </div>

      {/* Tint / Shade 7-Step Ramp Strip */}
      <div className="flex items-center gap-0.5" title="Tint / Shade Ramp (Click to pick)">
        {tintShadeRamp.map((rc, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setFgColor(rc)}
            style={{ backgroundColor: rgbaToHex(rc) }}
            className="flex-1 h-3 border border-black cursor-pointer"
            title={`Tint/Shade ${i + 1}: ${rgbaToHex(rc)}`}
          />
        ))}
      </div>

      {/* Foreground & Background Color Pills */}
      <div className="grid grid-cols-2 gap-1">
        <div
          onClick={swapColors}
          title="Foreground Color (click to swap FG/BG, or press X)"
          style={{ backgroundColor: rgbaToHex(fgColor) }}
          className="h-5 kpx-bevel-outset flex items-center justify-center cursor-pointer border border-black"
        >
          <span
            className={`text-[10px] font-mono font-bold truncate px-1 ${
              fgColor.r + fgColor.g + fgColor.b > 380 ? "text-black" : "text-white"
            }`}
          >
            FG #{fgPaletteIndex}
          </span>
        </div>
        <div
          onClick={swapColors}
          title="Background Color / Mask (click to swap FG/BG)"
          style={{ backgroundColor: rgbaToHex(bgColor) }}
          className="h-5 kpx-bevel-outset flex items-center justify-center cursor-pointer border border-black"
        >
          <span
            className={`text-[10px] font-mono font-bold truncate px-1 ${
              bgColor.r + bgColor.g + bgColor.b > 380 ? "text-black" : "text-white"
            }`}
          >
            BG {rgbaToHex(bgColor)}
          </span>
        </div>
      </div>

      {/* Hex Input */}
      <div className="flex items-center gap-1">
        <HexField
          ariaLabel="Hex color code"
          value={hexInput}
          alpha={fgColor.a}
          onChange={setHexInput}
          onValidColor={(rgba) => setFgColor(rgba)}
          className="w-full"
        />
      </div>

      {/* Recent Color History Strip */}
      <div className="flex items-center gap-0.5 flex-wrap pt-0.5" title="Recent Color History">
        {colorHistory.slice(0, 8).map((hc, idx) => (
          <button
            key={idx}
            type="button"
            title={`History: ${rgbaToHex(hc)}`}
            onClick={() => setFgColor(hc)}
            style={{ backgroundColor: rgbaToHex(hc) }}
            className="w-3.5 h-3.5 border border-black cursor-pointer"
          />
        ))}
      </div>

      {/* Color Wheel Harmony Swatches */}
      <div className="flex items-center justify-between gap-1 pt-0.5 border-t border-black/20">
        <PixelSelect
          ariaLabel="Color Harmony Mode"
          value={harmonyMode}
          onChange={(v) => setHarmonyMode(v as ColorHarmonyMode)}
          options={[
            { value: "complementary", label: "Complement" },
            { value: "triadic", label: "Triadic" },
            { value: "analogous", label: "Analogous" },
            { value: "split_complementary", label: "Split-Comp" },
          ]}
        />
        <div className="flex items-center gap-0.5">
          {harmonies.map((hc, idx) => (
            <button
              key={idx}
              type="button"
              title={`Harmony ${rgbaToHex(hc)} (Click to use as FG)`}
              onClick={() => setFgColor(hc)}
              style={{ backgroundColor: rgbaToHex(hc) }}
              className="w-4 h-4 border border-black cursor-pointer"
            />
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * Dockable Palette Editor Panel (`panel.palette_editor`)
 */
export const PaletteEditorPanel: React.FC = () => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const frameIndex = useAppStore((s) => s.activeFrameIndex);
  const fgPaletteIndex = useAppStore((s) => s.fgPaletteIndex);
  const openDialog = useAppStore((s) => s.openDialog);
  const addColorToPalette = useAppStore((s) => s.addColorToPalette);
  const fgColor = useAppStore((s) => s.fgColor);

  void rev;
  const palette = doc ? getPaletteForFrame(doc.sprite, frameIndex) : [];

  return (
    <div className="p-2 flex flex-col gap-2 text-xs font-mono h-full select-none overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="font-bold">Palette ({palette.length} swatches)</span>
        <PixelButton size="xs" onClick={() => openDialog("dialog.palette_editor")}>
          Full Studio...
        </PixelButton>
      </div>
      <div className="text-[11px] opacity-80">
        Active Swatch: #{fgPaletteIndex} ({rgbaToHex(palette[fgPaletteIndex] ?? fgColor)})
      </div>
      <div className="flex gap-1">
        <PixelButton size="xs" onClick={() => addColorToPalette(fgColor)}>
          + Add Swatch
        </PixelButton>
        <PixelButton size="xs" onClick={() => openDialog("dialog.color_mode")}>
          Color Mode...
        </PixelButton>
      </div>
    </div>
  );
};



/**
 * 5. Undo History Panel (Fully working with non-linear branching history & node jumping)
 */
export const HistoryPanel: React.FC = () => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  void rev;
  if (!doc) return <div className="p-2 text-xs">No active document</div>;

  const nodes = doc.history.getAllNodes();
  const currentId = doc.history.currentNodeId;

  return (
    <div className="flex flex-col h-full p-1.5 gap-1.5 select-none">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <PixelButton
            size="xs"
            disabled={!doc.history.canUndo}
            onClick={() => {
              if (doc.undo()) bumpRevision();
            }}
          >
            Undo
          </PixelButton>
          <PixelButton
            size="xs"
            disabled={!doc.history.canRedo}
            onClick={() => {
              if (doc.redo()) bumpRevision();
            }}
          >
            Redo
          </PixelButton>
        </div>
        <span className="text-[10px] font-mono opacity-80">
          Patch Mem: {(doc.history.usedBytes / 1024).toFixed(2)} KB
        </span>
      </div>

      <div className="flex-1 kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] overflow-y-auto p-1 space-y-0.5">
        {nodes.map((node) => {
          const isCurrent = node.id === currentId;
          const label = node.command ? node.command.label : "Initial State (Root)";
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => {
                doc.jumpToHistoryNode(node.id);
                bumpRevision();
              }}
              className={`w-full text-left px-1.5 py-1 text-xs font-mono flex items-center justify-between ${
                isCurrent
                  ? "bg-[var(--kpx-accent-bg)] text-white font-bold"
                  : "hover:bg-black/10"
              }`}
            >
              <span className="truncate">
                {node.branchIndex > 0 ? `[B${node.branchIndex}] ` : ""}
                {label}
              </span>
              {node.command && (
                <span className="text-[10px] opacity-75 ml-1 shrink-0">
                  {node.command.byteSize}B
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};



/**
 * 7. Brush Preview & Scratchpad Component (used in both BrushesPanel and BrushPreviewPanel)
 */
export const BrushPreviewPanel: React.FC = () => {
  const toolOptions = useAppStore((s) => s.toolOptions);
  const fgColor = useAppStore((s) => s.fgColor);
  const bgColor = useAppStore((s) => s.bgColor);

  const [previewZoom, setPreviewZoom] = useState<number>(4);
  const footprintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchImageRef = useRef<PixelImage>(new PixelImage(72, 36, "rgba"));
  const isScratchingRef = useRef(false);
  const [scratchRev, setScratchRev] = useState(0);

  // Render live footprint preview
  useEffect(() => {
    const canvas = footprintCanvasRef.current;
    if (!canvas) return;
    const dim = 24;
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#27232c";
    ctx.fillRect(0, 0, dim, dim);

    const fp = generateBrushFootprint({
      id: "preview",
      name: "Preview",
      category: "Basic",
      type: toolOptions.brushShape,
      size: Math.min(20, toolOptions.brushSize),
      angle: toolOptions.brushAngle,
      spacing: toolOptions.brushSpacing,
      patternAlign: toolOptions.patternAlign,
      flipH: toolOptions.flipH,
      flipV: toolOptions.flipV,
      dynamics: {
        pressureSize: toolOptions.pressureSize,
        pressureAngle: toolOptions.pressureAngle,
        velocitySize: toolOptions.velocitySize,
        gradientDither: toolOptions.gradientDither,
      },
      image: toolOptions.customBrushImage,
    });

    const cx = Math.floor(dim / 2);
    const cy = Math.floor(dim / 2);
    for (const pt of fp) {
      const px = cx + pt.dx;
      const py = cy + pt.dy;
      if (px >= 0 && py >= 0 && px < dim && py < dim) {
        ctx.fillStyle = pt.color ? rgbaToHex(pt.color) : rgbaToHex(fgColor);
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }, [
    toolOptions.brushShape,
    toolOptions.brushSize,
    toolOptions.brushAngle,
    toolOptions.brushSpacing,
    toolOptions.patternAlign,
    toolOptions.flipH,
    toolOptions.flipV,
    toolOptions.customBrushImage,
    fgColor,
  ]);

  // Render scratchpad buffer
  useEffect(() => {
    const canvas = scratchCanvasRef.current;
    if (!canvas) return;
    const img = scratchImageRef.current;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#3f3943";
    ctx.fillRect(0, 0, img.width, img.height);
    const off = document.createElement("canvas");
    off.width = img.width;
    off.height = img.height;
    const offCtx = off.getContext("2d");
    if (offCtx) {
      offCtx.putImageData(
        new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
        0,
        0
      );
      ctx.drawImage(off, 0, 0);
    }
  }, [scratchRev]);

  const paintScratchAt = (clientX: number, clientY: number, button: number) => {
    const canvas = scratchCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const img = scratchImageRef.current;
    const x = Math.floor(((clientX - rect.left) / Math.max(1, rect.width)) * img.width);
    const y = Math.floor(((clientY - rect.top) / Math.max(1, rect.height)) * img.height);
    paintStrokeOnImage(img, [{ x, y }], {
      fgColor,
      bgColor,
      button,
      brush: {
        type: toolOptions.brushShape,
        size: toolOptions.brushSize,
        angle: toolOptions.brushAngle,
        spacing: toolOptions.brushSpacing,
        patternAlign: toolOptions.patternAlign,
        flipH: toolOptions.flipH,
        flipV: toolOptions.flipV,
        image: toolOptions.customBrushImage,
      },
      inkMode: toolOptions.inkMode,
      opacity: toolOptions.opacity,
      ditherMatrixId: toolOptions.ditherMatrixId,
      ditherRatio: toolOptions.ditherRatio / 100,
      customDitherMatrix: toolOptions.customDitherMatrix,
    });
    setScratchRev((r) => r + 1);
  };

  return (
    <div className="p-1.5 flex flex-col gap-1.5 text-xs font-mono select-none">
      <div className="flex items-center justify-between">
        <span className="font-bold text-[11px]">Footprint &amp; Scratchpad:</span>
        <div className="flex items-center gap-0.5">
          {[2, 4, 6].map((z) => (
            <PixelButton
              key={z}
              size="xs"
              active={previewZoom === z}
              onClick={() => setPreviewZoom(z)}
            >
              {z}x
            </PixelButton>
          ))}
          <PixelButton
            size="xs"
            onClick={() => {
              scratchImageRef.current.clear();
              setScratchRev((r) => r + 1);
            }}
          >
            Clear
          </PixelButton>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="kpx-bevel-inset bg-[#27232c] p-1 flex items-center justify-center shrink-0">
          <canvas
            ref={footprintCanvasRef}
            style={{
              width: 24 * Math.min(3, Math.ceil(previewZoom / 2)),
              height: 24 * Math.min(3, Math.ceil(previewZoom / 2)),
              imageRendering: "pixelated",
            }}
          />
        </div>
        <div className="flex-1 kpx-bevel-inset bg-[#3f3943] p-0.5 flex items-center justify-center overflow-hidden">
          <canvas
            ref={scratchCanvasRef}
            data-testid="brush-scratchpad-canvas"
            onMouseDown={(e) => {
              isScratchingRef.current = true;
              paintScratchAt(e.clientX, e.clientY, e.button);
            }}
            onMouseMove={(e) => {
              if (isScratchingRef.current) {
                paintScratchAt(e.clientX, e.clientY, e.buttons === 2 ? 2 : 0);
              }
            }}
            onMouseUp={() => {
              isScratchingRef.current = false;
            }}
            onMouseLeave={() => {
              isScratchingRef.current = false;
            }}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              width: "100%",
              height: 54,
              imageRendering: "pixelated",
            }}
            className="cursor-crosshair block"
            title="Scribble here to test the active brush, ink mode, and dither matrix!"
          />
        </div>
      </div>
    </div>
  );
};

/**
 * 7b. Full Brush Library & Preset Manager Panel
 */
export const BrushesPanel: React.FC = () => {
  const brushes = useAppStore((s) => s.brushes);
  const activeBrushId = useAppStore((s) => s.activeBrushId);
  const toolOptions = useAppStore((s) => s.toolOptions);
  const setToolOption = useAppStore((s) => s.setToolOption);
  const selectBrushPreset = useAppStore((s) => s.selectBrushPreset);
  const saveCurrentBrushToLibrary = useAppStore((s) => s.saveCurrentBrushToLibrary);
  const captureCustomBrushFromCanvas = useAppStore((s) => s.captureCustomBrushFromCanvas);
  const deleteBrushFromLibrary = useAppStore((s) => s.deleteBrushFromLibrary);
  const renameBrushInLibrary = useAppStore((s) => s.renameBrushInLibrary);
  const reorderBrushInLibrary = useAppStore((s) => s.reorderBrushInLibrary);
  const exportBrushLibraryToDisk = useAppStore((s) => s.exportBrushLibraryToDisk);
  const importBrushLibraryFromJson = useAppStore((s) => s.importBrushLibraryFromJson);

  const [categoryFilter, setCategoryFilter] = useState<"All" | BrushCategory>("All");
  const [search, setSearch] = useState("");
  const [renameText, setRenameText] = useState("");

  const filtered = brushes.filter((b) => {
    if (categoryFilter !== "All" && b.category !== categoryFilter) return false;
    if (search.trim()) {
      return b.name.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  const activeIdx = brushes.findIndex((b) => b.id === activeBrushId);

  const handleLoadLibrary = async () => {
    const res = await getPlatform().openFileDialog();
    if (res && res.text) {
      importBrushLibraryFromJson(res.text);
    }
  };

  return (
    <div className="p-1.5 flex flex-col h-full gap-1.5 text-xs font-mono select-none overflow-y-auto">
      {/* Top Action Row */}
      <div className="flex flex-wrap items-center justify-between gap-1">
        <PixelButton
          size="xs"
          title="Save Current Brush Settings to Library"
          onClick={() => saveCurrentBrushToLibrary(renameText || undefined)}
        >
          + Add Brush
        </PixelButton>
        <PixelButton
          size="xs"
          title="Capture Custom Stamp Brush from Selection/Canvas (Ctrl+B)"
          onClick={() => captureCustomBrushFromCanvas(renameText || undefined)}
        >
          Stamp (Ctrl+B)
        </PixelButton>
        <PixelButton
          size="xs"
          title="Save Brush Library (.kpbrushes)"
          onClick={() => void exportBrushLibraryToDisk()}
        >
          Save .kpbrushes
        </PixelButton>
        <PixelButton
          size="xs"
          title="Load Brush Library (.kpbrushes)"
          onClick={() => void handleLoadLibrary()}
        >
          Load
        </PixelButton>
      </div>

      {/* Category & Search Filter */}
      <div className="flex items-center gap-1">
        <PixelSelect
          ariaLabel="Brush Category Filter"
          value={categoryFilter}
          onChange={(v) => setCategoryFilter(v as "All" | BrushCategory)}
          options={[
            { value: "All", label: "All Categories" },
            { value: "Basic", label: "Basic" },
            { value: "Pixel Art", label: "Pixel Art" },
            { value: "Dither & Texture", label: "Dither & Texture" },
            { value: "Custom Stamps", label: "Custom Stamps" },
          ]}
        />
        <TextField
          ariaLabel="Search Brushes"
          value={search}
          onChange={setSearch}
          placeholder="Search..."
          className="flex-1 min-w-0 px-1.5 py-0.5 text-[11px]"
        />
      </div>

      {/* Brush Presets Grid */}
      <div className="grid grid-cols-2 gap-1 max-h-36 overflow-y-auto kpx-bevel-inset bg-[var(--kpx-input-bg)] p-1">
        {filtered.map((b) => {
          const isSelected = b.id === activeBrushId;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                selectBrushPreset(b.id);
                setRenameText(b.name);
              }}
              className={`px-1.5 py-1 text-left text-[11px] flex items-center justify-between border ${
                isSelected
                  ? "bg-[var(--kpx-accent-bg)] text-white font-bold border-black"
                  : "bg-[var(--kpx-btn-bg)] text-black border-black/30 hover:brightness-105"
              }`}
            >
              <span className="truncate">{b.name}</span>
              {b.slot && (
                <span className="ml-1 text-[9px] opacity-75 shrink-0">Alt+{b.slot}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected Brush Management (Rename, Reorder, Delete) */}
      <div className="flex items-center gap-1">
        <TextField
          ariaLabel="Brush Name"
          value={renameText}
          onChange={setRenameText}
          placeholder="Brush name..."
          className="flex-1 min-w-0 px-1.5 py-0.5 text-[11px]"
        />
        <PixelButton
          size="xs"
          onClick={() => renameText.trim() && renameBrushInLibrary(activeBrushId, renameText)}
        >
          Rename
        </PixelButton>
        <PixelButton
          size="xs"
          title="Move Brush Earlier"
          disabled={activeIdx <= 0}
          onClick={() => reorderBrushInLibrary(activeIdx, activeIdx - 1)}
        >
          &lt;
        </PixelButton>
        <PixelButton
          size="xs"
          title="Move Brush Later"
          disabled={activeIdx < 0 || activeIdx >= brushes.length - 1}
          onClick={() => reorderBrushInLibrary(activeIdx, activeIdx + 1)}
        >
          &gt;
        </PixelButton>
        <PixelButton
          size="xs"
          title="Delete Selected Brush"
          disabled={brushes.length <= 1}
          onClick={() => deleteBrushFromLibrary(activeBrushId)}
        >
          Del
        </PixelButton>
      </div>

      {/* Size & Angle Quick Sliders */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex items-center justify-between">
          <span>Size:</span>
          <NumberField
            ariaLabel="Panel Brush Size"
            value={toolOptions.brushSize}
            min={1}
            max={128}
            suffix="px"
            widthClass="w-16"
            onChange={(v) => setToolOption("brushSize", v)}
          />
        </div>
        <div className="flex items-center justify-between">
          <span>Angle:</span>
          <NumberField
            ariaLabel="Panel Brush Angle"
            value={toolOptions.brushAngle}
            min={-180}
            max={180}
            suffix="°"
            widthClass="w-16"
            onChange={(v) => setToolOption("brushAngle", v)}
          />
        </div>
      </div>

      {/* Embedded Live Footprint & Interactive Scratchpad */}
      <div className="border-t border-black/25 pt-1">
        <BrushPreviewPanel />
      </div>
    </div>
  );
};

/**
 * 8. Info Panel
 */
export const InfoPanel: React.FC = () => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const cursorPos = useAppStore((s) => s.cursorPos);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const rev = useAppStore((s) => s.docRevision);
  void rev;

  if (!doc) return <div className="p-2 text-xs">No active document</div>;
  const s = doc.sprite;

  return (
    <div className="p-2 space-y-1 text-xs font-mono select-none">
      <div>Name: {s.name}</div>
      <div>
        Dimensions: {s.width} x {s.height} px
      </div>
      <div>Color Mode: {s.colorMode.toUpperCase()}</div>
      <div>
        Layers: {s.layers.length} | Frames: {s.frames.length}
      </div>
      <div>
        Cursor: {cursorPos ? `${cursorPos.x}, ${cursorPos.y}` : "Outside"}
      </div>
      <div>
        Active Frame: #{activeFrameIndex + 1} ({s.frames[activeFrameIndex]?.durationMs ?? 100} ms)
      </div>
      <div>
        Selection: {s.mask.bounds ? `${s.mask.bounds.width}x${s.mask.bounds.height}` : "None"}
      </div>
    </div>
  );
};

/**
 * 9. Navigator Panel
 */
export const NavigatorPanel: React.FC = () => {
  const zoom = useAppStore((s) => s.zoom);
  const setZoom = useAppStore((s) => s.setZoom);
  const setPan = useAppStore((s) => s.setPan);

  return (
    <div className="p-2 space-y-2 text-xs font-mono select-none">
      <PixelSlider
        label="Zoom %"
        value={zoom}
        min={50}
        max={1600}
        onChange={(v) => setZoom(v)}
      />
      <div className="flex flex-wrap gap-1">
        {[100, 200, 400, 800].map((z) => (
          <PixelButton key={z} size="xs" active={zoom === z} onClick={() => setZoom(z)}>
            {z}%
          </PixelButton>
        ))}
        <PixelButton size="xs" onClick={() => setPan(0, 0)}>
          Center
        </PixelButton>
      </div>
    </div>
  );
};

/**
 * 10. Log Viewer Panel (500-line ring buffer)
 */
export const LogViewerPanel: React.FC = () => {
  const [entries, setEntries] = useState<LogEntry[]>(() => appLogger.getEntries());

  useEffect(() => {
    const sync = () => setEntries(appLogger.getEntries());
    const unsub1 = appLogger.events.on("logged", sync);
    const unsub2 = appLogger.events.on("cleared", sync);
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  return (
    <div className="flex flex-col h-full p-1.5 gap-1 select-none">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono font-bold">
          Diagnostic Log ({entries.length}/500 lines)
        </span>
        <div className="flex items-center gap-1">
          <PixelButton
            size="xs"
            onClick={() => appLogger.info("UserTest", "Manual diagnostic log ping OK")}
          >
            + Test Log
          </PixelButton>
          <PixelButton size="xs" onClick={() => appLogger.clear()}>
            Clear
          </PixelButton>
        </div>
      </div>
      <div className="flex-1 kpx-bevel-inset bg-[#141418] text-[#e2e8f0] p-1.5 overflow-y-auto font-mono text-[11px] space-y-0.5">
        {entries.map((e) => (
          <div key={e.id} className="leading-tight">
            <span className="text-[#94a3b8]">[{e.timestamp}]</span>{" "}
            <span
              className={
                e.level === "error"
                  ? "text-red-400 font-bold"
                  : e.level === "warn"
                  ? "text-amber-300"
                  : "text-emerald-300"
              }
            >
              [{e.source}]
            </span>{" "}
            <span>{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * 11. Compact Feature Center Dock Panel (QA flavor only)
 */
export const FeatureCenterPanel: React.FC = () => {
  if (import.meta.env.VITE_KP_FLAVOR === "release") {
    return null;
  }
  const openDialog = useAppStore((s) => s.openDialog);
  const total = FeatureRegistry.getAll().length;
  const tested = FeatureRegistry.getAll().filter((f) => f.state === "tested").length;

  return (
    <div className="p-2 flex flex-col gap-2 text-xs font-mono select-none">
      <div>Total Registered Features: {total}</div>
      <div>Tested &amp; Passing: {tested}</div>
      <PixelButton onClick={() => openDialog("dialog.feature_center")}>
        Open Diagnostics...
      </PixelButton>
    </div>
  );
};

/**
 * Renders any registered panel by ID.
 */
export const PanelContentRenderer: React.FC<{ panelId: string }> = ({ panelId }) => {
  switch (panelId) {
    case "panel.colorbar":
      return <ColorBarPanel />;
    case "panel.colorpicker":
      return <ColorPickerPanel />;
    case "panel.palette_editor":
      return <PaletteEditorPanel />;
    case "panel.timeline":
      return <TimelinePanel />;
    case "panel.preview":
      return <PreviewPanel />;
    case "panel.history":
      return <HistoryPanel />;
    case "panel.layers":
      return <LayersPanel />;
    case "panel.brushes":
      return <BrushesPanel />;
    case "panel.brush_preview":
      return <BrushPreviewPanel />;
    case "panel.tileset":
      return <TilesetPanel />;
    case "panel.tags":
      return <TagsPanel />;
    case "panel.slices":
      return <SlicesPanel />;
    case "panel.info":
      return <InfoPanel />;
    case "panel.navigator":
      return <NavigatorPanel />;
    case "panel.logviewer":
      return import.meta.env.VITE_KP_FLAVOR === "release" ? null : <LogViewerPanel />;
    case "panel.featurecenter":
      return import.meta.env.VITE_KP_FLAVOR === "release" ? null : <FeatureCenterPanel />;
    case "panel.script_editor":
      return <ScriptEditorPanel />;
    case "panel.extensions":
      return <ExtensionsManagerPanel />;
    default:
      return <div className="p-2 text-xs">Panel {panelId}</div>;
  }
};
