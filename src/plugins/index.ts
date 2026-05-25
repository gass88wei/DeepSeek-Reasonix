/**
 * PluginManager — central registry for all loaded plugins.
 *
 * Lifecycle:
 *   1. PluginManager.load(plugin) → register() → stores returned hooks
 *   2. PluginManager.trigger(event, input, output) → dispatches to all plugins
 *   3. PluginManager.unload(id) → calls onDispose callbacks, removes hooks
 *
 * Integration with existing systems:
 *   - ToolRegistry: call pluginManager.collectTools() to get all plugin-defined tools
 *   - Loop: call pluginManager.trigger("llm.params", ...) before each LLM call
 *   - Hooks: Plugin hooks run BEFORE shell hooks in the same event
 */

import { createPluginContext } from "./context.js";
import type {
  LlmParamsOutput,
  Plugin,
  PluginEntry,
  PluginHooks,
  PluginToolDefinition,
  ToolAfterInput,
  ToolAfterOutput,
  ToolBeforeInput,
  ToolBeforeOutput,
} from "./types.js";

export type { Plugin, PluginHooks, PluginEntry };

/** Idempotence lock — prevents double-load of the same plugin id. */
const SYMBOL_LOADED = Symbol("reasonix.plugin.loaded");

export class PluginManager {
  /** Plugin id → resolved hooks. */
  #hooks = new Map<string, PluginHooks>();
  /** Plugin id → metadata. */
  #entries = new Map<string, PluginEntry>();
  /** Plugin id → disposers. */
  #disposers = new Map<string, Array<() => void>>();
  /** Optional config reader injected from host. */
  #configReader?: <T>(keyPath: string, fallback?: T) => T;

  constructor(configReader?: <T>(keyPath: string, fallback?: T) => T) {
    this.#configReader = configReader;
  }

  // -----------------------------------------------------------------------
  // Load / Unload
  // -----------------------------------------------------------------------

  /**
   * Load one plugin. Calls `plugin.register(ctx)` and stores the result.
   * Returns false if the plugin was already loaded (idempotent).
   */
  async load(plugin: Plugin): Promise<boolean> {
    const id = plugin.id;
    if ((plugin as Record<symbol, unknown>)[SYMBOL_LOADED]) return false;
    if (this.#hooks.has(id)) {
      this.unload(id);
    }

    const disposers: Array<() => void> = [];
    const ctx = createPluginContext(id, disposers, this.#configReader);

    try {
      const hooks = (await plugin.register(ctx)) ?? {};
      this.#hooks.set(id, hooks as PluginHooks);
      this.#disposers.set(id, disposers);
      this.#entries.set(id, {
        id,
        name: plugin.name ?? id,
        version: plugin.version ?? "0.0.0",
        description: plugin.description ?? "",
        enabled: true,
        source: "file",
        sourceSpec: id,
      });
      (plugin as Record<symbol, unknown>)[SYMBOL_LOADED] = true;
      return true;
    } catch (err) {
      this.#entries.set(id, {
        id,
        name: plugin.name ?? id,
        version: plugin.version ?? "0.0.0",
        description: plugin.description ?? "",
        enabled: false,
        source: "file",
        sourceSpec: id,
        error: String(err),
      });
      return false;
    }
  }

  /**
   * Unload a plugin — calls all onDispose callbacks and removes hooks.
   */
  unload(id: string): void {
    const disposers = this.#disposers.get(id);
    if (disposers) {
      for (const fn of disposers) {
        try {
          fn();
        } catch {
          // dispose errors are non-fatal
        }
      }
    }
    this.#hooks.delete(id);
    this.#disposers.delete(id);
    this.#entries.delete(id);
  }

  /** Unload all plugins. Used during shutdown. */
  unloadAll(): void {
    for (const id of [...this.#hooks.keys()]) {
      this.unload(id);
    }
  }

  // -----------------------------------------------------------------------
  // Hook dispatch
  // -----------------------------------------------------------------------

  /**
   * Trigger a hook event across all loaded plugins.
   * Plugins fire in registration order — earlier plugins see events first.
   */
  async trigger<E extends keyof PluginHooks>(
    event: E,
    input: unknown,
    output: unknown,
  ): Promise<void> {
    for (const hooks of this.#hooks.values()) {
      const handler = hooks[event] as
        | ((input: unknown, output: unknown) => Promise<void>)
        | undefined;
      if (typeof handler === "function") {
        try {
          await handler(input, output);
        } catch (err) {
          process.stderr.write(`[plugins] hook "${event}" in plugin failed: ${err}\n`);
        }
      }
    }
  }

  /** Convenience: trigger "tool.execute.before" with the right shape. */
  async triggerToolBefore(input: ToolBeforeInput, output: ToolBeforeOutput): Promise<void> {
    await this.trigger("tool.execute.before", input, output);
  }

  /** Convenience: trigger "tool.execute.after" with the right shape. */
  async triggerToolAfter(input: ToolAfterInput, output: ToolAfterOutput): Promise<void> {
    await this.trigger("tool.execute.after", input, output);
  }

  /** Convenience: trigger "llm.params" with the right shape. */
  async triggerLlmParams(
    messages: Array<{ role: string; content: string }>,
    model: string,
    output: LlmParamsOutput,
  ): Promise<void> {
    await this.trigger("llm.params", { model, messages }, output);
  }

  // -----------------------------------------------------------------------
  // Tool collection
  // -----------------------------------------------------------------------

  /**
   * Collect every tool registered by plugins, keyed by tool name.
   * Call this during startup and merge into the ToolRegistry.
   */
  collectTools(): Record<string, PluginToolDefinition> {
    const all: Record<string, PluginToolDefinition> = {};
    for (const hooks of this.#hooks.values()) {
      if (hooks.tools) {
        for (const [name, def] of Object.entries(hooks.tools)) {
          if (name in all) {
            process.stderr.write(
              `[plugins] tool "${name}" registered by multiple plugins; last wins\n`,
            );
          }
          all[name] = def;
        }
      }
    }
    return all;
  }

  /** Number of currently loaded plugins. */
  get size(): number {
    return this.#hooks.size;
  }

  /** List all plugin entries with metadata. */
  entries(): PluginEntry[] {
    return [...this.#entries.values()];
  }

  /** Check if a specific plugin id is loaded. */
  has(id: string): boolean {
    return this.#hooks.has(id);
  }
}
