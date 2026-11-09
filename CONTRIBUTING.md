# Contributing to Kekenik Pixel

Thanks for taking the time to contribute! This document covers the workflow, the coding
conventions and the checks your pull request must pass.

---

## 1. Before you start

* **Bug reports / feature ideas** → [open an issue](https://github.com/adam1442/Kekenik-Pixel/issues/new/choose).
* **Security problems** → follow [`SECURITY.md`](SECURITY.md), never a public issue.
* **Large changes** → please open an issue first so the design can be discussed before you invest
  in a big pull request.

## 2. Development setup

```bash
git clone https://github.com/adam1442/Kekenik-Pixel.git
cd kekenik-pixel
npm ci
npm run dev            # browser, http://localhost:5173
npm run dev:desktop    # Electron shell with a hot-reloading renderer
```

## 3. Project layout in one paragraph

`packages/core` is pure TypeScript — no DOM, no React, no Electron. It owns the document model,
the non-linear undo engine, rendering, tools, brushes, animation, file formats and scripting.
`packages/ui` is the React + Zustand layer (menu bar, docking, panels, dialogs, timeline).
`apps/desktop` is the Electron shell (main process, sandboxed preload bridge, platform adapter).
Everything the UI needs from its host goes through `packages/core/src/platform`.

## 4. Definition of done

Run these before pushing — CI runs the same commands:

```bash
npm run typecheck      # workspace + Electron sources
npm test               # 215 Vitest tests must stay green
npm run build:web      # includes release-bundle verification (no source maps, no console.log)
npm run build:desktop  # Electron main/preload/renderer bundles
```

Build-related changes should additionally be exercised with:

```bash
npm run dist:dir       # unpacked app – fastest end-to-end packaging check
```

## 5. Coding conventions

* **TypeScript strict**; no `any` unless unavoidable and commented.
* No new runtime dependencies without a good reason — the encoders (PNG, ICO, GIF, WebP, …) are
  hand-written on purpose, and the app ships without `node_modules` at runtime.
* Keep `packages/core` free of DOM/React/Electron imports.
* Renderer code must never call Node APIs; go through the platform abstraction or IPC.
* Comments explain *why*, not *what*. Public functions get a short JSDoc line.
* All user-visible strings belong in the i18n dictionaries (`packages/ui/src/i18n/locales`).

## 6. Commit messages & pull requests

Conventional-commit prefixes are appreciated:

```
fix(build): guard NSIS variable behind BUILD_UNINSTALLER
feat(timeline): add cel range drag selection
docs(readme): document the release workflow
chore(deps): bump electron-builder to 26.x
```

A good PR description states **what changed, why, and how it was tested** (platform included).
The PR template contains the checklist.

## 7. License of contributions

By submitting a pull request you agree that your contribution is licensed under the project’s
license ([`LICENSE.txt`](LICENSE.txt)) and that you have the right to submit it.
