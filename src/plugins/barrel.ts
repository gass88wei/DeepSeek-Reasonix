/**
 * Plugins barrel — public API for the Reasonix Plugin System.
 */

export { PluginManager } from "./index.js";
export type { Plugin, PluginHooks, PluginContext, PluginEntry } from "./types.js";
export type {
  ToolBeforeInput,
  ToolBeforeOutput,
  ToolAfterInput,
  ToolAfterOutput,
  LlmParamsOutput,
  PluginToolDefinition,
} from "./types.js";
export {
  loadPluginsFromConfig,
  loadPluginFromFile,
  scanAndLoadPlugins,
  resolvePluginPath,
  parsePluginEntries,
  projectPluginDir,
  globalPluginDir,
} from "./loader.js";
export type { PluginConfigEntry, ScanAndLoadResult } from "./loader.js";
