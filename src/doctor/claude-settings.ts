import { isRecord } from "../core/parsed.js";
import { NEXT_PLUGIN_ID, STABLE_PLUGIN_ID } from "../install/plugin-hooks.js";
import { enabledPlugins, isOn, readSettings, type ScopedSettings, scopesWith, settingsEnv } from "./settings.js";
import { type Check, type CheckFinding, type DoctorEnv, finding } from "./types.js";

export const AGENT_TEAMS_VAR = "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS";
export const LOOP_PLUGINS = ["oh-my-claudecode", "ralph-loop", "ralph-wiggum", "everything-claude-code", "superclaude"];

const DAY_MS = 24 * 60 * 60 * 1000;

const scopeCheck = (
  all: readonly ScopedSettings[],
  key: string,
  build: (scopes: string) => CheckFinding,
): readonly CheckFinding[] => {
  const scopes = scopesWith(all, isOn(key));
  return scopes.length === 0 ? [] : [build(scopes.join(", "))];
};

const hookSwitches = (all: readonly ScopedSettings[]): readonly CheckFinding[] => [
  ...scopeCheck(all, "disableAllHooks", (scopes) =>
    finding(
      "settings.disable_all_hooks",
      "fail",
      "doctor.settings.disable_all_hooks",
      { scopes },
      "doctor.settings.fix_disable_all_hooks",
    ),
  ),
  ...scopeCheck(all, "allowManagedHooksOnly", (scopes) =>
    finding(
      "settings.managed_hooks_only",
      "fail",
      "doctor.settings.managed_hooks_only",
      { scopes },
      "doctor.settings.fix_managed_hooks_only",
    ),
  ),
];

const pluginOnly = (all: readonly ScopedSettings[], pluginEnabled: boolean): readonly CheckFinding[] =>
  pluginEnabled
    ? []
    : scopeCheck(all, "strictPluginOnlyCustomization", (scopes) =>
        finding(
          "settings.plugin_only",
          "fail",
          "doctor.settings.plugin_only",
          { scopes },
          "doctor.settings.fix_plugin_only",
        ),
      );

const isTruthy = (value: string | undefined): boolean => value !== undefined && /^(1|true|yes|on)$/i.test(value);

const agentTeams = (env: DoctorEnv, all: readonly ScopedSettings[]): readonly CheckFinding[] =>
  isTruthy(env.env[AGENT_TEAMS_VAR]) || isTruthy(settingsEnv(all, AGENT_TEAMS_VAR))
    ? [
        finding(
          "settings.agent_teams",
          "warn",
          "doctor.settings.agent_teams",
          { name: AGENT_TEAMS_VAR },
          "doctor.settings.fix_agent_teams",
        ),
      ]
    : [];

const loopPlugins = (plugins: readonly string[]): readonly CheckFinding[] => {
  const names = plugins.map((id) => id.split("@")[0] ?? id).filter((name) => LOOP_PLUGINS.includes(name));
  if (names.length === 0) return [];
  const list = [...new Set(names)].join(", ");
  return [
    finding(
      "settings.loop_plugins",
      "warn",
      "doctor.settings.loop_plugins",
      { names: list },
      "doctor.settings.fix_loop_plugins",
    ),
  ];
};

export const DEFAULT_CLEANUP_DAYS = 30;

const shortestCleanup = (all: readonly ScopedSettings[]): number => {
  const values = all
    .map(({ settings }) => settings["cleanupPeriodDays"])
    .filter((v): v is number => typeof v === "number");
  return values.length === 0 ? DEFAULT_CLEANUP_DAYS : Math.min(...values);
};

export const projectAgeDays = (env: DoctorEnv): number | undefined => {
  const result = env.runtime.git(["log", "--max-parents=0", "--format=%ct", "HEAD"], env.root);
  if (!result.found || !result.ok) return undefined;
  const seconds = result.stdout
    .split(/\s+/)
    .filter((part) => /^\d+$/.test(part))
    .map(Number);
  if (seconds.length === 0) return undefined;
  const now = Date.parse(env.runtime.now());
  return Math.floor((now - Math.min(...seconds) * 1000) / DAY_MS);
};

const cleanupPeriod = (env: DoctorEnv, all: readonly ScopedSettings[]): readonly CheckFinding[] => {
  const days = shortestCleanup(all);
  const age = projectAgeDays(env);
  if (age === undefined || days >= age) return [];
  return [
    finding(
      "settings.cleanup_period",
      "warn",
      "doctor.settings.cleanup_period",
      { days, age },
      "doctor.settings.fix_cleanup_period",
    ),
  ];
};

const PRECEDENCE = ["user", "project", "local", "managed"] as const;

const pluginOn = (all: readonly ScopedSettings[], id: string): boolean => {
  const ordered = PRECEDENCE.flatMap((scope) => all.filter((item) => item.scope === scope));
  const values = ordered
    .map(({ settings }) => settings["enabledPlugins"])
    .map((plugins) => (isRecord(plugins) ? plugins[id] : undefined))
    .filter((value): value is boolean => typeof value === "boolean");
  return values.at(-1) === true;
};

const pluginChannels = (all: readonly ScopedSettings[]): readonly CheckFinding[] =>
  pluginOn(all, STABLE_PLUGIN_ID) && pluginOn(all, NEXT_PLUGIN_ID)
    ? [
        finding(
          "settings.plugin_channels",
          "fail",
          "doctor.settings.plugin_channels",
          { stable: STABLE_PLUGIN_ID, next: NEXT_PLUGIN_ID },
          "doctor.settings.fix_plugin_channels",
        ),
      ]
    : [];

export const checkClaudeSettings: Check = (env) => {
  const all = readSettings(env);
  const plugins = enabledPlugins(all);
  return [
    ...hookSwitches(all),
    ...pluginOnly(
      all,
      plugins.some((id) => id.startsWith("finitemonkey@")),
    ),
    ...pluginChannels(all),
    ...agentTeams(env, all),
    ...loopPlugins(plugins),
    ...cleanupPeriod(env, all),
  ];
};
