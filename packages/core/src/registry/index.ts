/**
 * @module @kekenik/core/registry
 * Generic Registry<T> and the 8 core registries that Agents 1..5 use to extend Kekenik Pixel.
 */

import { SpriteDocument } from "../commands/index.ts";
import { EventBus } from "../events/index.ts";
import { PixelImage, Sprite } from "../model/index.ts";
import { RGBA } from "../util/index.ts";

export type AgentNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type FeatureState = "planned" | "implemented" | "tested";

export interface RegistryEvents<T> extends Record<string, unknown> {
  registered: T;
  unregistered: string;
  updated: T;
  cleared: undefined;
}

/**
 * Generic typed Registry with change events.
 */
export class Registry<T extends { readonly id: string }> {
  public readonly name: string;
  public readonly events = new EventBus<RegistryEvents<T>>();
  private readonly items = new Map<string, T>();

  public constructor(name: string) {
    this.name = name;
  }

  /**
   * Registers or updates an item in the registry.
   */
  public register(item: T): void {
    const exists = this.items.has(item.id);
    this.items.set(item.id, item);
    if (exists) {
      this.events.emit("updated", item);
    } else {
      this.events.emit("registered", item);
    }
  }

  /**
   * Registers multiple items at once.
   */
  public registerMany(items: readonly T[]): void {
    for (const item of items) {
      this.register(item);
    }
  }

  /**
   * Removes an item by ID.
   */
  public unregister(id: string): boolean {
    const ok = this.items.delete(id);
    if (ok) {
      this.events.emit("unregistered", id);
    }
    return ok;
  }

  /**
   * Retrieves an item by ID or returns undefined.
   */
  public get(id: string): T | undefined {
    return this.items.get(id);
  }

  /**
   * Returns true if an item with `id` is registered.
   */
  public has(id: string): boolean {
    return this.items.has(id);
  }

  /**
   * Returns all registered items in insertion order.
   */
  public getAll(): T[] {
    return Array.from(this.items.values());
  }

  /**
   * Clears all registered items.
   */
  public clear(): void {
    this.items.clear();
    this.events.emit("cleared", undefined);
  }
}

// ---------------------------------------------------------------------------
// 1. ToolRegistry
// ---------------------------------------------------------------------------

export type ContextBarFieldSchema =
  | {
      key: string;
      label: string;
      type: "number";
      min: number;
      max: number;
      step?: number;
      suffix?: string;
    }
  | {
      key: string;
      label: string;
      type: "toggle";
    }
  | {
      key: string;
      label: string;
      type: "select";
      options: ReadonlyArray<{ value: string; label: string }>;
    };

export interface ToolPointerContext {
  readonly doc: SpriteDocument;
  readonly layerId: string;
  readonly frameIndex: number;
  readonly x: number;
  readonly y: number;
  readonly button: number; // 0 = left (FG), 2 = right (BG)
  readonly fgColor: RGBA;
  readonly bgColor: RGBA;
  readonly toolOptions: Record<string, unknown>;
  readonly setFgColor: (c: RGBA) => void;
  readonly setBgColor: (c: RGBA) => void;
}

export interface ToolDefinition {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  readonly cursor: string;
  readonly group: string;
  readonly defaultShortcut: string;
  readonly ownerAgent: AgentNumber;
  readonly state: FeatureState;
  readonly contextBarSchema: readonly ContextBarFieldSchema[];
  onPointerDown?(ctx: ToolPointerContext): void;
  onPointerMove?(ctx: ToolPointerContext): void;
  onPointerUp?(ctx: ToolPointerContext): void;
}

// ---------------------------------------------------------------------------
// 2. CommandRegistry
// ---------------------------------------------------------------------------

export interface CommandExecutionContext {
  readonly activeDoc: SpriteDocument | null;
  readonly args?: Record<string, unknown>;
}

export interface CommandDefinition {
  readonly id: string;
  readonly title: string;
  readonly category: "Menus" | "Tools" | "Actions" | "Mouse";
  readonly ownerAgent: AgentNumber;
  readonly state: FeatureState;
  run(ctx?: CommandExecutionContext): void | Promise<void>;
  enabled?(ctx?: CommandExecutionContext): boolean;
  checked?(ctx?: CommandExecutionContext): boolean;
}

// ---------------------------------------------------------------------------
// 3. PanelRegistry
// ---------------------------------------------------------------------------

export type DockSlot = "left" | "right" | "bottom" | "top" | "center" | "floating";

export interface PanelDefinition {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  readonly ownerAgent: AgentNumber;
  readonly state: FeatureState;
  readonly defaultDockSlot: DockSlot;
  readonly singleton: boolean;
  readonly floatable: boolean;
}

// ---------------------------------------------------------------------------
// 4. MenuRegistry
// ---------------------------------------------------------------------------

export type TopLevelMenu =
  | "File"
  | "Edit"
  | "Sprite"
  | "Layer"
  | "Frame"
  | "Select"
  | "View"
  | "Script"
  | "Extensions"
  | "Help";

export interface MenuItemDefinition {
  readonly id: string;
  readonly menu: TopLevelMenu;
  readonly label: string;
  readonly commandId?: string;
  readonly order: number;
  readonly ownerAgent: AgentNumber;
  readonly state: FeatureState;
  readonly separatorBefore?: boolean;
  readonly separatorAfter?: boolean;
  readonly submenu?: readonly MenuItemDefinition[];
  readonly children?: readonly MenuItemDefinition[];
  readonly checked?: boolean;
}

// ---------------------------------------------------------------------------
// 5. FormatRegistry
// ---------------------------------------------------------------------------

export interface FormatDefinition {
  readonly id: string;
  readonly name: string;
  readonly extensions: readonly string[];
  readonly canRead: boolean;
  readonly canWrite: boolean;
  readonly supportsAnimation: boolean;
  readonly supportsLayers: boolean;
  readonly ownerAgent: AgentNumber;
  readonly state: FeatureState;
  read?(bytes: Uint8Array): Promise<Sprite>;
  write?(sprite: Sprite): Promise<Uint8Array>;
}

// ---------------------------------------------------------------------------
// 6. FilterRegistry
// ---------------------------------------------------------------------------

export interface FilterDefinition {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly ownerAgent: AgentNumber;
  readonly state: FeatureState;
  apply?(image: PixelImage, params: Record<string, unknown>): PixelImage;
}

// ---------------------------------------------------------------------------
// 7. DialogRegistry
// ---------------------------------------------------------------------------

export interface DialogDefinition {
  readonly id: string;
  readonly title: string;
  readonly ownerAgent: AgentNumber;
  readonly state: FeatureState;
}

// ---------------------------------------------------------------------------
// 8. FeatureRegistry
// ---------------------------------------------------------------------------

export interface SelfTestResult {
  readonly passed: boolean;
  readonly message: string;
  readonly durationMs: number;
}

export interface FeatureDefinition {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly ownerAgent: AgentNumber;
  readonly state: FeatureState;
  readonly description: string;
  selfTest(): Promise<SelfTestResult> | SelfTestResult;
  demoActionId?: string;
}

// ---------------------------------------------------------------------------
// Singleton Registry Instances
// ---------------------------------------------------------------------------

export const ToolRegistry = new Registry<ToolDefinition>("ToolRegistry");
export const CommandRegistry = new Registry<CommandDefinition>("CommandRegistry");
export const PanelRegistry = new Registry<PanelDefinition>("PanelRegistry");
export const MenuRegistry = new Registry<MenuItemDefinition>("MenuRegistry");
export const FormatRegistry = new Registry<FormatDefinition>("FormatRegistry");
export const FilterRegistry = new Registry<FilterDefinition>("FilterRegistry");
export const DialogRegistry = new Registry<DialogDefinition>("DialogRegistry");
export const FeatureRegistry = new Registry<FeatureDefinition>("FeatureRegistry");
