import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, type ConfigTree, parseConfigYaml } from "../git/project-config.js";
import { CONFIG_FILE } from "../install/layout.js";
import { findGitRoot } from "../install/project.js";
import type { LangSettings } from "./languages.js";

type Reader = Pick<Runtime, "readText" | "stat" | "homeDir" | "systemLocale">;

const read = (runtime: Reader, path: string): string | undefined => {
  const text = runtime.readText(toAbsolutePath(path));
  return text.ok ? text.value : undefined;
};

const configText = (tree: ConfigTree, ...path: readonly string[]): string | undefined => {
  const value = configAt(tree, ...path);
  return typeof value === "string" && value !== "" ? value : undefined;
};

const languageIn = (text: string | undefined): string | undefined => {
  if (text === undefined) return undefined;
  const parsed = parseJsonObject(text);
  const value = parsed.ok && isRecord(parsed.value) ? parsed.value["language"] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
};

const claudeDir = (runtime: Reader, env: Env): string => env["CLAUDE_CONFIG_DIR"] ?? join(runtime.homeDir(), ".claude");

export const langSettings = (runtime: Reader, cwd: AbsolutePath, env: Env, platform: NodeJS.Platform): LangSettings => {
  const root = findGitRoot(cwd, runtime) ?? cwd;
  const config = parseConfigYaml(read(runtime, join(root, CONFIG_FILE)) ?? "");
  const claudeFiles = [
    join(root, ".claude", "settings.local.json"),
    join(root, ".claude", "settings.json"),
    join(claudeDir(runtime, env), "settings.json"),
  ];
  return {
    config: configText(config, "lang"),
    reviewedOnly: configText(config, "i18n", "fallback") === "reviewed-only",
    claude: claudeFiles.map((path) => languageIn(read(runtime, path))).find((value) => value !== undefined),
    system: platform === "win32" ? runtime.systemLocale() : undefined,
  };
};
