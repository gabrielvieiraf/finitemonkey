import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt, headSha } from "../gate/git.js";
import type { DeployConfig } from "./config.js";
import { failedRun, readDeployment } from "./github.js";
import { readVersion, sameCommit } from "./version.js";

export type DeployState = "live" | "not_live" | "failed" | "unreachable";

export interface DeployVerdict {
  readonly state: DeployState;
  readonly expected: string;
  readonly live?: string;
  readonly url?: string;
  readonly run?: string;
  readonly detail?: string;
}

export const expectedCommit = (runtime: Runtime, root: AbsolutePath, branch: string): string | undefined => {
  const git = gitAt(runtime, root);
  const remote = git.out(["rev-parse", "--verify", "-q", `origin/${branch}`])?.trim();
  return remote !== undefined && remote !== "" ? remote : headSha(git);
};

const withRun = (runtime: Runtime, root: AbsolutePath, verdict: DeployVerdict): DeployVerdict => {
  const run = failedRun(runtime, root, verdict.expected);
  return run === undefined ? verdict : { ...verdict, state: "failed", run };
};

const byVersion = (
  runtime: Runtime,
  root: AbsolutePath,
  config: DeployConfig,
  url: string,
  expected: string,
): DeployVerdict => {
  const read = readVersion(runtime, root, url, config.field);
  if (read.kind === "unreachable") return { state: "unreachable", expected, url, detail: read.detail };
  const live = read.commit;
  const base = { expected, url, ...(live === undefined ? {} : { live }) };
  if (read.status === config.status && sameCommit(live, expected)) return { ...base, state: "live" };
  return withRun(runtime, root, {
    ...base,
    state: "not_live",
    ...(read.status === config.status ? {} : { detail: `HTTP ${String(read.status)}` }),
  });
};

const byDeployment = (runtime: Runtime, root: AbsolutePath, environment: string, expected: string): DeployVerdict => {
  const read = readDeployment(runtime, root, environment, expected);
  if (read.kind === "unreachable") return { state: "unreachable", expected, detail: read.detail };
  if (read.kind === "none") return { state: "not_live", expected, detail: environment };
  const url = read.url === undefined ? {} : { url: read.url };
  if (read.state === "success") return { state: "live", expected, live: expected, ...url };
  if (read.state === "failed")
    return { state: "failed", expected, ...url, ...(read.logUrl === undefined ? {} : { run: read.logUrl }) };
  return { state: "not_live", expected, ...url };
};

export const checkDeploy = (
  runtime: Runtime,
  root: AbsolutePath,
  config: DeployConfig,
  expected: string,
): DeployVerdict =>
  config.versionUrl !== undefined
    ? byVersion(runtime, root, config, config.versionUrl, expected)
    : byDeployment(runtime, root, config.environment ?? "", expected);

const SETTLED: ReadonlySet<DeployState> = new Set(["live", "failed"]);

const sleep = (runtime: Pick<Runtime, "startTimer">, ms: number): Promise<void> =>
  new Promise((resolve) => {
    runtime.startTimer(ms, resolve);
  });

export const waitForDeploy = async (
  runtime: Runtime,
  root: AbsolutePath,
  config: DeployConfig,
  expected: string,
): Promise<DeployVerdict> => {
  const attempts = Math.max(1, Math.ceil(config.waitS / config.intervalS));
  let verdict = checkDeploy(runtime, root, config, expected);
  for (let attempt = 1; attempt < attempts && !SETTLED.has(verdict.state); attempt += 1) {
    await sleep(runtime, config.intervalS * 1000);
    verdict = checkDeploy(runtime, root, config, expected);
  }
  return verdict;
};
