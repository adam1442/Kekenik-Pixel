/**
 * @module @kekenik/core/events
 * Strongly-typed synchronous event bus for core model, history, and registries.
 */

export type EventHandler<T> = (payload: T) => void;

/**
 * Typed EventBus supporting subscribe (`on`), one-shot (`once`), unsubscribe (`off`), and `emit`.
 */
export class EventBus<EventMap extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof EventMap, Set<EventHandler<unknown>>>();

  /**
   * Subscribes a listener to a typed event and returns an unsubscribe function.
   */
  public on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as EventHandler<unknown>);
    return () => {
      this.off(event, handler);
    };
  }

  /**
   * Subscribes a one-shot listener that automatically unsubscribes after its first invocation.
   */
  public once<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): () => void {
    const wrapper: EventHandler<EventMap[K]> = (payload) => {
      this.off(event, wrapper);
      handler(payload);
    };
    return this.on(event, wrapper);
  }

  /**
   * Removes a previously registered listener.
   */
  public off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler as EventHandler<unknown>);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Emits an event payload synchronously to all registered listeners.
   */
  public emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      fn(payload);
    }
  }

  /**
   * Clears all listeners across all events.
   */
  public clear(): void {
    this.listeners.clear();
  }
}
