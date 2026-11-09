/**
 * Dock layout tree (PanelLayout v2) — pure TypeScript, no DOM.
 *
 * The window is described by a tree of `split` nodes (row / column), `tabs` nodes (a tab group of panels)
 * and exactly one `center` node (the document canvas area). Floating windows live beside the tree.
 *
 * Sizing model: every child of a split has a size spec — a pixel number, or `"flex"`. Exactly one child of
 * each split is `"flex"` (preferably the one that contains the center). The flex child absorbs all remaining
 * space, so removing / floating any fixed child makes the flex neighbour expand immediately, and removing
 * the flex child promotes a neighbour to flex. Splits with a single child collapse into their parent.
 *
 * All operations are pure: they take a `DockState` and return a new one.
 */

/** Orientation of a split. `row` lays children out left→right, `column` top→bottom. */
export type DockDir = "row" | "column";
/** A side of a node or of the main window. */
export type DockSide = "top" | "bottom" | "left" | "right";
/** Pixel size or "flex" (takes the remaining space). */
export type SizeSpec = number | "flex";

/** The document-canvas slot. Exactly one exists in every valid tree. */
export interface CenterNode {
  kind: "center";
  id: string;
}
/** A tab group of one or more panels. */
export interface TabsNode {
  kind: "tabs";
  id: string;
  panels: string[];
  active: string;
  /** Optional semantic role (left/right/bottom) used to place newly opened panels. */
  role?: string;
}
/** A container laying children out in a row or column. */
export interface SplitNode {
  kind: "split";
  id: string;
  dir: DockDir;
  children: DockNode[];
  sizes: SizeSpec[];
}
export type DockNode = CenterNode | TabsNode | SplitNode;

/** Where a floated panel / group came from, so "Dock back" can restore the exact layout. */
export interface DockMemory {
  kind: "tab" | "side" | "edge" | "none";
  /** Id of the tabs node the panels were removed from (restored when possible). */
  tabsId: string;
  /** Id of the split that collapsed when the panels were removed (reused on re-wrap). */
  splitId: string;
  /** Panel-set signature of the remaining sibling node (see {@link nodeSignature}). */
  siblingSig: string[];
  /** For `side`: whether the removed node sat before or after the sibling. */
  position: "before" | "after";
  dir: DockDir;
  selfSize: SizeSpec;
  siblingSize: SizeSpec;
  /** For `tab`: index inside the tab group. */
  tabIndex: number;
  activeBefore: boolean;
  role?: string;
  /** For `edge`: which window edge. */
  edge?: DockSide;
}

/** A floating window containing one or more tabbed panels. */
export interface FloatingWindowState {
  id: string;
  panels: string[];
  active: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  memory?: DockMemory;
  /** Opaque key describing the monitor configuration the position was stored for. */
  monitorKey?: string;
}

/** Complete dock layout (v2). */
export interface DockState {
  version: 2;
  root: DockNode;
  floating: FloatingWindowState[];
  /** Panels hidden by "hide dock" per role (restored by showSlot). */
  hidden: Record<string, string[]>;
  nextId: number;
}

/** A drop target: a tab group (tab or one of its four sides) or a window edge. */
export type DropTarget =
  | { kind: "tab"; tabsId: string }
  | { kind: "side"; tabsId: string; side: DockSide }
  | { kind: "edge"; edge: DockSide };

/** Rectangle in pixels. */
export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Thickness of splitters in px. */
export const SPLITTER_PX = 4;
/** Minimum docked-panel width / height in px. */
export const MIN_PANEL_W = 110;
export const MIN_PANEL_H = 70;
/** Default size of a newly docked group. */
export const DEFAULT_DOCK_PX = 200;
/** Special panel-set token for the center node. */
export const CENTER_TOKEN = "@center";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deep clone of a dock state. */
export function cloneDock(state: DockState): DockState {
  return JSON.parse(JSON.stringify(state)) as DockState;
}

function newId(state: DockState, prefix: string): string {
  state.nextId += 1;
  return `${prefix}${state.nextId}`;
}

/** Sorted list of panel ids (plus `@center`) contained in a node: its identity for restore. */
export function nodeSignature(node: DockNode): string[] {
  const out: string[] = [];
  const walk = (n: DockNode): void => {
    if (n.kind === "center") out.push(CENTER_TOKEN);
    else if (n.kind === "tabs") out.push(...n.panels);
    else n.children.forEach(walk);
  };
  walk(node);
  return out.sort();
}

function sameSig(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** True when the node subtree contains the center. */
export function containsCenter(node: DockNode): boolean {
  if (node.kind === "center") return true;
  if (node.kind === "tabs") return false;
  return node.children.some(containsCenter);
}

/** Collects every tabs node in tree order. */
export function listTabs(root: DockNode): TabsNode[] {
  const out: TabsNode[] = [];
  const walk = (n: DockNode): void => {
    if (n.kind === "tabs") out.push(n);
    else if (n.kind === "split") n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** Collects every split node in tree order. */
export function listSplits(root: DockNode): SplitNode[] {
  const out: SplitNode[] = [];
  const walk = (n: DockNode): void => {
    if (n.kind === "split") {
      out.push(n);
      n.children.forEach(walk);
    }
  };
  walk(root);
  return out;
}

/** Finds a node by id. */
export function findNode(root: DockNode, id: string): DockNode | null {
  if (root.id === id) return root;
  if (root.kind === "split") {
    for (const c of root.children) {
      const f = findNode(c, id);
      if (f) return f;
    }
  }
  return null;
}

/** Finds the parent split of a node id (null for the root or unknown ids). */
export function findParent(root: DockNode, id: string): SplitNode | null {
  if (root.kind !== "split") return null;
  for (const c of root.children) {
    if (c.id === id) return root;
    const f = findParent(c, id);
    if (f) return f;
  }
  return null;
}

/** Returns every docked panel id. */
export function dockedPanels(state: DockState): string[] {
  return listTabs(state.root).flatMap((t) => t.panels);
}

/** Where a panel currently lives. */
export function panelLocation(state: DockState, panelId: string): "docked" | "floating" | "closed" {
  if (dockedPanels(state).includes(panelId)) return "docked";
  if (state.floating.some((f) => f.panels.includes(panelId))) return "floating";
  return "closed";
}

/** Finds the tabs node holding a panel. */
export function findTabsOfPanel(state: DockState, panelId: string): TabsNode | null {
  return listTabs(state.root).find((t) => t.panels.includes(panelId)) ?? null;
}

// ---------------------------------------------------------------------------
// Normalisation (collapse + flex invariant)
// ---------------------------------------------------------------------------

function mergeSameDir(split: SplitNode): void {
  // Splice child splits of the same direction into the parent.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < split.children.length; i++) {
      const c = split.children[i];
      if (c.kind === "split" && c.dir === split.dir) {
        const slot = split.sizes[i];
        const inner = c.sizes.slice();
        const flexIdx = inner.indexOf("flex");
        if (slot !== "flex" && flexIdx >= 0) {
          const others = inner.reduce<number>((s, v) => s + (v === "flex" ? 0 : v), 0);
          inner[flexIdx] = Math.max(MIN_PANEL_H, slot - others);
        }
        split.children.splice(i, 1, ...c.children);
        split.sizes.splice(i, 1, ...inner);
        changed = true;
        break;
      }
    }
  }
}

function normalizeNode(node: DockNode): DockNode | null {
  if (node.kind === "center") return node;
  if (node.kind === "tabs") {
    if (node.panels.length === 0) return null;
    if (!node.panels.includes(node.active)) node.active = node.panels[0];
    return node;
  }
  const kids: DockNode[] = [];
  const sizes: SizeSpec[] = [];
  node.children.forEach((c, i) => {
    const n = normalizeNode(c);
    if (n) {
      kids.push(n);
      sizes.push(node.sizes[i] ?? "flex");
    } else if (node.sizes[i] === "flex") {
      // The flex child vanished: remember so a neighbour can be promoted below.
      sizes.push("flex");
      kids.push({ kind: "tabs", id: "__removed__", panels: [], active: "" });
    }
  });
  // Drop placeholders but promote flex to nearest neighbour.
  const finalKids: DockNode[] = [];
  const finalSizes: SizeSpec[] = [];
  let promote = false;
  kids.forEach((k, i) => {
    if (k.id === "__removed__") {
      promote = true;
      return;
    }
    finalKids.push(k);
    finalSizes.push(sizes[i]);
  });
  if (finalKids.length === 0) return null;
  node.children = finalKids;
  node.sizes = finalSizes;
  if (promote && !node.sizes.includes("flex")) {
    // Prefer the child containing center, else the last child.
    const ci = node.children.findIndex(containsCenter);
    node.sizes[ci >= 0 ? ci : node.children.length - 1] = "flex";
  }
  if (node.children.length === 1) return node.children[0];
  mergeSameDir(node);
  // Enforce exactly-one-flex.
  const centerIdx = node.children.findIndex(containsCenter);
  let flexIdx = node.sizes.indexOf("flex");
  if (centerIdx >= 0) flexIdx = centerIdx;
  else if (flexIdx < 0) flexIdx = node.children.length - 1;
  node.sizes = node.sizes.map((s, i) =>
    i === flexIdx ? "flex" : s === "flex" ? DEFAULT_DOCK_PX : s
  );
  return node;
}

/** Collapses empty groups / single-child splits and enforces the single-flex invariant. */
export function normalizeDock(state: DockState): DockState {
  const next = cloneDock(state);
  const root = normalizeNode(next.root);
  next.root = root ?? { kind: "center", id: "center" };
  if (!containsCenter(next.root)) {
    next.root = {
      kind: "split",
      id: newId(next, "s"),
      dir: "row",
      children: [{ kind: "center", id: "center" }, next.root],
      sizes: ["flex", DEFAULT_DOCK_PX],
    };
  }
  next.floating = next.floating.filter((f) => f.panels.length > 0);
  return next;
}

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

interface Removed {
  state: DockState;
  memory: DockMemory;
}

function emptyMemory(): DockMemory {
  return {
    kind: "none",
    tabsId: "",
    splitId: "",
    siblingSig: [],
    position: "after",
    dir: "row",
    selfSize: DEFAULT_DOCK_PX,
    siblingSize: "flex",
    tabIndex: 0,
    activeBefore: false,
  };
}

/** Removes a whole tabs node from the tree, recording where it was. */
function removeTabsNode(state: DockState, tabsId: string): Removed {
  const next = cloneDock(state);
  const memory = emptyMemory();
  const tabs = findNode(next.root, tabsId);
  if (!tabs || tabs.kind !== "tabs") return { state: next, memory };
  memory.tabsId = tabs.id;
  memory.role = tabs.role;
  const parent = findParent(next.root, tabsId);
  if (!parent) return { state: next, memory };
  const idx = parent.children.findIndex((c) => c.id === tabsId);
  const siblingIdx = idx + 1 < parent.children.length ? idx + 1 : idx - 1;
  const sibling = parent.children[siblingIdx];
  memory.kind = "side";
  memory.splitId = parent.id;
  memory.siblingSig = nodeSignature(sibling);
  memory.position = siblingIdx > idx ? "before" : "after";
  memory.dir = parent.dir;
  memory.selfSize = parent.sizes[idx];
  memory.siblingSize = parent.sizes[siblingIdx];
  const wasFlex = parent.sizes[idx] === "flex";
  parent.children.splice(idx, 1);
  parent.sizes.splice(idx, 1);
  if (wasFlex) {
    const si = idx < parent.children.length ? idx : parent.children.length - 1;
    parent.sizes[si] = "flex";
  }
  return { state: normalizeDock(next), memory };
}

/** Removes a single panel from its tab group (collapsing the group if it becomes empty). */
function removeDockedPanel(state: DockState, panelId: string): Removed {
  const tabs = findTabsOfPanel(state, panelId);
  if (!tabs) return { state: cloneDock(state), memory: emptyMemory() };
  if (tabs.panels.length === 1) return removeTabsNode(state, tabs.id);
  const next = cloneDock(state);
  const t = findNode(next.root, tabs.id) as TabsNode;
  const index = t.panels.indexOf(panelId);
  const memory = emptyMemory();
  memory.kind = "tab";
  memory.tabsId = t.id;
  memory.tabIndex = index;
  memory.activeBefore = t.active === panelId;
  memory.role = t.role;
  t.panels.splice(index, 1);
  memory.siblingSig = nodeSignature(t);
  if (t.active === panelId) t.active = t.panels[Math.min(index, t.panels.length - 1)];
  return { state: normalizeDock(next), memory };
}

function removeFloatingPanel(state: DockState, panelId: string): DockState {
  const next = cloneDock(state);
  for (const f of next.floating) {
    const i = f.panels.indexOf(panelId);
    if (i >= 0) {
      f.panels.splice(i, 1);
      if (f.active === panelId) f.active = f.panels[Math.min(i, f.panels.length - 1)] ?? "";
    }
  }
  next.floating = next.floating.filter((f) => f.panels.length > 0);
  return next;
}

/** Removes a panel from wherever it is (docked, floating or hidden). Returns the new state. */
export function closePanel(state: DockState, panelId: string): DockState {
  const loc = panelLocation(state, panelId);
  let next = state;
  if (loc === "docked") next = removeDockedPanel(state, panelId).state;
  else if (loc === "floating") next = removeFloatingPanel(state, panelId);
  else next = cloneDock(state);
  return next;
}

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

function sideAxis(side: DockSide): DockDir {
  return side === "left" || side === "right" ? "row" : "column";
}

function insertBeside(
  state: DockState,
  targetId: string,
  side: DockSide,
  node: DockNode,
  newSize: SizeSpec,
  targetSize?: SizeSpec,
  splitId?: string
): DockState {
  const next = cloneDock(state);
  const dir = sideAxis(side);
  const before = side === "left" || side === "top";
  const parent = findParent(next.root, targetId);
  const target = findNode(next.root, targetId);
  if (!target) return next;
  if (parent && parent.dir === dir) {
    const idx = parent.children.findIndex((c) => c.id === targetId);
    const at = before ? idx : idx + 1;
    parent.children.splice(at, 0, node);
    parent.sizes.splice(at, 0, newSize);
    const ti = parent.children.findIndex((c) => c.id === targetId);
    if (newSize === "flex") {
      // New node takes the flex role; target becomes fixed.
      parent.sizes[ti] = targetSize !== undefined && targetSize !== "flex" ? targetSize : DEFAULT_DOCK_PX;
    } else if (targetSize !== undefined) {
      parent.sizes[ti] = targetSize;
    }
    return normalizeDock(next);
  }
  const wrapperId = splitId && !findNode(next.root, splitId) ? splitId : newId(next, "s");
  const wrapper: SplitNode = {
    kind: "split",
    id: wrapperId,
    dir,
    children: before ? [node, target] : [target, node],
    sizes: [],
  };
  const tSize: SizeSpec =
    newSize === "flex"
      ? targetSize !== undefined && targetSize !== "flex"
        ? targetSize
        : DEFAULT_DOCK_PX
      : "flex";
  wrapper.sizes = before ? [newSize, tSize] : [tSize, newSize];
  if (parent) {
    const idx = parent.children.findIndex((c) => c.id === targetId);
    parent.children[idx] = wrapper;
  } else {
    next.root = wrapper;
  }
  return normalizeDock(next);
}

function newTabs(state: DockState, panels: string[], active?: string, role?: string, id?: string): TabsNode {
  const used = new Set(listTabs(state.root).map((t) => t.id));
  const tid = id && !used.has(id) ? id : newId(state, "t");
  return { kind: "tabs", id: tid, panels: panels.slice(), active: active && panels.includes(active) ? active : panels[0], role };
}

function insertAtEdge(
  state: DockState,
  edge: DockSide,
  tabs: TabsNode,
  size: SizeSpec = DEFAULT_DOCK_PX,
  splitId?: string
): DockState {
  const next = cloneDock(state);
  const dir = sideAxis(edge);
  const before = edge === "left" || edge === "top";
  const root = next.root;
  if (root.kind === "split" && root.dir === dir) {
    const at = before ? 0 : root.children.length;
    root.children.splice(at, 0, tabs);
    root.sizes.splice(at, 0, size === "flex" ? DEFAULT_DOCK_PX : size);
    return normalizeDock(next);
  }
  const wrapperId = splitId && !findNode(next.root, splitId) ? splitId : newId(next, "s");
  next.root = {
    kind: "split",
    id: wrapperId,
    dir,
    children: before ? [tabs, root] : [root, tabs],
    sizes: before ? [size === "flex" ? DEFAULT_DOCK_PX : size, "flex"] : ["flex", size === "flex" ? DEFAULT_DOCK_PX : size],
  };
  return normalizeDock(next);
}

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

/** Creates a fresh dock state from a root node. */
export function createDockState(root: DockNode, floating: FloatingWindowState[] = []): DockState {
  return normalizeDock({ version: 2, root, floating, hidden: {}, nextId: 100 });
}

/** Activates a tab. */
export function setActiveTab(state: DockState, tabsId: string, panelId: string): DockState {
  const next = cloneDock(state);
  const t = findNode(next.root, tabsId);
  if (t && t.kind === "tabs" && t.panels.includes(panelId)) t.active = panelId;
  return next;
}

/** Activates a panel wherever it is (tab group or floating window). */
export function activatePanel(state: DockState, panelId: string): DockState {
  const next = cloneDock(state);
  const t = findTabsOfPanel(next, panelId);
  if (t) t.active = panelId;
  for (const f of next.floating) if (f.panels.includes(panelId)) f.active = panelId;
  return next;
}

/** Reorders a tab inside its group. */
export function reorderTab(state: DockState, panelId: string, toIndex: number): DockState {
  const next = cloneDock(state);
  const t = findTabsOfPanel(next, panelId);
  if (!t) return next;
  const from = t.panels.indexOf(panelId);
  t.panels.splice(from, 1);
  t.panels.splice(Math.max(0, Math.min(toIndex, t.panels.length)), 0, panelId);
  return next;
}

/** Sets the fixed pixel size of one child of a split (the flex child absorbs the difference). */
export function setChildSize(state: DockState, splitId: string, childIndex: number, px: number): DockState {
  const next = cloneDock(state);
  const s = findNode(next.root, splitId);
  if (!s || s.kind !== "split" || childIndex < 0 || childIndex >= s.children.length) return next;
  if (s.sizes[childIndex] === "flex") return next;
  s.sizes[childIndex] = Math.max(1, Math.round(px));
  return next;
}

/** Default floating window rectangle (cascading near the top-left of the dock area). */
export function defaultFloatRect(state: DockState, width = 260, height = 220): LayoutRect {
  const off = (state.floating.length % 8) * 26;
  return { x: 120 + off, y: 90 + off, width, height };
}

function makeFloating(
  state: DockState,
  panels: string[],
  active: string,
  rect: LayoutRect | undefined,
  memory: DockMemory
): { state: DockState; id: string } {
  const next = cloneDock(state);
  const r = rect ?? defaultFloatRect(next);
  const id = newId(next, "f");
  next.floating.push({
    id,
    panels: panels.slice(),
    active,
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.max(160, Math.round(r.width)),
    height: Math.max(100, Math.round(r.height)),
    minimized: false,
    maximized: false,
    memory,
  });
  return { state: next, id };
}

/** Floats one panel: it leaves its dock group; the vacated space is reclaimed by the neighbours. */
export function floatPanel(state: DockState, panelId: string, rect?: LayoutRect): DockState {
  if (panelLocation(state, panelId) !== "docked") return cloneDock(state);
  const { state: removed, memory } = removeDockedPanel(state, panelId);
  return makeFloating(removed, [panelId], panelId, rect, memory).state;
}

/** Floats a whole tab group as one tabbed floating window. */
export function floatTabs(state: DockState, tabsId: string, rect?: LayoutRect): DockState {
  const tabs = findNode(state.root, tabsId);
  if (!tabs || tabs.kind !== "tabs") return cloneDock(state);
  const panels = tabs.panels.slice();
  const active = tabs.active;
  const { state: removed, memory } = removeTabsNode(state, tabsId);
  return makeFloating(removed, panels, active, rect, memory).state;
}

/** Applies a drop target for a set of panels (already detached from anywhere). */
function applyTarget(state: DockState, panels: string[], active: string, target: DropTarget): DockState {
  if (target.kind === "tab") {
    const next = cloneDock(state);
    const t = findNode(next.root, target.tabsId);
    if (!t || t.kind !== "tabs") return insertAtEdge(state, "right", newTabs(next, panels, active));
    for (const p of panels) if (!t.panels.includes(p)) t.panels.push(p);
    t.active = active;
    return next;
  }
  if (target.kind === "side") {
    const next = cloneDock(state);
    if (!findNode(next.root, target.tabsId)) return insertAtEdge(state, "right", newTabs(next, panels, active));
    const tabs = newTabs(next, panels, active);
    const parent = findParent(next.root, target.tabsId);
    const axisDir = sideAxis(target.side);
    // Splitting a fixed-size neighbour in two: give the new group half of it when possible.
    let size: SizeSpec = DEFAULT_DOCK_PX;
    if (parent && parent.dir === axisDir) {
      const i = parent.children.findIndex((c) => c.id === target.tabsId);
      const s = parent.sizes[i];
      if (s !== "flex") {
        size = Math.max(axisDir === "row" ? MIN_PANEL_W : MIN_PANEL_H, Math.round(s / 2));
        return insertBeside(next, target.tabsId, target.side, tabs, size, Math.max(1, s - size));
      }
    }
    return insertBeside(next, target.tabsId, target.side, tabs, size);
  }
  const next = cloneDock(state);
  return insertAtEdge(next, target.edge, newTabs(next, panels, active));
}

/**
 * Docks a panel (docked, floating or closed) at a target. Dropping a lone panel on its own group / side is a no-op.
 */
export function dockPanel(state: DockState, panelId: string, target: DropTarget): DockState {
  const loc = panelLocation(state, panelId);
  if (target.kind !== "edge") {
    const own = findTabsOfPanel(state, panelId);
    if (own && own.id === target.tabsId && (target.kind === "tab" || own.panels.length === 1)) {
      return setActiveTab(state, own.id, panelId);
    }
  }
  let base: DockState;
  if (loc === "docked") base = removeDockedPanel(state, panelId).state;
  else if (loc === "floating") base = removeFloatingPanel(state, panelId);
  else base = cloneDock(state);
  return applyTarget(base, [panelId], panelId, target);
}

/** Docks every panel of a floating window at a target and removes the window. */
export function dockFloating(state: DockState, floatingId: string, target: DropTarget): DockState {
  const win = state.floating.find((f) => f.id === floatingId);
  if (!win) return cloneDock(state);
  const base = cloneDock(state);
  base.floating = base.floating.filter((f) => f.id !== floatingId);
  return applyTarget(base, win.panels, win.active, target);
}

/** Restores a floating window to where it came from ("Dock back to last position"). Falls back to the right edge. */
export function dockBack(state: DockState, floatingId: string): DockState {
  const win = state.floating.find((f) => f.id === floatingId);
  if (!win) return cloneDock(state);
  const m = win.memory;
  const base = cloneDock(state);
  base.floating = base.floating.filter((f) => f.id !== floatingId);
  if (m && m.kind === "tab") {
    const tabs = listTabs(base.root).find((t) => sameSig(nodeSignature(t), m.siblingSig)) ??
      listTabs(base.root).find((t) => t.id === m.tabsId);
    if (tabs) {
      for (const p of win.panels) {
        const at = Math.min(m.tabIndex, tabs.panels.length);
        if (!tabs.panels.includes(p)) tabs.panels.splice(at, 0, p);
      }
      if (m.activeBefore || tabs.panels.length === win.panels.length) tabs.active = win.active;
      return base;
    }
  }
  if (m && m.kind === "side") {
    const sibling = findBySignature(base.root, m.siblingSig);
    if (sibling) {
      const tabs = newTabs(base, win.panels, win.active, m.role, m.tabsId);
      const side: DockSide =
        m.dir === "row" ? (m.position === "before" ? "left" : "right") : m.position === "before" ? "top" : "bottom";
      return insertBeside(base, sibling.id, side, tabs, m.selfSize, m.siblingSize, m.splitId);
    }
  }
  return openPanels(base, win.panels, win.active, m?.role);
}

function findBySignature(root: DockNode, sig: string[]): DockNode | null {
  if (sameSig(nodeSignature(root), sig)) return root;
  if (root.kind === "split") {
    for (const c of root.children) {
      const f = findBySignature(c, sig);
      if (f) return f;
    }
  }
  return null;
}

function openPanels(state: DockState, panels: string[], active: string, role?: string): DockState {
  const next = cloneDock(state);
  const group = role ? listTabs(next.root).find((t) => t.role === role) : undefined;
  if (group) {
    for (const p of panels) if (!group.panels.includes(p)) group.panels.push(p);
    group.active = active;
    return next;
  }
  const edge: DockSide = role === "left" ? "left" : role === "bottom" ? "bottom" : "right";
  const size = edge === "bottom" ? 190 : 240;
  return insertAtEdge(next, edge, newTabs(next, panels, active, role ?? "right"), size);
}

/** Opens (docks) a panel that is closed, or focuses it if already visible. `slot` = default role. */
export function openPanel(state: DockState, panelId: string, slot: "left" | "right" | "bottom" | "floating" = "right"): DockState {
  const loc = panelLocation(state, panelId);
  if (loc !== "closed") return activatePanel(state, panelId);
  const next = cloneDock(state);
  for (const k of Object.keys(next.hidden)) next.hidden[k] = next.hidden[k].filter((p) => p !== panelId);
  if (slot === "floating") {
    return makeFloating(next, [panelId], panelId, undefined, { ...emptyMemory(), kind: "edge", edge: "right", role: "right" }).state;
  }
  return openPanels(next, [panelId], panelId, slot);
}

/** Hides every tab group with `role`, remembering the panels so they can be re-shown. */
export function hideSlot(state: DockState, role: string): DockState {
  let next = cloneDock(state);
  const groups = listTabs(next.root).filter((t) => t.role === role);
  const saved: string[] = [];
  for (const g of groups) {
    saved.push(...g.panels);
    next = removeTabsNode(next, g.id).state;
  }
  next.hidden[role] = saved;
  return next;
}

/** True if a visible tab group has `role`. */
export function isSlotVisible(state: DockState, role: string): boolean {
  return listTabs(state.root).some((t) => t.role === role);
}

/** Re-shows panels hidden by {@link hideSlot} (or opens an empty-handed default). */
export function showSlot(state: DockState, role: "left" | "right" | "bottom", fallback: string[] = []): DockState {
  const panels = (state.hidden[role] ?? []).filter((p) => panelLocation(state, p) === "closed");
  const use = panels.length ? panels : fallback.filter((p) => panelLocation(state, p) === "closed");
  if (!use.length) return cloneDock(state);
  const next = openPanels(state, use, use[0], role);
  next.hidden[role] = [];
  return next;
}

/** Updates a floating window (move / resize / minimize / maximize). */
export function updateFloating(state: DockState, floatingId: string, patch: Partial<FloatingWindowState>): DockState {
  const next = cloneDock(state);
  const f = next.floating.find((x) => x.id === floatingId);
  if (f) Object.assign(f, patch, { id: f.id });
  return next;
}

/** Activates a tab in a floating window. */
export function setFloatingActive(state: DockState, floatingId: string, panelId: string): DockState {
  return updateFloating(state, floatingId, { active: panelId });
}

/** Pulls one panel out of a floating window into its own new window (tab tear-off). */
export function tearOffFromFloating(state: DockState, floatingId: string, panelId: string, rect?: LayoutRect): DockState {
  const win = state.floating.find((f) => f.id === floatingId);
  if (!win || win.panels.length < 2) return cloneDock(state);
  const base = removeFloatingPanel(state, panelId);
  return makeFloating(base, [panelId], panelId, rect, { ...emptyMemory(), kind: "edge", edge: "right" }).state;
}

/** Closes a floating window entirely (panels become closed). */
export function closeFloating(state: DockState, floatingId: string): DockState {
  const next = cloneDock(state);
  next.floating = next.floating.filter((f) => f.id !== floatingId);
  return next;
}

// ---------------------------------------------------------------------------
// Drop zones
// ---------------------------------------------------------------------------

/** Zones of a tab group drop overlay. */
export type DropZone = "tab" | DockSide;

/**
 * Computes which of the 5 zones (top/bottom/left/right strip or center=tab) the point is in.
 * Strips are 25% of the width / height of the rectangle (at most 90px); the center is a tab drop.
 */
export function computeDropZone(rect: LayoutRect, px: number, py: number): DropZone {
  const rx = (px - rect.x) / Math.max(1, rect.width);
  const ry = (py - rect.y) / Math.max(1, rect.height);
  const sx = Math.min(0.25, 90 / Math.max(1, rect.width));
  const sy = Math.min(0.25, 90 / Math.max(1, rect.height));
  // Corner tie-break: closest edge wins.
  const dl = rx, dr = 1 - rx, dt = ry, db = 1 - ry;
  const candidates: Array<[number, DropZone]> = [];
  if (rx < sx) candidates.push([dl / sx, "left"]);
  if (1 - rx < sx) candidates.push([dr / sx, "right"]);
  if (ry < sy) candidates.push([dt / sy, "top"]);
  if (1 - ry < sy) candidates.push([db / sy, "bottom"]);
  if (!candidates.length) return "tab";
  candidates.sort((a, b) => a[0] - b[0]);
  return candidates[0][1];
}

/** Returns the window-edge a point snaps to (within `snap` px of the dock area boundary), or null. */
export function computeEdgeSnap(area: LayoutRect, px: number, py: number, snap = 18): DockSide | null {
  const d: Array<[number, DockSide]> = [
    [px - area.x, "left"],
    [area.x + area.width - px, "right"],
    [py - area.y, "top"],
    [area.y + area.height - py, "bottom"],
  ];
  const within = d.filter(([v]) => v >= 0 && v <= snap).sort((a, b) => a[0] - b[0]);
  return within.length ? within[0][1] : null;
}

/** Highlight rectangle shown for a drop zone inside a node rect. */
export function dropHighlightRect(rect: LayoutRect, zone: DropZone): LayoutRect {
  switch (zone) {
    case "left":
      return { x: rect.x, y: rect.y, width: rect.width / 2, height: rect.height };
    case "right":
      return { x: rect.x + rect.width / 2, y: rect.y, width: rect.width / 2, height: rect.height };
    case "top":
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height / 2 };
    case "bottom":
      return { x: rect.x, y: rect.y + rect.height / 2, width: rect.width, height: rect.height / 2 };
    default:
      return rect;
  }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Computes pixel rectangles of every node for a container size — used by the renderer's tests and for
 * measuring reflow. Fixed children keep their px size (clamped so the flex child keeps its minimum).
 */
export function computeRects(state: DockState, width: number, height: number): Record<string, LayoutRect> {
  const out: Record<string, LayoutRect> = {};
  const place = (node: DockNode, r: LayoutRect): void => {
    out[node.id] = r;
    if (node.kind !== "split") return;
    const horizontal = node.dir === "row";
    const total = horizontal ? r.width : r.height;
    const min = horizontal ? MIN_PANEL_W : MIN_PANEL_H;
    const gaps = (node.children.length - 1) * SPLITTER_PX;
    const fixedSum = node.sizes.reduce<number>((s, v) => s + (v === "flex" ? 0 : v), 0);
    const avail = total - gaps;
    let scale = 1;
    if (fixedSum > avail - min) scale = Math.max(0, (avail - min) / Math.max(1, fixedSum));
    let cursor = horizontal ? r.x : r.y;
    node.children.forEach((c, i) => {
      const spec = node.sizes[i];
      const px = spec === "flex" ? Math.max(0, avail - fixedSum * scale) : spec * scale;
      place(
        c,
        horizontal
          ? { x: cursor, y: r.y, width: px, height: r.height }
          : { x: r.x, y: cursor, width: r.width, height: px }
      );
      cursor += px + SPLITTER_PX;
    });
  };
  place(state.root, { x: 0, y: 0, width, height });
  return out;
}

// ---------------------------------------------------------------------------
// Validation, off-screen recovery and persistence
// ---------------------------------------------------------------------------

/** Describes the visible desktop (union of monitors) used to rescue off-screen floating windows. */
export interface ViewportInfo {
  width: number;
  height: number;
  /** Optional key identifying the monitor configuration, persisted with positions. */
  monitorKey?: string;
}

/**
 * Guarantees no panel is orphaned or off-screen: floats whose title bar is outside the viewport are moved back
 * to the primary monitor; duplicated panels are removed; unknown ids are kept (they render a placeholder).
 */
export function validateDock(state: DockState, viewport: ViewportInfo): DockState {
  let next = normalizeDock(state);
  const seen = new Set<string>();
  for (const t of listTabs(next.root)) {
    t.panels = t.panels.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  }
  next = normalizeDock(next);
  for (const f of next.floating) {
    f.panels = f.panels.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
    f.width = Math.min(Math.max(160, f.width), Math.max(160, viewport.width - 20));
    f.height = Math.min(Math.max(100, f.height), Math.max(100, viewport.height - 40));
    const titleVisible = f.x + f.width > 40 && f.x < viewport.width - 40 && f.y >= 0 && f.y < viewport.height - 30;
    if (!titleVisible || (viewport.monitorKey && f.monitorKey && f.monitorKey !== viewport.monitorKey && !titleVisible)) {
      f.x = Math.max(8, Math.min(120, viewport.width - f.width - 8));
      f.y = 60;
    }
    if (viewport.monitorKey) f.monitorKey = viewport.monitorKey;
    if (!f.panels.includes(f.active)) f.active = f.panels[0] ?? "";
  }
  next.floating = next.floating.filter((f) => f.panels.length > 0);
  return next;
}

/** Legacy (Agent 1–5) workspace shape: only the fields needed by the adapter. */
export interface LegacyLayoutShape {
  toolbarSide?: "left" | "right";
  leftDockVisible: boolean;
  leftDockWidth: number;
  leftPanels: string[];
  rightDockVisible: boolean;
  rightDockWidth: number;
  rightPanels: string[];
  bottomDockVisible: boolean;
  bottomDockHeight: number;
  bottomPanels: string[];
  activeBottomPanel: string;
  activeRightPanel: string;
  floatingPanels: Array<{ panelId: string; x: number; y: number; width: number; height: number }>;
  dock?: DockState;
}

/**
 * Migration adapter v1 → v2: converts the slot-based Agent 1 layout into a dock tree. Panels that appear
 * in several legacy lists are claimed by the first visible dock (left, right, bottom). Hidden docks keep their
 * panels in `hidden[role]` so "Show dock" restores them.
 */
export function legacyToDock(layout: LegacyLayoutShape): DockState {
  const claimed = new Set<string>();
  const claim = (list: string[], visible: boolean): string[] => {
    if (!visible) return [];
    const out = list.filter((p) => !claimed.has(p));
    out.forEach((p) => claimed.add(p));
    return out;
  };
  const floating = layout.floatingPanels.map((f) => f.panelId);
  floating.forEach((p) => claimed.add(p));
  const left = claim(layout.leftPanels, layout.leftDockVisible);
  const right = claim(layout.rightPanels, layout.rightDockVisible);
  const bottom = claim(layout.bottomPanels, layout.bottomDockVisible);
  let n = 0;
  const id = (p: string): string => `${p}${++n}`;
  const mkTabs = (panels: string[], active: string | undefined, role: string): TabsNode => ({
    kind: "tabs",
    id: id("t"),
    panels,
    active: active && panels.includes(active) ? active : panels[0],
    role,
  });
  const center: CenterNode = { kind: "center", id: "center" };

  // left column: first panel flex, remaining grouped below at a fixed height
  let leftNode: DockNode | null = null;
  if (left.length === 1) leftNode = mkTabs(left, undefined, "left");
  else if (left.length > 1) {
    leftNode = {
      kind: "split",
      id: id("s"),
      dir: "column",
      children: [mkTabs([left[0]], undefined, "left"), mkTabs(left.slice(1), undefined, "left")],
      sizes: ["flex", 190],
    };
  }
  const upperKids: DockNode[] = [];
  const upperSizes: SizeSpec[] = [];
  if (leftNode) {
    upperKids.push(leftNode);
    upperSizes.push(layout.leftDockWidth);
  }
  upperKids.push(center);
  upperSizes.push("flex");
  if (right.length) {
    upperKids.push(mkTabs(right, layout.activeRightPanel, "right"));
    upperSizes.push(layout.rightDockWidth);
  }
  const upper: DockNode =
    upperKids.length === 1 ? upperKids[0] : { kind: "split", id: id("s"), dir: "row", children: upperKids, sizes: upperSizes };
  let root: DockNode = upper;
  if (bottom.length) {
    root = {
      kind: "split",
      id: id("s"),
      dir: "column",
      children: [upper, mkTabs(bottom, layout.activeBottomPanel, "bottom")],
      sizes: ["flex", layout.bottomDockHeight],
    };
  }
  const state = createDockState(
    root,
    layout.floatingPanels.map((f, i) => ({
      id: `f${i + 1}`,
      panels: [f.panelId],
      active: f.panelId,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      minimized: false,
      maximized: false,
      memory: { ...emptyMemory(), kind: "edge" as const, edge: "right" as DockSide, role: "right" },
    }))
  );
  state.hidden = {
    left: layout.leftDockVisible ? [] : layout.leftPanels.filter((p) => !claimed.has(p)),
    right: layout.rightDockVisible ? [] : layout.rightPanels.filter((p) => !claimed.has(p)),
    bottom: layout.bottomDockVisible ? [] : layout.bottomPanels.filter((p) => !claimed.has(p)),
  };
  state.nextId = 1000;
  return state;
}

/** Returns the layout's dock tree, migrating legacy layouts on the fly (idempotent). */
export function ensureDock(layout: LegacyLayoutShape): DockState {
  if (layout.dock && layout.dock.version === 2) return layout.dock;
  return legacyToDock(layout);
}

/** Serializes a dock state to JSON (for workspaces / .kpx). */
export function serializeDock(state: DockState): string {
  return JSON.stringify(state);
}

/** Parses and validates serialized dock state; returns null when the payload is not a valid v2 layout. */
export function parseDock(json: string): DockState | null {
  try {
    const p = JSON.parse(json) as DockState;
    if (!p || p.version !== 2 || !p.root || !Array.isArray(p.floating)) return null;
    if (!containsCenter(p.root)) return null;
    return normalizeDock({ ...p, hidden: p.hidden ?? {}, nextId: p.nextId ?? 1000 });
  } catch {
    return null;
  }
}

/** Strips ids (for structural comparison in tests and "restored exactly" checks). */
export function structure(node: DockNode): unknown {
  if (node.kind === "center") return "C";
  if (node.kind === "tabs") return { t: node.panels, a: node.active };
  return { d: node.dir, s: node.sizes, c: node.children.map(structure) };
}
