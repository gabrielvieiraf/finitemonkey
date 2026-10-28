import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import { isRecord, parseJson } from "../../core/parsed.js";
import type { ExecResult, Runtime } from "../../core/runtime.js";

export const PROTECT_RULESET_NAME = "finitemonkey: protected default branch";
export const SETTINGS_CACHE = ".finitemonkey/cache/github-settings.json";
const GH_TIMEOUT_MS = 15_000;

export type Toggle = "enabled" | "disabled" | "unknown";

export interface RulesetState {
  readonly id: number;
  readonly rules: readonly unknown[];
}

export interface GithubSettings {
  readonly repo: string;
  readonly defaultBranch: string;
  readonly visibility: string;
  readonly ruleset: RulesetState | null;
  readonly secretScanning: Toggle;
  readonly pushProtection: Toggle;
  readonly dependabotAlerts: Toggle;
}

export type GhRuntime = Pick<Runtime, "exec">;

export const gh = (runtime: GhRuntime, root: AbsolutePath, args: readonly string[], input?: string): ExecResult =>
  runtime.exec({
    command: "gh",
    args,
    cwd: root,
    timeoutMs: GH_TIMEOUT_MS,
    ...(input === undefined ? {} : { input }),
  });

const json = (result: ExecResult): unknown => {
  if (result.exitCode !== 0) return undefined;
  const parsed = parseJson(result.stdout);
  return parsed.ok ? parsed.value : undefined;
};

const at = (value: unknown, ...path: readonly string[]): unknown =>
  path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);

const toggle = (value: unknown): Toggle => (value === "enabled" || value === "disabled" ? value : "unknown");

const rulesetOf = (runtime: GhRuntime, root: AbsolutePath, repo: string): RulesetState | null => {
  const list = json(gh(runtime, root, ["api", `repos/${repo}/rulesets`]));
  const ours: unknown = Array.isArray(list)
    ? list.find((item: unknown) => at(item, "name") === PROTECT_RULESET_NAME)
    : undefined;
  const id = at(ours, "id");
  if (typeof id !== "number") return null;
  const detail = json(gh(runtime, root, ["api", `repos/${repo}/rulesets/${String(id)}`]));
  const rules = at(detail, "rules");
  return { id, rules: Array.isArray(rules) ? rules : [] };
};

export const readSettings = (runtime: GhRuntime, root: AbsolutePath): GithubSettings | undefined => {
  const view = json(gh(runtime, root, ["repo", "view", "--json", "nameWithOwner,defaultBranchRef,visibility"]));
  const repo = at(view, "nameWithOwner");
  if (typeof repo !== "string") return undefined;
  const branch = at(view, "defaultBranchRef", "name");
  const visibility = at(view, "visibility");
  const details = json(gh(runtime, root, ["api", `repos/${repo}`]));
  const alerts = gh(runtime, root, ["api", `repos/${repo}/vulnerability-alerts`]);
  return {
    repo,
    defaultBranch: typeof branch === "string" ? branch : "main",
    visibility: typeof visibility === "string" ? visibility.toLowerCase() : "unknown",
    ruleset: rulesetOf(runtime, root, repo),
    secretScanning: toggle(at(details, "security_and_analysis", "secret_scanning", "status")),
    pushProtection: toggle(at(details, "security_and_analysis", "secret_scanning_push_protection", "status")),
    dependabotAlerts: alerts.exitCode === 0 ? "enabled" : alerts.found ? "disabled" : "unknown",
  };
};

const cachePath = (root: AbsolutePath): AbsolutePath => toAbsolutePath(join(root, ...SETTINGS_CACHE.split("/")));

export const writeSettingsCache = (
  runtime: Pick<Runtime, "writeText" | "mkdir" | "now">,
  root: AbsolutePath,
  settings: GithubSettings,
): void => {
  runtime.mkdir(toAbsolutePath(join(root, ".finitemonkey", "cache")));
  runtime.writeText(cachePath(root), `${JSON.stringify({ ...settings, at: runtime.now() }, null, 2)}\n`);
};

export const readSettingsCache = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
): GithubSettings | undefined => {
  const text = runtime.readText(cachePath(root));
  const value = text.ok ? parseJson(text.value) : undefined;
  const data = value?.ok === true ? value.value : undefined;
  const repo = at(data, "repo");
  if (typeof repo !== "string") return undefined;
  const field = (key: string): string => {
    const item = at(data, key);
    return typeof item === "string" ? item : "unknown";
  };
  const ruleset = at(data, "ruleset");
  const id = at(ruleset, "id");
  const rules = at(ruleset, "rules");
  return {
    repo,
    defaultBranch: field("defaultBranch"),
    visibility: field("visibility"),
    ruleset: typeof id === "number" ? { id, rules: Array.isArray(rules) ? rules : [] } : null,
    secretScanning: toggle(at(data, "secretScanning")),
    pushProtection: toggle(at(data, "pushProtection")),
    dependabotAlerts: toggle(at(data, "dependabotAlerts")),
  };
};
