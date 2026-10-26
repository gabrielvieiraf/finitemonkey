import { relative } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Problem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { readAll } from "../hooks/stdin.js";
import { changedMarkdown, type ProseFileReport, scoreFiles } from "../prose/gate.js";
import { ALLOW_COMMENT } from "../prose/marker.js";
import { scoreProse } from "../prose/score.js";
import { projectRoot } from "../secrets/project.js";
import { type ProseCheckData, proseCheckData, proseCheckHuman } from "./prose-view.js";
import type { CommandSpec } from "./types.js";

const TEXT_FILE = /\.(?:md|markdown|mdx|txt)$/i;
const STDIN_LABEL = "<stdin>";

const problem = (code: Problem["code"], messageKey: Problem["messageKey"], params: Problem["params"]): Problem => ({
  code,
  messageKey,
  params,
  fix: "finitemonkey help prose check",
  exitCode: ExitCode.Usage,
});

const underRoot = (root: AbsolutePath, path: AbsolutePath): string => toPosixPath(relative(root, path));

const expand = (ctx: Ctx, root: AbsolutePath, target: string): Parsed<readonly string[], Problem> => {
  const path = toAbsolutePath(target, ctx.cwd);
  const stat = ctx.runtime.stat(path);
  if (stat === undefined)
    return reject(problem("prose_unreadable", "prose.error.unreadable", { file: target, detail: "not found" }));
  if (stat.kind === "file") return accept([underRoot(root, path)]);
  const walked = ctx.runtime.walkFiles(path);
  if (!walked.ok)
    return reject(problem("prose_unreadable", "prose.error.unreadable", { file: target, detail: walked.error }));
  return accept(
    walked.value
      .map((name) => underRoot(root, toAbsolutePath(toPosixPath(name), path)))
      .filter((name) => TEXT_FILE.test(name) && !/(?:^|\/)(?:node_modules|\.git)\//.test(name))
      .sort(),
  );
};

const targetsOf = (ctx: Ctx, root: AbsolutePath, paths: readonly string[]): Parsed<readonly string[], Problem> => {
  if (paths.length === 0) {
    const changed = changedMarkdown(ctx.runtime, root);
    return changed.ok ? changed : reject(problem("prose_no_input", "prose.error.no_input", {}));
  }
  const files: string[] = [];
  for (const path of paths) {
    const expanded = expand(ctx, root, path);
    if (!expanded.ok) return expanded;
    files.push(...expanded.value);
  }
  return accept([...new Set(files)]);
};

interface Mode {
  readonly stdin: boolean;
  readonly record: boolean;
}

const reportsOf = async (
  ctx: Ctx,
  root: AbsolutePath,
  paths: readonly string[],
  mode: Mode,
): Promise<Parsed<readonly ProseFileReport[], Problem>> => {
  const forced = mode.record ? "record" : undefined;
  if (mode.stdin) {
    const report = scoreProse(await readAll(ctx.io.stdin), { context: forced ?? "docs" });
    return accept([{ file: STDIN_LABEL, report }]);
  }
  const targets = targetsOf(ctx, root, paths);
  if (!targets.ok) return targets;
  const scored = scoreFiles(ctx.runtime, root, targets.value, forced);
  return scored.ok
    ? scored
    : reject(problem("prose_unreadable", "prose.error.unreadable", { file: "", detail: scored.error }));
};

const resultOf = (ctx: Ctx, reports: readonly ProseFileReport[]): CommandResult<ProseCheckData> => {
  const data = proseCheckData(reports);
  const human = proseCheckHuman(ctx.t, reports, data);
  if (data.summary.spans === 0) return success(data, human);
  return failureFrom(
    ctx.t,
    {
      code: "prose_found",
      messageKey: "prose.error.found",
      params: { count: data.summary.spans },
      fix: `rewrite the listed passages; for deliberate brand text, the person adds ${ALLOW_COMMENT}`,
      exitCode: ExitCode.CheckFailed,
      data,
    },
    human,
  );
};

export const proseCheckCommand: CommandSpec = {
  path: ["prose", "check"],
  summaryKey: "prose.command.check",
  usage: "finitemonkey prose check [paths...] [--stdin] [--record] [--json]",
  status: "ready",
  options: { stdin: { type: "boolean" }, record: { type: "boolean" } },
  maxPositionals: 1000,
  run: async (ctx, args): Promise<CommandResult> => {
    const root = projectRoot(ctx);
    const mode = { stdin: args.values["stdin"] === true, record: args.values["record"] === true };
    const reports = await reportsOf(ctx, root, args.positionals, mode);
    if (!reports.ok) return failureFrom(ctx.t, reports.error);
    return resultOf(ctx, reports.value);
  },
};
