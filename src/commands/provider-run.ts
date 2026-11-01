import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { writeBlindWithProvider } from "../gate/checks/blind.js";
import { prepareGate } from "../gate/prepare.js";
import { PROVIDER_SCHEMA } from "../provider/store.js";
import { blindWriterOf, providerDeps } from "../provider/wire.js";
import { providerDisableCommand, providerEnableCommand, providerListCommand } from "./provider.js";
import type { CommandSpec } from "./types.js";

const USAGE = "finitemonkey provider run blind-writer [--task <id>]";
const BUDGET_MS = 30 * 60_000;

const runBlind = (ctx: Ctx, taskId: string | undefined): CommandResult => {
  const ready = prepareGate({
    runtime: ctx.runtime,
    cwd: ctx.cwd,
    env: ctx.env,
    sessionId: undefined,
    budgetMs: BUDGET_MS,
    fast: true,
    noSkip: true,
    ...(taskId === undefined ? {} : { taskId }),
  });
  if (ready.kind !== "ready")
    return success({ schema: PROVIDER_SCHEMA, kind: "blind-writer", outcome: "skipped" }, [
      ctx.t("provider.run.skipped", { kind: "blind-writer" }),
    ]);
  const gate = ready.prepared.ctx;
  const deps = { ...providerDeps(ctx, gate.paths), task: gate.contract.id };
  const outcome = writeBlindWithProvider(gate, blindWriterOf(deps));
  return success({ schema: PROVIDER_SCHEMA, kind: "blind-writer", task: gate.contract.id, outcome }, [
    ctx.t(`provider.run.${outcome}`, { kind: "blind-writer", task: gate.contract.id }),
  ]);
};

export const providerRunCommand: CommandSpec = {
  path: ["provider", "run"],
  summaryKey: "command.provider_run.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { task: { type: "string" } },
  run: (ctx, args) => {
    if (args.positionals[0] !== "blind-writer")
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "provider.error.kind", USAGE, {
            kind: args.positionals[0] ?? "",
            kinds: "blind-writer",
          }),
        ),
      );
    return Promise.resolve(runBlind(ctx, stringOption(args.values, "task")));
  },
};

export const PROVIDER_COMMANDS = [
  providerEnableCommand,
  providerDisableCommand,
  providerListCommand,
  providerRunCommand,
] as const satisfies readonly CommandSpec[];
