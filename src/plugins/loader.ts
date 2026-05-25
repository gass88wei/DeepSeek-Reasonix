/**
 * Plugin loader — finds and loads plugin modules from:
 *   1. Built-in plugins bundled with the release
 *   2. .reasonix/plugins/<name>/index.js  (project-scoped)
 *   3. ~/.reasonix/plugins/<name>/index.js (user-global)
 *
 * Each plugin module must export a default `Plugin` object (see types.ts)
 * with at minimum `id` and `register(ctx)`.
 *
 * The loader is a directory scan + dynamic import — no npm resolution in v1.
 */

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import type { Plugin } from "./types.js";

// ---------------------------------------------------------------------------
// Plugin directories
// ---------------------------------------------------------------------------

/** Project-scoped plugin directory (<project>/.reasonix/plugins/). */
export function projectPluginDir(projectRoot?: string): string {
  return join(projectRoot ?? process.cwd(), ".reasonix", "plugins");
}

/** User-global plugin directory (~/.reasonix/plugins/). */
export function globalPluginDir(): string {
  return join(homedir(), ".reasonix", "plugins");
}

/** Built-in plugin directory (resolved relative to the Reasonix dist). */
function builtinPluginDir(): string | null {
  // In the bundled dist, built-in plugins ship alongside the CLI.
  // Check relative to the current module location.
  try {
    // __dirname equivalent in ESM
    const currentDir = new URL(".", import.meta.url).pathname;
    const candidate = resolve(currentDir, "..", "plugins", "builtin");
    if (existsSync(candidate)) return candidate;
  } catch {
    // Silently fall back.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

export interface PluginConfigEntry {
  /** Plugin identifier — either a name (file plugin) or npm package spec. */
  spec: string;
  /** Optional config options passed to the plugin. */
  options?: Record<string, unknown>;
}

/**
 * Parse the `plugins.entries` section from the config.
 * Supports two shapes:
 *   string[]          → ["my-plugin", "@scope/pkg"]
 *   [string, object][] → [["my-plugin", { apiKey: "..." }], ["@scope/pkg", {}]]
 */
export function parsePluginEntries(raw: unknown): PluginConfigEntry[] {
  if (!Array.isArray(raw)) return [];

  const entries: PluginConfigEntry[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      entries.push({ spec: item.trim() });
    } else if (
      Array.isArray(item) &&
      item.length >= 1 &&
      typeof item[0] === "string"
    ) {
      entries.push({
        spec: item[0].trim(),
        options:
          typeof item[1] === "object" && item[1] !== null
            ? (item[1] as Record<string, unknown>)
            : undefined,
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/**
 * Resolve a plugin spec to a file path.
 *   - Relative/absolute paths → directly resolved
 *   - Bare names → scanned from .reasonix/plugins/<name>/
 *   - Scoped names (@scope/pkg) → npm resolution (v1: not implemented)
 */
export function resolvePluginPath(
  spec: string,
  projectRoot?: string,
): string | null {
  // Already a path-like spec
  if (
    spec.startsWith("/") ||
    spec.startsWith("./") ||
    spec.startsWith("../")
  ) {
    const candidate = resolve(process.cwd(), spec);
    return existsSync(candidate) ? candidate : null;
  }

  // Scoped npm package — not resolved in v1
  if (spec.startsWith("@")) {
    return null;
  }

  // Bare name — scan directories
  const dirs = [projectPluginDir(projectRoot), globalPluginDir()];

  for (const dir of dirs) {
    const candidate = join(dir, spec, "index.js");
    if (existsSync(candidate)) return candidate;
    // Also try .mjs
    const candidateMjs = join(dir, spec, "index.mjs");
    if (existsSync(candidateMjs)) return candidateMjs;
    // Try as a single JS file
    const candidateFile = join(dir, `${spec}.js`);
    if (existsSync(candidateFile)) return candidateFile;
  }

  return null;
}

/**
 * Scan a plugin directory and return every discoverable plugin path.
 */
export function scanPluginDir(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          // Directory plugin: <name>/index.js
          const indexFile = join(full, "index.js");
          if (existsSync(indexFile)) results.push(indexFile);
          const indexMjs = join(full, "index.mjs");
          if (existsSync(indexMjs)) results.push(indexMjs);
        } else if (
          stat.isFile() &&
          (entry.endsWith(".js") || entry.endsWith(".mjs"))
        ) {
          results.push(full);
        }
      } catch {
        // permission errors on individual entries are non-fatal
      }
    }
  } catch {
    // directory read failure is non-fatal
  }
  return results;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Load a plugin from a file path via dynamic import.
 * Expects the module to export a default `Plugin` object.
 */
export async function loadPluginFromFile(
  filePath: string,
  _options?: Record<string, unknown>,
): Promise<Plugin> {
  // Convert to file:// URL for cross-platform compatibility
  const url = pathToFileURL(filePath).href;
  const mod: Record<string, unknown> = await import(url);
  const plugin = (mod.default ?? mod.plugin ?? mod) as Partial<Plugin>;
  if (typeof plugin.register !== "function") {
    throw new Error(
      `Plugin at ${filePath} must export a default Plugin object with a register(ctx) function`,
    );
  }
  if (!plugin.id) {
    // Derive id from filename
    plugin.id =
      filePath.split(/[/\\]/).pop()?.replace(/\.(js|mjs)$/, "") ?? "unknown";
  }
  return plugin as Plugin;
}

/**
 * Load all plugins from the config's `plugins.entries` array.
 * Returns arrays of (successfully loaded plugins, failed entries with errors).
 */
export async function loadPluginsFromConfig(
  entries: PluginConfigEntry[],
  projectRoot?: string,
): Promise<{
  loaded: Plugin[];
  failed: Array<{ spec: string; error: string }>;
}> {
  const loaded: Plugin[] = [];
  const failed: Array<{ spec: string; error: string }> = [];

  for (const entry of entries) {
    try {
      const filePath = resolvePluginPath(entry.spec, projectRoot);
      if (!filePath) {
        failed.push({
          spec: entry.spec,
          error: entry.spec.startsWith("@")
            ? "npm-scoped plugins are not supported in v1 (use a local file instead)"
            : `plugin "${entry.spec}" not found in .reasonix/plugins/ or ~/.reasonix/plugins/`,
        });
        continue;
      }
      const plugin = await loadPluginFromFile(filePath, entry.options);
      loaded.push(plugin);
    } catch (err) {
      failed.push({ spec: entry.spec, error: String(err) });
    }
  }

  return { loaded, failed };
}

// ---------------------------------------------------------------------------
// Scan + load everything (discovery-based, no config needed)
// ---------------------------------------------------------------------------

export interface ScanAndLoadResult {
  loaded: Plugin[];
  failed: Array<{ spec: string; error: string }>;
  scannedPaths: string[];
}

/**
 * Scan all plugin directories and load every plugin found.
 * Useful for "just pick up everything in .reasonix/plugins/".
 */
export async function scanAndLoadPlugins(
  projectRoot?: string,
): Promise<ScanAndLoadResult> {
  const dirs = [
    ...(builtinPluginDir() ? [builtinPluginDir()!] : []),
    projectPluginDir(projectRoot),
    globalPluginDir(),
  ];

  const scannedPaths: string[] = [];
  const loaded: Plugin[] = [];
  const failed: Array<{ spec: string; error: string }> = [];

  for (const dir of dirs) {
    const files = scanPluginDir(dir);
    for (const filePath of files) {
      scannedPaths.push(filePath);
      try {
        const plugin = await loadPluginFromFile(filePath);
        loaded.push(plugin);
      } catch (err) {
        failed.push({ spec: filePath, error: String(err) });
      }
    }
  }

  return { loaded, failed, scannedPaths };
}
