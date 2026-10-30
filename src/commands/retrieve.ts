import { stringOption } from "../core/args.js";
import { usageProblem } from "../core/problem.js";
import { failureFrom, success } from "../core/result.js";
import { DEFAULT_STEP_BUDGET, retrieve, RETRIEVE_FEATURE } from "../knowledge/retrieve.js";
import { featureMode } from "../policy/feature.js";
import { fmPaths } from "../task/paths.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const RETRIEVE_SCHEMA = "finitemonkey/retrieve@1";

const USAGE = 'finitemonkey retrieve "<question or symbol>" [--budget <tokens per step>]';

export const retrieveCommand: CommandSpec = {
  path: ["retrieve"],
  summaryKey: "command.retrieve.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { budget: { type: "string" } },
  run: (ctx, args) => {
    const query = args.positionals[0]?.trim() ?? "";
    const raw = Number.parseInt(stringOption(args.values, "budget") ?? "", 10);
    if (query === "")
      return Promise.resolve(failureFrom(ctx.t, usageProblem("invalid_arguments", "knowledge.retrieve.usage", USAGE)));
    return inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      if (featureMode(ctx.runtime, paths, RETRIEVE_FEATURE) === "off")
        return failureFrom(ctx.t, usageProblem("invalid_arguments", "knowledge.retrieve.off", USAGE));
      const budget = Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_STEP_BUDGET;
      const result = retrieve(ctx.runtime, paths, query, { budget });
      return success({ schema: RETRIEVE_SCHEMA, ...result }, [
        result.step === null
          ? ctx.t("knowledge.retrieve.none")
          : ctx.t("knowledge.retrieve.step", {
              step: result.step,
              tokens: result.steps.at(-1)?.tokens ?? 0,
            }),
        ...result.spans.map((span) => `${span.anchor}  ${span.text}`),
      ]);
    });
  },
};
