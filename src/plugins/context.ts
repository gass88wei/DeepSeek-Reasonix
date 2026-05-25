/** PluginContext — injected into plugin.register(ctx). Provides config, log, llm, onDispose. */

import type { LlmCompleteResult, LlmOptions, LlmStructuredResult, PluginContext } from "./types.js";

/** Build a PluginContext for a plugin. */
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
      const line = meta ? `${prefix} ${message} ${JSON.stringify(meta)}` : `${prefix} ${message}`;
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

      async completeStructured(instruction, input, schema): Promise<LlmStructuredResult> {
        const { callStructuredForPlugin } = await import("./llm.js");
        return callStructuredForPlugin(pluginId, instruction, input, schema);
      },
    },
  };
}
