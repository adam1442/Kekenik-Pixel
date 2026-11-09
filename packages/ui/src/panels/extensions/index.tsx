/**
 * @module @kekenik/ui/panels/extensions
 * Part D: Extensions Manager Panel & Dialog (.kpext installer, 4 bundled sample extensions,
 * enable/disable/uninstall, manifest & permission inspector, active contributions list,
 * and conflict detection warnings).
 */

import React, { useState } from "react";
import {
  KeymapRegistry,
  LanguageRegistry,
  PaletteRegistry,
  SAMPLE_EXTENSION_BUNDLES,
  t,
  ThemeRegistry,
  UpdatePaletteAndRemapCommand,
} from "../../../../core/src/index.ts";
import { useAppStore } from "../../app/store.ts";
import { PixelIcon } from "../../skin/index.tsx";
import { PixelButton, PixelDialog, SectionDivider } from "../../widgets/index.tsx";

export const ExtensionsManagerPanel: React.FC = () => {
  const installedExtensions = useAppStore((s) => s.installedExtensions);
  const extensionConflicts = useAppStore((s) => s.extensionConflicts);
  const theme = useAppStore((s) => s.theme);
  const locale = useAppStore((s) => s.locale);
  const rev = useAppStore((s) => s.docRevision);

  const installExtensionFromDisk = useAppStore((s) => s.installExtensionFromDisk);
  const installSampleExtensionById = useAppStore((s) => s.installSampleExtensionById);
  const toggleExtensionEnabled = useAppStore((s) => s.toggleExtensionEnabled);
  const uninstallExtensionById = useAppStore((s) => s.uninstallExtensionById);
  const reloadAllExtensions = useAppStore((s) => s.reloadAllExtensions);
  const exportSampleKpextToDisk = useAppStore((s) => s.exportSampleKpextToDisk);
  const setTheme = useAppStore((s) => s.setTheme);
  const setLocaleCode = useAppStore((s) => s.setLocaleCode);
  const getActiveDocument = useAppStore((s) => s.getActiveDocument);
  const bumpRevision = useAppStore((s) => s.bumpRevision);

  const [selectedExtId, setSelectedExtId] = useState<string | null>(null);
  const [showManifestModal, setShowManifestModal] = useState(false);

  void rev;

  const selectedExt =
    installedExtensions.find((e) => e.id === selectedExtId) ?? installedExtensions[0] ?? null;

  const customThemes = ThemeRegistry.getAll().filter((th) => Boolean(th.originExtensionId));
  const customPalettes = PaletteRegistry.getAll().filter((p) => Boolean(p.originExtensionId));
  const customKeymaps = KeymapRegistry.getAll().filter((k) => Boolean(k.originExtensionId));
  const customLanguages = LanguageRegistry.getAll().filter((l) => Boolean(l.originExtensionId));

  const applyExtensionPaletteToSprite = (palId: string) => {
    const doc = getActiveDocument();
    const pal = PaletteRegistry.get(palId);
    if (!doc || !pal) return;
    const nextPalettes = doc.sprite.palettes.map((p, i) =>
      i === 0 ? { ...p, colors: pal.colors.map((c) => ({ ...c })) } : p
    );
    doc.execute(
      new UpdatePaletteAndRemapCommand({
        label: `Apply Extension Palette "${pal.name}"`,
        nextPalettes,
        remapPixels: false,
      })
    );
    bumpRevision();
  };

  return (
    <div className="flex flex-col h-full p-1.5 gap-2 text-xs font-mono select-none overflow-y-auto">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-1 bg-[var(--kpx-chrome-bg)] p-1 border border-black text-black">
        <div className="flex flex-wrap items-center gap-1">
          <PixelButton
            size="xs"
            onClick={() => void installExtensionFromDisk()}
            title="Install .kpext Extension Package from File"
          >
            <PixelIcon name="folder" size={10} />
            <span>{t("ext.manager.install_file", locale)}</span>
          </PixelButton>
          <PixelButton
            size="xs"
            onClick={reloadAllExtensions}
            title="Reload All Enabled Extensions"
          >
            <PixelIcon name="history" size={10} />
            <span>{t("common.reload", locale)}</span>
          </PixelButton>
        </div>
        <span className="text-[10px] font-bold">
          Installed: {installedExtensions.length}
        </span>
      </div>

      {/* Conflict Warnings Banner */}
      {extensionConflicts.length > 0 && (
        <div className="p-1.5 bg-amber-900/80 text-amber-100 border border-amber-400 space-y-0.5 text-[10px]">
          <div className="font-bold flex items-center gap-1">
            <PixelIcon name="warning" size={11} />
            <span>{t("ext.manager.conflicts", locale)}:</span>
          </div>
          {extensionConflicts.map((c, idx) => (
            <div key={idx}>• {c.message}</div>
          ))}
        </div>
      )}

      {/* 4 Bundled Sample Extensions (`samples/extensions/*`) */}
      <div className="space-y-1 kpx-bevel-inset bg-black/10 p-1.5">
        <div className="font-bold text-[11px]">
          Sample Extensions (`samples/extensions/*.kpext`):
        </div>
        <div className="grid grid-cols-2 gap-1">
          {SAMPLE_EXTENSION_BUNDLES.map((sample) => {
            const isInstalled = installedExtensions.some((i) => i.id === sample.id);
            return (
              <div
                key={sample.id}
                className="flex items-center justify-between gap-1 p-1 bg-[var(--kpx-btn-bg)] text-black border border-black/30"
              >
                <span className="truncate text-[10px] font-bold" title={sample.id}>
                  {sample.folderName}
                </span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <PixelButton
                    size="xs"
                    onClick={() => installSampleExtensionById(sample.folderName)}
                    title={`Install & Enable ${sample.folderName}.kpext`}
                  >
                    {isInstalled ? "Reinstall" : t("common.install", locale)}
                  </PixelButton>
                  <PixelButton
                    size="xs"
                    onClick={() => void exportSampleKpextToDisk(sample.folderName)}
                    title={`Download ${sample.folderName}.kpext archive`}
                  >
                    <PixelIcon name="download" size={9} />
                  </PixelButton>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Installed Extensions List */}
      <SectionDivider label={`Installed Extensions (${installedExtensions.length}):`} />
      {installedExtensions.length === 0 ? (
        <div className="p-2 text-[11px] opacity-75 kpx-bevel-inset bg-black/5">
          No extensions installed yet. Click any Sample Extension above or &quot;Install from .kpext
          File...&quot; to test live themes, palettes, keymaps, or language packs!
        </div>
      ) : (
        <div className="space-y-1">
          {installedExtensions.map((ext) => {
            const isSel = selectedExt?.id === ext.id;
            return (
              <div
                key={ext.id}
                onClick={() => setSelectedExtId(ext.id)}
                className={`p-1.5 border cursor-pointer flex items-center justify-between gap-1 ${
                  isSel
                    ? "bg-[var(--kpx-accent-bg)] text-white border-black"
                    : "bg-[var(--kpx-input-bg)] text-[var(--kpx-input-text)] border-black/30"
                }`}
              >
                <div className="min-w-0">
                  <div className="font-bold truncate">
                    {ext.manifest.name}{" "}
                    <span className="text-[10px] opacity-80">v{ext.manifest.version}</span>
                  </div>
                  <div className="text-[10px] opacity-80 truncate">
                    {ext.id} • by {ext.manifest.author} •{" "}
                    {ext.enabled ? "ENABLED" : "DISABLED"}
                  </div>
                </div>
                <div
                  className="flex items-center gap-1 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <PixelButton
                    size="xs"
                    onClick={() => toggleExtensionEnabled(ext.id)}
                  >
                    {ext.enabled ? t("common.disable", locale) : t("common.enable", locale)}
                  </PixelButton>
                  <PixelButton
                    size="xs"
                    onClick={() => uninstallExtensionById(ext.id)}
                  >
                    {t("common.uninstall", locale)}
                  </PixelButton>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Extension Details, Permissions & Manifest Inspector */}
      {selectedExt && (
        <div className="p-2 kpx-bevel-inset bg-[#181820] text-slate-200 space-y-1 text-[10px]">
          <div className="flex items-center justify-between border-b border-white/15 pb-1">
            <span className="font-bold text-amber-300">
              {selectedExt.manifest.name} ({selectedExt.id})
            </span>
            <PixelButton
              size="xs"
              onClick={() => setShowManifestModal(!showManifestModal)}
            >
              {t("ext.manager.manifest", locale)}
            </PixelButton>
          </div>
          <div>Description: {selectedExt.manifest.description}</div>
          <div>
            Engine Range: {selectedExt.manifest.engines.kekenikPixel} | Permissions:{" "}
            {(selectedExt.manifest.permissions ?? []).length > 0
              ? selectedExt.manifest.permissions?.join(", ")
              : "None (Declarative Safe)"}
          </div>
          {showManifestModal && (
            <pre className="p-1.5 bg-black/70 text-emerald-300 overflow-x-auto max-h-32 text-[9px]">
              {selectedExt.files["package.json"]}
            </pre>
          )}
        </div>
      )}

      {/* Active Contributions Summary with Origin & Quick Actions */}
      <SectionDivider label={`${t("ext.manager.contributions", locale)}:`} />
      <div className="space-y-1 text-[10px]">
        {customThemes.map((th) => (
          <div
            key={th.id}
            className="flex items-center justify-between p-1 bg-black/10 border border-black/20"
          >
            <span>
              [Theme] <strong>{th.name}</strong> (from {th.originExtensionId})
            </span>
            <PixelButton
              size="xs"
              active={theme === th.id}
              onClick={() => setTheme(th.id)}
            >
              {theme === th.id ? "Active Skin" : "Apply Skin"}
            </PixelButton>
          </div>
        ))}
        {customPalettes.map((pal) => (
          <div
            key={pal.id}
            className="flex items-center justify-between p-1 bg-black/10 border border-black/20"
          >
            <span>
              [Palette] <strong>{pal.name}</strong> ({pal.colors.length} cols, from{" "}
              {pal.originExtensionId})
            </span>
            <PixelButton
              size="xs"
              onClick={() => applyExtensionPaletteToSprite(pal.id)}
            >
              Apply to Sprite
            </PixelButton>
          </div>
        ))}
        {customKeymaps.map((km) => (
          <div
            key={km.id}
            className="flex items-center justify-between p-1 bg-black/10 border border-black/20"
          >
            <span>
              [Keymap] <strong>{km.name}</strong> ({km.bindings.length} bindings, from{" "}
              {km.originExtensionId})
            </span>
          </div>
        ))}
        {customLanguages.map((lg) => (
          <div
            key={lg.id}
            className="flex items-center justify-between p-1 bg-black/10 border border-black/20"
          >
            <span>
              [Language] <strong>{lg.name}</strong> ({lg.locale}, from {lg.originExtensionId})
            </span>
            <PixelButton size="xs" onClick={() => setLocaleCode("fa")}>
              Switch to FA
            </PixelButton>
          </div>
        ))}
      </div>
    </div>
  );
};

export const ExtensionsManagerDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const locale = useAppStore((s) => s.locale);
  return (
    <PixelDialog
      title={t("ext.manager.title", locale)}
      onClose={onClose}
      widthClass="w-[620px]"
    >
      <div className="h-[420px] flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ExtensionsManagerPanel />
        </div>
        <div className="flex justify-end pt-2 border-t border-black/20 mt-2">
          <PixelButton onClick={onClose}>{t("common.close", locale)}</PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};
