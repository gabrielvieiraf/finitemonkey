import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { parseJsonObject } from "../core/parsed.js";
import { parseClaudeVersion } from "../install/claude-version.js";
import { INSTALLED_HOOKS } from "../install/hook-entries.js";
import { LOCK_FILE } from "../install/layout.js";
import { invocationOf } from "./hook-fire.js";
import { hookContext, hookFinding } from "./hook-health.js";
import { hookSchemaProblems } from "./hook-schema.js";
import {
  entriesOf,
  type HookEntry,
  type InstalledPlugin,
  installedPlugin,
  pluginEnabled,
  projectEntries,
  projectHookFiles,
} from "./hook-sources.js";
import { settingsPaths } from "./settings.js";
import { PROBE_TIMEOUT_MS } from "./tools.js";
import { type Check, type CheckFinding, type DoctorEnv, finding } from "./types.js";

const SHOWN_PROBLEMS = 3;

const claudeVersion = (env: DoctorEnv): readonly number[] | undefined => {
  const result = env.runtime.probe("claude", ["--version"], PROBE_TIMEOUT_MS.claude);
  return result.ok ? parseClaudeVersion(result.stdout) : undefined;
};

const schemaFinding = (file: string, problems: readonly string[], claude: string): readonly CheckFinding[] =>
  problems.length === 0
    ? []
    : [
        finding(
          "hooks.schema",
          "fail",
          "doctor.hooks.schema",
          { file, claude, problems: problems.slice(0, SHOWN_PROBLEMS).join("; ") },
          "doctor.hooks.fix_schema",
        ),
      ];

const unreadableProjectFiles = (env: DoctorEnv): readonly string[] =>
  settingsPaths(env)
    .filter(({ scope }) => scope === "project" || scope === "local")
    .flatMap(({ path }) => {
      const text = env.runtime.readText(path);
      return text.ok && text.value.trim() !== "" && !parseJsonObject(text.value).ok ? [path] : [];
    });

const schemaFindings = (
  env: DoctorEnv,
  plugin: InstalledPlugin | undefined,
  claude: readonly number[] | undefined,
): readonly CheckFinding[] => {
  const label = claude === undefined ? "?" : claude.join(".");
  const files = [...projectHookFiles(env), ...(plugin?.hooksFile === undefined ? [] : [plugin.hooksFile])];
  const invalidJson = [
    ...unreadableProjectFiles(env),
    ...(plugin?.hooksText !== undefined && plugin.hooksFile === undefined
      ? [toAbsolutePath(join(plugin.root, "hooks", "hooks.json"))]
      : []),
  ];
  return [
    ...invalidJson.flatMap((file) => schemaFinding(file, ["not valid JSON"], label)),
    ...files.flatMap((file) => schemaFinding(file.path, hookSchemaProblems(file.hooks, claude), label)),
  ];
};

const pluginFindings = (env: DoctorEnv, projectOwn: number): readonly CheckFinding[] => {
  const enabled = pluginEnabled(env);
  if (enabled?.value !== false) return [];
  return [
    finding(
      "hooks.plugin",
      projectOwn === 0 ? "fail" : "warn",
      "doctor.hooks.plugin_disabled",
      { scope: enabled.scope },
      "doctor.hooks.fix_plugin_disabled",
    ),
  ];
};

const coverageFindings = (env: DoctorEnv, entries: readonly HookEntry[]): readonly CheckFinding[] => {
  const installed = env.runtime.stat(toAbsolutePath(join(env.root, ...LOCK_FILE.split("/")))) !== undefined;
  if (entries.length === 0 && !installed) {
    return [finding("hooks.registered", "warn", "doctor.hooks.none", {}, "doctor.hooks.fix_none")];
  }
  const registered = new Set(entries.map((entry) => entry.event));
  const absent = INSTALLED_HOOKS.map((spec) => spec.event).filter((event) => !registered.has(event));
  if (absent.length === 0) return [];
  return [
    finding(
      "hooks.registered",
      "fail",
      "doctor.hooks.absent",
      { events: absent.join(", ") },
      "doctor.hooks.fix_absent",
    ),
  ];
};

interface Versions {
  readonly project: string | undefined;
  readonly plugin: string | undefined;
}

const versionFindings = (env: DoctorEnv, versions: Versions): readonly CheckFinding[] => {
  const { project, plugin } = versions;
  if (project !== undefined && plugin !== undefined && project !== plugin) {
    const params = { project, plugin };
    return [finding("hooks.version", "fail", "doctor.hooks.version_plugin", params, "doctor.hooks.fix_version_plugin")];
  }
  const found = project ?? plugin;
  if (found === undefined) return [];
  if (found === env.version) return [finding("hooks.version", "ok", "doctor.hooks.version_ok", { version: found })];
  const fixKey = project === undefined ? "doctor.hooks.fix_version_cli_plugin" : "doctor.hooks.fix_version_cli";
  return [finding("hooks.version", "warn", "doctor.hooks.version_cli", { found, version: env.version }, fixKey)];
};

export const checkHooks: Check = (env) => {
  const claude = claudeVersion(env);
  const plugin = installedPlugin(env);
  const active = plugin !== undefined && pluginEnabled(env)?.value === true;
  const project = projectEntries(env);
  const pluginEntries = active ? entriesOf("plugin", plugin.hooksFile?.hooks, () => true) : [];
  const vars = { CLAUDE_PROJECT_DIR: env.root, ...(plugin === undefined ? {} : { CLAUDE_PLUGIN_ROOT: plugin.root }) };
  const context = hookContext(env, vars);
  const first = project.map((entry) => invocationOf(entry, vars)).find((invocation) => invocation !== undefined);
  const versions = {
    project: first === undefined ? undefined : context.versionOf(first),
    plugin: active ? plugin.version : undefined,
  };
  return [
    ...schemaFindings(env, plugin, claude),
    ...pluginFindings(env, project.length),
    ...coverageFindings(env, [...project, ...pluginEntries]),
    ...versionFindings(env, versions),
    ...[...project, ...pluginEntries].map((entry) => hookFinding(context, entry)),
  ];
};
