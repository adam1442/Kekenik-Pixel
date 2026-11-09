/**
 * @module @kekenik/desktop/renderer
 * Electron Renderer entry point registering ElectronPlatform and mounting KekenikPixelApp.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { setPlatform } from "../../../packages/core/src/index.ts";
import { KekenikPixelApp } from "../../../packages/ui/src/index.ts";
import { ElectronPlatform } from "./electron-platform.ts";
import { initializeSettingsPersistence } from "../../../packages/ui/src/app/settings-persistence.ts";

export function mountDesktopRenderer(rootElement: HTMLElement): void {
  setPlatform(new ElectronPlatform());
  void initializeSettingsPersistence().then(() => createRoot(rootElement).render(
    <React.StrictMode>
      <KekenikPixelApp />
    </React.StrictMode>
  ));
}
