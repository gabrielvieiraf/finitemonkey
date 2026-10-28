import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { matchesAny } from "../core/glob.js";
import type { Runtime } from "../core/runtime.js";
import { CONFIG_FILE, configAt, configList, parseConfigYaml } from "../git/project-config.js";

export interface SlopConfig {
  readonly allow: readonly string[];
  readonly names: ReadonlySet<string>;
  readonly reason: RegExp;
}

export const DEFAULT_ALLOW: readonly string[] = [
  "**/migrations/**",
  "**/migration/**",
  "**/api/v*/**",
  "**/node_modules/**",
  "**/vendor/**",
  "**/dist/**",
  "**/fixtures/**",
  "CHANGELOG*",
];

export const DEFAULT_REASON = /\breason:\s*\S/i;

export const DEFAULT_SLOP_CONFIG: SlopConfig = { allow: DEFAULT_ALLOW, names: new Set(), reason: DEFAULT_REASON };

const reasonOf = (raw: unknown): RegExp => {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_REASON;
  try {
    return new RegExp(raw, "i");
  } catch {
    return DEFAULT_REASON;
  }
};

export const parseSlopConfig = (text: string): SlopConfig => {
  const tree = parseConfigYaml(text);
  return {
    allow: [...DEFAULT_ALLOW, ...configList(tree, "slop", "allow")],
    names: new Set(configList(tree, "slop", "names")),
    reason: reasonOf(configAt(tree, "slop", "reason")),
  };
};

export const loadSlopConfig = (runtime: Pick<Runtime, "readText">, root: AbsolutePath): SlopConfig => {
  const text = runtime.readText(toAbsolutePath(join(root, CONFIG_FILE)));
  return text.ok ? parseSlopConfig(text.value) : DEFAULT_SLOP_CONFIG;
};

export const isAllowed = (config: SlopConfig, file: string): boolean =>
  file.startsWith(".finitemonkey/") || matchesAny(file, config.allow);
