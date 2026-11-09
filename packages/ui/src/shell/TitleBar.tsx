/**
 * @module @kekenik/ui/shell/TitleBar
 * Custom frameless Electron window chrome (B13):
 *  - Left App Icon (`KekenikAppIcon`) opening a Windows-style system menu (Restore, Move, Size, Minimize, Maximize, Close)
 *  - Embedded in-app `MenuBar` reusing `MenuRegistry`
 *  - Draggable empty area (`-webkit-app-region: drag`) with double-click maximize/restore toggle
 *  - Document title formatted as `● name.aseprite — Kekenik Pixel` (dot only when `isDirty` is true)
 *  - Windows-style 46×32 Minimize, Maximize/Restore, and red-hover Close buttons (`no-drag`)
 *  - Delegates Close to the existing `closeDocument(dirtyDoc.id)` unsaved-changes flow when any document is dirty
 *  - Hides cleanly in Fullscreen (`F11`) / Zen ("Tab hides UI") mode and restores cleanly
 */

import React, { useCallback, useEffect, useState } from "react";
import { decodeSprite, getPlatform } from "../../../core/src/index.ts";
import { openSpriteAsDocument } from "../app/agent6-actions.ts";
import { useAppStore } from "../app/store.ts";
import { KekenikAppIcon } from "../skin/app-icon.tsx";
import { MenuBar } from "./index.tsx";

/**
 * Formats the window document title according to B13:
 * `● name.aseprite — Kekenik Pixel` when dirty, or `name.aseprite — Kekenik Pixel` when clean.
 */
export function formatWindowDocumentTitle(
  docName: string | null | undefined,
  isDirty: boolean
): string {
  const baseName = docName && docName.trim().length > 0 ? docName.trim() : "Home";
  const prefix = isDirty ? "● " : "";
  return `${prefix}${baseName} — Kekenik Pixel`;
}

export interface TitleBarProps {
  /** Platform override for testing ('win32' | 'linux' | 'darwin'). */
  platform?: "win32" | "linux" | "darwin";
}

export const TitleBar: React.FC<TitleBarProps> = ({ platform = "win32" }) => {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const documents = useAppStore((s) => s.documents);
  const docRevision = useAppStore((s) => s.docRevision);
  const zenMode = useAppStore((s) => s.zenMode);
  const closeDocument = useAppStore((s) => s.closeDocument);

  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [sysMenuOpen, setSysMenuOpen] = useState(false);

  void docRevision;
  const activeDoc =
    activeTabId === "home"
      ? null
      : documents.find((d) => d.id === activeTabId) ?? null;

  const formattedTitle = formatWindowDocumentTitle(
    activeDoc ? activeDoc.sprite.name : "Home",
    Boolean(activeDoc?.isDirty)
  );

  // Sync window title in browser/DOM as well
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.title = formattedTitle;
    }
  }, [formattedTitle]);

  // Query initial Electron window state & subscribe to maximize/fullscreen changes + single-instance external file handoff
  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.kekenikElectron : undefined;
    if (!bridge) return;

    void bridge.isWindowMaximized().then((max) => setIsMaximized(Boolean(max)));
    void bridge.isFullScreen?.().then((fsState) => setIsFullScreen(Boolean(fsState)));

    const unsubState = bridge.onWindowStateChanged?.((st) => {
      setIsMaximized(Boolean(st.isMaximized));
      setIsFullScreen(Boolean(st.isFullScreen));
    });

    const unsubOpen = bridge.onOpenExternalFile?.((file) => {
      try {
        const { sprite, editor } = decodeSprite(file.data, file.name);
        openSpriteAsDocument(
          { get: useAppStore.getState, set: useAppStore.setState },
          sprite,
          editor ?? {},
          file.path
        );
        void getPlatform().addRecentFile({
          path: file.path,
          name: file.name,
          openedAt: new Date().toISOString(),
          width: sprite.width,
          height: sprite.height,
          colorMode: sprite.colorMode,
        });
      } catch {
        // Invalid file handled by decodeSprite logger
      }
    });

    return () => {
      unsubState?.();
      unsubOpen?.();
    };
  }, []);

  // Close system menu on outside click or Escape
  useEffect(() => {
    if (!sysMenuOpen) return;
    const onClose = () => setSysMenuOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSysMenuOpen(false);
    };
    window.addEventListener("click", onClose);
    window.addEventListener("blur", onClose);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("keydown", onKey);
    };
  }, [sysMenuOpen]);

  const handleMinimize = useCallback(async () => {
    setSysMenuOpen(false);
    const bridge = typeof window !== "undefined" ? window.kekenikElectron : undefined;
    if (bridge) {
      await bridge.minimizeWindow();
    }
  }, []);

  const handleMaximize = useCallback(async () => {
    setSysMenuOpen(false);
    const bridge = typeof window !== "undefined" ? window.kekenikElectron : undefined;
    if (bridge) {
      const res = await bridge.maximizeWindow();
      setIsMaximized(Boolean(res.isMaximized));
    } else {
      setIsMaximized(true);
    }
  }, []);

  const handleRestore = useCallback(async () => {
    setSysMenuOpen(false);
    const bridge = typeof window !== "undefined" ? window.kekenikElectron : undefined;
    if (bridge) {
      const res = await bridge.restoreWindow();
      setIsMaximized(Boolean(res.isMaximized));
    } else {
      setIsMaximized(false);
    }
  }, []);

  const handleToggleMaximizeRestore = useCallback(async () => {
    if (isMaximized) {
      await handleRestore();
    } else {
      await handleMaximize();
    }
  }, [isMaximized, handleMaximize, handleRestore]);

  /**
   * Delegates window close through the existing unsaved-changes flow (`closeDocument(dirtyDoc.id)`).
   * Never closes immediately if any document has unsaved changes (`isDirty === true`).
   */
  const handleCloseRequest = useCallback(async () => {
    setSysMenuOpen(false);
    const state = useAppStore.getState();
    const dirtyDoc = state.documents.find((d) => d.isDirty);
    if (dirtyDoc) {
      closeDocument(dirtyDoc.id);
      return;
    }
    const bridge = typeof window !== "undefined" ? window.kekenikElectron : undefined;
    if (bridge) {
      await bridge.closeWindow();
    }
  }, [closeDocument]);

  // Hide custom title bar in Fullscreen (F11) or Zen ("Tab hides UI") mode
  if (zenMode || isFullScreen) {
    return null;
  }

  return (
    <header
      data-testid="custom-titlebar"
      data-platform={platform}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) {
          void handleToggleMaximizeRestore();
        }
      }}
      className="h-8 min-h-[32px] w-full bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] border-b border-black flex items-center justify-between select-none text-xs font-mono relative z-50"
    >
      {/* Left section: macOS traffic lights spacer (if darwin), App Icon + System Menu, Embedded MenuBar */}
      <div
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        className="flex items-center h-full min-w-0"
      >
        {platform === "darwin" && (
          <div
            data-testid="titlebar-macos-traffic-lights-spacer"
            className="w-[70px] h-full shrink-0"
          />
        )}

        {/* App Icon + System Menu trigger */}
        <div
          className="relative h-full flex items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            data-testid="titlebar-app-menu-btn"
            aria-label="System Window Menu"
            aria-haspopup="menu"
            aria-expanded={sysMenuOpen}
            onClick={() => setSysMenuOpen((v) => !v)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              void handleCloseRequest();
            }}
            className="h-8 px-2 flex items-center justify-center hover:bg-black/15 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--kpx-accent-bg)] cursor-pointer"
          >
            <KekenikAppIcon size={16} dataTestId="titlebar-app-icon" />
          </button>

          {sysMenuOpen && (
            <div
              role="menu"
              data-testid="titlebar-system-menu"
              className="absolute left-0 top-full mt-0.5 w-48 kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] shadow-xl py-1 z-50"
            >
              <button
                type="button"
                role="menuitem"
                data-testid="sysmenu-restore"
                disabled={!isMaximized}
                onClick={() => void handleRestore()}
                className={`w-full px-3 py-1 text-left text-xs flex items-center justify-between ${
                  !isMaximized
                    ? "opacity-45 cursor-not-allowed"
                    : "hover:bg-[var(--kpx-header-bg)] hover:text-white cursor-pointer"
                }`}
              >
                <span>Restore</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="sysmenu-move"
                disabled={isMaximized}
                onClick={() => setSysMenuOpen(false)}
                className={`w-full px-3 py-1 text-left text-xs flex items-center justify-between ${
                  isMaximized
                    ? "opacity-45 cursor-not-allowed"
                    : "hover:bg-[var(--kpx-header-bg)] hover:text-white cursor-pointer"
                }`}
              >
                <span>Move</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="sysmenu-size"
                disabled={isMaximized}
                onClick={() => setSysMenuOpen(false)}
                className={`w-full px-3 py-1 text-left text-xs flex items-center justify-between ${
                  isMaximized
                    ? "opacity-45 cursor-not-allowed"
                    : "hover:bg-[var(--kpx-header-bg)] hover:text-white cursor-pointer"
                }`}
              >
                <span>Size</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="sysmenu-minimize"
                onClick={() => void handleMinimize()}
                className="w-full px-3 py-1 text-left text-xs flex items-center justify-between hover:bg-[var(--kpx-header-bg)] hover:text-white cursor-pointer"
              >
                <span>Minimize</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="sysmenu-maximize"
                disabled={isMaximized}
                onClick={() => void handleMaximize()}
                className={`w-full px-3 py-1 text-left text-xs flex items-center justify-between ${
                  isMaximized
                    ? "opacity-45 cursor-not-allowed"
                    : "hover:bg-[var(--kpx-header-bg)] hover:text-white cursor-pointer"
                }`}
              >
                <span>Maximize</span>
              </button>
              <div className="my-1 border-t border-black/25" />
              <button
                type="button"
                role="menuitem"
                data-testid="sysmenu-close"
                onClick={() => void handleCloseRequest()}
                className="w-full px-3 py-1 text-left text-xs flex items-center justify-between hover:bg-[#e81123] hover:text-white cursor-pointer"
              >
                <span>Close</span>
                <span className="text-[10px] opacity-75">Alt+F4</span>
              </button>
            </div>
          )}
        </div>

        {/* Embedded In-App MenuBar (reusing MenuRegistry) */}
        <MenuBar embedded />
      </div>

      {/* Center / Right Draggable Empty Area + Document Title */}
      <div
        data-testid="titlebar-drag-region"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        onDoubleClick={() => void handleToggleMaximizeRestore()}
        className="flex-1 h-full flex items-center justify-center px-3 min-w-[120px] overflow-hidden"
      >
        {/* Absolutely centred title so the left menu group can never push it off-centre. */}
        <span
          data-testid="titlebar-doc-title"
          className="absolute left-1/2 top-0 h-full -translate-x-1/2 flex items-center justify-center overflow-hidden whitespace-nowrap text-ellipsis text-[11px] font-bold tracking-tight opacity-90 pointer-events-none max-w-[min(50vw,560px)]"
        >
          {formattedTitle}
        </span>
      </div>

      {/* Right Window Controls (46x32 hit targets on Windows/Linux) */}
      {platform !== "darwin" && (
        <div
          data-testid="titlebar-window-controls"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="flex items-center h-full shrink-0"
        >
          <button
            type="button"
            data-testid="titlebar-btn-minimize"
            aria-label="Minimize"
            title="Minimize"
            onClick={() => void handleMinimize()}
            className="w-[46px] h-[32px] flex items-center justify-center hover:bg-black/15 active:bg-black/25 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--kpx-accent-bg)] cursor-pointer"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect x="0" y="5" width="10" height="1" fill="currentColor" />
            </svg>
          </button>

          <button
            type="button"
            data-testid="titlebar-btn-maximize"
            data-maximized={isMaximized ? "true" : "false"}
            aria-label={isMaximized ? "Restore" : "Maximize"}
            title={isMaximized ? "Restore" : "Maximize"}
            onClick={() => void handleToggleMaximizeRestore()}
            className="w-[46px] h-[32px] flex items-center justify-center hover:bg-black/15 active:bg-black/25 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--kpx-accent-bg)] cursor-pointer"
          >
            {isMaximized ? (
              <svg
                data-testid="icon-restore"
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
              >
                <path
                  d="M2 0h8v8h-2v2H0V2h2V0zm1 1v1h5v5h1V1H3zM1 3v6h6V3H1z"
                  fill="currentColor"
                />
              </svg>
            ) : (
              <svg
                data-testid="icon-maximize"
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
              >
                <path d="M0 0h10v10H0V0zm1 1v8h8V1H1z" fill="currentColor" />
              </svg>
            )}
          </button>

          <button
            type="button"
            data-testid="titlebar-btn-close"
            aria-label="Close"
            title="Close"
            onClick={() => void handleCloseRequest()}
            className="w-[46px] h-[32px] flex items-center justify-center hover:bg-[#e81123] hover:text-white active:bg-[#f1707a] active:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--kpx-accent-bg)] cursor-pointer transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path
                d="M1 0L0 1l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4-4-4z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      )}
    </header>
  );
};
