/**
 * @module @kekenik/ui/app/keyboard
 * Shared guard that keeps application-level shortcuts away from text-entry surfaces.
 *
 * The editor used to react to *every* keydown on `window`, so typing inside the CodeMirror
 * script editor (a `contenteditable` `.cm-content` element, not an `<input>`/`<textarea>`)
 * fired tool shortcuts and menu accelerators, making the editor unusable. Everything that
 * listens on `window` now starts with `isTextEntryTarget(e.target)`.
 */

const TEXT_ENTRY_SELECTOR = [
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[contenteditable="plaintext-only"]',
  ".cm-editor",
  ".cm-content",
  ".cm-line",
  '[role="textbox"]',
  '[data-kpx-text-entry="true"]',
].join(", ");

/**
 * Returns true when `target` belongs to a text-entry widget, i.e. when the keystroke must be
 * handled by that widget instead of by the application shortcut system.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { closest?: (selector: string) => Element | null }) | null;
  if (!el || typeof el.closest !== "function") return false;

  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;

  return Boolean(el.closest(TEXT_ENTRY_SELECTOR));
}
