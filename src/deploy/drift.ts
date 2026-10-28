import type { AbsolutePath } from "../core/brand.js";
import type { ExecResult, Runtime } from "../core/runtime.js";
import { configAt, type ConfigTree, loadProjectConfig } from "../git/project-config.js";
import { readHosts } from "../infra/file.js";
import { sshRead } from "../infra/ssh.js";
import type { HostEntry } from "../infra/types.js";
import { sameCommit } from "./version.js";

export const DRIFT_FEATURE = "deploy-drift";
export const DEFAULT_CHECK_USER = "deploy-ro";
export const HOST_ENV = "FINITEMONKEY_DEPLOY_HOST";
const DETAIL = 160;
const MAX_FILES = 20;

export interface DriftConfig {
  readonly user: string;
  readonly appDir: string | undefined;
  readonly afterDeploy: boolean;
}

export type HostState = "match" | "diverged" | "unknown" | "unreachable";

export interface HostDrift {
  readonly alias: string;
  readonly state: HostState;
  readonly running: readonly string[];
  readonly head?: string;
  readonly edits: readonly string[];
  readonly detail?: string;
}

const text = (tree: ConfigTree, key: string): string | undefined => {
  const value = configAt(tree, "deploy", key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
};

export const loadDriftConfig = (runtime: Runtime, root: AbsolutePath): DriftConfig => {
  const tree = loadProjectConfig(runtime, root);
  return {
    user: text(tree, "check_user") ?? DEFAULT_CHECK_USER,
    appDir: text(tree, "app_dir"),
    afterDeploy: text(tree, "drift") === "true",
  };
};

export const driftHosts = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  env: Readonly<Partial<Record<string, string>>>,
): readonly HostEntry[] => {
  const fromEnv = env[HOST_ENV]?.trim();
  if (fromEnv !== undefined && fromEnv !== "") return [{ alias: "prod-1", host: fromEnv, file: HOST_ENV, line: 0 }];
  return readHosts(runtime, root);
};

const failed = (result: ExecResult | undefined): string | undefined => {
  if (result === undefined) return "unsafe host or path";
  if (result.found && result.exitCode === 0) return undefined;
  return (result.stderr.trim() || (result.found ? `exit ${String(result.exitCode)}` : "ssh not found")).slice(
    0,
    DETAIL,
  );
};

const lines = (stdout: string): readonly string[] => stdout.split(/\r?\n/).filter((line) => line.trim() !== "");

const runningRevisions = (stdout: string): readonly string[] =>
  lines(stdout).flatMap((line) => {
    const revision = line.trim().split(/\s+/)[2];
    return revision === undefined || revision === "" ? [] : [revision];
  });

const checkoutDrift = (
  runtime: Pick<Runtime, "exec">,
  root: AbsolutePath,
  host: HostEntry,
  config: DriftConfig,
): Pick<HostDrift, "head" | "edits" | "detail"> => {
  if (config.appDir === undefined) return { edits: [] };
  const status = sshRead(runtime, root, host, { kind: "git-status", path: config.appDir }, config.user);
  const head = sshRead(runtime, root, host, { kind: "git-head", path: config.appDir }, config.user);
  const problem = failed(status) ?? failed(head);
  if (problem !== undefined) return { edits: [], detail: problem };
  return {
    head: head?.stdout.trim() ?? "",
    edits: lines(status?.stdout ?? "")
      .map((line) => line.trim())
      .slice(0, MAX_FILES),
  };
};

const verdict = (
  expected: string,
  running: readonly string[],
  checkout: Pick<HostDrift, "head" | "edits">,
): HostState => {
  const images = running.length === 0 ? undefined : running.every((revision) => sameCommit(revision, expected));
  const head = checkout.head === undefined ? undefined : sameCommit(checkout.head, expected);
  if (checkout.edits.length > 0 || images === false || head === false) return "diverged";
  return images === undefined && head === undefined ? "unknown" : "match";
};

export const hostDrift = (
  runtime: Pick<Runtime, "exec">,
  root: AbsolutePath,
  host: HostEntry,
  config: DriftConfig,
  expected: string,
): HostDrift => {
  const revisions = sshRead(runtime, root, host, { kind: "revisions" }, config.user);
  const problem = failed(revisions);
  if (problem !== undefined && config.appDir === undefined)
    return { alias: host.alias, state: "unreachable", running: [], edits: [], detail: problem };
  const running = problem === undefined ? runningRevisions(revisions?.stdout ?? "") : [];
  const checkout = checkoutDrift(runtime, root, host, config);
  if (checkout.detail !== undefined && running.length === 0)
    return { alias: host.alias, state: "unreachable", running, edits: [], detail: checkout.detail };
  return { alias: host.alias, state: verdict(expected, running, checkout), running, ...checkout };
};
