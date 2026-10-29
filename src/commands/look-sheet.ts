import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { ExitCode } from "../exit-codes.js";
import { runSheet } from "../look/node-sheet-run.js";
import { projectRelative } from "../look/paths.js";
import type { DimensionChange, SheetIssue } from "../look/sheet.js";
import { approvedSheetPath, sheetsDir } from "../look/sheet-store.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const LOOK_SHEET_SCHEMA = "finitemonkey/look-sheet-run@1";
const USAGE = "finitemonkey look sheet <route> [--selector <css>] [--approve]";

export interface LookSheetData {
  readonly schema: typeof LOOK_SHEET_SCHEMA;
  readonly route: string;
  readonly html: string;
  readonly json: string;
  readonly variables: number;
  readonly issues: readonly SheetIssue[];
  readonly diff: readonly DimensionChange[] | null;
  readonly approved: boolean;
}

const sheet = async (
  ctx: Ctx,
  route: string | undefined,
  selector: string,
  approve: boolean,
): Promise<CommandResult> => {
  if (!route?.startsWith("/"))
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: route ?? "" }),
    );
  if (approve && !isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("look.approve.person_only", USAGE));
  const run = await runSheet(ctx.runtime, ctx.cwd, route, selector);
  if (run.kind !== "done") {
    const message = ctx.t(`look.error.${run.kind}`, { detail: run.kind === "app_failed" ? run.detail : "" });
    return {
      ok: false,
      exitCode: ExitCode.NotConfigured,
      human: [message],
      error: { code: "look_unavailable", message, fix: "finitemonkey look" },
    };
  }
  const paths = fmPaths(run.root);
  if (approve) {
    ctx.runtime.mkdir(sheetsDir(paths));
    ctx.runtime.writeText(approvedSheetPath(paths, route), `${JSON.stringify(run.sheet, null, 2)}\n`);
    logEvent(ctx.runtime, paths, "look.sheet_approved", { route, tree: run.sheet.tree });
  }
  const data: LookSheetData = {
    schema: LOOK_SHEET_SCHEMA,
    route,
    html: projectRelative(paths, run.html),
    json: projectRelative(paths, run.json),
    variables: run.sheet.variables.length,
    issues: run.sheet.issues,
    diff: run.diff ?? null,
    approved: approve,
  };
  return success(data, [
    data.html,
    ...data.issues.map((item) => `${item.rule} ${item.key}: ${item.detail}`),
    ...(data.diff ?? []).map(
      (change) =>
        `${String(change.width)} ${change.state} ${change.key} ${change.property}: ${String(change.from)} → ${String(change.to)}`,
    ),
    ctx.t("look.sheet.done", { route, variables: data.variables, changes: data.diff?.length ?? 0 }),
  ]);
};

export const lookSheetCommand: CommandSpec = {
  path: ["look", "sheet"],
  summaryKey: "command.look_sheet.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { selector: { type: "string" }, approve: { type: "boolean" } },
  run: (ctx, args) =>
    sheet(ctx, args.positionals[0], stringOption(args.values, "selector") ?? "main", args.values["approve"] === true),
};
