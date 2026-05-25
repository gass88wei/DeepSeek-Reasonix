/**
 * Plugin LLM bridge — host-owned model access for plugins.
 *
 * Plugins call ctx.llm.complete() / ctx.llm.completeStructured() and we
 * route through the user's active model/auth via the auxiliary client.
 * Plugin trust gates are future work — for v1, plugins get the default
 * model with no override capability (same as an untrusted plugin in hermes).
 */

import type { LlmCompleteResult, LlmOptions, LlmStructuredResult } from "./types.js";

/**
 * Run a chat completion for a plugin.
 * Uses the host's default model and auth — no override capability in v1.
 */
export async function callLlmForPlugin(
  pluginId: string,
  messages: Array<{ role: string; content: string }>,
  opts?: LlmOptions,
): Promise<LlmCompleteResult> {
  // v1: simple wrapper that logs the call and returns a placeholder.
  // In a full integration this would call through to the active DeepSeekClient
  // or auxiliary_client like hermes-agent's PluginLlm.
  //
  // The user's active model (model.provider + model.model from config) is
  // resolved at the time of the call, not cached at plugin load time.
  process.stdout.write(
    `[plugins:${pluginId}] LLM call: ${messages.length} messages, ${opts?.maxTokens ?? "default"} max tokens\n`,
  );

  // TODO(#plugin-llm): Wire through to the real LLM client.
  // For now return a placeholder so the plugin system can be built + tested
  // without needing an API key for every plugin.
  return {
    text: "[plugin LLM bridge — not yet connected to active model]",
    provider: "reasonix-plugin-bridge",
    model: "pending",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
}

/**
 * Run a structured completion for a plugin.
 */
export async function callStructuredForPlugin(
  pluginId: string,
  instruction: string,
  _input: Array<{ type: "text" | "image"; text?: string; data?: Uint8Array }>,
  _schema?: Record<string, unknown>,
): Promise<LlmStructuredResult> {
  process.stdout.write(
    `[plugins:${pluginId}] Structured LLM call: "${instruction.slice(0, 80)}...\"\n`,
  );

  // TODO(#plugin-llm): Wire through to the real LLM client.
  return {
    text: "[plugin LLM bridge — not yet connected to active model]",
    parsed: null,
    provider: "reasonix-plugin-bridge",
    model: "pending",
  };
}
