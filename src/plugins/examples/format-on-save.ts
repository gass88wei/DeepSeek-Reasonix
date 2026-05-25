/** Example Reasonix plugin — format-on-save. Demonstrates the Plugin API. */

import type { Plugin } from "../types.js";

const FormatOnSavePlugin: Plugin = {
  id: "format-on-save",
  name: "Format on Save",
  version: "0.1.0",
  description: "Auto-format files after edit_file / write_file calls",

  async register(ctx) {
    ctx.log("info", "Format on Save plugin loaded");

    ctx.onDispose(() => {
      ctx.log("info", "Format on Save plugin disposed");
    });

    return {
      // Register a custom tool
      tools: {
        format_file: {
          description: "Format a file using the configured formatter",
          parameters: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Path to the file to format",
              },
              formatter: {
                type: "string",
                description: "Formatter to use (biome, prettier, eslint)",
                enum: ["biome", "prettier", "eslint"],
              },
            },
            required: ["path"],
          },
          readOnly: false,
          parallelSafe: false,
          async execute(args) {
            const { path } = args as { path: string; formatter?: string };
            // In a real plugin this would run the formatter
            return JSON.stringify({
              formatted: true,
              path,
              tool: (args as any).formatter ?? "biome",
            });
          },
        },
      },

      // Hook: auto-format after edit tool runs
      "tool.execute.after": async (input, output) => {
        if (input.tool === "edit_file" || input.tool === "write_file") {
          ctx.log("info", `Formatting after ${input.tool}`, {
            durationMs: input.durationMs,
          });
          // In a real plugin: run the formatter and append result
          output.result = `${output.result}\n\n[format-on-save: pending]`;
        }
      },

      // Hook: block dangerous write patterns
      "tool.execute.before": async (input, output) => {
        if (input.tool === "edit_file") {
          const args = input.args;
          const path = String(args.path ?? args.file ?? "");
          if (path.includes("node_modules") || path.includes(".git/")) {
            output.block = true;
            output.message = `format-on-save blocked edit to protected path: ${path}`;
          }
        }
      },
    };
  },
};

export default FormatOnSavePlugin;
