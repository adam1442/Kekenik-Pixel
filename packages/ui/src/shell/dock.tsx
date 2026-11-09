/**
 * @module @kekenik/ui/shell/dock
 * Docking UI (PanelLayout v2): recursive split/tab rendering, draggable splitters, drag-to-dock with a 5-zone
 * drop overlay, floating windows (tabs / minimize / maximize / dock back / close), context menus and keyboard support.
 * All state lives in `DockState` (packages/core/src/layout); this file only renders and dispatches store actions.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MIN_PANEL_H,
  MIN_PANEL_W,
  computeDropZone,
  computeEdgeSnap,
  dropHighlightRect,
  ensureDock,
  panelLocation,
  validateDock,
  type DockNode,
  type DockState,
  type DropTarget,
  type FloatingWindowState,
  type LayoutRect,
  type SplitNode,
  type TabsNode,
} from "../../../core/src/layout/index.ts";
import { PanelRegistry, t } from "../../../core/src/index.ts";
import { useAppStore } from "../app/store.ts";
import { isTextEntryTarget } from "../app/keyboard.ts";
import { PanelContentRenderer } from "../panels/index.tsx";

const DOCK_CSS = `
.kpx-dock-anim{transition:flex-basis 120ms ease}
[data-dock-resizing="1"] .kpx-dock-anim{transition:none}
@keyframes kpx-float-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
.kpx-float-in{animation:kpx-float-in 120ms ease-out}
@media (prefers-reduced-motion: reduce){.kpx-dock-anim{transition:none}.kpx-float-in{animation:none}}
.kpx-dock-focus:focus-within{outline:2px solid #ffd35a;outline-offset:-2px}
.kpx-splitter:focus-visible{outline:2px solid #ffd35a}
`;

/** Resolves a localized panel title. */
function panelTitle(panelId: string, locale: string): string {
  const localized = t(panelId, locale as never);
  if (localized && localized !== panelId) return localized;
  return PanelRegistry.get(panelId)?.title ?? panelId;
}

function rectOf(el: Element): LayoutRect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/** Finds the drop target under a viewport point. `exclude` lets a lone panel ignore its own group. */
export function hitTestDock(x: number, y: number): { target: DropTarget; hint: LayoutRect } | null {
  const rootEl = document.querySelector("[data-dock-root]");
  if (!rootEl) return null;
  const area = rectOf(rootEl);
  if (x < area.x || x > area.x + area.width || y < area.y || y > area.y + area.height) return null;
  const edge = computeEdgeSnap(area, x, y, 16);
  if (edge) {
    const w = 140;
    const hint: LayoutRect =
      edge === "left"
        ? { x: area.x, y: area.y, width: w, height: area.height }
        : edge === "right"
          ? { x: area.x + area.width - w, y: area.y, width: w, height: area.height }
          : edge === "top"
            ? { x: area.x, y: area.y, width: area.width, height: 110 }
            : { x: area.x, y: area.y + area.height - 110, width: area.width, height: 110 };
    return { target: { kind: "edge", edge }, hint };
  }
  for (const el of document.elementsFromPoint(x, y)) {
    const tabsEl = (el as HTMLElement).closest?.("[data-dock-tabs]") as HTMLElement | null;
    if (tabsEl) {
      const id = tabsEl.getAttribute("data-dock-tabs")!;
      const r = rectOf(tabsEl);
      const zone = computeDropZone(r, x, y);
      return {
        target: zone === "tab" ? { kind: "tab", tabsId: id } : { kind: "side", tabsId: id, side: zone },
        hint: dropHighlightRect(r, zone),
      };
    }
  }
  return null;
}

interface DragOptions {
  label: string;
  startX: number;
  startY: number;
  /** Called while the pointer moves (after the drag threshold), e.g. to move a floating window. */
  onMove?: (dx: number, dy: number) => void;
  /** Called on release over a valid target. */
  onDrop: (target: DropTarget) => void;
  /** Called on release with no target after the drag started. */
  onDropFree?: (x: number, y: number) => void;
  /** Called when the pointer never moved beyond the threshold (a click). */
  onClick?: () => void;
}

/** Shared pointer-driven drag session used by tabs and floating title bars. */
function beginDockDrag(opts: DragOptions, setDrag: (d: ReturnType<typeof useAppStore.getState>["dockDrag"]) => void): void {
  let active = false;
  const prevCursor = document.body.style.cursor;
  const move = (ev: MouseEvent): void => {
    const dx = ev.clientX - opts.startX;
    const dy = ev.clientY - opts.startY;
    if (!active && Math.hypot(dx, dy) < 5) return;
    active = true;
    opts.onMove?.(dx, dy);
    const hit = hitTestDock(ev.clientX, ev.clientY);
    document.body.style.cursor = hit ? "copy" : "grabbing";
    setDrag({ label: opts.label, x: ev.clientX, y: ev.clientY, target: hit?.target ?? null, hint: hit?.hint ?? null });
  };
  const up = (ev: MouseEvent): void => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    document.body.style.cursor = prevCursor;
    setDrag(null);
    if (!active) {
      opts.onClick?.();
      return;
    }
    const hit = hitTestDock(ev.clientX, ev.clientY);
    if (hit) opts.onDrop(hit.target);
    else opts.onDropFree?.(ev.clientX, ev.clientY);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

interface MenuEntry {
  label: string;
  run: () => void;
  disabled?: boolean;
}

const ContextMenu: React.FC<{ x: number; y: number; entries: MenuEntry[]; onClose: () => void }> = ({ x, y, entries, onClose }) => {
  useEffect(() => {
    const close = (): void => onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);
  return (
    <div
      role="menu"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
      className="fixed z-[70] kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] shadow-2xl py-1 text-xs font-mono min-w-[190px]"
    >
      {entries.map((en) => (
        <button
          key={en.label}
          type="button"
          role="menuitem"
          disabled={en.disabled}
          onClick={() => {
            en.run();
            onClose();
          }}
          className={`w-full text-left px-3 py-1 ${en.disabled ? "opacity-45 cursor-not-allowed" : "hover:bg-[var(--kpx-header-bg)] hover:text-white"}`}
        >
          {en.label}
        </button>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab strip (shared by docked groups and floating windows)
// ---------------------------------------------------------------------------

interface TabStripProps {
  panels: string[];
  active: string;
  label: string;
  onActivate: (p: string) => void;
  /** Drag release over a target. */
  onDropPanel: (p: string, target: DropTarget) => void;
  /** Drag released in free space. */
  onFreePanel: (p: string, x: number, y: number) => void;
  onContext: (p: string, x: number, y: number) => void;
  onDoubleClick: (p: string) => void;
}

const TabStrip: React.FC<TabStripProps> = (props) => {
  const locale = useAppStore((s) => s.locale);
  const setDrag = useAppStore((s) => s.setDockDrag);
  return (
    <div role="tablist" aria-label={props.label} className="flex items-center gap-0.5 overflow-x-auto min-w-0">
      {props.panels.map((pid) => {
        const active = props.active === pid;
        const title = panelTitle(pid, locale);
        return (
          <button
            key={pid}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={title}
            title={`${title} — drag to dock, double-click to float`}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              beginDockDrag(
                {
                  label: title,
                  startX: e.clientX,
                  startY: e.clientY,
                  onClick: () => props.onActivate(pid),
                  onDrop: (target) => props.onDropPanel(pid, target),
                  onDropFree: (x, y) => props.onFreePanel(pid, x, y),
                },
                setDrag
              );
            }}
            onDoubleClick={() => props.onDoubleClick(pid)}
            onContextMenu={(e) => {
              e.preventDefault();
              props.onContext(pid, e.clientX, e.clientY);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") props.onActivate(pid);
              const i = props.panels.indexOf(pid);
              if (e.key === "ArrowRight" && i < props.panels.length - 1) props.onActivate(props.panels[i + 1]);
              if (e.key === "ArrowLeft" && i > 0) props.onActivate(props.panels[i - 1]);
            }}
            className={`px-2 py-0.5 whitespace-nowrap cursor-grab focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffd35a] ${
              active ? "bg-black/40 font-bold" : "opacity-80 hover:opacity-100 hover:bg-black/20"
            }`}
          >
            {title}
          </button>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Docked tab group
// ---------------------------------------------------------------------------

const PanelBody: React.FC<{ panelId: string }> = ({ panelId }) => {
  const setFocused = useAppStore((s) => s.setFocusedPanel);
  return (
    <div
      data-panel-id={panelId}
      tabIndex={-1}
      onMouseDownCapture={() => setFocused(panelId)}
      onFocusCapture={() => setFocused(panelId)}
      className="h-full w-full overflow-hidden outline-none"
    >
      <PanelContentRenderer panelId={panelId} />
    </div>
  );
};

const TabsView: React.FC<{ node: TabsNode; openMenu: (x: number, y: number, entries: MenuEntry[]) => void }> = ({ node, openMenu }) => {
  const locale = useAppStore((s) => s.locale);
  const setActive = useAppStore((s) => s.setDockTabActive);
  const dockPanelAt = useAppStore((s) => s.dockPanelAt);
  const floatPanelAt = useAppStore((s) => s.floatPanelAt);
  const floatTabGroup = useAppStore((s) => s.floatTabGroup);
  const closeDocked = useAppStore((s) => s.closeDockedPanel);
  const toggleFloat = useAppStore((s) => s.togglePanelFloating);
  const toggleSlot = useAppStore((s) => s.toggleDockSlot);
  const ref = useRef<HTMLDivElement>(null);
  const label = `${panelTitle(node.active, locale)} tab group`;

  const floatRect = (): LayoutRect | undefined => {
    if (!ref.current) return undefined;
    const r = rectOf(ref.current);
    return { x: r.x + 24, y: r.y + 24, width: Math.max(240, Math.min(r.width, 420)), height: Math.max(180, Math.min(r.height, 360)) };
  };
  const contextFor = (pid: string, x: number, y: number): void =>
    openMenu(x, y, [
      { label: "Float panel", run: () => floatPanelAt(pid, floatRect()) },
      { label: "Float whole group", run: () => floatTabGroup(node.id, floatRect()), disabled: node.panels.length < 2 },
      { label: "Dock to left edge", run: () => dockPanelAt(pid, { kind: "edge", edge: "left" }) },
      { label: "Dock to right edge", run: () => dockPanelAt(pid, { kind: "edge", edge: "right" }) },
      { label: "Dock to top edge", run: () => dockPanelAt(pid, { kind: "edge", edge: "top" }) },
      { label: "Dock to bottom edge", run: () => dockPanelAt(pid, { kind: "edge", edge: "bottom" }) },
      { label: "Close panel", run: () => closeDocked(pid) },
    ]);

  return (
    <div
      ref={ref}
      data-dock-tabs={node.id}
      role="region"
      aria-label={label}
      className="h-full w-full flex flex-col bg-[var(--kpx-panel-bg)] overflow-hidden kpx-dock-focus"
    >
      <div className="flex items-center justify-between px-1 py-0.5 bg-[var(--kpx-header-bg)] text-white text-[11px] font-mono border-b border-black shrink-0 gap-1">
        <TabStrip
          panels={node.panels}
          active={node.active}
          label={label}
          onActivate={(p) => setActive(node.id, p)}
          onDropPanel={(p, target) => dockPanelAt(p, target)}
          onFreePanel={(p, x, y) => floatPanelAt(p, { x: x - 60, y: y - 10, width: 260, height: 220 })}
          onContext={contextFor}
          onDoubleClick={(p) => floatPanelAt(p, floatRect())}
        />
        <div className="flex items-center gap-0.5 shrink-0">
          {node.role === "bottom" && (
            <>
              <button type="button" title="Toggle Preview Window (F7)" onClick={() => toggleFloat("panel.preview")} className="px-1 bg-white/20 hover:bg-white/30 text-[10px]">
                Preview
              </button>
              <button type="button" title="Show / hide the right dock (History, Layers…)" onClick={() => toggleSlot("right")} className="px-1 bg-white/20 hover:bg-white/30 text-[10px]">
                Right dock
              </button>
            </>
          )}
          <button
            type="button"
            title="Float active panel (Ctrl+Shift+F)"
            aria-label="Float active panel"
            onClick={() => floatPanelAt(node.active, floatRect())}
            className="px-1 bg-white/20 hover:bg-white/30 text-[10px]"
          >
            Float
          </button>
          <button
            type="button"
            title="Close active panel"
            aria-label="Close active panel"
            onClick={() => closeDocked(node.active)}
            className="px-1 bg-white/20 hover:bg-white/30 text-[10px]"
          >
            ×
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <PanelBody panelId={node.active} />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Splitter + recursive node rendering
// ---------------------------------------------------------------------------

const Splitter: React.FC<{ split: SplitNode; index: number }> = ({ split, index }) => {
  const setSize = useAppStore((s) => s.setDockChildSize);
  const horizontal = split.dir === "row";
  const min = horizontal ? MIN_PANEL_W : MIN_PANEL_H;
  const sizeSpec = split.sizes[index];
  const nextSpec = split.sizes[index + 1];

  const apply = (target: HTMLElement | null, deltaPx: number): void => {
    if (!target) return;
    const prevEl = target.previousElementSibling as HTMLElement | null;
    const nextEl = target.nextElementSibling as HTMLElement | null;
    if (!prevEl || !nextEl) return;
    const prevSize = horizontal ? prevEl.offsetWidth : prevEl.offsetHeight;
    const nextSize = horizontal ? nextEl.offsetWidth : nextEl.offsetHeight;
    if (sizeSpec !== "flex") {
      const px = Math.max(min, Math.min(prevSize + deltaPx, prevSize + nextSize - min));
      setSize(split.id, index, px);
    } else if (nextSpec !== "flex") {
      const px = Math.max(min, Math.min(nextSize - deltaPx, prevSize + nextSize - min));
      setSize(split.id, index + 1, px);
    }
  };

  const onDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const target = e.currentTarget;
    const start = horizontal ? e.clientX : e.clientY;
    const prevEl = target.previousElementSibling as HTMLElement | null;
    const nextEl = target.nextElementSibling as HTMLElement | null;
    if (!prevEl || !nextEl) return;
    const prev0 = horizontal ? prevEl.offsetWidth : prevEl.offsetHeight;
    const next0 = horizontal ? nextEl.offsetWidth : nextEl.offsetHeight;
    const root = document.querySelector("[data-dock-root]");
    root?.setAttribute("data-dock-resizing", "1");
    document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
    const move = (ev: MouseEvent): void => {
      const d = (horizontal ? ev.clientX : ev.clientY) - start;
      if (sizeSpec !== "flex") setSize(split.id, index, Math.max(min, Math.min(prev0 + d, prev0 + next0 - min)));
      else if (nextSpec !== "flex") setSize(split.id, index + 1, Math.max(min, Math.min(next0 - d, prev0 + next0 - min)));
    };
    const up = (): void => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      root?.removeAttribute("data-dock-resizing");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-label={`Resize panels (${horizontal ? "left/right arrows" : "up/down arrows"})`}
      title="Drag to resize"
      onMouseDown={onDown}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        const keys = horizontal ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
        if (!keys.includes(e.key)) return;
        e.preventDefault();
        apply(e.currentTarget, e.key === keys[0] ? -step : step);
      }}
      className={`kpx-splitter shrink-0 bg-black/60 hover:bg-[#ffd35a] ${horizontal ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"}`}
    />
  );
};

const NodeView: React.FC<{
  node: DockNode;
  center: React.ReactNode;
  openMenu: (x: number, y: number, entries: MenuEntry[]) => void;
}> = ({ node, center, openMenu }) => {
  if (node.kind === "center") return <div className="h-full w-full overflow-hidden" data-dock-center>{center}</div>;
  if (node.kind === "tabs") return <TabsView node={node} openMenu={openMenu} />;
  const horizontal = node.dir === "row";
  return (
    <div className="h-full w-full flex overflow-hidden" style={{ flexDirection: node.dir }} data-dock-split={node.id}>
      {node.children.map((child, i) => {
        const spec = node.sizes[i];
        const hasCenter = JSON.stringify(child).includes('"kind":"center"');
        const style: React.CSSProperties =
          spec === "flex"
            ? { flex: "1 1 0", minWidth: hasCenter ? 160 : 0, minHeight: hasCenter ? 120 : 0 }
            : horizontal
              ? { flex: `0 1 ${spec}px`, minWidth: MIN_PANEL_W }
              : { flex: `0 1 ${spec}px`, minHeight: MIN_PANEL_H };
        return (
          <React.Fragment key={child.id}>
            <div className="kpx-dock-anim overflow-hidden" style={style}>
              <NodeView node={child} center={center} openMenu={openMenu} />
            </div>
            {i < node.children.length - 1 && <Splitter split={node} index={i} />}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Floating windows
// ---------------------------------------------------------------------------

const FloatingWindowView: React.FC<{
  win: FloatingWindowState;
  z: number;
  onFocus: () => void;
  openMenu: (x: number, y: number, entries: MenuEntry[]) => void;
}> = ({ win, z, onFocus, openMenu }) => {
  const locale = useAppStore((s) => s.locale);
  const update = useAppStore((s) => s.updateFloatingWindow);
  const dockBackFloating = useAppStore((s) => s.dockBackFloating);
  const dockFloatingAt = useAppStore((s) => s.dockFloatingAt);
  const dockPanelAt = useAppStore((s) => s.dockPanelAt);
  const closeWin = useAppStore((s) => s.closeFloatingWindow);
  const setActive = useAppStore((s) => s.setFloatingTabActive);
  const tearOff = useAppStore((s) => s.tearOffFloatingTab);
  const setDrag = useAppStore((s) => s.setDockDrag);
  const setFocused = useAppStore((s) => s.setFocusedPanel);
  const winRef = useRef(win);
  winRef.current = win;

  const title = win.panels.map((p) => panelTitle(p, locale)).join(" · ");
  const area = typeof document !== "undefined" ? document.querySelector("[data-dock-root]") : null;
  const maxRect = area ? rectOf(area) : { x: 0, y: 30, width: window.innerWidth, height: window.innerHeight - 60 };
  const style: React.CSSProperties = win.maximized
    ? { left: maxRect.x, top: maxRect.y, width: maxRect.width, height: maxRect.height, zIndex: z }
    : { left: win.x, top: win.y, width: win.width, height: win.minimized ? 22 : win.height, zIndex: z };

  const startMove = (e: React.MouseEvent): void => {
    if (e.button !== 0 || win.maximized) return;
    onFocus();
    const ox = win.x;
    const oy = win.y;
    beginDockDrag(
      {
        label: title,
        startX: e.clientX,
        startY: e.clientY,
        onMove: (dx, dy) => update(win.id, { x: Math.max(-win.width + 80, ox + dx), y: Math.max(0, oy + dy) }),
        onDrop: (target) => dockFloatingAt(win.id, target),
      },
      setDrag
    );
  };

  const startResize = (e: React.MouseEvent, mode: "se" | "e" | "s"): void => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const w0 = win.width;
    const h0 = win.height;
    const move = (ev: MouseEvent): void => {
      update(win.id, {
        width: mode !== "s" ? Math.max(160, w0 + ev.clientX - sx) : w0,
        height: mode !== "e" ? Math.max(100, h0 + ev.clientY - sy) : h0,
      });
    };
    const up = (): void => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const btn = "w-4 h-4 kpx-bevel-outset bg-[var(--kpx-btn-bg)] text-black flex items-center justify-center text-[10px] leading-none font-bold";

  return (
    <div
      style={style}
      role="dialog"
      aria-label={`Floating window: ${title}`}
      data-floating-window={win.id}
      onMouseDownCapture={() => {
        onFocus();
        setFocused(win.active);
      }}
      className="fixed kpx-window kpx-float-in kpx-dock-focus bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] shadow-2xl flex flex-col select-none"
    >
      <div
        onMouseDown={startMove}
        onDoubleClick={() => dockBackFloating(win.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu(e.clientX, e.clientY, [
            { label: "Dock back to last position", run: () => dockBackFloating(win.id) },
            { label: win.minimized ? "Restore" : "Minimize", run: () => update(win.id, { minimized: !win.minimized, maximized: false }) },
            { label: win.maximized ? "Restore size" : "Maximize", run: () => update(win.id, { maximized: !win.maximized, minimized: false }) },
            { label: "Dock to left edge", run: () => dockFloatingAt(win.id, { kind: "edge", edge: "left" }) },
            { label: "Dock to right edge", run: () => dockFloatingAt(win.id, { kind: "edge", edge: "right" }) },
            { label: "Dock to bottom edge", run: () => dockFloatingAt(win.id, { kind: "edge", edge: "bottom" }) },
            { label: "Close", run: () => closeWin(win.id) },
          ]);
        }}
        className="h-[22px] px-1 bg-[var(--kpx-header-bg)] text-white flex items-center justify-between border-b border-black cursor-move text-[11px] font-mono shrink-0 gap-1"
      >
        {win.panels.length > 1 ? (
          <div onMouseDown={(e) => e.stopPropagation()} className="min-w-0">
            <TabStrip
              panels={win.panels}
              active={win.active}
              label={`${title} floating tab group`}
              onActivate={(p) => setActive(win.id, p)}
              onDropPanel={(p, target) => dockPanelAt(p, target)}
              onFreePanel={(p, x, y) => tearOff(win.id, p, { x: x - 60, y: y - 10, width: win.width, height: win.height })}
              onContext={(p, x, y) =>
                openMenu(x, y, [
                  { label: "Move to its own window", run: () => tearOff(win.id, p, { x: win.x + 30, y: win.y + 30, width: win.width, height: win.height }) },
                  { label: "Dock back (whole window)", run: () => dockBackFloating(win.id) },
                ])
              }
              onDoubleClick={(p) => tearOff(win.id, p, { x: win.x + 30, y: win.y + 30, width: win.width, height: win.height })}
            />
          </div>
        ) : (
          <span className="truncate font-bold">{title}</span>
        )}
        <div className="flex items-center gap-0.5 shrink-0" onMouseDown={(e) => e.stopPropagation()}>
          <button type="button" title="Dock back to last position (Ctrl+Shift+D)" aria-label="Dock back" onClick={() => dockBackFloating(win.id)} className={btn}>
            ⇲
          </button>
          <button type="button" title={win.minimized ? "Restore" : "Minimize"} aria-label="Minimize" onClick={() => update(win.id, { minimized: !win.minimized, maximized: false })} className={btn}>
            _
          </button>
          <button type="button" title={win.maximized ? "Restore size" : "Maximize"} aria-label="Maximize" onClick={() => update(win.id, { maximized: !win.maximized, minimized: false })} className={btn}>
            □
          </button>
          <button type="button" title="Close window" aria-label="Close window" onClick={() => closeWin(win.id)} className={btn}>
            ×
          </button>
        </div>
      </div>
      {!win.minimized && (
        <>
          <div className="flex-1 min-h-0 overflow-hidden">
            <PanelBody panelId={win.active} />
          </div>
          <div onMouseDown={(e) => startResize(e, "e")} className="absolute right-0 top-[22px] bottom-3 w-1 cursor-ew-resize" />
          <div onMouseDown={(e) => startResize(e, "s")} className="absolute left-0 right-3 bottom-0 h-1 cursor-ns-resize" />
          <div onMouseDown={(e) => startResize(e, "se")} title="Drag to resize floating window" className="absolute right-0 bottom-0 w-3 h-3 cursor-nwse-resize bg-black/30" />
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Drag overlay
// ---------------------------------------------------------------------------

const DragOverlay: React.FC = () => {
  const drag = useAppStore((s) => s.dockDrag);
  if (!drag) return null;
  return (
    <>
      {drag.hint && (
        <div
          aria-hidden
          data-dock-hint={drag.target?.kind === "tab" ? "tab" : drag.target?.kind === "edge" ? `edge-${drag.target.edge}` : drag.target ? `side-${drag.target.side}` : ""}
          style={{ left: drag.hint.x, top: drag.hint.y, width: drag.hint.width, height: drag.hint.height }}
          className="fixed z-[80] pointer-events-none border-2 border-[#ffd35a] bg-[#ffd35a]/25"
        >
          <span className="absolute left-1 top-1 text-[10px] bg-black/70 text-[#ffd35a] px-1">
            {drag.target?.kind === "tab" ? "Dock as tab" : drag.target?.kind === "edge" ? `Dock to ${drag.target.edge} edge` : drag.target ? `Dock ${drag.target.side}` : ""}
          </span>
        </div>
      )}
      <div
        aria-hidden
        style={{ left: drag.x + 12, top: drag.y + 12 }}
        className="fixed z-[90] pointer-events-none px-2 py-0.5 text-[11px] font-mono bg-[var(--kpx-header-bg)] text-white border border-black shadow-lg"
      >
        {drag.label}
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

/** Renders the whole dock layout around the `center` content, plus floating windows and the drop overlay. */
export const DockView: React.FC<{ center: React.ReactNode }> = ({ center }) => {
  const layout = useAppStore((s) => s.currentLayout);
  const commitDock = useAppStore((s) => s.commitDock);
  const floatFocused = useAppStore((s) => s.floatFocusedPanel);
  const dockBackFocused = useAppStore((s) => s.dockBackFocusedPanel);
  const dock: DockState = useMemo(() => ensureDock(layout as never), [layout]);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [zMap, setZMap] = useState<Record<string, number>>({});
  const zCounter = useRef(40);
  const openMenu = useCallback((x: number, y: number, entries: MenuEntry[]) => setMenu({ x, y, entries }), []);

  // Make sure a v2 dock exists in the store (migrates legacy layouts once) and rescue off-screen windows on resize.
  useEffect(() => {
    if (!layout.dock) commitDock(dock);
  }, [layout.dock, dock, commitDock]);
  useEffect(() => {
    const onResize = (): void => {
      const state = ensureDock(useAppStore.getState().currentLayout as never);
      const fixed = validateDock(state, { width: window.innerWidth, height: window.innerHeight });
      if (JSON.stringify(fixed.floating) !== JSON.stringify(state.floating)) commitDock(fixed);
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [commitDock]);

  // Keyboard: Ctrl+Shift+F float focused panel, Ctrl+Shift+D dock back, F6 cycle regions.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Never intercept keys typed into the script editor or any other text widget.
      if (isTextEntryTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        if (floatFocused()) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "d") {
        if (dockBackFocused()) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      } else if (e.key === "F6") {
        e.preventDefault();
        const regions = Array.from(document.querySelectorAll<HTMLElement>("[data-dock-tabs] [role=tab][aria-selected=true], [data-floating-window] [role=tab][aria-selected=true], [data-floating-window] [aria-label='Dock back']"));
        if (!regions.length) return;
        const cur = regions.indexOf(document.activeElement as HTMLElement);
        const next = (cur + (e.shiftKey ? -1 : 1) + regions.length) % regions.length;
        regions[next].focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [floatFocused, dockBackFocused]);

  const bring = (id: string): void => {
    zCounter.current += 1;
    setZMap((m) => ({ ...m, [id]: zCounter.current }));
  };

  return (
    <div className="flex-1 min-h-0 w-full relative overflow-hidden" data-dock-root data-testid="dock-root">
      <style>{DOCK_CSS}</style>
      <NodeView node={dock.root} center={center} openMenu={openMenu} />
      {dock.floating.map((fw, i) => (
        <FloatingWindowView key={fw.id} win={fw} z={zMap[fw.id] ?? 40 + i} onFocus={() => bring(fw.id)} openMenu={openMenu} />
      ))}
      <DragOverlay />
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  );
};

export { panelLocation };
