/** Persistent application preferences. Restore before mounting any UI so startup effects cannot
 * overwrite saved values with defaults. Document data and transient editor state are not stored. */
import { appLogger, defaultKeymap, getPlatform, setLocale } from "../../../core/src/index.ts";
import { useAppStore, type AppStoreState } from "./store.ts";

const KEY = "editor.preferences.v1";
const fields = [
  "theme", "uiScale", "locale", "checkerSize", "checkerColor1", "checkerColor2",
  "renderBackend", "showGrid", "showPixelGrid", "snapToGrid", "gridColor", "gridOpacity",
  "gridThickness", "tiledMode", "showExtras", "showLayerEdges", "cursorStyle",
  "timelinePosition", "timelineCelWidth", "timelineThumbnails", "onionSkin", "playbackConfig",
] as const satisfies readonly (keyof AppStoreState)[];
type Field = typeof fields[number];
type SavedPreferences = Pick<AppStoreState, Field> & {
  rightClickMode: AppStoreState["toolOptions"]["rightClickMode"];
  bindings: Array<{ commandId: string; keys: string }>;
};

function snapshot(s: AppStoreState): SavedPreferences {
  const result = {} as Pick<AppStoreState, Field>;
  for (const field of fields) (result as Record<string, unknown>)[field] = s[field];
  return {
    ...result,
    rightClickMode: s.toolOptions.rightClickMode,
    bindings: s.keyBindings.map(({ commandId, keys }) => ({ commandId, keys })),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Preserve known members only and reject mismatched JSON types from damaged/old settings.
function mergeSafe(defaultValue: unknown, saved: unknown): unknown {
  if (isObject(defaultValue)) {
    if (!isObject(saved)) return defaultValue;
    const result = { ...defaultValue };
    for (const key of Object.keys(result)) result[key] = mergeSafe(result[key], saved[key]);
    return result;
  }
  if (typeof defaultValue === "number") return typeof saved === "number" && Number.isFinite(saved) ? saved : defaultValue;
  if (typeof defaultValue === "boolean" || typeof defaultValue === "string") return typeof saved === typeof defaultValue ? saved : defaultValue;
  return saved === null || saved === undefined ? defaultValue : saved;
}

/** Restore settings and install change tracking. Call once after selecting the platform and
 * before rendering the application. The returned cleanup is useful for tests/embedding. */
export async function initializeSettingsPersistence(): Promise<() => void> {
  const platform = getPlatform();
  try {
    const legacy = await platform.readSetting<unknown>("preferences", {});
    const stored = await platform.readSetting<unknown>(KEY, null);
    const raw = isObject(stored) ? stored : isObject(legacy) ? legacy : {};
    const defaults = snapshot(useAppStore.getState());
    const merged = mergeSafe(defaults, raw) as SavedPreferences;
    if (![100, 200, 300].includes(merged.uiScale)) merged.uiScale = defaults.uiScale;
    if (!["en", "fa", "fa-IR"].includes(merged.locale)) merged.locale = defaults.locale;
    if (![4, 8, 16, 32].includes(merged.checkerSize)) merged.checkerSize = defaults.checkerSize;
    if (!["webgl2", "canvas2d"].includes(merged.renderBackend)) merged.renderBackend = defaults.renderBackend;
    if (!["footprint_outline", "crosshair", "bounds", "simple"].includes(merged.cursorStyle)) merged.cursorStyle = defaults.cursorStyle;
    if (!["bottom", "left", "right"].includes(merged.timelinePosition)) merged.timelinePosition = defaults.timelinePosition;
    if (!["off", "small", "medium", "large"].includes(merged.timelineThumbnails)) merged.timelineThumbnails = defaults.timelineThumbnails;
    if (!["none", "both", "x", "y"].includes(merged.tiledMode)) merged.tiledMode = defaults.tiledMode;
    if (!["bg_color", "eraser"].includes(merged.rightClickMode)) merged.rightClickMode = defaults.rightClickMode;

    const bindings = Array.isArray(raw.bindings) ? raw.bindings : [];
    for (const binding of bindings) {
      if (isObject(binding) && typeof binding.commandId === "string" && typeof binding.keys === "string" && binding.commandId.length < 200 && binding.keys.length < 100) {
        defaultKeymap.setBinding(binding.commandId, binding.keys);
      }
    }
    const patch: Partial<AppStoreState> = {};
    for (const field of fields) (patch as Record<string, unknown>)[field] = merged[field];
    patch.toolOptions = { ...useAppStore.getState().toolOptions, rightClickMode: merged.rightClickMode };
    patch.keyBindings = defaultKeymap.getAll();
    setLocale(merged.locale);
    useAppStore.setState(patch);
  } catch (err) {
    appLogger.error("Settings", `Could not restore preferences: ${String(err)}`);
  }

  await useAppStore.getState().restoreLayout();
  return useAppStore.subscribe((state, previous) => {
    if (fields.some((field) => state[field] !== previous[field]) ||
        state.toolOptions.rightClickMode !== previous.toolOptions.rightClickMode ||
        state.keyBindings !== previous.keyBindings) {
      const preferences = snapshot(state);
      void platform.writeSetting(KEY, preferences).catch((err) => {
        appLogger.error("Settings", `Could not save preferences: ${String(err)}`);
      });
    }
    if (state.currentLayout !== previous.currentLayout ||
        state.activeWorkspaceId !== previous.activeWorkspaceId ||
        state.floatCloseBehavior !== previous.floatCloseBehavior ||
        state.workspaces !== previous.workspaces) {
      const layout = {
        layout: state.currentLayout,
        activeWorkspaceId: state.activeWorkspaceId,
        floatCloseBehavior: state.floatCloseBehavior,
        customWorkspaces: state.workspaces.filter((w) => !w.builtIn),
      };
      void platform.writeSetting("layout.v2", layout).catch((err) => {
        appLogger.error("Settings", `Could not save workspace: ${String(err)}`);
      });
    }
  });
}
