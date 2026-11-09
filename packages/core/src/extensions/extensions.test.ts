/**
 * @module @kekenik/core/extensions/extensions.test
 * Unit tests for .kpext packaging, manifest validation, 5 extension registries, conflict detection, and i18n.
 */

import { describe, expect, it } from "vitest";
import {
  EN_STRINGS,
  FA_STRINGS,
  formatLocalizedNumber,
  isRTL,
  setLocale,
  t,
  toPersianNumerals,
} from "../i18n/index.ts";
import { defaultKeymap } from "../keymap/index.ts";
import {
  ExtensionManager,
  KeymapRegistry,
  LanguageRegistry,
  packKpextZip,
  PaletteRegistry,
  SAMPLE_EXTENSION_BUNDLES,
  ThemeRegistry,
  unpackKpextZip,
  validateExtensionManifest,
} from "./index.ts";

describe("Kekenik Extensions System & Persian i18n (Part D & Part E)", () => {
  it("1. packs and unpacks a binary PKZIP .kpext archive losslessly", () => {
    const sample = SAMPLE_EXTENSION_BUNDLES[0];
    const zipBytes = packKpextZip(sample.files);
    expect(zipBytes[0]).toBe(0x50); // 'P'
    expect(zipBytes[1]).toBe(0x4b); // 'K'
    const unpacked = unpackKpextZip(zipBytes);
    expect(Object.keys(unpacked)).toEqual(["package.json", "cyberpunk-theme.json"]);
    expect(JSON.parse(unpacked["package.json"]).id).toBe("kekenik.theme-cyberpunk");
  });

  it("2. validates valid extension manifests and rejects invalid manifests", () => {
    const validPkg = JSON.parse(SAMPLE_EXTENSION_BUNDLES[0].files["package.json"]);
    const res1 = validateExtensionManifest(validPkg);
    expect(res1.valid).toBe(true);
    expect(res1.errors.length).toBe(0);

    const res2 = validateExtensionManifest({ id: "bad id!", version: "not-semver" });
    expect(res2.valid).toBe(false);
    expect(res2.errors.length).toBeGreaterThan(2);
  });

  it("3. installs theme-cyberpunk .kpext, registers theme tokens, and rolls back on uninstall", () => {
    const mgr = new ExtensionManager();
    expect(ThemeRegistry.has("cyberpunk-neon")).toBe(false);

    const rec = mgr.installSampleExtension("theme-cyberpunk");
    expect(rec.enabled).toBe(true);
    expect(ThemeRegistry.has("cyberpunk-neon")).toBe(true);
    expect(ThemeRegistry.get("cyberpunk-neon")?.windowBg).toBe("#120924");

    mgr.disableExtension(rec.id);
    expect(ThemeRegistry.has("cyberpunk-neon")).toBe(false);

    mgr.enableExtension(rec.id);
    expect(ThemeRegistry.has("cyberpunk-neon")).toBe(true);

    mgr.uninstallExtension(rec.id);
    expect(ThemeRegistry.has("cyberpunk-neon")).toBe(false);
    expect(mgr.getAll().length).toBe(0);
  });

  it("4. installs palette-retro-8bit .kpext and registers 16-color palette in PaletteRegistry", () => {
    const mgr = new ExtensionManager();
    const rec = mgr.installSampleExtension("palette-retro-8bit");
    expect(PaletteRegistry.has("retro-8bit-arcade")).toBe(true);
    const pal = PaletteRegistry.get("retro-8bit-arcade")!;
    expect(pal.colors.length).toBe(16);
    mgr.uninstallExtension(rec.id);
    expect(PaletteRegistry.has("retro-8bit-arcade")).toBe(false);
  });

  it("5. installs lang-fa-improved .kpext and overrides Persian translations, rolling back on disable", () => {
    const mgr = new ExtensionManager();
    setLocale("fa");
    const defaultTitle = t("app.title", "fa");
    const rec = mgr.installSampleExtension("lang-fa-improved");
    expect(LanguageRegistry.has("kekenik.lang-fa-improved:fa")).toBe(true);
    expect(t("app.title", "fa")).toBe("استودیو ککنیک پیکسل حرفه‌ای");

    mgr.uninstallExtension(rec.id);
    expect(t("app.title", "fa")).toBe(defaultTitle);
    setLocale("en");
  });

  it("6. installs keymap-vim .kpext, overrides keybindings, and restores original bindings on uninstall", () => {
    const mgr = new ExtensionManager();
    const rec = mgr.installSampleExtension("keymap-vim");
    expect(KeymapRegistry.has("vim-pixel-keymap")).toBe(true);
    const prevBinding = defaultKeymap.getAll().find((k) => k.commandId === "frame.prev");
    expect(prevBinding?.keys).toBe("Ctrl+H");

    mgr.uninstallExtension(rec.id);
    expect(KeymapRegistry.has("vim-pixel-keymap")).toBe(false);
  });

  it("7. detects conflicts when two enabled extensions override the same keybinding or theme ID", () => {
    const mgr = new ExtensionManager();
    mgr.installSampleExtension("keymap-vim");
    mgr.installKpext({
      "package.json": JSON.stringify({
        id: "kekenik.keymap-conflict-test",
        name: "Conflict Keymap Test",
        version: "1.0.0",
        author: "QA",
        description: "Overrides frame.prev to test conflict detector",
        engines: { kekenikPixel: ">=1.0.0" },
        contributes: {
          keymaps: [{ id: "conflict-km", name: "Conflict", path: "km.json" }],
        },
      }),
      "km.json": JSON.stringify({
        bindings: [{ commandId: "frame.prev", keys: "Alt+Left" }],
      }),
    });

    const conflicts = mgr.detectConflicts();
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].kind).toBe("keybinding");
    expect(conflicts[0].targetId).toBe("frame.prev");

    mgr.uninstallExtension("kekenik.keymap-conflict-test");
    mgr.uninstallExtension("kekenik.keymap-vim");
  });

  it("8. verifies 100% key parity between en.json and fa.json plus Persian numerals (fa-IR)", () => {
    const enKeys = Object.keys(EN_STRINGS).sort();
    const faKeys = Object.keys(FA_STRINGS).sort();
    expect(faKeys).toEqual(enKeys);

    expect(isRTL("en")).toBe(false);
    expect(isRTL("fa")).toBe(true);
    expect(isRTL("fa-IR")).toBe(true);
    expect(toPersianNumerals("1234567890")).toBe("۱۲۳۴۵۶۷۸۹۰");
    expect(formatLocalizedNumber(512, "fa-IR")).toBe("۵۱۲");
    expect(formatLocalizedNumber(512, "en")).toBe("512");
  });
});
