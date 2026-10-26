import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, optionalString, parseJsonObject } from "../core/parsed.js";
import { isOwnHandler } from "../install/hook-entries.js";
import { asList, asRecord } from "../install/json-text.js";
import { PLUGIN_ID } from "../install/settings-merge.js";
import { readSettings, type SettingsScope } from "./settings.js";
import type { DoctorEnv } from "./types.js";

export type HookSource = "project" | "local" | "plugin";

export interface HookEntry {
  readonly source: HookSource;
  readonly event: string;
  readonly matcher: string | undefined;
  readonly handler: JsonObject;
}

export interface HookFile {
  readonly source: HookSource;
  readonly path: AbsolutePath;
  readonly hooks: unknown;
}

export interface InstalledPlugin {
  readonly root: AbsolutePath;
  readonly version: string | undefined;
  readonly hooksFile: HookFile | undefined;
  readonly hooksText: string | undefined;
}

export const entriesOf = (source: HookSource, hooks: unknown, own: (handler: unknown) => boolean): HookEntry[] =>
  Object.entries(asRecord(hooks)).flatMap(([event, groups]) =>
    asList(groups).flatMap((group) => {
      const record = asRecord(group);
      const matcher = optionalString(record, "matcher");
      return asList(record["hooks"])
        .filter((handler): handler is JsonObject => isRecord(handler) && own(handler))
        .map((handler) => ({ source, event, matcher, handler }));
    }),
  );

const PROJECT_SCOPES: Readonly<Partial<Record<SettingsScope, HookSource>>> = { project: "project", local: "local" };

export const projectHookFiles = (env: DoctorEnv): readonly HookFile[] =>
  readSettings(env).flatMap(({ scope, path, settings }) => {
    const source = PROJECT_SCOPES[scope];
    return source === undefined || !("hooks" in settings) ? [] : [{ source, path, hooks: settings["hooks"] }];
  });

const pluginsDir = ({ env, runtime }: Pick<DoctorEnv, "env" | "runtime">): string =>
  join(env["CLAUDE_CONFIG_DIR"] ?? join(runtime.homeDir(), ".claude"), "plugins");

const installRecord = (value: unknown, root: string): JsonObject | undefined => {
  const records = Array.isArray(value) ? value.filter(isRecord) : isRecord(value) ? [value] : [];
  return records.find((record) => record["projectPath"] === root) ?? records[0];
};

const readJson = (env: DoctorEnv, path: AbsolutePath): JsonObject | undefined => {
  const text = env.runtime.readText(path);
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  return parsed?.ok === true ? parsed.value : undefined;
};

export const installedPlugin = (env: DoctorEnv): InstalledPlugin | undefined => {
  const index = readJson(env, toAbsolutePath(join(pluginsDir(env), "installed_plugins.json")));
  const record = installRecord(asRecord(index?.["plugins"])[PLUGIN_ID], env.root);
  const installPath = record === undefined ? undefined : optionalString(record, "installPath");
  if (record === undefined || installPath === undefined) return undefined;
  const root = toAbsolutePath(installPath);
  const manifest = readJson(env, toAbsolutePath(join(root, ".claude-plugin", "plugin.json")));
  const hooksPath = toAbsolutePath(join(root, "hooks", "hooks.json"));
  const text = env.runtime.readText(hooksPath);
  const parsed = text.ok ? parseJsonObject(text.value) : undefined;
  return {
    root,
    version:
      (manifest === undefined ? undefined : optionalString(manifest, "version")) ?? optionalString(record, "version"),
    hooksFile: parsed?.ok === true ? { source: "plugin", path: hooksPath, hooks: parsed.value["hooks"] } : undefined,
    hooksText: text.ok ? text.value : undefined,
  };
};

const PRECEDENCE: readonly SettingsScope[] = ["managed", "local", "project", "user"];

export const pluginEnabled = (
  env: DoctorEnv,
): { readonly value: boolean; readonly scope: SettingsScope } | undefined => {
  const all = readSettings(env);
  for (const scope of PRECEDENCE) {
    const value = asRecord(all.find((item) => item.scope === scope)?.settings["enabledPlugins"])[PLUGIN_ID];
    if (typeof value === "boolean") return { value, scope };
  }
  return undefined;
};

export const projectEntries = (env: DoctorEnv): readonly HookEntry[] =>
  projectHookFiles(env).flatMap((file) => entriesOf(file.source, file.hooks, isOwnHandler));
