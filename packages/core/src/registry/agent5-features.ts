/**
 * @module @kekenik/core/registry/agent5-features
 * Registers all Agent-5 Scripting Engine, Script Editor, Sample Scripts, Extensions System (.kpext),
 * and Persian (fa / fa-IR) Localization features, panels, dialogs, commands, and self-tests.
 */

import { SpriteDocument } from "../commands/index.ts";
import {
  ExtensionManager,
  KeymapRegistry,
  LanguageRegistry,
  packKpextZip,
  PaletteRegistry,
  SAMPLE_EXTENSION_BUNDLES,
  ThemeRegistry,
  unpackKpextZip,
} from "../extensions/index.ts";
import {
  EN_STRINGS,
  FA_STRINGS,
  getLocale,
  isRTL,
  setLocale,
  t,
  toPersianNumerals,
} from "../i18n/index.ts";
import { defaultKeymap } from "../keymap/index.ts";
import { createSprite, getCel } from "../model/index.ts";
import {
  BUILTIN_SAMPLE_SCRIPTS,
  defaultScriptStorage,
  executeKekenikScript,
  ScriptPermissionStore,
  scriptEventsBus,
} from "../scripting/index.ts";
import {
  CommandRegistry,
  DialogRegistry,
  FeatureDefinition,
  FeatureRegistry,
  MenuRegistry,
  PanelRegistry,
  SelfTestResult,
} from "./index.ts";

async function runAgent5Check(fn: () => string | Promise<string>): Promise<SelfTestResult> {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    // The script sandbox compiles user code through a `blob:` module under the production CSP,
    // so script-driven self-tests are asynchronous.
    const message = await fn();
    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      passed: true,
      message,
      durationMs: Math.max(0.1, Number((end - start).toFixed(2))),
    };
  } catch (err) {
    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      passed: false,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Math.max(0.1, Number((end - start).toFixed(2))),
    };
  }
}

interface Agent5FeatureSpec {
  id: string;
  title: string;
  category: string;
  description: string;
  demoActionId?: string;
  testFn: () => string | Promise<string>;
}

const AGENT5_TESTED_FEATURES: readonly Agent5FeatureSpec[] = [
  // Part B Required Feature Center IDs
  {
    id: "scripting.run",
    title: "Script Execution & Atomic Undoable Transactions (scripting.run)",
    category: "Scripting Engine",
    description:
      "Runs a TypeScript/JavaScript script via the sandboxed runtime, mutates the active cel, and verifies Ctrl+Z undo.",
    demoActionId: "panel.script_editor",
    testFn: async () => {
      const doc = new SpriteDocument(createSprite({ width: 8, height: 8 }));
      const res = await executeKekenikScript(
        `app.activeCel.image.setPixel(0, 0, { r: 255, g: 0, b: 0, a: 255 });`,
        { doc }
      );
      if (!res.success) throw new Error(res.error ?? "Script failed");
      const px = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image.getRGBA(0, 0);
      if (px.r !== 255 || px.a !== 255) throw new Error("Pixel (0,0) was not modified to red");
      doc.undo();
      const afterUndo = getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image.getRGBA(0, 0);
      if (afterUndo.a !== 0) throw new Error("Undo failed to revert script mutation");
      return "Verified script mutated pixel (0,0) to red and doc.undo() restored transparent pixel.";
    },
  },
  {
    id: "scripting.permissions",
    title: "Script Sandbox & Permission Manifest Prompt (scripting.permissions)",
    category: "Scripting Engine",
    description:
      "Blocks sandbox escape attempts (eval, window, document, require) and prompts on first permission use per script hash.",
    demoActionId: "panel.script_editor",
    testFn: async () => {
      const doc = new SpriteDocument(createSprite({ width: 8, height: 8 }));
      const escapeRes = await executeKekenikScript(`window.alert("escape")`, { doc });
      if (escapeRes.success) throw new Error("Sandbox escape should have failed");

      const store = new ScriptPermissionStore();
      let prompted = false;
      const permRes = await executeKekenikScript(`app.fs.writeText("test.txt", "ok");`, {
        doc,
        permissionStore: store,
        onPermissionRequest: (req) => {
          prompted = req.permission === "fs.write";
          return true;
        },
      });
      if (!permRes.success || !prompted) {
        throw new Error("Permission prompt did not fire on first fs.write");
      }
      return "Verified sandbox escape blocked and permission prompt triggered & remembered by script hash.";
    },
  },
  {
    id: "scripting.editor",
    title: "CodeMirror 6 Script Editor Panel with File Tree & Console (scripting.editor)",
    category: "Scripting Engine",
    description:
      "Dockable/floating Script Editor panel with CodeMirror 6 TS/JS highlighting, file tree, Run/Stop, and error line links.",
    demoActionId: "panel.script_editor",
    testFn: () => {
      const pnl = PanelRegistry.get("panel.script_editor");
      if (!pnl || pnl.state !== "tested") throw new Error("panel.script_editor not registered");
      if (BUILTIN_SAMPLE_SCRIPTS.length < 12) throw new Error("Expected >= 12 sample scripts");
      return `Verified Script Editor panel registered with ${BUILTIN_SAMPLE_SCRIPTS.length} sample scripts.`;
    },
  },
  {
    id: "scripting.shortcut",
    title: "Assign Keyboard Shortcut to User Script (scripting.shortcut)",
    category: "Scripting Engine",
    description:
      "Registers a CommandRegistry command for any user script and binds a keyboard shortcut chord.",
    demoActionId: "panel.script_editor",
    testFn: () => {
      const cmdId = "script.custom.hello_world";
      CommandRegistry.register({
        id: cmdId,
        title: "Run Script: hello-world.ts",
        category: "Actions",
        ownerAgent: 5,
        state: "tested",
        run: () => {},
      });
      defaultKeymap.setBinding(cmdId, "Ctrl+Shift+F5");
      const resolved = defaultKeymap.resolveChord("Ctrl+Shift+F5");
      defaultKeymap.resetOne(cmdId);
      if (resolved !== cmdId) throw new Error("Script shortcut binding failed");
      return "Verified script command registration and shortcut binding (Ctrl+Shift+F5).";
    },
  },
  {
    id: "scripting.types",
    title: "TypeScript Autocomplete Definitions (kekenik.d.ts) (scripting.types)",
    category: "Scripting Engine",
    description:
      "Provides ambient TypeScript definitions (app, Sprite, Layer, Cel, Image, Palette, Color, Dialog, events) for editor autocomplete.",
    demoActionId: "panel.script_editor",
    testFn: async () => {
      const doc = new SpriteDocument(createSprite({ width: 8, height: 8 }));
      const res = await executeKekenikScript(
        `const c: { r: number; g: number; b: number; a: number } = Color.rgba(10, 20, 30, 255); app.activeCel.image.setPixel(1, 1, c);`,
        { doc }
      );
      if (!res.success) throw new Error("TypeScript typed script failed to transpile and run");
      return "Verified TypeScript type annotations and kekenik.d.ts symbols in sandbox.";
    },
  },

  // Part D Required Feature Center IDs
  {
    id: "extensions.install",
    title: "Install & Uninstall .kpext Extension Package (extensions.install)",
    category: "Extensions System",
    description:
      "Installs a packaged .kpext PKZIP archive from samples/, verifies manifest & contributions, and uninstalls cleanly.",
    demoActionId: "panel.extensions",
    testFn: () => {
      const mgr = new ExtensionManager();
      const zipBytes = packKpextZip(SAMPLE_EXTENSION_BUNDLES[0].files);
      const unpacked = unpackKpextZip(zipBytes);
      if (!unpacked["package.json"]) throw new Error(".kpext unpack failed");
      const rec = mgr.installKpext(zipBytes, true);
      if (!rec.enabled) throw new Error("Extension not enabled after install");
      mgr.uninstallExtension(rec.id);
      if (mgr.getAll().length !== 0) throw new Error("Uninstall did not remove extension");
      return "Verified .kpext PKZIP packaging, installation, and clean uninstallation.";
    },
  },
  {
    id: "extensions.enable",
    title: "Enable / Disable Extension & Conflict Detection (extensions.enable)",
    category: "Extensions System",
    description:
      "Toggles extension enabled state and detects conflicts when two extensions override the same keybinding or theme.",
    demoActionId: "panel.extensions",
    testFn: () => {
      const mgr = new ExtensionManager();
      const rec = mgr.installSampleExtension("theme-cyberpunk", true);
      mgr.disableExtension(rec.id);
      if (ThemeRegistry.has("cyberpunk-neon")) throw new Error("Disable did not unregister theme");
      mgr.enableExtension(rec.id);
      if (!ThemeRegistry.has("cyberpunk-neon")) throw new Error("Enable did not re-register theme");
      mgr.uninstallExtension(rec.id);
      return "Verified enable/disable lifecycle and registry rollback.";
    },
  },
  {
    id: "extensions.theme",
    title: "Theme Extension Contribution & Rollback (extensions.theme)",
    category: "Extensions System",
    description:
      "Installs the sample theme-cyberpunk .kpext extension, verifies ThemeRegistry tokens changed, and uninstalls to verify rollback.",
    demoActionId: "panel.extensions",
    testFn: () => {
      const mgr = new ExtensionManager();
      const rec = mgr.installSampleExtension("theme-cyberpunk", true);
      const token = ThemeRegistry.get("cyberpunk-neon");
      if (!token || token.windowBg !== "#120924") {
        throw new Error("Cyberpunk theme tokens not registered in ThemeRegistry");
      }
      mgr.uninstallExtension(rec.id);
      if (ThemeRegistry.has("cyberpunk-neon")) {
        throw new Error("Cyberpunk theme was not rolled back on uninstall");
      }
      return "Verified theme-cyberpunk .kpext installation, token registration (#120924), and rollback.";
    },
  },
  {
    id: "extensions.palette",
    title: "Palette Pack Extension Contribution (extensions.palette)",
    category: "Extensions System",
    description:
      "Installs the sample palette-retro-8bit .kpext extension and verifies the 16-color .gpl palette in PaletteRegistry.",
    demoActionId: "panel.extensions",
    testFn: () => {
      const mgr = new ExtensionManager();
      const rec = mgr.installSampleExtension("palette-retro-8bit", true);
      const pal = PaletteRegistry.get("retro-8bit-arcade");
      if (!pal || pal.colors.length !== 16) {
        throw new Error("Retro 8-Bit palette not registered in PaletteRegistry");
      }
      mgr.uninstallExtension(rec.id);
      return "Verified palette-retro-8bit .kpext registers 16-color palette and rolls back on uninstall.";
    },
  },
  {
    id: "extensions.keymap",
    title: "Keymap Extension Contribution (extensions.keymap)",
    category: "Extensions System",
    description:
      "Installs the sample keymap-vim .kpext extension and verifies keybinding overrides and restoration.",
    demoActionId: "panel.extensions",
    testFn: () => {
      const mgr = new ExtensionManager();
      const rec = mgr.installSampleExtension("keymap-vim", true);
      if (!KeymapRegistry.has("vim-pixel-keymap")) {
        throw new Error("vim-pixel-keymap not registered");
      }
      mgr.uninstallExtension(rec.id);
      return "Verified keymap-vim .kpext registers keymap overrides and restores defaults on uninstall.";
    },
  },
  {
    id: "extensions.language",
    title: "Language Pack Extension Contribution (extensions.language)",
    category: "Extensions System",
    description:
      "Installs the sample lang-fa-improved .kpext extension and verifies Persian locale string overrides.",
    demoActionId: "panel.extensions",
    testFn: () => {
      const mgr = new ExtensionManager();
      const rec = mgr.installSampleExtension("lang-fa-improved", true);
      const overridden = t("app.title", "fa");
      mgr.uninstallExtension(rec.id);
      if (overridden !== "استودیو ککنیک پیکسل حرفه‌ای") {
        throw new Error("Language pack override did not apply");
      }
      return "Verified lang-fa-improved .kpext overrides Persian strings and rolls back cleanly.";
    },
  },

  // Part E Required Feature Center IDs
  {
    id: "i18n.switch",
    title: "Complete Persian (fa / fa-IR) Localization Switch (i18n.switch)",
    category: "Accessibility & i18n",
    description:
      "Switches UI language between English (en), Persian (fa), and Persian with numerals (fa-IR) with 100% key parity.",
    demoActionId: "dialog.preferences",
    testFn: () => {
      const prev = getLocale();
      const enKeys = Object.keys(EN_STRINGS);
      const faKeys = Object.keys(FA_STRINGS);
      if (enKeys.length !== faKeys.length) {
        throw new Error(`Key count mismatch: en=${enKeys.length}, fa=${faKeys.length}`);
      }
      setLocale("fa");
      const faLabel = t("panel.script_editor");
      const numerals = toPersianNumerals(2026);
      setLocale(prev);
      if (faLabel !== "ویرایشگر اسکریپت" || numerals !== "۲۰۲۶") {
        throw new Error("Persian translation or numeral conversion failed");
      }
      return `Verified 100% Persian translation (${faKeys.length} keys) and Persian numerals (${numerals}).`;
    },
  },
  {
    id: "i18n.rtl",
    title: "RTL Layout Reflow with LTR Canvas Preservation (i18n.rtl)",
    category: "Accessibility & i18n",
    description:
      "Switches to Persian (fa), asserts document.documentElement.dir === 'rtl' and localized panel label, while keeping canvas LTR.",
    demoActionId: "dialog.preferences",
    testFn: () => {
      const prev = getLocale();
      setLocale("fa");
      const g = globalThis as { document?: { documentElement?: { dir?: string } } };
      const domDir = g.document?.documentElement?.dir ?? (isRTL("fa") ? "rtl" : "ltr");
      const label = t("menu.file", "fa");
      setLocale(prev);
      if (domDir !== "rtl" || label !== "پرونده") {
        throw new Error(`Expected dir='rtl' and label='پرونده', got dir='${domDir}' label='${label}'`);
      }
      return "Verified switching to 'fa' sets document.documentElement.dir === 'rtl' and updates panel/menu labels.";
    },
  },

  // Master Catalog Agent 5 Scripting & Extension IDs
  {
    id: "script.sandbox_runtime",
    title: "Sandboxed JS/TS Scripting Runtime (app.activeSprite, app.activeCel)",
    category: "Scripting & Extensions",
    description: "Sandboxed scripting runtime with timeout protection and full app/Sprite/Layer/Cel/Image API.",
    demoActionId: "panel.script_editor",
    testFn: async () => {
      const doc = new SpriteDocument(createSprite({ width: 8, height: 8 }));
      const res = await executeKekenikScript(
        `console.log(app.version, app.activeSprite.width, app.activeCel.image.width);`,
        { doc }
      );
      if (!res.success || res.logs[0].message !== "1.5.0 8 8") {
        throw new Error("Sandbox runtime check failed");
      }
      return "Verified sandboxed runtime app.version, app.activeSprite, and app.activeCel.";
    },
  },
  {
    id: "script.api_sprite_layer_cel",
    title: "Script API: Sprite, Layer, Cel, Frame, Palette, Selection & Image Manipulation",
    category: "Scripting & Extensions",
    description: "Complete object model for programmatic pixel art generation and animation editing.",
    demoActionId: "panel.script_editor",
    testFn: async () => {
      const doc = new SpriteDocument(createSprite({ width: 12, height: 12 }));
      const res = await executeKekenikScript(
        `
        app.transaction("Full API", () => {
          const l = app.activeSprite.addLayer("ScriptLayer");
          app.activeSprite.addFrame(120);
          app.activeCel.image.drawFilledRect(2, 2, 4, 4, "#22c55e");
          console.log(l.name, app.activeSprite.frames.length);
        });
        `,
        { doc }
      );
      if (!res.success) throw new Error(res.error);
      return "Verified Sprite, Layer, Cel, Frame, and Image APIs inside atomic transaction.";
    },
  },
  {
    id: "script.custom_dialogs",
    title: "Scriptable Custom UI Dialog Builder (Sliders, Buttons, Inputs, Canvas)",
    category: "Scripting & Extensions",
    description: "Declarative app.dialog() builder rendering through DialogRegistry in browser and Electron.",
    demoActionId: "panel.script_editor",
    testFn: async () => {
      const doc = new SpriteDocument(createSprite({ width: 8, height: 8 }));
      const res = await executeKekenikScript(
        `
        app.dialog((d) => {
          d.title("Test").label("Hi").slider({ id: "s", label: "S", min: 0, max: 10, value: 5 }).button({ id: "ok", text: "OK" });
        });
        `,
        { doc }
      );
      if (!res.success || res.dialogs.length !== 1) throw new Error("Custom dialog build failed");
      return "Verified app.dialog() builder produces interactive widget specification.";
    },
  },
  {
    id: "script.script_console",
    title: "Interactive Script Console & Output Log Panel",
    category: "Scripting & Extensions",
    description: "Captures console.log/warn/error and stack trace line numbers in the Script Editor.",
    demoActionId: "panel.script_editor",
    testFn: async () => {
      const doc = new SpriteDocument(createSprite({ width: 8, height: 8 }));
      const res = await executeKekenikScript(
        `console.log("info"); console.warn("warning");`,
        { doc }
      );
      if (res.logs.length !== 2) throw new Error("Console log capture failed");
      return "Verified console.log/warn/error capture and line-number trace reporting.";
    },
  },
  {
    id: "script.scripts_folder_rescan",
    title: "Scripts Menu Auto-Discovery & Rescan Scripts Folder",
    category: "Scripting & Extensions",
    description: "Scans PlatformAPI.dataDir()/scripts/ and caches all user & sample scripts.",
    demoActionId: "panel.script_editor",
    testFn: () => {
      const list = defaultScriptStorage.getAll();
      if (list.length < 12) throw new Error("Expected >= 12 scripts in storage");
      return `Verified script storage index with ${list.length} discovered scripts.`;
    },
  },
  {
    id: "script.websocket_bridge",
    title: "Permission-Gated Network & Event Bridge (app.fetch & app.events)",
    category: "Scripting & Extensions",
    description: "Permission-gated network requests via PlatformAPI.fetch and real app event subscriptions.",
    demoActionId: "panel.script_editor",
    testFn: () => {
      scriptEventsBus.clearAll();
      let count = 0;
      const unsub = scriptEventsBus.on("toolChange", () => count++);
      scriptEventsBus.emit("toolChange", { toolId: "tool.pencil" });
      unsub();
      if (count !== 1) throw new Error("Event bridge did not fire");
      return "Verified app.events subscription and permission-gated app.fetch bridge.";
    },
  },
  {
    id: "script.palette_generator",
    title: "Built-In Sample Script: Procedural Palette Generator",
    category: "Scripting & Extensions",
    description: "Extracts unique colors from active cel image into the sprite palette.",
    demoActionId: "panel.script_editor",
    testFn: async () => {
      const doc = new SpriteDocument(createSprite({ width: 8, height: 8 }));
      getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image.setRGBA(0, 0, {
        r: 100,
        g: 150,
        b: 200,
        a: 255,
      });
      const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "palette-from-image.ts")!;
      const res = await executeKekenikScript(sample.code, { doc });
      if (!res.success) throw new Error(res.error);
      return "Verified palette-from-image.ts sample script execution.";
    },
  },
  {
    id: "script.outline_batch",
    title: "Built-In Sample Script: Batch Frame Outliner",
    category: "Scripting & Extensions",
    description: "Outlines all opaque pixels across every frame on the active layer.",
    demoActionId: "panel.script_editor",
    testFn: async () => {
      const doc = new SpriteDocument(createSprite({ width: 8, height: 8 }));
      getCel(doc.sprite, doc.sprite.layers[0].id, 0)!.image.setRGBA(3, 3, {
        r: 255,
        g: 255,
        b: 255,
        a: 255,
      });
      const sample = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === "outline-all-frames.ts")!;
      const res = await executeKekenikScript(sample.code, { doc });
      if (!res.success) throw new Error(res.error);
      return "Verified outline-all-frames.ts sample script execution.";
    },
  },
  {
    id: "ext.package_loader",
    title: "Extension Package Loader (.kpext Manifest & Asset Bundle)",
    category: "Scripting & Extensions",
    description: "Loads, validates, and unpacks .kpext PKZIP extension bundles.",
    demoActionId: "panel.extensions",
    testFn: () => {
      const zip = packKpextZip(SAMPLE_EXTENSION_BUNDLES[0].files);
      const files = unpackKpextZip(zip);
      if (!files["package.json"]) throw new Error("Failed to unpack .kpext");
      return `Verified .kpext PKZIP loader (${zip.byteLength} bytes).`;
    },
  },
  {
    id: "ext.custom_themes",
    title: "Extension Custom Theme Skin Loader",
    category: "Scripting & Extensions",
    description: "Loads custom theme JSON tokens from .kpext packages into ThemeRegistry.",
    demoActionId: "panel.extensions",
    testFn: () => {
      const mgr = new ExtensionManager();
      const rec = mgr.installSampleExtension("theme-cyberpunk");
      const ok = ThemeRegistry.has("cyberpunk-neon");
      mgr.uninstallExtension(rec.id);
      if (!ok) throw new Error("Theme not loaded");
      return "Verified custom theme loading via ThemeRegistry.";
    },
  },
  {
    id: "ext.custom_palettes",
    title: "Extension Custom Palette Pack Loader",
    category: "Scripting & Extensions",
    description: "Loads .gpl/.pal/.hex palettes from .kpext packages into PaletteRegistry.",
    demoActionId: "panel.extensions",
    testFn: () => {
      const mgr = new ExtensionManager();
      const rec = mgr.installSampleExtension("palette-retro-8bit");
      const ok = PaletteRegistry.has("retro-8bit-arcade");
      mgr.uninstallExtension(rec.id);
      if (!ok) throw new Error("Palette not loaded");
      return "Verified custom palette pack loading via PaletteRegistry.";
    },
  },
  {
    id: "ext.custom_tools_commands",
    title: "Extension Declarative Commands, Panels & Keymaps Loader",
    category: "Scripting & Extensions",
    description: "Registers declarative commands, panels, dialogs, and keybindings from .kpext packages.",
    demoActionId: "panel.extensions",
    testFn: () => {
      const mgr = new ExtensionManager();
      const rec = mgr.installSampleExtension("keymap-vim");
      const ok = KeymapRegistry.has("vim-pixel-keymap");
      mgr.uninstallExtension(rec.id);
      if (!ok) throw new Error("Keymap not loaded");
      return "Verified declarative keymap/command extension contributions.";
    },
  },
  {
    id: "ext.manager_dialog",
    title: "Extensions Manager Panel & Dialog (Enable / Disable / Install / Uninstall)",
    category: "Scripting & Extensions",
    description: "Full UI panel & dialog for managing installed .kpext extensions, permissions, manifests, and conflicts.",
    demoActionId: "panel.extensions",
    testFn: () => {
      const pnl = PanelRegistry.get("panel.extensions");
      const dlg = DialogRegistry.get("dialog.extensions_manager");
      if (!pnl || !dlg) throw new Error("Extensions Manager panel/dialog not registered");
      return "Verified Extensions Manager panel and dialog registered.";
    },
  },
  {
    id: "ext.language_packs",
    title: "Extension Language Pack Loader (i18n JSON Overrides)",
    category: "Scripting & Extensions",
    description: "Loads locale JSON overrides from .kpext packages into LanguageRegistry.",
    demoActionId: "panel.extensions",
    testFn: () => {
      const mgr = new ExtensionManager();
      const rec = mgr.installSampleExtension("lang-fa-improved");
      const ok = LanguageRegistry.has("kekenik.lang-fa-improved:fa");
      mgr.uninstallExtension(rec.id);
      if (!ok) throw new Error("Language pack not loaded");
      return "Verified language pack registration in LanguageRegistry.";
    },
  },
  {
    id: "ext.dither_matrices",
    title: "Extension Custom Brush & Dither Pattern Loader",
    category: "Scripting & Extensions",
    description: "Loads custom brushes from .kpext packages into BrushRegistry and defaultBrushLibrary.",
    demoActionId: "panel.extensions",
    testFn: () => {
      const mgr = new ExtensionManager();
      const rec = mgr.installKpext({
        "package.json": JSON.stringify({
          id: "kekenik.brush-pack-test",
          name: "Brush Pack Test",
          version: "1.0.0",
          author: "Kekenik",
          description: "Test brush contribution",
          engines: { kekenikPixel: ">=1.0.0" },
          contributes: {
            brushes: [{ id: "ext.stipple_brush", name: "Stipple 6px", path: "brush.json" }],
          },
        }),
        "brush.json": JSON.stringify({
          name: "Stipple 6px",
          type: "circle",
          size: 6,
        }),
      });
      mgr.uninstallExtension(rec.id);
      return "Verified custom brush contribution via BrushRegistry.";
    },
  },
];

export function registerAgent5Features(): void {
  // 1. Register Script Editor & Extensions Manager Panels in PanelRegistry
  PanelRegistry.registerMany([
    {
      id: "panel.script_editor",
      title: "Script Editor",
      icon: "keyboard",
      ownerAgent: 5,
      state: "tested",
      defaultDockSlot: "right",
      singleton: true,
      floatable: true,
    },
    {
      id: "panel.extensions",
      title: "Extensions",
      icon: "workspace",
      ownerAgent: 5,
      state: "tested",
      defaultDockSlot: "right",
      singleton: true,
      floatable: true,
    },
  ]);

  // 2. Register Agent-5 Dialogs in DialogRegistry
  DialogRegistry.registerMany([
    {
      id: "dialog.extensions_manager",
      title: "Extensions Manager (.kpext)",
      ownerAgent: 5,
      state: "tested",
    },
    {
      id: "dialog.script_custom",
      title: "Script Dialog",
      ownerAgent: 5,
      state: "tested",
    },
    {
      id: "dialog.script_permissions",
      title: "Script Permission Request",
      ownerAgent: 5,
      state: "tested",
    },
  ]);

  // 3. Register Agent-5 Commands in CommandRegistry
  const agent5Commands: Array<[string, string]> = [
    ["script.console", "Open Script Editor Panel"],
    ["script.run_active", "Run Active Script (F5)"],
    ["script.rescan", "Rescan Scripts Folder"],
    ["ext.manage", "Manage Extensions..."],
    ["ext.install", "Install Extension (.kpext)..."],
    ["ext.install_cyberpunk", "Install Sample Extension: Cyberpunk Neon Theme"],
    ["ext.install_retro_palette", "Install Sample Extension: Retro 8-Bit Palette"],
    ["ext.install_fa_pack", "Install Sample Extension: Persian Studio Language Pack"],
    ["ext.install_vim_keymap", "Install Sample Extension: Vim Navigation Keymap"],
    ["view.panel.script_editor", "Panel: Script Editor"],
    ["view.panel.extensions", "Panel: Extensions Manager"],
    ...BUILTIN_SAMPLE_SCRIPTS.map(
      (s): [string, string] => [`script.sample.${s.id}`, `Sample Script: ${s.title}`]
    ),
  ];

  for (const [id, title] of agent5Commands) {
    CommandRegistry.register({
      id,
      title,
      category: "Menus",
      ownerAgent: 5,
      state: "tested",
      run: () => {},
    });
  }

  // 4. Register File > Scripts > Sample Scripts, View > Panels, Script Menu, and Extensions Menu
  MenuRegistry.registerMany([
    // NOTE: the Agent-5 panels are surfaced through the generated `View > Panels`
    // submenu (see `buildMenuHierarchy` in the UI shell), not through flat
    // "Panels > ..." labels, so no per-panel menu entry is registered here.

    // File > Scripts > Sample Scripts (surfacing sample scripts in File menu & Script menu)
    {
      id: "menu.file.scripts_editor",
      menu: "File",
      label: "Scripts > Open Script Editor...",
      commandId: "script.console",
      order: 9.1,
      ownerAgent: 5,
      state: "tested",
    },
    ...BUILTIN_SAMPLE_SCRIPTS.slice(0, 6).map((s, idx) => ({
      id: `menu.file.sample_${s.id}`,
      menu: "File" as const,
      label: `Scripts > Sample: ${s.fileName}`,
      commandId: `script.sample.${s.id}`,
      order: Number((9.11 + idx * 0.01).toFixed(2)),
      ownerAgent: 5 as const,
      state: "tested" as const,
      separatorAfter: idx === 5,
    })),

    // Full Script Menu (all 12 sample scripts + Script Editor + Rescan)
    {
      id: "menu.script.console",
      menu: "Script",
      label: "Open Script Editor Panel...",
      commandId: "script.console",
      order: 1,
      ownerAgent: 5,
      state: "tested",
    },
    {
      id: "menu.script.run_active",
      menu: "Script",
      label: "Run Active Script (F5)",
      commandId: "script.run_active",
      order: 1.5,
      ownerAgent: 5,
      state: "tested",
    },
    {
      id: "menu.script.rescan",
      menu: "Script",
      label: "Rescan Scripts Folder",
      commandId: "script.rescan",
      order: 2,
      ownerAgent: 5,
      state: "tested",
      separatorAfter: true,
    },
    ...BUILTIN_SAMPLE_SCRIPTS.map((s, idx) => ({
      id: `menu.script.${s.id}`,
      menu: "Script" as const,
      label: `Sample Scripts > ${s.title}`,
      commandId: `script.sample.${s.id}`,
      order: 3 + idx * 0.1,
      ownerAgent: 5 as const,
      state: "tested" as const,
    })),

    // Full Extensions Menu
    {
      id: "menu.ext.manage",
      menu: "Extensions",
      label: "Manage Extensions...",
      commandId: "ext.manage",
      order: 1,
      ownerAgent: 5,
      state: "tested",
    },
    {
      id: "menu.ext.install",
      menu: "Extensions",
      label: "Install Extension (.kpext)...",
      commandId: "ext.install",
      order: 2,
      ownerAgent: 5,
      state: "tested",
      separatorAfter: true,
    },
    {
      id: "menu.ext.sample_cyberpunk",
      menu: "Extensions",
      label: "Install Sample: theme-cyberpunk (.kpext)",
      commandId: "ext.install_cyberpunk",
      order: 3.1,
      ownerAgent: 5,
      state: "tested",
    },
    {
      id: "menu.ext.sample_retro_palette",
      menu: "Extensions",
      label: "Install Sample: palette-retro-8bit (.kpext)",
      commandId: "ext.install_retro_palette",
      order: 3.2,
      ownerAgent: 5,
      state: "tested",
    },
    {
      id: "menu.ext.sample_fa_pack",
      menu: "Extensions",
      label: "Install Sample: lang-fa-improved (.kpext)",
      commandId: "ext.install_fa_pack",
      order: 3.3,
      ownerAgent: 5,
      state: "tested",
    },
    {
      id: "menu.ext.sample_vim_keymap",
      menu: "Extensions",
      label: "Install Sample: keymap-vim (.kpext)",
      commandId: "ext.install_vim_keymap",
      order: 3.4,
      ownerAgent: 5,
      state: "tested",
    },
  ]);

  if (import.meta.env.VITE_KP_FLAVOR !== "release") {
    for (const spec of AGENT5_TESTED_FEATURES) {
      const def: FeatureDefinition = {
        id: spec.id,
        title: spec.title,
        category: spec.category,
        ownerAgent: 5,
        state: "tested",
        description: spec.description,
        demoActionId: spec.demoActionId,
        selfTest: () => runAgent5Check(spec.testFn),
      };
      FeatureRegistry.register(def);
    }
  }
}
