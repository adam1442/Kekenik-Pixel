/**
 * @module @kekenik/ui/app/HomeTab
 * Offline-first Home tab displaying New/Open actions, the in-app Sample Project submenu (B19),
 * example documents, and Recent Files / Pinned Files via PlatformAPI.
 *
 * The Home tab is a production surface: it contains no packaging/download or developer-only
 * actions — only real editor entry points plus a link to the project repository.
 */

import React, { useEffect, useState } from "react";
import {
  getPlatform,
  listSampleProjects,
  MenuItemDefinition,
  RecentFileEntry,
} from "../../../core/src/index.ts";
import { CascadingMenuList } from "../shell/index.tsx";
import { KekenikAppIcon, KpxFileIcon, PixelIcon } from "../skin/index.tsx";
import { PixelButton, SectionDivider } from "../widgets/index.tsx";
import { REPOSITORY_URL, openExternalUrl } from "./external-links.ts";
import { useAppStore } from "./store.ts";

/**
 * Normalises a persisted recent-file entry. Older builds (and files written by hand) can be
 * missing `colorMode`/`name`, which used to crash the Home tab with
 * `TypeError: Cannot read properties of undefined (reading 'toUpperCase')`.
 */
function normalizeRecentFile(entry: Partial<RecentFileEntry> | null | undefined): RecentFileEntry | null {
  if (!entry || typeof entry.path !== "string" || entry.path.length === 0) return null;
  const rawColorMode = typeof entry.colorMode === "string" ? entry.colorMode : "";
  return {
    path: entry.path,
    name: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : entry.path.split(/[\\/]/).pop() || "untitled",
    openedAt: typeof entry.openedAt === "string" ? entry.openedAt : new Date(0).toISOString(),
    width: Number.isFinite(entry.width) ? Number(entry.width) : 0,
    height: Number.isFinite(entry.height) ? Number(entry.height) : 0,
    colorMode: (rawColorMode || "rgba") as RecentFileEntry["colorMode"],
  };
}

export const HomeTab: React.FC = () => {
  const openDialog = useAppStore((s) => s.openDialog);
  const openDemoDocument = useAppStore((s) => s.openDemoDocument);
  const runCommandById = useAppStore((s) => s.runCommandById);
  const [recentFiles, setRecentFiles] = useState<RecentFileEntry[]>([]);
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([]);
  const [showSampleMenu, setShowSampleMenu] = useState(false);

  useEffect(() => {
    void getPlatform()
      .getRecentFiles()
      .then((list) => {
        const safe = (Array.isArray(list) ? list : [])
          .map((entry) => normalizeRecentFile(entry))
          .filter((entry): entry is RecentFileEntry => entry !== null);
        setRecentFiles(safe);
      })
      .catch(() => setRecentFiles([]));
    void getPlatform()
      .readSetting<string[]>("kpx_pinned_files", [])
      .then((pins) => setPinnedPaths(Array.isArray(pins) ? pins.filter((p) => typeof p === "string") : []))
      .catch(() => setPinnedPaths([]));
  }, []);

  useEffect(() => {
    const close = () => setShowSampleMenu(false);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, []);

  const togglePin = async (path: string) => {
    const next = pinnedPaths.includes(path)
      ? pinnedPaths.filter((p) => p !== path)
      : [...pinnedPaths, path];
    setPinnedPaths(next);
    await getPlatform().writeSetting("kpx_pinned_files", next);
  };

  const sampleMenuItems: MenuItemDefinition[] = [
    {
      id: "home.menu.open_sample",
      menu: "File",
      label: "Open Sample Project",
      order: 1,
      ownerAgent: 6,
      state: "tested",
      children: listSampleProjects().map((sp, idx) => ({
        id: `home.sample.${sp.id}`,
        menu: "File" as const,
        label: sp.title,
        commandId: `sample.open.${sp.id.replace(/^sample\./, "")}`,
        order: idx + 1,
        ownerAgent: 6 as const,
        state: "tested" as const,
      })),
    },
  ];

  const sortedRecent = [...recentFiles].sort((a, b) => {
    const aPin = pinnedPaths.includes(a.path) ? 1 : 0;
    const bPin = pinnedPaths.includes(b.path) ? 1 : 0;
    return bPin - aPin;
  });

  return (
    <div className="h-full w-full bg-[var(--kpx-canvas-surround)] p-6 overflow-y-auto flex items-start justify-center select-none">
      <div className="w-full max-w-3xl kpx-window bg-[var(--kpx-panel-bg)] text-[var(--kpx-text)] p-5 shadow-2xl font-mono space-y-4">
        {/* Banner with App Icon Logo Area (B16) */}
        <div className="flex items-center border-b border-black/30 pb-3">
          <div className="flex items-center gap-3">
            <div
              data-testid="home-logo-area"
              className="p-1.5 kpx-bevel-outset bg-[var(--kpx-window-bg)] flex items-center justify-center shrink-0"
            >
              <KekenikAppIcon size={36} dataTestId="home-app-icon" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-wide flex items-center gap-2">
                <span>KEKENIK PIXEL — PIXEL ART &amp; SPRITE ANIMATION STUDIO</span>
                <KpxFileIcon size={16} dataTestId="home-kpx-icon" />
              </h1>
              <p className="text-xs opacity-80">
                Full Desktop &amp; Web Sprite Studio: Layers, Timeline, Tilemaps, Slices, RotSprite,
                Palettes, Filters, .aseprite/.kpx Codecs, Sprite Sheets &amp; Scripting
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Left Column: Start Actions & Sample Submenu */}
          <div className="space-y-3">
            <SectionDivider label="Start:" />
            <div className="flex flex-col gap-2">
              <PixelButton
                size="md"
                onClick={() => openDialog("dialog.new_sprite")}
                className="justify-start py-1.5"
              >
                <PixelIcon name="plus" size={14} />
                New Sprite... (Ctrl+N)
              </PixelButton>
              <PixelButton
                size="md"
                onClick={() => runCommandById("file.open_any")}
                className="justify-start py-1.5"
              >
                <PixelIcon name="folder" size={14} />
                Open File (.aseprite, .kpx, .png, .gif)... (Ctrl+O)
              </PixelButton>

              {/* Home Tab Sample Submenu (B19) */}
              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <PixelButton
                  size="md"
                  dataTestId="home-sample-submenu-btn"
                  active={showSampleMenu}
                  onClick={() => setShowSampleMenu(!showSampleMenu)}
                  className="w-full justify-between py-1.5"
                >
                  <span className="flex items-center gap-1.5">
                    <PixelIcon name="folder" size={14} />
                    <span>Open Sample Project</span>
                  </span>
                  <span data-testid="submenu-chevron" className="text-xs">
                    ▸
                  </span>
                </PixelButton>

                {showSampleMenu && (
                  <CascadingMenuList
                    items={sampleMenuItems[0].children!}
                    onActivateCommand={(cmdId) => {
                      runCommandById(cmdId);
                      setShowSampleMenu(false);
                    }}
                    getShortcutLabel={() => ""}
                  />
                )}
              </div>
            </div>

            <SectionDivider label="Example Projects — Selections, Transforms & Palettes:" />
            <div className="flex flex-col gap-1.5">
              <PixelButton
                size="sm"
                onClick={() => openDemoDocument("selection_playground")}
                className="justify-start"
              >
                Selection Playground.ase (Marquee, Lasso, Magic Wand &amp; Saved Masks)
              </PixelButton>
              <PixelButton
                size="sm"
                onClick={() => openDemoDocument("transform_rotsprite_lab")}
                className="justify-start"
              >
                RotSprite Lab.ase (RotSprite 8x Scale2x vs Fast Nearest-Neighbor)
              </PixelButton>
              <PixelButton
                size="sm"
                onClick={() => openDemoDocument("palette_remap_lab")}
                className="justify-start"
              >
                Palette Remap Lab.ase (Indexed Mode + Per-Frame Day/Night Palette Spans)
              </PixelButton>
              <PixelButton
                size="sm"
                onClick={() => openDemoDocument("indexed_dither_compare")}
                className="justify-start"
              >
                Indexed Dither Compare.ase (RGBA vs Bayer 4x4 vs Floyd–Steinberg vs Old-Style)
              </PixelButton>
              <PixelButton
                size="sm"
                onClick={() => openDemoDocument("filters_gallery")}
                className="justify-start"
              >
                Filters Gallery.ase (Outline, Shadow, Hue/Sat, Invert, Emboss, Posterize)
              </PixelButton>
            </div>

            <SectionDivider label="Example Projects — Animation, Tilesets & Slices:" />
            <div className="flex flex-col gap-1.5">
              <PixelButton
                size="sm"
                onClick={() => openDemoDocument("walk_cycle")}
                className="justify-start"
              >
                Walk Cycle.ase (8 Frames, Tags: idle/walk/attack + nested subtag)
              </PixelButton>
              <PixelButton
                size="sm"
                onClick={() => openDemoDocument("onion_skin_lab")}
                className="justify-start"
              >
                Onion Skin Lab.ase (Red/Blue Onion Skin Ghosting &amp; Falloff)
              </PixelButton>
              <PixelButton
                size="sm"
                onClick={() => openDemoDocument("layer_groups_blends")}
                className="justify-start"
              >
                Layer Groups &amp; Blends.ase (Nested Groups, Reference Layer &amp; Z-Index)
              </PixelButton>
              <PixelButton
                size="sm"
                onClick={() => openDemoDocument("linked_cels_lab")}
                className="justify-start"
              >
                Linked Cels Lab.ase (Continuous Linked Cel Bars &amp; Shared Images)
              </PixelButton>
              <PixelButton
                size="sm"
                onClick={() => openDemoDocument("tilemap_dungeon")}
                className="justify-start"
              >
                Tilemap Dungeon.ase (16x16 Tileset + Tilemap Layer with Flip/Rotate)
              </PixelButton>
              <PixelButton
                size="sm"
                onClick={() => openDemoDocument("slices_9patch_ui")}
                className="justify-start"
              >
                Slices &amp; 9-Patch UI.ase (Slices, 9-Patch Guides, Pivot &amp; Animated Keys)
              </PixelButton>
            </div>

            <SectionDivider label="Starter Sprites:" />
            <div className="flex flex-wrap gap-1">
              <PixelButton size="xs" onClick={() => openDemoDocument("antihero")}>
                antihero.ase
              </PixelButton>
              <PixelButton size="xs" onClick={() => openDemoDocument("slime")}>
                slime_bounce.ase
              </PixelButton>
              <PixelButton size="xs" onClick={() => openDemoDocument("brush_showcase")}>
                brush_showcase.ase
              </PixelButton>
              <PixelButton size="xs" onClick={() => openDemoDocument("symmetry_playground")}>
                symmetry_playground.ase
              </PixelButton>
              <PixelButton size="xs" onClick={() => openDemoDocument("dithering_gradients")}>
                dithering_gradients.ase
              </PixelButton>
              <PixelButton size="xs" onClick={() => openDemoDocument("tiled_pattern")}>
                tiled_pattern.ase
              </PixelButton>
            </div>
          </div>

          {/* Right Column: Recent Files & Pinned Items (via PlatformAPI) */}
          <div className="space-y-3">
            <SectionDivider label="Recent Files (Click Pin to keep at top):" />
            <div className="kpx-bevel-inset bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] p-2 h-56 overflow-y-auto space-y-1">
              {sortedRecent.length === 0 && (
                <div className="text-xs opacity-70 p-1.5">No recent files yet.</div>
              )}
              {sortedRecent.map((file) => {
                const isPinned = pinnedPaths.includes(file.path);
                return (
                  <div
                    key={file.path}
                    className="w-full text-left p-1.5 hover:bg-black/10 flex items-center justify-between text-xs border-b border-black/10 gap-1"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        openDemoDocument(
                          file.name.includes("slime")
                            ? "slime"
                            : file.name.includes("antihero")
                            ? "antihero"
                            : "blend"
                        )
                      }
                      className="flex-1 text-left min-w-0 cursor-pointer"
                    >
                      <div className="font-bold truncate">
                        {isPinned ? "📌 " : ""}
                        {file.name}
                      </div>
                      <div className="text-[10px] opacity-70 truncate">{file.path}</div>
                    </button>
                    <span className="text-[10px] px-1.5 py-0.5 bg-black/10 shrink-0">
                      {file.width}x{file.height} {(file.colorMode ?? "rgba").toUpperCase()}
                    </span>
                    <PixelButton
                      size="xs"
                      active={isPinned}
                      title={isPinned ? "Unpin file" : "Pin file"}
                      onClick={() => void togglePin(file.path)}
                    >
                      Pin
                    </PixelButton>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer: project repository */}
        <div className="border-t border-black/30 pt-3 flex items-center justify-between gap-3 text-[11px]">
          <span className="opacity-70">Kekenik Pixel — open-source sprite studio</span>
          <button
            type="button"
            data-testid="home-repo-link"
            onClick={() => openExternalUrl(REPOSITORY_URL)}
            title={REPOSITORY_URL}
            className="underline hover:opacity-80 cursor-pointer text-[var(--kpx-text)] truncate"
          >
            {REPOSITORY_URL}
          </button>
        </div>
      </div>
    </div>
  );
};
