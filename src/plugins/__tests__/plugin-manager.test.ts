/** PluginManager tests */

import { beforeEach, describe, expect, it } from "vitest";
import { PluginManager } from "../index.js";
import type { Plugin, PluginContext, PluginHooks } from "../types.js";

function makePlugin(
  id: string,
  // biome-ignore lint/suspicious/noConfusingVoidType: needed for callback void return compatibility
  hooks?: PluginHooks | ((ctx: PluginContext) => PluginHooks | undefined | void),
): Plugin {
  return {
    id,
    name: `Test: ${id}`,
    version: "1.0.0",
    description: "A test plugin",
    async register(ctx) {
      if (typeof hooks === "function") {
        return (hooks(ctx) ?? {}) as PluginHooks;
      }
      return (hooks ?? {}) as PluginHooks;
    },
  };
}

describe("PluginManager", () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  // Load / Unload

  it("loads a plugin and tracks it", async () => {
    const plugin = makePlugin("test-1", {});
    const ok = await manager.load(plugin);
    expect(ok).toBe(true);
    expect(manager.size).toBe(1);
    expect(manager.has("test-1")).toBe(true);
  });

  it("returns false when loading the same plugin twice", async () => {
    const plugin = makePlugin("dup", {});
    await manager.load(plugin);
    const second = await manager.load(plugin);
    expect(second).toBe(false);
  });

  it("unloads a plugin and removes it", async () => {
    const plugin = makePlugin("gone", {});
    await manager.load(plugin);
    expect(manager.has("gone")).toBe(true);
    manager.unload("gone");
    expect(manager.has("gone")).toBe(false);
    expect(manager.size).toBe(0);
  });

  it("calls onDispose when unloading", async () => {
    let disposed = false;
    const plugin = makePlugin("cleanup", (ctx) => {
      ctx.onDispose(() => {
        disposed = true;
      });
    });
    await manager.load(plugin);
    manager.unload("cleanup");
    expect(disposed).toBe(true);
  });

  it("unloadAll cleans everything", async () => {
    await manager.load(makePlugin("a"));
    await manager.load(makePlugin("b"));
    await manager.load(makePlugin("c"));
    expect(manager.size).toBe(3);
    manager.unloadAll();
    expect(manager.size).toBe(0);
  });

  it("handles a plugin that throws during register", async () => {
    const badPlugin: Plugin = {
      id: "bad",
      async register() {
        throw new Error("kaboom");
      },
    };
    const ok = await manager.load(badPlugin);
    expect(ok).toBe(false);
    // Error is recorded in entries
    const entries = manager.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.error).toContain("kaboom");
  });

  // entries()

  it("entries() returns metadata for loaded plugins", async () => {
    await manager.load(makePlugin("meta-test", {}));
    const entries = manager.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("meta-test");
    expect(entries[0]?.name).toBe("Test: meta-test");
    expect(entries[0]?.version).toBe("1.0.0");
    expect(entries[0]?.enabled).toBe(true);
  });

  // collectTools()

  it("collectTools aggregates tools from all plugins", async () => {
    await manager.load(
      makePlugin("a", {
        tools: {
          tool_a: {
            description: "Tool A",
            async execute() {
              return "a";
            },
          },
        },
      }),
    );
    await manager.load(
      makePlugin("b", {
        tools: {
          tool_b: {
            description: "Tool B",
            async execute() {
              return "b";
            },
          },
        },
      }),
    );

    const all = manager.collectTools();
    expect(Object.keys(all)).toEqual(["tool_a", "tool_b"]);
  });

  it("collectTools returns empty when no plugins have tools", async () => {
    await manager.load(makePlugin("no-tools", {}));
    expect(manager.collectTools()).toEqual({});
  });

  // trigger()

  it("trigger fires the correct hook", async () => {
    const calls: string[] = [];
    await manager.load(
      makePlugin("hook-test", {
        "session.start": async (id) => {
          calls.push(`start:${id}`);
        },
        "session.end": async (id) => {
          calls.push(`end:${id}`);
        },
      }),
    );

    await manager.trigger("session.start", "sess-1", {});
    await manager.trigger("session.end", "sess-1", {});

    expect(calls).toEqual(["start:sess-1", "end:sess-1"]);
  });

  it("trigger reaches all plugins in order", async () => {
    const order: number[] = [];
    await manager.load(
      makePlugin("first", {
        "session.start": async () => {
          order.push(1);
        },
      }),
    );
    await manager.load(
      makePlugin("second", {
        "session.start": async () => {
          order.push(2);
        },
      }),
    );

    await manager.trigger("session.start", "s", {});
    expect(order).toEqual([1, 2]);
  });

  it("trigger does not break when a handler throws", async () => {
    const calls: string[] = [];
    await manager.load(
      makePlugin("thrower", {
        "session.start": async () => {
          throw new Error("oops");
        },
      }),
    );
    await manager.load(
      makePlugin("catcher", {
        "session.start": async (id) => {
          calls.push(`ok:${id}`);
        },
      }),
    );

    await manager.trigger("session.start", "sess-abc", {});
    expect(calls).toEqual(["ok:sess-abc"]);
  });

  it("tool.execute.before can block a call", async () => {
    await manager.load(
      makePlugin("guard", {
        "tool.execute.before": async (input, output) => {
          if (input.tool === "danger") {
            output.block = true;
            output.message = "Not allowed";
          }
        },
      }),
    );

    const output = { block: false, message: "", args: {} };
    await manager.triggerToolBefore(
      { tool: "danger", args: { cmd: "rm -rf" }, sessionId: "s" },
      output,
    );
    expect(output.block).toBe(true);
    expect(output.message).toBe("Not allowed");
  });

  it("tool.execute.after can modify the result", async () => {
    await manager.load(
      makePlugin("modifier", {
        "tool.execute.after": async (_input, output) => {
          output.result = `modified: ${output.result}`;
        },
      }),
    );

    const output = { result: "original" };
    await manager.triggerToolAfter(
      { tool: "read_file", args: {}, result: "original", durationMs: 10, sessionId: "s" },
      output,
    );
    expect(output.result).toBe("modified: original");
  });

  // triggerLlmParams

  it("triggerLlmParams can override model", async () => {
    await manager.load(
      makePlugin("model-picker", {
        "llm.params": async (_input, output) => {
          output.model = "deepseek-v4-pro";
        },
      }),
    );

    const output = {
      model: undefined,
      temperature: undefined,
      maxTokens: undefined,
      system: undefined,
    };
    await manager.triggerLlmParams([{ role: "user", content: "hi" }], "deepseek-v4-flash", output);
    expect(output.model).toBe("deepseek-v4-pro");
  });
});
