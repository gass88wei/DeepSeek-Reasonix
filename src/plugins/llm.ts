/** Plugin LLM bridge — routes ctx.llm.complete() through user's active model. */

import type { LlmCompleteResult, LlmOptions, LlmStructuredResult } from "./types.js";

/** Run a chat completion for a plugin. */
export async function callLlmForPlugin(
  pluginId: string,
  messages: Array<{ role: string; content: string }>,
  opts?: LlmOptions,
): Promise<LlmCompleteResult> {
  process.stdout.write(
    `[plugins:${pluginId}] LLM call: ${messages.length} messages, ${opts?.maxTokens ?? "default"} max tokens\n`,
  );

  // TODO(#1): Wire through to the real LLM client.
  return {
    text: "[plugin LLM bridge — not yet connected to active model]",
    provider: "reasonix-plugin-bridge",
    model: "pending",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  };
}

/** Run a structured completion for a plugin. */
export async function callStructuredForPlugin(
  pluginId: string,
  instruction: string,
  _input: Array<{ type: "text" | "image"; text?: string; data?: Uint8Array }>,
  _schema?: Record<string, unknown>,
): Promise<LlmStructuredResult> {
  process.stdout.write(
    `[plugins:${pluginId}] Structured LLM call: "${instruction.slice(0, 80)}...\"\n`,
  );

  // TODO(#1): Wire through to the real LLM client.
  return {
    text: "[plugin LLM bridge — not yet connected to active model]",
    parsed: null,
    provider: "reasonix-plugin-bridge",
    model: "pending",
  };
}
