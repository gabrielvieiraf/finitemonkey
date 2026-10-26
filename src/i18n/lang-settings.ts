import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { CONFIG_FILE } from "../install/layout.js";
import { findGitRoot } from "../install/project.js";
import type { LangSettings } from "./languages.js";

type Reader = Pick<Runtime, "readText" | "stat" | "homeDir" | "systemLocale">;

const read = (runtime: Reader, path: string): string | undefined => {
  const text = runtime.readText(toAbsolutePath(path));
  return text.ok ? text.value : undefined;
};

const configLang = (text: string | undefined): string | undefined =>
  /^lang:[ \t]*["']?([A-Za-z_-]+)["']?[ \t]*(?:#.*)?$/m.exec(text ?? "")?.[1];

const languageIn = (text: string | undefined): string | undefined => {
  if (text === undefined) return undefined;
  const parsed = parseJsonObject(text);
  const value = parsed.ok && isRecord(parsed.value) ? parsed.value["language"] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
};

const claudeDir = (runtime: Reader, env: Env): string => env["CLAUDE_CONFIG_DIR"] ?? join(runtime.homeDir(), ".claude");

export const langSettings = (runtime: Reader, cwd: AbsolutePath, env: Env, platform: NodeJS.Platform): LangSettings => {
  const root = findGitRoot(cwd, runtime) ?? cwd;
  const claudeFiles = [
    join(root, ".claude", "settings.local.json"),
    join(root, ".claude", "settings.json"),
    join(claudeDir(runtime, env), "settings.json"),
  ];
  return {
    config: configLang(read(runtime, join(root, CONFIG_FILE))),
    claude: claudeFiles.map((path) => languageIn(read(runtime, path))).find((value) => value !== undefined),
    system: platform === "win32" ? runtime.systemLocale() : undefined,
  };
};
