import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { ExitCode } from "../exit-codes.js";
import { runSheet } from "../look/node-sheet-run.js";
import { projectRelative } from "../look/paths.js";
import type { DimensionChange, Sheet, SheetIssue } from "../look/sheet.js";
import { approveSheetInContract, sheetHash } from "../look/sheet-contract.js";
import { approvedSheetPath, sheetsDir } from "../look/sheet-store.js";
import { isPerson } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
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
  readonly contractHash: string | null;
}

const approveSheet = (ctx: Ctx, paths: FmPaths, route: string, made: Sheet): string | undefined => {
  const text = `${JSON.stringify(made, null, 2)}\n`;
  const file = approvedSheetPath(paths, route);
  ctx.runtime.mkdir(sheetsDir(paths));
  ctx.runtime.writeText(file, text);
  const task = readState(ctx.runtime, paths).active;
  const ref = {
    route,
    selector: made.selector,
    file: projectRelative(paths, file),
    hash: sheetHash(text),
    variables: made.variables.length,
  };
  const bound = task === undefined ? undefined : approveSheetInContract(ctx.runtime, paths, task, ref);
  const contractHash = bound?.ok === true ? bound.value.contractHash : undefined;
  logEvent(ctx.runtime, paths, "look.sheet_approved", {
    route,
    tree: made.tree,
    hash: ref.hash,
    ...(task === undefined ? {} : { task }),
    ...(contractHash === undefined ? {} : { contractHash }),
  });
  return contractHash;
};

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
  const contract = approve ? approveSheet(ctx, paths, route, run.sheet) : undefined;
  const data: LookSheetData = {
    schema: LOOK_SHEET_SCHEMA,
    route,
    html: projectRelative(paths, run.html),
    json: projectRelative(paths, run.json),
    variables: run.sheet.variables.length,
    issues: run.sheet.issues,
    diff: run.diff ?? null,
    approved: approve,
    contractHash: contract ?? null,
  };
  return success(data, [
    data.html,
    ...data.issues.map((item) => `${item.rule} ${item.key}: ${item.detail}`),
    ...(data.diff ?? []).map(
      (change) =>
        `${String(change.width)} ${change.state} ${change.key} ${change.property}: ${String(change.from)} → ${String(change.to)}`,
    ),
    ...(contract === undefined ? [] : [ctx.t("look.sheet.contract", { hash: contract })]),
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
