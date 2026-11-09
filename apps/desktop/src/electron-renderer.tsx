/**
 * @module @kekenik/desktop/electron-renderer
 * Electron renderer entry point used by `desktop.html`.
 *
 * Mounts the shared `<KekenikPixelApp />` shell with the `ElectronPlatform` implementation
 * installed (native OS dialogs, settings persistence, window controls) instead of the
 * browser `WebPlatform` used by `index.html`.
 */

import "../../../src/index.css";
import { mountDesktopRenderer } from "./renderer.tsx";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("[kekenik] #root element is missing from desktop.html");
}

mountDesktopRenderer(rootElement);
