import { stringOption } from "../core/args.js";
import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, type Problem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { mirror, snapshotOf } from "../dssync/files.js";
import { upsertIssue } from "../dssync/github.js";
import { isReady, prototypeOf, sectionOf } from "../dssync/issue.js";
import { renderSummary } from "../dssync/render.js";
import { dsSummary } from "../dssync/summary.js";
import { DS_SYNC_FEATURE, DS_WORKFLOW, dsWorkflow } from "../dssync/workflow.js";
import { featureMode } from "../policy/feature.js";
import { isPerson, projectRoot } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { GENERATE_OPTIONS, generateResult } from "./generate-run.js";
import type { CommandSpec, OptionValue } from "./types.js";

export const DS_SYNC_SCHEMA = "finitemonkey/ds-sync@1";
const USAGE =
  "finitemonkey ds-sync init --source <owner/repo> [--source-dir <dir>] [--target-dir <dir>] [--prototypes <dir>] [--write] | ds-sync summary --from <dir> --to <dir> | ds-sync apply --from <dir> --to <dir> --summary <file> | ds-sync issue <dir> [--yes]";

type Values = Readonly<Record<string, OptionValue>>;

const invalid = (detail: string): Problem =>
  usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail });

const dirOption = (ctx: Ctx, values: Values, name: string): AbsolutePath | undefined => {
  const raw = stringOption(values, name);
  return raw === undefined ? undefined : toAbsolutePath(raw, ctx.cwd);
};

const init = (ctx: Ctx, root: AbsolutePath, values: Values): CommandResult => {
  const source = stringOption(values, "source");
  if (source === undefined || !/^[\w.-]+\/[\w.-]+$/.test(source))
    return failureFrom(ctx.t, invalid("--source <owner/repo>"));
  const content = dsWorkflow({
    source,
    sourceDir: stringOption(values, "source-dir") ?? "design-system",
    targetDir: stringOption(values, "target-dir") ?? "src/design-system",
    prototypes: stringOption(values, "prototypes") ?? "prototypes",
    version: ctx.version,
  });
  return generateResult({
    ctx,
    root,
    files: [{ path: DS_WORKFLOW, content }],
    values,
    usage: USAGE,
    data: { schema: DS_SYNC_SCHEMA },
    lines: [ctx.t("ds.init.next")],
  });
};

const summary = (ctx: Ctx, values: Values, apply: boolean): CommandResult => {
  const from = dirOption(ctx, values, "from");
  const to = dirOption(ctx, values, "to");
  if (from === undefined || to === undefined) return failureFrom(ctx.t, invalid("--from <dir> --to <dir>"));
  const before = snapshotOf(ctx.runtime, to);
  const after = snapshotOf(ctx.runtime, from);
  const markdown = renderSummary(ctx.t, dsSummary(before, after));
  const out = dirOption(ctx, values, "summary");
  const copied = apply ? mirror(ctx.runtime, from, to) : 0;
  if (out !== undefined) ctx.runtime.writeText(out, `${markdown}\n`);
  return success({ schema: DS_SYNC_SCHEMA, summary: markdown, copied }, [markdown]);
};

const mayPublish = (ctx: Ctx): boolean =>
  isPerson(ctx) ||
  (ctx.env["GITHUB_ACTIONS"] === "true" &&
    ctx.env["CLAUDECODE"] === undefined &&
    ctx.env["CLAUDE_CODE_ENTRYPOINT"] === undefined);

const issues = (ctx: Ctx, root: AbsolutePath, raw: string, yes: boolean): CommandResult => {
  if (raw === "") return failureFrom(ctx.t, invalid("<dir>"));
  const dir = toAbsolutePath(raw, ctx.cwd);
  const ready = [...snapshotOf(ctx.runtime, dir)]
    .filter(([, text]) => isReady(text))
    .map(([path, text]) => prototypeOf(path, text));
  if (!yes)
    return success(
      { schema: DS_SYNC_SCHEMA, ready },
      ready.map((item) => ctx.t("ds.issue.would", { title: item.title })),
    );
  if (!mayPublish(ctx)) return failureFrom(ctx.t, needsPersonProblem("ds.issue.person_only", USAGE));
  const results = ready.map((item) => ({
    title: item.title,
    action: upsertIssue(ctx.runtime, root, item.title, sectionOf(item, item.title, ctx.t("ds.issue.components"))),
  }));
  return success(
    { schema: DS_SYNC_SCHEMA, issues: results },
    results.map((item) => ctx.t(`ds.issue.${item.action}`, { title: item.title })),
  );
};

export const dsSyncCommand: CommandSpec = {
  path: ["ds-sync"],
  summaryKey: "command.ds_sync.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 2,
  options: {
    ...GENERATE_OPTIONS,
    source: { type: "string" },
    "source-dir": { type: "string" },
    "target-dir": { type: "string" },
    prototypes: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    summary: { type: "string" },
    yes: { type: "boolean" },
  },
  run: (ctx, args) => {
    const [action = "", target = ""] = args.positionals;
    const root = projectRoot(ctx);
    if (featureMode(ctx.runtime, fmPaths(root), DS_SYNC_FEATURE) === "off")
      return Promise.resolve(failureFrom(ctx.t, usageProblem("invalid_arguments", "ds.off", USAGE)));
    if (action === "init") return Promise.resolve(init(ctx, root, args.values));
    if (action === "summary") return Promise.resolve(summary(ctx, args.values, false));
    if (action === "apply") return Promise.resolve(summary(ctx, args.values, true));
    if (action === "issue") return Promise.resolve(issues(ctx, root, target, args.values["yes"] === true));
    return Promise.resolve(failureFrom(ctx.t, invalid(action === "" ? "<init|summary|apply|issue>" : action)));
  },
};
