import { join } from "node:path";

import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import {
  approvedOnly,
  decideExamples,
  type Example,
  type ExampleDraft,
  MAX_EXAMPLES,
  proposeExample,
  readExamples,
} from "../task/examples.js";
import { contractHash, loadTask } from "../task/load.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { readState } from "../task/state.js";
import { TASK_SCHEMA } from "../task/types.js";
import { notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec, OptionValues } from "./types.js";

const USAGE =
  "finitemonkey task examples [<id>] [--says <sentence> --run <cmd> --expect <output> [--input <stdin>]] [--approve E1,E2] [--reject E3]";

const ids = (values: OptionValues, name: string): readonly string[] => {
  const value = values[name];
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter((item) => item !== "");
};

const line = (ctx: Ctx, example: Example): string =>
  ctx.t("examples.line", { id: example.id, status: ctx.t(`examples.status.${example.status}`), says: example.says });

const listed = (ctx: Ctx, task: string, examples: readonly Example[]): CommandResult =>
  success({ schema: TASK_SCHEMA, task, examples, approved: approvedOnly(examples).length }, [
    examples.length === 0 ? ctx.t("examples.empty", { task }) : ctx.t("examples.header", { task }),
    ...examples.map((example) => line(ctx, example)),
  ]);

const draftOf = (values: OptionValues): ExampleDraft | undefined => {
  const says = stringOption(values, "says")?.trim();
  const run = stringOption(values, "run")?.trim();
  const expect = stringOption(values, "expect");
  const input = stringOption(values, "input");
  if (says === undefined || says === "" || run === undefined || run === "" || expect === undefined) return undefined;
  return { says, run, expect, ...(input === undefined ? {} : { input }) };
};

const propose = (ctx: Ctx, paths: FmPaths, task: string, draft: ExampleDraft): CommandResult => {
  const made = proposeExample(ctx.runtime, paths, task, draft);
  if (!made.ok)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", `examples.${made.error}`, USAGE, { task, max: MAX_EXAMPLES }),
    );
  return {
    ...success({ schema: TASK_SCHEMA, task, example: made.value }, [
      ctx.t("examples.proposed", { id: made.value.id, task, says: made.value.says }),
    ]),
    next: `finitemonkey task examples ${task} --approve ${made.value.id}`,
  };
};

const decide = (ctx: Ctx, paths: FmPaths, task: string, values: OptionValues): CommandResult => {
  const disk = (relative: string): string | undefined => {
    const text = ctx.runtime.readText(toAbsolutePath(join(paths.root, relative)));
    return text.ok ? text.value : undefined;
  };
  const loaded = loadTask(ctx.runtime, paths, { disk, base: () => undefined }, task);
  if (!loaded.ok || !loaded.value.trusted)
    return failureFrom(ctx.t, needsPersonProblem("examples.untrusted", `fm: trust ${task}`, { task }));
  const decision = { approve: ids(values, "approve"), reject: ids(values, "reject") };
  const done = decideExamples(ctx.runtime, paths, loaded.value.contract, decision, contractHash);
  if (!done.ok) {
    const detail = done.error.kind === "unknown" ? done.error.ids.join(", ") : done.error.kind;
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "examples.decide_failed", USAGE, { task, detail }));
  }
  return {
    ...listed(ctx, task, done.value),
    human: [
      ctx.t("examples.decided", { task, approved: approvedOnly(done.value).length }),
      ...done.value.map((example) => line(ctx, example)),
    ],
  };
};

export const taskExamplesCommand: CommandSpec = {
  path: ["task", "examples"],
  summaryKey: "command.task_examples.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: {
    says: { type: "string" },
    run: { type: "string" },
    expect: { type: "string" },
    input: { type: "string" },
    approve: { type: "string", multiple: true },
    reject: { type: "string", multiple: true },
  },
  run: (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const paths = fmPaths(repo.root);
    const task = args.positionals[0] ?? readState(ctx.runtime, paths).active;
    if (task === undefined)
      return Promise.resolve(failureFrom(ctx.t, usageProblem("invalid_arguments", "examples.no_task", USAGE)));
    if (ids(args.values, "approve").length + ids(args.values, "reject").length > 0)
      return Promise.resolve(decide(ctx, paths, task, args.values));
    const draft = draftOf(args.values);
    if (draft !== undefined) return Promise.resolve(propose(ctx, paths, task, draft));
    return Promise.resolve(listed(ctx, task, readExamples(ctx.runtime, paths, task)));
  },
};
