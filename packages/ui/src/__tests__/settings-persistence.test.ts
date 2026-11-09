import { describe, expect, it } from "vitest";
import { WebPlatform, defaultKeymap, getLocale, setPlatform } from "../../../core/src/index.ts";
import { useAppStore } from "../app/store.ts";
import { initializeSettingsPersistence } from "../app/settings-persistence.ts";

describe("application settings persistence", () => {
  it("restores preferences, shortcuts and workspace after a simulated restart", async () => {
    const platform = new WebPlatform();
    setPlatform(platform);
    const original = useAppStore.getState();
    let stop = await initializeSettingsPersistence();
    const s = useAppStore.getState();
    s.setTheme("default-light");
    s.setUIScale(200);
    s.setLocaleCode("fa");
    s.setCheckerSettings(4, "#111111", "#eeeeee");
    s.toggleGrid();
    s.setCursorStyle("crosshair");
    s.setRenderBackend("canvas2d");
    s.setToolOption("rightClickMode", "eraser");
    s.setTimelineCelWidth(40);
    s.setOnionSkin({ framesBefore: 4 });
    s.updateKeyBinding("edit.undo", "Ctrl+Alt+U");
    s.switchWorkspace("animation");
    s.saveWorkspaceAs("My workspace");
    s.setFloatCloseBehavior("redock");
    await Promise.resolve();
    const savedWorkspaceId = useAppStore.getState().activeWorkspaceId;
    stop();

    // Simulate a fresh store: reset only in-memory state while keeping the same disk/platform.
    useAppStore.setState(original, true);
    defaultKeymap.resetAll();
    stop = await initializeSettingsPersistence();
    const restored = useAppStore.getState();
    expect(restored.theme).toBe("default-light");
    expect(restored.uiScale).toBe(200);
    expect(restored.locale).toBe("fa");
    expect(getLocale()).toBe("fa");
    expect(restored.checkerSize).toBe(4);
    expect(restored.checkerColor1).toBe("#111111");
    expect(restored.showGrid).toBe(true);
    expect(restored.cursorStyle).toBe("crosshair");
    expect(restored.renderBackend).toBe("canvas2d");
    expect(restored.toolOptions.rightClickMode).toBe("eraser");
    expect(restored.timelineCelWidth).toBe(40);
    expect(restored.onionSkin.framesBefore).toBe(4);
    expect(defaultKeymap.getBinding("edit.undo")?.keys).toBe("Ctrl+Alt+U");
    expect(restored.activeWorkspaceId).toBe(savedWorkspaceId);
    expect(restored.workspaces.some((w) => w.name === "My workspace")).toBe(true);
    expect(restored.floatCloseBehavior).toBe("redock");
    stop();
    defaultKeymap.resetAll();
    useAppStore.setState(original, true);
  });

  it("ignores malformed values rather than breaking startup", async () => {
    const platform = new WebPlatform();
    setPlatform(platform);
    await platform.writeSetting("editor.preferences.v1", {
      uiScale: 999, locale: "bad", checkerSize: null, showGrid: "bad", onionSkin: "bad", bindings: "bad",
    });
    const original = useAppStore.getState();
    const stop = await initializeSettingsPersistence();
    expect(useAppStore.getState().uiScale).toBe(original.uiScale);
    expect(useAppStore.getState().locale).toBe(original.locale);
    expect(useAppStore.getState().checkerSize).toBe(original.checkerSize);
    expect(useAppStore.getState().showGrid).toBe(original.showGrid);
    expect(useAppStore.getState().onionSkin).toEqual(original.onionSkin);
    stop();
    useAppStore.setState(original, true);
  });
});
