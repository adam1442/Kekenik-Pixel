/**
 * @module @kekenik/ui/featurecenter/agent6-dialogs
 * Agent 6 dialogs: Export As, Export Sprite Sheet (Layout / Sprite / Borders / Output tabs + live preview), Import Sprite Sheet
 * (live grid overlay) and Crash Recovery.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SHEET_OPTIONS,
  appLogger,
  computeImportGrid,
  decodeSprite,
  encodeSprite,
  exportSpriteSheet,
  getPlatform,
  encodePng,
  importSpriteSheet,
  compositeFrame,
  type RecoverySnapshot,
  type SheetImportOptions,
  type SheetOptions,
  type SheetResult,
  type Sprite,
  type RgbaBitmap,
} from "../../../core/src/index.ts";
import { hasRecoverableSession, openSpriteAsDocument, recoverSnapshot, discardRecovery } from "../app/agent6-actions.ts";
import { useAppStore } from "../app/store.ts";
import { NumberField, PixelButton, PixelCheckbox, PixelDialog, PixelSelect, TextField } from "../widgets/index.tsx";

const lastSheetSettings = new Map<string, SheetOptions>();

function drawBitmap(canvas: HTMLCanvasElement | null, bmp: RgbaBitmap, maxW: number, maxH: number, overlay?: Array<{ x: number; y: number; w: number; h: number }>): void {
  if (!canvas) return;
  const scale = Math.max(1, Math.min(Math.floor(maxW / bmp.width), Math.floor(maxH / bmp.height)));
  canvas.width = bmp.width * scale;
  canvas.height = bmp.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const tmp = document.createElement("canvas");
  tmp.width = bmp.width;
  tmp.height = bmp.height;
  tmp.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(bmp.data), bmp.width, bmp.height), 0, 0);
  ctx.fillStyle = "#6e6573";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  if (overlay) {
    ctx.strokeStyle = "#ffd35a";
    ctx.lineWidth = 1;
    for (const r of overlay) ctx.strokeRect(r.x * scale + 0.5, r.y * scale + 0.5, r.w * scale - 1, r.h * scale - 1);
  }
}

async function save(data: Uint8Array | string, name: string): Promise<void> {
  const res = await getPlatform().saveFileDialog(data, { defaultName: name, title: "Save", extensions: [name.split(".").pop() ?? ""] });
  appLogger.info("Export", `${res.saved ? "Saved" : "Download started for"} ${name}`);
}

/** File > Export As… (single image, animation, vector…). */
export const ExportAsDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const frameIdx = useAppStore((s) => s.activeFrameIndex);
  const [fmt, setFmt] = useState("png");
  const [scale, setScale] = useState(1);
  const [frame, setFrame] = useState(frameIdx);
  const [dither, setDither] = useState(false);
  const [indexed, setIndexed] = useState(false);
  const [error, setError] = useState("");
  if (!doc) return null;
  const sprite = doc.sprite as Sprite;
  const doExport = async (): Promise<void> => {
    try {
      const bytes = encodeSprite(sprite, fmt, { scale, frame, dither, indexedPng: indexed });
      await save(bytes, `${sprite.name.replace(/\.[^.]+$/, "")}.${fmt}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <PixelDialog title="Export As" onClose={onClose} widthClass="w-[380px]">
      <div className="space-y-2">
        <div className="flex items-center justify-between"><span>Format:</span>
          <PixelSelect ariaLabel="Export format" value={fmt} onChange={setFmt} options={["png", "gif", "apng", "bmp", "tga", "ico", "qoi", "svg", "aseprite", "kpx"].map((v) => ({ value: v, label: `.${v}` }))} /></div>
        <div className="flex items-center justify-between"><span>Scale:</span><NumberField ariaLabel="Scale" value={scale} min={1} max={16} suffix="x" onChange={setScale} /></div>
        <div className="flex items-center justify-between"><span>Frame (single-image formats):</span><NumberField ariaLabel="Frame" value={frame} min={0} max={Math.max(0, sprite.frames.length - 1)} onChange={setFrame} /></div>
        <PixelCheckbox checked={dither} onChange={setDither} label="GIF: dither when reducing colours" />
        <PixelCheckbox checked={indexed} onChange={setIndexed} label="PNG: write indexed PNG (indexed sprites)" />
        <div className="text-[10px] opacity-70">WebP and JPEG export are planned (see docs/KNOWN_ISSUES.md).</div>
        {error && <div role="alert" className="p-1.5 bg-red-900/60 text-red-100">{error}</div>}
        <div className="flex justify-end gap-2 pt-1"><PixelButton onClick={onClose}>Cancel</PixelButton><PixelButton active onClick={() => void doExport()}>Export</PixelButton></div>
      </div>
    </PixelDialog>
  );
};

type Tab = "layout" | "sprite" | "borders" | "output";

/** File > Export Sprite Sheet… (Ctrl+E): Layout / Sprite / Borders / Output tabs with live preview. */
export const ExportSpriteSheetDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const [tab, setTab] = useState<Tab>("layout");
  const [opts, setOpts] = useState<SheetOptions>(() => (doc && lastSheetSettings.get(doc.id)) || { ...DEFAULT_SHEET_OPTIONS, outputFile: `${doc?.sprite.name.replace(/\.[^.]+$/, "") ?? "sheet"}.png` });
  const [openAfter, setOpenAfter] = useState(true);
  const [wantData, setWantData] = useState(true);
  const [wantPreview, setWantPreview] = useState(true);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sprite = doc?.sprite as Sprite | undefined;
  const set = <K extends keyof SheetOptions>(k: K, v: SheetOptions[K]): void => setOpts((o) => ({ ...o, [k]: v }));

  const result = useMemo<SheetResult[] | null>(() => {
    if (!sprite) return null;
    try {
      setError("");
      return exportSpriteSheet(sprite, opts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprite, opts]);

  useEffect(() => {
    if (wantPreview && result?.[0]) drawBitmap(canvasRef.current, result[0].bitmap, 360, 220);
  }, [result, wantPreview, tab]);

  if (!doc || !sprite) return null;
  const doExport = async (): Promise<void> => {
    if (!result) return;
    lastSheetSettings.set(doc.id, opts);
    for (const r of result) {
      const base = opts.outputFile.replace(/\.[^.]+$/, "");
      const png = encodePng(r.bitmap);
      await save(png, `${base}${r.suffix}.png`);
      if (wantData) await save(r.dataText, `${base}${r.suffix}.json`);
    }
    appLogger.info("Export", `Exported ${result.length} sprite sheet(s), ${result[0].frameCount} frame(s) in the first sheet${openAfter ? " (open the saved PNG to inspect)" : ""}`);
    onClose();
  };
  const row = (label: string, el: React.ReactNode): React.ReactElement => <div className="flex items-center justify-between gap-2"><span>{label}</span>{el}</div>;
  const num = (label: string, k: "borderPadding" | "spacing" | "innerPadding" | "scale" | "gridWidth" | "gridHeight", max = 64): React.ReactElement =>
    row(label, <NumberField ariaLabel={label} value={opts[k]} min={k === "scale" ? 1 : 0} max={max} onChange={(v) => set(k, v)} />);
  const cons = opts.constraint;
  return (
    <PixelDialog title="Export Sprite Sheet" onClose={onClose} widthClass="w-[560px]">
      <div className="flex gap-1 mb-2" role="tablist">
        {(["layout", "sprite", "borders", "output"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={`px-3 py-0.5 capitalize ${tab === t ? "kpx-bevel-inset bg-[var(--kpx-btn-active)] font-bold" : "kpx-bevel-outset bg-[var(--kpx-btn-bg)]"}`}>{t}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5 min-h-[230px]">
          {tab === "layout" && (<>
            {row("Sheet Type:", <PixelSelect ariaLabel="Sheet Type" value={opts.sheetType} onChange={(v) => set("sheetType", v as SheetOptions["sheetType"])} options={[{ value: "horizontal", label: "Horizontal Strip" }, { value: "vertical", label: "Vertical Strip" }, { value: "rows", label: "By Rows" }, { value: "columns", label: "By Columns" }, { value: "packed", label: "Packed" }]} />)}
            {row("Constraints:", <PixelSelect ariaLabel="Constraints" value={cons.kind} onChange={(v) => set("constraint", v === "none" ? { kind: "none" } : ({ kind: v, value: 4 } as SheetOptions["constraint"]))} options={[{ value: "none", label: "None" }, { value: "fixed-cols", label: "Fixed # of Columns" }, { value: "fixed-rows", label: "Fixed # of Rows" }, { value: "fixed-width", label: "Fixed Width" }, { value: "fixed-height", label: "Fixed Height" }]} />)}
            {cons.kind !== "none" && row("Value:", <NumberField ariaLabel="Constraint value" value={cons.value} min={1} max={8192} onChange={(v) => set("constraint", { ...cons, value: v } as SheetOptions["constraint"])} />)}
            <PixelCheckbox checked={opts.mergeDuplicates} onChange={(v) => set("mergeDuplicates", v)} label="Merge Duplicates" />
            <PixelCheckbox checked={opts.ignoreEmpty} onChange={(v) => set("ignoreEmpty", v)} label="Ignore Empty" />
          </>)}
          {tab === "sprite" && (<>
            {row("Layers:", <PixelSelect ariaLabel="Layers" value={opts.layers} onChange={(v) => set("layers", v as SheetOptions["layers"])} options={[{ value: "visible", label: "Visible layers" }, { value: "selected", label: "Selected layers" }, { value: "all", label: "All layers" }]} />)}
            <PixelCheckbox checked={opts.splitLayers} onChange={(v) => set("splitLayers", v)} label="Split Layers" />
            {row("Frames:", <PixelSelect ariaLabel="Frames" value={opts.frames} onChange={(v) => set("frames", v as SheetOptions["frames"])} options={[{ value: "all", label: "All frames" }, { value: "selected", label: "Selected frames" }, { value: "tag", label: "Tag" }]} />)}
            {opts.frames === "tag" && row("Tag:", <PixelSelect ariaLabel="Tag" value={opts.tag} onChange={(v) => set("tag", v)} options={[{ value: "", label: "(choose)" }, ...sprite.tags.map((t) => ({ value: t.name, label: t.name }))]} />)}
            {opts.frames === "selected" && row("Range:", <span className="flex gap-1"><NumberField ariaLabel="From frame" value={opts.frameRange?.[0] ?? 0} min={0} max={sprite.frames.length - 1} onChange={(v) => set("frameRange", [v, opts.frameRange?.[1] ?? sprite.frames.length - 1])} /><NumberField ariaLabel="To frame" value={opts.frameRange?.[1] ?? sprite.frames.length - 1} min={0} max={sprite.frames.length - 1} onChange={(v) => set("frameRange", [opts.frameRange?.[0] ?? 0, v])} /></span>)}
            <PixelCheckbox checked={opts.splitTags} onChange={(v) => set("splitTags", v)} label="Split Tags" />
            <PixelCheckbox checked={opts.trimSprite} onChange={(v) => set("trimSprite", v)} label="Trim Sprite" />
            <PixelCheckbox checked={opts.trimCels} onChange={(v) => set("trimCels", v)} label="Trim Cels" />
            <PixelCheckbox checked={opts.byGrid} onChange={(v) => set("byGrid", v)} label="By Grid" />
            {opts.byGrid && (<>{num("Grid width:", "gridWidth", 4096)}{num("Grid height:", "gridHeight", 4096)}</>)}
          </>)}
          {tab === "borders" && (<>
            {num("Border Padding:", "borderPadding")}{num("Spacing:", "spacing")}{num("Inner Padding:", "innerPadding")}
            <PixelCheckbox checked={opts.extrude} onChange={(v) => set("extrude", v)} label="Extrude" />
          </>)}
          {tab === "output" && (<>
            {num("Scale:", "scale", 16)}
            <PixelCheckbox checked={wantData} onChange={setWantData} label="JSON Data" />
            {row("Format:", <PixelSelect ariaLabel="JSON format" value={opts.dataFormat} onChange={(v) => set("dataFormat", v as SheetOptions["dataFormat"])} options={[{ value: "json-array", label: "JSON Array" }, { value: "json-hash", label: "JSON Hash" }]} />)}
            {row("Output File:", <TextField ariaLabel="Output File" value={opts.outputFile} onChange={(val) => set("outputFile", val)} className="w-40 px-1 py-0.5" />)}
            {row("Frame names:", <TextField ariaLabel="Frame name template" value={opts.frameNameTemplate} onChange={(val) => set("frameNameTemplate", val)} className="w-40 px-1 py-0.5" />)}
            <PixelCheckbox checked={openAfter} onChange={setOpenAfter} label="Open Sprite Sheet" />
          </>)}
        </div>
        <div className="space-y-1">
          <PixelCheckbox checked={wantPreview} onChange={setWantPreview} label="Preview" />
          <div className="kpx-bevel-inset bg-[#6e6573] p-1 min-h-[160px] flex items-center justify-center overflow-auto max-h-[240px]">
            {wantPreview ? <canvas ref={canvasRef} aria-label="Sprite sheet preview" style={{ imageRendering: "pixelated" }} /> : <span className="opacity-60">preview off</span>}
          </div>
          {result && <div className="text-[10px] opacity-80">{result[0].bitmap.width}×{result[0].bitmap.height}px · {result[0].frameCount} frames{result.length > 1 ? ` · ${result.length} sheets` : ""}</div>}
        </div>
      </div>
      {error && <div role="alert" className="mt-2 p-1.5 bg-red-900/60 text-red-100">{error}</div>}
      <div className="flex justify-end gap-2 pt-2"><PixelButton onClick={onClose}>Cancel</PixelButton><PixelButton active disabled={!result} onClick={() => void doExport()}>Export</PixelButton></div>
    </PixelDialog>
  );
};

/** File > Import Sprite Sheet… with live grid overlay. */
export const ImportSpriteSheetDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [bmp, setBmp] = useState<RgbaBitmap | null>(null);
  const [name, setName] = useState("sheet");
  const [o, setO] = useState<SheetImportOptions>({ tileWidth: 16, tileHeight: 16, offsetX: 0, offsetY: 0, paddingX: 0, paddingY: 0, mode: "frames", ignoreEmpty: true, partial: false, name: "sheet.aseprite" });
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const set = <K extends keyof SheetImportOptions>(k: K, v: SheetImportOptions[K]): void => setO((x) => ({ ...x, [k]: v }));
  const grid = useMemo(() => (bmp ? computeImportGrid(bmp.width, bmp.height, o) : []), [bmp, o]);
  useEffect(() => { if (bmp) drawBitmap(canvasRef.current, bmp, 400, 260, grid); }, [bmp, grid]);
  const choose = async (): Promise<void> => {
    const res = await getPlatform().openFileDialog({ title: "Import Sprite Sheet", extensions: ["png", "gif", "bmp", "qoi", "tga", "ico", "aseprite"] });
    if (!res) return;
    try {
      const { sprite } = decodeSprite(res.data, res.name);
      const img = compositeFrame(sprite, 0);
      setBmp({ width: img.width, height: img.height, data: img.data });
      setName(res.name);
      set("name", res.name.replace(/\.[^.]+$/, "") + ".aseprite");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const doImport = (): void => {
    if (!bmp) return;
    try {
      const sprite = importSpriteSheet(bmp, o);
      openSpriteAsDocument({ get: useAppStore.getState, set: useAppStore.setState } as never, sprite, {});
      appLogger.info("Import", `Imported ${grid.length} tile(s) from ${name}`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const nf = (label: string, k: "tileWidth" | "tileHeight" | "offsetX" | "offsetY" | "paddingX" | "paddingY"): React.ReactElement => (
    <div className="flex items-center justify-between"><span>{label}</span><NumberField ariaLabel={label} value={o[k]} min={k.startsWith("tile") ? 1 : 0} max={4096} onChange={(v) => set(k, v)} /></div>
  );
  return (
    <PixelDialog title="Import Sprite Sheet" onClose={onClose} widthClass="w-[640px]">
      <div className="grid grid-cols-[210px_1fr] gap-3">
        <div className="space-y-1.5">
          <PixelButton onClick={() => void choose()}>Select file…</PixelButton>
          <div className="truncate opacity-70">{bmp ? `${name} (${bmp.width}×${bmp.height})` : "No file selected"}</div>
          {nf("Tile width:", "tileWidth")}{nf("Tile height:", "tileHeight")}{nf("Offset X:", "offsetX")}{nf("Offset Y:", "offsetY")}{nf("Padding X:", "paddingX")}{nf("Padding Y:", "paddingY")}
          <div className="flex items-center justify-between"><span>Import as:</span><PixelSelect ariaLabel="Import as" value={o.mode} onChange={(v) => set("mode", v as SheetImportOptions["mode"])} options={[{ value: "frames", label: "Frames" }, { value: "layers", label: "Layers" }]} /></div>
          <PixelCheckbox checked={o.ignoreEmpty} onChange={(v) => set("ignoreEmpty", v)} label="Ignore empty tiles" />
          <PixelCheckbox checked={o.partial} onChange={(v) => set("partial", v)} label="Include partial tiles" />
          <div className="opacity-80">{grid.length} tile(s)</div>
        </div>
        <div className="kpx-bevel-inset bg-[#6e6573] p-1 flex items-center justify-center min-h-[260px] overflow-auto max-h-[300px]">
          {bmp ? <canvas ref={canvasRef} aria-label="Sprite sheet preview with grid overlay" style={{ imageRendering: "pixelated" }} /> : <span className="opacity-70">Select a sprite sheet image to preview the grid.</span>}
        </div>
      </div>
      {error && <div role="alert" className="mt-2 p-1.5 bg-red-900/60 text-red-100">{error}</div>}
      <div className="flex justify-end gap-2 pt-2"><PixelButton onClick={onClose}>Cancel</PixelButton><PixelButton active disabled={!bmp || grid.length === 0} onClick={doImport}>Import</PixelButton></div>
    </PixelDialog>
  );
};

/** Crash recovery list, shown at startup after an unclean exit and from File > Recover Autosave. */
export const RecoveryDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [snaps, setSnaps] = useState<RecoverySnapshot[] | null>(null);
  useEffect(() => {
    void (async () => {
      const { getPlatform: gp } = await import("../../../core/src/index.ts");
      void gp;
      const raw = await getPlatform().readSetting<Array<{ key: string; docName: string; savedAt: string; kpx: string }>>("autosave.snapshots", []);
      const { base64ToUint8 } = await import("../../../core/src/index.ts");
      setSnaps(raw.map((r) => ({ key: r.key, docName: r.docName, savedAt: r.savedAt, kpx: base64ToUint8(r.kpx) })));
    })();
  }, []);
  const api = { get: useAppStore.getState, set: useAppStore.setState } as never;
  return (
    <PixelDialog title="Recover Unsaved Work" onClose={onClose} widthClass="w-[440px]">
      {snaps === null ? <div>Loading…</div> : snaps.length === 0 ? <div>No autosaved documents found. Autosave runs every 2 minutes for modified documents.</div> : (
        <div className="space-y-1.5">
          <div>Kekenik Pixel did not close cleanly last time. Choose what to restore:</div>
          {snaps.map((s) => (
            <div key={s.key} className="flex items-center justify-between kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] px-2 py-1">
              <span className="truncate">{s.docName} <span className="opacity-60">({new Date(s.savedAt).toLocaleString()})</span></span>
              <PixelButton size="xs" onClick={() => void recoverSnapshot(api, s)}>Restore</PixelButton>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2"><PixelButton onClick={() => void discardRecovery().then(onClose)}>Discard all</PixelButton><PixelButton onClick={onClose}>Close</PixelButton></div>
    </PixelDialog>
  );
};

/** Opens the recovery dialog automatically when the previous session crashed. */
export function useStartupRecovery(): void {
  const openDialog = useAppStore((s) => s.openDialog);
  useEffect(() => {
    void hasRecoverableSession().then((snaps) => {
      if (snaps.length) openDialog("dialog.recovery" as never);
    });
  }, [openDialog]);
}
