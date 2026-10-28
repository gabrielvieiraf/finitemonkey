import { suggestionLine } from "../advisor/hook.js";
import { appendSuggestions, latest, readHistory } from "../advisor/store.js";
import type { CommandRun, Suggestion } from "../advisor/types.js";
import type { AbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { isPerson, personName, projectRoot } from "../secrets/project.js";
import { createTask } from "../task/create.js";
import { fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const SUGGESTIONS_SCHEMA = "finitemonkey/suggestions@1";
export const SUGGESTION_SCHEMA = "finitemonkey/suggestion@1";
const BEFORE_TIMEOUT_MS = 600_000;
const ACCEPT_USAGE = "finitemonkey suggest accept <id>";
const DISMISS_USAGE = "finitemonkey suggest dismiss <id>";

const openOnes = (root: AbsolutePath, ctx: Ctx): readonly Suggestion[] =>
  latest(readHistory(ctx.runtime, root)).filter((item) => item.state === "open" || item.state === "accepted");

const findOpen = (ctx: Ctx, id: string, usage: string): Suggestion | CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("suggest.error.person_only", usage));
  const found = latest(readHistory(ctx.runtime, projectRoot(ctx))).find((item) => item.id === id);
  if (found?.state === "open") return found;
  return failureFrom(
    ctx.t,
    usageProblem("invalid_arguments", "suggest.error.not_open", "finitemonkey suggest", { id }),
  );
};

const isResult = (value: Suggestion | CommandResult): value is CommandResult => !("rule" in value);

const runBefore = (ctx: Ctx, root: AbsolutePath, commands: readonly string[]): readonly CommandRun[] =>
  commands.map((command) => {
    const result = ctx.runtime.exec({ command, args: [], cwd: root, timeoutMs: BEFORE_TIMEOUT_MS, shell: true });
    return { command, exitCode: result.found && !result.timedOut ? result.exitCode : null };
  });

const acceptOne = (ctx: Ctx, item: Suggestion): CommandResult => {
  const root = projectRoot(ctx);
  const paths = fmPaths(root);
  const task = `refactor-${item.id.toLowerCase()}`;
  const created = createTask(ctx.runtime, paths, {
    id: task,
    goal: `${item.refactoring}: ${item.name} in ${item.file}`,
    size: "S",
    base: ctx.runtime.git(["rev-parse", "HEAD"], root).stdout.trim() || undefined,
    paths: [item.file],
    runs: [],
    tests: undefined,
    git: [],
    manual: [],
    budget: undefined,
  });
  if (!created.ok) {
    const detail = created.error.kind === "invalid" ? created.error.issues.join("; ") : created.error.kind;
    return failureFrom(ctx.t, usageProblem("task_invalid", "error.task_invalid", ACCEPT_USAGE, { detail }));
  }
  const commands = created.value.contract.acceptance.flatMap((check) =>
    (check.kind === "command" || check.kind === "tests") && check.run !== undefined ? [check.run] : [],
  );
  const before = runBefore(ctx, root, commands);
  const accepted: Suggestion = {
    ...item,
    at: ctx.runtime.now(),
    state: "accepted",
    by: personName(ctx),
    refactorTask: task,
    before,
  };
  appendSuggestions(ctx.runtime, root, [accepted]);
  const green = before.length > 0 && before.every((run) => run.exitCode === 0);
  logEvent(ctx.runtime, paths, "advisor.accepted", { id: item.id, rule: item.rule, task, green });
  return success({ schema: SUGGESTION_SCHEMA, ...accepted }, [
    ctx.t("suggest.accepted", { id: item.id, task }),
    ctx.t(green ? "suggest.green_before" : "suggest.red_before"),
  ]);
};

export const suggestCommand: CommandSpec = {
  path: ["suggest"],
  summaryKey: "command.suggest.summary",
  usage: "finitemonkey suggest",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => {
    const items = openOnes(projectRoot(ctx), ctx);
    const lines = items.length === 0 ? [ctx.t("suggest.empty")] : items.map((item) => suggestionLine(ctx.t, item));
    return Promise.resolve(success({ schema: SUGGESTIONS_SCHEMA, suggestions: items }, lines));
  },
};

export const suggestAcceptCommand: CommandSpec = {
  path: ["suggest", "accept"],
  summaryKey: "command.suggest_accept.summary",
  usage: ACCEPT_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const found = findOpen(ctx, args.positionals[0] ?? "", ACCEPT_USAGE);
    return Promise.resolve(isResult(found) ? found : acceptOne(ctx, found));
  },
};

export const suggestDismissCommand: CommandSpec = {
  path: ["suggest", "dismiss"],
  summaryKey: "command.suggest_dismiss.summary",
  usage: DISMISS_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const found = findOpen(ctx, args.positionals[0] ?? "", DISMISS_USAGE);
    if (isResult(found)) return Promise.resolve(found);
    const root = projectRoot(ctx);
    const dismissed: Suggestion = { ...found, at: ctx.runtime.now(), state: "dismissed", by: personName(ctx) };
    appendSuggestions(ctx.runtime, root, [dismissed]);
    logEvent(ctx.runtime, fmPaths(root), "advisor.dismissed", { id: found.id, rule: found.rule, file: found.file });
    return Promise.resolve(
      success({ schema: SUGGESTION_SCHEMA, ...dismissed }, [
        ctx.t("suggest.dismissed", { id: found.id, rule: found.rule }),
      ]),
    );
  },
};
