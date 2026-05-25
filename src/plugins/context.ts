/**
 * PluginContext implementation — the object handed to plugin.register(ctx).
 * Provides config access, logging, LLM facade, and disposal registration.
 */

import type { PluginContext, LlmOptions, LlmCompleteResult, LlmStructuredResult } from "./types.js";

/**
 * Build a PluginContext for a plugin with the given id.
 *
 * @param pluginId  The plugin's stable identifier.
 * @param disposers  Array pushed into by ctx.onDispose — the owner (PluginManager)
 *                   calls these on unload.
 */
export function createPluginContext(
  pluginId: string,
  disposers: Array<() => void>,
): PluginContext {
  return {
    pluginId,

    // -- Config -----------------------------------------------------------
    config: <T = unknown>(keyPath: string, fallback?: T): T => {
      try {
        // Deferred import to avoid circular dependency at module level.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { readConfig } = require("../config.js") as typeof import("../config.js");
        const cfg = readConfig();
        return resolvePath<T>(cfg, keyPath) ?? (fallback as T);
      } catch {
        return fallback as T;
      }
    },

    // -- Logger -----------------------------------------------------------
    log: (level, message, meta): void => {
      const prefix = `[plugins:${pluginId}]`;
      const line = meta ? `${prefix} ${message} ${JSON.stringify(meta)}` : `${prefix} ${message}`;
      switch (level) {
        case "error":
          process.stderr.write(`${line}\n`);
          break;
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

      async completeStructured(instruction, input, schema): Promise<LlmStructuredResult> {
        const { callStructuredForPlugin } = await import("./llm.js");
        return callStructuredForPlugin(pluginId, instruction, input, schema);
      },
    },
  };
}

/**
 * Walk a dotted key path into an object, e.g. resolvePath(cfg, "plugins.entries.my-plugin.llm").
 */
function resolvePath<T>(obj: unknown, path: string): T | undefined {
  const parts = path.split(".");
  let current: any = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current as T;
}
