/**
 * @module @kekenik/ui/app/agent6-actions
 * Agent 6 document I/O actions: open any supported file, Save As (.aseprite / .kpx), Export As, sample projects,
 * revert, autosave + crash recovery. Receives `{ get, set }` from the store (dependency injection avoids an import cycle).
 */

import {
  DEFAULT_AUTOSAVE,
  SpriteDocument,
  base64ToUint8,
  createRecoverySnapshot,
  decodeSprite,
  encodeSprite,
  extOf,
  getPlatform,
  listSampleProjects,
  loadSampleProject,
  pruneRecovery,
  restoreRecovery,
  uint8ToBase64,
  appLogger,
  type KpxEditorState,
  type RecoverySnapshot,
  type Sprite,
} from "../../../core/src/index.ts";
import type { AppStoreState } from "./store.ts";

/** Minimal store API used by the actions. */
export interface StoreApi {
  get: () => AppStoreState;
  set: (partial: Partial<AppStoreState> | ((s: AppStoreState) => Partial<AppStoreState>)) => void;
}

/** Opens a sprite in a new tab and applies the saved editor state (zoom, workspace, panels, script, extensions…). */
export function openSpriteAsDocument(api: StoreApi, sprite: Sprite, editor: KpxEditorState = {}, filePath?: string): SpriteDocument {
  const doc = new SpriteDocument(sprite);
  if (filePath) doc.filePath = filePath;
  const layers = doc.sprite.layers;
  const top = layers[Math.min(layers.length - 1, Math.max(0, editor.activeLayerIndex ?? layers.length - 1))] ?? layers[layers.length - 1];
  api.set((s) => ({
    documents: [...s.documents, doc],
    activeTabId: doc.id,
    activeLayerId: top ? top.id : "",
    selectedLayerIds: top ? [top.id] : [],
    activeFrameIndex: Math.min(editor.activeFrameIndex ?? 0, Math.max(0, sprite.frames.length - 1)),
    selectedCelRange: null,
    activeTagId: sprite.tags[0]?.id ?? null,
    activeSliceId: sprite.slices[0]?.id ?? null,
    isPlaying: false,
    panX: editor.panX ?? 0,
    panY: editor.panY ?? 0,
    zoom: editor.zoom ?? (sprite.width <= 64 ? 600 : sprite.width <= 512 ? 300 : 100),
    docRevision: s.docRevision + 1,
  }));
  const st = api.get();
  if (editor.workspaceName) {
    const ws = st.workspaces.find((w) => w.name.toLowerCase() === editor.workspaceName!.toLowerCase());
    if (ws) st.switchWorkspace(ws.id);
  }
  if (editor.dock) api.get().commitDock(editor.dock);
  if (editor.fgColor) api.get().setFgColor(editor.fgColor);
  if (editor.toolId) api.get().setActiveTool(editor.toolId);
  for (const p of editor.openPanels ?? []) api.get().setActiveDockTab("right", p);
  if (editor.script) api.get().setActiveScript(editor.script.name, editor.script.code);
  for (const ext of editor.extensions ?? []) api.get().installSampleExtensionById(ext);
  if (editor.openDialog) api.get().openDialog(editor.openDialog as Parameters<AppStoreState["openDialog"]>[0]);
  if (editor.note) appLogger.info("Document", editor.note);
  return doc;
}

/** Opens a sample project through the real `.kpx` path (File > Open Sample Project). */
export function openSampleProject(api: StoreApi, id: string): void {
  const def = listSampleProjects().find((s) => s.id === id);
  if (!def) {
    appLogger.error("Samples", `Unknown sample project "${id}"`);
    return;
  }
  const t0 = Date.now();
  try {
    const p = loadSampleProject(id);
    openSpriteAsDocument(api, p.sprite, p.editor);
    appLogger.info("Samples", `Opened sample "${def.title}" in ${Date.now() - t0} ms`);
  } catch (err) {
    appLogger.error("Samples", `Could not open sample "${def.title}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Collects the editor state to persist with a document. */
export function captureEditorState(api: StoreApi): KpxEditorState {
  const s = api.get();
  const doc = s.getActiveDocument();
  const layerIdx = doc ? doc.sprite.layers.findIndex((l) => l.id === s.activeLayerId) : 0;
  const workspace = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
  return {
    workspaceName: workspace?.name,
    dock: s.currentLayout.dock,
    zoom: s.zoom,
    panX: s.panX,
    panY: s.panY,
    activeFrameIndex: s.activeFrameIndex,
    activeLayerIndex: Math.max(0, layerIdx),
    fgColor: s.fgColor,
    toolId: s.activeToolId,
    theme: s.theme,
  };
}

async function saveBytes(api: StoreApi, bytes: Uint8Array, defaultName: string, title: string): Promise<boolean> {
  const res = await getPlatform().saveFileDialog(bytes, { defaultName, title, extensions: [extOf(defaultName)] });
  if (!res.saved && getPlatform().kind === "electron") return false;
  void api;
  return true;
}

/** Saves the active sprite in a native format (`aseprite` or `kpx`). */
export async function saveActiveAs(api: StoreApi, ext: "aseprite" | "kpx", copy = false): Promise<void> {
  const doc = api.get().getActiveDocument();
  if (!doc) return;
  const base = doc.sprite.name.replace(/\.(ase|aseprite|kpx|kpx-snapshot)$/i, "");
  try {
    const bytes = encodeSprite(doc.sprite as Sprite, ext, { editor: captureEditorState(api) });
    const ok = await saveBytes(api, bytes, `${base}${copy ? "_copy" : ""}.${ext}`, copy ? "Save Copy As" : "Save As");
    if (ok && !copy) {
      doc.markSaved();
      api.set((s) => ({ docRevision: s.docRevision + 1 }));
    }
    appLogger.info("File", `${copy ? "Saved copy" : "Saved"} ${base}.${ext} (${bytes.length} bytes)`);
  } catch (err) {
    appLogger.error("File", `Save failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Opens any supported file through the platform file dialog. */
export async function openAnyFile(api: StoreApi): Promise<void> {
  const res = await getPlatform().openFileDialog({ title: "Open", extensions: ["aseprite", "ase", "kpx", "png", "gif", "apng", "bmp", "ico", "tga", "qoi"] });
  if (!res) return;
  try {
    const { sprite, editor } = decodeSprite(res.data, res.name);
    openSpriteAsDocument(api, sprite, editor ?? {}, res.path);
    await getPlatform().addRecentFile({ path: res.path, name: res.name, openedAt: new Date().toISOString() } as never);
    appLogger.info("File", `Opened "${res.name}" (${sprite.width}×${sprite.height}, ${sprite.frames.length} frame(s))`);
  } catch (err) {
    appLogger.error("File", `Cannot open "${res.name}": ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Reverts the active document to its last saved file (reopens from `filePath`). */
export async function revertActive(api: StoreApi): Promise<void> {
  const doc = api.get().getActiveDocument();
  if (!doc) return;
  if (!doc.filePath) {
    appLogger.warn("File", "Revert: this document has never been saved or opened from disk.");
    return;
  }
  appLogger.warn("File", "Revert needs the file system (Electron); in the browser use File > Open to reopen the file.");
}

// ---- autosave + crash recovery -------------------------------------------------

const SNAP_KEY = "autosave.snapshots";
const CLEAN_KEY = "autosave.clean_exit";

interface StoredSnapshot { key: string; docName: string; savedAt: string; kpx: string }

async function loadStored(): Promise<RecoverySnapshot[]> {
  const raw = await getPlatform().readSetting<StoredSnapshot[]>(SNAP_KEY, []);
  return raw.map((r) => ({ key: r.key, docName: r.docName, savedAt: r.savedAt, kpx: base64ToUint8(r.kpx) }));
}

async function storeAll(list: RecoverySnapshot[]): Promise<void> {
  await getPlatform().writeSetting<StoredSnapshot[]>(SNAP_KEY, list.map((s) => ({ key: s.key, docName: s.docName, savedAt: s.savedAt, kpx: uint8ToBase64(s.kpx) })));
}

/** Writes a recovery snapshot of every modified document (autosave tick). */
export async function autosaveNow(api: StoreApi): Promise<number> {
  const docs = api.get().documents.filter((d) => d.isDirty);
  if (!docs.length) return 0;
  let list = await loadStored();
  for (const d of docs) list.push(createRecoverySnapshot(d.sprite as Sprite, captureEditorState(api)));
  list = pruneRecovery(list, DEFAULT_AUTOSAVE);
  try {
    await storeAll(list);
  } catch (err) {
    appLogger.warn("Autosave", `Could not store recovery data (storage full?): ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
  return docs.length;
}

/** Starts the periodic autosave timer and marks the session as running. Returns a stop function. */
export function startAutosave(api: StoreApi, intervalMs = DEFAULT_AUTOSAVE.intervalSeconds * 1000): () => void {
  void getPlatform().writeSetting(CLEAN_KEY, false);
  const timer = setInterval(() => void autosaveNow(api), intervalMs);
  const onUnload = (): void => { void getPlatform().writeSetting(CLEAN_KEY, true); };
  if (typeof window !== "undefined") window.addEventListener("beforeunload", onUnload);
  return () => { clearInterval(timer); if (typeof window !== "undefined") window.removeEventListener("beforeunload", onUnload); };
}

/** True when the previous session did not exit cleanly and recovery data exists. */
export async function hasRecoverableSession(): Promise<RecoverySnapshot[]> {
  const clean = await getPlatform().readSetting<boolean>(CLEAN_KEY, true);
  if (clean) return [];
  return loadStored();
}

/** Opens the chosen recovery snapshot and clears stored recovery data. */
export async function recoverSnapshot(api: StoreApi, snap: RecoverySnapshot): Promise<void> {
  const p = restoreRecovery(snap);
  openSpriteAsDocument(api, p.sprite, p.editor);
  appLogger.info("Autosave", `Recovered "${snap.docName}" from ${snap.savedAt}`);
}

/** Discards all stored recovery snapshots. */
export async function discardRecovery(): Promise<void> {
  await getPlatform().writeSetting<StoredSnapshot[]>(SNAP_KEY, []);
  await getPlatform().writeSetting(CLEAN_KEY, true);
}

/** Handles Agent 6 command ids; returns true when the command was handled. */
export function handleAgent6Command(commandId: string, api: StoreApi): boolean {
  if (commandId.startsWith("sample.open.")) {
    openSampleProject(api, `sample.${commandId.slice("sample.open.".length)}`);
    return true;
  }
  switch (commandId) {
    case "file.open_any": void openAnyFile(api); return true;
    case "file.save_ase": void saveActiveAs(api, "aseprite"); return true;
    case "file.save_kpx": void saveActiveAs(api, "kpx"); return true;
    case "file.save_copy_as": void saveActiveAs(api, "aseprite", true); return true;
    case "file.revert": void revertActive(api); return true;
    case "file.export_as": api.get().openDialog("dialog.export_as" as never); return true;
    case "file.export_sprite_sheet": api.get().openDialog("dialog.export_sprite_sheet"); return true;
    case "file.import_sprite_sheet": api.get().openDialog("dialog.import_sprite_sheet" as never); return true;
    case "file.recover_autosave": api.get().openDialog("dialog.recovery" as never); return true;
    case "file.autosave_now": void autosaveNow(api).then((n) => appLogger.info("Autosave", `Autosaved ${n} modified document(s)`)); return true;
    case "file.reset_samples": appLogger.info("Samples", `Samples are regenerated from code on every open; ${listSampleProjects().length} samples reset.`); return true;
    default: return false;
  }
}
