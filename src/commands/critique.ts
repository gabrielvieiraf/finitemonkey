import { stringOption } from "../core/args.js";
import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { parseJsonObject } from "../core/parsed.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { repoFacts } from "../git/repo.js";
import { readAll } from "../hooks/stdin.js";
import { parseCritique } from "../review/findings.js";
import { critiqueLines, readLedger } from "../review/report.js";
import { reproduce, settle } from "../review/reproduce.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const CRITIQUE_SCHEMA = "finitemonkey/critique@1";

const USAGE = "finitemonkey critique verify [--base <ref>] [--file <findings.json>] (or the findings JSON on stdin)";

const findingsText = async (ctx: Ctx, root: AbsolutePath, file: string | undefined): Promise<string | undefined> => {
  if (file === undefined) return ctx.io.stdin.isTTY === true ? undefined : readAll(ctx.io.stdin);
  const text = ctx.runtime.readText(toAbsolutePath(file, root));
  return text.ok ? text.value : undefined;
};

export const critiqueVerifyCommand: CommandSpec = {
  path: ["critique", "verify"],
  summaryKey: "critique.command.verify",
  usage: USAGE,
  status: "ready",
  options: { file: { type: "string" }, base: { type: "string" } },
  run: async (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return failureFrom(ctx.t, notRepository(ctx.cwd));
    const file = stringOption(args.values, "file");
    const raw = await findingsText(ctx, repo.root, file);
    const parsed = raw === undefined ? undefined : parseJsonObject(raw);
    const critique = parsed?.ok === true ? parseCritique(parsed.value) : [`${file ?? "stdin"} is missing or not JSON`];
    if (Array.isArray(critique) || !("verdict" in critique))
      return failureFrom(
        ctx.t,
        usageProblem("invalid_arguments", "critique.error.invalid", USAGE, { detail: critique.join("; ") }),
      );
    const base = stringOption(args.values, "base") ?? repoFacts(ctx.runtime, repo).defaultBranch();
    const head = ctx.runtime.git(["rev-parse", "HEAD"], repo.root).stdout.trim();
    const checked = reproduce(ctx.runtime, repo.root, { base, head }, critique.findings);
    const human = critiqueLines(ctx.t, critique, checked, readLedger(ctx.runtime, repo.root));
    const confirmed = checked.map(settle).filter((item) => item.group === "must").length;
    const data = {
      schema: CRITIQUE_SCHEMA,
      verdict: critique.verdict,
      base,
      head,
      checked: checked.map((item) => ({ ...item, settled: settle(item).group })),
    };
    if (confirmed === 0) return success(data, human);
    return failureFrom(
      ctx.t,
      {
        code: "critique_must_fix",
        messageKey: "critique.error.must_fix",
        params: { count: confirmed },
        fix: "fix the must-fix findings, then run finitemonkey critique verify again",
        exitCode: ExitCode.CheckFailed,
        data,
      },
      human,
    );
  },
};
