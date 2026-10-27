import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { type Problem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { configAt, loadProjectConfig } from "../git/project-config.js";
import { adoptWorktrees } from "../wt/adopt.js";
import { type NewFailure, newWorktree } from "../wt/create.js";
import type { WorktreeOwner } from "../wt/entry.js";
import { activityOf, gitWorktrees } from "../wt/git-list.js";
import { portBaseOf } from "../wt/ports.js";
import { notRepository } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const WT_SCHEMA = "finitemonkey/wt@1";

export const commandOwner = (ctx: Pick<Ctx, "env">): WorktreeOwner => {
  const agent = ctx.env["CLAUDECODE"] === "1" || ctx.env["CLAUDE_CODE_ENTRYPOINT"] !== undefined;
  return { kind: agent ? "session" : "human", agentId: null, sessionId: null };
};

const newProblem = (failure: NewFailure, cwd: string): Problem => {
  switch (failure.kind) {
    case "not-repo":
      return notRepository(cwd);
    case "bad-id":
      return usageProblem("invalid_arguments", "wt.error.bad_id", "finitemonkey wt new <id> --purpose <text>", {
        id: failure.id,
      });
    case "taken":
      return usageProblem("wt_taken", "wt.error.taken", "finitemonkey wt list", { id: failure.id });
    case "place":
      return usageProblem("wt_bad_place", "wt.error.bad_place", "finitemonkey wt new <id> --purpose <text>", {
        path: failure.path,
        problems: failure.problems.join(", "),
      });
    case "no-ports":
      return {
        ...usageProblem("wt_failed", "wt.error.no_ports", "finitemonkey wt list"),
        exitCode: ExitCode.CheckFailed,
      };
    case "git":
      return {
        ...usageProblem("wt_failed", "wt.error.git", "finitemonkey wt doctor", { detail: failure.detail }),
        exitCode: ExitCode.CheckFailed,
      };
  }
};

const portBase = (ctx: Ctx): number => {
  const node = configAt(loadProjectConfig(ctx.runtime, ctx.cwd), "ports", "base");
  return portBaseOf(typeof node === "string" ? node : undefined);
};

export const wtNewCommand: CommandSpec = {
  path: ["wt", "new"],
  summaryKey: "wt.command.new",
  usage: "finitemonkey wt new <id> --purpose <text> [--base <ref>] [--branch <name>] [--task <contract>] [--json]",
  status: "ready",
  options: {
    purpose: { type: "string" },
    base: { type: "string" },
    branch: { type: "string" },
    path: { type: "string" },
    task: { type: "string" },
    parent: { type: "string" },
  },
  maxPositionals: 1,
  run: (ctx, args): Promise<CommandResult> => {
    const id = args.positionals[0] ?? "";
    const purpose = stringOption(args.values, "purpose") ?? "";
    if (id === "" || purpose.trim() === "") {
      return Promise.resolve(
        failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "wt.error.needs_purpose", "finitemonkey wt new <id> --purpose <text>"),
        ),
      );
    }
    const made = newWorktree(ctx.runtime, ctx.cwd, ctx.env, {
      id,
      purpose: purpose.trim(),
      base: stringOption(args.values, "base"),
      branch: stringOption(args.values, "branch"),
      path: stringOption(args.values, "path"),
      task: stringOption(args.values, "task"),
      parent: stringOption(args.values, "parent"),
      portBase: portBase(ctx),
      owner: commandOwner(ctx),
    });
    if (!made.ok) return Promise.resolve(failureFrom(ctx.t, newProblem(made.error, ctx.cwd)));
    const entry = made.value;
    const port = String(entry.ports?.from ?? "");
    return Promise.resolve(
      success({ schema: WT_SCHEMA, action: "new", worktree: entry }, [
        ctx.t("wt.new.done", { id: entry.id, path: entry.path, branch: entry.branch ?? "" }),
        ctx.t("wt.new.ports", { port }),
      ]),
    );
  },
};

export const wtAdoptCommand: CommandSpec = {
  path: ["wt", "adopt"],
  summaryKey: "wt.command.adopt",
  usage: "finitemonkey wt adopt [--json]",
  status: "ready",
  run: (ctx): Promise<CommandResult> => {
    const trees = gitWorktrees(ctx.runtime, ctx.cwd);
    if (trees === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const adopted = adoptWorktrees(ctx.runtime, ctx.cwd, commandOwner(ctx));
    const fresh = new Set(adopted.ok ? adopted.value.map((entry) => entry.path) : []);
    const rows = trees.map((tree) => ({
      path: tree.path,
      branch: tree.branch,
      main: tree.main,
      locked: tree.locked !== null,
      prunable: tree.prunable,
      activityAt: activityOf(ctx.runtime, tree) ?? null,
      adopted: fresh.has(tree.path),
    }));
    const human = [
      ctx.t("wt.adopt.title", { count: rows.length, adopted: fresh.size }),
      ...rows.map((row) =>
        ctx.t("wt.adopt.row", {
          path: row.path,
          branch: row.branch ?? "-",
          activity: row.activityAt ?? "-",
          state: row.main ? "main" : row.adopted ? "adopted" : "registered",
        }),
      ),
      ...(adopted.ok ? [] : [ctx.t("wt.adopt.registry_failed", { detail: adopted.error })]),
    ];
    return Promise.resolve(success({ schema: WT_SCHEMA, action: "adopt", worktrees: rows }, human));
  },
};
