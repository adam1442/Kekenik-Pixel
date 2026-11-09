# Kekenik Pixel — Build & Packaging Guide

Everything you need to build, verify and package **Kekenik Pixel** for **Windows**, **macOS**,
**Linux** and the **web**, plus the troubleshooting notes for the failures that actually happen
in practice.

---

## 1. Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | **22.12+** (22 LTS or newer) | `node --version` — required by the Electron 45 / electron-builder 26 toolchain |
| npm | 10+ | Ships with Node. The lockfile is `package-lock.json` (`npm ci`) |
| Git | any | Only needed to clone/submit |
| Disk space | ~3 GB | `node_modules` + Electron binaries + `release/` output |

No native compiler is required: Kekenik Pixel has **zero native Node addons** — PNG/ICO/ICNS/
APNG/GIF/WebP/JPEG/QOI/BMP/TGA/PCX encoders are implemented in pure TypeScript.

### Platform-specific extras

**Windows 10/11 (x64)**
- Nothing else. `electron-builder` downloads NSIS + the code-signing toolchain on first run.

**macOS**
- Xcode Command Line Tools: `xcode-select --install` (needed for `dmg`/`zip` creation).
- DMG/ZIP packages can only be produced on macOS.

**Linux (Debian/Ubuntu)**
```bash
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  libnss3 libgtk-3-0 libfuse2 fakeroot dpkg
```

**Cross-building Windows packages on Linux/macOS**
```bash
sudo dpkg --add-architecture i386
sudo apt-get update && sudo apt-get install -y wine64 wine32:i386   # Debian/Ubuntu
# macOS: brew install --cask wine-stable
```

---

## 2. Install

```bash
git clone https://github.com/adam1442/Kekenik-Pixel.git
cd kekenik-pixel
npm ci           # reproducible install from package-lock.json
```

> `npm ci` fails if `package.json` and `package-lock.json` disagree. Run `npm install` once,
> commit the updated lockfile, then use `npm ci` everywhere else (including CI).

---

## 3. The build pipeline

Every packaging command runs `scripts/build.mjs`, which enforces this order and **aborts on the
first failure**:

| Step | Command | What it guarantees |
|---|---|---|
| 1 | `generate-icons` | `.ico` (7 sizes), `.icns`, Linux PNG set (16–1024), tray/taskbar, `.kpx` document icons, NSIS `installerHeader.bmp` / `installerSidebar.bmp` are all version-pinned to `package.json` |
| 2 | `tsc --noEmit` ×2 | Workspace **and** Electron main/preload type-check cleanly |
| 3 | `vitest run` | 215 unit/integration tests |
| 4 | `vite build` + verify | Single-file web bundle, no `sourceMappingURL`, no `console.log(` leaks |
| 5 | `build-desktop` | `dist-electron/main.mjs`, `dist-electron/preload.cjs`, `dist/desktop.html` |
| 6 | `electron-builder` | Platform installers |
| 7 | SHA-256 | `.sha256` sidecars + `SHA256SUMS.txt` in `release/<version>/` |

Useful flags:

```bash
node scripts/build.mjs --win --skip-tests    # skip step 3 (already ran in CI)
node scripts/build.mjs --win --dry-run       # steps 1–5 only, no packaging
node scripts/build.mjs                       # interactive menu
```

### Generated artifacts

```
dist/                  index.html (web) · desktop.html (Electron renderer)
dist-electron/         main.mjs (ESM) · preload.cjs (CommonJS, sandboxed)
release/<version>/     installers + .sha256 sidecars + SHA256SUMS.txt
```

---

## 4. Per-platform packaging

### Windows

```bash
npm run dist:win            # NSIS installer + portable EXE
npm run dist:win:portable   # portable EXE only
npm run dist:win:qa         # installer with the QA surface enabled (VITE_KP_FLAVOR=qa)
```

Output:
`release/<version>/KekenikPixel-<version>-win-x64-setup.exe` and `...-win-x64-portable.exe`.

The installer registers the `.kpx` association, an *Open with* entry for `.aseprite`/`.ase`
(never hijacks an existing default), and offers a “keep my settings” choice on uninstall
(`installer-assets/installer.nsh`).

### macOS

```bash
npm run dist:mac            # DMG + ZIP for x64 and arm64
```

Output: `KekenikPixel-<version>-mac-x64.dmg`, `...-mac-arm64.dmg` (+ `.zip`).

Unsigned builds are fine for local use. On another Mac, first launch requires
right-click → **Open**, or `xattr -dr com.apple.quarantine "/Applications/Kekenik Pixel.app"`.
See [`RELEASING.md`](RELEASING.md) for signing/notarization.

### Linux

```bash
npm run dist:linux          # AppImage + deb + tar.gz
npm run dist:linux:docker   # same, inside electronuserland/builder (from Windows/macOS)
```

Output: `KekenikPixel-<version>-linux-x64.AppImage` / `.deb` / `.tar.gz`.

### Web

```bash
npm run build:web
```

Output: a single self-contained `dist/index.html` (~2.5 MB, no network requests) that can be
opened from `file://` or hosted on any static host.

---

## 5. Troubleshooting

### `Error: warning treated as error` during NSIS compile

`electron-builder` compiles `installer-assets/installer.nsh` twice — once for the installer and once for
the uninstaller (`BUILD_UNINSTALLER`). NSIS warnings are fatal (`-WX`), and the most common
trigger is an **unused variable** in the uninstaller pass:

```
warning 6001: Variable "…" not referenced or never set, wasting memory!
```

Fix: declare installer-only globals inside `!ifndef BUILD_UNINSTALLER … !endif`.
This repository already does this for `REGISTER_ASEPRITE_ASSOC`.

### `wine is required` / `wine32 is missing` (Windows build on Linux)

```bash
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install -y wine64 wine32:i386
```
Or build on Windows / GitHub Actions. Note that `--win` on a Linux host without wine now fails
fast with a clear message instead of a cryptic `app-builder` stack trace.

### `wine process failed` / `ERROR: Can't allocate required memory!` (portable target on Linux)

The NSIS **portable** target is produced by running the freshly built installer inside wine to
extract it. On memory-constrained containers wine fails with `Can't allocate required memory!`.
This only affects Linux/wine cross-builds — the installer itself is already complete at that point,
and the portable EXE is produced normally on Windows or in CI.

### `Invalid configuration object … configuration.win should be one of these: null`

The configuration in `package.json` targets **electron-builder 26**. Fields that moved between
major versions (for example `win.publisherName` → `win.signtoolOptions.publisherName`) produce
this generic error. Do not downgrade electron-builder; fix the field instead.

### `npm ci` fails: lockfile out of sync

```bash
npm install          # regenerates package-lock.json
git add package-lock.json && git commit -m "chore: refresh lockfile"
```

### The app launches but shows a blank/white window

* Verify `dist/desktop.html` and `dist-electron/*` exist — run `npm run build:desktop`.
* `package.json` → `main` must be `dist-electron/main.mjs`. Electron cannot execute `.ts` files.
* Check `%APPDATA%\Kekenik Pixel\logs\main-error.log` (Windows) or
  `~/Library/Logs/Kekenik Pixel/` (macOS) — also reachable from the error dialog’s
  **Open Logs Folder** button.

### Remaining `npm warn deprecated …` lines during install

A few deprecation warnings survive inside **electron-builder's own dependency tree** and cannot be
removed from this repository without forking the packager:

| Warning | Comes from |
|---|---|
| `glob@7.2.3`, `inflight@1.0.6` | `app-builder-lib → @electron/asar` |
| `rimraf@2.6.3`, `glob@7.2.3` | `electron-builder-squirrel-windows → electron-winstaller → temp` |
| `boolean@3.2.0` | `electron@… → @electron/get → global-agent` |

They are **build-time only**, are never shipped inside the app (the packaged `app.asar` contains
only `dist/`, `dist-electron/`, the icons and `package.json`), and disappear automatically as soon
as upstream upgrades those tools. `npm audit` currently reports 0 critical / 0 high findings.

### Icons look wrong / installer has no branding

`npm run generate:icons` writes `assets/icon/**` and `installer-assets/installer*.bmp`. These files are
committed on purpose; if they look stale run the command and commit the result.

### macOS: “app is damaged and can’t be opened”

That is Gatekeeper rejecting an unsigned bundle. Use right-click → **Open**, or clear the
quarantine attribute as shown above.

---

## 6. Continuous integration

| Workflow | Trigger | Result |
|---|---|---|
| `.github/workflows/ci.yml` | push / PR | typecheck, tests, web bundle, Electron bundles (+ Windows/Linux packaging smoke tests on `main`) |
| `.github/workflows/release.yml` | push tag `v*` or manual | Windows + macOS (x64/arm64) + Linux builds, `SHA256SUMS.txt`, GitHub Release |

See [`RELEASING.md`](RELEASING.md) for the release procedure.
