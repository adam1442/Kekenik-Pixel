import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Two renderer targets share this config:
 *  - default (`vite build`)      -> browser build    -> `dist/index.html`
 *  - `KP_TARGET=desktop`         -> Electron renderer -> `dist/desktop.html`
 * Both are single-file bundles (`viteSingleFile`) so they can be opened from `file://`
 * and shipped verbatim inside the Electron `asar` archive.
 */
const isDesktopTarget = process.env.KP_TARGET === "desktop";

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
      "@kekenik/core": path.resolve(rootDir, "packages/core/src/index.ts"),
      "@kekenik/ui": path.resolve(rootDir, "packages/ui/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    // The desktop renderer is built *after* the browser bundle into the same folder,
    // so it must never wipe the existing web artifact.
    emptyOutDir: !isDesktopTarget,
    sourcemap: false,
    target: "es2022",
    chunkSizeWarningLimit: 4096,
    ...(isDesktopTarget
      ? {
          rollupOptions: {
            input: path.resolve(rootDir, "desktop.html"),
          },
        }
      : {}),
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
