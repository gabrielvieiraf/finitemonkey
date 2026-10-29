import { stringOption } from "../core/args.js";
import { usageProblem } from "../core/problem.js";
import { failureFrom, success } from "../core/result.js";
import { assumptionLine } from "../guardian/assumption-hook.js";
import { draftOf, registerAssumptions } from "../guardian/assumption-lines.js";
import { readAssumptions, refreshTriggers, writeAssumptions } from "../guardian/assumptions.js";
import { fmPaths } from "../task/paths.js";
import { guardianWriteProblem, inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const ASSUMPTIONS_SCHEMA = "finitemonkey/assumptions@1";

export const guardianAssumeListCommand: CommandSpec = {
  path: ["guardian", "assume", "list"],
  summaryKey: "command.guardian_assume_list.summary",
  usage: "finitemonkey guardian assume list",
  status: "ready",
  run: (ctx) =>
    inGuardianRepo(ctx, (root) => {
      const list = refreshTriggers(ctx.runtime, fmPaths(root));
      const lines = list.map(
        (item) => `${assumptionLine(item)} [${item.status}, impact ${item.impact}, ${item.source}]`,
      );
      return success(
        { schema: ASSUMPTIONS_SCHEMA, assumptions: list },
        lines.length === 0 ? [ctx.t("guardian.assumptions.empty")] : lines,
      );
    }),
};

const ADD_USAGE =
  'finitemonkey guardian assume add "<text> | impact: high | verify: <how> | trigger: file:<path>" [--source <record or task>]';

export const guardianAssumeAddCommand: CommandSpec = {
  path: ["guardian", "assume", "add"],
  summaryKey: "command.guardian_assume_add.summary",
  usage: ADD_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { source: { type: "string" } },
  run: (ctx, args) => {
    const line = args.positionals[0]?.trim() ?? "";
    if (line === "")
      return Promise.resolve(failureFrom(ctx.t, usageProblem("invalid_arguments", "guardian.error.add", ADD_USAGE)));
    return inGuardianRepo(ctx, (root) => {
      const source = stringOption(args.values, "source") ?? "manual";
      const added = registerAssumptions(ctx.runtime, fmPaths(root), source, [draftOf(line)]);
      return success({ schema: ASSUMPTIONS_SCHEMA, assumptions: added }, added.map(assumptionLine));
    });
  },
};

const VERIFY_USAGE = "finitemonkey guardian assume verify <id> --evidence <file:line or command output> [--false]";

export const guardianAssumeVerifyCommand: CommandSpec = {
  path: ["guardian", "assume", "verify"],
  summaryKey: "command.guardian_assume_verify.summary",
  usage: VERIFY_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { evidence: { type: "string" }, false: { type: "boolean" } },
  run: (ctx, args) => {
    const id = args.positionals[0]?.trim() ?? "";
    const evidence = stringOption(args.values, "evidence")?.trim() ?? "";
    if (id === "" || evidence === "")
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "guardian.error.verify", VERIFY_USAGE)),
      );
    return inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const list = readAssumptions(ctx.runtime, paths);
      if (!list.some((item) => item.id === id))
        return failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "guardian.error.unknown_entry", VERIFY_USAGE, { id }),
        );
      const status = args.values["false"] === true ? ("false" as const) : ("verified" as const);
      const next = list.map((item) =>
        item.id === id ? { ...item, status, verify: `${item.verify} -> ${evidence}`.trim() } : item,
      );
      if (!writeAssumptions(ctx.runtime, paths, next))
        return failureFrom(ctx.t, guardianWriteProblem(".finitemonkey/assumptions.jsonl"));
      return success({ schema: ASSUMPTIONS_SCHEMA, id, status }, [
        ctx.t("guardian.assumptions.marked", { id, status }),
      ]);
    });
  },
};
