/**
 * @module @kekenik/ui/featurecenter/agent4-dialogs
 * All 11 Agent-4 Modal Dialogs:
 * 1. PaletteEditorDialog (`dialog.palette_editor`)
 * 2. ColorModeDialog (`dialog.color_mode`)
 * 3. SelectModifyDialog (`dialog.select_modify`)
 * 4. ColorRangeDialog (`dialog.color_range`)
 * 5. SavedMasksDialog (`dialog.saved_masks`)
 * 6. RotateAngleDialog (`dialog.rotate_angle`)
 * 7. ShiftPixelsDialog (`dialog.shift_pixels`)
 * 8. PasteSpecialDialog (`dialog.paste_special`)
 * 9. FilterStudioDialog (`dialog.filter_fx`)
 * 10. SpritePropertiesDialog (`dialog.sprite_properties`)
 * 11. DuplicateSpriteDialog (`dialog.duplicate_sprite`)
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  applyBrightnessContrastFilter,
  applyColorCurveFilter,
  applyConvolutionMatrixFilter,
  applyDespeckleFilter,
  applyDropShadowFilter,
  ApplyFilterToCelsCommand,
  applyHueSaturationFilter,
  applyInvertFilter,
  applyOutlineFilter,
  applyPosterizeFilter,
  applyReplaceColorFilter,
  borderMask,
  BUILTIN_PALETTE_PRESETS,
  ColorMode,
  combineMasks,
  computeImageHistogram,
  contractMask,
   convertImageColorMode,
  CONVOLUTION_PRESETS,
  createModelId,
  decodeActPalette,
  decodeColPalette,
  decodeGplPalette,
  decodeHexPalette,
  decodeJascPalPalette,
  decodeRiffPalPalette,
  decodeSavedMask,
  DEFAULT_FILTER_CHANNELS,
  encodeActPalette,
  encodeColPalette,
  encodeGplPalette,
  encodeHexPalette,
  encodeJascPalPalette,
  encodeRiffPalPalette,
  encodeSavedMask,
  evaluateCurveLUT,
  expandMask,
  extractPaletteFromSprite,
  featherMask,
  FilterTargetChannels,
  FilterTargetScope,
  generatePaletteRamp,
  getCel,
  getOutlineMatrixForPattern,
  getPaletteForFrame,
  getPaletteSpanForFrame,
  getPlatform,
  hexToRgba,
  IndexedDitherAlgorithm,
  ManageSavedMaskCommand,
  OutlinePatternPreset,
  PaletteRampColorSpace,
  PaletteSortCriterion,
  PixelImage,
  Point,
  reversePaletteColors,
  RGBA,
  rgbaToHex,
  selectByColorRange,
  SelectionCombineMode,
  SelectionModifyShape,
  sortPaletteColors,
  TransformSpriteOrCelCommand,
  UpdatePaletteAndRemapCommand,
  UpdateSpritePropertiesCommand,
} from "../../../core/src/index.ts";
import { useAppStore } from "../app/store.ts";
import {
  ColorInputField,
  ColorSwatch,
  NumberField,
  PixelButton,
  PixelCheckbox,
  PixelDialog,
  PixelSelect,
  PixelSlider,
  PixelTabs,
  SectionDivider,
  TextField,
} from "../widgets/index.tsx";

/**
 * Helper to draw a PixelImage onto a small HTMLCanvasElement preview.
 */
function drawPixelImagePreview(
  canvas: HTMLCanvasElement | null,
  image: PixelImage,
  palette: readonly RGBA[],
  transparentIndex: number
): void {
  if (!canvas) return;
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const idata = ctx.createImageData(image.width, image.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const c = image.getRGBA(x, y, palette, transparentIndex);
      const chk = ((x >> 2) + (y >> 2)) % 2 === 0 ? 130 : 95;
      const a = c.a / 255;
      const idx = (y * image.width + x) * 4;
      idata.data[idx] = Math.round(c.r * a + chk * (1 - a));
      idata.data[idx + 1] = Math.round(c.g * a + chk * (1 - a));
      idata.data[idx + 2] = Math.round(c.b * a + chk * (1 - a));
      idata.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(idata, 0, 0);
}

/**
 * 1. Palette Editor & Per-Frame Palette Spans Dialog (`dialog.palette_editor`)
 */
export const PaletteEditorDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const frameIndex = useAppStore((s) => s.activeFrameIndex);
  const fgPaletteIndex = useAppStore((s) => s.fgPaletteIndex);
  const selectedSwatchIndices = useAppStore((s) => s.selectedSwatchIndices);
  const remapOnPaletteEdit = useAppStore((s) => s.remapOnPaletteEdit);
  const selectSwatchWithModifiers = useAppStore((s) => s.selectSwatchWithModifiers);
  const setRemapOnPaletteEdit = useAppStore((s) => s.setRemapOnPaletteEdit);
  const setFgColor = useAppStore((s) => s.setFgColor);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  void rev;
  if (!doc) return null;

  const sprite = doc.sprite;
  const activeSpan = getPaletteSpanForFrame(sprite, frameIndex);
  const colors = activeSpan.colors;
  const currentColor = colors[fgPaletteIndex] ?? colors[0] ?? { r: 0, g: 0, b: 0, a: 255 };

  const [rampSpace, setRampSpace] = useState<PaletteRampColorSpace>("rgb");
  const [sortBy, setSortBy] = useState<PaletteSortCriterion>("luminance");
  const [quantCount, setQuantCount] = useState(16);
  const [quantAlg, setQuantAlg] = useState<"median_cut" | "kmeans" | "unique">("median_cut");
  const [targetSize, setTargetSize] = useState(colors.length);
  const [entryName, setEntryName] = useState(activeSpan.entryNames?.[fgPaletteIndex] ?? "");
  const [newSpanFrom, setNewSpanFrom] = useState(frameIndex);
  const [newSpanTo, setNewSpanTo] = useState(Math.max(frameIndex, sprite.frames.length - 1));

  useEffect(() => {
    setEntryName(activeSpan.entryNames?.[fgPaletteIndex] ?? "");
  }, [fgPaletteIndex, activeSpan]);

  const applySpanUpdate = (
    label: string,
    nextColors: RGBA[],
    oldToNewIndexMap?: number[],
    nextNames?: Record<number, string>
  ) => {
    const nextPalettes = sprite.palettes.map((p) =>
      p.id === activeSpan.id
        ? {
            ...p,
            colors: nextColors.map((c) => ({ ...c })),
            entryNames: nextNames ?? p.entryNames,
          }
        : { ...p, colors: p.colors.map((c) => ({ ...c })) }
    );
    doc.execute(
      new UpdatePaletteAndRemapCommand({
        label,
        nextPalettes,
        oldToNewIndexMap,
        remapPixels: remapOnPaletteEdit && sprite.colorMode === "indexed",
      })
    );
    bumpRevision();
  };

  const handleResizePalette = () => {
    const next: RGBA[] = [];
    for (let i = 0; i < targetSize; i++) {
      next.push(colors[i] ? { ...colors[i] } : { r: 0, g: 0, b: 0, a: 255 });
    }
    applySpanUpdate(`Resize Palette to ${targetSize}`, next);
  };

  const handleCreateFrameSpan = () => {
    const span = {
      id: createModelId("pal_span"),
      name: `Frames ${newSpanFrom + 1}..${newSpanTo + 1}`,
      fromFrame: newSpanFrom,
      toFrame: newSpanTo,
      colors: colors.map((c) => ({ ...c })),
    };
    doc.execute(
      new UpdatePaletteAndRemapCommand({
        label: "Add Per-Frame Palette Span",
        nextPalettes: [...sprite.palettes, span],
      })
    );
    bumpRevision();
  };

  const handleExportFormat = async (fmt: "gpl" | "pal_jasc" | "pal_riff" | "hex" | "act" | "col") => {
    if (fmt === "gpl") {
      await getPlatform().saveFileDialog(
        encodeGplPalette(colors, activeSpan.name, activeSpan.entryNames),
        { defaultName: "palette.gpl" }
      );
    } else if (fmt === "pal_jasc") {
      await getPlatform().saveFileDialog(encodeJascPalPalette(colors), {
        defaultName: "palette.pal",
      });
    } else if (fmt === "pal_riff") {
      const bytes = encodeRiffPalPalette(colors);
      await getPlatform().saveFileDialog(new TextDecoder().decode(bytes), {
        defaultName: "palette-riff.pal",
      });
    } else if (fmt === "hex") {
      await getPlatform().saveFileDialog(encodeHexPalette(colors), {
        defaultName: "palette.hex",
      });
    } else if (fmt === "act") {
      const bytes = encodeActPalette(colors);
      await getPlatform().saveFileDialog(new TextDecoder().decode(bytes), {
        defaultName: "palette.act",
      });
    } else {
      const bytes = encodeColPalette(colors);
      await getPlatform().saveFileDialog(new TextDecoder().decode(bytes), {
        defaultName: "palette.col",
      });
    }
  };

  return (
    <PixelDialog
      title={`Palette Editor & Ramp Studio — ${activeSpan.name} (${colors.length} colors)`}
      onClose={onClose}
      widthClass="w-[680px]"
    >
      <div className="space-y-3">
        {/* Swatch Grid */}
        <div className="p-2 bg-[#4a434f] kpx-bevel-inset max-h-36 overflow-y-auto flex flex-wrap gap-0.5">
          {colors.map((c, idx) => (
            <ColorSwatch
              key={idx}
              color={c}
              size={20}
              selected={fgPaletteIndex === idx || selectedSwatchIndices.includes(idx)}
              isTransparentIndex={idx === sprite.transparentIndex}
              title={`#${idx} ${activeSpan.entryNames?.[idx] ?? ""} ${rgbaToHex(c)}`}
              onClick={(e) =>
                selectSwatchWithModifiers(
                  idx,
                  Boolean(e?.shiftKey),
                  Boolean(e?.ctrlKey || e?.metaKey)
                )
              }
            />
          ))}
        </div>

        {/* Active Entry Editor */}
        <div className="grid grid-cols-2 gap-3 bg-black/10 p-2 border border-black/25">
          <div className="space-y-1.5">
            <div className="font-bold">
              Swatch #{fgPaletteIndex} ({rgbaToHex(currentColor)})
            </div>
            <div className="flex items-center gap-1">
              <span>Name:</span>
              <TextField
                value={entryName}
                onChange={(val) => {
                  setEntryName(val);
                  const nextNames = { ...(activeSpan.entryNames ?? {}), [fgPaletteIndex]: val };
                  applySpanUpdate("Name Swatch", colors, undefined, nextNames);
                }}
                placeholder="Swatch name..."
                className="flex-1"
              />
            </div>
            <div className="grid grid-cols-4 gap-1">
              <NumberField
                ariaLabel="Swatch Red"
                value={currentColor.r}
                min={0}
                max={255}
                widthClass="w-14"
                onChange={(r) => {
                  const next = colors.map((c, i) => (i === fgPaletteIndex ? { ...c, r } : c));
                  setFgColor({ ...currentColor, r }, fgPaletteIndex);
                  applySpanUpdate("Edit Swatch R", next);
                }}
              />
              <NumberField
                ariaLabel="Swatch Green"
                value={currentColor.g}
                min={0}
                max={255}
                widthClass="w-14"
                onChange={(g) => {
                  const next = colors.map((c, i) => (i === fgPaletteIndex ? { ...c, g } : c));
                  setFgColor({ ...currentColor, g }, fgPaletteIndex);
                  applySpanUpdate("Edit Swatch G", next);
                }}
              />
              <NumberField
                ariaLabel="Swatch Blue"
                value={currentColor.b}
                min={0}
                max={255}
                widthClass="w-14"
                onChange={(b) => {
                  const next = colors.map((c, i) => (i === fgPaletteIndex ? { ...c, b } : c));
                  setFgColor({ ...currentColor, b }, fgPaletteIndex);
                  applySpanUpdate("Edit Swatch B", next);
                }}
              />
              <NumberField
                ariaLabel="Swatch Alpha"
                value={currentColor.a}
                min={0}
                max={255}
                widthClass="w-14"
                onChange={(a) => {
                  const next = colors.map((c, i) => (i === fgPaletteIndex ? { ...c, a } : c));
                  setFgColor({ ...currentColor, a }, fgPaletteIndex);
                  applySpanUpdate("Edit Swatch A", next);
                }}
              />
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              <PixelButton
                size="xs"
                onClick={() => applySpanUpdate("Add Swatch", [...colors, { ...currentColor }])}
              >
                + Add
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => {
                  const next = [...colors];
                  next.splice(fgPaletteIndex + 1, 0, { ...currentColor });
                  applySpanUpdate("Duplicate Swatch", next);
                }}
              >
                Duplicate
              </PixelButton>
              <PixelButton
                size="xs"
                disabled={colors.length <= 2}
                onClick={() => {
                  const next = colors.filter((_, i) => i !== fgPaletteIndex);
                  applySpanUpdate("Remove Swatch", next);
                }}
              >
                Remove
              </PixelButton>
              <NumberField
                ariaLabel="Palette Size"
                value={targetSize}
                min={2}
                max={256}
                widthClass="w-14"
                onChange={setTargetSize}
              />
              <PixelButton size="xs" onClick={handleResizePalette}>
                Resize
              </PixelButton>
            </div>
          </div>

          {/* Ramp, Sort & Remap */}
          <div className="space-y-1.5">
            <div className="font-bold">Ramp, Sort &amp; Indexed Remap</div>
            <PixelCheckbox
              checked={remapOnPaletteEdit}
              onChange={setRemapOnPaletteEdit}
              label="Remap Indexed Pixels When Sorting/Moving"
            />
            <div className="flex items-center gap-1">
              <span>Ramp [{Math.min(...selectedSwatchIndices)}..{Math.max(...selectedSwatchIndices)}]:</span>
              <PixelSelect
                ariaLabel="Dialog Ramp Color Space"
                value={rampSpace}
                onChange={(v) => setRampSpace(v as PaletteRampColorSpace)}
                options={[
                  { value: "rgb", label: "RGB" },
                  { value: "hsv", label: "HSV" },
                  { value: "hsl", label: "HSL" },
                ]}
              />
              <PixelButton
                size="xs"
                onClick={() => {
                  const lo =
                    selectedSwatchIndices.length >= 2 ? Math.min(...selectedSwatchIndices) : 0;
                  const hi =
                    selectedSwatchIndices.length >= 2
                      ? Math.max(...selectedSwatchIndices)
                      : colors.length - 1;
                  applySpanUpdate(
                    "Generate Gradient Ramp",
                    generatePaletteRamp(colors, lo, hi, rampSpace)
                  );
                }}
              >
                Generate Ramp
              </PixelButton>
            </div>

            <div className="flex items-center gap-1">
              <PixelSelect
                ariaLabel="Palette Sort Criterion"
                value={sortBy}
                onChange={(v) => setSortBy(v as PaletteSortCriterion)}
                options={[
                  { value: "luminance", label: "Luminance" },
                  { value: "hue", label: "Hue" },
                  { value: "saturation", label: "Saturation" },
                  { value: "value", label: "Value" },
                  { value: "red", label: "Red" },
                  { value: "green", label: "Green" },
                  { value: "blue", label: "Blue" },
                  { value: "alpha", label: "Alpha" },
                ]}
              />
              <PixelButton
                size="xs"
                onClick={() => {
                  const { colors: sorted, oldToNewIndexMap } = sortPaletteColors(
                    colors,
                    sortBy,
                    true
                  );
                  applySpanUpdate(`Sort by ${sortBy} Asc`, sorted, oldToNewIndexMap);
                }}
              >
                Sort Asc
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => {
                  const { colors: sorted, oldToNewIndexMap } = sortPaletteColors(
                    colors,
                    sortBy,
                    false
                  );
                  applySpanUpdate(`Sort by ${sortBy} Desc`, sorted, oldToNewIndexMap);
                }}
              >
                Sort Desc
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => {
                  const { colors: revCols, oldToNewIndexMap } = reversePaletteColors(colors);
                  applySpanUpdate("Reverse Palette", revCols, oldToNewIndexMap);
                }}
              >
                Reverse
              </PixelButton>
            </div>
          </div>
        </div>

        {/* Built-in Presets & Quantizer */}
        <SectionDivider label="Palette Presets (12) & Quantize from Sprite" />
        <div className="grid grid-cols-2 gap-3">
          <div className="grid grid-cols-3 gap-1 max-h-28 overflow-y-auto p-1 bg-black/10 border border-black/20">
            {BUILTIN_PALETTE_PRESETS.map((preset) => (
              <PixelButton
                key={preset.id}
                size="xs"
                title={`${preset.name} (${preset.colors.length} colors — ${preset.license})`}
                onClick={() => applySpanUpdate(`Preset: ${preset.name}`, [...preset.colors])}
              >
                {preset.name.split(" ")[0]}
              </PixelButton>
            ))}
          </div>

          <div className="space-y-1.5 bg-black/10 p-2 border border-black/20">
            <div className="font-bold">Extract Palette from Sprite</div>
            <div className="flex items-center gap-1">
              <span>Max Colors:</span>
              <NumberField
                ariaLabel="Quantize Max Colors"
                value={quantCount}
                min={2}
                max={256}
                widthClass="w-14"
                onChange={setQuantCount}
              />
              <PixelSelect
                ariaLabel="Quantizer Algorithm"
                value={quantAlg}
                onChange={(v) => setQuantAlg(v as "median_cut" | "kmeans" | "unique")}
                options={[
                  { value: "median_cut", label: "Median-Cut" },
                  { value: "kmeans", label: "K-Means" },
                  { value: "unique", label: "Unique Colors" },
                ]}
              />
              <PixelButton
                size="xs"
                onClick={() => {
                  const extracted = extractPaletteFromSprite(sprite, quantCount, quantAlg);
                  applySpanUpdate(`Quantize (${quantAlg}, ${quantCount})`, extracted);
                }}
              >
                Extract
              </PixelButton>
            </div>
          </div>
        </div>

        {/* Per-Frame Palette Spans & Formats */}
        <SectionDivider label="Per-Frame Palette Spans & Palette File Codecs" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <span>Spans ({sprite.palettes.length}):</span>
            <NumberField
              ariaLabel="Palette Span From Frame"
              value={newSpanFrom + 1}
              min={1}
              max={sprite.frames.length}
              widthClass="w-12"
              onChange={(v) => setNewSpanFrom(v - 1)}
            />
            <span>..</span>
            <NumberField
              ariaLabel="Palette Span To Frame"
              value={newSpanTo + 1}
              min={1}
              max={sprite.frames.length}
              widthClass="w-12"
              onChange={(v) => setNewSpanTo(v - 1)}
            />
            <PixelButton size="xs" onClick={handleCreateFrameSpan}>
              + Per-Frame Palette Span
            </PixelButton>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <PixelButton size="xs" onClick={() => void handleExportFormat("gpl")}>
              .gpl
            </PixelButton>
            <PixelButton size="xs" onClick={() => void handleExportFormat("pal_jasc")}>
              .pal (JASC)
            </PixelButton>
            <PixelButton size="xs" onClick={() => void handleExportFormat("pal_riff")}>
              .pal (RIFF)
            </PixelButton>
            <PixelButton size="xs" onClick={() => void handleExportFormat("hex")}>
              .hex
            </PixelButton>
            <PixelButton size="xs" onClick={() => void handleExportFormat("act")}>
              .act
            </PixelButton>
            <PixelButton size="xs" onClick={() => void handleExportFormat("col")}>
              .col
            </PixelButton>
            <PixelButton onClick={onClose}>Close</PixelButton>
          </div>
        </div>
      </div>
    </PixelDialog>
  );
};

// Re-export palette decoders so Vitest & self-tests can import from dialogs if needed
export {
  decodeActPalette,
  decodeColPalette,
  decodeGplPalette,
  decodeHexPalette,
  decodeJascPalPalette,
  decodeRiffPalPalette,
};

/**
 * 2. Color Mode & Indexed Dithering Conversion Dialog (`dialog.color_mode`)
 */
export const ColorModeDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const convertActiveSpriteColorMode = useAppStore((s) => s.convertActiveSpriteColorMode);

  if (!doc) return null;
  const sprite = doc.sprite;

  const [targetMode, setTargetMode] = useState<ColorMode>(
    sprite.colorMode === "indexed" ? "rgba" : "indexed"
  );
  const [dither, setDither] = useState<IndexedDitherAlgorithm>("floyd_steinberg");
  const [paletteSource, setPaletteSource] = useState<"current" | "median_cut" | "kmeans" | "preset">(
    "current"
  );
  const [quantColors, setQuantColors] = useState(16);
  const [presetId, setPresetId] = useState("pico8");
  const [transparentIdx, setTransparentIdx] = useState(sprite.transparentIndex);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const targetPalette = useMemo(() => {
    if (paletteSource === "median_cut") {
      return extractPaletteFromSprite(sprite, quantColors, "median_cut");
    }
    if (paletteSource === "kmeans") {
      return extractPaletteFromSprite(sprite, quantColors, "kmeans");
    }
    if (paletteSource === "preset") {
      const found =
        BUILTIN_PALETTE_PRESETS.find((p) => p.id === presetId) ?? BUILTIN_PALETTE_PRESETS[0];
      return [...found.colors];
    }
    return getPaletteForFrame(sprite, activeFrameIndex);
  }, [sprite, activeFrameIndex, paletteSource, quantColors, presetId]);

  useEffect(() => {
    const cel = getCel(sprite, activeLayerId, activeFrameIndex) ?? sprite.cels[0];
    if (!cel) return;
    const converted = convertImageColorMode(
      cel.image,
      targetMode,
      targetPalette,
      transparentIdx,
      dither
    );
    drawPixelImagePreview(previewCanvasRef.current, converted, targetPalette, transparentIdx);
  }, [sprite, activeLayerId, activeFrameIndex, targetMode, dither, targetPalette, transparentIdx]);

  return (
    <PixelDialog
      title={`Sprite > Color Mode Conversion (Current: ${sprite.colorMode.toUpperCase()})`}
      onClose={onClose}
      widthClass="w-[520px]"
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div>
              <div className="font-bold mb-1">Target Color Mode:</div>
              <PixelSelect
                ariaLabel="Target Color Mode"
                value={targetMode}
                onChange={(v) => setTargetMode(v as ColorMode)}
                options={[
                  { value: "indexed", label: "Indexed (1 B/px Palette)" },
                  { value: "rgba", label: "RGB Color (4 B/px RGBA)" },
                  { value: "grayscale", label: "Grayscale (2 B/px Luma+Alpha)" },
                ]}
                className="w-full"
              />
            </div>

            {targetMode === "indexed" && (
              <>
                <div>
                  <div className="font-bold mb-1">Dithering Algorithm:</div>
                  <PixelSelect
                    ariaLabel="Indexed Conversion Dithering"
                    value={dither}
                    onChange={(v) => setDither(v as IndexedDitherAlgorithm)}
                    options={[
                      { value: "none", label: "No Dithering (Nearest)" },
                      { value: "bayer2x2", label: "Ordered Bayer Matrix 2x2" },
                      { value: "bayer4x4", label: "Ordered Bayer Matrix 4x4" },
                      { value: "bayer8x8", label: "Ordered Bayer Matrix 8x8" },
                      { value: "floyd_steinberg", label: "Floyd–Steinberg Error Diffusion" },
                      { value: "old_style", label: "Old-Style 50/50 Checker" },
                    ]}
                    className="w-full"
                  />
                </div>

                <div>
                  <div className="font-bold mb-1">Palette Source:</div>
                  <PixelSelect
                    ariaLabel="Indexed Palette Source"
                    value={paletteSource}
                    onChange={(v) =>
                      setPaletteSource(v as "current" | "median_cut" | "kmeans" | "preset")
                    }
                    options={[
                      { value: "current", label: "Current Sprite Palette" },
                      { value: "median_cut", label: "New Palette (Median-Cut)" },
                      { value: "kmeans", label: "New Palette (K-Means)" },
                      { value: "preset", label: "Built-in Palette Preset" },
                    ]}
                    className="w-full"
                  />
                </div>

                {(paletteSource === "median_cut" || paletteSource === "kmeans") && (
                  <div className="flex items-center justify-between">
                    <span>Colors (2..256):</span>
                    <NumberField
                      ariaLabel="Indexed Quantize Colors"
                      value={quantColors}
                      min={2}
                      max={256}
                      onChange={setQuantColors}
                    />
                  </div>
                )}

                {paletteSource === "preset" && (
                  <PixelSelect
                    ariaLabel="Indexed Preset Choice"
                    value={presetId}
                    onChange={setPresetId}
                    options={BUILTIN_PALETTE_PRESETS.map((p) => ({
                      value: p.id,
                      label: `${p.name} (${p.colors.length})`,
                    }))}
                    className="w-full"
                  />
                )}

                <div className="flex items-center justify-between">
                  <span>Transparent Index:</span>
                  <NumberField
                    ariaLabel="Transparent Palette Index"
                    value={transparentIdx}
                    min={0}
                    max={255}
                    onChange={setTransparentIdx}
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-col items-center justify-center bg-[#231f28] kpx-bevel-inset p-2">
            <div className="text-[10px] text-white/80 mb-1">Live Conversion Preview</div>
            <canvas
              ref={previewCanvasRef}
              style={{
                width: 144,
                height: 144,
                imageRendering: "pixelated",
              }}
              className="border border-black"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-black/25">
          <PixelButton
            onClick={() => {
              convertActiveSpriteColorMode(
                targetMode,
                dither,
                paletteSource === "current" ? undefined : targetPalette,
                transparentIdx
              );
              onClose();
            }}
          >
            Convert Sprite
          </PixelButton>
          <PixelButton onClick={onClose}>Cancel</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 3. Modify Selection Dialog (`dialog.select_modify` — Expand, Contract, Border, Feather)
 */
export const SelectModifyDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const [op, setOp] = useState<"expand" | "contract" | "border" | "feather">("expand");
  const [radius, setRadius] = useState(2);
  const [shape, setShape] = useState<SelectionModifyShape>("square");

  if (!doc) return null;

  const handleApply = () => {
    const baseMask = doc.sprite.mask;
    if (baseMask.isEmpty) {
      onClose();
      return;
    }
    let nextMask = baseMask.clone();
    if (op === "expand") {
      nextMask = expandMask(baseMask, radius, shape);
    } else if (op === "contract") {
      nextMask = contractMask(baseMask, radius, shape);
    } else if (op === "border") {
      nextMask = borderMask(baseMask, radius, shape);
    } else {
      nextMask = featherMask(baseMask, radius).mask;
    }
    doc.transact(`Select > ${op.toUpperCase()} (${radius}px)`, (tx) =>
      tx.setMask(nextMask, `Modify Selection (${op})`)
    );
    bumpRevision();
    onClose();
  };

  return (
    <PixelDialog title="Modify Selection (Expand / Contract / Border / Feather)" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span>Modification:</span>
          <PixelSelect
            ariaLabel="Modify Selection Operation"
            value={op}
            onChange={(v) => setOp(v as "expand" | "contract" | "border" | "feather")}
            options={[
              { value: "expand", label: "Expand Selection" },
              { value: "contract", label: "Contract Selection" },
              { value: "border", label: "Border Selection" },
              { value: "feather", label: "Feather Selection" },
            ]}
          />
        </div>
        <div className="flex items-center justify-between">
          <span>By (Pixels):</span>
          <NumberField
            ariaLabel="Modify Selection Radius"
            value={radius}
            min={1}
            max={64}
            suffix="px"
            onChange={setRadius}
          />
        </div>
        <div className="flex items-center justify-between">
          <span>Brush Kernel:</span>
          <PixelSelect
            ariaLabel="Modify Selection Kernel"
            value={shape}
            onChange={(v) => setShape(v as SelectionModifyShape)}
            options={[
              { value: "square", label: "Square" },
              { value: "circle", label: "Circle" },
            ]}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-black/25">
          <PixelButton onClick={handleApply}>Apply</PixelButton>
          <PixelButton onClick={onClose}>Cancel</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 4. Select by Color Range Dialog (`dialog.color_range`)
 */
export const ColorRangeDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const fgColor = useAppStore((s) => s.fgColor);
  const bgColor = useAppStore((s) => s.bgColor);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const [targetColor, setTargetColor] = useState<RGBA>(fgColor);
  const [fuzziness, setFuzziness] = useState(16);
  const [mode, setMode] = useState<SelectionCombineMode>("replace");

  if (!doc) return null;
  const sprite = doc.sprite;
  const cel = getCel(sprite, activeLayerId, activeFrameIndex) ?? sprite.cels[0];
  const pal = getPaletteForFrame(sprite, activeFrameIndex);

  const previewMask = useMemo(() => {
    if (!cel) return null;
    return selectByColorRange(cel.image, targetColor, fuzziness, pal, sprite.transparentIndex);
  }, [cel, targetColor, fuzziness, pal, sprite.transparentIndex]);

  return (
    <PixelDialog title="Select > Color Range" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span>Target Color:</span>
          <div className="flex items-center gap-1">
            <ColorInputField
              value={rgbaToHex(targetColor).slice(0, 7)}
              onChange={(hex) => setTargetColor(hexToRgba(hex))}
              className="w-8 h-6"
            />
            <PixelButton size="xs" onClick={() => setTargetColor(fgColor)}>
              Use FG
            </PixelButton>
            <PixelButton size="xs" onClick={() => setTargetColor(bgColor)}>
              Use BG
            </PixelButton>
          </div>
        </div>

        <PixelSlider
          label="Fuzziness / Tolerance"
          value={fuzziness}
          min={0}
          max={255}
          onChange={setFuzziness}
        />

        <div className="flex items-center justify-between">
          <span>Combine Mode:</span>
          <PixelSelect
            ariaLabel="Color Range Combine Mode"
            value={mode}
            onChange={(v) => setMode(v as SelectionCombineMode)}
            options={[
              { value: "replace", label: "Replace Selection" },
              { value: "add", label: "Add to Selection" },
              { value: "subtract", label: "Subtract from Selection" },
              { value: "intersect", label: "Intersect Selection" },
            ]}
          />
        </div>

        <div className="text-[11px] bg-black/10 p-1.5 border border-black/20">
          Matching Bounds:{" "}
          {previewMask?.bounds
            ? `${previewMask.bounds.x},${previewMask.bounds.y} (${previewMask.bounds.width}x${previewMask.bounds.height})`
            : "0 pixels"}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-black/25">
          <PixelButton
            onClick={() => {
              if (previewMask) {
                const combined = combineMasks(sprite.mask, previewMask, mode);
                doc.transact("Select by Color Range", (tx) =>
                  tx.setMask(combined, "Select by Color Range")
                );
                bumpRevision();
              }
              onClose();
            }}
          >
            Select
          </PixelButton>
          <PixelButton onClick={onClose}>Cancel</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 5. Save / Load Named Selection Masks Dialog (`dialog.saved_masks`)
 */
export const SavedMasksDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const bumpRevision = useAppStore((s) => s.bumpRevision);
  const [maskName, setMaskName] = useState("Selection-1");

  void rev;
  if (!doc) return null;
  const sprite = doc.sprite;
  const savedList = sprite.savedMasks ?? [];

  const handleSaveCurrent = () => {
    if (sprite.mask.isEmpty) return;
    const entry = encodeSavedMask(sprite.mask, maskName);
    doc.execute(
      new ManageSavedMaskCommand(`Save Selection "${entry.name}"`, (prev) => [...prev, entry])
    );
    bumpRevision();
  };

  return (
    <PixelDialog title="Select > Save / Load Selection Masks" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center gap-1">
          <TextField
            value={maskName}
            onChange={setMaskName}
            placeholder="Selection name..."
            className="flex-1"
          />
          <PixelButton disabled={sprite.mask.isEmpty} onClick={handleSaveCurrent}>
            + Save Active Mask
          </PixelButton>
        </div>

        <div className="space-y-1 max-h-48 overflow-y-auto kpx-bevel-inset bg-[var(--kpx-input-bg)] p-1.5">
          {savedList.length === 0 ? (
            <div className="text-[11px] opacity-70 p-2">No saved selections in this sprite.</div>
          ) : (
            savedList.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between px-2 py-1 bg-black/10 border border-black/20"
              >
                <span className="font-bold">{entry.name}</span>
                <div className="flex items-center gap-1">
                  <PixelButton
                    size="xs"
                    onClick={() => {
                      const restored = decodeSavedMask(entry, sprite.width, sprite.height);
                      doc.transact(`Load Selection "${entry.name}"`, (tx) =>
                        tx.setMask(restored, `Load Selection "${entry.name}"`)
                      );
                      bumpRevision();
                      onClose();
                    }}
                  >
                    Load
                  </PixelButton>
                  <PixelButton
                    size="xs"
                    onClick={() => {
                      const restored = decodeSavedMask(entry, sprite.width, sprite.height);
                      const added = combineMasks(sprite.mask, restored, "add");
                      doc.transact(`Add Saved Selection "${entry.name}"`, (tx) =>
                        tx.setMask(added, `Add Selection "${entry.name}"`)
                      );
                      bumpRevision();
                    }}
                  >
                    +Add
                  </PixelButton>
                  <PixelButton
                    size="xs"
                    onClick={() => {
                      doc.execute(
                        new ManageSavedMaskCommand("Delete Saved Selection", (prev) =>
                          prev.filter((m) => m.id !== entry.id)
                        )
                      );
                      bumpRevision();
                    }}
                  >
                    Del
                  </PixelButton>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end">
          <PixelButton onClick={onClose}>Close</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 6. Rotate / Transform Selection or Sprite Dialog (`dialog.rotate_angle`)
 */
export const RotateAngleDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const [scope, setScope] = useState<"cel" | "sprite">("cel");
  const [angleDeg, setAngleDeg] = useState(30);
  const [algorithm, setAlgorithm] = useState<"rotsprite" | "fast">("rotsprite");

  if (!doc) return null;

  const handleApply = () => {
    doc.execute(
      new TransformSpriteOrCelCommand({
        label: `Rotate ${angleDeg}° (${algorithm === "rotsprite" ? "RotSprite" : "Fast"})`,
        scope,
        layerId: activeLayerId,
        frameIndex: activeFrameIndex,
        op: { kind: "rotate_angle", angleDeg, algorithm },
      })
    );
    bumpRevision();
    onClose();
  };

  return (
    <PixelDialog title="Edit > Rotate / Transform (RotSprite & Fast)" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span>Apply To:</span>
          <PixelSelect
            ariaLabel="Rotate Target Scope"
            value={scope}
            onChange={(v) => setScope(v as "cel" | "sprite")}
            options={[
              { value: "cel", label: "Selection / Active Cel" },
              { value: "sprite", label: "Entire Sprite Canvas" },
            ]}
          />
        </div>
        <div className="flex items-center justify-between">
          <span>Angle (Degrees):</span>
          <NumberField
            ariaLabel="Rotate Angle Degrees"
            value={angleDeg}
            min={-360}
            max={360}
            suffix="°"
            onChange={setAngleDeg}
          />
        </div>
        <div className="flex items-center justify-between">
          <span>Algorithm:</span>
          <PixelSelect
            ariaLabel="Rotate Algorithm"
            value={algorithm}
            onChange={(v) => setAlgorithm(v as "rotsprite" | "fast")}
            options={[
              { value: "rotsprite", label: "RotSprite (Clean 8x Scale2x)" },
              { value: "fast", label: "Fast Rotate (Nearest-Neighbor)" },
            ]}
          />
        </div>

        <div className="flex flex-wrap gap-1 pt-1 border-t border-black/20">
          <PixelButton size="xs" onClick={() => setAngleDeg(45)}>
            45°
          </PixelButton>
          <PixelButton size="xs" onClick={() => setAngleDeg(90)}>
            90° CW
          </PixelButton>
          <PixelButton size="xs" onClick={() => setAngleDeg(-90)}>
            90° CCW
          </PixelButton>
          <PixelButton size="xs" onClick={() => setAngleDeg(180)}>
            180°
          </PixelButton>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-black/25">
          <PixelButton onClick={handleApply}>Rotate</PixelButton>
          <PixelButton onClick={onClose}>Cancel</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 7. Shift / Wrap Pixels Dialog (`dialog.shift_pixels`)
 */
export const ShiftPixelsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const [dx, setDx] = useState(4);
  const [dy, setDy] = useState(0);

  if (!doc) return null;

  const execShift = (sx: number, sy: number) => {
    doc.execute(
      new TransformSpriteOrCelCommand({
        label: `Shift Pixels (${sx}, ${sy})`,
        scope: "cel",
        layerId: activeLayerId,
        frameIndex: activeFrameIndex,
        op: { kind: "shift", dx: sx, dy: sy },
      })
    );
    bumpRevision();
  };

  return (
    <PixelDialog title="Edit > Shift / Toroidal Wrap Pixels" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between">
            <span>Shift X:</span>
            <NumberField
              ariaLabel="Shift Pixels X"
              value={dx}
              min={-512}
              max={512}
              suffix="px"
              onChange={setDx}
            />
          </div>
          <div className="flex items-center justify-between">
            <span>Shift Y:</span>
            <NumberField
              ariaLabel="Shift Pixels Y"
              value={dy}
              min={-512}
              max={512}
              suffix="px"
              onChange={setDy}
            />
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5 bg-black/10 p-2 border border-black/20">
          <PixelButton size="xs" onClick={() => execShift(-1, 0)}>
            ← Left 1px
          </PixelButton>
          <PixelButton size="xs" onClick={() => execShift(1, 0)}>
            Right 1px →
          </PixelButton>
          <PixelButton size="xs" onClick={() => execShift(0, -1)}>
            ↑ Up 1px
          </PixelButton>
          <PixelButton size="xs" onClick={() => execShift(0, 1)}>
            ↓ Down 1px
          </PixelButton>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-black/25">
          <PixelButton
            onClick={() => {
              execShift(dx, dy);
              onClose();
            }}
          >
            Apply Shift
          </PixelButton>
          <PixelButton onClick={onClose}>Close</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 8. Paste Special Dialog (`dialog.paste_special`)
 */
export const PasteSpecialDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const pixelClipboard = useAppStore((s) => s.pixelClipboard);
  const pasteFromClipboard = useAppStore((s) => s.pasteFromClipboard);
  const pasteAsNewLayer = useAppStore((s) => s.pasteAsNewLayer);
  const pasteAsNewSprite = useAppStore((s) => s.pasteAsNewSprite);
  const pasteAsNewBrush = useAppStore((s) => s.pasteAsNewBrush);

  const [posX, setPosX] = useState(pixelClipboard?.x ?? 0);
  const [posY, setPosY] = useState(pixelClipboard?.y ?? 0);

  return (
    <PixelDialog title="Edit > Paste Special" onClose={onClose}>
      <div className="space-y-3">
        <div className="text-[11px] bg-black/10 p-2 border border-black/20">
          Clipboard Status:{" "}
          {pixelClipboard
            ? `${pixelClipboard.image.width}x${pixelClipboard.image.height}px from (${pixelClipboard.x}, ${pixelClipboard.y})`
            : "Will copy active selection / cel"}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between">
            <span>Paste X:</span>
            <NumberField
              ariaLabel="Paste Position X"
              value={posX}
              min={0}
              max={4096}
              suffix="px"
              onChange={setPosX}
            />
          </div>
          <div className="flex items-center justify-between">
            <span>Paste Y:</span>
            <NumberField
              ariaLabel="Paste Position Y"
              value={posY}
              min={0}
              max={4096}
              suffix="px"
              onChange={setPosY}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <PixelButton
            onClick={() => {
              pasteFromClipboard(posX, posY);
              onClose();
            }}
          >
            Paste at (X, Y)
          </PixelButton>
          <PixelButton
            onClick={() => {
              pasteAsNewLayer();
              onClose();
            }}
          >
            Paste as New Layer
          </PixelButton>
          <PixelButton
            onClick={() => {
              pasteAsNewSprite();
              onClose();
            }}
          >
            Paste as New Sprite
          </PixelButton>
          <PixelButton
            onClick={() => {
              pasteAsNewBrush();
              onClose();
            }}
          >
            Paste as Custom Brush
          </PixelButton>
        </div>

        <div className="flex justify-end pt-2 border-t border-black/25">
          <PixelButton onClick={onClose}>Cancel</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 9. Adjustments & FX Filter Studio Dialog (`dialog.filter_fx`)
 * Supports all 10 Agent-4 filters with Live Preview, Per-Channel Target Mask, and Multi-Cel Target Scope!
 */
export const FilterStudioDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const selectedCelRange = useAppStore((s) => s.selectedCelRange);
  const fgColor = useAppStore((s) => s.fgColor);
  const bgColor = useAppStore((s) => s.bgColor);
  const tiledMode = useAppStore((s) => s.tiledMode);
  const activeFilterTab = useAppStore((s) => s.activeFilterTab);
  const setActiveFilterTab = useAppStore((s) => s.setActiveFilterTab);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  if (!doc) return null;
  const sprite = doc.sprite;
  const activeCel = getCel(sprite, activeLayerId, activeFrameIndex) ?? sprite.cels[0];
  const palette = getPaletteForFrame(sprite, activeFrameIndex);

  const [channels, setChannels] = useState<FilterTargetChannels>({ ...DEFAULT_FILTER_CHANNELS });
  const [scope, setScope] = useState<FilterTargetScope>("selection");

  // 1. Outline state
  const [outlineColor, setOutlineColor] = useState<RGBA>(fgColor);
  const [outlinePlace, setOutlinePlace] = useState<"outside" | "inside">("outside");
  const [outlinePattern, setOutlinePattern] = useState<OutlinePatternPreset>("circle");
  const [outlineMatrix, setOutlineMatrix] = useState<boolean[]>(
    getOutlineMatrixForPattern("circle")
  );

  // 2. Replace Color state
  const [repFrom, setRepFrom] = useState<RGBA>(fgColor);
  const [repTo, setRepTo] = useState<RGBA>(bgColor);
  const [repTol, setRepTol] = useState(16);

  // 3. Hue / Saturation / Lightness state
  const [hueShift, setHueShift] = useState(0);
  const [satShift, setSatShift] = useState(0);
  const [lightShift, setLightShift] = useState(0);
  const [alphaShift, setAlphaShift] = useState(0);
  const [hslMode, setHslMode] = useState<"hsl" | "hsv">("hsl");

  // 4. Brightness / Contrast state
  const [brightness, setBrightness] = useState(15);
  const [contrast, setContrast] = useState(25);

  // 5. Color Curve state
  const [curvePoints, setCurvePoints] = useState<Point[]>([
    { x: 0, y: 0 },
    { x: 80, y: 110 },
    { x: 180, y: 210 },
    { x: 255, y: 255 },
  ]);

  // 6. Convolution Matrix state
  const [convPresetId, setConvPresetId] = useState("sharpen_3x3");
  const [convKernel, setConvKernel] = useState<number[]>([...CONVOLUTION_PRESETS[2].kernel]);
  const [convDivisor, setConvDivisor] = useState(1);
  const [convBias, setConvBias] = useState(0);
  const [convTiled, setConvTiled] = useState<"none" | "x" | "y" | "both">(tiledMode);

  // 7. Despeckle state
  const [despW, setDespW] = useState(3);
  const [despH, setDespH] = useState(3);

  // 8. Drop Shadow state
  const [shOffX, setShOffX] = useState(2);
  const [shOffY, setShOffY] = useState(2);
  const [shColor, setShColor] = useState<RGBA>({ r: 0, g: 0, b: 0, a: 180 });
  const [shOpacity, setShOpacity] = useState(180);

  // 9. Posterize state
  const [posterizeLevels, setPosterizeLevels] = useState(4);

  const beforeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const afterCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const runSelectedFilterOnImage = useMemo(() => {
    return (img: PixelImage, pal: readonly RGBA[]) => {
      const common = {
        channels,
        mask: scope === "selection" ? sprite.mask : undefined,
        palette: pal,
        transparentIndex: sprite.transparentIndex,
      };
      switch (activeFilterTab) {
        case "outline":
          return applyOutlineFilter(
            img,
            {
              outlineColor,
              place: outlinePlace,
              pattern: outlinePattern,
              matrix3x3: outlineMatrix,
            },
            common
          );
        case "replace_color":
          return applyReplaceColorFilter(img, repFrom, repTo, repTol, common);
        case "hue_sat":
          return applyHueSaturationFilter(
            img,
            {
              hueShift,
              saturationShift: satShift,
              lightnessShift: lightShift,
              alphaShift,
              mode: hslMode,
            },
            common
          );
        case "brightness":
          return applyBrightnessContrastFilter(img, brightness, contrast, common);
        case "curve":
          return applyColorCurveFilter(img, curvePoints, common);
        case "convolution":
          return applyConvolutionMatrixFilter(
            img,
            {
              size: convKernel.length === 25 ? 5 : 3,
              kernel: convKernel,
              divisor: convDivisor,
              bias: convBias,
              tiledMode: convTiled,
            },
            common
          );
        case "despeckle":
          return applyDespeckleFilter(img, despW, despH, convTiled, common);
        case "shadow":
          return applyDropShadowFilter(
            img,
            {
              offsetX: shOffX,
              offsetY: shOffY,
              shadowColor: shColor,
              opacity: shOpacity,
            },
            common
          );
        case "posterize":
          return applyPosterizeFilter(img, posterizeLevels, common);
        case "invert":
        default:
          return applyInvertFilter(img, common);
      }
    };
  }, [
    activeFilterTab,
    channels,
    scope,
    sprite.mask,
    sprite.transparentIndex,
    outlineColor,
    outlinePlace,
    outlinePattern,
    outlineMatrix,
    repFrom,
    repTo,
    repTol,
    hueShift,
    satShift,
    lightShift,
    alphaShift,
    hslMode,
    brightness,
    contrast,
    curvePoints,
    convKernel,
    convDivisor,
    convBias,
    convTiled,
    despW,
    despH,
    shOffX,
    shOffY,
    shColor,
    shOpacity,
    posterizeLevels,
  ]);

  const previewResult = useMemo(() => {
    if (!activeCel) return null;
    return runSelectedFilterOnImage(activeCel.image, palette);
  }, [activeCel, palette, runSelectedFilterOnImage]);

  const histogram = useMemo(() => {
    if (!activeCel) return null;
    return computeImageHistogram(activeCel.image, palette, sprite.transparentIndex);
  }, [activeCel, palette, sprite.transparentIndex]);

  useEffect(() => {
    if (!activeCel || !previewResult) return;
    drawPixelImagePreview(beforeCanvasRef.current, activeCel.image, palette, sprite.transparentIndex);
    drawPixelImagePreview(afterCanvasRef.current, previewResult, palette, sprite.transparentIndex);
  }, [activeCel, previewResult, palette, sprite.transparentIndex]);

  const handleApplyFilter = () => {
    let targetCelIds: string[] = [];
    if (scope === "selection" || scope === "active_cel") {
      if (activeCel) targetCelIds = [activeCel.id];
    } else if (scope === "active_layer") {
      targetCelIds = sprite.cels.filter((c) => c.layerId === activeLayerId).map((c) => c.id);
    } else if (scope === "selected_cels" && selectedCelRange) {
      targetCelIds = sprite.cels
        .filter(
          (c) =>
            selectedCelRange.layerIds.includes(c.layerId) &&
            c.frameIndex >= selectedCelRange.fromFrame &&
            c.frameIndex <= selectedCelRange.toFrame
        )
        .map((c) => c.id);
    } else {
      targetCelIds = sprite.cels.map((c) => c.id);
    }

    if (targetCelIds.length === 0 && activeCel) {
      targetCelIds = [activeCel.id];
    }

    doc.execute(
      new ApplyFilterToCelsCommand(
        `Filter: ${activeFilterTab.toUpperCase()}`,
        targetCelIds,
        (img, cel, sp) => runSelectedFilterOnImage(img, getPaletteForFrame(sp, cel.frameIndex))
      )
    );
    bumpRevision();
    onClose();
  };

  return (
    <PixelDialog
      title="Edit > Adjustments & FX Filter Studio (Live Preview)"
      onClose={onClose}
      widthClass="w-[740px]"
    >
      <div className="space-y-3">
        <PixelTabs
          tabs={[
            { id: "outline", label: "Outline" },
            { id: "replace_color", label: "Replace Color" },
            { id: "hue_sat", label: "Hue/Sat" },
            { id: "brightness", label: "Bright/Contrast" },
            { id: "curve", label: "Color Curve" },
            { id: "convolution", label: "Convolution" },
            { id: "despeckle", label: "Despeckle" },
            { id: "shadow", label: "Drop Shadow" },
            { id: "posterize", label: "Posterize" },
            { id: "invert", label: "Invert" },
          ]}
          activeId={activeFilterTab}
          onSelect={setActiveFilterTab}
        />

        {/* Target Channels & Scope Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-black/15 px-2 py-1 border border-black/25">
          <div className="flex items-center gap-1">
            <span className="font-bold text-[11px]">Channels:</span>
            {(["r", "g", "b", "a", "index"] as const).map((chKey) => (
              <PixelButton
                key={chKey}
                size="xs"
                active={channels[chKey]}
                onClick={() => setChannels((prev) => ({ ...prev, [chKey]: !prev[chKey] }))}
              >
                {chKey.toUpperCase()}
              </PixelButton>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <span className="font-bold text-[11px]">Apply to:</span>
            <PixelSelect
              ariaLabel="Filter Target Scope"
              value={scope}
              onChange={(v) => setScope(v as FilterTargetScope)}
              options={[
                { value: "selection", label: "Selection / Active Cel" },
                { value: "active_cel", label: "Whole Active Cel" },
                { value: "active_layer", label: "Active Layer (All Frames)" },
                { value: "selected_cels", label: "Selected Timeline Cels" },
                { value: "all_frames", label: "All Frames & Layers" },
              ]}
            />
          </div>
        </div>

        {/* Main Filter Controls + Live Before/After Preview */}
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-7 space-y-2.5 bg-black/10 p-2.5 border border-black/20">
            {/* 1. Outline Controls + 3x3 Matrix Editor */}
            {activeFilterTab === "outline" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span>Outline Color:</span>
                  <div className="flex items-center gap-1">
                    <ColorInputField
                      value={rgbaToHex(outlineColor).slice(0, 7)}
                      onChange={(hex) => setOutlineColor(hexToRgba(hex))}
                      className="w-8 h-6"
                    />
                    <PixelButton size="xs" onClick={() => setOutlineColor(fgColor)}>
                      Use FG
                    </PixelButton>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span>Placement:</span>
                  <PixelSelect
                    ariaLabel="Outline Placement"
                    value={outlinePlace}
                    onChange={(v) => setOutlinePlace(v as "outside" | "inside")}
                    options={[
                      { value: "outside", label: "Outside Foreground" },
                      { value: "inside", label: "Inside Foreground" },
                    ]}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Pattern Preset:</span>
                  <PixelSelect
                    ariaLabel="Outline Pattern Preset"
                    value={outlinePattern}
                    onChange={(v) => {
                      const pat = v as OutlinePatternPreset;
                      setOutlinePattern(pat);
                      setOutlineMatrix(getOutlineMatrixForPattern(pat));
                    }}
                    options={[
                      { value: "circle", label: "Circle (4-Dir)" },
                      { value: "square", label: "Square (8-Dir)" },
                      { value: "horizontal", label: "Horizontal" },
                      { value: "vertical", label: "Vertical" },
                      { value: "custom", label: "Custom 3x3 Matrix" },
                    ]}
                  />
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <span>3x3 Neighbor Matrix:</span>
                  <div className="grid grid-cols-3 gap-1">
                    {outlineMatrix.map((on, mIdx) => (
                      <button
                        key={mIdx}
                        type="button"
                        disabled={mIdx === 4}
                        onClick={() => {
                          const next = [...outlineMatrix];
                          next[mIdx] = !next[mIdx];
                          setOutlinePattern("custom");
                          setOutlineMatrix(next);
                        }}
                        className={`w-6 h-6 border border-black font-bold text-[10px] ${
                          mIdx === 4
                            ? "bg-black/40 text-white"
                            : on
                            ? "bg-amber-400 text-black"
                            : "bg-[var(--kpx-input-bg)] text-black"
                        }`}
                      >
                        {mIdx === 4 ? "●" : on ? "1" : "0"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 2. Replace Color Controls */}
            {activeFilterTab === "replace_color" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span>From Color:</span>
                  <div className="flex items-center gap-1">
                    <ColorInputField
                      value={rgbaToHex(repFrom).slice(0, 7)}
                      onChange={(hex) => setRepFrom(hexToRgba(hex))}
                      className="w-8 h-6"
                    />
                    <PixelButton size="xs" onClick={() => setRepFrom(fgColor)}>
                      FG
                    </PixelButton>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span>To Color:</span>
                  <div className="flex items-center gap-1">
                    <ColorInputField
                      value={rgbaToHex(repTo).slice(0, 7)}
                      onChange={(hex) => setRepTo(hexToRgba(hex))}
                      className="w-8 h-6"
                    />
                    <PixelButton size="xs" onClick={() => setRepTo(bgColor)}>
                      BG
                    </PixelButton>
                  </div>
                </div>
                <PixelSlider
                  label="Tolerance"
                  value={repTol}
                  min={0}
                  max={255}
                  onChange={setRepTol}
                />
              </div>
            )}

            {/* 3. Hue / Saturation / Lightness Controls */}
            {activeFilterTab === "hue_sat" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span>Color Space:</span>
                  <PixelSelect
                    ariaLabel="HSL vs HSV Mode"
                    value={hslMode}
                    onChange={(v) => setHslMode(v as "hsl" | "hsv")}
                    options={[
                      { value: "hsl", label: "HSL (Lightness)" },
                      { value: "hsv", label: "HSV (Value)" },
                    ]}
                  />
                </div>
                <PixelSlider
                  label="Hue Shift (°)"
                  value={hueShift}
                  min={-180}
                  max={180}
                  onChange={setHueShift}
                />
                <PixelSlider
                  label="Saturation (%)"
                  value={satShift}
                  min={-100}
                  max={100}
                  onChange={setSatShift}
                />
                <PixelSlider
                  label={hslMode === "hsl" ? "Lightness (%)" : "Value (%)"}
                  value={lightShift}
                  min={-100}
                  max={100}
                  onChange={setLightShift}
                />
                <PixelSlider
                  label="Alpha (%)"
                  value={alphaShift}
                  min={-100}
                  max={100}
                  onChange={setAlphaShift}
                />
              </div>
            )}

            {/* 4. Brightness / Contrast Controls */}
            {activeFilterTab === "brightness" && (
              <div className="space-y-2.5">
                <PixelSlider
                  label="Brightness"
                  value={brightness}
                  min={-100}
                  max={100}
                  onChange={setBrightness}
                />
                <PixelSlider
                  label="Contrast"
                  value={contrast}
                  min={-100}
                  max={100}
                  onChange={setContrast}
                />
              </div>
            )}

            {/* 5. Color Curve Spline + Histogram */}
            {activeFilterTab === "curve" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold">Spline Curve &amp; Histogram</span>
                  <div className="flex gap-1">
                    <PixelButton
                      size="xs"
                      onClick={() =>
                        setCurvePoints([
                          { x: 0, y: 0 },
                          { x: 64, y: 35 },
                          { x: 192, y: 225 },
                          { x: 255, y: 255 },
                        ])
                      }
                    >
                      S-Curve
                    </PixelButton>
                    <PixelButton
                      size="xs"
                      onClick={() =>
                        setCurvePoints([
                          { x: 0, y: 255 },
                          { x: 255, y: 0 },
                        ])
                      }
                    >
                      Invert
                    </PixelButton>
                    <PixelButton
                      size="xs"
                      onClick={() =>
                        setCurvePoints([
                          { x: 0, y: 0 },
                          { x: 255, y: 255 },
                        ])
                      }
                    >
                      Linear
                    </PixelButton>
                  </div>
                </div>
                <svg
                  viewBox="0 0 256 128"
                  className="w-full h-32 bg-[#1a171f] border border-black cursor-crosshair"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const nx = Math.round(((e.clientX - rect.left) / rect.width) * 255);
                    const ny = Math.round((1 - (e.clientY - rect.top) / rect.height) * 255);
                    setCurvePoints((prev) => [...prev, { x: nx, y: ny }]);
                  }}
                >
                  {/* Histogram Bars */}
                  {histogram &&
                    Array.from({ length: 64 }, (_, bin) => {
                      const count = histogram.luma[bin * 4];
                      const h = Math.round((count / histogram.maxCount) * 120);
                      return (
                        <rect
                          key={bin}
                          x={bin * 4}
                          y={128 - h}
                          width={3}
                          height={h}
                          fill="rgba(148, 163, 184, 0.35)"
                        />
                      );
                    })}
                  {/* Evaluated LUT Polyline */}
                  {(() => {
                    const lut = evaluateCurveLUT(curvePoints);
                    const pts = Array.from({ length: 64 }, (_, i) => {
                      const x = i * 4;
                      const y = 128 - Math.round((lut[x] / 255) * 128);
                      return `${x},${y}`;
                    }).join(" ");
                    return <polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth="2" />;
                  })()}
                  {/* Control Points */}
                  {curvePoints.map((pt, idx) => (
                    <circle
                      key={idx}
                      cx={pt.x}
                      cy={128 - (pt.y / 255) * 128}
                      r={4}
                      fill="#facc15"
                      stroke="#000"
                    />
                  ))}
                </svg>
              </div>
            )}

            {/* 6. Convolution Matrix Controls */}
            {activeFilterTab === "convolution" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span>Preset:</span>
                  <PixelSelect
                    ariaLabel="Convolution Preset"
                    value={convPresetId}
                    onChange={(id) => {
                      setConvPresetId(id);
                      const found = CONVOLUTION_PRESETS.find((p) => p.id === id);
                      if (found) {
                        setConvKernel([...found.kernel]);
                        setConvDivisor(found.divisor);
                        setConvBias(found.bias);
                      }
                    }}
                    options={CONVOLUTION_PRESETS.map((p) => ({
                      value: p.id,
                      label: p.name,
                    }))}
                  />
                </div>
                <div className="grid grid-cols-3 gap-1 w-44 mx-auto">
                  {convKernel.slice(0, 9).map((val, idx) => (
                    <NumberField
                      key={idx}
                      ariaLabel={`Kernel Cell ${idx}`}
                      value={val}
                      min={-32}
                      max={32}
                      widthClass="w-13"
                      onChange={(nv) => {
                        const next = [...convKernel];
                        next[idx] = nv;
                        setConvKernel(next);
                      }}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>Divisor:</span>
                  <NumberField
                    ariaLabel="Convolution Divisor"
                    value={convDivisor}
                    min={1}
                    max={256}
                    widthClass="w-14"
                    onChange={setConvDivisor}
                  />
                  <span>Bias:</span>
                  <NumberField
                    ariaLabel="Convolution Bias"
                    value={convBias}
                    min={-255}
                    max={255}
                    widthClass="w-14"
                    onChange={setConvBias}
                  />
                  <span>Tiled:</span>
                  <PixelSelect
                    ariaLabel="Convolution Tiled Wrap"
                    value={convTiled}
                    onChange={(v) => setConvTiled(v as "none" | "x" | "y" | "both")}
                    options={[
                      { value: "none", label: "Off" },
                      { value: "both", label: "Both (X+Y)" },
                      { value: "x", label: "X Axis" },
                      { value: "y", label: "Y Axis" },
                    ]}
                  />
                </div>
              </div>
            )}

            {/* 7. Despeckle (Median) Controls */}
            {activeFilterTab === "despeckle" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span>Median Kernel Width:</span>
                  <NumberField
                    ariaLabel="Despeckle Width"
                    value={despW}
                    min={1}
                    max={9}
                    suffix="px"
                    onChange={setDespW}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Median Kernel Height:</span>
                  <NumberField
                    ariaLabel="Despeckle Height"
                    value={despH}
                    min={1}
                    max={9}
                    suffix="px"
                    onChange={setDespH}
                  />
                </div>
              </div>
            )}

            {/* 8. Drop Shadow Controls */}
            {activeFilterTab === "shadow" && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between">
                    <span>Offset X:</span>
                    <NumberField
                      ariaLabel="Drop Shadow Offset X"
                      value={shOffX}
                      min={-32}
                      max={32}
                      suffix="px"
                      onChange={setShOffX}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Offset Y:</span>
                    <NumberField
                      ariaLabel="Drop Shadow Offset Y"
                      value={shOffY}
                      min={-32}
                      max={32}
                      suffix="px"
                      onChange={setShOffY}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span>Shadow Color:</span>
                  <ColorInputField
                    value={rgbaToHex(shColor).slice(0, 7)}
                    onChange={(hex) => setShColor(hexToRgba(hex, shOpacity))}
                    className="w-8 h-6"
                  />
                </div>
                <PixelSlider
                  label="Shadow Opacity"
                  value={shOpacity}
                  min={0}
                  max={255}
                  onChange={setShOpacity}
                />
              </div>
            )}

            {/* 9. Posterize Controls */}
            {activeFilterTab === "posterize" && (
              <div className="space-y-2">
                <PixelSlider
                  label="Tonal Levels per Channel (2..64)"
                  value={posterizeLevels}
                  min={2}
                  max={64}
                  onChange={setPosterizeLevels}
                />
              </div>
            )}

            {/* 10. Invert Controls */}
            {activeFilterTab === "invert" && (
              <div className="text-xs p-2">
                Inverts active color channels ({Object.entries(channels).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(", ")}) across the selected scope.
              </div>
            )}
          </div>

          {/* Right Column: Live Before & After Canvas Previews */}
          <div className="col-span-5 grid grid-cols-2 gap-2 bg-[#231f28] kpx-bevel-inset p-2 items-center justify-items-center">
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-white/75 mb-1">Before</span>
              <canvas
                ref={beforeCanvasRef}
                style={{ width: 112, height: 112, imageRendering: "pixelated" }}
                className="border border-black"
              />
            </div>
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-amber-300 font-bold mb-1">Live Preview</span>
              <canvas
                ref={afterCanvasRef}
                style={{ width: 112, height: 112, imageRendering: "pixelated" }}
                className="border border-amber-400"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-black/25">
          <PixelButton onClick={handleApplyFilter}>Apply Filter (OK)</PixelButton>
          <PixelButton onClick={onClose}>Cancel</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 10. Sprite Properties Dialog (`dialog.sprite_properties`)
 */
export const SpritePropertiesDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  if (!doc) return null;
  const sprite = doc.sprite;

  const [name, setName] = useState(sprite.name);
  const [transparentIndex, setTransparentIndex] = useState(sprite.transparentIndex);
  const [ratioPreset, setRatioPreset] = useState(
    `${sprite.pixelRatio.w}:${sprite.pixelRatio.h}`
  );
  const [userDataText, setUserDataText] = useState(sprite.userData.text);
  const [userDataColor, setUserDataColor] = useState(sprite.userData.color ?? "#3b82f6");

  const handleSave = () => {
    const [rw, rh] = ratioPreset.split(":").map(Number);
    doc.execute(
      new UpdateSpritePropertiesCommand({
        name: name.trim() || sprite.name,
        transparentIndex,
        pixelRatio: { w: rw || 1, h: rh || 1 },
        userData: { text: userDataText, color: userDataColor },
      })
    );
    bumpRevision();
    onClose();
  };

  return (
    <PixelDialog title="Sprite > Properties" onClose={onClose} widthClass="w-[420px]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span>File / Sprite Name:</span>
          <TextField value={name} onChange={setName} className="w-52" />
        </div>
        <div className="flex items-center justify-between text-[11px] bg-black/10 p-1.5 border border-black/20">
          <span>Dimensions &amp; Mode:</span>
          <span className="font-bold">
            {sprite.width}×{sprite.height}px • {sprite.colorMode.toUpperCase()} •{" "}
            {sprite.frames.length} Frames • {sprite.layers.length} Layers
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Pixel Aspect Ratio:</span>
          <PixelSelect
            ariaLabel="Sprite Pixel Aspect Ratio"
            value={ratioPreset}
            onChange={setRatioPreset}
            options={[
              { value: "1:1", label: "Square Pixels (1:1)" },
              { value: "2:1", label: "Double-Wide (2:1)" },
              { value: "1:2", label: "Double-High (1:2)" },
            ]}
          />
        </div>
        <div className="flex items-center justify-between">
          <span>Transparent Palette Index:</span>
          <NumberField
            ariaLabel="Sprite Transparent Color Index"
            value={transparentIndex}
            min={0}
            max={255}
            onChange={setTransparentIndex}
          />
        </div>
        <div className="space-y-1">
          <span>User Data &amp; Tag Color:</span>
          <div className="flex items-center gap-1.5">
            <TextField
              value={userDataText}
              onChange={setUserDataText}
              placeholder="Author, notes, metadata..."
              className="flex-1"
            />
            <ColorInputField
              value={userDataColor}
              onChange={setUserDataColor}
              className="w-7 h-6"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-black/25">
          <PixelButton onClick={handleSave}>OK</PixelButton>
          <PixelButton onClick={onClose}>Cancel</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * 11. Duplicate Sprite Dialog (`dialog.duplicate_sprite`)
 */
export const DuplicateSpriteDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const duplicateActiveSprite = useAppStore((s) => s.duplicateActiveSprite);

  if (!doc) return null;
  const [newName, setNewName] = useState(
    `${doc.sprite.name.replace(/\.ase$/i, "")}-copy.ase`
  );
  const [flatten, setFlatten] = useState(false);

  return (
    <PixelDialog title="Sprite > Duplicate Sprite" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span>Destination Name:</span>
          <TextField value={newName} onChange={setNewName} className="w-48" />
        </div>
        <PixelCheckbox
          checked={flatten}
          onChange={setFlatten}
          label="Flatten Merged Layers in Duplicate"
        />
        <div className="flex justify-end gap-2 pt-2 border-t border-black/25">
          <PixelButton
            onClick={() => {
              duplicateActiveSprite(flatten, newName);
              onClose();
            }}
          >
            Duplicate
          </PixelButton>
          <PixelButton onClick={onClose}>Cancel</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};
