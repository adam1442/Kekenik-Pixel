# Third-Party Assets & Dependencies (`docs/THIRD_PARTY.md`)

## 1. Originality Statement (Common Rules §1)
- **Zero Aseprite proprietary assets**: No source code, icons, bitmap fonts, sprites, or skin images were copied from Aseprite.
- **Original Art & Icons**: All 85 16×16 pixel-art icons (`packages/ui/src/skin/index.tsx`), 9-slice 1-px bevel CSS skin tokens, the Kekenik-32 default palette, and the procedural demo sprites (`antihero.ase`, `slime_bounce.ase`, `blend_modes.ase`) are 100% original creations written specifically for Kekenik Pixel.

---

## 2. Open-Source Runtime & Build Dependencies

| Package | Version | License | Purpose |
|---|---|---|---|
| `react` | 19.3.1 | MIT | UI component rendering |
| `react-dom` | 19.3.1 | MIT | DOM mounting |
| `zustand` | 5.1.0 | MIT | Reactive state management store |
| `clsx` | 2.1.1 | MIT | ClassName composition utility |
| `tailwind-merge` | 3.7.0 | MIT | Utility class merging |
| `tailwindcss` | 4.1.17 | MIT | CSS layout and styling |
| `@codemirror/view` | 6.43.15 | MIT | Script editor surface |
| `codemirror` | 6.0.2 | MIT | Script editor (CodeMirror 6 bundles) |
| `fflate` | 0.8.3 | MIT | Deflate/inflate for project archives |
| `typescript` | 5.9.3 | Apache-2.0 | Strict static type checking |
| `vite` | 7.3.8 | MIT | Dev server and bundler |
| `vitest` | 4.1.12 | MIT | Unit and integration testing framework |
| `zod` | 4.6.7 | MIT | Runtime IPC schema validation in the Electron main process |
| `electron` | 45.2.3 | MIT | Cross-platform desktop runtime |
| `electron-builder` | 26.18.0 | MIT | Windows NSIS/Portable, macOS DMG/ZIP, Linux AppImage/deb/tar.gz packager |
| `vite-plugin-singlefile` | 2.3.4 | MIT | Single-file HTML bundle for web + Electron renderer |

---

## 3. Icon Generation & Packaging Assets (`B16`, `B17`)
- All application icons (`assets/icon/app.svg`, `assets/icon/icon.ico`, `assets/icon/icon.icns`, `assets/icon/png/*`, `assets/icon/tray-*.png`, `installer-assets/installerHeader.bmp`, `installer-assets/installerSidebar.bmp`) and `.kpx` project document icons (`assets/icon/file-kpx.svg`, `assets/icon/file-kpx-16.png`, `assets/icon/file-kpx-32.png`, `assets/icon/file-kpx.ico`) are **100% original pixel-art designs generated from code** by `scripts/generate-icons.mjs` using only Node.js built-in modules (`node:fs`, `node:path`, `node:zlib`, `node:crypto`). Zero third-party icon assets or external binary image tools are used.
