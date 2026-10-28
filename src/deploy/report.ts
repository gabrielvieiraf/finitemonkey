import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import { parseContract } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, readState, writeJsonFile } from "../task/state.js";
import type { DeployVerdict } from "./status.js";

export const DEPLOY_STATUS_FILE = "deploy-status.json";
export const DEPLOY_PUSH_FILE = "deploy-push.json";
const SHORT = 8;

export const whatToTest = (runtime: Pick<Runtime, "readText">, paths: FmPaths): string | undefined => {
  const state = readState(runtime, paths);
  const task = state.active ?? state.done.at(-1);
  if (task === undefined) return undefined;
  const text = runtime.readText(paths.task(task));
  const contract = text.ok ? parseContract(task, text.value) : undefined;
  if (contract?.ok !== true) return undefined;
  const manual = contract.value.acceptance.flatMap((check) =>
    check.kind === "manual" && check.description !== undefined ? [check.description] : [],
  );
  return manual.length > 0 ? manual.join("; ") : contract.value.goal;
};

const short = (sha: string | undefined): string => (sha ?? "-").slice(0, SHORT);

export const deployLine = (t: Translate, verdict: DeployVerdict, test: string | undefined): string => {
  const params = {
    expected: short(verdict.expected),
    live: short(verdict.live),
    url: verdict.url ?? "-",
    run: verdict.run ?? "-",
    detail: verdict.detail ?? "-",
  };
  switch (verdict.state) {
    case "live":
      return [t("deploy.line.live", params), ...(test === undefined ? [] : [t("deploy.line.test", { test })])].join(
        " ",
      );
    case "failed":
      return t("deploy.line.failed", params);
    case "not_live":
      return t(verdict.live === undefined ? "deploy.line.waiting" : "deploy.line.behind", params);
    case "unreachable":
      return t("deploy.line.unreachable", params);
  }
};

export const saveReport = (
  runtime: Pick<Runtime, "writeText" | "now">,
  paths: FmPaths,
  verdict: DeployVerdict,
  line: string,
): void => {
  writeJsonFile(runtime, paths.cache(DEPLOY_STATUS_FILE), {
    state: verdict.state,
    expected: verdict.expected,
    line,
    reported: false,
    at: runtime.now(),
  });
};

export const takeReport = (runtime: Pick<Runtime, "readText" | "writeText">, paths: FmPaths): string | undefined => {
  const raw = readJsonFile(runtime, paths.cache(DEPLOY_STATUS_FILE));
  const line = raw?.["line"];
  if (raw?.["reported"] !== false || typeof line !== "string") return undefined;
  writeJsonFile(runtime, paths.cache(DEPLOY_STATUS_FILE), { ...raw, reported: true });
  return line;
};
