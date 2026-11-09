/**
 * @module @kekenik/ui/editor
 * Agent 2 Full Editor Viewport & Rendering Engine (WebGL2 + Canvas2D Dirty-Rect Fallback),
 * Overlays (Pixel Grid, Tile Grid, Draggable Symmetry Guides, Tiled Mode 3x3, Layer Edges,
 * Exact Brush Footprint Cursor), and Interactive Pointer State Machine for all 18 Tools.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AddSliceCommand,
  applyBlurDab,
  applyJumbleDab,
  BrushConfig,
  commitToolEditTransaction,
  compositeFrameAdvanced,
  compositeFrameWithOnionSkin,
  computeCelContentBounds,
  computeZoomToCursorPan,
  createModelId,
  DynamicStrokeSample,
  ExtraCelOverlay,
  findTileOccurrences,
  floodFillImage,
  floodFillTileCells,
  generateBrushFootprint,
  getCel,
  getNextZoomStep,
  getPaletteForFrame,
  getPrevZoomStep,
  getSliceKeyForFrame,
  hexToRgba,
  hitTestSlices,
  packTileEntry,
  paintSprayOnImage,
  paintStrokeOnImage,
  paintTileCells,
  PixelImage,
  pixelToTileCoord,
  Point,
  rasterizeBezierCurve,
  rasterizeEllipse,
  rasterizeLine,
  rasterizePolygon,
  rasterizeRectangle,
  rasterizeTileLine,
  rasterizeTileRectangle,
  Rect,
  renderGradientImage,
  renderTilemapCel,
  RGBA,
  rgbaToHex,
  snapPointToGrid,
  stampTextOnImage,
  syncTilemapFromEditedPixels,
  combineMasks,
  computeMarchingAntsSegments,
  constrainLineEndpoint,
  createEllipseMarqueeMask,
  createMagicWandMask,
  createPolygonLassoMask,
  createRectMarqueeMask,
  Mask,
  renderFloatingTransformWithBounds,
  resolveSelectionMode,
  rotateImageOrthogonal,
  SelectionCombineMode,
  TilemapEditCommand,
  TilemapLayer,
  translateMask,
  UpdateSliceCommand,
  upsertSliceKey,
  wrapTiledCoord,
} from "../../../core/src/index.ts";
import { useAppStore } from "../app/store.ts";
import { isTextEntryTarget } from "../app/keyboard.ts";
import { NumberField, PixelButton, PixelSelect, TextField } from "../widgets/index.tsx";

/**
 * Uploads an RGBA PixelImage to a WebGL2 texture and renders a crisp nearest-neighbor quad,
 * returning true on success or false if WebGL2 is unavailable in the current environment.
 */
function renderWithWebGL2(
  glCanvas: HTMLCanvasElement,
  comp: PixelImage,
  checkerSize: number,
  color1Hex: string,
  color2Hex: string
): boolean {
  const gl = glCanvas.getContext("webgl2", {
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) return false;

  const w = comp.width;
  const h = comp.height;
  if (glCanvas.width !== w || glCanvas.height !== h) {
    glCanvas.width = w;
    glCanvas.height = h;
  }

  // Composite checkerboard + RGBA pixels into a single upload buffer for single-draw-call speed
  const c1 = hexToRgba(color1Hex);
  const c2 = hexToRgba(color2Hex);
  const tile = Math.max(1, Math.floor(checkerSize / 2));
  const merged = new Uint8Array(w * h * 4);
  const src = comp.data;

  for (let y = 0; y < h; y++) {
    const ty = Math.floor(y / tile);
    for (let x = 0; x < w; x++) {
      const tx = Math.floor(x / tile);
      const chk = (tx + ty) % 2 === 0 ? c1 : c2;
      const idx = (y * w + x) * 4;
      const sa = src[idx + 3] / 255;
      if (sa >= 1) {
        merged[idx] = src[idx];
        merged[idx + 1] = src[idx + 1];
        merged[idx + 2] = src[idx + 2];
        merged[idx + 3] = 255;
      } else if (sa <= 0) {
        merged[idx] = chk.r;
        merged[idx + 1] = chk.g;
        merged[idx + 2] = chk.b;
        merged[idx + 3] = 255;
      } else {
        merged[idx] = Math.round(src[idx] * sa + chk.r * (1 - sa));
        merged[idx + 1] = Math.round(src[idx + 1] * sa + chk.g * (1 - sa));
        merged[idx + 2] = Math.round(src[idx + 2] * sa + chk.b * (1 - sa));
        merged[idx + 3] = 255;
      }
    }
  }

  gl.viewport(0, 0, w, h);
  const vsSource = `#version 300 es
    in vec2 a_pos;
    out vec2 v_uv;
    void main() {
      v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;
  const fsSource = `#version 300 es
    precision mediump float;
    in vec2 v_uv;
    uniform sampler2D u_tex;
    out vec4 outColor;
    void main() {
      outColor = texture(u_tex, v_uv);
    }
  `;

  const compile = (type: number, srcCode: string) => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, srcCode);
    gl.compileShader(sh);
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return false;

  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );
  const loc = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, merged);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.deleteTexture(tex);
  gl.deleteBuffer(buf);
  gl.deleteProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return true;
}

/**
 * Renders checkerboard + composited RGBA image onto a 2D canvas (`imageSmoothingEnabled = false`).
 */
function renderWithCanvas2D(
  canvas: HTMLCanvasElement,
  comp: PixelImage,
  checkerSize: number,
  color1Hex: string,
  color2Hex: string
): void {
  const w = comp.width;
  const h = comp.height;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;

  const tile = Math.max(1, Math.floor(checkerSize / 2));
  for (let y = 0; y < h; y += tile) {
    for (let x = 0; x < w; x += tile) {
      const isEven = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 === 0;
      ctx.fillStyle = isEven ? color1Hex : color2Hex;
      ctx.fillRect(x, y, Math.min(tile, w - x), Math.min(tile, h - y));
    }
  }

  const offscreen = document.createElement("canvas");
  offscreen.width = w;
  offscreen.height = h;
  const offCtx = offscreen.getContext("2d");
  if (offCtx) {
    const imgData = new ImageData(new Uint8ClampedArray(comp.data), w, h);
    offCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(offscreen, 0, 0);
  }
}

interface CurveInteractiveState {
  stage: "dragging_line" | "adjusting_handles";
  p0: Point;
  p1: Point;
  p2: Point;
  p3: Point;
  draggingHandle: "p1" | "p2" | null;
  button: number;
}

export const SpriteEditor: React.FC = () => {
  const doc = useAppStore((s) => s.getActiveDocument());
  const rev = useAppStore((s) => s.docRevision);
  const activeLayerId = useAppStore((s) => s.activeLayerId);
  const activeFrameIndex = useAppStore((s) => s.activeFrameIndex);
  const activeToolId = useAppStore((s) => s.activeToolId);
  const toolOptions = useAppStore((s) => s.toolOptions);
  const lastStrokePoint = useAppStore((s) => s.lastStrokePoint);
  const fgColor = useAppStore((s) => s.fgColor);
  const bgColor = useAppStore((s) => s.bgColor);
  const zoom = useAppStore((s) => s.zoom);
  const panX = useAppStore((s) => s.panX);
  const panY = useAppStore((s) => s.panY);
  const cursorPos = useAppStore((s) => s.cursorPos);
  const showGrid = useAppStore((s) => s.showGrid);
  const showPixelGrid = useAppStore((s) => s.showPixelGrid);
  const snapToGrid = useAppStore((s) => s.snapToGrid);
  const gridColor = useAppStore((s) => s.gridColor);
  const gridOpacity = useAppStore((s) => s.gridOpacity);
  const gridThickness = useAppStore((s) => s.gridThickness);
  const tiledMode = useAppStore((s) => s.tiledMode);
  const runCommandById = useAppStore((s) => s.runCommandById);
  const showExtras = useAppStore((s) => s.showExtras);
  const showLayerEdges = useAppStore((s) => s.showLayerEdges);
  const renderBackend = useAppStore((s) => s.renderBackend);
  const cursorStyle = useAppStore((s) => s.cursorStyle);
  const checkerSize = useAppStore((s) => s.checkerSize);
  const checkerColor1 = useAppStore((s) => s.checkerColor1);
  const checkerColor2 = useAppStore((s) => s.checkerColor2);
  const onionSkin = useAppStore((s) => s.onionSkin);
  const activeSliceId = useAppStore((s) => s.activeSliceId);
  const showSlicesOverlay = useAppStore((s) => s.showSlicesOverlay);
  const tilemapEditMode = useAppStore((s) => s.tilemapEditMode);
  const tilesetModMode = useAppStore((s) => s.tilesetModMode);
  const activeTileIndex = useAppStore((s) => s.activeTileIndex);
  const tileFlipX = useAppStore((s) => s.tileFlipX);
  const tileFlipY = useAppStore((s) => s.tileFlipY);
  const tileRot90 = useAppStore((s) => s.tileRot90);
  const highlightUsedTiles = useAppStore((s) => s.highlightUsedTiles);
  const floatingSelection = useAppStore((s) => s.floatingSelection);
  const showSelectionEdges = useAppStore((s) => s.showSelectionEdges);

  const setActiveSliceId = useAppStore((s) => s.setActiveSliceId);
  const openDialog = useAppStore((s) => s.openDialog);
  const setZoom = useAppStore((s) => s.setZoom);
  const setPan = useAppStore((s) => s.setPan);
  const setCursorPos = useAppStore((s) => s.setCursorPos);
  const setFgColor = useAppStore((s) => s.setFgColor);
  const setBgColor = useAppStore((s) => s.setBgColor);
  const setToolOption = useAppStore((s) => s.setToolOption);
  const setLastStrokePoint = useAppStore((s) => s.setLastStrokePoint);
  const bumpRevision = useAppStore((s) => s.bumpRevision);
  const setFloatingSelection = useAppStore((s) => s.setFloatingSelection);
  const updateFloatingSelection = useAppStore((s) => s.updateFloatingSelection);
  const commitFloatingSelection = useAppStore((s) => s.commitFloatingSelection);
  const cancelFloatingSelection = useAppStore((s) => s.cancelFloatingSelection);
  const liftActiveSelectionToFloating = useAppStore((s) => s.liftActiveSelectionToFloating);
  const nudgeSelectionOrCel = useAppStore((s) => s.nudgeSelectionOrCel);
  const pasteAsNewBrush = useAppStore((s) => s.pasteAsNewBrush);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const [spacePressed, setSpacePressed] = useState(false);
  const [extraCel, setExtraCel] = useState<ExtraCelOverlay | null>(null);
  const [renderTick, setRenderTick] = useState(0);

  // Interactive multi-stage tool states (Curve, Polygon, Text, Gradient vector, Slice drag, Selection draft)
  const [curveState, setCurveState] = useState<CurveInteractiveState | null>(null);
  const [polygonVertices, setPolygonVertices] = useState<Point[]>([]);
  const [lassoPolygonVerts, setLassoPolygonVerts] = useState<Point[]>([]);
  const [selectionDraftMask, setSelectionDraftMask] = useState<Mask | null>(null);
  const [textPos, setTextPos] = useState<Point | null>(null);
  const [gradVector, setGradVector] = useState<{ start: Point; end: Point } | null>(null);
  const [sliceDraftBounds, setSliceDraftBounds] = useState<Rect | null>(null);

  const selectionCombineRef = useRef<SelectionCombineMode>("replace");
  const maskDragOriginRef = useRef<{ startPt: Point; origMask: Mask } | null>(null);
  const transformDragRef = useRef<{
    handle:
      | "move"
      | "nw"
      | "n"
      | "ne"
      | "e"
      | "se"
      | "s"
      | "sw"
      | "w"
      | "rotate"
      | "skew_x"
      | "skew_y"
      | "pivot";
    startPt: Point;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
    origAngle: number;
    origSkewX: number;
    origSkewY: number;
  } | null>(null);
  const sliceDragModeRef = useRef<{
    mode: "create" | "move";
    sliceId?: string;
    startPt: Point;
    origBounds?: Rect;
  } | null>(null);
  const workingTilemapRef = useRef<Uint32Array | null>(null);

  // Refs for active drag session
  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const dragStartPtRef = useRef<Point>({ x: 0, y: 0 });
  const strokePointsRef = useRef<Point[]>([]);
  const strokeSamplesRef = useRef<DynamicStrokeSample[]>([]);
  const lastMoveTimeRef = useRef<number>(Date.now());
  const activeButtonRef = useRef(0);
  const workingPreviewRef = useRef<PixelImage | null>(null);
  const sprayTickRef = useRef<number>(1);
  const draggingSymmetryRef = useRef<"x" | "y" | null>(null);

  const activeBrushConfig: BrushConfig = useMemo(
    () => ({
      id: "active_brush",
      name: "Active",
      category: "Basic",
      type: toolOptions.brushShape,
      size: toolOptions.brushSize,
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
    }),
    [
      toolOptions.brushShape,
      toolOptions.brushSize,
      toolOptions.brushAngle,
      toolOptions.brushSpacing,
      toolOptions.patternAlign,
      toolOptions.flipH,
      toolOptions.flipV,
      toolOptions.pressureSize,
      toolOptions.pressureAngle,
      toolOptions.velocitySize,
      toolOptions.gradientDither,
      toolOptions.customBrushImage,
    ]
  );

  // Build paint options helper from current store state
  const buildStrokeOptions = useCallback(
    (button: number, samples?: readonly DynamicStrokeSample[]) => {
      if (!doc) {
        return { fgColor, bgColor, button };
      }
      const sprite = doc.sprite;
      const palette = getPaletteForFrame(sprite, activeFrameIndex);
      const layer = sprite.layers.find((l) => l.id === activeLayerId);
      const rampStart = Math.min(toolOptions.shadingRampFrom, toolOptions.shadingRampTo);
      const rampEnd = Math.max(toolOptions.shadingRampFrom, toolOptions.shadingRampTo);
      const shadingRamp = palette.slice(rampStart, rampEnd + 1);

      const isEraser =
        activeToolId === "tool.eraser" ||
        (button === 2 &&
          activeToolId === "tool.pencil" &&
          toolOptions.rightClickMode === "eraser");

      return {
        fgColor,
        bgColor,
        brush: activeBrushConfig,
        inkMode: activeToolId === "tool.shading" ? ("shading" as const) : toolOptions.inkMode,
        opacity: toolOptions.opacity,
        button,
        isEraser,
        isBackgroundLayer: Boolean(layer?.background),
        pixelPerfect: toolOptions.pixelPerfect,
        stabilizerFactor: toolOptions.stabilizerFactor,
        ditherMatrixId: toolOptions.ditherMatrixId,
        ditherRatio: toolOptions.ditherRatio / 100,
        customDitherMatrix: toolOptions.customDitherMatrix,
        symmetryMode: toolOptions.symmetryMode,
        symmetryX: toolOptions.symmetryX ?? sprite.width / 2,
        symmetryY: toolOptions.symmetryY ?? sprite.height / 2,
        tiledMode,
        palette,
        transparentIndex: sprite.transparentIndex,
        shadingRamp,
        mask: sprite.mask,
        samples,
      };
    },
    [
      doc,
      activeFrameIndex,
      activeLayerId,
      activeToolId,
      fgColor,
      bgColor,
      activeBrushConfig,
      toolOptions,
      tiledMode,
    ]
  );

  // Commit interactive Curve
  const commitActiveCurve = useCallback(() => {
    if (!doc || !curveState) return;
    const pts = rasterizeBezierCurve(
      curveState.p0,
      curveState.p1,
      curveState.p2,
      curveState.p3
    );
    const opts = buildStrokeOptions(curveState.button);
    commitToolEditTransaction(doc, activeLayerId, activeFrameIndex, "Curve Tool", (img) =>
      paintStrokeOnImage(img, pts, { ...opts, pixelPerfect: false, stabilizerFactor: 0 })
    );
    setCurveState(null);
    setExtraCel(null);
    bumpRevision();
  }, [doc, curveState, buildStrokeOptions, activeLayerId, activeFrameIndex, bumpRevision]);

  // Commit interactive Polygon
  const commitActivePolygon = useCallback(
    (verts: readonly Point[]) => {
      if (!doc || verts.length < 2) {
        setPolygonVertices([]);
        setExtraCel(null);
        return;
      }
      const pts = rasterizePolygon(verts, toolOptions.shapeFilled);
      const opts = buildStrokeOptions(0);
      commitToolEditTransaction(doc, activeLayerId, activeFrameIndex, "Polygon Tool", (img) =>
        paintStrokeOnImage(img, pts, {
          ...opts,
          brush: toolOptions.shapeFilled ? { ...activeBrushConfig, size: 1, type: "square" } : activeBrushConfig,
          pixelPerfect: false,
          stabilizerFactor: 0,
        })
      );
      setPolygonVertices([]);
      setExtraCel(null);
      bumpRevision();
    },
    [
      doc,
      toolOptions.shapeFilled,
      buildStrokeOptions,
      activeLayerId,
      activeFrameIndex,
      activeBrushConfig,
      bumpRevision,
    ]
  );

  // Commit interactive Text
  const commitActiveText = useCallback(() => {
    if (!doc || !textPos) return;
    commitToolEditTransaction(
      doc,
      activeLayerId,
      activeFrameIndex,
      `Text "${toolOptions.textContent}"`,
      (img, palette, transparentIndex) =>
        stampTextOnImage(
          img,
          toolOptions.textContent,
          textPos.x,
          textPos.y,
          fgColor,
          toolOptions.textFontSize,
          toolOptions.textAntiAlias,
          palette,
          transparentIndex
        )
    );
    setTextPos(null);
    setExtraCel(null);
    bumpRevision();
  }, [doc, textPos, activeLayerId, activeFrameIndex, toolOptions, fgColor, bumpRevision]);

  const commitPolygonalLasso = useCallback(
    (verts: readonly Point[]) => {
      if (!doc || verts.length < 2) {
        setLassoPolygonVerts([]);
        setSelectionDraftMask(null);
        return;
      }
      const polyMask = createPolygonLassoMask(doc.sprite.width, doc.sprite.height, verts);
      const nextMask = combineMasks(doc.sprite.mask, polyMask, selectionCombineRef.current);
      doc.transact("Polygonal Lasso Selection", (tx) =>
        tx.setMask(nextMask, "Polygonal Lasso Selection")
      );
      setLassoPolygonVerts([]);
      setSelectionDraftMask(null);
      bumpRevision();
    },
    [doc, bumpRevision]
  );

  // Sync live ExtraCel preview whenever floatingSelection changes (B01 unclipped bounds)
  useEffect(() => {
    if (!doc || !floatingSelection) {
      return;
    }
    const cel = getCel(doc.sprite, activeLayerId, activeFrameIndex);
    if (!cel) return;
    const pal = getPaletteForFrame(doc.sprite, activeFrameIndex);
    const {
      image: transformed,
      localMask,
      offsetX,
      offsetY,
    } = renderFloatingTransformWithBounds(
      floatingSelection,
      pal,
      doc.sprite.transparentIndex
    );
    const preview = cel.image.clone();
    const baseX = Math.round(floatingSelection.x) + offsetX;
    const baseY = Math.round(floatingSelection.y) + offsetY;
    for (let sy = 0; sy < transformed.height; sy++) {
      const dy = baseY + sy;
      if (dy < 0 || dy >= preview.height) continue;
      for (let sx = 0; sx < transformed.width; sx++) {
        const dx = baseX + sx;
        if (dx < 0 || dx >= preview.width) continue;
        if (!localMask.getBit(sx, sy)) continue;
        const c = transformed.getRGBA(sx, sy, pal, doc.sprite.transparentIndex);
        if (c.a === 0) continue;
        preview.setRGBA(dx, dy, c, pal, doc.sprite.transparentIndex);
      }
    }
    setExtraCel({
      layerId: activeLayerId,
      frameIndex: activeFrameIndex,
      x: 0,
      y: 0,
      image: preview,
      replaceTargetCel: true,
    });
  }, [doc, floatingSelection, activeLayerId, activeFrameIndex, rev]);

  // Keyboard listener for Space pan, Escape cancel, Enter commit, and Arrow nudging
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Canvas-level handling only: ignore keystrokes typed into any text widget.
      if (isTextEntryTarget(e.target)) return;

      if (e.code === "Space") {
        setSpacePressed(true);
      } else if (e.key === "Escape") {
        isDrawingRef.current = false;
        strokePointsRef.current = [];
        workingPreviewRef.current = null;
        setCurveState(null);
        setPolygonVertices([]);
        setLassoPolygonVerts([]);
        setSelectionDraftMask(null);
        setTextPos(null);
        setGradVector(null);
        if (floatingSelection) {
          cancelFloatingSelection();
        }
        setExtraCel(null);
      } else if (e.key === "Enter") {
        if (floatingSelection) {
          e.preventDefault();
          commitFloatingSelection();
          setExtraCel(null);
        } else if (lassoPolygonVerts.length >= 2) {
          e.preventDefault();
          commitPolygonalLasso(lassoPolygonVerts);
        } else if (curveState) {
          e.preventDefault();
          commitActiveCurve();
        } else if (polygonVertices.length >= 2) {
          e.preventDefault();
          commitActivePolygon(polygonVertices);
        } else if (textPos) {
          e.preventDefault();
          commitActiveText();
        }
      } else if (
        (activeToolId === "tool.move" ||
          floatingSelection !== null ||
          (doc && !doc.sprite.mask.isEmpty)) &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) &&
        !e.altKey
      ) {
        e.preventDefault();
        const step = e.shiftKey ? (doc?.sprite.grid.visible ? doc.sprite.grid.width : 10) : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        nudgeSelectionOrCel(dx, dy, e.ctrlKey && e.shiftKey);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePressed(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    activeToolId,
    doc,
    floatingSelection,
    lassoPolygonVerts,
    curveState,
    polygonVertices,
    textPos,
    commitActiveCurve,
    commitActivePolygon,
    commitPolygonalLasso,
    commitActiveText,
    commitFloatingSelection,
    cancelFloatingSelection,
    nudgeSelectionOrCel,
  ]);

  // Clear pending interactive states when switching tools
  useEffect(() => {
    setCurveState(null);
    setPolygonVertices([]);
    setTextPos(null);
    setGradVector(null);
    setExtraCel(null);
  }, [activeToolId]);

  // Render composite frame (including Extra-Cel preview and Onion Skin) to WebGL2 or Canvas2D
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    const sprite = doc.sprite;

    const composited = onionSkin.enabled
      ? compositeFrameWithOnionSkin(
          sprite,
          activeFrameIndex,
          activeLayerId,
          onionSkin,
          extraCel
        )
      : compositeFrameAdvanced(sprite, activeFrameIndex, {
          extraCel,
        });

    if (renderBackend === "webgl2") {
      const ok = renderWithWebGL2(
        canvas,
        composited,
        checkerSize,
        checkerColor1,
        checkerColor2
      );
      if (ok) {
        setRenderTick((t) => t + 1);
        return;
      }
    }

    renderWithCanvas2D(canvas, composited, checkerSize, checkerColor1, checkerColor2);
    setRenderTick((t) => t + 1);
  }, [
    doc,
    rev,
    activeFrameIndex,
    activeLayerId,
    onionSkin,
    extraCel,
    renderBackend,
    checkerSize,
    checkerColor1,
    checkerColor2,
  ]);

  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--kpx-canvas-surround)] text-white font-mono text-xs">
        No sprite open.
      </div>
    );
  }

  const sprite = doc.sprite;
  const scale = zoom / 100;
  const displayW = Math.max(1, Math.round(sprite.width * sprite.pixelRatio.w * scale));
  const displayH = Math.max(1, Math.round(sprite.height * sprite.pixelRatio.h * scale));

  const symX = toolOptions.symmetryX ?? sprite.width / 2;
  const symY = toolOptions.symmetryY ?? sprite.height / 2;

  const clientToSpriteCoords = (
    clientX: number,
    clientY: number,
    wrapForTiled = false
  ): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    let x = Math.floor(((clientX - rect.left) / Math.max(1, rect.width)) * sprite.width);
    let y = Math.floor(((clientY - rect.top) / Math.max(1, rect.height)) * sprite.height);

    if (wrapForTiled) {
      const wrapped = wrapTiledCoord(x, y, sprite.width, sprite.height, tiledMode);
      if (wrapped) {
        x = wrapped.x;
        y = wrapped.y;
      }
    }
    const rawPt = { x, y };
    if (snapToGrid) {
      return snapPointToGrid(rawPt, sprite.grid);
    }
    return rawPt;
  };

  const sampleColorAt = (pt: Point, button: number) => {
    const palette = getPaletteForFrame(sprite, activeFrameIndex);
    let sampled: RGBA = { r: 0, g: 0, b: 0, a: 255 };
    if (toolOptions.sampleMode === "current") {
      const cel = getCel(sprite, activeLayerId, activeFrameIndex);
      if (cel) {
        sampled = cel.image.getRGBA(pt.x, pt.y, palette, sprite.transparentIndex);
      }
    } else {
      const comp = compositeFrameAdvanced(sprite, activeFrameIndex);
      sampled = comp.getRGBA(pt.x, pt.y, palette, sprite.transparentIndex);
    }
    if (button === 2) {
      setBgColor(sampled);
    } else {
      setFgColor(sampled);
    }
  };

  const updateExtraCelFromWorking = (workingImg: PixelImage) => {
    setExtraCel({
      layerId: activeLayerId,
      frameIndex: activeFrameIndex,
      x: 0,
      y: 0,
      image: workingImg,
      replaceTargetCel: true,
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 1. Middle click, Space+drag, or Hand tool -> Pan
    if (e.button === 1 || spacePressed || activeToolId === "tool.hand") {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
      return;
    }

    // 2. Zoom tool
    if (activeToolId === "tool.zoom") {
      const next = e.button === 2 || e.altKey ? getPrevZoomStep(zoom) : getNextZoomStep(zoom);
      setZoom(next);
      return;
    }

    const pt = clientToSpriteCoords(e.clientX, e.clientY);

    const wrappedSeedPt = clientToSpriteCoords(e.clientX, e.clientY, true);

    // 3. Quick Eyedropper (Alt+Click or Eyedropper tool)
    if (e.altKey || activeToolId === "tool.eyedropper") {
      sampleColorAt(wrappedSeedPt, e.button);
      return;
    }

    // 3a. Ctrl+Shift+Drag -> Quick Selection Mask Translation (moves mask without moving pixels)
    if (e.ctrlKey && e.shiftKey && !sprite.mask.isEmpty) {
      maskDragOriginRef.current = {
        startPt: pt,
        origMask: sprite.mask.clone(),
      };
      isDrawingRef.current = true;
      return;
    }

    // 3a-2. Selection Tools (`marquee_rect`, `marquee_ellipse`, `lasso`, `polygonal_lasso`, `magic_wand`)
    if (
      activeToolId === "tool.marquee_rect" ||
      activeToolId === "tool.marquee_ellipse" ||
      activeToolId === "tool.lasso" ||
      activeToolId === "tool.polygonal_lasso" ||
      activeToolId === "tool.magic_wand"
    ) {
      const combineMode = resolveSelectionMode(
        toolOptions.selectionMode,
        e.shiftKey,
        e.altKey
      );
      selectionCombineRef.current = combineMode;

      if (activeToolId === "tool.magic_wand") {
        const celForWand = getCel(sprite, activeLayerId, activeFrameIndex);
        const sampleImg =
          toolOptions.sampleMode === "composite" || !celForWand
            ? compositeFrameAdvanced(sprite, activeFrameIndex)
            : celForWand.image;
        const pal = getPaletteForFrame(sprite, activeFrameIndex);
        const wandMask = createMagicWandMask(sampleImg, wrappedSeedPt.x, wrappedSeedPt.y, {
          tolerance: toolOptions.tolerance,
          contiguous: toolOptions.contiguous,
          eightConnected: toolOptions.eightConnected,
          palette: pal,
          transparentIndex: sprite.transparentIndex,
        });
        const nextMask = combineMasks(sprite.mask, wandMask, combineMode);
        doc.transact("Magic Wand Selection", (tx) =>
          tx.setMask(nextMask, "Magic Wand Selection")
        );
        bumpRevision();
        return;
      }

      if (activeToolId === "tool.polygonal_lasso") {
        if (
          lassoPolygonVerts.length >= 3 &&
          Math.hypot(pt.x - lassoPolygonVerts[0].x, pt.y - lassoPolygonVerts[0].y) <= 1.5
        ) {
          commitPolygonalLasso(lassoPolygonVerts);
          return;
        }
        const nextVerts = [...lassoPolygonVerts, pt];
        setLassoPolygonVerts(nextVerts);
        setSelectionDraftMask(createPolygonLassoMask(sprite.width, sprite.height, nextVerts));
        return;
      }

      dragStartPtRef.current = pt;
      strokePointsRef.current = [pt];
      isDrawingRef.current = true;

      if (activeToolId === "tool.marquee_rect") {
        setSelectionDraftMask(
          createRectMarqueeMask(sprite.width, sprite.height, pt, pt, {
            constraint: toolOptions.marqueeConstraint,
            ratioW: toolOptions.marqueeRatioW,
            ratioH: toolOptions.marqueeRatioH,
            fixedW: toolOptions.marqueeFixedW,
            fixedH: toolOptions.marqueeFixedH,
          })
        );
      } else if (activeToolId === "tool.marquee_ellipse") {
        setSelectionDraftMask(
          createEllipseMarqueeMask(sprite.width, sprite.height, pt, pt, {
            constraint: toolOptions.marqueeConstraint,
            ratioW: toolOptions.marqueeRatioW,
            ratioH: toolOptions.marqueeRatioH,
            fixedW: toolOptions.marqueeFixedW,
            fixedH: toolOptions.marqueeFixedH,
          })
        );
      } else if (activeToolId === "tool.lasso") {
        setSelectionDraftMask(createPolygonLassoMask(sprite.width, sprite.height, [pt]));
      }
      return;
    }

    // 3a-3. Move & Transform Tool (`tool.move`, V)
    if (activeToolId === "tool.move") {
      if (toolOptions.moveTargetMode === "selection_mask" && !sprite.mask.isEmpty) {
        maskDragOriginRef.current = {
          startPt: pt,
          origMask: sprite.mask.clone(),
        };
        isDrawingRef.current = true;
        return;
      }

      let currentFloating = floatingSelection;
      if (!currentFloating) {
        currentFloating = liftActiveSelectionToFloating(e.altKey);
      } else if (e.altKey) {
        // Alt-dragging an already floating selection stamps a copy and continues dragging!
        commitFloatingSelection();
        currentFloating = liftActiveSelectionToFloating(true);
      }

      if (currentFloating) {
        transformDragRef.current = {
          handle: "move",
          startPt: pt,
          origX: currentFloating.x,
          origY: currentFloating.y,
          origW: currentFloating.width,
          origH: currentFloating.height,
          origAngle: currentFloating.angleDeg,
          origSkewX: currentFloating.skewXDeg,
          origSkewY: currentFloating.skewYDeg,
        };
        isDrawingRef.current = true;
      }
      return;
    }

    // 3b. Interactive Slice Tool (`tool.slice`, Shift+C)
    if (activeToolId === "tool.slice") {
      const hitSlice = hitTestSlices(sprite.slices, activeFrameIndex, pt.x, pt.y);
      if (hitSlice) {
        setActiveSliceId(hitSlice.id);
        const key = getSliceKeyForFrame(hitSlice, activeFrameIndex);
        sliceDragModeRef.current = {
          mode: "move",
          sliceId: hitSlice.id,
          startPt: pt,
          origBounds: { ...key.bounds },
        };
      } else {
        sliceDragModeRef.current = {
          mode: "create",
          startPt: pt,
        };
        setSliceDraftBounds({ x: pt.x, y: pt.y, width: 1, height: 1 });
      }
      isDrawingRef.current = true;
      return;
    }

    const cel = getCel(sprite, activeLayerId, activeFrameIndex);
    if (!cel) return;
    const activeLayer = sprite.layers.find((l) => l.id === activeLayerId);
    const activeTileset =
      activeLayer && activeLayer.kind === "tilemap"
        ? sprite.tilesets.find((ts) => ts.id === (activeLayer as TilemapLayer).tilesetId) ??
          sprite.tilesets[0]
        : null;

    activeButtonRef.current = e.button;
    dragStartPtRef.current = pt;
    lastMoveTimeRef.current = Date.now();

    // 3c. Tilemap Layer in Tiles Mode (`tilemapEditMode === "tiles"`)
    if (
      activeLayer &&
      activeLayer.kind === "tilemap" &&
      cel.tilemapData &&
      activeTileset &&
      tilemapEditMode === "tiles"
    ) {
      const packedTile =
        e.button === 2 || activeToolId === "tool.eraser"
          ? 0
          : packTileEntry(
              activeTileIndex + activeTileset.baseIndex,
              tileFlipX,
              tileFlipY,
              tileRot90
            );
      const tileCoord = pixelToTileCoord(pt.x, pt.y, activeTileset);

      if (activeToolId === "tool.paint_bucket") {
        const beforeTiles = new Uint32Array(cel.tilemapData.tiles);
        const workingTiles = new Uint32Array(cel.tilemapData.tiles);
        const changed = floodFillTileCells(
          { width: cel.tilemapData.width, height: cel.tilemapData.height, tiles: workingTiles },
          tileCoord.x,
          tileCoord.y,
          packedTile,
          toolOptions.contiguous
        );
        if (changed) {
          doc.execute(
            new TilemapEditCommand({
              label: "Tile Bucket Fill",
              layerId: activeLayerId,
              frameIndex: activeFrameIndex,
              tilesetId: activeTileset.id,
              beforeTiles,
              afterTiles: workingTiles,
            })
          );
          bumpRevision();
        }
        return;
      }

      isDrawingRef.current = true;
      const workingTiles = new Uint32Array(cel.tilemapData.tiles);
      paintTileCells(
        { width: cel.tilemapData.width, height: cel.tilemapData.height, tiles: workingTiles },
        [tileCoord],
        packedTile
      );
      workingTilemapRef.current = workingTiles;
      const tempCel = {
        ...cel,
        tilemapData: {
          width: cel.tilemapData.width,
          height: cel.tilemapData.height,
          tiles: workingTiles,
        },
      };
      const pal = getPaletteForFrame(sprite, activeFrameIndex);
      const rendered = renderTilemapCel(
        tempCel,
        activeLayer as TilemapLayer,
        sprite.tilesets,
        sprite.width,
        sprite.height,
        pal,
        sprite.transparentIndex
      );
      workingPreviewRef.current = rendered;
      updateExtraCelFromWorking(rendered);
      return;
    }

    // 4. Paint Bucket Flood Fill (Immediate commit on click)
    if (activeToolId === "tool.paint_bucket") {
      const sampleImg =
        toolOptions.sampleMode === "composite"
          ? compositeFrameAdvanced(sprite, activeFrameIndex)
          : undefined;
      const fillColor = e.button === 2 ? bgColor : fgColor;
      const secondaryColor = e.button === 2 ? fgColor : bgColor;

      commitToolEditTransaction(doc, activeLayerId, activeFrameIndex, "Paint Bucket Fill", (img, palette, transparentIndex) =>
        floodFillImage(img, {
          x: wrappedSeedPt.x,
          y: wrappedSeedPt.y,
          fillColor,
          secondaryColor,
          tolerance: toolOptions.tolerance,
          contiguous: toolOptions.contiguous,
          eightConnected: toolOptions.eightConnected,
          sampleImage: sampleImg,
          inkMode: toolOptions.inkMode,
          opacity: toolOptions.opacity,
          ditherMatrixId: toolOptions.ditherMatrixId,
          ditherRatio: toolOptions.ditherRatio / 100,
          customDitherMatrix: toolOptions.customDitherMatrix,
          patternAlign: toolOptions.patternAlign,
          patternImage: toolOptions.customBrushImage,
          palette,
          transparentIndex,
          mask: sprite.mask,
        })
      );
      bumpRevision();
      return;
    }

    // 5. Text Tool (Interactive placement & live preview)
    if (activeToolId === "tool.text") {
      setTextPos(pt);
      const preview = cel.image.clone();
      const palette = getPaletteForFrame(sprite, activeFrameIndex);
      stampTextOnImage(
        preview,
        toolOptions.textContent,
        pt.x,
        pt.y,
        fgColor,
        toolOptions.textFontSize,
        toolOptions.textAntiAlias,
        palette,
        sprite.transparentIndex
      );
      updateExtraCelFromWorking(preview);
      return;
    }

    // 6. Polygon Tool (Multi-point vertex clicking; double-click or start-snap closes)
    if (activeToolId === "tool.polygon") {
      if (
        polygonVertices.length >= 3 &&
        Math.hypot(pt.x - polygonVertices[0].x, pt.y - polygonVertices[0].y) <= 1.5
      ) {
        commitActivePolygon(polygonVertices);
        return;
      }
      const nextVerts = [...polygonVertices, pt];
      setPolygonVertices(nextVerts);
      const preview = cel.image.clone();
      const polyPts = rasterizePolygon(nextVerts, toolOptions.shapeFilled);
      paintStrokeOnImage(preview, polyPts, {
        ...buildStrokeOptions(e.button),
        pixelPerfect: false,
        stabilizerFactor: 0,
      });
      updateExtraCelFromWorking(preview);
      return;
    }

    // 7. Curve Tool (Two-Stage Interactive Bezier)
    if (activeToolId === "tool.curve") {
      if (curveState && curveState.stage === "adjusting_handles") {
        // Pick nearest control handle P1 or P2
        const d1 = Math.hypot(pt.x - curveState.p1.x, pt.y - curveState.p1.y);
        const d2 = Math.hypot(pt.x - curveState.p2.x, pt.y - curveState.p2.y);
        const handle = d1 <= d2 ? "p1" : "p2";
        setCurveState({
          ...curveState,
          draggingHandle: handle,
          [handle]: pt,
        });
        isDrawingRef.current = true;
        return;
      }
      const initialCurve: CurveInteractiveState = {
        stage: "dragging_line",
        p0: pt,
        p1: pt,
        p2: pt,
        p3: pt,
        draggingHandle: null,
        button: e.button,
      };
      setCurveState(initialCurve);
      isDrawingRef.current = true;
      return;
    }

    // 8. Freehand / Shape / Spray / Gradient / Blur / Jumble tools
    isDrawingRef.current = true;
    const pressure = e.pressure > 0 ? e.pressure : 1;

    // Shift+Click with Pencil/Eraser connects straight line from lastStrokePoint!
    if (
      e.shiftKey &&
      lastStrokePoint &&
      (activeToolId === "tool.pencil" || activeToolId === "tool.eraser")
    ) {
      const linePts = rasterizeLine(lastStrokePoint, pt);
      strokePointsRef.current = linePts;
      strokeSamplesRef.current = linePts.map((_, idx) => ({
        pressure,
        velocity: 0,
        strokeProgress: linePts.length > 1 ? idx / (linePts.length - 1) : 0,
      }));
    } else {
      strokePointsRef.current = [pt];
      strokeSamplesRef.current = [{ pressure, velocity: 0, strokeProgress: 0 }];
    }

    const preview = cel.image.clone();
    workingPreviewRef.current = preview;

    if (
      activeToolId === "tool.pencil" ||
      activeToolId === "tool.eraser" ||
      activeToolId === "tool.shading"
    ) {
      paintStrokeOnImage(
        preview,
        strokePointsRef.current,
        buildStrokeOptions(e.button, strokeSamplesRef.current)
      );
      updateExtraCelFromWorking(preview);
    } else if (activeToolId === "tool.spray") {
      sprayTickRef.current += 1;
      paintSprayOnImage(preview, pt, {
        ...buildStrokeOptions(e.button),
        sprayWidth: toolOptions.sprayWidth,
        spraySpeed: toolOptions.spraySpeed,
        seed: Date.now() + sprayTickRef.current,
      });
      updateExtraCelFromWorking(preview);
    } else if (activeToolId === "tool.blur") {
      const palette = getPaletteForFrame(sprite, activeFrameIndex);
      applyBlurDab(
        preview,
        pt,
        Math.max(1, Math.ceil(toolOptions.brushSize / 2)),
        palette,
        sprite.transparentIndex,
        sprite.mask
      );
      updateExtraCelFromWorking(preview);
    } else if (activeToolId === "tool.jumble") {
      sprayTickRef.current += 1;
      applyJumbleDab(
        preview,
        pt,
        Math.max(1, Math.ceil(toolOptions.brushSize / 2)),
        Date.now() + sprayTickRef.current,
        sprite.mask
      );
      updateExtraCelFromWorking(preview);
    } else if (activeToolId === "tool.line") {
      paintStrokeOnImage(preview, [pt], {
        ...buildStrokeOptions(e.button),
        pixelPerfect: false,
        stabilizerFactor: 0,
      });
      updateExtraCelFromWorking(preview);
    } else if (activeToolId === "tool.rectangle") {
      const pts = rasterizeRectangle(pt, pt, { filled: toolOptions.shapeFilled });
      paintStrokeOnImage(preview, pts, {
        ...buildStrokeOptions(e.button),
        brush: toolOptions.shapeFilled
          ? { ...activeBrushConfig, size: 1, type: "square" }
          : activeBrushConfig,
        connectPoints: false,
        pixelPerfect: false,
        stabilizerFactor: 0,
      });
      updateExtraCelFromWorking(preview);
    } else if (activeToolId === "tool.ellipse") {
      const pts = rasterizeEllipse(pt, pt, { filled: toolOptions.shapeFilled });
      paintStrokeOnImage(preview, pts, {
        ...buildStrokeOptions(e.button),
        brush: toolOptions.shapeFilled
          ? { ...activeBrushConfig, size: 1, type: "square" }
          : activeBrushConfig,
        connectPoints: false,
        pixelPerfect: false,
        stabilizerFactor: 0,
      });
      updateExtraCelFromWorking(preview);
    } else if (activeToolId === "tool.gradient") {
      setGradVector({ start: pt, end: pt });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = clientToSpriteCoords(e.clientX, e.clientY, false);
    const displayPt = clientToSpriteCoords(e.clientX, e.clientY, true);
    if (
      displayPt.x >= 0 &&
      displayPt.y >= 0 &&
      displayPt.x < sprite.width &&
      displayPt.y < sprite.height
    ) {
      setCursorPos(displayPt);
    } else {
      setCursorPos(null);
    }

    // Dragging symmetry guide handle
    if (draggingSymmetryRef.current) {
      if (draggingSymmetryRef.current === "x") {
        setToolOption("symmetryX", Math.max(1, Math.min(sprite.width - 1, pt.x)));
      } else {
        setToolOption("symmetryY", Math.max(1, Math.min(sprite.height - 1, pt.y)));
      }
      return;
    }

    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy);
      return;
    }

    // Live polygonal lasso rubber-band preview
    if (activeToolId === "tool.polygonal_lasso" && lassoPolygonVerts.length > 0) {
      setSelectionDraftMask(
        createPolygonLassoMask(sprite.width, sprite.height, [...lassoPolygonVerts, pt])
      );
      return;
    }

    // Live polygon rubber-band preview before mouse click
    if (activeToolId === "tool.polygon" && polygonVertices.length > 0) {
      const cel = getCel(sprite, activeLayerId, activeFrameIndex);
      if (cel) {
        const preview = cel.image.clone();
        const pts = rasterizePolygon([...polygonVertices, pt], toolOptions.shapeFilled);
        paintStrokeOnImage(preview, pts, {
          ...buildStrokeOptions(0),
          pixelPerfect: false,
          stabilizerFactor: 0,
        });
        updateExtraCelFromWorking(preview);
      }
      return;
    }

    if (!isDrawingRef.current) return;

    // Quick Mask Translation Drag (Ctrl+Shift+Drag or Move Mask mode)
    if (maskDragOriginRef.current) {
      const dx = pt.x - maskDragOriginRef.current.startPt.x;
      const dy = pt.y - maskDragOriginRef.current.startPt.y;
      setSelectionDraftMask(translateMask(maskDragOriginRef.current.origMask, dx, dy));
      return;
    }

    // Floating Transform Handle / Move Drag
    if (transformDragRef.current && floatingSelection) {
      const drag = transformDragRef.current;
      const dx = pt.x - drag.startPt.x;
      const dy = pt.y - drag.startPt.y;

      if (drag.handle === "move") {
        updateFloatingSelection({
          x: drag.origX + dx,
          y: drag.origY + dy,
        });
      } else if (drag.handle === "rotate") {
        const cx = drag.origX + drag.origW * floatingSelection.pivotRelX;
        const cy = drag.origY + drag.origH * floatingSelection.pivotRelY;
        const a0 = Math.atan2(drag.startPt.y - cy, drag.startPt.x - cx);
        const a1 = Math.atan2(pt.y - cy, pt.x - cx);
        let deg = drag.origAngle + ((a1 - a0) * 180) / Math.PI;
        if (e.shiftKey) {
          deg = Math.round(deg / 15) * 15;
        } else {
          deg = Math.round(deg);
        }
        updateFloatingSelection({ angleDeg: deg });
      } else if (drag.handle === "skew_x") {
        updateFloatingSelection({
          skewXDeg: Math.max(-70, Math.min(70, Math.round(drag.origSkewX + dx * 2))),
        });
      } else if (drag.handle === "skew_y") {
        updateFloatingSelection({
          skewYDeg: Math.max(-70, Math.min(70, Math.round(drag.origSkewY + dy * 2))),
        });
      } else if (drag.handle === "pivot") {
        const relX = Math.max(
          0,
          Math.min(1, (pt.x - floatingSelection.x) / Math.max(1, floatingSelection.width))
        );
        const relY = Math.max(
          0,
          Math.min(1, (pt.y - floatingSelection.y) / Math.max(1, floatingSelection.height))
        );
        updateFloatingSelection({
          pivotRelX: Number(relX.toFixed(2)),
          pivotRelY: Number(relY.toFixed(2)),
        });
      } else {
        // 8-handle scale (nw, n, ne, e, se, s, sw, w) projected into local rotated frame (B01)
        const rad = (-floatingSelection.angleDeg * Math.PI) / 180;
        const cosA = Math.cos(rad);
        const sinA = Math.sin(rad);
        const ldx = Math.round(dx * cosA - dy * sinA);
        const ldy = Math.round(dx * sinA + dy * cosA);

        let nx = drag.origX;
        let ny = drag.origY;
        let nw = drag.origW;
        let nh = drag.origH;

        if (drag.handle.includes("e")) nw = Math.max(1, drag.origW + ldx);
        if (drag.handle.includes("s")) nh = Math.max(1, drag.origH + ldy);
        if (drag.handle.includes("w")) {
          const clampedDx = Math.min(ldx, drag.origW - 1);
          nx = drag.origX + clampedDx;
          nw = Math.max(1, drag.origW - clampedDx);
        }
        if (drag.handle.includes("n")) {
          const clampedDy = Math.min(ldy, drag.origH - 1);
          ny = drag.origY + clampedDy;
          nh = Math.max(1, drag.origH - clampedDy);
        }

        if (e.shiftKey && drag.origW > 0 && drag.origH > 0) {
          const aspect = drag.origH / drag.origW;
          nh = Math.max(1, Math.round(nw * aspect));
        }

        updateFloatingSelection({ x: nx, y: ny, width: nw, height: nh });
      }
      return;
    }

    // Interactive Selection Drag (Marquee Rect, Marquee Ellipse, Freehand Lasso)
    if (activeToolId === "tool.marquee_rect") {
      setSelectionDraftMask(
        createRectMarqueeMask(sprite.width, sprite.height, dragStartPtRef.current, pt, {
          constraint: toolOptions.marqueeConstraint,
          ratioW: toolOptions.marqueeRatioW,
          ratioH: toolOptions.marqueeRatioH,
          fixedW: toolOptions.marqueeFixedW,
          fixedH: toolOptions.marqueeFixedH,
          fromCenter: e.ctrlKey,
        })
      );
      return;
    }

    if (activeToolId === "tool.marquee_ellipse") {
      setSelectionDraftMask(
        createEllipseMarqueeMask(sprite.width, sprite.height, dragStartPtRef.current, pt, {
          constraint: toolOptions.marqueeConstraint,
          ratioW: toolOptions.marqueeRatioW,
          ratioH: toolOptions.marqueeRatioH,
          fixedW: toolOptions.marqueeFixedW,
          fixedH: toolOptions.marqueeFixedH,
          fromCenter: e.ctrlKey,
        })
      );
      return;
    }

    if (activeToolId === "tool.lasso") {
      strokePointsRef.current.push(pt);
      setSelectionDraftMask(
        createPolygonLassoMask(sprite.width, sprite.height, strokePointsRef.current)
      );
      return;
    }

    // Interactive Slice Tool Drag Move / Create
    if (activeToolId === "tool.slice" && sliceDragModeRef.current) {
      const drag = sliceDragModeRef.current;
      if (drag.mode === "create") {
        const minX = Math.min(drag.startPt.x, pt.x);
        const minY = Math.min(drag.startPt.y, pt.y);
        const w = Math.max(1, Math.abs(pt.x - drag.startPt.x) + 1);
        const h = Math.max(1, Math.abs(pt.y - drag.startPt.y) + 1);
        setSliceDraftBounds({ x: minX, y: minY, width: w, height: h });
      } else if (drag.mode === "move" && drag.sliceId && drag.origBounds) {
        const dx = pt.x - drag.startPt.x;
        const dy = pt.y - drag.startPt.y;
        setSliceDraftBounds({
          x: Math.max(0, drag.origBounds.x + dx),
          y: Math.max(0, drag.origBounds.y + dy),
          width: drag.origBounds.width,
          height: drag.origBounds.height,
        });
      }
      return;
    }

    const cel = getCel(sprite, activeLayerId, activeFrameIndex);
    if (!cel) return;
    const activeLayer = sprite.layers.find((l) => l.id === activeLayerId);
    const activeTileset =
      activeLayer && activeLayer.kind === "tilemap"
        ? sprite.tilesets.find((ts) => ts.id === (activeLayer as TilemapLayer).tilesetId) ??
          sprite.tilesets[0]
        : null;

    // Tilemap Tiles Mode Drag (Pencil, Eraser, Line, Rectangle)
    if (
      activeLayer &&
      activeLayer.kind === "tilemap" &&
      cel.tilemapData &&
      activeTileset &&
      tilemapEditMode === "tiles" &&
      workingTilemapRef.current
    ) {
      const packedTile =
        activeButtonRef.current === 2 || activeToolId === "tool.eraser"
          ? 0
          : packTileEntry(
              activeTileIndex + activeTileset.baseIndex,
              tileFlipX,
              tileFlipY,
              tileRot90
            );
      const startTile = pixelToTileCoord(
        dragStartPtRef.current.x,
        dragStartPtRef.current.y,
        activeTileset
      );
      const currTile = pixelToTileCoord(pt.x, pt.y, activeTileset);

      if (activeToolId === "tool.rectangle") {
        const nextTiles = new Uint32Array(cel.tilemapData.tiles);
        rasterizeTileRectangle(
          { width: cel.tilemapData.width, height: cel.tilemapData.height, tiles: nextTiles },
          startTile.x,
          startTile.y,
          currTile.x,
          currTile.y,
          packedTile,
          toolOptions.shapeFilled
        );
        workingTilemapRef.current = nextTiles;
      } else if (activeToolId === "tool.line") {
        const nextTiles = new Uint32Array(cel.tilemapData.tiles);
        rasterizeTileLine(
          { width: cel.tilemapData.width, height: cel.tilemapData.height, tiles: nextTiles },
          startTile.x,
          startTile.y,
          currTile.x,
          currTile.y,
          packedTile
        );
        workingTilemapRef.current = nextTiles;
      } else {
        paintTileCells(
          {
            width: cel.tilemapData.width,
            height: cel.tilemapData.height,
            tiles: workingTilemapRef.current,
          },
          [currTile],
          packedTile
        );
      }

      const tempCel = {
        ...cel,
        tilemapData: {
          width: cel.tilemapData.width,
          height: cel.tilemapData.height,
          tiles: workingTilemapRef.current,
        },
      };
      const pal = getPaletteForFrame(sprite, activeFrameIndex);
      const rendered = renderTilemapCel(
        tempCel,
        activeLayer as TilemapLayer,
        sprite.tilesets,
        sprite.width,
        sprite.height,
        pal,
        sprite.transparentIndex
      );
      workingPreviewRef.current = rendered;
      updateExtraCelFromWorking(rendered);
      return;
    }

    const now = Date.now();
    const dt = Math.max(1, now - lastMoveTimeRef.current);
    lastMoveTimeRef.current = now;

    // Curve tool drag
    if (activeToolId === "tool.curve" && curveState) {
      let nextCurve = curveState;
      if (curveState.stage === "dragging_line") {
        const p0 = curveState.p0;
        const p3 = pt;
        const p1 = {
          x: Math.round(p0.x + (p3.x - p0.x) * 0.33),
          y: Math.round(p0.y + (p3.y - p0.y) * 0.33),
        };
        const p2 = {
          x: Math.round(p0.x + (p3.x - p0.x) * 0.66),
          y: Math.round(p0.y + (p3.y - p0.y) * 0.66),
        };
        nextCurve = { ...curveState, p1, p2, p3 };
      } else if (curveState.draggingHandle) {
        nextCurve = {
          ...curveState,
          [curveState.draggingHandle]: pt,
        };
      }
      setCurveState(nextCurve);
      const preview = cel.image.clone();
      const curvePts = rasterizeBezierCurve(
        nextCurve.p0,
        nextCurve.p1,
        nextCurve.p2,
        nextCurve.p3
      );
      paintStrokeOnImage(preview, curvePts, {
        ...buildStrokeOptions(nextCurve.button),
        pixelPerfect: false,
        stabilizerFactor: 0,
      });
      updateExtraCelFromWorking(preview);
      return;
    }

    // Freehand Pencil / Eraser / Shading / Contour
    if (
      activeToolId === "tool.pencil" ||
      activeToolId === "tool.eraser" ||
      activeToolId === "tool.shading" ||
      activeToolId === "tool.contour"
    ) {
      let targetPt = pt;
      if (e.ctrlKey && strokePointsRef.current.length > 0) {
        const start = strokePointsRef.current[0];
        if (Math.abs(pt.x - start.x) >= Math.abs(pt.y - start.y)) {
          targetPt = { x: pt.x, y: start.y };
        } else {
          targetPt = { x: start.x, y: pt.y };
        }
      }

      const prevPt =
        strokePointsRef.current[strokePointsRef.current.length - 1] ?? targetPt;
      if (prevPt.x === targetPt.x && prevPt.y === targetPt.y) return;

      const dist = Math.hypot(targetPt.x - prevPt.x, targetPt.y - prevPt.y);
      const velocity = dist / dt;
      const pressure = e.pressure > 0 ? e.pressure : 1;

      strokePointsRef.current.push(targetPt);
      strokeSamplesRef.current.push({
        pressure,
        velocity,
        strokeProgress: Math.min(1, strokePointsRef.current.length / 32),
      });

      const preview = cel.image.clone();
      if (activeToolId === "tool.contour") {
        const polyPts = rasterizePolygon(strokePointsRef.current, true);
        paintStrokeOnImage(preview, polyPts, {
          ...buildStrokeOptions(activeButtonRef.current),
          brush: { ...activeBrushConfig, size: 1, type: "square" },
          pixelPerfect: false,
          stabilizerFactor: 0,
        });
      } else {
        paintStrokeOnImage(
          preview,
          strokePointsRef.current,
          buildStrokeOptions(activeButtonRef.current, strokeSamplesRef.current)
        );
      }
      workingPreviewRef.current = preview;
      updateExtraCelFromWorking(preview);
      return;
    }

    // Continuous Spray / Blur / Jumble on workingPreviewRef
    if (
      activeToolId === "tool.spray" ||
      activeToolId === "tool.blur" ||
      activeToolId === "tool.jumble"
    ) {
      const preview = workingPreviewRef.current ?? cel.image.clone();
      workingPreviewRef.current = preview;
      sprayTickRef.current += 1;

      if (activeToolId === "tool.spray") {
        paintSprayOnImage(preview, pt, {
          ...buildStrokeOptions(activeButtonRef.current),
          sprayWidth: toolOptions.sprayWidth,
          spraySpeed: toolOptions.spraySpeed,
          seed: Date.now() + sprayTickRef.current,
        });
      } else if (activeToolId === "tool.blur") {
        const palette = getPaletteForFrame(sprite, activeFrameIndex);
        applyBlurDab(
          preview,
          pt,
          Math.max(1, Math.ceil(toolOptions.brushSize / 2)),
          palette,
          sprite.transparentIndex,
          sprite.mask
        );
      } else {
        applyJumbleDab(
          preview,
          pt,
          Math.max(1, Math.ceil(toolOptions.brushSize / 2)),
          Date.now() + sprayTickRef.current,
          sprite.mask
        );
      }
      updateExtraCelFromWorking(new PixelImage(preview.width, preview.height, preview.colorMode, new Uint8Array(preview.data)));
      return;
    }

    // Line Tool
    if (activeToolId === "tool.line") {
      const preview = cel.image.clone();
      const pts = rasterizeLine(dragStartPtRef.current, pt, {
        snapAngle: e.shiftKey,
        lockAxis: e.ctrlKey,
      });
      paintStrokeOnImage(preview, pts, {
        ...buildStrokeOptions(activeButtonRef.current),
        pixelPerfect: false,
        stabilizerFactor: 0,
      });
      workingPreviewRef.current = preview;
      updateExtraCelFromWorking(preview);
      return;
    }

    // Rectangle Tool
    if (activeToolId === "tool.rectangle") {
      const preview = cel.image.clone();
      const pts = rasterizeRectangle(dragStartPtRef.current, pt, {
        filled: toolOptions.shapeFilled,
        proportional: e.shiftKey,
        fromCenter: e.ctrlKey,
      });
      paintStrokeOnImage(preview, pts, {
        ...buildStrokeOptions(activeButtonRef.current),
        brush: toolOptions.shapeFilled
          ? { ...activeBrushConfig, size: 1, type: "square" }
          : activeBrushConfig,
        connectPoints: !toolOptions.shapeFilled,
        pixelPerfect: false,
        stabilizerFactor: 0,
      });
      workingPreviewRef.current = preview;
      updateExtraCelFromWorking(preview);
      return;
    }

    // Ellipse Tool (B18: connectPoints = false so opposite quadrant perimeter points are never connected across interior)
    if (activeToolId === "tool.ellipse") {
      const preview = cel.image.clone();
      const pts = rasterizeEllipse(dragStartPtRef.current, pt, {
        filled: toolOptions.shapeFilled,
        proportional: e.shiftKey,
        fromCenter: e.ctrlKey,
      });
      paintStrokeOnImage(preview, pts, {
        ...buildStrokeOptions(activeButtonRef.current),
        brush: toolOptions.shapeFilled
          ? { ...activeBrushConfig, size: 1, type: "square" }
          : activeBrushConfig,
        connectPoints: false,
        pixelPerfect: false,
        stabilizerFactor: 0,
      });
      workingPreviewRef.current = preview;
      updateExtraCelFromWorking(preview);
      return;
    }

    // Gradient Tool (B02: Shift snaps gradient angle; Contiguous checkbox controls flood-clipping)
    if (activeToolId === "tool.gradient") {
      const targetEnd = e.shiftKey
        ? constrainLineEndpoint(dragStartPtRef.current, pt, "angle_snap")
        : pt;
      setGradVector({ start: dragStartPtRef.current, end: targetEnd });
      const preview = cel.image.clone();
      const palette = getPaletteForFrame(sprite, activeFrameIndex);
      renderGradientImage(preview, {
        start: dragStartPtRef.current,
        end: targetEnd,
        fgColor: activeButtonRef.current === 2 ? bgColor : fgColor,
        bgColor: activeButtonRef.current === 2 ? fgColor : bgColor,
        gradientType: toolOptions.gradientType,
        ditherMode: toolOptions.gradientDitherMode,
        customDitherMatrix: toolOptions.customDitherMatrix,
        contiguous: toolOptions.contiguous,
        tolerance: toolOptions.tolerance,
        inkMode: toolOptions.inkMode,
        opacity: toolOptions.opacity,
        palette,
        transparentIndex: sprite.transparentIndex,
        mask: sprite.mask,
      });
      workingPreviewRef.current = preview;
      updateExtraCelFromWorking(preview);
    }
  };

  const handlePointerUp = () => {
    draggingSymmetryRef.current = null;
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    // Curve transitions from Stage 1 (dragging line) to Stage 2 (adjusting handles)
    if (activeToolId === "tool.curve" && curveState) {
      if (curveState.stage === "dragging_line") {
        setCurveState({
          ...curveState,
          stage: "adjusting_handles",
          draggingHandle: null,
        });
      } else {
        setCurveState({
          ...curveState,
          draggingHandle: null,
        });
      }
      return;
    }

    // Commit Quick Mask Translation Drag
    if (maskDragOriginRef.current) {
      maskDragOriginRef.current = null;
      if (selectionDraftMask) {
        doc.transact("Move Selection Mask", (tx) =>
          tx.setMask(selectionDraftMask, "Move Selection Mask")
        );
        setSelectionDraftMask(null);
        bumpRevision();
      }
      return;
    }

    // End Floating Transform Handle Drag (stays floating until Enter or tool switch!)
    if (transformDragRef.current) {
      transformDragRef.current = null;
      return;
    }

    // Commit Selection Tool Drag (Marquee Rect, Marquee Ellipse, Freehand Lasso)
    if (
      activeToolId === "tool.marquee_rect" ||
      activeToolId === "tool.marquee_ellipse" ||
      activeToolId === "tool.lasso"
    ) {
      if (selectionDraftMask) {
        const nextMask = combineMasks(
          sprite.mask,
          selectionDraftMask,
          selectionCombineRef.current
        );
        const label =
          activeToolId === "tool.marquee_rect"
            ? "Rectangular Marquee"
            : activeToolId === "tool.marquee_ellipse"
            ? "Elliptical Marquee"
            : "Lasso Selection";
        doc.transact(label, (tx) => tx.setMask(nextMask, label));
        setSelectionDraftMask(null);
        strokePointsRef.current = [];
        bumpRevision();
      }
      return;
    }

    // Commit interactive Slice Tool create / move
    if (activeToolId === "tool.slice" && sliceDragModeRef.current) {
      const drag = sliceDragModeRef.current;
      const bounds = sliceDraftBounds;
      if (bounds) {
        if (drag.mode === "create" && (bounds.width > 1 || bounds.height > 1)) {
          const newSlice = {
            id: createModelId("slice"),
            name: `slice_${sprite.slices.length + 1}`,
            color: "#f59e0b",
            keys: [
              {
                frameIndex: activeFrameIndex,
                bounds,
                center:
                  bounds.width >= 6 && bounds.height >= 6
                    ? {
                        x: 2,
                        y: 2,
                        width: bounds.width - 4,
                        height: bounds.height - 4,
                      }
                    : undefined,
                pivot: {
                  x: Math.floor(bounds.width / 2),
                  y: Math.floor(bounds.height / 2),
                },
              },
            ],
            userData: { text: "" },
          };
          doc.execute(new AddSliceCommand(newSlice));
          setActiveSliceId(newSlice.id);
          bumpRevision();
        } else if (drag.mode === "move" && drag.sliceId) {
          const existing = sprite.slices.find((s) => s.id === drag.sliceId);
          if (existing) {
            const copy = {
              ...existing,
              keys: existing.keys.map((k) => ({ ...k, bounds: { ...k.bounds } })),
            };
            upsertSliceKey(copy, activeFrameIndex, { bounds });
            doc.execute(
              new UpdateSliceCommand(existing.id, { keys: copy.keys }, "Move Slice")
            );
            bumpRevision();
          }
        }
      }
      sliceDragModeRef.current = null;
      setSliceDraftBounds(null);
      return;
    }

    const lastPt =
      strokePointsRef.current[strokePointsRef.current.length - 1] ?? dragStartPtRef.current;
    setLastStrokePoint(lastPt);

    const activeLayer = sprite.layers.find((l) => l.id === activeLayerId);
    const activeCel = getCel(sprite, activeLayerId, activeFrameIndex);
    const activeTileset =
      activeLayer && activeLayer.kind === "tilemap"
        ? sprite.tilesets.find((ts) => ts.id === (activeLayer as TilemapLayer).tilesetId) ??
          sprite.tilesets[0]
        : null;

    // Commit Tilemap Layer edits (either Tiles Mode or Pixels Mode Auto/Stack/Manual)
    if (
      activeLayer &&
      activeLayer.kind === "tilemap" &&
      activeCel?.tilemapData &&
      activeTileset
    ) {
      if (tilemapEditMode === "tiles" && workingTilemapRef.current) {
        doc.execute(
          new TilemapEditCommand({
            label: "Tile Brush Stroke",
            layerId: activeLayerId,
            frameIndex: activeFrameIndex,
            tilesetId: activeTileset.id,
            beforeTiles: activeCel.tilemapData.tiles,
            afterTiles: workingTilemapRef.current,
          })
        );
        workingTilemapRef.current = null;
        workingPreviewRef.current = null;
        setExtraCel(null);
        bumpRevision();
        return;
      }

      if (tilemapEditMode === "pixels" && workingPreviewRef.current) {
        const beforeTiles = new Uint32Array(activeCel.tilemapData.tiles);
        const beforeTileset = {
          ...activeTileset,
          tiles: activeTileset.tiles.map((img) => img.clone()),
          userData: { ...activeTileset.userData },
        };
        const tempCel = {
          ...activeCel,
          tilemapData: {
            width: activeCel.tilemapData.width,
            height: activeCel.tilemapData.height,
            tiles: new Uint32Array(activeCel.tilemapData.tiles),
          },
        };
        const tempTileset = {
          ...activeTileset,
          tiles: activeTileset.tiles.map((img) => img.clone()),
          userData: { ...activeTileset.userData },
        };
        syncTilemapFromEditedPixels(
          tempCel,
          tempTileset,
          workingPreviewRef.current,
          tilesetModMode,
          sprite.transparentIndex
        );
        doc.execute(
          new TilemapEditCommand({
            label: `Tilemap Pixels (${tilesetModMode.toUpperCase()})`,
            layerId: activeLayerId,
            frameIndex: activeFrameIndex,
            tilesetId: activeTileset.id,
            beforeTiles,
            afterTiles: tempCel.tilemapData.tiles,
            beforeTileset,
            afterTileset: tempTileset,
          })
        );
        workingPreviewRef.current = null;
        setExtraCel(null);
        bumpRevision();
        return;
      }
    }

    // Commit the working preview into a single compact CelImagePatchCommand
    const previewImg = workingPreviewRef.current;
    if (previewImg) {
      const labelMap: Record<string, string> = {
        "tool.pencil": "Pencil Stroke",
        "tool.eraser": "Eraser Stroke",
        "tool.spray": "Spray Stroke",
        "tool.shading": "Shading Stroke",
        "tool.line": "Line Tool",
        "tool.rectangle": "Rectangle Tool",
        "tool.ellipse": "Ellipse Tool",
        "tool.contour": "Contour Tool",
        "tool.gradient": "Gradient Fill",
        "tool.blur": "Blur Stroke",
        "tool.jumble": "Jumble Stroke",
      };
      const label = labelMap[activeToolId] ?? "Tool Edit";

      commitToolEditTransaction(doc, activeLayerId, activeFrameIndex, label, (working) => {
        working.data.set(previewImg.data);
        return { x: 0, y: 0, width: working.width, height: working.height };
      });
      bumpRevision();
    }

    workingTilemapRef.current = null;
    workingPreviewRef.current = null;
    strokePointsRef.current = [];
    strokeSamplesRef.current = [];
    setGradVector(null);
    setExtraCel(null);
  };

  const handleDoubleClick = () => {
    if (activeToolId === "tool.polygonal_lasso" && lassoPolygonVerts.length >= 2) {
      commitPolygonalLasso(lassoPolygonVerts);
    } else if (activeToolId === "tool.polygon" && polygonVertices.length >= 2) {
      commitActivePolygon(polygonVertices);
    } else if (activeToolId === "tool.curve" && curveState) {
      commitActiveCurve();
    } else if (floatingSelection) {
      commitFloatingSelection();
      setExtraCel(null);
    } else if (showGrid) {
      openDialog("dialog.grid_settings");
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const viewport = viewportRef.current;
    const oldZoom = zoom;
    const nextZoom = e.deltaY < 0 ? getNextZoomStep(oldZoom) : getPrevZoomStep(oldZoom);
    if (viewport) {
      const rect = viewport.getBoundingClientRect();
      const cursorOffsetX = e.clientX - (rect.left + rect.width / 2);
      const cursorOffsetY = e.clientY - (rect.top + rect.height / 2);
      const nextPan = computeZoomToCursorPan(
        panX,
        panY,
        oldZoom,
        nextZoom,
        cursorOffsetX,
        cursorOffsetY
      );
      setPan(nextPan.panX, nextPan.panY);
    }
    setZoom(nextZoom);
  };

  // Compute active cel content bounds when `Show Layer Edges` is enabled
  const layerEdgeBounds = useMemo(() => {
    if (!showLayerEdges || !showExtras) return null;
    return computeCelContentBounds(sprite, activeLayerId, activeFrameIndex);
  }, [showLayerEdges, showExtras, sprite, activeLayerId, activeFrameIndex, rev]);

  // Compute exact brush footprint points for live cursor outline
  const cursorFootprint = useMemo(
    () => generateBrushFootprint(activeBrushConfig),
    [activeBrushConfig]
  );

  const scaleX = sprite.pixelRatio.w * scale;
  const scaleY = sprite.pixelRatio.h * scale;

  // Tiled mode tile offsets
  const tileOffsets: Array<{ tx: number; ty: number }> = useMemo(() => {
    const list: Array<{ tx: number; ty: number }> = [];
    const rx = tiledMode === "x" || tiledMode === "both" ? [-1, 0, 1] : [0];
    const ry = tiledMode === "y" || tiledMode === "both" ? [-1, 0, 1] : [0];
    for (const ty of ry) {
      for (const tx of rx) {
        if (tx === 0 && ty === 0) continue;
        list.push({ tx, ty });
      }
    }
    return list;
  }, [tiledMode]);

  const handleDropFile = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file || !doc) return;
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => {
        const imgEl = new Image();
        imgEl.onload = () => {
          const tempCanvas = document.createElement("canvas");
          tempCanvas.width = Math.min(sprite.width, imgEl.width);
          tempCanvas.height = Math.min(sprite.height, imgEl.height);
          const ctx = tempCanvas.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(imgEl, 0, 0);
          const idata = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
          const pxImg = new PixelImage(
            tempCanvas.width,
            tempCanvas.height,
            "rgba",
            new Uint8Array(idata.data.buffer)
          );
          let newLid = "";
          doc.transact(`Import Image "${file.name}"`, (tx) => {
            newLid = tx.addImageLayer(file.name).id;
          });
          const newCel = getCel(doc.sprite, newLid, activeFrameIndex);
          if (newCel) {
            const pal = getPaletteForFrame(doc.sprite, activeFrameIndex);
            newCel.image.blit(pxImg, 0, 0, "normal", 255, pal, doc.sprite.transparentIndex);
          }
          bumpRevision();
        };
        imgEl.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div
      ref={viewportRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDropFile}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={handleWheel}
      className="relative flex-1 h-full w-full bg-[var(--kpx-canvas-surround)] kpx-bevel-inset overflow-hidden flex items-center justify-center select-none cursor-crosshair"
    >
      {/* Interactive Floating HUD for Floating Selection Transform / Polygonal Lasso / Curve / Polygon / Text */}
      {(floatingSelection ||
        lassoPolygonVerts.length > 0 ||
        curveState ||
        polygonVertices.length > 0 ||
        textPos) && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-2 left-1/2 -translate-x-1/2 z-30 kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] px-3 py-1.5 shadow-xl flex items-center gap-2 text-xs font-mono"
        >
          {floatingSelection && (
            <>
              <span className="font-bold text-amber-300">
                Transform ({Math.round(floatingSelection.x)},{Math.round(floatingSelection.y)}{" "}
                {Math.round(floatingSelection.width)}x{Math.round(floatingSelection.height)})
              </span>
              <span>Angle:</span>
              <NumberField
                ariaLabel="Floating Rotation Angle"
                value={floatingSelection.angleDeg}
                min={-360}
                max={360}
                suffix="°"
                widthClass="w-14"
                onChange={(v) => updateFloatingSelection({ angleDeg: v })}
              />
              <PixelSelect
                ariaLabel="Floating Transform Interpolation"
                value={floatingSelection.algorithm}
                onChange={(v) =>
                  updateFloatingSelection({
                    algorithm: v as "fast" | "rotsprite" | "bilinear",
                  })
                }
                options={[
                  { value: "rotsprite", label: "RotSprite" },
                  { value: "fast", label: "Fast NN" },
                  { value: "bilinear", label: "Bilinear" },
                ]}
              />
              <PixelButton
                size="xs"
                title="Flip Floating Selection Horizontal"
                onClick={() => runCommandById("edit.flip_h")}
              >
                Flip H
              </PixelButton>
              <PixelButton
                size="xs"
                title="Flip Floating Selection Vertical"
                onClick={() => runCommandById("edit.flip_v")}
              >
                Flip V
              </PixelButton>
              <PixelButton
                size="xs"
                title="Rotate Floating Selection 90° CW"
                onClick={() => {
                  const rot = rotateImageOrthogonal(floatingSelection.sourceImage, "90cw");
                  setFloatingSelection({
                    ...floatingSelection,
                    sourceImage: rot,
                    width: floatingSelection.height,
                    height: floatingSelection.width,
                  });
                }}
              >
                90° CW
              </PixelButton>
              <PixelButton
                size="xs"
                title="Create Custom Brush from Floating Selection"
                onClick={() => pasteAsNewBrush()}
              >
                +Brush
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => {
                  commitFloatingSelection();
                  setExtraCel(null);
                }}
              >
                Commit (Enter)
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => {
                  cancelFloatingSelection();
                  setExtraCel(null);
                }}
              >
                Cancel (Esc)
              </PixelButton>
            </>
          )}

          {lassoPolygonVerts.length > 0 && (
            <>
              <span className="font-bold">
                Polygonal Lasso ({lassoPolygonVerts.length} pts): Click to add vertices
              </span>
              <PixelButton
                size="xs"
                onClick={() => commitPolygonalLasso(lassoPolygonVerts)}
              >
                Select (Enter)
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => {
                  setLassoPolygonVerts([]);
                  setSelectionDraftMask(null);
                }}
              >
                Cancel (Esc)
              </PixelButton>
            </>
          )}

          {curveState && (
            <>
              <span className="font-bold">
                Bezier Curve: Drag blue handles P1/P2 to bend curve
              </span>
              <PixelButton size="xs" onClick={commitActiveCurve}>
                Commit Curve (Enter)
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => {
                  setCurveState(null);
                  setExtraCel(null);
                }}
              >
                Cancel (Esc)
              </PixelButton>
            </>
          )}

          {polygonVertices.length > 0 && (
            <>
              <span className="font-bold">
                Polygon ({polygonVertices.length} pts): Click to add points
              </span>
              <PixelButton
                size="xs"
                onClick={() => commitActivePolygon(polygonVertices)}
              >
                Close &amp; Fill (Enter)
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => {
                  setPolygonVertices([]);
                  setExtraCel(null);
                }}
              >
                Cancel (Esc)
              </PixelButton>
            </>
          )}

          {textPos && (
            <>
              <span className="font-bold">Text:</span>
              <TextField
                ariaLabel="Canvas Text Input"
                value={toolOptions.textContent}
                onChange={(val) => {
                  setToolOption("textContent", val);
                  const cel = getCel(sprite, activeLayerId, activeFrameIndex);
                  if (cel) {
                    const preview = cel.image.clone();
                    const palette = getPaletteForFrame(sprite, activeFrameIndex);
                    stampTextOnImage(
                      preview,
                      val,
                      textPos.x,
                      textPos.y,
                      fgColor,
                      toolOptions.textFontSize,
                      toolOptions.textAntiAlias,
                      palette,
                      sprite.transparentIndex
                    );
                    updateExtraCelFromWorking(preview);
                  }
                }}
                className="px-1.5 py-0.5 text-xs w-32"
              />
              <PixelButton size="xs" onClick={commitActiveText}>
                Commit Text (Enter)
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => {
                  setTextPos(null);
                  setExtraCel(null);
                }}
              >
                Cancel (Esc)
              </PixelButton>
            </>
          )}
        </div>
      )}

      {/* Positioned Canvas Container */}
      <div
        style={{
          width: displayW,
          height: displayH,
          transform: `translate(${panX}px, ${panY}px)`,
        }}
        className="relative border border-black shadow-lg"
      >
        {/* Tiled Mode Ghost Repetitions (3x3 / 3x1 / 1x3) */}
        {tileOffsets.map(({ tx, ty }) => (
          <TiledCloneCanvas
            key={`${tx}_${ty}`}
            sourceCanvasRef={canvasRef}
            tx={tx}
            ty={ty}
            displayW={displayW}
            displayH={displayH}
            rev={rev}
            renderTick={renderTick}
            extraCel={extraCel}
          />
        ))}

        {/* Primary Sprite Canvas */}
        <canvas
          ref={canvasRef}
          data-testid="sprite-editor-canvas"
          style={{
            width: displayW,
            height: displayH,
            imageRendering: "pixelated",
          }}
          className="block"
        />

        {/* 1. Adaptive Pixel Grid Overlay (at >= 800% zoom when enabled) */}
        {showExtras && showPixelGrid && scale >= 8 && (
          <div
            data-testid="pixel-grid-overlay"
            style={{
              backgroundSize: `${scaleX}px ${scaleY}px`,
              backgroundImage:
                "linear-gradient(to right, rgba(255,255,255,0.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.22) 1px, transparent 1px)",
            }}
            className="absolute inset-0 pointer-events-none"
          />
        )}

        {/* 2. Configurable Tile Grid Overlay (B06: configurable gridThickness 1..8px) */}
        {showExtras && showGrid && scale >= 1 && (
          <div
            data-testid="tile-grid-overlay"
            data-grid-thickness={gridThickness}
            style={{
              backgroundPosition: `${sprite.grid.x * scaleX}px ${sprite.grid.y * scaleY}px`,
              backgroundSize: `${sprite.grid.width * scaleX}px ${sprite.grid.height * scaleY}px`,
              backgroundImage: `linear-gradient(to right, ${gridColor} ${gridThickness}px, transparent ${gridThickness}px), linear-gradient(to bottom, ${gridColor} ${gridThickness}px, transparent ${gridThickness}px)`,
              opacity: gridOpacity / 100,
            }}
            className="absolute inset-0 pointer-events-none"
          />
        )}

        {/* 3. Show Layer Edges Overlay */}
        {layerEdgeBounds && (
          <div
            data-testid="layer-edges-overlay"
            style={{
              left: layerEdgeBounds.x * scaleX,
              top: layerEdgeBounds.y * scaleY,
              width: layerEdgeBounds.width * scaleX,
              height: layerEdgeBounds.height * scaleY,
            }}
            className="absolute border border-cyan-300 ring-1 ring-black/60 pointer-events-none"
          />
        )}

        {/* 4. Symmetry Axis Guides + Draggable Handles (B05, B22: includes 8-way all axes) */}
        {showExtras && toolOptions.symmetryMode !== "none" && (
          <>
            {(toolOptions.symmetryMode === "horizontal" ||
              toolOptions.symmetryMode === "both" ||
              toolOptions.symmetryMode === "eight_way") && (
              <div
                data-testid="symmetry-axis-h"
                style={{ left: symX * scaleX }}
                className="absolute top-0 bottom-0 w-0.5 bg-amber-300 shadow pointer-events-none"
              >
                <div
                  title="Drag Horizontal Symmetry Axis"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    draggingSymmetryRef.current = "x";
                  }}
                  className="pointer-events-auto -ml-2 -mt-2 w-4 h-4 bg-amber-400 border border-black cursor-ew-resize flex items-center justify-center text-[8px] font-bold text-black"
                >
                  H
                </div>
              </div>
            )}

            {(toolOptions.symmetryMode === "vertical" ||
              toolOptions.symmetryMode === "both" ||
              toolOptions.symmetryMode === "eight_way") && (
              <div
                data-testid="symmetry-axis-v"
                style={{ top: symY * scaleY }}
                className="absolute left-0 right-0 h-0.5 bg-emerald-300 shadow pointer-events-none"
              >
                <div
                  title="Drag Vertical Symmetry Axis"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    draggingSymmetryRef.current = "y";
                  }}
                  className="pointer-events-auto -ml-2 -mt-2 w-4 h-4 bg-emerald-400 border border-black cursor-ns-resize flex items-center justify-center text-[8px] font-bold text-black"
                >
                  V
                </div>
              </div>
            )}

            {(toolOptions.symmetryMode === "diagonal_pos" ||
              toolOptions.symmetryMode === "diagonal_neg" ||
              toolOptions.symmetryMode === "eight_way") && (
              <svg
                data-testid="symmetry-axis-diagonals"
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox={`0 0 ${sprite.width} ${sprite.height}`}
                preserveAspectRatio="none"
              >
                {(toolOptions.symmetryMode === "diagonal_pos" ||
                  toolOptions.symmetryMode === "eight_way") && (
                  <line
                    data-testid="symmetry-axis-diag-pos"
                    x1={symX - Math.max(sprite.width, sprite.height)}
                    y1={symY - Math.max(sprite.width, sprite.height)}
                    x2={symX + Math.max(sprite.width, sprite.height)}
                    y2={symY + Math.max(sprite.width, sprite.height)}
                    stroke="#f472b6"
                    strokeWidth={0.35}
                    strokeDasharray="1,1"
                  />
                )}
                {(toolOptions.symmetryMode === "diagonal_neg" ||
                  toolOptions.symmetryMode === "eight_way") && (
                  <line
                    data-testid="symmetry-axis-diag-neg"
                    x1={symX - Math.max(sprite.width, sprite.height)}
                    y1={symY + Math.max(sprite.width, sprite.height)}
                    x2={symX + Math.max(sprite.width, sprite.height)}
                    y2={symY - Math.max(sprite.width, sprite.height)}
                    stroke="#c084fc"
                    strokeWidth={0.35}
                    strokeDasharray="1,1"
                  />
                )}
              </svg>
            )}
          </>
        )}

        {/* 5. Pixel-Exact Animated Marching Ants Selection Overlay */}
        {showExtras &&
          showSelectionEdges &&
          (() => {
            const activeMask = selectionDraftMask ?? sprite.mask;
            if (activeMask.isEmpty) return null;
            const segs = computeMarchingAntsSegments(activeMask);
            if (segs.length === 0) return null;
            return (
              <svg
                data-testid="marching-ants-overlay"
                className="absolute inset-0 w-full h-full pointer-events-none overflow-visible z-20"
                viewBox={`0 0 ${sprite.width} ${sprite.height}`}
                preserveAspectRatio="none"
              >
                {segs.map((seg, i) => (
                  <g key={i}>
                    <line
                      x1={seg.x1}
                      y1={seg.y1}
                      x2={seg.x2}
                      y2={seg.y2}
                      stroke="#000000"
                      strokeWidth={Math.max(0.08, 1.2 / scale)}
                    />
                    <line
                      x1={seg.x1}
                      y1={seg.y1}
                      x2={seg.x2}
                      y2={seg.y2}
                      stroke="#ffffff"
                      strokeWidth={Math.max(0.08, 1.2 / scale)}
                      strokeDasharray={`${Math.max(0.25, 3 / scale)},${Math.max(0.25, 3 / scale)}`}
                    />
                  </g>
                ))}
              </svg>
            );
          })()}

        {/* 5a. Interactive Floating Selection 8-Handle Transform & Rotation Gizmo (B01 rotated matrix) */}
        {floatingSelection && (
          <div
            data-testid="floating-transform-gizmo"
            data-angle-deg={floatingSelection.angleDeg}
            style={{
              left: floatingSelection.x * scaleX,
              top: floatingSelection.y * scaleY,
              width: floatingSelection.width * scaleX,
              height: floatingSelection.height * scaleY,
              transformOrigin: `${floatingSelection.pivotRelX * 100}% ${floatingSelection.pivotRelY * 100}%`,
              transform: `rotate(${floatingSelection.angleDeg}deg) skew(${floatingSelection.skewXDeg}deg, ${floatingSelection.skewYDeg}deg)`,
            }}
            className="absolute border-2 border-sky-400 ring-1 ring-black/80 z-30 pointer-events-auto cursor-move"
            onPointerDown={(e) => {
              e.stopPropagation();
              const pt = clientToSpriteCoords(e.clientX, e.clientY);
              transformDragRef.current = {
                handle: "move",
                startPt: pt,
                origX: floatingSelection.x,
                origY: floatingSelection.y,
                origW: floatingSelection.width,
                origH: floatingSelection.height,
                origAngle: floatingSelection.angleDeg,
                origSkewX: floatingSelection.skewXDeg,
                origSkewY: floatingSelection.skewYDeg,
              };
              isDrawingRef.current = true;
            }}
          >
            {/* 8 Scale Handles (NW, N, NE, E, SE, S, SW, W) */}
            {(
              [
                ["nw", "-top-1.5 -left-1.5 cursor-nwse-resize"],
                ["n", "-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize"],
                ["ne", "-top-1.5 -right-1.5 cursor-nesw-resize"],
                ["e", "top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize"],
                ["se", "-bottom-1.5 -right-1.5 cursor-nwse-resize"],
                ["s", "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize"],
                ["sw", "-bottom-1.5 -left-1.5 cursor-nesw-resize"],
                ["w", "top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize"],
              ] as const
            ).map(([hId, posClass]) => (
              <div
                key={hId}
                title={`Scale Handle (${hId.toUpperCase()}) — Shift: Proportional`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const pt = clientToSpriteCoords(e.clientX, e.clientY);
                  transformDragRef.current = {
                    handle: hId,
                    startPt: pt,
                    origX: floatingSelection.x,
                    origY: floatingSelection.y,
                    origW: floatingSelection.width,
                    origH: floatingSelection.height,
                    origAngle: floatingSelection.angleDeg,
                    origSkewX: floatingSelection.skewXDeg,
                    origSkewY: floatingSelection.skewYDeg,
                  };
                  isDrawingRef.current = true;
                }}
                className={`absolute w-2.5 h-2.5 bg-white border border-black ${posClass}`}
              />
            ))}

            {/* Top-Center Rotation Stalk & Handle */}
            <div
              title="Drag to Rotate Selection (Shift: Snap 15°)"
              onPointerDown={(e) => {
                e.stopPropagation();
                const pt = clientToSpriteCoords(e.clientX, e.clientY);
                transformDragRef.current = {
                  handle: "rotate",
                  startPt: pt,
                  origX: floatingSelection.x,
                  origY: floatingSelection.y,
                  origW: floatingSelection.width,
                  origH: floatingSelection.height,
                  origAngle: floatingSelection.angleDeg,
                  origSkewX: floatingSelection.skewXDeg,
                  origSkewY: floatingSelection.skewYDeg,
                };
                isDrawingRef.current = true;
              }}
              className="absolute -top-5 left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-amber-300 border border-black cursor-grab flex items-center justify-center text-[8px] font-bold text-black"
            >
              R
            </div>

            {/* Skew X Handle */}
            <div
              title="Drag Horizontally to Skew / Shear X"
              onPointerDown={(e) => {
                e.stopPropagation();
                const pt = clientToSpriteCoords(e.clientX, e.clientY);
                transformDragRef.current = {
                  handle: "skew_x",
                  startPt: pt,
                  origX: floatingSelection.x,
                  origY: floatingSelection.y,
                  origW: floatingSelection.width,
                  origH: floatingSelection.height,
                  origAngle: floatingSelection.angleDeg,
                  origSkewX: floatingSelection.skewXDeg,
                  origSkewY: floatingSelection.skewYDeg,
                };
                isDrawingRef.current = true;
              }}
              className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-1 bg-fuchsia-300 border border-black text-[8px] text-black font-bold cursor-ew-resize"
            >
              Skew
            </div>

            {/* Draggable Rotation Pivot Crosshair */}
            <div
              title={`Rotation Pivot (${Math.round(floatingSelection.pivotRelX * 100)}%, ${Math.round(
                floatingSelection.pivotRelY * 100
              )}%) — Drag to reposition`}
              onPointerDown={(e) => {
                e.stopPropagation();
                const pt = clientToSpriteCoords(e.clientX, e.clientY);
                transformDragRef.current = {
                  handle: "pivot",
                  startPt: pt,
                  origX: floatingSelection.x,
                  origY: floatingSelection.y,
                  origW: floatingSelection.width,
                  origH: floatingSelection.height,
                  origAngle: floatingSelection.angleDeg,
                  origSkewX: floatingSelection.skewXDeg,
                  origSkewY: floatingSelection.skewYDeg,
                };
                isDrawingRef.current = true;
              }}
              style={{
                left: `${floatingSelection.pivotRelX * 100}%`,
                top: `${floatingSelection.pivotRelY * 100}%`,
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-yellow-300 border-2 border-black cursor-crosshair"
            />
          </div>
        )}

        {/* 5b. Slices, 9-Patch Center Guides & Pivot Overlays */}
        {(showExtras && showSlicesOverlay) || activeToolId === "tool.slice" ? (
          <>
            {sprite.slices.map((slice) => {
              const key = getSliceKeyForFrame(slice, activeFrameIndex);
              const isSelected = slice.id === activeSliceId;
              const b =
                isSelected && sliceDraftBounds && sliceDragModeRef.current?.mode === "move"
                  ? sliceDraftBounds
                  : key.bounds;
              return (
                <div
                  key={slice.id}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setActiveSliceId(slice.id);
                    openDialog("dialog.slice_properties");
                  }}
                  style={{
                    left: b.x * scaleX,
                    top: b.y * scaleY,
                    width: b.width * scaleX,
                    height: b.height * scaleY,
                    borderColor: slice.color,
                  }}
                  className={`absolute border-2 pointer-events-none ${
                    isSelected ? "ring-1 ring-yellow-300 z-20" : "opacity-85 z-10"
                  }`}
                >
                  {/* Slice Name Label Badge */}
                  <span
                    style={{ backgroundColor: slice.color }}
                    className="absolute -top-4 left-0 px-1 py-0.2 text-[9px] font-mono font-bold text-black border border-black whitespace-nowrap"
                  >
                    {slice.name}
                  </span>

                  {/* 9-Patch Scaling Center Guides */}
                  {key.center && (
                    <div
                      style={{
                        left: key.center.x * scaleX,
                        top: key.center.y * scaleY,
                        width: key.center.width * scaleX,
                        height: key.center.height * scaleY,
                        borderColor: slice.color,
                      }}
                      className="absolute border border-dashed bg-white/5"
                    />
                  )}

                  {/* Pivot Point Crosshair */}
                  {key.pivot && (
                    <div
                      style={{
                        left: key.pivot.x * scaleX - 4,
                        top: key.pivot.y * scaleY - 4,
                      }}
                      className="absolute w-2 h-2 rounded-full bg-yellow-300 border border-black"
                      title={`Pivot (${key.pivot.x}, ${key.pivot.y})`}
                    />
                  )}
                </div>
              );
            })}

            {sliceDraftBounds && sliceDragModeRef.current?.mode === "create" && (
              <div
                style={{
                  left: sliceDraftBounds.x * scaleX,
                  top: sliceDraftBounds.y * scaleY,
                  width: sliceDraftBounds.width * scaleX,
                  height: sliceDraftBounds.height * scaleY,
                }}
                className="absolute border-2 border-dashed border-amber-400 bg-amber-400/15 pointer-events-none z-20"
              />
            )}
          </>
        ) : null}

        {/* 5c. Highlight Used Tiles Overlay on Tilemap Layer */}
        {highlightUsedTiles &&
          (() => {
            const layer = sprite.layers.find((l) => l.id === activeLayerId);
            const cel = getCel(sprite, activeLayerId, activeFrameIndex);
            const ts =
              layer && layer.kind === "tilemap"
                ? sprite.tilesets.find(
                    (t) => t.id === (layer as TilemapLayer).tilesetId
                  ) ?? sprite.tilesets[0]
                : null;
            if (!cel?.tilemapData || !ts) return null;
            const hits = findTileOccurrences(cel.tilemapData, activeTileIndex);
            return hits.map((h, i) => (
              <div
                key={i}
                style={{
                  left: (ts.gridOriginX + h.col * ts.tileWidth) * scaleX,
                  top: (ts.gridOriginY + h.row * ts.tileHeight) * scaleY,
                  width: ts.tileWidth * scaleX,
                  height: ts.tileHeight * scaleY,
                }}
                className="absolute border-2 border-yellow-300 bg-yellow-300/20 pointer-events-none z-10"
              />
            ));
          })()}

        {/* 6. Interactive Bezier Curve Control Handles (P0, P1, P2, P3) */}
        {curveState && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
            viewBox={`0 0 ${displayW} ${displayH}`}
          >
            <line
              x1={(curveState.p0.x + 0.5) * scaleX}
              y1={(curveState.p0.y + 0.5) * scaleY}
              x2={(curveState.p1.x + 0.5) * scaleX}
              y2={(curveState.p1.y + 0.5) * scaleY}
              stroke="#38bdf8"
              strokeWidth="1.5"
              strokeDasharray="3,3"
            />
            <line
              x1={(curveState.p3.x + 0.5) * scaleX}
              y1={(curveState.p3.y + 0.5) * scaleY}
              x2={(curveState.p2.x + 0.5) * scaleX}
              y2={(curveState.p2.y + 0.5) * scaleY}
              stroke="#38bdf8"
              strokeWidth="1.5"
              strokeDasharray="3,3"
            />
            {[curveState.p1, curveState.p2].map((hp, idx) => (
              <circle
                key={idx}
                cx={(hp.x + 0.5) * scaleX}
                cy={(hp.y + 0.5) * scaleY}
                r={5}
                fill="#38bdf8"
                stroke="#000"
                strokeWidth="1.5"
              />
            ))}
          </svg>
        )}

        {/* 7. Gradient Drag Vector Line Overlay */}
        {gradVector && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
            viewBox={`0 0 ${displayW} ${displayH}`}
          >
            <line
              x1={(gradVector.start.x + 0.5) * scaleX}
              y1={(gradVector.start.y + 0.5) * scaleY}
              x2={(gradVector.end.x + 0.5) * scaleX}
              y2={(gradVector.end.y + 0.5) * scaleY}
              stroke="#fef08a"
              strokeWidth="2"
            />
            <circle
              cx={(gradVector.start.x + 0.5) * scaleX}
              cy={(gradVector.start.y + 0.5) * scaleY}
              r={4}
              fill="#22c55e"
              stroke="#000"
            />
            <circle
              cx={(gradVector.end.x + 0.5) * scaleX}
              cy={(gradVector.end.y + 0.5) * scaleY}
              r={4}
              fill="#ef4444"
              stroke="#000"
            />
          </svg>
        )}

        {/* 8. Exact Brush Footprint & Crosshair Cursor Preview */}
        {cursorPos &&
          cursorStyle !== "simple" &&
          activeToolId !== "tool.hand" &&
          activeToolId !== "tool.zoom" && (
            <div className="absolute inset-0 pointer-events-none overflow-visible">
              {cursorStyle === "footprint_outline" &&
              cursorFootprint.length <= 256 ? (
                cursorFootprint.map((fp, i) => (
                  <div
                    key={i}
                    style={{
                      left: (cursorPos.x + fp.dx) * scaleX,
                      top: (cursorPos.y + fp.dy) * scaleY,
                      width: scaleX,
                      height: scaleY,
                      backgroundColor:
                        activeToolId === "tool.eraser"
                          ? "rgba(255,255,255,0.25)"
                          : `${rgbaToHex(fgColor)}55`,
                    }}
                    className="absolute border border-white/80"
                  />
                ))
              ) : (
                <div
                  style={{
                    left:
                      (cursorPos.x - Math.floor(toolOptions.brushSize / 2)) *
                      scaleX,
                    top:
                      (cursorPos.y - Math.floor(toolOptions.brushSize / 2)) *
                      scaleY,
                    width: toolOptions.brushSize * scaleX,
                    height: toolOptions.brushSize * scaleY,
                  }}
                  className="absolute border border-white ring-1 ring-black/80"
                />
              )}

              {cursorStyle === "crosshair" && (
                <>
                  <div
                    style={{ left: (cursorPos.x + 0.5) * scaleX }}
                    className="absolute top-0 bottom-0 w-px bg-white/60"
                  />
                  <div
                    style={{ top: (cursorPos.y + 0.5) * scaleY }}
                    className="absolute left-0 right-0 h-px bg-white/60"
                  />
                </>
              )}
            </div>
          )}
      </div>

      {/* Scrollbars visual tracks matching Screenshot 1 & 2 */}
      <div className="absolute bottom-1 left-12 right-12 h-2.5 kpx-bevel-inset bg-[#3f3943] flex items-center justify-center pointer-events-none">
        <div className="w-1/2 h-1.5 kpx-bevel-outset bg-[var(--kpx-chrome-bg)]" />
      </div>
      <div className="absolute right-1 top-8 bottom-8 w-2.5 kpx-bevel-inset bg-[#3f3943] flex flex-col items-center justify-center pointer-events-none">
        <div className="h-1/2 w-1.5 kpx-bevel-outset bg-[var(--kpx-chrome-bg)]" />
      </div>
    </div>
  );
};

/**
 * Helper component that mirrors the main canvas into adjacent tile slots when Tiled Mode is enabled.
 */
const TiledCloneCanvas: React.FC<{
  sourceCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  tx: number;
  ty: number;
  displayW: number;
  displayH: number;
  rev: number;
  renderTick: number;
  extraCel: ExtraCelOverlay | null;
}> = ({ sourceCanvasRef, tx, ty, displayW, displayH, rev, renderTick, extraCel }) => {
  const cloneRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const src = sourceCanvasRef.current;
    const dst = cloneRef.current;
    if (!src || !dst || src.width === 0 || src.height === 0) return;
    dst.width = src.width;
    dst.height = src.height;
    const ctx = dst.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);
  }, [sourceCanvasRef, rev, renderTick, extraCel, displayW, displayH]);

  return (
    <canvas
      ref={cloneRef}
      data-testid={`tiled-clone-${tx}_${ty}`}
      style={{
        left: tx * displayW,
        top: ty * displayH,
        width: displayW,
        height: displayH,
        imageRendering: "pixelated",
      }}
      className="absolute border border-dashed border-white/35 opacity-85 pointer-events-none"
    />
  );
};
