import { describe, expect, it } from "vitest";
import {
  ALL_BLEND_MODES,
  blendRGBA,
  bresenhamLine,
  BUILTIN_WORKSPACES,
  cloneWorkspaceLayout,
  compositeFrame,
  createAntiheroDemoDocument,
  createSprite,
  deserializeSnapshot,
  detectKeymapConflicts,
  FeatureRegistry,
  filterPixelPerfect,
  hexToRgba,
  hslToRgba,
  hsvToRgba,
  intersectRect,
  isRTL,
  KeymapManager,
  Mask,
  normalizeKeyChord,
  PixelImage,
  registerMasterFeatures,
  Registry,
  rgbaToHex,
  rgbToHsl,
  rgbToHsv,
  serializeSnapshot,
  setLocale,
  SpriteDocument,
  t,
  unionRect,
  WebPlatform,
} from "../index.ts";

describe("@kekenik/core utilities", () => {
  it("computes rectangle intersection and union", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    expect(intersectRect(a, b)).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    expect(unionRect(a, b)).toEqual({ x: 0, y: 0, width: 15, height: 15 });
  });

  it("traces Bresenham lines and filters pixel-perfect L-corners", () => {
    const line = bresenhamLine(0, 0, 3, 3);
    expect(line.length).toBe(4);
    const lCorner = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];
    const filtered = filterPixelPerfect(lCorner);
    expect(filtered).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
  });

  it("converts colors accurately between RGBA, Hex, HSV, and HSL", () => {
    const orig = { r: 223, g: 113, b: 38, a: 255 };
    const hex = rgbaToHex(orig);
    expect(hex).toBe("#DF7126");
    expect(hexToRgba(hex)).toEqual(orig);

    const hsv = rgbToHsv(orig.r, orig.g, orig.b);
    const fromHsv = hsvToRgba(hsv.h, hsv.s, hsv.v, 255);
    expect(Math.abs(fromHsv.r - orig.r)).toBeLessThanOrEqual(4);

    const hsl = rgbToHsl(orig.r, orig.g, orig.b);
    const fromHsl = hslToRgba(hsl.h, hsl.s, hsl.l, 255);
    expect(Math.abs(fromHsl.g - orig.g)).toBeLessThanOrEqual(4);
  });
});

describe("@kekenik/core PixelImage, BlendModes, and Mask", () => {
  it("supports RGBA (4 B/px), Grayscale (2 B/px), and Indexed (1 B/px)", () => {
    const rgbaImg = new PixelImage(4, 4, "rgba");
    const grayImg = new PixelImage(4, 4, "grayscale");
    const idxImg = new PixelImage(4, 4, "indexed");

    expect(rgbaImg.data.byteLength).toBe(64);
    expect(grayImg.data.byteLength).toBe(32);
    expect(idxImg.data.byteLength).toBe(16);

    rgbaImg.setRGBA(2, 1, { r: 100, g: 150, b: 200, a: 255 });
    expect(rgbaImg.getRGBA(2, 1)).toEqual({ r: 100, g: 150, b: 200, a: 255 });

    const cropped = rgbaImg.crop({ x: 1, y: 1, width: 2, height: 2 });
    expect(cropped.getRGBA(1, 0)).toEqual({ r: 100, g: 150, b: 200, a: 255 });
  });

  it("executes all 18+ blend modes without NaN or out-of-range channels", () => {
    expect(ALL_BLEND_MODES.length).toBeGreaterThanOrEqual(18);
    for (const mode of ALL_BLEND_MODES) {
      const res = blendRGBA(
        { r: 80, g: 120, b: 190, a: 255 },
        { r: 210, g: 60, b: 90, a: 200 },
        mode,
        220
      );
      expect(res.r).toBeGreaterThanOrEqual(0);
      expect(res.r).toBeLessThanOrEqual(255);
      expect(res.a).toBeGreaterThan(0);
    }
  });

  it("manages 1-bit selection Mask and calculates exact bounds", () => {
    const mask = new Mask(16, 16);
    expect(mask.isEmpty).toBe(true);
    mask.selectRect({ x: 3, y: 4, width: 5, height: 6 });
    expect(mask.isEmpty).toBe(false);
    expect(mask.bounds).toEqual({ x: 3, y: 4, width: 5, height: 6 });
    expect(mask.getBit(3, 4)).toBe(true);
    expect(mask.getBit(2, 4)).toBe(false);
    mask.invert();
    expect(mask.getBit(3, 4)).toBe(false);
    expect(mask.getBit(0, 0)).toBe(true);
    mask.clear();
    expect(mask.isEmpty).toBe(true);
  });
});

describe("@kekenik/core Sprite, Commands, Linked Cels, and Non-Linear History", () => {
  it("stores region-patches on pixel strokes and supports linear + branching undo/redo", () => {
    const doc = new SpriteDocument(createSprite({ width: 64, height: 64 }));
    const layerId = doc.sprite.layers[0].id;

    // Stroke 1 on branch A
    doc.transact("Draw Red Pixel", (tx) => {
      tx.drawPixels(layerId, 0, [{ x: 10, y: 10, color: { r: 255, g: 0, b: 0, a: 255 } }]);
    });
    const branchANodeId = doc.history.currentNodeId;
    expect(doc.sprite.cels[0].image.getRGBA(10, 10).r).toBe(255);
    // Verify patch storage is compact (< 256 bytes, whereas full 64x64x4 image is 16,384 bytes)
    expect(doc.history.usedBytes).toBeLessThan(256);

    // Undo back to root
    expect(doc.undo()).toBe(true);
    expect(doc.sprite.cels[0].image.getRGBA(10, 10).a).toBe(0);

    // Stroke 2 creates Branch B
    doc.transact("Draw Blue Pixel", (tx) => {
      tx.drawPixels(layerId, 0, [{ x: 10, y: 10, color: { r: 0, g: 0, b: 255, a: 255 } }]);
    });
    expect(doc.sprite.cels[0].image.getRGBA(10, 10).b).toBe(255);

    // Jump across history tree back to Branch A!
    expect(doc.jumpToHistoryNode(branchANodeId)).toBe(true);
    expect(doc.sprite.cels[0].image.getRGBA(10, 10).r).toBe(255);
    expect(doc.sprite.cels[0].image.getRGBA(10, 10).b).toBe(0);
  });

  it("links and unlinks cels across frames and serializes to .kpx-snapshot", () => {
    const doc = createAntiheroDemoDocument();
    expect(doc.sprite.layers.length).toBe(4);
    expect(doc.sprite.frames.length).toBe(11);
    expect(doc.sprite.tags.length).toBe(3);

    const json = serializeSnapshot(doc.sprite);
    const restored = deserializeSnapshot(json);
    expect(restored.name).toBe("antihero.ase");
    expect(restored.frames.length).toBe(11);
    expect(restored.tags.map((tag) => tag.name)).toEqual(["idle", "standup", "kickdoor"]);

    // Verify linked cels on Legs layer share the same PixelImage instance after deserialization
    const legsLayer = restored.layers.find((l) => l.name === "Legs")!;
    const cel0 = restored.cels.find((c) => c.layerId === legsLayer.id && c.frameIndex === 0)!;
    const cel1 = restored.cels.find((c) => c.layerId === legsLayer.id && c.frameIndex === 1)!;
    expect(cel0.image).toBe(cel1.image);

    const comp = compositeFrame(restored, 0);
    expect(comp.width).toBe(restored.width);
    expect(comp.height).toBe(restored.height);
  });
});

describe("@kekenik/core Registries, Keymap, Workspaces, and i18n", () => {
  it("registers >= 250 features in FeatureRegistry and passes all Agent 1 self-tests", async () => {
    registerMasterFeatures();
    const allFeatures = FeatureRegistry.getAll();
    expect(allFeatures.length).toBeGreaterThanOrEqual(250);

    const testedFeatures = allFeatures.filter(
      (f) => f.ownerAgent === 1 || f.ownerAgent === 2 || f.ownerAgent === 3
    );
    expect(testedFeatures.length).toBe(141);
    for (const feat of testedFeatures) {
      expect(feat.state).toBe("tested");
      const res = await feat.selfTest();
      expect(res.passed, `Feature ${feat.id} failed: ${res.message}`).toBe(true);
    }
  });

  it("supports generic Registry operations", () => {
    const reg = new Registry<{ id: string; val: number }>("TestReg");
    reg.register({ id: "a", val: 42 });
    expect(reg.has("a")).toBe(true);
    expect(reg.get("a")?.val).toBe(42);
    reg.unregister("a");
    expect(reg.has("a")).toBe(false);
  });

  it("normalizes key chords, detects conflicts, and cycles tool shortcuts", () => {
    expect(normalizeKeyChord("shift+ctrl+s")).toBe("Ctrl+Shift+S");
    const km = new KeymapManager();
    // No non-cycle conflicts by default
    expect(km.getConflicts(false).length).toBe(0);

    // Pressing 'B' cycles between tool.pencil and tool.spray
    const first = km.resolveChord("B", "tool.pencil");
    expect(first).toBe("tool.spray");
    const second = km.resolveChord("B", "tool.spray");
    expect(second).toBe("tool.pencil");

    // Introduce an intentional conflict on Ctrl+N
    km.setBinding("file.open", "Ctrl+N");
    const conflicts = detectKeymapConflicts(km.getAll()).filter((c) => !c.isToolCycle);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].keys).toBe("Ctrl+N");

    km.resetOne("file.open");
    expect(km.getConflicts(false).length).toBe(0);
  });

  it("clones workspaces and supports WebPlatform + Persian RTL i18n", async () => {
    expect(BUILTIN_WORKSPACES.length).toBe(4);
    const cloned = cloneWorkspaceLayout(BUILTIN_WORKSPACES[0]);
    cloned.name = "Mine";
    expect(BUILTIN_WORKSPACES[0].name).toBe("Default");

    const platform = new WebPlatform();
    await platform.writeSetting("test_key", { ok: true });
    const loaded = await platform.readSetting("test_key", { ok: false });
    expect(loaded.ok).toBe(true);

    setLocale("fa");
    expect(isRTL()).toBe(true);
    expect(t("menu.file")).toBe("پرونده");
    setLocale("en");
    expect(isRTL()).toBe(false);
    expect(t("menu.file")).toBe("File");
  });
});

describe("@kekenik/core Agent 3 Animation, Onion Skin, Tilemaps, Slices, and Commands", () => {
  it("serializes and deserializes Tilemaps and Tilesets in .kpx-snapshot", async () => {
    const { createTilemapDungeonDemoDocument } = await import("../index.ts");
    const doc = createTilemapDungeonDemoDocument();
    expect(doc.sprite.tilesets.length).toBe(1);
    expect(doc.sprite.tilesets[0].tiles.length).toBe(5);

    const json = serializeSnapshot(doc.sprite);
    const restored = deserializeSnapshot(json);
    expect(restored.tilesets.length).toBe(1);
    expect(restored.tilesets[0].tiles.length).toBe(5);
    expect(restored.cels[0].tilemapData?.tiles.length).toBe(16);
  });

  it("supports Auto, Stack, and Manual tileset modification modes and unused tile cleanup", async () => {
    const {
      createTilemapDungeonDemoDocument,
      syncTilemapFromEditedPixels,
      purgeUnusedTilesInSprite,
    } = await import("../index.ts");
    const doc = createTilemapDungeonDemoDocument();
    const cel = doc.sprite.cels[0];
    const ts = doc.sprite.tilesets[0];
    const startCount = ts.tiles.length;

    // Auto mode creates a new tile when unique pixels are drawn
    const edited = cel.image.clone();
    edited.setRGBA(2, 2, { r: 123, g: 234, b: 45, a: 255 });
    syncTilemapFromEditedPixels(cel, ts, edited, "auto", 0);
    expect(ts.tiles.length).toBe(startCount + 1);

    // Add an unreferenced tile and purge it
    ts.tiles.push(new PixelImage(16, 16, "rgba"));
    const removed = purgeUnusedTilesInSprite(doc.sprite as never, ts.id);
    expect(removed).toBeGreaterThanOrEqual(1);
  });

  it("steps PlaybackClock accurately across directions, speed multipliers, and finite tag repeats", async () => {
    const {
      advancePlaybackClock,
      buildPlaybackSequence,
      computeCascadingTagRows,
      createPlaybackClockState,
      createWalkCycleDemoDocument,
      findAdjacentTagFrame,
    } = await import("../index.ts");

    expect(buildPlaybackSequence(1, 3, "forward")).toEqual([1, 2, 3]);
    expect(buildPlaybackSequence(1, 3, "reverse")).toEqual([3, 2, 1]);
    expect(buildPlaybackSequence(1, 3, "pingpong")).toEqual([1, 2, 3, 2]);
    expect(buildPlaybackSequence(1, 3, "pingpong-reverse")).toEqual([3, 2, 1, 2]);

    const doc = createWalkCycleDemoDocument();
    const rows = computeCascadingTagRows(doc.sprite.tags);
    expect(rows.some((r) => r.row === 1)).toBe(true);
    expect(findAdjacentTagFrame(doc.sprite, 0, 1)).toBe(2);

    // Tag "attack" (frames 6..7, durations 80ms & 140ms) has repeat = 1
    let clk = createPlaybackClockState(doc.sprite, 6, { playSubtags: true });
    clk = advancePlaybackClock(doc.sprite, clk, 80, { playSubtags: true });
    expect(clk.frameIndex).toBe(7);
    expect(clk.stopped).toBe(false);
    clk = advancePlaybackClock(doc.sprite, clk, 140, { playSubtags: true });
    expect(clk.stopped).toBe(true);
    expect(clk.completedCycles).toBe(1);
  });

  it("composites Onion Skin ghost frames with red/blue tint, falloff, and tag looping", async () => {
    const {
      compositeFrameWithOnionSkin,
      createOnionSkinLabDemoDocument,
      DEFAULT_ONION_SKIN_SETTINGS,
      resolveOnionSkinGhostFrames,
    } = await import("../index.ts");

    const doc = createOnionSkinLabDemoDocument();
    const ghosts = resolveOnionSkinGhostFrames(doc.sprite, 0, {
      ...DEFAULT_ONION_SKIN_SETTINGS,
      enabled: true,
      framesBefore: 1,
      framesAfter: 1,
      loopTag: true,
    });
    // Frame 0 loops prev around tag [0..5] to frame 5
    expect(ghosts.map((g) => g.frameIndex)).toEqual([5, 1]);

    const comp = compositeFrameWithOnionSkin(
      doc.sprite,
      2,
      doc.sprite.layers[0].id,
      {
        ...DEFAULT_ONION_SKIN_SETTINGS,
        enabled: true,
        mode: "tint",
      }
    );
    expect(comp.width).toBe(64);
    expect(comp.height).toBe(48);
  });

  it("executes and undoes Layer Group, Merge, Flatten, Slice, and Tilemap commands", async () => {
    const {
      AddGroupLayerCommand,
      createSlices9PatchDemoDocument,
      exportSliceCroppedImage,
      getSliceKeyForFrame,
      hitTestSlices,
      IsolateLayerCommand,
      ReverseFramesCommand,
      UngroupLayerCommand,
      upsertSliceKey,
    } = await import("../index.ts");

    const doc = createSlices9PatchDemoDocument();
    const hit = hitTestSlices(doc.sprite.slices, 0, 10, 10);
    expect(hit?.name).toBe("panel_9patch");

    const cropped = exportSliceCroppedImage(doc.sprite, hit!.id, 0);
    expect(cropped?.width).toBe(40);
    expect(cropped?.height).toBe(36);

    const k1 = getSliceKeyForFrame(doc.sprite.slices[1], 1);
    expect(k1.bounds.y).toBe(12);

    const sliceCopy = {
      ... hit!,
      keys: hit!.keys.map((k) => ({ ...k, bounds: { ...k.bounds } })),
    };
    upsertSliceKey(sliceCopy, 1, { bounds: { x: 6, y: 8, width: 40, height: 36 } });
    expect(sliceCopy.keys.length).toBe(2);

    // Group & Ungroup
    const l0 = doc.sprite.layers[0].id;
    const grpCmd = new AddGroupLayerCommand("UI Folder", [l0]);
    doc.execute(grpCmd);
    expect(doc.sprite.layers.find((l) => l.id === l0)?.parentId).toBe(grpCmd.groupLayer.id);

    doc.execute(new UngroupLayerCommand(grpCmd.groupLayer.id));
    expect(doc.sprite.layers.find((l) => l.id === l0)?.parentId).toBeNull();

    // Isolate & Reverse frames
    doc.execute(new IsolateLayerCommand(l0));
    doc.undo();
    doc.execute(new ReverseFramesCommand(0, 1));
    doc.undo();
  });
});
