/**
 * @module @kekenik/ui/app/external-links
 * Project-level external links plus a CSP-safe way to hand an `https://` URL to the
 * operating system browser (Electron IPC bridge) with a browser-build fallback.
 */

export const REPOSITORY_URL = "https://github.com/adam1442/Kekenik-Pixel";
export const REPOSITORY_ISSUES_URL = "https://github.com/adam1442/Kekenik-Pixel/issues";

/**
 * Opens `url` in the user's default browser.
 * - Electron: routed through the typed `openExternalUrl` preload bridge (main process calls
 *   `shell.openExternal`) so the app window itself never navigates away.
 * - Browser build: falls back to a new tab.
 */
export function openExternalUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  const bridge = typeof window !== "undefined" ? window.kekenikElectron : undefined;
  if (bridge?.openExternalUrl) {
    void bridge.openExternalUrl(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
