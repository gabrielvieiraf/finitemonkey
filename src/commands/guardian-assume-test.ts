import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { readAssumptions } from "../guardian/assumptions.js";
import { proposalLines, proposalsFor } from "../guardian/negative-contract.js";
import type { NegativeTest } from "../guardian/negative-test.js";
import { isPerson } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { guardianWriteProblem, inGuardianRepo } from "./guardian.js";
import {
  ASSUMPTIONS_SCHEMA,
  guardianAssumeAddCommand,
  guardianAssumeListCommand,
  guardianAssumeVerifyCommand,
} from "./guardian-assume.js";
import type { CommandSpec } from "./types.js";

const USAGE = "finitemonkey guardian assume test <id> [--write]";

const written = (ctx: Ctx, paths: FmPaths, proposal: NegativeTest): CommandResult => {
  if (proposal.file === null)
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "guardian.assumptions.no_file", USAGE));
  const target = toAbsolutePath(proposal.file, paths.root);
  if (ctx.runtime.stat(target) !== undefined)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "guardian.assumptions.exists", USAGE, { file: proposal.file }),
    );
  const folder = toAbsolutePath(proposal.file.split("/").slice(0, -1).join("/") || ".", paths.root);
  if (!ctx.runtime.mkdir(folder).ok || !ctx.runtime.writeText(target, proposal.skeleton).ok)
    return failureFrom(ctx.t, guardianWriteProblem(proposal.file));
  logEvent(ctx.runtime, paths, "guardian.negative_test.accepted", { assumption: proposal.assumption });
  return success({ schema: ASSUMPTIONS_SCHEMA, proposal, written: true }, [
    ctx.t("guardian.assumptions.written", { file: proposal.file, criterion: proposal.criterion }),
  ]);
};

export const guardianAssumeTestCommand: CommandSpec = {
  path: ["guardian", "assume", "test"],
  summaryKey: "command.guardian_assume_test.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { write: { type: "boolean" } },
  run: (ctx, args) => {
    const id = args.positionals[0]?.trim() ?? "";
    if (id === "")
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "guardian.assumptions.test_usage", USAGE)),
      );
    return inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const item = readAssumptions(ctx.runtime, paths).find((entry) => entry.id === id);
      const proposal = item === undefined ? undefined : proposalsFor(ctx.runtime, paths, [item])[0];
      if (proposal === undefined)
        return failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "guardian.assumptions.not_behavior", USAGE, { id }),
        );
      if (args.values["write"] !== true)
        return success({ schema: ASSUMPTIONS_SCHEMA, proposal, written: false }, [
          ...proposalLines(ctx.t, proposal),
          proposal.skeleton,
        ]);
      if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("guardian.assumptions.person_only", USAGE));
      return written(ctx, paths, proposal);
    });
  },
};

export const ASSUME_COMMANDS: readonly CommandSpec[] = [
  guardianAssumeListCommand,
  guardianAssumeAddCommand,
  guardianAssumeVerifyCommand,
  guardianAssumeTestCommand,
];
