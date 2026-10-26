import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import { asList, asRecord } from "../install/json-text.js";
import type { DoctorEnv } from "./types.js";

export const SETTINGS_SCOPES = ["managed", "user", "project", "local"] as const;

export type SettingsScope = (typeof SETTINGS_SCOPES)[number];

export interface ScopedSettings {
  readonly scope: SettingsScope;
  readonly path: AbsolutePath;
  readonly settings: JsonObject;
}

const MANAGED: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  darwin: "/Library/Application Support/ClaudeCode/managed-settings.json",
  linux: "/etc/claude-code/managed-settings.json",
  win32: "C:\\Program Files\\ClaudeCode\\managed-settings.json",
};

const userSettingsPath = ({ env, runtime }: Pick<DoctorEnv, "env" | "runtime">): AbsolutePath => {
  const configDir = env["CLAUDE_CONFIG_DIR"];
  return toAbsolutePath(
    configDir === undefined ? join(runtime.homeDir(), ".claude", "settings.json") : join(configDir, "settings.json"),
  );
};

export const settingsPaths = (env: DoctorEnv): readonly { scope: SettingsScope; path: AbsolutePath }[] => {
  const managed = MANAGED[env.platform];
  return [
    ...(managed === undefined ? [] : [{ scope: "managed" as const, path: toAbsolutePath(managed) }]),
    { scope: "user", path: userSettingsPath(env) },
    { scope: "project", path: toAbsolutePath(join(env.root, ".claude", "settings.json")) },
    { scope: "local", path: toAbsolutePath(join(env.root, ".claude", "settings.local.json")) },
  ];
};

export const readSettings = (env: DoctorEnv): readonly ScopedSettings[] =>
  settingsPaths(env).flatMap(({ scope, path }) => {
    const text = env.runtime.readText(path);
    const parsed = text.ok ? parseJsonObject(text.value) : undefined;
    return parsed?.ok === true ? [{ scope, path, settings: parsed.value }] : [];
  });

export const scopesWith = (
  all: readonly ScopedSettings[],
  test: (settings: JsonObject) => boolean,
): readonly SettingsScope[] => all.filter(({ settings }) => test(settings)).map(({ scope }) => scope);

export const isOn =
  (key: string) =>
  (settings: JsonObject): boolean =>
    settings[key] === true;

export const denyRules = (all: readonly ScopedSettings[]): readonly string[] =>
  all.flatMap(({ settings }) =>
    asList(asRecord(settings["permissions"])["deny"]).filter((rule): rule is string => typeof rule === "string"),
  );

export const settingsEnv = (all: readonly ScopedSettings[], name: string): string | undefined =>
  all
    .map(({ settings }) => settings["env"])
    .map((env) => (isRecord(env) ? env[name] : undefined))
    .find((value): value is string => typeof value === "string");

export const enabledPlugins = (all: readonly ScopedSettings[]): readonly string[] =>
  all.flatMap(({ settings }) =>
    Object.entries(asRecord(settings["enabledPlugins"]))
      .filter(([, on]) => on === true)
      .map(([id]) => id),
  );
