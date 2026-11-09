/**
 * @module @kekenik/core/extensions
 * Complete Extensions System (.kpext PKZIP format, Manifest Validator, 5 Extension Registries,
 * Conflict Detector, and Extension Lifecycle Manager).
 * Zero DOM or Electron imports.
 */

import { BrushConfig, defaultBrushLibrary } from "../brush/index.ts";
import { registerLocaleOverrides, unregisterLocaleOverrides } from "../i18n/index.ts";
import { defaultKeymap } from "../keymap/index.ts";
import {
  BUILTIN_PALETTE_PRESETS,
  decodeGplPalette,
  decodeHexPalette,
  decodeJascPalPalette,
} from "../palette/index.ts";
import { appLogger } from "../platform/index.ts";
import {
  CommandRegistry,
  DialogRegistry,
  PanelRegistry,
  Registry,
} from "../registry/index.ts";
import { RGBA } from "../util/index.ts";

// ---------------------------------------------------------------------------
// 1. Extension Contribution Registries
// ---------------------------------------------------------------------------

export interface ExtensionThemeTokens {
  readonly id: string;
  readonly name: string;
  readonly windowBg: string;
  readonly chromeBg: string;
  readonly panelBg: string;
  readonly headerBg: string;
  readonly headerActiveBg: string;
  readonly headerText: string;
  readonly canvasSurroundBg: string;
  readonly inputBg: string;
  readonly inputText: string;
  readonly textPrimary: string;
  readonly textMuted: string;
  readonly accentBg: string;
  readonly accentText: string;
  readonly borderOuter: string;
  readonly bevelLight: string;
  readonly bevelDark: string;
  readonly buttonBg: string;
  readonly buttonActiveBg: string;
  readonly tabActiveBg: string;
  readonly tabInactiveBg: string;
  readonly timelineRowBg: string;
  readonly timelineRowAltBg: string;
  readonly timelineSelectedBg: string;
  readonly spacing?: { xs: number; sm: number; md: number };
  readonly radii?: { none: number; sm: number };
  readonly originExtensionId?: string;
}

export interface ExtensionPaletteDefinition {
  readonly id: string;
  readonly name: string;
  readonly colors: RGBA[];
  readonly originExtensionId?: string;
}

export interface ExtensionBrushDefinition {
  readonly id: string;
  readonly name: string;
  readonly config: BrushConfig;
  readonly originExtensionId?: string;
}

export interface ExtensionKeymapDefinition {
  readonly id: string;
  readonly name: string;
  readonly bindings: ReadonlyArray<{ commandId: string; keys: string }>;
  readonly originExtensionId?: string;
}

export interface ExtensionLanguageDefinition {
  readonly id: string;
  readonly locale: string;
  readonly name: string;
  readonly strings: Record<string, string>;
  readonly originExtensionId?: string;
}

export const ThemeRegistry = new Registry<ExtensionThemeTokens>("ThemeRegistry");
export const PaletteRegistry = new Registry<ExtensionPaletteDefinition>("PaletteRegistry");
export const BrushRegistry = new Registry<ExtensionBrushDefinition>("BrushRegistry");
export const KeymapRegistry = new Registry<ExtensionKeymapDefinition>("KeymapRegistry");
export const LanguageRegistry = new Registry<ExtensionLanguageDefinition>("LanguageRegistry");

// Seed built-in themes into ThemeRegistry
ThemeRegistry.registerMany([
  {
    id: "default-dark",
    name: "Default Dark (Slate & Warm Gray)",
    windowBg: "#49434d",
    chromeBg: "#7d929e",
    panelBg: "#c9c1b9",
    headerBg: "#6a8190",
    headerActiveBg: "#516b7d",
    headerText: "#ffffff",
    canvasSurroundBg: "#5b5360",
    inputBg: "#ffffff",
    inputText: "#18181b",
    textPrimary: "#141418",
    textMuted: "#47434a",
    accentBg: "#355d7a",
    accentText: "#ffffff",
    borderOuter: "#17151a",
    bevelLight: "#f2ece6",
    bevelDark: "#6d6661",
    buttonBg: "#d4cdc6",
    buttonActiveBg: "#6a8190",
    tabActiveBg: "#7d929e",
    tabInactiveBg: "#b5ada5",
    timelineRowBg: "#bab2aa",
    timelineRowAltBg: "#b0a8a0",
    timelineSelectedBg: "#6a8190",
  },
  {
    id: "classic-light",
    name: "Classic Light (Warm Putty)",
    windowBg: "#bdb5ad",
    chromeBg: "#8ba0ad",
    panelBg: "#dfd8d0",
    headerBg: "#788f9e",
    headerActiveBg: "#5a7586",
    headerText: "#ffffff",
    canvasSurroundBg: "#7a727e",
    inputBg: "#ffffff",
    inputText: "#111111",
    textPrimary: "#111111",
    textMuted: "#4f4a45",
    accentBg: "#2e5f85",
    accentText: "#ffffff",
    borderOuter: "#1c1917",
    bevelLight: "#ffffff",
    bevelDark: "#7c756e",
    buttonBg: "#e7e1da",
    buttonActiveBg: "#788f9e",
    tabActiveBg: "#8ba0ad",
    tabInactiveBg: "#c9c1b9",
    timelineRowBg: "#d4cdc5",
    timelineRowAltBg: "#c9c1b9",
    timelineSelectedBg: "#6d8696",
  },
  {
    id: "high-contrast",
    name: "High Contrast (Midnight Pixel)",
    windowBg: "#0f1218",
    chromeBg: "#1b2432",
    panelBg: "#1e2633",
    headerBg: "#253449",
    headerActiveBg: "#0284c7",
    headerText: "#f8fafc",
    canvasSurroundBg: "#090b10",
    inputBg: "#0b0f17",
    inputText: "#f8fafc",
    textPrimary: "#f1f5f9",
    textMuted: "#94a3b8",
    accentBg: "#0284c7",
    accentText: "#ffffff",
    borderOuter: "#000000",
    bevelLight: "#475569",
    bevelDark: "#020617",
    buttonBg: "#283446",
    buttonActiveBg: "#0284c7",
    tabActiveBg: "#1b2432",
    tabInactiveBg: "#111722",
    timelineRowBg: "#18202c",
    timelineRowAltBg: "#141b26",
    timelineSelectedBg: "#0369a1",
  },
]);

// Seed built-in palettes into PaletteRegistry
for (const p of BUILTIN_PALETTE_PRESETS) {
  PaletteRegistry.register({
    id: p.id,
    name: p.name,
    colors: p.colors.map((c) => ({ ...c })),
  });
}

// ---------------------------------------------------------------------------
// 2. `.kpext` Manifest Schema & Validation
// ---------------------------------------------------------------------------

export interface ExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly description: string;
  readonly engines: {
    readonly kekenikPixel: string;
  };
  readonly permissions?: readonly string[];
  readonly contributes: {
    readonly themes?: ReadonlyArray<{ id: string; name: string; path: string }>;
    readonly palettes?: ReadonlyArray<{ id: string; name: string; path: string }>;
    readonly brushes?: ReadonlyArray<{ id: string; name: string; path: string }>;
    readonly keymaps?: ReadonlyArray<{ id: string; name: string; path: string }>;
    readonly scripts?: ReadonlyArray<{ id: string; title: string; path: string }>;
    readonly languages?: ReadonlyArray<{ locale: string; name: string; path: string }>;
    readonly commands?: ReadonlyArray<{ id: string; title: string; scriptPath?: string }>;
    readonly dialogs?: ReadonlyArray<{ id: string; title: string; htmlPath: string }>;
    readonly panels?: ReadonlyArray<{ id: string; title: string; htmlPath: string }>;
  };
}

export interface ManifestValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
  readonly manifest?: ExtensionManifest;
}

/**
 * Validates a parsed `package.json` manifest from a `.kpext` archive.
 */
export function validateExtensionManifest(raw: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { valid: false, errors: ["Manifest must be a JSON object"] };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.id !== "string" || !/^[a-z0-9._-]+$/i.test(obj.id)) {
    errors.push("Field 'id' must be a non-empty alphanumeric identifier (e.g. 'author.my-ext')");
  }
  if (typeof obj.name !== "string" || !obj.name.trim()) {
    errors.push("Field 'name' must be a non-empty string");
  }
  if (typeof obj.version !== "string" || !/^\d+\.\d+\.\d+/.test(obj.version)) {
    errors.push("Field 'version' must follow semver (e.g. '1.0.0')");
  }
  if (typeof obj.author !== "string" || !obj.author.trim()) {
    errors.push("Field 'author' must be a non-empty string");
  }
  if (typeof obj.description !== "string") {
    errors.push("Field 'description' must be a string");
  }
  const engines = obj.engines as Record<string, unknown> | undefined;
  if (!engines || typeof engines.kekenikPixel !== "string" || !engines.kekenikPixel.trim()) {
    errors.push("Field 'engines.kekenikPixel' semver range is required (e.g. '>=1.0.0')");
  }
  if (!obj.contributes || typeof obj.contributes !== "object") {
    errors.push("Field 'contributes' object is required");
  }

  return {
    valid: errors.length === 0,
    errors,
    manifest: errors.length === 0 ? (raw as ExtensionManifest) : undefined,
  };
}

// ---------------------------------------------------------------------------
// 3. Pure-TypeScript PKZIP `.kpext` Archive Packer & Unpacker
// ---------------------------------------------------------------------------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function stringToUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function utf8ToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Packs a map of relative file paths -> string contents into a standard PKZIP `.kpext` binary archive.
 */
export function packKpextZip(files: Record<string, string>): Uint8Array {
  const entries = Object.entries(files).map(([name, content]) => {
    const cleanName = name.replace(/^\/+/, "");
    const nameBytes = stringToUtf8(cleanName);
    const dataBytes = stringToUtf8(content);
    const crc = crc32(dataBytes);
    return { nameBytes, dataBytes, crc };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const e of entries) {
    localSize += 30 + e.nameBytes.length + e.dataBytes.length;
    centralSize += 46 + e.nameBytes.length;
  }
  const totalSize = localSize + centralSize + 22;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  let offset = 0;
  const localOffsets: number[] = [];

  for (const e of entries) {
    localOffsets.push(offset);
    view.setUint32(offset, 0x04034b50, true); // Local file header signature
    view.setUint16(offset + 4, 20, true); // Version needed
    view.setUint16(offset + 6, 0, true); // Flags
    view.setUint16(offset + 8, 0, true); // Compression method 0 = Store
    view.setUint16(offset + 10, 0, true); // Mod time
    view.setUint16(offset + 12, 0, true); // Mod date
    view.setUint32(offset + 14, e.crc, true);
    view.setUint32(offset + 18, e.dataBytes.length, true);
    view.setUint32(offset + 22, e.dataBytes.length, true);
    view.setUint16(offset + 26, e.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    out.set(e.nameBytes, offset + 30);
    out.set(e.dataBytes, offset + 30 + e.nameBytes.length);
    offset += 30 + e.nameBytes.length + e.dataBytes.length;
  }

  const centralStart = offset;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    view.setUint32(offset, 0x02014b50, true); // Central directory file header signature
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, 0, true); // Store
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, 0, true);
    view.setUint32(offset + 16, e.crc, true);
    view.setUint32(offset + 20, e.dataBytes.length, true);
    view.setUint32(offset + 24, e.dataBytes.length, true);
    view.setUint16(offset + 28, e.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, localOffsets[i], true);
    out.set(e.nameBytes, offset + 46);
    offset += 46 + e.nameBytes.length;
  }

  // End of central directory record
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, 0, true);

  return out;
}

/**
 * Unpacks a PKZIP `.kpext` binary archive (or JSON bundle) into a map of relative file paths -> string contents.
 */
export function unpackKpextZip(data: Uint8Array | string): Record<string, string> {
  if (typeof data === "string") {
    const parsed = JSON.parse(data) as Record<string, string>;
    return parsed;
  }

  // Check if it's a PKZIP binary (starts with 0x50 0x4b 0x03 0x04)
  if (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    data[2] === 0x03 &&
    data[3] === 0x04
  ) {
    const files: Record<string, string> = {};
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;
    while (offset + 30 <= data.length) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;
      const compSize = view.getUint32(offset + 18, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLen + extraLen;
      const name = utf8ToString(data.subarray(nameStart, nameStart + nameLen));
      const content = utf8ToString(data.subarray(dataStart, dataStart + compSize));
      files[name] = content;
      offset = dataStart + compSize;
    }
    return files;
  }

  // Fallback: UTF-8 JSON bundle
  const text = utf8ToString(data);
  return JSON.parse(text) as Record<string, string>;
}

// ---------------------------------------------------------------------------
// 4. Built-in Sample Extensions (`samples/extensions/*`)
// ---------------------------------------------------------------------------

export interface InstalledExtensionRecord {
  readonly id: string;
  readonly manifest: ExtensionManifest;
  readonly files: Record<string, string>;
  enabled: boolean;
  installedAt: string;
  contributedIds: {
    themes: string[];
    palettes: string[];
    brushes: string[];
    keymaps: string[];
    languages: string[];
    commands: string[];
    dialogs: string[];
    panels: string[];
    overriddenBindings: Array<{ commandId: string; previousKeys: string; newKeys: string }>;
  };
}

export interface ExtensionConflictWarning {
  readonly kind: "keybinding" | "theme";
  readonly targetId: string;
  readonly extensionIds: string[];
  readonly message: string;
}

export const SAMPLE_EXTENSION_BUNDLES: ReadonlyArray<{
  id: string;
  folderName: string;
  files: Record<string, string>;
}> = [
  {
    id: "kekenik.theme-cyberpunk",
    folderName: "theme-cyberpunk",
    files: {
      "package.json": JSON.stringify(
        {
          id: "kekenik.theme-cyberpunk",
          name: "Cyberpunk Neon Theme",
          version: "1.0.0",
          author: "Kekenik Studio",
          description: "High-contrast synthwave magenta & cyan pixel-art skin theme.",
          engines: { kekenikPixel: ">=1.0.0" },
          permissions: [],
          contributes: {
            themes: [
              {
                id: "cyberpunk-neon",
                name: "Cyberpunk Neon (Synthwave)",
                path: "cyberpunk-theme.json",
              },
            ],
          },
        },
        null,
        2
      ),
      "cyberpunk-theme.json": JSON.stringify(
        {
          id: "cyberpunk-neon",
          name: "Cyberpunk Neon (Synthwave)",
          windowBg: "#120924",
          chromeBg: "#241242",
          panelBg: "#1c0f36",
          headerBg: "#4c1d95",
          headerActiveBg: "#d946ef",
          headerText: "#fdf4ff",
          canvasSurroundBg: "#090414",
          inputBg: "#0f0720",
          inputText: "#f0abfc",
          textPrimary: "#f5d0fe",
          textMuted: "#c084fc",
          accentBg: "#06b6d4",
          accentText: "#082f49",
          borderOuter: "#05020a",
          bevelLight: "#7e22ce",
          bevelDark: "#090414",
          buttonBg: "#3b0764",
          buttonActiveBg: "#d946ef",
          tabActiveBg: "#701a75",
          tabInactiveBg: "#2e1065",
          timelineRowBg: "#1e1b4b",
          timelineRowAltBg: "#17153b",
          timelineSelectedBg: "#0891b2",
          spacing: { xs: 2, sm: 4, md: 8 },
          radii: { none: 0, sm: 2 },
        },
        null,
        2
      ),
    },
  },
  {
    id: "kekenik.palette-retro-8bit",
    folderName: "palette-retro-8bit",
    files: {
      "package.json": JSON.stringify(
        {
          id: "kekenik.palette-retro-8bit",
          name: "Retro 8-Bit Arcade Palette Pack",
          version: "1.1.0",
          author: "Kekenik Studio",
          description: "Adds the 16-color Retro 8-Bit Arcade palette (.gpl) to the Palette Registry.",
          engines: { kekenikPixel: ">=1.0.0" },
          permissions: [],
          contributes: {
            palettes: [
              {
                id: "retro-8bit-arcade",
                name: "Retro 8-Bit Arcade (16 Colors)",
                path: "retro-8bit.gpl",
              },
            ],
          },
        },
        null,
        2
      ),
      "retro-8bit.gpl": [
        "GIMP Palette",
        "Name: Retro 8-Bit Arcade",
        "Columns: 4",
        "#",
        "  0   0   0\tVoid Black",
        " 29  43  83\tArcade Navy",
        "126  37  83\tCabinet Plum",
        "  0 135  81\tCRT Emerald",
        "171  82  54\tBrick Rust",
        " 95  87  79\tAsh Slate",
        "194 195 199\tCoin Silver",
        "255 241 232\tPhosphor White",
        "255   0  77\tLaser Red",
        "255 163   0\tHighscore Amber",
        "255 236  39\tToken Gold",
        "  0 228  54\tSlime Neon",
        " 41 173 255\tSky Beam",
        "131 118 156\tDusk Lavender",
        "255 119 168\tBubblegum Pink",
        "255 204 170\tArcade Peach",
      ].join("\n"),
    },
  },
  {
    id: "kekenik.lang-fa-improved",
    folderName: "lang-fa-improved",
    files: {
      "package.json": JSON.stringify(
        {
          id: "kekenik.lang-fa-improved",
          name: "Persian Professional Studio Pack (فارسی حرفه‌ای)",
          version: "1.0.0",
          author: "Kekenik Community",
          description: "Enhanced Persian studio terminology and pixel-art glossary overrides.",
          engines: { kekenikPixel: ">=1.0.0" },
          permissions: [],
          contributes: {
            languages: [
              {
                locale: "fa",
                name: "فارسی (نسخه استودیویی پیشرفته)",
                path: "fa-improved.json",
              },
            ],
          },
        },
        null,
        2
      ),
      "fa-improved.json": JSON.stringify(
        {
          "app.title": "استودیو ککنیک پیکسل حرفه‌ای",
          "menu.file": "پرونده پروژه",
          "menu.script": "موتور اسکریپت",
          "menu.extensions": "مدیریت افزونه‌ها",
          "panel.script_editor": "ویرایشگر اسکریپت حرفه‌ای",
        },
        null,
        2
      ),
    },
  },
  {
    id: "kekenik.keymap-vim",
    folderName: "keymap-vim",
    files: {
      "package.json": JSON.stringify(
        {
          id: "kekenik.keymap-vim",
          name: "Vim Modal Navigation Keymap",
          version: "1.0.0",
          author: "Kekenik Studio",
          description: "Adds H/L frame navigation and quick script execution keybindings.",
          engines: { kekenikPixel: ">=1.0.0" },
          permissions: [],
          contributes: {
            keymaps: [
              {
                id: "vim-pixel-keymap",
                name: "Vim Pixel Keybindings",
                path: "vim-keymap.json",
              },
            ],
          },
        },
        null,
        2
      ),
      "vim-keymap.json": JSON.stringify(
        {
          bindings: [
            { commandId: "frame.prev", keys: "Ctrl+H" },
            { commandId: "frame.next", keys: "Ctrl+L" },
            { commandId: "script.run_active", keys: "Ctrl+Enter" },
            { commandId: "ext.manage", keys: "Ctrl+Shift+X" },
          ],
        },
        null,
        2
      ),
    },
  },
];

// ---------------------------------------------------------------------------
// 5. Extension Lifecycle Manager
// ---------------------------------------------------------------------------

export class ExtensionManager {
  private readonly installed = new Map<string, InstalledExtensionRecord>();

  /**
   * Installs an extension from a `.kpext` binary archive (or file map) and optionally enables it.
   */
  public installKpext(
    archiveOrFiles: Uint8Array | Record<string, string>,
    enableImmediately = true
  ): InstalledExtensionRecord {
    const files =
      archiveOrFiles instanceof Uint8Array
        ? unpackKpextZip(archiveOrFiles)
        : { ...archiveOrFiles };

    const pkgRaw = files["package.json"];
    if (!pkgRaw) {
      throw new Error("Invalid .kpext archive: missing package.json at root");
    }

    const parsedPkg = JSON.parse(pkgRaw) as unknown;
    const validation = validateExtensionManifest(parsedPkg);
    if (!validation.valid || !validation.manifest) {
      throw new Error(`Invalid extension manifest: ${validation.errors.join("; ")}`);
    }

    const manifest = validation.manifest;
    if (this.installed.has(manifest.id)) {
      this.uninstallExtension(manifest.id);
    }

    const record: InstalledExtensionRecord = {
      id: manifest.id,
      manifest,
      files,
      enabled: false,
      installedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
      contributedIds: {
        themes: [],
        palettes: [],
        brushes: [],
        keymaps: [],
        languages: [],
        commands: [],
        dialogs: [],
        panels: [],
        overriddenBindings: [],
      },
    };

    this.installed.set(manifest.id, record);
    if (enableImmediately) {
      this.enableExtension(manifest.id);
    }
    appLogger.info("Extensions", `Installed extension "${manifest.name}" (${manifest.id}@${manifest.version})`);
    return record;
  }

  /**
   * Installs one of the 4 bundled sample extensions by ID or folder name.
   */
  public installSampleExtension(
    idOrFolder: string,
    enableImmediately = true
  ): InstalledExtensionRecord {
    const found = SAMPLE_EXTENSION_BUNDLES.find(
      (b) => b.id === idOrFolder || b.folderName === idOrFolder
    );
    if (!found) {
      throw new Error(`Unknown sample extension: ${idOrFolder}`);
    }
    const zipBytes = packKpextZip(found.files);
    return this.installKpext(zipBytes, enableImmediately);
  }

  /**
   * Enables an installed extension and registers all its contributions into the registries.
   */
  public enableExtension(extId: string): boolean {
    const rec = this.installed.get(extId);
    if (!rec) return false;
    if (rec.enabled) return true;

    const { manifest, files, contributedIds } = rec;

    // 1. Themes -> ThemeRegistry
    if (manifest.contributes.themes) {
      for (const th of manifest.contributes.themes) {
        const rawJson = files[th.path];
        if (!rawJson) continue;
        const parsed = JSON.parse(rawJson) as ExtensionThemeTokens;
        const tokenObj: ExtensionThemeTokens = {
          ...parsed,
          id: th.id,
          name: th.name || parsed.name,
          originExtensionId: manifest.id,
        };
        ThemeRegistry.register(tokenObj);
        contributedIds.themes.push(th.id);
      }
    }

    // 2. Palettes -> PaletteRegistry
    if (manifest.contributes.palettes) {
      for (const pal of manifest.contributes.palettes) {
        const rawText = files[pal.path];
        if (!rawText) continue;
        let colors: RGBA[] = [];
        if (pal.path.endsWith(".gpl")) {
          colors = decodeGplPalette(rawText).colors;
        } else if (pal.path.endsWith(".pal")) {
          colors = decodeJascPalPalette(rawText);
        } else {
          colors = decodeHexPalette(rawText);
        }
        PaletteRegistry.register({
          id: pal.id,
          name: pal.name,
          colors,
          originExtensionId: manifest.id,
        });
        contributedIds.palettes.push(pal.id);
      }
    }

    // 3. Brushes -> BrushRegistry & defaultBrushLibrary
    if (manifest.contributes.brushes) {
      for (const br of manifest.contributes.brushes) {
        const rawText = files[br.path];
        if (!rawText) continue;
        const parsed = JSON.parse(rawText) as Partial<BrushConfig>;
        const added = defaultBrushLibrary.addBrush({
          name: br.name || parsed.name || "Extension Brush",
          category: parsed.category ?? "Custom Stamps",
          type: parsed.type ?? "square",
          size: parsed.size ?? 4,
          angle: parsed.angle ?? 0,
          spacing: parsed.spacing ?? 1,
          patternAlign: parsed.patternAlign ?? "none",
          flipH: parsed.flipH ?? false,
          flipV: parsed.flipV ?? false,
          dynamics: parsed.dynamics ?? {
            pressureSize: false,
            pressureAngle: false,
            velocitySize: false,
            gradientDither: false,
          },
        });
        BrushRegistry.register({
          id: br.id,
          name: br.name,
          config: added,
          originExtensionId: manifest.id,
        });
        contributedIds.brushes.push(br.id);
      }
    }

    // 4. Keymaps -> KeymapRegistry & defaultKeymap
    if (manifest.contributes.keymaps) {
      for (const km of manifest.contributes.keymaps) {
        const rawText = files[km.path];
        if (!rawText) continue;
        const parsed = JSON.parse(rawText) as {
          bindings?: Array<{ commandId: string; keys: string }>;
        };
        const bindings = parsed.bindings ?? [];
        KeymapRegistry.register({
          id: km.id,
          name: km.name,
          bindings,
          originExtensionId: manifest.id,
        });
        contributedIds.keymaps.push(km.id);
        for (const b of bindings) {
          const existing = defaultKeymap.getAll().find((k) => k.commandId === b.commandId);
          contributedIds.overriddenBindings.push({
            commandId: b.commandId,
            previousKeys: existing?.keys ?? "",
            newKeys: b.keys,
          });
          defaultKeymap.setBinding(b.commandId, b.keys);
        }
      }
    }

    // 5. Languages -> LanguageRegistry & i18n locale overrides
    if (manifest.contributes.languages) {
      for (const lang of manifest.contributes.languages) {
        const rawText = files[lang.path];
        if (!rawText) continue;
        const strings = JSON.parse(rawText) as Record<string, string>;
        const langId = `${manifest.id}:${lang.locale}`;
        LanguageRegistry.register({
          id: langId,
          locale: lang.locale,
          name: lang.name,
          strings,
          originExtensionId: manifest.id,
        });
        registerLocaleOverrides(langId, lang.locale, strings);
        contributedIds.languages.push(langId);
      }
    }

    // 6. Declarative Commands, Dialogs, Panels
    if (manifest.contributes.commands) {
      for (const cmd of manifest.contributes.commands) {
        CommandRegistry.register({
          id: cmd.id,
          title: cmd.title,
          category: "Actions",
          ownerAgent: 5,
          state: "tested",
          run: () => {},
        });
        contributedIds.commands.push(cmd.id);
      }
    }

    if (manifest.contributes.dialogs) {
      for (const dlg of manifest.contributes.dialogs) {
        DialogRegistry.register({
          id: dlg.id,
          title: dlg.title,
          ownerAgent: 5,
          state: "tested",
        });
        contributedIds.dialogs.push(dlg.id);
      }
    }

    if (manifest.contributes.panels) {
      for (const pnl of manifest.contributes.panels) {
        PanelRegistry.register({
          id: pnl.id,
          title: pnl.title,
          icon: "workspace",
          ownerAgent: 5,
          state: "tested",
          defaultDockSlot: "right",
          singleton: true,
          floatable: true,
        });
        contributedIds.panels.push(pnl.id);
      }
    }

    rec.enabled = true;
    appLogger.info("Extensions", `Enabled extension "${manifest.name}"`);
    return true;
  }

  /**
   * Disables an extension and rolls back all its registered contributions.
   */
  public disableExtension(extId: string): boolean {
    const rec = this.installed.get(extId);
    if (!rec || !rec.enabled) return false;

    const { contributedIds } = rec;
    for (const tid of contributedIds.themes) {
      ThemeRegistry.unregister(tid);
    }
    for (const pid of contributedIds.palettes) {
      PaletteRegistry.unregister(pid);
    }
    for (const bid of contributedIds.brushes) {
      const b = BrushRegistry.get(bid);
      if (b) {
        defaultBrushLibrary.removeBrush(b.config.id);
      }
      BrushRegistry.unregister(bid);
    }
    for (const kid of contributedIds.keymaps) {
      KeymapRegistry.unregister(kid);
    }
    for (const ov of contributedIds.overriddenBindings) {
      if (ov.previousKeys) {
        defaultKeymap.setBinding(ov.commandId, ov.previousKeys);
      } else {
        defaultKeymap.resetOne(ov.commandId);
      }
    }
    for (const lid of contributedIds.languages) {
      LanguageRegistry.unregister(lid);
      unregisterLocaleOverrides(lid);
    }
    for (const cid of contributedIds.commands) {
      CommandRegistry.unregister(cid);
    }
    for (const did of contributedIds.dialogs) {
      DialogRegistry.unregister(did);
    }
    for (const pnid of contributedIds.panels) {
      PanelRegistry.unregister(pnid);
    }

    contributedIds.themes = [];
    contributedIds.palettes = [];
    contributedIds.brushes = [];
    contributedIds.keymaps = [];
    contributedIds.languages = [];
    contributedIds.commands = [];
    contributedIds.dialogs = [];
    contributedIds.panels = [];
    contributedIds.overriddenBindings = [];

    rec.enabled = false;
    appLogger.info("Extensions", `Disabled extension "${rec.manifest.name}" and rolled back contributions`);
    return true;
  }

  /**
   * Uninstalls an extension completely, rolling back any active contributions.
   */
  public uninstallExtension(extId: string): boolean {
    const rec = this.installed.get(extId);
    if (!rec) return false;
    if (rec.enabled) {
      this.disableExtension(extId);
    }
    this.installed.delete(extId);
    appLogger.info("Extensions", `Uninstalled extension "${rec.manifest.name}"`);
    return true;
  }

  /**
   * Reloads all currently enabled extensions.
   */
  public reloadAll(): void {
    for (const rec of this.installed.values()) {
      if (rec.enabled) {
        this.disableExtension(rec.id);
        this.enableExtension(rec.id);
      }
    }
  }

  /**
   * Returns all installed extensions.
   */
  public getAll(): InstalledExtensionRecord[] {
    return Array.from(this.installed.values());
  }

  /**
   * Retrieves an installed extension by ID.
   */
  public get(extId: string): InstalledExtensionRecord | undefined {
    return this.installed.get(extId);
  }

  /**
   * Detects conflicts across enabled extensions (e.g., two extensions overriding the same keybinding or theme ID).
   */
  public detectConflicts(): ExtensionConflictWarning[] {
    const warnings: ExtensionConflictWarning[] = [];
    const themeOwners = new Map<string, string[]>();
    const keyOwners = new Map<string, string[]>();

    for (const rec of this.installed.values()) {
      if (!rec.enabled) continue;
      for (const th of rec.manifest.contributes.themes ?? []) {
        const list = themeOwners.get(th.id) ?? [];
        list.push(rec.id);
        themeOwners.set(th.id, list);
      }
      for (const ov of rec.contributedIds.overriddenBindings) {
        const list = keyOwners.get(ov.commandId) ?? [];
        list.push(rec.id);
        keyOwners.set(ov.commandId, list);
      }
    }

    for (const [themeId, owners] of themeOwners.entries()) {
      if (owners.length > 1) {
        warnings.push({
          kind: "theme",
          targetId: themeId,
          extensionIds: owners,
          message: `Multiple extensions override theme '${themeId}': ${owners.join(", ")}`,
        });
      }
    }

    for (const [cmdId, owners] of keyOwners.entries()) {
      if (owners.length > 1) {
        warnings.push({
          kind: "keybinding",
          targetId: cmdId,
          extensionIds: owners,
          message: `Multiple extensions override keybinding for '${cmdId}': ${owners.join(", ")}`,
        });
      }
    }

    return warnings;
  }
}

export const defaultExtensionManager = new ExtensionManager();
