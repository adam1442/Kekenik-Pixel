# Keymap Notes & Minor Variations (`docs/KEYMAP_UNCERTAIN.md`)

All standard Aseprite 1.3 shortcuts (`B` Pencil/Spray cycle, `E` Eraser, `I` Eyedropper, `M` Marquee cycle, `Q` Lasso, `W` Magic Wand, `G` Paint Bucket/Gradient cycle, `L` Line/Curve cycle, `U` Rectangle/Ellipse cycle, `D` Contour/Polygon cycle, `R` Blur/Jumble cycle, `T` Text, `Shift+C` Slice, `V` Move, `Z` Zoom, `H` Hand, `X` Swap Colors, `Tab` Toggle Timeline, `F7` Toggle Preview, `Alt+N` New Frame, `Shift+N` New Layer, `Enter` Play/Stop) are bound identically in `packages/core/src/keymap/default-keymap.json`.

The following bindings have minor cross-platform or browser-mode variations noted for user awareness:

1. **Close Tab (`Ctrl+W`)**: In desktop Electron mode (`npm run dev:desktop`), `Ctrl+W` closes the active sprite tab. In standard web browsers (`npm run dev`), the browser itself intercepts `Ctrl+W` to close the browser tab before DOM `keydown` fires; users in web mode can click the `×` button on the tab or `File > Close Tab`.
2. **New Sprite (`Ctrl+N`)**: Intercepted by some browsers in non-PWA mode to open a new browser window; `File > New...` and the `+` tab button are always available in web mode, while Electron desktop mode captures `Ctrl+N` natively.
3. **Undo History (`Ctrl+Alt+Z`)**: Some Aseprite 1.3 configurations leave Undo History unbound by default (`Edit > Undo History`); we bound `Ctrl+Alt+Z` by default for keyboard convenience and made it rebindable in `Edit > Keyboard Shortcuts`.
4. **Feature Center (`F1`)**: In Kekenik Pixel, `F1` opens `Help > Feature Center` so the user can run verification self-tests with a single keypress.
