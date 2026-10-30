import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import { usageProblem } from "../core/problem.js";
import { failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { checkBlock, provenanceSources, renderBlock } from "../pr/provenance.js";
import { changedSince } from "../pr/scope.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const PROVENANCE_SCHEMA = "finitemonkey/pr-provenance@1";
const USAGE = "finitemonkey pr provenance [--base <ref>] [--check <body-file>] [--json]";

export const prProvenanceCommand: CommandSpec = {
  path: ["pr", "provenance"],
  summaryKey: "command.pr_provenance.summary",
  usage: USAGE,
  status: "ready",
  options: { base: { type: "string" }, check: { type: "string" } },
  run: (ctx, args) =>
    inGuardianRepo(ctx, (root) => {
      const base = stringOption(args.values, "base") ?? "origin/main";
      const files = changedSince(ctx.runtime, root, base).map((file) => file.path);
      const block = renderBlock(provenanceSources(ctx.runtime, root, files));
      const file = stringOption(args.values, "check");
      if (file === undefined) return success({ schema: PROVENANCE_SCHEMA, block, result: null }, [block]);
      const body = ctx.runtime.readText(toAbsolutePath(file, root));
      if (!body.ok)
        return failureFrom(ctx.t, usageProblem("invalid_arguments", "pr.provenance.unreadable", USAGE, { file }));
      const result = checkBlock(body.value, block);
      if (result === "match")
        return success({ schema: PROVENANCE_SCHEMA, block, result }, [ctx.t("pr.provenance.match")]);
      return failureFrom(ctx.t, {
        code: "pr_failed",
        messageKey: `pr.provenance.${result}`,
        params: {},
        fix: "finitemonkey pr provenance",
        exitCode: ExitCode.CheckFailed,
      });
    }),
};
