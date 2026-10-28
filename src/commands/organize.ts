import { join, posix } from "node:path";

import { importEdges } from "../arch/imports.js";
import { workingTree } from "../arch/scan.js";
import { stringOption } from "../core/args.js";
import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { toPosixPath } from "../core/posix-path.js";
import { type Problem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { gitAt } from "../gate/git.js";
import { applyFiles, planFiles } from "../generate/plan.js";
import { configList, loadProjectConfig } from "../git/project-config.js";
import { MAX_TARGETS, planMarkdown, planPath, responsibilities, stepsIn } from "../organize/plan.js";
import { DEFAULT_SENSITIVE } from "../organize/rank.js";
import { hotspots } from "../organize/scan.js";
import { openTargets, saveStep, stepContract, stepId, writeTargets } from "../organize/step.js";
import { projectRoot } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { planLines } from "./arch.js";
import type { CommandSpec } from "./types.js";

export const ORGANIZE_SCHEMA = "finitemonkey/organize@1";
const USAGE =
  "finitemonkey organize [--top <n>] | organize plan <file> | organize step <file> <n> | organize done <file>";
const DEFAULT_TOP = 10;

const invalid = (detail: string): Problem =>
  usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail });

const relativeFile = (ctx: Ctx, root: AbsolutePath, raw: string): string =>
  toPosixPath(posix.normalize(toPosixPath(toAbsolutePath(raw, ctx.cwd)).slice(toPosixPath(root).length + 1)));

const rank = (ctx: Ctx, top: number): CommandResult => {
  const root = projectRoot(ctx);
  const sensitive = [
    ...DEFAULT_SENSITIVE,
    ...configList(loadProjectConfig(ctx.runtime, root), "organize", "sensitive"),
  ];
  const ranked = hotspots(ctx.runtime, gitAt(ctx.runtime, root), fmPaths(root), sensitive);
  if (ranked === undefined) return failureFrom(ctx.t, invalid("git history"));
  const shown = ranked.slice(0, top);
  return success(
    { schema: ORGANIZE_SCHEMA, hotspots: shown },
    shown.map((item, index) =>
      ctx.t("organize.row", {
        rank: index + 1,
        path: item.path,
        score: item.score,
        churn: item.churn,
        complexity: item.complexity,
        lines: item.lines,
        importers: item.importers,
        fixes: item.fixes,
        tested: item.hasTest ? "yes" : "no",
      }),
    ),
  );
};

const plan = (ctx: Ctx, raw: string): CommandResult => {
  const root = projectRoot(ctx);
  const file = relativeFile(ctx, root, raw);
  const text = ctx.runtime.readText(toAbsolutePath(join(root, file)));
  if (!text.ok || raw === "") return failureFrom(ctx.t, invalid(raw === "" ? "<file>" : raw));
  const paths = fmPaths(root);
  const open = openTargets(ctx.runtime, paths);
  if (!open.includes(file) && open.length >= MAX_TARGETS)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "organize.error.round_full", USAGE, { open: open.join(", ") }),
    );
  const tree = workingTree(ctx.runtime, gitAt(ctx.runtime, root), root, []);
  const importerDirs = [
    ...new Set(
      importEdges(tree)
        .filter((edge) => edge.to === file)
        .map((edge) => posix.dirname(edge.from)),
    ),
  ].sort();
  const parts = responsibilities(file, text.value);
  const files = [{ path: planPath(file), content: planMarkdown({ file, text: text.value, importerDirs }, parts) }];
  const planned = planFiles(ctx.runtime, root, files);
  const applied = applyFiles(ctx.runtime, root, files, false);
  if (!open.includes(file)) writeTargets(ctx.runtime, paths, [...open, file]);
  return success(
    { schema: ORGANIZE_SCHEMA, file, plan: planPath(file), responsibilities: parts, files: planned, ...applied },
    [...planLines(ctx, planned), ctx.t("organize.planned", { file, plan: planPath(file), count: parts.length })],
  );
};

const step = (ctx: Ctx, raw: string, number: string): CommandResult => {
  const root = projectRoot(ctx);
  const file = relativeFile(ctx, root, raw);
  const markdown = ctx.runtime.readText(toAbsolutePath(join(root, planPath(file))));
  const index = Number.parseInt(number, 10);
  const goal = markdown.ok ? stepsIn(markdown.value)[index - 1] : undefined;
  if (goal === undefined) return failureFrom(ctx.t, invalid(`${raw} ${number}`));
  const id = stepId(file, index);
  if (!saveStep(ctx.runtime, fmPaths(root), stepContract(ctx.runtime, root, id, goal)))
    return failureFrom(ctx.t, usageProblem("task_exists", "error.task_exists", USAGE, { task: id }));
  return success({ schema: ORGANIZE_SCHEMA, task: id, goal }, [ctx.t("organize.step", { id, goal })]);
};

const done = (ctx: Ctx, raw: string): CommandResult => {
  const root = projectRoot(ctx);
  const file = relativeFile(ctx, root, raw);
  const paths = fmPaths(root);
  writeTargets(
    ctx.runtime,
    paths,
    openTargets(ctx.runtime, paths).filter((item) => item !== file),
  );
  return success({ schema: ORGANIZE_SCHEMA, closed: file }, [ctx.t("organize.done", { file })]);
};

export const organizeCommand: CommandSpec = {
  path: ["organize"],
  summaryKey: "command.organize.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 3,
  options: { top: { type: "string" } },
  run: (ctx, args) => {
    const [action = "", first = "", second = ""] = args.positionals;
    if (action === "plan") return Promise.resolve(plan(ctx, first));
    if (action === "step") return Promise.resolve(step(ctx, first, second));
    if (action === "done") return Promise.resolve(done(ctx, first));
    if (action !== "") return Promise.resolve(failureFrom(ctx.t, invalid(action)));
    const top = Number.parseInt(stringOption(args.values, "top") ?? "", 10);
    return Promise.resolve(rank(ctx, Number.isInteger(top) && top > 0 ? top : DEFAULT_TOP));
  },
};
