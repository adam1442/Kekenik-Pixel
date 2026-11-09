# Kekenik Pixel — Master Feature Catalog (`docs/FEATURES.md`)

All **261 features** below are registered in `FeatureRegistry` (`packages/core/src/registry/master-features.ts`) and can be inspected and self-tested interactively in **`Help > Feature Center` (`F1`)**.

---

## Agent 1 — Core Model, Non-Linear History, Registries & Full UI Shell (21 Tested Features)

| # | Feature ID | Title | State |
|---|---|---|---|
| 1 | `core.sprite.model` | Sprite Document Model (RGBA/Grayscale/Indexed) | `tested` |
| 2 | `core.image.uint8array` | Typed-Array PixelImage (RGBA 4B, Grayscale 2B, Indexed 1B) | `tested` |
| 3 | `core.layer.union` | Layer Union (ImageLayer, GroupLayer, TilemapLayer) & Flags | `tested` |
| 4 | `core.blend.18modes` | All 18+ Layer Blend Modes | `tested` |
| 5 | `core.cel.linked` | Linked Cels (Shared PixelImage by linkId) | `tested` |
| 6 | `core.mask.bitmap` | 1-Bit Selection Mask & Automatic Bounds | `tested` |
| 7 | `core.snapshot.codec` | Native .kpx-snapshot Crash-Recovery Serializer | `tested` |
| 8 | `core.history.nonlinear` | Non-Linear Branching Undo History Engine | `tested` |
| 9 | `core.history.patch_storage` | Region-Patch Undo Storage & Memory Budget | `tested` |
| 10 | `core.registries.eight` | 8 Core Extension Registries | `tested` |
| 11 | `ui.shell.menubar` | Menu Bar (File, Edit, Sprite, Layer, Frame, Select, View, Script, Extensions, Help) | `tested` |
| 12 | `ui.shell.docking` | Docking & Floating Window Manager | `tested` |
| 13 | `ui.shell.workspaces` | Workspace Manager & Presets (Default, Animation, Compact, Tile Editing) | `tested` |
| 14 | `ui.skin.themes` | Pixel Skin, 9-Slice Bevel Frames, 3 Themes & 100/200/300% UI Scale | `tested` |
| 15 | `ui.keymap.shortcuts` | Keyboard Shortcuts Dialog, Conflict Detector & Tool Cycling | `tested` |
| 16 | `ui.dialog.new_sprite` | New Sprite Dialog + Companion Canvas Presets Window | `tested` |
| 17 | `ui.dialog.sprite_canvas_size` | Sprite Size & Canvas Size Dialogs | `tested` |
| 18 | `ui.editor.canvas_shell` | Sprite Editor Viewport (Pan, Zoom, Checkerboard, Pixel-Perfect Pencil & Eyedropper) | `tested` |
| 19 | `ui.panel.color_picker_bar` | Color Bar (Palette Swatches) & HSV/RGB/Hex Color Picker | `tested` |
| 20 | `ui.panel.history_log_feature` | Undo History Panel, Log Viewer (500 lines), and Feature Center | `tested` |
| 21 | `core.i18n.persian_rtl` | Internationalization (English + Persian/فارسی RTL Support) | `tested` |

---

## Agent 2 — Rendering Engine + Drawing Tools + Brush Engine (60 Tested Features)
- `render.webgl2_backend` — WebGL2 Tile-Accelerated Canvas Renderer (`tested`)
- `render.canvas2d_fallback` — High-FPS Canvas2D Dirty-Rect Renderer (`tested`)
- `render.pixel_grid` — Adaptive Pixel Grid Overlay at >= 800% Zoom (`tested`)
- `render.tile_grid` — Configurable Tile Grid & Sub-Grid Overlay (`tested`)
- `render.symmetry_guides` — Horizontal, Vertical & Diagonal Symmetry Axis Guides (`tested`)
- `render.tiled_mode_both` — View > Tiled Mode (None, Both Axes, X Axis, Y Axis) (`tested`)
- `render.extra_cel_preview` — Live Brush Preview Extra-Cel Overlay Layer (`tested`)
- `render.subpixel_crosshair` — Precision Brush Outline & Crosshair Cursor Renderer (`tested`)
- `render.color_wheel_harmony` — Color Wheel with Complementary/Triadic/Analogous Harmonies (`tested`)
- `render.pixel_aspect_ratio` — Non-Square Pixel Aspect Ratio Rendering (2:1, 1:2, Custom) (`tested`)
- `tool.pencil.full`, `tool.spray`, `tool.eraser`, `tool.eyedropper.advanced`, `tool.paint_bucket`, `tool.gradient`, `tool.line`, `tool.curve`, `tool.rectangle`, `tool.ellipse`, `tool.contour`, `tool.polygon`, `tool.blur`, `tool.jumble`, `tool.text` (`tested`)
- `ink.simple`, `ink.alpha_compositing`, `ink.copy_color_alpha`, `ink.lock_alpha`, `ink.shading` (`tested`)
- `brush.circle_proc`, `brush.square_proc`, `brush.line_proc`, `brush.custom_bitmap`, `brush.pattern_align`, `brush.symmetry.horizontal`, `brush.symmetry.vertical`, `brush.symmetry.quad`, `brush.dynamics.pressure_size`, `brush.dynamics.pressure_angle`, `brush.dynamics.velocity_size`, `brush.dynamics.gradient_dither`, `brush.pixel_perfect_pro`, `brush.library_slots`, `brush.dither_bayer2x2`, `brush.dither_bayer4x4`, `brush.dither_bayer8x8`, `brush.shift_straight_line`, `brush.ctrl_constrain_axis`, `brush.right_click_eraser`, `brush.wrap_around_tiled`, `brush.shading_palette_sort`, `brush.spacing_control`, `brush.rotational_stamp`, `brush.library_persistence`, `brush.outline_preview_toggle`, `brush.stabilizer_catmull`, `brush.contiguous_gradient`, `brush.polygon_snap_close`, `brush.curve_two_handle` (`tested`)

---

## Agent 3 — Layers, Frames, Timeline, Animation, Onion Skin, Tags, Slices, Tilemaps & Preview (60 Tested Features)
- `timeline.matrix_grid`, `timeline.layer_groups`, `timeline.layer_drag_drop`, `timeline.cel_drag_move`, `timeline.cel_range_select`, `timeline.linked_cel_bars`, `timeline.cel_zindex`, `timeline.layer_blend_popup`, `timeline.cel_properties`, `timeline.flatten_layers`, `timeline.merge_down`, `timeline.duplicate_layer`, `timeline.reference_layer`, `timeline.cel_opacity_slider`, `timeline.Position_dock`, `timeline.thumbnails`, `timeline.empty_cel_create`, `timeline.clear_cel`, `timeline.unlink_shortcut`, `timeline.lock_all_layers`, `timeline.layer_color_swatch`, `timeline.frame_properties`, `timeline.drop_frames_skip`, `timeline.select_used_tiles`, `timeline.slice_export_bounds`, `timeline.tag_color_coding` (`tested`)
- `anim.playback_engine`, `anim.tag_loop_modes`, `anim.play_subtags`, `anim.frame_rate_multiplier`, `anim.constant_frame_rate`, `anim.reverse_frames`, `anim.jump_frame_shortcuts` (`tested`)
- `onion.prev_next_frames`, `onion.red_blue_tint`, `onion.opacity_step_falloff`, `onion.loop_through_tag`, `onion.in_front_behind`, `onion.current_layer_only` (`tested`)
- `tags.create_edit_dialog`, `tags.timeline_banners`, `tags.nested_cascading`, `tags.repeat_counter` (`tested`)
- `slices.tool`, `slices.9patch_center`, `slices.pivot_point`, `slices.animated_keys`, `slices.properties_dialog` (`tested`)
- `tilemap.create_layer`, `tilemap.tileset_panel`, `tilemap.mode_auto_manual`, `tilemap.tile_brush`, `tilemap.flip_rotate_flags`, `tilemap.convert_layer`, `tilemap.tileset_props`, `tilemap.unused_tiles_cleanup` (`tested`)
- `preview.live_animation`, `preview.pan_zoom_sync`, `preview.full_screen`, `preview.tiled_preview` (`tested`)

---

## Agent 4 — Selection, Transform, Clipboard, Palettes, Color Modes, Filters & Sprite/Edit Menus (60 Planned Features)
- `select.marquee_rect`, `select.marquee_ellipse`, `select.lasso_freehand`, `select.polygonal_lasso`, `select.magic_wand`, `select.marching_ants`, `select.modify_expand`, `select.modify_contract`, `select.modify_border`, `select.color_range`, `select.save_load_mask`, `select.deselect_reselect` (`planned`)
- `transform.move_tool`, `transform.floating_pixels`, `transform.rotation_handles`, `transform.rotsprite`, `transform.bilinear_nn`, `transform.pivot_handle`, `transform.skew_shear`, `transform.flip_h_v`, `transform.rotate_90_180`, `transform.shift_wrap` (`planned`)
- `clipboard.copy_cut_paste`, `clipboard.copy_merged`, `clipboard.paste_special_new_sprite`, `clipboard.paste_special_new_layer`, `clipboard.paste_special_new_brush`, `clipboard.system_image_sync` (`planned`)
- `palette.multi_select_drag`, `palette.gradient_ramp`, `palette.sort_options`, `palette.presets_library`, `palette.color_quantizer`, `palette.remap_indexed`, `palette.lock_edit_mode`, `palette.spectrum_wheel_tint` (`planned`)
- `colormode.rgba_to_indexed`, `colormode.grayscale_conv`, `colormode.transparent_color_pick` (`planned`)
- `filter.replace_color`, `filter.invert_color`, `filter.brightness_contrast`, `filter.hue_saturation`, `filter.color_curve`, `filter.convolution_matrix`, `filter.outline`, `filter.despeckle`, `filter.drop_shadow`, `filter.target_channels`, `filter.cels_target_scope`, `filter.live_canvas_preview`, `filter.posterize_levels` (`planned`)
- `sprite.duplicate`, `sprite.crop_to_selection`, `sprite.trim_canvas`, `sprite.rotate_canvas`, `edit.stroke_selection`, `edit.fill_selection`, `edit.new_sprite_from_sel`, `sprite.properties_dialog` (`planned`)

---

## Agent 5 — File Formats, Sprite Sheet, Electron Native, Scripting, Extensions, CLI & Packaging (60 Planned Features)
- `format.aseprite_read`, `format.aseprite_write`, `format.png_codec`, `format.gif_codec`, `format.webp_codec`, `format.bmp_ico_tga`, `format.svg_export`, `format.palette_gpl_pal_hex`, `format.sequence_import_export`, `format.jpeg_codec`, `format.qoi_codec`, `format.flc_fli_anim`, `format.css_box_shadow` (`planned`)
- `sheet.export_dialog`, `sheet.layout_modes`, `sheet.trim_extrude`, `sheet.merge_duplicates`, `sheet.json_metadata`, `sheet.split_layers_tags`, `sheet.import_dialog`, `export.save_copy_as`, `export.repeat_last` (`planned`)
- `desktop.native_menus`, `desktop.file_associations`, `desktop.crash_autosave`, `desktop.recent_files_pin`, `desktop.multi_window`, `desktop.drag_drop_files`, `desktop.custom_titlebar`, `desktop.window_state_persist`, `desktop.auto_updater_check` (`planned`)
- `script.sandbox_runtime`, `script.api_sprite_layer_cel`, `script.custom_dialogs`, `script.script_console`, `script.scripts_folder_rescan`, `script.websocket_bridge`, `script.palette_generator`, `script.outline_batch` (`planned`)
- `ext.package_loader`, `ext.custom_themes`, `ext.custom_palettes`, `ext.custom_tools_commands`, `ext.manager_dialog`, `ext.language_packs`, `ext.dither_matrices` (`planned`)
- `cli.batch_mode`, `cli.sheet_pack`, `cli.script_exec`, `cli.json_format_templates`, `cli.trim_by_grid` (`planned`)
- `pkg.windows_nsis`, `pkg.macos_dmg`, `pkg.linux_appimage`, `qa.perf_benchmark_512`, `qa.perf_benchmark_4096`, `qa.ase_conformance`, `qa.e2e_smoke_suite`, `qa.memory_leak_check`, `qa.accessibility_audit` (`planned`)
