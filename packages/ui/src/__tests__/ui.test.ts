import { describe, expect, it } from "vitest";
import { ALL_ICON_NAMES, useAppStore } from "../index.ts";

describe("@kekenik/ui acceptance workflows", () => {
  it("provides >= 80 original pixel icons", () => {
    expect(ALL_ICON_NAMES.length).toBeGreaterThanOrEqual(80);
  });

  it("creates a 64x64 New Sprite, draws with Pencil, and Undoes/Redoes via commands", () => {
    const store = useAppStore.getState();
    const doc = store.createNewDocument({
      name: "Acceptance64.ase",
      width: 64,
      height: 64,
      colorMode: "rgba",
      background: "transparent",
    });
    expect(doc.sprite.width).toBe(64);
    expect(doc.sprite.height).toBe(64);

    const layerId = useAppStore.getState().activeLayerId;
    doc.transact("Pencil Stroke", (tx) => {
      tx.drawPixels(layerId, 0, [{ x: 16, y: 16, color: { r: 255, g: 128, b: 0, a: 255 } }]);
    });
    expect(doc.sprite.cels[0].image.getRGBA(16, 16).r).toBe(255);

    useAppStore.getState().runCommandById("edit.undo");
    expect(doc.sprite.cels[0].image.getRGBA(16, 16).a).toBe(0);

    useAppStore.getState().runCommandById("edit.redo");
    expect(doc.sprite.cels[0].image.getRGBA(16, 16).r).toBe(255);
  });

  it("floats 3 panels, saves workspace 'Mine', switches to Default and back to 'Mine'", () => {
    useAppStore.getState().switchWorkspace("default");
    useAppStore.getState().togglePanelFloating("panel.history");
    useAppStore.getState().togglePanelFloating("panel.layers");
    useAppStore.getState().togglePanelFloating("panel.info");

    const floatedIds = useAppStore
      .getState()
      .currentLayout.dock!.floating.flatMap((f) => f.panels);
    expect(floatedIds).toContain("panel.history");
    expect(floatedIds).toContain("panel.layers");
    expect(floatedIds).toContain("panel.info");

    // Save workspace as "Mine"
    useAppStore.getState().saveWorkspaceAs("Mine");
    const mineWs = useAppStore.getState().workspaces.find((w) => w.name === "Mine");
    expect(mineWs).toBeDefined();

    // Switch to Default
    useAppStore.getState().switchWorkspace("default");
    expect(useAppStore.getState().activeWorkspaceId).toBe("default");
    expect(useAppStore.getState().currentLayout.dock!.floating.length).toBe(1);

    // Switch back to "Mine"
    useAppStore.getState().switchWorkspace(mineWs!.id);
    expect(useAppStore.getState().currentLayout.dock!.floating.length).toBeGreaterThanOrEqual(3);
  });

  it("G4 interaction: float a docked panel -> sibling expands + floating window exists -> dock back restores layout", async () => {
    const core = await import("../../../core/src/layout/index.ts");
    const st = useAppStore.getState();
    st.switchWorkspace("animation");
    const before = core.ensureDock(useAppStore.getState().currentLayout as never);
    const tabs = core.findTabsOfPanel(before, "panel.timeline")!;
    const rectsBefore = core.computeRects(before, 1280, 720);
    const neighbourBefore = rectsBefore["center"].height;

    st.floatPanelAt("panel.timeline");
    const floated = core.ensureDock(useAppStore.getState().currentLayout as never);
    expect(floated.floating.some((f) => f.panels.includes("panel.timeline"))).toBe(true);
    const timelineGroupStillDocked = core.findTabsOfPanel(floated, "panel.logviewer");
    expect(timelineGroupStillDocked).not.toBeNull();
    st.floatPanelAt("panel.logviewer");
    const floated2 = core.ensureDock(useAppStore.getState().currentLayout as never);
    const rectsAfter = core.computeRects(floated2, 1280, 720);
    expect(rectsAfter["center"].height).toBeGreaterThan(neighbourBefore);

    const winLog = floated2.floating.find((f) => f.panels.includes("panel.logviewer"))!;
    const winTl = floated2.floating.find((f) => f.panels.includes("panel.timeline"))!;
    st.dockBackFloating(winLog.id);
    st.dockBackFloating(winTl.id);
    const restored = core.ensureDock(useAppStore.getState().currentLayout as never);
    expect(core.structure(restored.root)).toEqual(core.structure(before.root));
    expect(tabs.panels.length).toBeGreaterThan(0);
    st.switchWorkspace("default");
  });

  it("records custom keyboard shortcuts and switches themes and UI scale", () => {
    useAppStore.getState().updateKeyBinding("view.grid", "Ctrl+G");
    const updated = useAppStore
      .getState()
      .keyBindings.find((k) => k.commandId === "view.grid");
    expect(updated?.keys).toBe("Ctrl+G");

    useAppStore.getState().resetKeyBinding("view.grid");
    expect(
      useAppStore.getState().keyBindings.find((k) => k.commandId === "view.grid")?.keys
    ).toBe("Ctrl+'");

    useAppStore.getState().setTheme("high-contrast");
    expect(useAppStore.getState().theme).toBe("high-contrast");
    useAppStore.getState().setUIScale(200);
    expect(useAppStore.getState().uiScale).toBe(200);

    // Restore defaults
    useAppStore.getState().setTheme("default-dark");
    useAppStore.getState().setUIScale(100);
  });

  it("completes the Agent 3 acceptance workflow: 6-frame animation, tags, onion skin, layer groups, linked cels, slices, and tilemaps", () => {
    const store = useAppStore.getState();
    const doc = store.createNewDocument({
      name: "Agent3_Acceptance.ase",
      width: 32,
      height: 32,
      colorMode: "rgba",
      background: "transparent",
    });

    // 1. Add 5 more frames -> 6-frame animation
    for (let i = 0; i < 5; i++) {
      useAppStore.getState().runCommandById("frame.new");
    }
    expect(doc.sprite.frames.length).toBe(6);

    // 2. Link cels on frames 0 and 1
    useAppStore.getState().setSelectedCelRange({
      layerIds: [doc.sprite.layers[0].id],
      fromFrame: 0,
      toFrame: 1,
    });
    useAppStore.getState().linkSelectedCels(true);
    expect(doc.sprite.cels[0].linkId).toBeDefined();
    expect(doc.sprite.cels[0].linkId).toBe(doc.sprite.cels[1].linkId);

    // 3. Enable Onion Skin with red/blue tint
    useAppStore.getState().toggleOnionSkin();
    expect(useAppStore.getState().onionSkin.enabled).toBe(true);

    // 4. Create Group Layer & Tilemap Layer
    useAppStore.getState().createGroupLayer("Hero Group");
    useAppStore.getState().createTilemapLayer({
      name: "Level Tiles",
      tileWidth: 16,
      tileHeight: 16,
    });
    expect(doc.sprite.layers.some((l) => l.kind === "group")).toBe(true);
    expect(doc.sprite.layers.some((l) => l.kind === "tilemap")).toBe(true);

    // 5. Open all 6 Agent-3 Demo Documents and verifySlices export
    const demos = [
      "walk_cycle",
      "onion_skin_lab",
      "layer_groups_blends",
      "linked_cels_lab",
      "tilemap_dungeon",
      "slices_9patch_ui",
    ] as const;
    for (const demo of demos) {
      useAppStore.getState().openDemoDocument(demo);
      expect(useAppStore.getState().getActiveDocument()).not.toBeNull();
    }

    // Active doc is now slices_9patch_ui.ase -> test Select Slice Bounds and Export Slice
    const sliceDoc = useAppStore.getState().getActiveDocument()!;
    const sliceId = sliceDoc.sprite.slices[0].id;
    useAppStore.getState().selectSliceBounds(sliceId);
    expect(sliceDoc.sprite.mask.bounds).toEqual({ x: 4, y: 6, width: 40, height: 36 });

    useAppStore.getState().exportSliceAsNewDocument(sliceId);
    const exportedDoc = useAppStore.getState().getActiveDocument()!;
    expect(exportedDoc.sprite.width).toBe(40);
    expect(exportedDoc.sprite.height).toBe(36);
  });

  it("completes the Agent 5 acceptance workflow: Script Editor pixel edit + Ctrl+Z undo, .kpext theme install/revert, Persian RTL switch, and 100% Agent 5 Feature Center self-tests PASS", async () => {
    const { FeatureRegistry, getCel, isRTL, t } = await import("../../../core/src/index.ts");
    const store = useAppStore.getState();
    const doc = store.createNewDocument({
      name: "Agent5_Acceptance.ase",
      width: 16,
      height: 16,
      colorMode: "rgba",
      background: "transparent",
    });

    // 1. Run acceptance one-liner in Script Editor and undo with Ctrl+Z (edit.undo)
    await useAppStore
      .getState()
      .runActiveScript(
        `app.activeCel.image.setPixel(0,0,{r:255,g:0,b:0,a:255})`,
        "acceptance.ts"
      );
    const cel = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!;
    expect(cel.image.getRGBA(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 255 });

    useAppStore.getState().runCommandById("edit.undo");
    const celAfterUndo = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!;
    expect(celAfterUndo.image.getRGBA(0, 0).a).toBe(0);

    // 2. Install sample theme extension, verify skin changed, disable/uninstall and revert
    useAppStore.getState().installSampleExtensionById("theme-cyberpunk");
    expect(useAppStore.getState().theme).toBe("cyberpunk-neon");
    useAppStore.getState().toggleExtensionEnabled("kekenik.theme-cyberpunk");
    expect(useAppStore.getState().theme).toBe("default-dark");
    useAppStore.getState().uninstallExtensionById("kekenik.theme-cyberpunk");

    // 3. Switch language to Persian (fa) and verify RTL + localized label
    useAppStore.getState().setLocaleCode("fa");
    expect(isRTL(useAppStore.getState().locale)).toBe(true);
    expect(t("panel.script_editor", "fa")).toBe("ویرایشگر اسکریپت");
    useAppStore.getState().setLocaleCode("en");

    // 4. Verify all Feature Center items owned by Agent 5 are `tested` + PASS
    const agent5Features = FeatureRegistry.getAll().filter((f) => f.ownerAgent === 5);
    expect(agent5Features.length).toBeGreaterThanOrEqual(25);
    for (const feat of agent5Features) {
      expect(feat.state).toBe("tested");
      const res = await feat.selfTest();
      expect(res.passed).toBe(true);
    }
  });
});
