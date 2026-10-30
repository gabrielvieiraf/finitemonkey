import { stringOption } from "../core/args.js";
import { nowMs } from "../core/clock.js";
import { type Problem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { readLedger } from "../evidence/ledger.js";
import { ExitCode } from "../exit-codes.js";
import { currentInputs, inputsConfig, staleReasons } from "../gate/inputs.js";
import { prepareGate } from "../gate/prepare.js";
import { loadProjectConfig } from "../git/project-config.js";
import type { CommandSpec } from "./types.js";

const USAGE = "finitemonkey evidence why <check> [--task <id>]";

const NO_TASK: Problem = {
  code: "gate_not_run",
  messageKey: "evidence.why.no_task",
  params: {},
  fix: "finitemonkey task new",
  exitCode: ExitCode.NotConfigured,
};

const taskOption = (taskId: string | undefined): { readonly taskId?: string } =>
  taskId === undefined ? {} : { taskId };

export const evidenceWhyCommand: CommandSpec = {
  path: ["evidence", "why"],
  summaryKey: "command.evidence_why.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { task: { type: "string" } },
  run: (ctx, args): Promise<CommandResult> => {
    const check = args.positionals[0]?.trim() ?? "";
    if (check === "")
      return Promise.resolve(failureFrom(ctx.t, usageProblem("invalid_arguments", "evidence.why.usage", USAGE)));
    const ready = prepareGate({
      runtime: ctx.runtime,
      cwd: ctx.cwd,
      env: ctx.env,
      sessionId: undefined,
      budgetMs: 0,
      fast: true,
      noSkip: true,
      ...taskOption(stringOption(args.values, "task")),
    });
    if (ready.kind !== "ready") return Promise.resolve(failureFrom(ctx.t, NO_TASK));
    const gate = ready.prepared.ctx;
    const prior = readLedger(ctx.runtime, gate.paths.evidence(gate.contract.id)).findLast(
      (entry) => entry.check === check,
    );
    if (prior === undefined)
      return Promise.resolve(
        success({ task: gate.contract.id, check, found: false, changed: [] }, [
          ctx.t("evidence.why.none", { check, task: gate.contract.id }),
        ]),
      );
    const config = inputsConfig(loadProjectConfig(ctx.runtime, gate.paths.root));
    const changed = staleReasons(prior, {
      inputs: currentInputs(ctx.runtime, gate.paths.root, ctx.env, config),
      treeHash: gate.treeHash,
      atMs: nowMs(ctx.runtime),
      maxAgeMs: config.maxAgeMs,
    });
    const data = { task: gate.contract.id, check, found: true, at: prior.at, status: prior.status, changed };
    return Promise.resolve(
      success(
        data,
        changed.length === 0
          ? [ctx.t("evidence.why.fresh", { check, at: prior.at, status: prior.status })]
          : [ctx.t("evidence.why.stale", { check, at: prior.at, list: changed.join(", ") })],
      ),
    );
  },
};
