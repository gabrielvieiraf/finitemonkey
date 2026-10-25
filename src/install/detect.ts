import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import { isOwnHandler, type Runner } from "./hook-entries.js";
import { asList, asRecord } from "./json-text.js";
import { LOCAL_BIN, LOCK_FILE, SETTINGS_FILE } from "./layout.js";
import type { Project } from "./project.js";

export const PACKAGE_MANAGERS = [
  { name: "pnpm", files: ["pnpm-lock.yaml"] },
  { name: "yarn", files: ["yarn.lock"] },
  { name: "bun", files: ["bun.lock", "bun.lockb"] },
  { name: "npm", files: ["package-lock.json", "npm-shrinkwrap.json"] },
] as const;

export type PackageManager = (typeof PACKAGE_MANAGERS)[number]["name"];

const LANGUAGE_MARKERS = [
  { name: "typescript", files: ["tsconfig.json"] },
  { name: "javascript", files: ["package.json"] },
  { name: "python", files: ["pyproject.toml", "requirements.txt", "setup.py"] },
  { name: "go", files: ["go.mod"] },
  { name: "rust", files: ["Cargo.toml"] },
  { name: "ruby", files: ["Gemfile"] },
  { name: "java", files: ["pom.xml", "build.gradle", "build.gradle.kts"] },
] as const;

const LOOP_PLUGINS = ["oh-my-claudecode", "ralph-loop", "ralph-wiggum", "everything-claude-code", "superclaude"];

const WORKFLOW_DIRS = [
  { dir: ".planning", name: "gsd" },
  { dir: ".bmad-core", name: "bmad" },
  { dir: ".specify", name: "spec-kit" },
  { dir: "openspec", name: "openspec" },
] as const;

export type SettingsScope = "project" | "local" | "user";

export interface Authority {
  readonly kind: "stop-hook" | "loop-plugin" | "workflow" | "finitemonkey-plugin";
  readonly source: SettingsScope | "project-dir";
  readonly name: string;
}

export interface SettingsInfo {
  readonly exists: boolean;
  readonly valid: boolean;
  readonly userHooks: number;
  readonly ownHooks: number;
}

const fromPackageJson = (project: Project): PackageManager | undefined => {
  const text = project.read("package.json");
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  const field = parsed?.ok === true ? parsed.value["packageManager"] : undefined;
  if (typeof field !== "string") return undefined;
  return PACKAGE_MANAGERS.find(({ name }) => field.startsWith(`${name}@`))?.name;
};

export const detectPackageManager = (project: Project): PackageManager | undefined =>
  fromPackageJson(project) ?? PACKAGE_MANAGERS.find(({ files }) => files.some((file) => project.exists(file)))?.name;

export const detectLanguages = (project: Project): readonly string[] =>
  LANGUAGE_MARKERS.filter(({ files }) => files.some((file) => project.exists(file))).map(({ name }) => name);

const handlersOf = (settings: JsonObject, event: string): readonly unknown[] => {
  const hooks = settings["hooks"];
  const groups = isRecord(hooks) ? hooks[event] : undefined;
  return asList(groups).flatMap((group) => asList(asRecord(group)["hooks"]));
};

const allHandlers = (settings: JsonObject): readonly unknown[] => {
  const hooks = settings["hooks"];
  return isRecord(hooks) ? Object.keys(hooks).flatMap((event) => handlersOf(settings, event)) : [];
};

export const settingsInfo = (text: string | undefined): SettingsInfo => {
  if (text === undefined) return { exists: false, valid: true, userHooks: 0, ownHooks: 0 };
  const parsed = text.trim() === "" ? { ok: true as const, value: {} } : parseJsonObject(text);
  if (!parsed.ok) return { exists: true, valid: false, userHooks: 0, ownHooks: 0 };
  const handlers = allHandlers(parsed.value);
  const own = handlers.filter(isOwnHandler).length;
  return { exists: true, valid: true, userHooks: handlers.length - own, ownHooks: own };
};

const pluginAuthorities = (settings: JsonObject, source: SettingsScope): readonly Authority[] => {
  const enabled = settings["enabledPlugins"];
  if (!isRecord(enabled)) return [];
  return Object.entries(enabled)
    .filter(([, on]) => on === true)
    .map(([id]) => id.split("@")[0] ?? id)
    .flatMap((name): Authority[] => {
      if (name === "finitemonkey") return [{ kind: "finitemonkey-plugin", source, name }];
      return LOOP_PLUGINS.includes(name) ? [{ kind: "loop-plugin", source, name }] : [];
    });
};

const scopeAuthorities = (text: string | undefined, source: SettingsScope): readonly Authority[] => {
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  if (parsed?.ok !== true) return [];
  const stops = ["Stop", "SubagentStop"].flatMap((event) =>
    handlersOf(parsed.value, event)
      .filter((handler) => !isOwnHandler(handler))
      .map((handler): Authority => {
        const command = isRecord(handler) ? handler["command"] : undefined;
        return { kind: "stop-hook", source, name: `${event}: ${typeof command === "string" ? command : "?"}` };
      }),
  );
  return [...stops, ...pluginAuthorities(parsed.value, source)];
};

const userSettingsText = (project: Project, env: Env): string | undefined => {
  const home = env["CLAUDE_CONFIG_DIR"] ?? env["HOME"] ?? env["USERPROFILE"];
  if (home === undefined) return undefined;
  const file =
    env["CLAUDE_CONFIG_DIR"] === undefined ? join(home, ".claude", "settings.json") : join(home, "settings.json");
  const text = project.runtime.readText(toAbsolutePath(file));
  return text.ok ? text.value : undefined;
};

export const detectAuthorities = (project: Project, env: Env): readonly Authority[] => [
  ...scopeAuthorities(project.read(SETTINGS_FILE), "project"),
  ...scopeAuthorities(project.read(".claude/settings.local.json"), "local"),
  ...scopeAuthorities(userSettingsText(project, env), "user"),
  ...WORKFLOW_DIRS.filter(({ dir }) => project.isDir(dir)).map(({ name }): Authority => ({
    kind: "workflow",
    source: "project-dir",
    name,
  })),
];

export const chooseRunner = (project: Project, bin: string | undefined, version: string): Runner => {
  if (bin !== undefined) return { kind: "path", path: bin };
  return project.exists(LOCAL_BIN) ? { kind: "local" } : { kind: "npx", version };
};

export const isInstalled = (project: Project): boolean => project.exists(LOCK_FILE);
