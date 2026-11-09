import { describe, expect, it } from "vitest";
import {
  BUILTIN_WORKSPACES,
  CENTER_TOKEN,
  closeFloating,
  closePanel,
  computeDropZone,
  computeEdgeSnap,
  computeRects,
  containsCenter,
  createDockState,
  dockBack,
  dockFloating,
  dockPanel,
  dockedPanels,
  dropHighlightRect,
  ensureDock,
  findNode,
  findTabsOfPanel,
  floatPanel,
  floatTabs,
  hideSlot,
  isSlotVisible,
  legacyToDock,
  listSplits,
  listTabs,
  nodeSignature,
  normalizeDock,
  openPanel,
  panelLocation,
  parseDock,
  reorderTab,
  serializeDock,
  setActiveTab,
  setChildSize,
  showSlot,
  structure,
  tearOffFromFloating,
  updateFloating,
  validateDock,
  type DockNode,
  type DockState,
} from "../index.ts";

/** Default-like layout: [left col(cb, cp)] [center] [right tabs(layers,history)] over bottom tabs(timeline,log). */
function sample(): DockState {
  const tabs = (id: string, panels: string[], role: string) => ({ kind: "tabs" as const, id, panels, active: panels[0], role });
  const root: DockNode = {
    kind: "split",
    id: "root",
    dir: "column",
    sizes: ["flex", 180],
    children: [
      {
        kind: "split",
        id: "upper",
        dir: "row",
        sizes: [160, "flex", 250],
        children: [
          {
            kind: "split",
            id: "leftcol",
            dir: "column",
            sizes: ["flex", 190],
            children: [tabs("tcb", ["cb"], "left"), tabs("tcp", ["cp"], "left")],
          },
          { kind: "center", id: "center" },
          tabs("tright", ["layers", "history", "brushes"], "right"),
        ],
      },
      tabs("tbottom", ["timeline", "log"], "bottom"),
    ],
  };
  return createDockState(root);
}

describe("layout tree: basics", () => {
  it("1. signature of center and tabs nodes", () => {
    const s = sample();
    expect(nodeSignature(findNode(s.root, "center")!)).toEqual([CENTER_TOKEN]);
    expect(nodeSignature(findNode(s.root, "tright")!)).toEqual(["brushes", "history", "layers"]);
  });
  it("2. root contains the center and lists docked panels", () => {
    const s = sample();
    expect(containsCenter(s.root)).toBe(true);
    expect(dockedPanels(s).sort()).toEqual(["brushes", "cb", "cp", "history", "layers", "log", "timeline"]);
  });
  it("3. panelLocation reports docked / floating / closed", () => {
    const s = floatPanel(sample(), "layers");
    expect(panelLocation(s, "cb")).toBe("docked");
    expect(panelLocation(s, "layers")).toBe("floating");
    expect(panelLocation(s, "nope")).toBe("closed");
  });
  it("4. exactly one flex child per split after normalize", () => {
    const s = normalizeDock(sample());
    for (const sp of listSplits(s.root)) expect(sp.sizes.filter((x) => x === "flex")).toHaveLength(1);
  });
  it("5. flex child of the upper split is the one containing the center", () => {
    const up = findNode(sample().root, "upper");
    expect(up && up.kind === "split" && up.sizes[1]).toBe("flex");
  });
});

describe("layout tree: float + reflow", () => {
  it("6. floating a tab among several keeps the group and creates a float window", () => {
    const s = floatPanel(sample(), "history");
    expect(findTabsOfPanel(s, "history")).toBeNull();
    expect(findTabsOfPanel(s, "layers")!.panels).toEqual(["layers", "brushes"]);
    expect(s.floating).toHaveLength(1);
    expect(s.floating[0].panels).toEqual(["history"]);
  });
  it("7. floating the active tab activates a neighbour", () => {
    const s = floatPanel(sample(), "layers");
    expect(findTabsOfPanel(s, "history")!.active).toBe("history");
  });
  it("8. floating the sole panel of a fixed-size group makes the flex neighbour expand", () => {
    const before = computeRects(sample(), 1280, 720);
    const s = floatPanel(sample(), "timeline");
    // timeline & log are one group: float both separately.
    const s2 = floatPanel(s, "log");
    const after = computeRects(s2, 1280, 720);
    expect(after["upper"].height).toBeGreaterThan(before["upper"].height);
    expect(after["upper"].height).toBe(720);
  });
  it("9. when the last panel of a split floats, the split collapses (no orphan splitter)", () => {
    const s = floatPanel(sample(), "cp");
    expect(findNode(s.root, "leftcol")).toBeNull(); // collapsed into the single remaining child
    expect(findNode(s.root, "tcb")).not.toBeNull();
    const rects = computeRects(s, 1280, 720);
    expect(rects["tcb"].height).toBe(rects["upper"].height); // fills the vacated space (536px)
    expect(rects["upper"].height).toBe(536);
  });
  it("10. floating the flex neighbour promotes the other child to flex", () => {
    const s = floatPanel(sample(), "cb"); // cb was flex in leftcol
    const t = findNode(s.root, "tcp");
    expect(t).not.toBeNull();
    const rects = computeRects(s, 1280, 720);
    expect(rects["tcp"].height).toBe(rects["upper"].height); // cp fills the left column
  });
  it("11. floating the entire right group lets the center expand to the right edge", () => {
    const before = computeRects(sample(), 1280, 720);
    const s = floatTabs(sample(), "tright");
    const after = computeRects(s, 1280, 720);
    expect(after["center"].width).toBeGreaterThan(before["center"].width);
    expect(after["center"].x + after["center"].width).toBe(1280);
  });
  it("12. float records memory (side) with signature of sibling", () => {
    const s = floatTabs(sample(), "tright");
    expect(s.floating[0].memory!.kind).toBe("side");
    expect(s.floating[0].memory!.siblingSig).toContain(CENTER_TOKEN);
  });
  it("13. float of a group tab records memory kind 'tab'", () => {
    const s = floatPanel(sample(), "history");
    expect(s.floating[0].memory!.kind).toBe("tab");
    expect(s.floating[0].memory!.tabIndex).toBe(1);
  });
  it("14. float rect is used verbatim (min-clamped)", () => {
    const s = floatPanel(sample(), "layers", { x: 300, y: 200, width: 320, height: 240 });
    expect(s.floating[0]).toMatchObject({ x: 300, y: 200, width: 320, height: 240 });
  });
  it("15. float of non-docked panel is a no-op", () => {
    const s = floatPanel(sample(), "ghost");
    expect(s.floating).toHaveLength(0);
  });
  it("16. floating everything but the center keeps a valid tree", () => {
    let s = sample();
    for (const p of ["cb", "cp", "layers", "history", "brushes", "timeline", "log"]) s = floatPanel(s, p);
    expect(s.root.kind).toBe("center");
    expect(s.floating).toHaveLength(7);
  });
});

describe("layout tree: dock back restores exactly", () => {
  const roundTrip = (panel: string, whole = false, tabsId = ""): void => {
    const orig = sample();
    const floated = whole ? floatTabs(orig, tabsId) : floatPanel(orig, panel);
    const back = dockBack(floated, floated.floating[0].id);
    expect(back.floating).toHaveLength(0);
    expect(structure(back.root)).toEqual(structure(orig.root));
  };
  it("17. tab inside a group", () => roundTrip("history"));
  it("18. first tab inside a group", () => roundTrip("layers"));
  it("19. last tab inside a group", () => roundTrip("brushes"));
  it("20. right group (side of center row)", () => roundTrip("", true, "tright"));
  it("21. bottom group (wraps root)", () => roundTrip("", true, "tbottom"));
  it("22. left stacked group member", () => roundTrip("cp"));
  it("23. flex member of the left column", () => roundTrip("cb"));
  it("24. dock back reuses original node ids", () => {
    const orig = sample();
    const f = floatTabs(orig, "tbottom");
    const back = dockBack(f, f.floating[0].id);
    expect(findNode(back.root, "tbottom")).not.toBeNull();
    expect(findNode(back.root, "root")).not.toBeNull();
  });
  it("25. dock back when the anchor vanished falls back to the right edge", () => {
    let s = floatTabs(sample(), "tright");
    const id = s.floating[0].id;
    s = { ...s, floating: s.floating.map((f) => ({ ...f, memory: { ...f.memory!, siblingSig: ["gone"] } })) };
    const back = dockBack(s, id);
    expect(panelLocation(back, "layers")).toBe("docked");
  });
  it("26. floating two panels then docking both back in reverse restores", () => {
    const orig = sample();
    let s = floatPanel(orig, "timeline");
    s = floatPanel(s, "log");
    s = dockBack(s, s.floating[1].id);
    s = dockBack(s, s.floating[0].id);
    expect(dockedPanels(s).sort()).toEqual(dockedPanels(orig).sort());
    expect(s.floating).toHaveLength(0);
  });
});

describe("layout tree: docking targets", () => {
  it("27. dock as tab into another group", () => {
    const s = dockPanel(sample(), "cb", { kind: "tab", tabsId: "tright" });
    expect(findTabsOfPanel(s, "cb")!.id).toBe("tright");
    expect(findTabsOfPanel(s, "cb")!.active).toBe("cb");
  });
  it("28. dock to the left side of a group splits in a row", () => {
    const s = dockPanel(sample(), "timeline", { kind: "side", tabsId: "tright", side: "left" });
    const t = findTabsOfPanel(s, "timeline")!;
    const kids = listTabs(s.root);
    expect(kids.some((k) => k.id === t.id)).toBe(true);
    const rects = computeRects(s, 1280, 720);
    expect(rects[t.id].x).toBeLessThan(rects["tright"].x);
    expect(rects[t.id].y).toBe(rects["tright"].y);
  });
  it("29. dock above another group creates a column split", () => {
    const s = dockPanel(sample(), "log", { kind: "side", tabsId: "tcb", side: "top" });
    const rects = computeRects(s, 1280, 720);
    const t = findTabsOfPanel(s, "log")!;
    expect(rects[t.id].y).toBeLessThan(rects["tcb"].y);
    expect(rects[t.id].x).toBe(rects["tcb"].x);
  });
  it("30. dock below another group", () => {
    const s = dockPanel(sample(), "cb", { kind: "side", tabsId: "tbottom", side: "bottom" });
    const rects = computeRects(s, 1280, 720);
    const t = findTabsOfPanel(s, "cb")!;
    expect(rects[t.id].y).toBeGreaterThan(rects["tbottom"].y);
  });
  it("31. dock to window edge (left) puts the group at x=0", () => {
    const s = dockPanel(sample(), "history", { kind: "edge", edge: "left" });
    const t = findTabsOfPanel(s, "history")!;
    expect(computeRects(s, 1280, 720)[t.id].x).toBe(0);
  });
  it("32. dock to window edge (top) spans the full width", () => {
    const s = dockPanel(sample(), "history", { kind: "edge", edge: "top" });
    const t = findTabsOfPanel(s, "history")!;
    const r = computeRects(s, 1280, 720)[t.id];
    expect(r.y).toBe(0);
    expect(r.width).toBe(1280);
  });
  it("33. dock to bottom edge and right edge", () => {
    const s = dockPanel(dockPanel(sample(), "cb", { kind: "edge", edge: "right" }), "cp", { kind: "edge", edge: "bottom" });
    const r1 = computeRects(s, 1280, 720)[findTabsOfPanel(s, "cb")!.id];
    expect(r1.x + r1.width).toBe(1280);
    const r2 = computeRects(s, 1280, 720)[findTabsOfPanel(s, "cp")!.id];
    expect(r2.y + r2.height).toBe(720);
  });
  it("34. dropping a lone panel on its own group is a no-op", () => {
    const s = dockPanel(sample(), "cb", { kind: "side", tabsId: "tcb", side: "left" });
    expect(structure(s.root)).toEqual(structure(sample().root));
  });
  it("35. dock a floating panel into a tab group", () => {
    const f = floatPanel(sample(), "cb");
    const s = dockPanel(f, "cb", { kind: "tab", tabsId: "tbottom" });
    expect(s.floating).toHaveLength(0);
    expect(findTabsOfPanel(s, "cb")!.id).toBe("tbottom");
  });
  it("36. dockFloating docks a multi-tab window as a group", () => {
    const f = floatTabs(sample(), "tbottom");
    const s = dockFloating(f, f.floating[0].id, { kind: "side", tabsId: "tright", side: "bottom" });
    expect(findTabsOfPanel(s, "timeline")!.panels).toEqual(["timeline", "log"]);
    expect(s.floating).toHaveLength(0);
  });
  it("37. dock of a closed panel works", () => {
    const s = dockPanel(sample(), "preview", { kind: "tab", tabsId: "tright" });
    expect(panelLocation(s, "preview")).toBe("docked");
  });
  it("38. a panel never exists twice", () => {
    const s = dockPanel(sample(), "layers", { kind: "tab", tabsId: "tbottom" });
    expect(dockedPanels(s).filter((p) => p === "layers")).toHaveLength(1);
  });
});

describe("layout tree: tabs, sizes, visibility", () => {
  it("39. setActiveTab / reorderTab", () => {
    let s = setActiveTab(sample(), "tright", "brushes");
    expect(findTabsOfPanel(s, "brushes")!.active).toBe("brushes");
    s = reorderTab(s, "brushes", 0);
    expect(findTabsOfPanel(s, "brushes")!.panels[0]).toBe("brushes");
  });
  it("40. setChildSize resizes a fixed child and the flex child compensates", () => {
    const s = setChildSize(sample(), "upper", 2, 320);
    const r = computeRects(s, 1280, 720);
    expect(r["tright"].width).toBe(320);
    expect(r["center"].width).toBe(1280 - 160 - 320 - 8);
  });
  it("41. setChildSize ignores the flex child", () => {
    const s = setChildSize(sample(), "upper", 1, 999);
    expect(structure(s.root)).toEqual(structure(sample().root));
  });
  it("42. computeRects clamps fixed sizes so the flex child keeps its minimum", () => {
    const r = computeRects(sample(), 400, 300);
    expect(r["center"].width).toBeGreaterThanOrEqual(110);
  });
  it("43. hideSlot / showSlot toggles a role", () => {
    let s = hideSlot(sample(), "bottom");
    expect(isSlotVisible(s, "bottom")).toBe(false);
    expect(panelLocation(s, "timeline")).toBe("closed");
    s = showSlot(s, "bottom");
    expect(isSlotVisible(s, "bottom")).toBe(true);
    expect(panelLocation(s, "timeline")).toBe("docked");
  });
  it("44. openPanel opens closed panels into a role group, focuses visible ones", () => {
    const s = openPanel(sample(), "tileset", "right");
    expect(findTabsOfPanel(s, "tileset")!.id).toBe("tright");
    const s2 = openPanel(s, "history", "right");
    expect(findTabsOfPanel(s2, "history")!.active).toBe("history");
  });
  it("45. openPanel creates the dock when the role is hidden", () => {
    const s = openPanel(hideSlot(sample(), "right"), "layers", "right");
    expect(isSlotVisible(s, "right")).toBe(true);
  });
  it("46. openPanel floating creates a floating window", () => {
    expect(openPanel(sample(), "preview", "floating").floating[0].panels).toEqual(["preview"]);
  });
  it("47. closePanel removes docked and floating panels", () => {
    const f = floatPanel(sample(), "cb");
    expect(panelLocation(closePanel(f, "cb"), "cb")).toBe("closed");
    expect(panelLocation(closePanel(sample(), "log"), "log")).toBe("closed");
  });
});

describe("layout tree: floating windows", () => {
  it("48. updateFloating moves / resizes / maximizes", () => {
    const f = floatPanel(sample(), "cb");
    const s = updateFloating(f, f.floating[0].id, { x: 5, y: 6, maximized: true });
    expect(s.floating[0]).toMatchObject({ x: 5, y: 6, maximized: true });
  });
  it("49. tearOffFromFloating splits a tab out of a floating window", () => {
    const f = floatTabs(sample(), "tright");
    const s = tearOffFromFloating(f, f.floating[0].id, "history");
    expect(s.floating).toHaveLength(2);
    expect(s.floating[0].panels).toEqual(["layers", "brushes"]);
  });
  it("50. closeFloating discards the window", () => {
    const f = floatPanel(sample(), "cb");
    expect(closeFloating(f, f.floating[0].id).floating).toHaveLength(0);
  });
});

describe("layout tree: drop zones", () => {
  const rect = { x: 0, y: 0, width: 400, height: 300 };
  it("51. five zones: center is tab", () => expect(computeDropZone(rect, 200, 150)).toBe("tab"));
  it("52. left / right / top / bottom strips", () => {
    expect(computeDropZone(rect, 10, 150)).toBe("left");
    expect(computeDropZone(rect, 390, 150)).toBe("right");
    expect(computeDropZone(rect, 200, 5)).toBe("top");
    expect(computeDropZone(rect, 200, 295)).toBe("bottom");
  });
  it("53. corner picks the nearest edge", () => {
    expect(computeDropZone(rect, 4, 40)).toBe("left");
    expect(computeDropZone(rect, 60, 3)).toBe("top");
  });
  it("54. edge snapping within 18px of window boundary", () => {
    const area = { x: 0, y: 0, width: 1000, height: 600 };
    expect(computeEdgeSnap(area, 5, 300)).toBe("left");
    expect(computeEdgeSnap(area, 995, 300)).toBe("right");
    expect(computeEdgeSnap(area, 500, 590)).toBe("bottom");
    expect(computeEdgeSnap(area, 500, 300)).toBeNull();
  });
  it("55. highlight rects are halves for sides and full for tab", () => {
    expect(dropHighlightRect(rect, "left").width).toBe(200);
    expect(dropHighlightRect(rect, "bottom").y).toBe(150);
    expect(dropHighlightRect(rect, "tab")).toEqual(rect);
  });
});

describe("layout tree: validation, persistence, migration", () => {
  it("56. validateDock rescues off-screen floating windows to the primary monitor", () => {
    const f = floatPanel(sample(), "cb", { x: 9000, y: 9000, width: 300, height: 200 });
    const v = validateDock(f, { width: 1280, height: 720, monitorKey: "m1" });
    expect(v.floating[0].x).toBeLessThan(1280);
    expect(v.floating[0].y).toBeLessThan(720);
    expect(v.floating[0].monitorKey).toBe("m1");
  });
  it("57. validateDock removes duplicate panels", () => {
    const s = sample();
    const bad = { ...s, floating: [{ id: "fx", panels: ["layers"], active: "layers", x: 10, y: 10, width: 200, height: 100, minimized: false, maximized: false }] };
    const v = validateDock(bad as DockState, { width: 800, height: 600 });
    expect(panelLocation(v, "layers")).toBe("docked");
    expect(v.floating).toHaveLength(0);
  });
  it("58. serialize / parse round trips", () => {
    const s = floatPanel(sample(), "history");
    const p = parseDock(serializeDock(s))!;
    expect(structure(p.root)).toEqual(structure(s.root));
    expect(p.floating).toHaveLength(1);
  });
  it("59. parseDock rejects garbage and center-less trees", () => {
    expect(parseDock("{")).toBeNull();
    expect(parseDock(JSON.stringify({ version: 2, root: { kind: "tabs", id: "x", panels: ["a"], active: "a" }, floating: [] }))).toBeNull();
  });
  it("60. legacy Default workspace migrates: bottom timeline, left stack, hidden right panels, floating preview", () => {
    const d = legacyToDock(BUILTIN_WORKSPACES[0] as never);
    expect(panelLocation(d, "panel.timeline")).toBe("docked");
    expect(panelLocation(d, "panel.colorbar")).toBe("docked");
    expect(panelLocation(d, "panel.preview")).toBe("floating");
    expect(isSlotVisible(d, "right")).toBe(false);
    expect(d.hidden.right).toContain("panel.layers");
    expect(containsCenter(d.root)).toBe(true);
  });
  it("61. every built-in workspace migrates with no duplicate panels", () => {
    for (const w of BUILTIN_WORKSPACES) {
      const d = ensureDock(w as never);
      const all = [...dockedPanels(d), ...d.floating.flatMap((f) => f.panels)];
      expect(new Set(all).size).toBe(all.length);
    }
  });
  it("62. ensureDock is idempotent for v2 layouts", () => {
    const d = legacyToDock(BUILTIN_WORKSPACES[1] as never);
    expect(ensureDock({ ...(BUILTIN_WORKSPACES[1] as never as object), dock: d } as never)).toBe(d);
  });
  it("63. float → reflow → dock back on a migrated Animation workspace is lossless", () => {
    const d = legacyToDock(BUILTIN_WORKSPACES[1] as never);
    const target = listTabs(d.root).find((t) => t.panels.includes("panel.tags"))!;
    const f = floatTabs(d, target.id);
    const back = dockBack(f, f.floating[f.floating.length - 1].id);
    expect(structure(back.root)).toEqual(structure(d.root));
  });
});
