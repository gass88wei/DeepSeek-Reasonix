/**
 * Reasonix Plugin System — type definitions.
 *
 * Inspired by @opencode-ai/plugin's `Plugin = (input) => Promise<Hooks>` pattern,
 * adapted to Reasonix Code's existing ToolRegistry + HookRunner + Loop architecture.
 *
 * A Plugin is an object with an `id` and a `register(ctx)` function that returns
 * the lifecycle hooks the plugin wants to attach to.
 */

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

/** The canonical shape of a Reasonix plugin. */
export interface Plugin {
  /** Stable identifier — used for dedup, unload, and error logging. */
  id: string;
  /** Human-readable name (shown in `/plugins` slash command). */
  name?: string;
  /** semver string. */
  version?: string;
  /** One-liner for `/plugins list`. */
  description?: string;
  /** Register function — called once at startup. Returns hooks or void. */
  register: (ctx: PluginContext) => Promise<PluginHooks | undefined>;
}

// ---------------------------------------------------------------------------
// Plugin context — what we hand to plugins so they can act
// ---------------------------------------------------------------------------

export interface PluginContext {
  /** Plugin's own stable id. */
  readonly pluginId: string;

  /** Read config values through the user's config chain. */
  config: <T = unknown>(keyPath: string, fallback?: T) => T;

  /** Logger scoped to this plugin — surfaces in `reasonix doctor` and session logs. */
  log: (level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => void;

  /** Register a cleanup function — called when the plugin is unloaded. */
  onDispose: (fn: () => void) => void;

  /** Host-owned LLM access. Plugins piggyback on the user's active model + auth. */
  llm: {
    /** Chat completion against the user's active model. */
    complete(
      messages: Array<{ role: string; content: string }>,
      opts?: LlmOptions,
    ): Promise<LlmCompleteResult>;

    /** Bounded structured inference — returns parsed JSON when schema is provided. */
    completeStructured(
      instruction: string,
      input: Array<{ type: "text" | "image"; text?: string; data?: Uint8Array }>,
      schema?: Record<string, unknown>,
    ): Promise<LlmStructuredResult>;
  };
}

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LlmCompleteResult {
  text: string;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

export interface LlmStructuredResult {
  text: string;
  parsed: unknown;
  provider: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Plugin hooks — all optional, return void, mutate output param to affect behavior
// ---------------------------------------------------------------------------

export interface PluginHooks {
  /**
   * Register custom tools merged into the global ToolRegistry.
   * The model sees them as first-class tools alongside built-in ones.
   */
  tools?: Record<string, PluginToolDefinition>;

  // -- Tool lifecycle (mirrors + extends the 4 existing HookEvents) ---------

  /** Called before a tool executes. Return `{ block: true, message }` to block. */
  "tool.execute.before"?: (input: ToolBeforeInput, output: ToolBeforeOutput) => Promise<void>;

  /** Called after a tool executes. Mutate `output.result` to modify the result. */
  "tool.execute.after"?: (input: ToolAfterInput, output: ToolAfterOutput) => Promise<void>;

  // -- Chat / prompt hooks --------------------------------------------------

  /** Called when the user submits a prompt. Mutate to rewrite the message. */
  "user.prompt"?: (
    input: { message: string; parts: unknown[] },
    output: { message: string; parts: unknown[] },
  ) => Promise<void>;

  /** Called before the LLM call. Mutate to tweak model / params. */
  "llm.params"?: (
    input: { model: string; messages: Array<{ role: string; content: string }> },
    output: LlmParamsOutput,
  ) => Promise<void>;

  /** Called with LLM response text before it reaches the user. Mutate to rewrite. */
  "llm.output"?: (input: { text: string }, output: { text: string }) => Promise<void>;

  // -- Shell command hooks --------------------------------------------------

  /** Called before a shell command runs. Mutate to rewrite command or env. */
  "command.before"?: (
    input: { command: string; cwd: string },
    output: { command: string; env: Record<string, string> },
  ) => Promise<void>;

  // -- Session lifecycle ----------------------------------------------------

  /** Fired once per new session. */
  "session.start"?: (sessionId: string) => Promise<void>;
  /** Fired when a session ends. */
  "session.end"?: (sessionId: string) => Promise<void>;

  // -- Permission hook ------------------------------------------------------

  /** Intercept permission prompts. Return `{ status: "allow" | "deny" }` to short-circuit. */
  "permission.ask"?: (
    input: { permission: string; description: string },
    output: { status: "ask" | "allow" | "deny" },
  ) => Promise<void>;

  // -- Tool definition hook -------------------------------------------------

  /** Modify a tool's description/params before sending to the LLM. */
  "tool.definition"?: (
    input: { toolId: string; description: string; parameters: unknown },
    output: { description: string; parameters: unknown },
  ) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Sub-types for hook inputs/outputs
// ---------------------------------------------------------------------------

export interface ToolBeforeInput {
  tool: string;
  args: Record<string, unknown>;
  sessionId: string;
}

export interface ToolBeforeOutput {
  /** If set, the tool call is replaced with this result and the real fn doesn't run. */
  block?: boolean;
  /** Message sent back to the model when blocked. */
  message?: string;
  /** Replaced args (only used when `block` is falsy). */
  args?: Record<string, unknown>;
}

export interface ToolAfterInput {
  tool: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
  sessionId: string;
}

export interface ToolAfterOutput {
  /** Replaces the tool result seen by the model. */
  result: string;
}

export interface LlmParamsOutput {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  system?: string;
}

// ---------------------------------------------------------------------------
// Tool definition — lighter version of ToolRegistry's ToolDefinition
// ---------------------------------------------------------------------------

export interface PluginToolDefinition {
  description: string;
  parameters?: Record<string, unknown>;
  /** If true, the tool is safe to call in plan mode. */
  readOnly?: boolean;
  /** If true, parallel execution with other tools is allowed. */
  parallelSafe?: boolean;
  /** The actual handler. */
  execute: (args: Record<string, unknown>, ctx: { signal?: AbortSignal }) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Plugin manager state types
// ---------------------------------------------------------------------------

export interface PluginEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  /** Where this plugin was loaded from — "builtin" | "file" | "npm" */
  source: "builtin" | "file" | "npm";
  /** File path or npm package spec. */
  sourceSpec: string;
  /** Error message if loading failed. */
  error?: string;
}
