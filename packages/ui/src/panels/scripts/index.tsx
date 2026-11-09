/**
 * @module @kekenik/ui/panels/scripts
 * Part B: Professional Script Editor Panel (CodeMirror 6 TS/JS editor, kekenik.d.ts autocomplete,
 * file tree of scripts/, Run/Stop, Console output with clickable line traces, Assign Shortcut,
 * 12 Sample Scripts dropdown) + ScriptCustomDialog + ScriptPermissionDialog.
 */

import { autocompletion, CompletionContext } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import React, { useEffect, useRef, useState } from "react";
import {
  BUILTIN_SAMPLE_SCRIPTS,
  ScriptDialogWidgetSpec,
  t,
} from "../../../../core/src/index.ts";
import { useAppStore } from "../../app/store.ts";
import { PixelIcon } from "../../skin/index.tsx";
import {
  ColorInputField,
  PixelButton,
  PixelCheckbox,
  PixelDialog,
  PixelSelect,
  PixelSlider,
  SectionDivider,
  TextAreaField,
  TextField,
} from "../../widgets/index.tsx";

const KEKENIK_AUTOCOMPLETE_ITEMS = [
  { label: "app.activeSprite", type: "property", info: "Currently active Sprite document" },
  { label: "app.activeLayer", type: "property", info: "Currently active Layer" },
  { label: "app.activeFrame", type: "property", info: "Active frame index (0-based)" },
  { label: "app.activeCel", type: "property", info: "Active Cel at (activeLayer, activeFrame)" },
  { label: "app.activeCel.image.setPixel", type: "method", info: "setPixel(x, y, {r,g,b,a})" },
  { label: "app.activeCel.image.getPixel", type: "method", info: "getPixel(x, y): ScriptRGBA" },
  { label: "app.activeCel.image.drawLine", type: "method", info: "drawLine(x0, y0, x1, y1, color)" },
  { label: "app.activeCel.image.drawRect", type: "method", info: "drawRect(x, y, w, h, color)" },
  { label: "app.activeCel.image.drawFilledRect", type: "method", info: "drawFilledRect(x, y, w, h, color)" },
  { label: "app.activeCel.image.clear", type: "method", info: "clear(color?)" },
  { label: "app.transaction", type: "function", info: "app.transaction(label, () => { ... }) atomic undo group" },
  { label: "app.dialog", type: "function", info: "app.dialog(dlg => { ... }) custom dialog builder" },
  { label: "app.alert", type: "function", info: "app.alert(msg)" },
  { label: "app.confirm", type: "function", info: "app.confirm(msg)" },
  { label: "app.prompt", type: "function", info: "app.prompt(msg, default)" },
  { label: "app.fs.readText", type: "method", info: "Permission-gated virtual file read" },
  { label: "app.fs.writeText", type: "method", info: "Permission-gated virtual file write" },
  { label: "app.fetch", type: "method", info: "Permission-gated PlatformAPI.fetch(url)" },
  { label: "Color.rgba", type: "function", info: "Color.rgba(r, g, b, a?)" },
  { label: "Color.fromHex", type: "function", info: "Color.fromHex('#ff0000')" },
  { label: "Color.hex", type: "function", info: "Color.hex(color)" },
  { label: "Color.blend", type: "function", info: "Color.blend(backdrop, source, opacity)" },
  { label: "events.on", type: "function", info: "events.on('frameChange'|'layerChange'|'beforeSave', fn)" },
];

function kekenikCompletionSource(context: CompletionContext) {
  const word = context.matchBefore(/[\w.]+/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: KEKENIK_AUTOCOMPLETE_ITEMS,
  };
}

/**
 * Dockable / Floatable Script Editor Panel (`panel.script_editor`)
 */
export const ScriptEditorPanel: React.FC = () => {
  const activeScriptName = useAppStore((s) => s.activeScriptName);
  const activeScriptCode = useAppStore((s) => s.activeScriptCode);
  const scriptDirty = useAppStore((s) => s.scriptDirty);
  const scriptRunning = useAppStore((s) => s.scriptRunning);
  const scriptConsoleLogs = useAppStore((s) => s.scriptConsoleLogs);
  const savedScripts = useAppStore((s) => s.savedScripts);
  const locale = useAppStore((s) => s.locale);

  const setActiveScript = useAppStore((s) => s.setActiveScript);
  const updateActiveScriptCode = useAppStore((s) => s.updateActiveScriptCode);
  const runActiveScript = useAppStore((s) => s.runActiveScript);
  const stopActiveScript = useAppStore((s) => s.stopActiveScript);
  const clearScriptConsole = useAppStore((s) => s.clearScriptConsole);
  const saveCurrentScript = useAppStore((s) => s.saveCurrentScript);
  const renameCurrentScript = useAppStore((s) => s.renameCurrentScript);
  const deleteScriptByName = useAppStore((s) => s.deleteScriptByName);
  const assignShortcutToScript = useAppStore((s) => s.assignShortcutToScript);
  const openDialog = useAppStore((s) => s.openDialog);

  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const cmViewRef = useRef<EditorView | null>(null);

  const [newFileName, setNewFileName] = useState("");
  const [shortcutInput, setShortcutInput] = useState("Ctrl+Shift+R");
  const [showShortcutBar, setShowShortcutBar] = useState(false);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);

  // Mount CodeMirror 6 editor instance
  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: activeScriptCode,
      extensions: [
        lineNumbers(),
        bracketMatching(),
        indentOnInput(),
        javascript({ typescript: true }),
        autocompletion({ override: [kekenikCompletionSource] }),
        keymap.of([
          indentWithTab,
          {
            key: "F5",
            run: () => {
              useAppStore.getState().runActiveScript();
              return true;
            },
          },
          {
            key: "Mod-Enter",
            run: () => {
              useAppStore.getState().runActiveScript();
              return true;
            },
          },
          {
            // App-level accelerators are suspended while a text widget has focus, so the
            // editor provides its own save shortcut.
            key: "Mod-s",
            run: () => {
              void useAppStore.getState().saveCurrentScript();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const nextCode = update.state.doc.toString();
            useAppStore.getState().updateActiveScriptCode(nextCode);
          }
        }),
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "11px",
            backgroundColor: "#14141b",
            color: "#e2e8f0",
          },
          ".cm-content": {
            fontFamily: "monospace",
            caretColor: "#38bdf8",
          },
          ".cm-gutters": {
            backgroundColor: "#0f1016",
            color: "#64748b",
            borderRight: "1px solid #27272a",
          },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: host,
    });
    cmViewRef.current = view;

    return () => {
      view.destroy();
      cmViewRef.current = null;
    };
    // Re-create CodeMirror view when switching script files
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScriptName]);

  // Sync external code updates (e.g. selecting a sample snippet) into CodeMirror
  useEffect(() => {
    const view = cmViewRef.current;
    if (!view) return;
    const currentText = view.state.doc.toString();
    if (currentText !== activeScriptCode) {
      view.dispatch({
        changes: { from: 0, to: currentText.length, insert: activeScriptCode },
      });
    }
  }, [activeScriptCode]);

  const jumpToLine = (lineNum: number) => {
    setSelectedLine(lineNum);
    const view = cmViewRef.current;
    if (!view) return;
    const clamped = Math.max(1, Math.min(view.state.doc.lines, lineNum));
    const lineInfo = view.state.doc.line(clamped);
    view.dispatch({
      selection: { anchor: lineInfo.from, head: lineInfo.to },
      scrollIntoView: true,
    });
    view.focus();
  };

  return (
    <div
      dir="ltr"
      className="flex flex-col h-full p-1.5 gap-1.5 text-xs font-mono select-none overflow-hidden"
    >
      {/* Top Toolbar: Run, Stop, Save, New, Sample Dropdown, Assign Shortcut */}
      <div className="flex flex-wrap items-center justify-between gap-1 bg-[var(--kpx-chrome-bg)] p-1 border border-black text-black">
        <div className="flex flex-wrap items-center gap-1">
          <PixelButton
            size="xs"
            onClick={() => runActiveScript()}
            disabled={scriptRunning}
            title="Run Script in Sandboxed Worker (F5 / Ctrl+Enter)"
          >
            <PixelIcon name="play" size={10} />
            <span>{t("script.editor.run", locale)}</span>
          </PixelButton>
          <PixelButton
            size="xs"
            onClick={() => stopActiveScript()}
            disabled={!scriptRunning}
            title="Stop Running Script"
          >
            <PixelIcon name="close" size={10} />
            <span>{t("script.editor.stop", locale)}</span>
          </PixelButton>
          <PixelButton
            size="xs"
            onClick={() => void saveCurrentScript()}
            title="Save Script to PlatformAPI.dataDir()/scripts/"
          >
            <PixelIcon name="save" size={10} />
            <span>
              {t("common.save", locale)}
              {scriptDirty ? "*" : ""}
            </span>
          </PixelButton>
          <PixelButton
            size="xs"
            active={showShortcutBar}
            onClick={() => setShowShortcutBar(!showShortcutBar)}
            title="Assign Keyboard Shortcut to Current Script"
          >
            <PixelIcon name="keyboard" size={10} />
            <span>{t("script.editor.assign_shortcut", locale)}</span>
          </PixelButton>
        </div>

        {/* Sample Scripts Snippet Library Dropdown */}
        <div className="flex items-center gap-1">
          <PixelSelect
            ariaLabel="Sample Scripts Library"
            value=""
            onChange={(fileName) => {
              const found = BUILTIN_SAMPLE_SCRIPTS.find((s) => s.fileName === fileName);
              if (found) {
                setActiveScript(found.fileName, found.code);
              }
            }}
            options={[
              { value: "", label: t("script.editor.samples", locale) },
              ...BUILTIN_SAMPLE_SCRIPTS.map((s) => ({
                value: s.fileName,
                label: s.title,
              })),
            ]}
          />
        </div>
      </div>

      {/* Assign Shortcut Bar */}
      {showShortcutBar && (
        <div className="flex items-center justify-between gap-1 p-1 bg-black/20 border border-black/40 text-[11px]">
          <span>Bind &quot;{activeScriptName}&quot; to key:</span>
          <div className="flex items-center gap-1">
            <TextField
              ariaLabel="Script Shortcut Chord"
              value={shortcutInput}
              onChange={setShortcutInput}
              className="w-28 px-1 py-0.5 text-[11px]"
            />
            <PixelButton
              size="xs"
              onClick={() => {
                assignShortcutToScript(activeScriptName, shortcutInput);
                setShowShortcutBar(false);
              }}
            >
              Bind
            </PixelButton>
            <PixelButton
              size="xs"
              onClick={() => openDialog("dialog.shortcuts")}
              title="Open Full Keyboard Shortcuts Dialog"
            >
              All Shortcuts...
            </PixelButton>
          </div>
        </div>
      )}

      {/* Middle Split: Left File Tree of scripts/ + Right CodeMirror 6 Editor */}
      <div className="flex-1 min-h-0 flex gap-1.5 overflow-hidden">
        {/* File Tree of scripts/ */}
        <div className="w-36 shrink-0 flex flex-col gap-1 kpx-bevel-inset bg-[#181820] text-slate-200 p-1 overflow-y-auto">
          <div className="font-bold text-[10px] text-amber-300 border-b border-white/15 pb-0.5 flex items-center justify-between">
            <span>scripts/ ({savedScripts.length})</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-0.5">
            {savedScripts.map((file) => {
              const isSelected = file.name === activeScriptName;
              return (
                <button
                  key={file.name}
                  type="button"
                  onClick={() => setActiveScript(file.name, file.code)}
                  className={`w-full text-left px-1 py-0.5 text-[10px] truncate flex items-center justify-between rounded ${
                    isSelected
                      ? "bg-sky-700 text-white font-bold"
                      : "hover:bg-white/10 text-slate-300"
                  }`}
                  title={`${file.name}${file.shortcut ? ` (${file.shortcut})` : ""}`}
                >
                  <span className="truncate">
                    {file.name}
                    {isSelected && scriptDirty ? "*" : ""}
                  </span>
                  {file.shortcut && (
                    <span className="text-[9px] text-amber-300 ml-1 shrink-0">
                      {file.shortcut}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* New / Rename / Delete File Controls */}
          <div className="pt-1 border-t border-white/15 space-y-1">
            <TextField
              ariaLabel="New or Rename Script Filename"
              value={newFileName}
              onChange={setNewFileName}
              placeholder="my-script.ts"
              className="w-full px-1 py-0.5 text-[10px]"
            />
            <div className="flex items-center justify-between gap-0.5">
              <PixelButton
                size="xs"
                onClick={() => {
                  const target = newFileName.trim() || `custom-${savedScripts.length + 1}.ts`;
                  void saveCurrentScript(target);
                  setNewFileName("");
                }}
                title="Create New Script File"
              >
                New
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => {
                  if (newFileName.trim()) {
                    void renameCurrentScript(newFileName.trim());
                    setNewFileName("");
                  }
                }}
                title="Rename Active Script"
              >
                Ren
              </PixelButton>
              <PixelButton
                size="xs"
                onClick={() => void deleteScriptByName(activeScriptName)}
                title="Delete Active Script"
              >
                Del
              </PixelButton>
            </div>
          </div>
        </div>

        {/* CodeMirror 6 Editor + Synchronized Direct Input Bar */}
        <div className="flex-1 min-w-0 flex flex-col gap-1 overflow-hidden">
          <div className="flex items-center justify-between text-[10px] px-1 bg-[#1e1e2a] text-slate-200 border border-black">
            <span>
              File: <strong>{activeScriptName}</strong>
              {scriptDirty ? " (Modified *)" : " (Saved)"}
              {selectedLine ? ` — Line ${selectedLine}` : ""}
            </span>
            <span className="text-emerald-300">Autocomplete: kekenik.d.ts active</span>
          </div>

          {/* CodeMirror 6 Host Container */}
          <div
            ref={editorHostRef}
            className="flex-1 min-h-[110px] kpx-bevel-inset bg-[#14141b] overflow-auto"
          />

          {/* Synchronized accessible textarea for quick copy/paste & headless tests */}
          <TextAreaField
            ariaLabel="Script Source Editor"
            value={activeScriptCode}
            onChange={updateActiveScriptCode}
            rows={2}
            placeholder="Write TS/JS here, e.g.: app.activeCel.image.setPixel(0,0,{r:255,g:0,b:0,a:255})"
            className="w-full bg-[#0f1016] text-emerald-300 px-1.5 py-1 text-[10px] font-mono resize-none"
          />
        </div>
      </div>

      {/* Bottom Console Output Pane with clickable error line numbers */}
      <div className="h-28 shrink-0 flex flex-col kpx-bevel-inset bg-[#0f1016] text-slate-200 p-1">
        <div className="flex items-center justify-between border-b border-white/15 pb-0.5 mb-0.5 text-[10px]">
          <span className="font-bold text-sky-300">
            {t("script.editor.console", locale)} ({scriptConsoleLogs.length})
          </span>
          <div className="flex items-center gap-1">
            <PixelButton
              size="xs"
              onClick={() =>
                runActiveScript(
                  `app.activeCel.image.setPixel(0,0,{r:255,g:0,b:0,a:255})`,
                  "quick-red-pixel.ts"
                )
              }
              title="One-Click Acceptance Test: Set Pixel (0,0) to Red"
            >
              Set (0,0) Red
            </PixelButton>
            <PixelButton size="xs" onClick={clearScriptConsole}>
              Clear
            </PixelButton>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto space-y-0.5 text-[10px] font-mono">
          {scriptConsoleLogs.map((entry, idx) => (
            <div key={idx} className="flex items-center justify-between gap-1 leading-tight">
              <div
                className={
                  entry.level === "error"
                    ? "text-red-400 font-bold"
                    : entry.level === "warn"
                    ? "text-amber-300"
                    : "text-emerald-300"
                }
              >
                <span className="text-slate-500">[{entry.timestamp}]</span> {entry.message}
              </div>
              {entry.line !== undefined && (
                <button
                  type="button"
                  onClick={() => jumpToLine(entry.line!)}
                  className="px-1 bg-red-900/60 hover:bg-red-700 text-white rounded text-[9px] underline shrink-0"
                >
                  Line {entry.line}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/**
 * DialogRegistry-rendered React Dialog for `app.dialog(builderFn)` (`dialog.script_custom`)
 */
export const ScriptCustomDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const dlg = useAppStore((s) => s.activeScriptDialog);
  const closeScriptDialog = useAppStore((s) => s.closeScriptDialog);
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...(dlg?.values ?? {}),
  }));

  if (!dlg) return null;

  const updateVal = (id: string, val: unknown) => {
    const next = { ...values, [id]: val };
    setValues(next);
    dlg.trigger("change", next);
  };

  const handleConfirm = () => {
    dlg.trigger("confirm", values);
    closeScriptDialog();
    onClose();
  };

  return (
    <PixelDialog
      title={dlg.title || "Script Dialog"}
      onClose={() => {
        dlg.trigger("cancel", values);
        closeScriptDialog();
        onClose();
      }}
      widthClass="w-[380px]"
    >
      <div className="space-y-2.5 text-xs font-mono">
        {dlg.widgets.map((w: ScriptDialogWidgetSpec) => {
          switch (w.type) {
            case "label":
              return (
                <div key={w.id} className="py-0.5 font-bold">
                  {w.text}
                </div>
              );
            case "slider":
              return (
                <PixelSlider
                  key={w.id}
                  label={w.label ?? w.id}
                  min={w.min ?? 0}
                  max={w.max ?? 100}
                  value={Number(values[w.id] ?? w.value ?? 0)}
                  onChange={(v) => updateVal(w.id, v)}
                />
              );
            case "entry":
              return (
                <div key={w.id} className="flex items-center justify-between gap-2">
                  <span>{w.label ?? w.id}:</span>
                  <TextField
                    value={String(values[w.id] ?? w.value ?? "")}
                    onChange={(val) => updateVal(w.id, val)}
                    className="flex-1 px-1.5 py-0.5 text-xs"
                  />
                </div>
              );
            case "combo":
              return (
                <div key={w.id} className="flex items-center justify-between gap-2">
                  <span>{w.label ?? w.id}:</span>
                  <PixelSelect
                    ariaLabel={w.label ?? w.id}
                    value={String(values[w.id] ?? w.value ?? "")}
                    onChange={(v) => updateVal(w.id, v)}
                    options={(w.options ?? []).map((o) => ({ value: o, label: o }))}
                  />
                </div>
              );
            case "checkbox":
              return (
                <PixelCheckbox
                  key={w.id}
                  checked={Boolean(values[w.id] ?? w.checked)}
                  onChange={(v) => updateVal(w.id, v)}
                  label={w.label ?? w.id}
                />
              );
            case "color":
              return (
                <div key={w.id} className="flex items-center justify-between gap-2">
                  <span>{w.label ?? w.id}:</span>
                  <ColorInputField
                    value={typeof w.value === "string" ? w.value : "#ff0000"}
                    onChange={(hex) => updateVal(w.id, hex)}
                    className="w-10 h-5"
                  />
                </div>
              );
            case "canvas":
              return (
                <div key={w.id} className="p-1 kpx-bevel-inset bg-[#181820] flex justify-center">
                  <div className="text-[10px] text-emerald-300">
                    Script Canvas ({w.width}x{w.height} px)
                  </div>
                </div>
              );
            case "button":
              return (
                <PixelButton
                  key={w.id}
                  onClick={() => {
                    dlg.trigger(`click:${w.id}`, values);
                    handleConfirm();
                  }}
                >
                  {w.text ?? w.id}
                </PixelButton>
              );
            default:
              return null;
          }
        })}

        <SectionDivider label="" />
        <div className="flex justify-end gap-1.5">
          <PixelButton onClick={handleConfirm}>OK</PixelButton>
          <PixelButton
            onClick={() => {
              closeScriptDialog();
              onClose();
            }}
          >
            Close
          </PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};

/**
 * Permission Request Dialog (`dialog.script_permissions`) shown when a script requests
 * `fs.read`, `fs.write`, `network`, or `dialogs`.
 */
export const ScriptPermissionDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const req = useAppStore((s) => s.pendingPermissionRequest);
  const resolvePermissionPrompt = useAppStore((s) => s.resolvePermissionPrompt);
  const locale = useAppStore((s) => s.locale);

  if (!req) return null;

  return (
    <PixelDialog
      title={t("dialog.script_permissions", locale)}
      onClose={() => {
        resolvePermissionPrompt(false);
        onClose();
      }}
      widthClass="w-[410px]"
    >
      <div className="space-y-2.5 text-xs font-mono">
        <div className="p-2 bg-amber-950/30 border border-amber-700/50 space-y-1">
          <div className="font-bold">
            Script &quot;{req.scriptName}&quot; requests permission:
          </div>
          <div>
            Permission: <strong className="underline">{req.permission}</strong>
          </div>
          <div>
            Operation: <strong>{req.operation}</strong>
          </div>
          <div>
            Target Path / Resource: <strong>{req.resource}</strong>
          </div>
          <div className="text-[10px] opacity-75">
            Script Hash: {req.scriptHash} (Decision will be remembered for this script hash)
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <PixelButton
            onClick={() => {
              resolvePermissionPrompt(true);
              onClose();
            }}
          >
            {t("script.permissions.allow", locale)}
          </PixelButton>
          <PixelButton
            onClick={() => {
              resolvePermissionPrompt(false);
              onClose();
            }}
          >
            {t("script.permissions.deny", locale)}
          </PixelButton>
        </div>
      </div>
    </PixelDialog>
  );
};
