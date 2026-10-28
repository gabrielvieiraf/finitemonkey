import { dirname } from "node:path";

import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, type Problem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { ExitCode } from "../exit-codes.js";
import { DEFAULT_GATE_BUDGET_MS } from "../gate/hooks/common.js";
import { prepareGate } from "../gate/prepare.js";
import { type GateContext } from "../gate/types.js";
import {
  type CaseResult,
  evaluateCase,
  expectedPath,
  type GoldenSpec,
  historyPath,
  listCases,
} from "../golden/cases.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { isPerson, personName } from "../secrets/project.js";
import type { CommandSpec } from "./types.js";

export const GOLDEN_ACCEPT_SCHEMA = "finitemonkey/golden-accept@1";
const USAGE = "finitemonkey golden accept <check-id> [--case <name>] [--task <id>]";

interface Accepted {
  readonly case: string;
  readonly before: string | null;
  readonly after: string;
}

const invalid = (detail: string): Problem =>
  usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail });

const notRun = (detail: string): Problem => ({
  code: "gate_not_run",
  messageKey: "error.gate_not_run",
  params: { detail },
  fix: "finitemonkey doctor",
  exitCode: ExitCode.NotConfigured,
});

const specIn = (ctx: GateContext, id: string): GoldenSpec | undefined => {
  const check = ctx.contract.acceptance.find((item) => item.id === id && item.kind === "golden");
  return check?.run === undefined || check.cases === undefined
    ? undefined
    : { id, run: check.run, cases: check.cases, tolerance: check.tolerance ?? 0 };
};

const store = (ctx: Ctx, gate: GateContext, spec: GoldenSpec, result: CaseResult): Accepted | undefined => {
  if (result.kind === "exit") return undefined;
  const path = expectedPath(gate.paths.root, spec.id, result.name);
  const prior = ctx.runtime.readText(path);
  ctx.runtime.mkdir(toAbsolutePath(dirname(path)));
  if (!ctx.runtime.writeText(path, result.stdout).ok) return undefined;
  const accepted: Accepted = {
    case: result.name,
    before: prior.ok ? sha256Hex(prior.value) : null,
    after: sha256Hex(result.stdout),
  };
  const record = { at: ctx.runtime.now(), person: personName(ctx), check: spec.id, ...accepted };
  ctx.runtime.appendText(historyPath(gate.paths.root, spec.id), `${JSON.stringify(record)}\n`);
  logEvent(ctx.runtime, gate.paths, "golden.accepted", { check: spec.id, case: result.name });
  return accepted;
};

const accept = (ctx: Ctx, id: string, only: string | undefined, taskId: string | undefined): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("golden.error.person_only", USAGE));
  if (id === "") return failureFrom(ctx.t, invalid("<check-id>"));
  const ready = prepareGate({
    runtime: ctx.runtime,
    cwd: ctx.cwd,
    env: ctx.env,
    sessionId: undefined,
    budgetMs: DEFAULT_GATE_BUDGET_MS,
    fast: false,
    noSkip: true,
    ...(taskId === undefined ? {} : { taskId }),
  });
  if (ready.kind !== "ready")
    return failureFrom(ctx.t, notRun(ready.kind === "failed" ? ready.failure.kind : ready.reason));
  const gate = ready.prepared.ctx;
  const spec = specIn(gate, id);
  if (spec === undefined) return failureFrom(ctx.t, invalid(id));
  const names = listCases(ctx.runtime, gate.paths.root, spec.cases).filter(
    (name) => only === undefined || name === only,
  );
  if (names.length === 0) return failureFrom(ctx.t, invalid(only ?? spec.cases));
  const results = names.map((name) => evaluateCase(ctx.runtime, gate.paths.root, spec, name, gate.deadline));
  const accepted = results.flatMap((result) => store(ctx, gate, spec, result) ?? []);
  const skipped = results.filter((result) => result.kind === "exit").map((result) => result.name);
  return success({ schema: GOLDEN_ACCEPT_SCHEMA, check: spec.id, accepted, skipped }, [
    ...accepted.map((item) => ctx.t("golden.accepted", { check: spec.id, case: item.case })),
    ...skipped.map((name) => ctx.t("golden.skipped", { check: spec.id, case: name })),
  ]);
};

export const goldenAcceptCommand: CommandSpec = {
  path: ["golden", "accept"],
  summaryKey: "command.golden_accept.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { case: { type: "string" }, task: { type: "string" } },
  run: (ctx, args) =>
    Promise.resolve(
      accept(ctx, args.positionals[0] ?? "", stringOption(args.values, "case"), stringOption(args.values, "task")),
    ),
};
