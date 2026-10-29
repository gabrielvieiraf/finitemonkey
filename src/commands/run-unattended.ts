import { type GateStatus, type MorningReport, runChain, subcontracts, type UnattendedDeps } from "../autonomy/chain.js";
import { estimateOf, historyRuns, localHorizon, type Plan, planRun } from "../autonomy/plan.js";
import type { AbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import type { Runtime } from "../core/runtime.js";
import { ExitCode } from "../exit-codes.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { configAt, loadProjectConfig } from "../git/project-config.js";
import { knownTasks } from "../guardian/tasks.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { loadPolicy } from "../policy/policy.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { TaskContract } from "../task/types.js";

export const AUTONOMY_FEATURE = "autonomy";
export const UNATTENDED_SCHEMA = "finitemonkey/unattended@1";
export const UNATTENDED_USAGE = "finitemonkey run --unattended <task>";
const GATE_TIMEOUT_MS = 30 * 60_000;

const gateStatus = (stdout: string): GateStatus => {
  const parsed = parseJsonObject(stdout);
  const data = parsed.ok ? parsed.value["data"] : undefined;
  const verdict = isRecord(data) ? data["verdict"] : undefined;
  return verdict === "passed" ? "passed" : verdict === "failed" ? "failed" : "unverified";
};

export const commandDeps = (
  runtime: Runtime,
  root: AbsolutePath,
  agent: string,
  run: () => string,
): UnattendedDeps => ({
  agent: (task, timeoutMs) => {
    const result = runtime.exec({
      command: agent,
      args: [],
      cwd: root,
      shell: true,
      timeoutMs: Math.max(1000, timeoutMs),
      env: { FINITEMONKEY_UNATTENDED: run() },
      input: JSON.stringify({ task: task.id, goal: task.goal, acceptance: task.acceptance.map((check) => check.id) }),
    });
    return result.found && result.exitCode === 0;
  },
  gate: (task) => gateStatus(runtime.execSelf(["gate", "--task", task, "--json"], root, GATE_TIMEOUT_MS).stdout),
});

const minutes = (ms: number): string => (ms / 60_000).toFixed(0);

const planLines = (ctx: Ctx, contract: TaskContract, plan: Plan): readonly string[] => [
  ctx.t("autonomy.plan", {
    task: contract.id,
    estimate: minutes(plan.estimate.ms),
    estimateSource: plan.estimate.source,
    horizon: minutes(plan.horizon.ms),
    horizonSource: plan.horizon.source,
  }),
  ...(plan.kind === "split"
    ? plan.pieces.map((piece, index) =>
        ctx.t("autonomy.piece", { index: index + 1, checks: piece.map((check) => check.id).join(", ") }),
      )
    : []),
];

const reportLines = (ctx: Ctx, report: MorningReport): readonly string[] => [
  ...report.items.map((item) => ctx.t(`autonomy.item.${item.status}`, { task: item.task, why: item.why })),
  ...report.holds.map((hold) => ctx.t("autonomy.report.hold", { reason: hold.reason, command: hold.command })),
  ctx.t("autonomy.report.file", { run: report.run }),
];

export interface UnattendedOptions {
  readonly deps?: (root: AbsolutePath, agent: string) => UnattendedDeps;
}

interface Ready {
  readonly root: AbsolutePath;
  readonly contract: TaskContract;
  readonly plan: Exclude<Plan, { readonly kind: "refuse" }>;
  readonly agent: string;
  readonly data: JsonObject;
}

const execute = (ctx: Ctx, ready: Ready, options: UnattendedOptions): CommandResult => {
  const { root, contract, plan, agent, data } = ready;
  const paths = fmPaths(root);
  const config = loadPolicy(ctx.runtime, root).autonomy;
  const parts = subcontracts(contract, plan.kind === "split" ? plan.pieces : []);
  let run = "";
  const deps = (options.deps ?? ((at, command) => commandDeps(ctx.runtime, at, command, () => run)))(root, agent);
  const report = runChain(ctx.runtime, paths, deps, config, contract, parts, (value) => {
    run = value;
  });
  const lines = [...planLines(ctx, contract, plan), ...reportLines(ctx, report)];
  const result = { ...data, ran: true, report: { ...report } };
  return report.items.every((item) => item.status === "proven")
    ? success(result, lines)
    : failureFrom(
        ctx.t,
        {
          code: "unattended_incomplete",
          messageKey: "autonomy.incomplete",
          params: { run: report.run },
          fix: `read .finitemonkey/reports/unattended-${report.run}.json`,
          exitCode: ExitCode.CheckFailed,
          data: result,
        },
        lines,
      );
};

export const unattended = (ctx: Ctx, id: string | undefined, options: UnattendedOptions = {}): CommandResult => {
  const root = findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd;
  const paths = fmPaths(root);
  const tasks = knownTasks(ctx.runtime, paths);
  const contract = tasks.find((task) => task.contract.id === id)?.contract;
  if (contract === undefined)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", UNATTENDED_USAGE, { detail: id ?? "" }),
    );
  const config = loadPolicy(ctx.runtime, root).autonomy;
  const horizon = localHorizon(historyRuns(ctx.runtime, paths, tasks), config);
  const plan = planRun(contract, horizon, estimateOf(ctx.runtime, paths, tasks, contract));
  const data = { schema: UNATTENDED_SCHEMA, task: contract.id, plan: { ...plan } };
  if (plan.kind === "refuse")
    return failureFrom(
      ctx.t,
      {
        code: "unattended_refused",
        messageKey: "autonomy.refused",
        params: { task: contract.id, needed: plan.needed, checks: contract.acceptance.length },
        fix: "split the contract into smaller tasks or add acceptance checks that can run apart",
        exitCode: ExitCode.CheckFailed,
        data,
      },
      planLines(ctx, contract, plan),
    );
  const mode = featureMode(ctx.runtime, paths, AUTONOMY_FEATURE);
  const agent = configAt(loadProjectConfig(ctx.runtime, root), "autonomy", "agent");
  if (mode !== "active" || typeof agent !== "string" || agent.trim() === "") {
    recordFeatureShadow(ctx.runtime, paths, AUTONOMY_FEATURE, { task: contract.id, plan: plan.kind });
    return success({ ...data, ran: false }, [...planLines(ctx, contract, plan), ctx.t("autonomy.not_run")]);
  }
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("autonomy.error.person_only", UNATTENDED_USAGE));
  return execute(ctx, { root, contract, plan, agent, data }, options);
};
