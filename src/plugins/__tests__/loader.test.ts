/**
 * Plugin loader tests
 */

import { sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  globalPluginDir,
  parsePluginEntries,
  projectPluginDir,
  resolvePluginPath,
} from "../loader.js";

describe("parsePluginEntries", () => {
  it("parses string[] entries", () => {
    const result = parsePluginEntries(["my-plugin", "@scope/pkg"]);
    expect(result).toEqual([{ spec: "my-plugin" }, { spec: "@scope/pkg" }]);
  });

  it("parses [string, object][] entries", () => {
    const result = parsePluginEntries([["my-plugin", { apiKey: "123" }], ["other-plugin"]]);
    expect(result).toHaveLength(2);
    expect(result[0]?.spec).toBe("my-plugin");
    expect(result[0]?.options).toEqual({ apiKey: "123" });
    expect(result[1]?.spec).toBe("other-plugin");
    expect(result[1]?.options).toBeUndefined();
  });

  it("handles mixed arrays", () => {
    const result = parsePluginEntries(["bare", ["paired", { opt: true }]]);
    expect(result).toHaveLength(2);
    expect(result[0]?.spec).toBe("bare");
    expect(result[1]?.spec).toBe("paired");
  });

  it("returns [] for non-array input", () => {
    expect(parsePluginEntries(null)).toEqual([]);
    expect(parsePluginEntries(undefined)).toEqual([]);
    expect(parsePluginEntries({})).toEqual([]);
    expect(parsePluginEntries("string")).toEqual([]);
  });

  it("trims whitespace from specs", () => {
    const result = parsePluginEntries(["  my-plugin  "]);
    expect(result[0]?.spec).toBe("my-plugin");
  });

  it("skips invalid array entries", () => {
    const result = parsePluginEntries([42, null, ["ok", {}]] as any);
    expect(result).toHaveLength(1);
    expect(result[0]?.spec).toBe("ok");
  });
});

describe("pluginDir helpers", () => {
  it("projectPluginDir returns .reasonix/plugins under the project root", () => {
    const dir = projectPluginDir("/some/project");
    // On POSIX: /some/project/.reasonix/plugins
    // On Windows: \some\project\.reasonix\plugins
    expect(dir).toContain(".reasonix");
    expect(dir).toContain("plugins");
  });

  it("projectPluginDir defaults to cwd", () => {
    const dir = projectPluginDir();
    expect(dir).toContain(".reasonix/plugins".replace("/", sep));
  });

  it("globalPluginDir returns ~/.reasonix/plugins", () => {
    const dir = globalPluginDir();
    expect(dir).toContain(".reasonix/plugins".replace("/", sep));
  });
});

describe("resolvePluginPath", () => {
  it("returns null for scoped npm packages (not supported in v1)", () => {
    const result = resolvePluginPath("@scope/my-plugin");
    expect(result).toBeNull();
  });

  it("returns null for unknown bare names", () => {
    // No .reasonix/plugins/ dir exists in the test environment
    const result = resolvePluginPath("non-existent-plugin");
    expect(result).toBeNull();
  });
});
