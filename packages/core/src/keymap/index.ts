/**
 * @module @kekenik/core/keymap
 * Keyboard shortcut manager, conflict detection, and same-key tool cycling.
 */

import { EventBus } from "../events/index.ts";
import defaultKeymapData from "./default-keymap.json";

export type KeymapCategory = "Menus" | "Tools" | "Actions" | "Mouse";

export interface KeyBinding {
  readonly commandId: string;
  readonly title: string;
  readonly category: KeymapCategory;
  keys: string;
  readonly defaultKeys: string;
  readonly cycleGroup?: string;
}

export interface KeyConflict {
  readonly keys: string;
  readonly commandIds: string[];
  readonly titles: string[];
  readonly isToolCycle: boolean;
}

export interface KeymapEvents extends Record<string, unknown> {
  changed: KeyBinding[];
}

/**
 * Normalizes a key chord string into canonical modifier order: `Ctrl+Alt+Shift+Key`.
 */
export function normalizeKeyChord(raw: string): string {
  if (!raw || !raw.trim()) return "";
  const parts = raw
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);

  let ctrl = false;
  let alt = false;
  let shift = false;
  const mainKeys: string[] = [];

  for (const part of parts) {
    const low = part.toLowerCase();
    if (low === "ctrl" || low === "control" || low === "meta" || low === "cmd") {
      ctrl = true;
    } else if (low === "alt" || low === "option") {
      alt = true;
    } else if (low === "shift") {
      shift = true;
    } else if (part.length === 1) {
      mainKeys.push(part.toUpperCase());
    } else {
      mainKeys.push(part);
    }
  }

  const out: string[] = [];
  if (ctrl) out.push("Ctrl");
  if (alt) out.push("Alt");
  if (shift) out.push("Shift");
  out.push(...mainKeys);
  return out.join("+");
}

/**
 * Detects duplicate key bindings across commands.
 * Distinguishes intentional tool cycle groups (where pressing the same key cycles tools)
 * from true conflicts.
 */
export function detectKeymapConflicts(bindings: readonly KeyBinding[]): KeyConflict[] {
  const byKey = new Map<string, KeyBinding[]>();
  for (const b of bindings) {
    const k = normalizeKeyChord(b.keys);
    if (!k) continue;
    const list = byKey.get(k) ?? [];
    list.push(b);
    byKey.set(k, list);
  }

  const conflicts: KeyConflict[] = [];
  for (const [keys, group] of byKey.entries()) {
    if (group.length <= 1) continue;
    const firstCycle = group[0].cycleGroup;
    const allSameCycle =
      Boolean(firstCycle) && group.every((item) => item.cycleGroup === firstCycle);
    conflicts.push({
      keys,
      commandIds: group.map((g) => g.commandId),
      titles: group.map((g) => g.title),
      isToolCycle: allSameCycle,
    });
  }
  return conflicts;
}

/**
 * Manages active keyboard bindings, conflict detection, tool cycling, and JSON persistence.
 */
export class KeymapManager {
  public readonly events = new EventBus<KeymapEvents>();
  private bindings: KeyBinding[];

  public constructor(initialBindings?: readonly KeyBinding[]) {
    const raw =
      initialBindings ??
      (defaultKeymapData.bindings as unknown as KeyBinding[]);
    this.bindings = raw.map((b) => ({
      ...b,
      keys: normalizeKeyChord(b.keys),
      defaultKeys: normalizeKeyChord(b.defaultKeys),
    }));
  }

  /**
   * Returns all bindings.
   */
  public getAll(): KeyBinding[] {
    return this.bindings.map((b) => ({ ...b }));
  }

  /**
   * Gets the binding for a specific command ID.
   */
  public getBinding(commandId: string): KeyBinding | undefined {
    return this.bindings.find((b) => b.commandId === commandId);
  }

  /**
   * Updates the key chord for a command ID.
   */
  public setBinding(commandId: string, newKeys: string): void {
    const target = this.bindings.find((b) => b.commandId === commandId);
    if (!target) {
      // Commands contributed by scripts/extensions have no built-in default: create a user binding.
      this.bindings.push({
        commandId,
        title: commandId,
        category: "Actions" as KeymapCategory,
        keys: normalizeKeyChord(newKeys),
        defaultKeys: "",
      });
      this.events.emit("changed", this.getAll());
      return;
    }
    target.keys = normalizeKeyChord(newKeys);
    this.events.emit("changed", this.getAll());
  }

  /**
   * Resets a single command's binding back to its Aseprite 1.3 default.
   */
  public resetOne(commandId: string): void {
    const target = this.bindings.find((b) => b.commandId === commandId);
    if (!target) return;
    if (target.defaultKeys === "") {
      // User/extension-created binding: removing it restores the original (unbound) state.
      this.bindings = this.bindings.filter((b) => b.commandId !== commandId);
    } else {
      target.keys = target.defaultKeys;
    }
    this.events.emit("changed", this.getAll());
  }

  /**
   * Resets all bindings back to defaults.
   */
  public resetAll(): void {
    for (const b of this.bindings) {
      b.keys = b.defaultKeys;
    }
    this.events.emit("changed", this.getAll());
  }

  /**
   * Resolves which command or next cycled tool should run when `chord` is pressed.
   */
  public resolveChord(chord: string, currentActiveToolId?: string): string | null {
    const norm = normalizeKeyChord(chord);
    if (!norm) return null;
    const matches = this.bindings.filter((b) => b.keys === norm);
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0].commandId;

    // Tool cycling: if currentActiveToolId is in matches, pick the next one in circular order
    if (currentActiveToolId) {
      const idx = matches.findIndex((m) => m.commandId === currentActiveToolId);
      if (idx >= 0) {
        return matches[(idx + 1) % matches.length].commandId;
      }
    }
    return matches[0].commandId;
  }

  /**
   * Returns all true (non-tool-cycle) conflicts, or all conflicts if `includeToolCycles` is true.
   */
  public getConflicts(includeToolCycles = false): KeyConflict[] {
    const all = detectKeymapConflicts(this.bindings);
    return includeToolCycles ? all : all.filter((c) => !c.isToolCycle);
  }

  /**
   * Exports current keymap to formatted JSON.
   */
  public exportJson(): string {
    return JSON.stringify({ version: 1, bindings: this.bindings }, null, 2);
  }

  /**
   * Imports bindings from a JSON string.
   */
  public importJson(json: string): void {
    const parsed = JSON.parse(json) as { bindings?: KeyBinding[] };
    if (!parsed || !Array.isArray(parsed.bindings)) {
      throw new Error("Invalid keymap JSON format");
    }
    for (const incoming of parsed.bindings) {
      const existing = this.bindings.find((b) => b.commandId === incoming.commandId);
      if (existing && typeof incoming.keys === "string") {
        existing.keys = normalizeKeyChord(incoming.keys);
      }
    }
    this.events.emit("changed", this.getAll());
  }
}

export const defaultKeymap = new KeymapManager();
