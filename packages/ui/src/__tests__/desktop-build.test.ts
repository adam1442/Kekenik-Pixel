/**
 * Desktop packaging & persistence regression tests (build-system hardening).
 *
 * These cover defects that only surfaced when the real Electron app / installer was built:
 *  - concurrent atomic writes sharing a temporary file name (ENOENT on `rename`)
 *  - app-root / preload / renderer path resolution (must work from `app.asar` and on Windows)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWriteFile } from "../../../../apps/desktop/src/main/ipc.ts";
import {
  DesktopSettingsStore,
  resolveAppRoot,
  resolvePreloadScriptPath,
  resolveRendererIndexHtml,
} from "../../../../apps/desktop/src/main.ts";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `kpx-desktop-${prefix}-`));
}

describe("Desktop persistence & path resolution regressions", () => {
  it("atomicWriteFile survives many concurrent writes to the same file", async () => {
    const dir = createTempDir("atomic-concurrent");
    const target = path.join(dir, "window-state.json");

    await Promise.all(
      Array.from({ length: 25 }, (_unused, index) =>
        atomicWriteFile(target, JSON.stringify({ write: index }))
      )
    );

    const parsed = JSON.parse(fs.readFileSync(target, "utf-8")) as { write: number };
    expect(typeof parsed.write).toBe("number");

    // No temporary files may be left behind.
    const leftovers = fs.readdirSync(dir).filter((name) => name.includes(".tmp."));
    expect(leftovers).toEqual([]);
  });

  it("preserves every key and latest value when settings writes overlap", async () => {
    const dir = createTempDir("settings-concurrent");
    const store = new DesktopSettingsStore(dir);
    await Promise.all([
      ...Array.from({ length: 40 }, (_, i) => store.write(`key_${i}`, i)),
      store.write("preferences", { theme: "dark" }),
      store.write("preferences", { theme: "light" }),
      store.write("layout.v2", { activeWorkspaceId: "animation" }),
    ]);
    const reopened = new DesktopSettingsStore(dir);
    for (let i = 0; i < 40; i++) expect(await reopened.read(`key_${i}`, -1)).toBe(i);
    expect(await reopened.read("preferences", {})).toEqual({ theme: "light" });
    expect(await reopened.read("layout.v2", {})).toEqual({ activeWorkspaceId: "animation" });
  });

  it("resolveAppRoot finds the project root (the folder holding package.json)", () => {
    const root = resolveAppRoot(path.join(process.cwd(), "apps", "desktop", "src"));
    expect(fs.existsSync(path.join(root, "package.json"))).toBe(true);
  });

  it("preload and renderer paths point at the bundled build outputs", () => {
    const moduleDir = path.join(process.cwd(), "dist-electron");
    expect(resolvePreloadScriptPath(moduleDir)).toBe(
      path.join(moduleDir, "preload.cjs")
    );

    const built = createTempDir("renderer-resolution");
    fs.mkdirSync(path.join(built, "dist"), { recursive: true });
    fs.writeFileSync(path.join(built, "dist", "index.html"), "<!doctype html>", "utf8");
    expect(resolveRendererIndexHtml(built)).toBe(path.join(built, "dist", "index.html"));

    fs.writeFileSync(path.join(built, "dist", "desktop.html"), "<!doctype html>", "utf8");
    expect(resolveRendererIndexHtml(built)).toBe(path.join(built, "dist", "desktop.html"));
  });

  it("package.json main entry points at the compiled Electron main bundle", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
    ) as { main: string; build: { files: string[] } };

    expect(pkg.main).toBe("dist-electron/main.mjs");
    expect(pkg.build.files).toContain("dist-electron/**/*");
    expect(pkg.build.files).toContain("dist/**/*");
    // TypeScript sources must not be shipped inside the packaged app.
    expect(pkg.build.files.some((pattern) => pattern.startsWith("apps/"))).toBe(false);
  });

  it("installer-assets/installer.nsh keeps the NSIS variable behind BUILD_UNINSTALLER (warnings are errors)", () => {
    const nsh = fs.readFileSync(path.join(process.cwd(), "installer-assets", "installer.nsh"), "utf8");
    const varIndex = nsh.indexOf("Var REGISTER_ASEPRITE_ASSOC");
    expect(varIndex).toBeGreaterThan(-1);

    const guardIndex = nsh.lastIndexOf("!ifndef BUILD_UNINSTALLER", varIndex);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(nsh.slice(guardIndex, varIndex)).not.toContain("!endif");
  });
});
