/**
 * @module @kekenik/core/scripting/types
 * Public TypeScript interfaces for the Kekenik Pixel Scripting Engine.
 */

export interface ScriptRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type ScriptEventName =
  | "beforeSave"
  | "afterSave"
  | "beforeClose"
  | "afterOpen"
  | "frameChange"
  | "layerChange"
  | "toolChange";

export interface ScriptImage {
  readonly width: number;
  readonly height: number;
  getPixel(x: number, y: number): ScriptRGBA;
  setPixel(x: number, y: number, color: ScriptRGBA | string): void;
  drawPixel(x: number, y: number, color: ScriptRGBA | string): void;
  drawLine(x0: number, y0: number, x1: number, y1: number, color: ScriptRGBA | string): void;
  drawRect(x: number, y: number, width: number, height: number, color: ScriptRGBA | string): void;
  drawFilledRect(
    x: number,
    y: number,
    width: number,
    height: number,
    color: ScriptRGBA | string
  ): void;
  drawImage(src: ScriptImage, x: number, y: number): void;
  clear(color?: ScriptRGBA | string): void;
  getData(): Uint8Array;
  setData(bytes: Uint8Array): void;
  getPixelData(x: number, y: number): Uint8Array;
}

export interface ScriptCel {
  readonly layerId: string;
  readonly frameIndex: number;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly image: ScriptImage;
  opacity: number;
  position: { x: number; y: number };
  delete(): void;
}

export interface ScriptLayer {
  readonly id: string;
  name: string;
  opacity: number;
  visible: boolean;
  locked: boolean;
  blendMode: string;
  readonly isGroup: boolean;
  readonly children: ScriptLayer[];
  readonly parent: ScriptLayer | null;
  readonly cels: ScriptCel[];
  delete(): void;
  moveTo(index: number): void;
}

export interface ScriptPalette {
  readonly size: number;
  getColor(index: number): ScriptRGBA;
  setColor(index: number, color: ScriptRGBA | string): void;
  resize(newSize: number): void;
  save(path: string): string;
  load(path: string): boolean;
}

export interface ScriptTag {
  readonly id: string;
  name: string;
  fromFrame: number;
  toFrame: number;
  direction: "forward" | "reverse" | "pingpong" | "pingpong-reverse";
  color: string;
  repeats: number;
}

export interface ScriptSlice {
  readonly id: string;
  name: string;
  color: string;
  bounds: { x: number; y: number; width: number; height: number };
  center?: { x: number; y: number; width: number; height: number };
  pivot?: { x: number; y: number };
}

export interface ScriptTileset {
  readonly id: string;
  name: string;
  tileWidth: number;
  tileHeight: number;
  readonly tileCount: number;
  save(path: string): string;
  load(path: string): boolean;
}

export interface ScriptSelection {
  readonly isEmpty: boolean;
  readonly bounds: { x: number; y: number; width: number; height: number } | null;
  selectRect(x: number, y: number, width: number, height: number): void;
  selectEllipse(x: number, y: number, width: number, height: number): void;
  selectAll(): void;
  deselect(): void;
  getMask(): Uint8Array;
}

export interface ScriptSprite {
  readonly width: number;
  readonly height: number;
  readonly colorMode: "rgba" | "grayscale" | "indexed";
  name: string;
  readonly layers: ScriptLayer[];
  readonly palette: ScriptPalette;
  readonly frames: Array<{ index: number; durationMs: number }>;
  readonly tags: ScriptTag[];
  readonly slices: ScriptSlice[];
  readonly tilesets: ScriptTileset[];
  readonly selection: ScriptSelection;
  userData: { text: string; color?: string };
  addLayer(name?: string): ScriptLayer;
  addFrame(durationMs?: number): number;
  crop(x: number, y: number, width: number, height: number): void;
  resize(width: number, height: number): void;
  flatten(visibleOnly?: boolean): void;
  saveAs(path: string): boolean;
}

export interface ScriptDialogWidgetSpec {
  id: string;
  type: "label" | "button" | "slider" | "color" | "combo" | "entry" | "checkbox" | "canvas";
  label?: string;
  text?: string;
  min?: number;
  max?: number;
  value?: unknown;
  options?: string[];
  checked?: boolean;
  width?: number;
  height?: number;
  canvasRgba?: Uint8Array;
}

export interface ScriptDialogResult {
  readonly id: string;
  readonly title: string;
  readonly widgets: ScriptDialogWidgetSpec[];
  readonly values: Record<string, unknown>;
  readonly confirmed: boolean;
  trigger(event: string, payload?: Record<string, unknown>): void;
}

export interface ScriptDialogBuilder {
  title(text: string): ScriptDialogBuilder;
  label(opts: { id?: string; text: string } | string): ScriptDialogBuilder;
  button(opts: { id: string; text: string; onClick?: () => void }): ScriptDialogBuilder;
  slider(opts: {
    id: string;
    label: string;
    min: number;
    max: number;
    value: number;
  }): ScriptDialogBuilder;
  color(opts: { id: string; label: string; value: ScriptRGBA | string }): ScriptDialogBuilder;
  combo(opts: {
    id: string;
    label: string;
    options: string[];
    value?: string;
  }): ScriptDialogBuilder;
  entry(opts: { id: string; label: string; value?: string }): ScriptDialogBuilder;
  checkbox(opts: { id: string; label: string; checked?: boolean }): ScriptDialogBuilder;
  canvas(opts: {
    id: string;
    width: number;
    height: number;
    draw?: (img: ScriptImage) => void;
  }): ScriptDialogBuilder;
  on(
    event: "change" | "confirm" | "cancel" | string,
    fn: (data: Record<string, unknown>) => void
  ): ScriptDialogBuilder;
}

export interface ScriptColorNamespace {
  rgba(r: number, g: number, b: number, a?: number): ScriptRGBA;
  hex(color: ScriptRGBA): string;
  fromHex(hex: string): ScriptRGBA;
  blend(backdrop: ScriptRGBA, source: ScriptRGBA, opacity?: number): ScriptRGBA;
}

export interface ScriptEventsAPI {
  on(
    event: ScriptEventName,
    fn: (payload: Record<string, unknown>) => void
  ): () => void;
  off(
    event: ScriptEventName,
    fn: (payload: Record<string, unknown>) => void
  ): void;
  emit(event: ScriptEventName, payload?: Record<string, unknown>): void;
}

export interface ScriptAppAPI {
  readonly version: string;
  readonly activeSprite: ScriptSprite | null;
  readonly activeLayer: ScriptLayer | null;
  activeFrame: number;
  readonly activeCel: ScriptCel | null;
  activeTool: string;
  fgColor: ScriptRGBA;
  bgColor: ScriptRGBA;
  readonly selection: ScriptSelection | null;
  readonly events: ScriptEventsAPI;
  readonly commands: {
    list(): string[];
    run(id: string, args?: Record<string, unknown>): void;
  };
  readonly tools: {
    list(): string[];
    select(id: string): void;
  };
  readonly fs: {
    readText(path: string): string | null;
    writeText(path: string, content: string): void;
    list(dir?: string): string[];
    exists(path: string): boolean;
  };
  readonly json: {
    encode(value: unknown): string;
    decode<T = unknown>(text: string): T;
  };
  alert(msg: string): void;
  confirm(msg: string): boolean;
  prompt(msg: string, defaultValue?: string): string | null;
  dialog(builderFn: (dlg: ScriptDialogBuilder) => void): ScriptDialogResult;
  transaction<T>(label: string, fn: () => T): T;
  open(path: string): ScriptSprite | null;
  save(path?: string): boolean;
  new: (
    width: number,
    height: number,
    colorMode?: "rgba" | "grayscale" | "indexed"
  ) => ScriptSprite;
  fetch(url: string): { status: number; ok: boolean; text: string };
}
