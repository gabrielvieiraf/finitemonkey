import type { AbsolutePath } from "../core/brand.js";
import { isRecord, type JsonObject, parseJson } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";

export const GH_TIMEOUT_MS = 15_000;
const FAILED_STATES = new Set(["failure", "error"]);
const FAILED_RUNS = new Set(["failure", "cancelled", "timed_out", "startup_failure"]);

export type DeploymentRead =
  | { readonly kind: "none" }
  | { readonly kind: "unreachable"; readonly detail: string }
  | {
      readonly kind: "deployment";
      readonly state: "success" | "failed" | "pending";
      readonly url?: string;
      readonly logUrl?: string;
    };

const ghJson = (runtime: Pick<Runtime, "exec">, cwd: AbsolutePath, args: readonly string[]): unknown => {
  const result = runtime.exec({ command: "gh", args, cwd, timeoutMs: GH_TIMEOUT_MS });
  if (!result.found || result.exitCode !== 0) return undefined;
  const parsed = parseJson(result.stdout);
  return parsed.ok ? parsed.value : undefined;
};

const records = (value: unknown): readonly JsonObject[] =>
  Array.isArray(value) ? value.filter((item): item is JsonObject => isRecord(item)) : [];

const textOf = (record: JsonObject | undefined, key: string): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
};

const stateOf = (raw: string | undefined): "success" | "failed" | "pending" => {
  if (raw === "success") return "success";
  return raw !== undefined && FAILED_STATES.has(raw) ? "failed" : "pending";
};

export const readDeployment = (
  runtime: Pick<Runtime, "exec">,
  cwd: AbsolutePath,
  environment: string,
  sha: string,
): DeploymentRead => {
  const query = `repos/{owner}/{repo}/deployments?environment=${encodeURIComponent(environment)}&sha=${sha}&per_page=1`;
  const deployments = ghJson(runtime, cwd, ["api", query]);
  if (deployments === undefined) return { kind: "unreachable", detail: "gh api deployments" };
  const id = records(deployments)[0]?.["id"];
  if (typeof id !== "number") return { kind: "none" };
  const statuses = records(
    ghJson(runtime, cwd, ["api", `repos/{owner}/{repo}/deployments/${String(id)}/statuses?per_page=1`]),
  );
  const latest = statuses[0];
  const url = textOf(latest, "environment_url");
  const logUrl = textOf(latest, "log_url") ?? textOf(latest, "target_url");
  return {
    kind: "deployment",
    state: stateOf(textOf(latest, "state")),
    ...(url === undefined ? {} : { url }),
    ...(logUrl === undefined ? {} : { logUrl }),
  };
};

export const failedRun = (runtime: Pick<Runtime, "exec">, cwd: AbsolutePath, sha: string): string | undefined => {
  const runs = records(
    ghJson(runtime, cwd, ["run", "list", "--commit", sha, "--json", "conclusion,status,url", "--limit", "10"]),
  );
  return textOf(
    runs.find((run) => FAILED_RUNS.has(textOf(run, "conclusion") ?? "")),
    "url",
  );
};
