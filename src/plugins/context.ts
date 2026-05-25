/**
 * PluginContext implementation — the object handed to plugin.register(ctx).
 * Provides config access, logging, LLM facade, and disposal registration.
 *
 * The configReader function is injected by PluginManager to avoid circular
 * imports between plugins/* and config.ts.
 */

import type { PluginContext, LlmOptions, LlmCompleteResult, LlmStructuredResult } from "./types.js";

/**
 * Build a PluginContext for a plugin with the given id.
 *
 * @param pluginId  The plugin's stable identifier.
 * @param disposers  Array pushed into by ctx.onDispose — the owner (PluginManager)
 *                   calls these on unload.
 * @param configReader  Optional synchronous config reader injected by PluginManager.
 *                      If absent, config() always returns the fallback.
 */
export function createPluginContext(
  pluginId: string,
  disposers: Array<() => void>,
  configReader?: <T>(keyPath: string, fallback?: T) => T,
): PluginContext {
  return {
    pluginId,

    // -- Config -----------------------------------------------------------
    config: <T = unknown>(keyPath: string, fallback?: T): T => {
      if (configReader) {
        return configReader(keyPath, fallback);
      }
      return fallback as T;
    },

    // -- Logger -----------------------------------------------------------
    log: (level, message, meta): void => {
      const prefix = `[plugins:${pluginId}]`;
      const line = meta
        ? `${prefix} ${message} ${JSON.stringify(meta)}`
        : `${prefix} ${message}`;
      switch (level) {
        case "error":
        case "warn":
          process.stderr.write(`${line}\n`);
          break;
        default:
          process.stdout.write(`${line}\n`);
      }
    },

    // -- Dispose ----------------------------------------------------------
    onDispose: (fn): void => {
      disposers.push(fn);
    },

    // -- LLM facade -------------------------------------------------------
    llm: {
      async complete(messages, opts): Promise<LlmCompleteResult> {
        const { callLlmForPlugin } = await import("./llm.js");
        return callLlmForPlugin(pluginId, messages, opts);
      },

      async completeStructured(
        instruction,
        input,
        schema,
      ): Promise<LlmStructuredResult> {
        const { callStructuredForPlugin } = await import("./llm.js");
        return callStructuredForPlugin(pluginId, instruction, input, schema);
      },
    },
  };
}
