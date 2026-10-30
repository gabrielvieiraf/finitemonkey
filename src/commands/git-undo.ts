import { needsPersonProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import { capBytes, CONFLICT_SUFFIX, MB, readManifest } from "../git/file-store.js";
import { storeName, takeSnapshot } from "../git/snapshot.js";
import { findSnapshot, snapshotViews, undoSnapshot } from "../git/undo.js";
import { isPerson } from "../secrets/project.js";
import { gitProblem, notRepository, repoOf } from "./git-problems.js";
import type { CommandSpec } from "./types.js";

export const SNAPSHOT_SCHEMA = "finitemonkey/git-snapshot@1";
export const UNDO_SCHEMA = "finitemonkey/git-undo@1";

export const snapshotCommand: CommandSpec = {
  path: ["snapshot"],
  summaryKey: "git.command.snapshot",
  usage: "finitemonkey snapshot [--message <text>] [--json]",
  status: "ready",
  options: { message: { type: "string", short: "m" } },
  run: (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const message = args.values["message"];
    const op = typeof message === "string" && message.trim() !== "" ? message.trim() : "manual";
    const taken = takeSnapshot(ctx.runtime, repo, { op });
    if (!taken.ok) {
      return Promise.resolve(
        failureFrom(
          ctx.t,
          gitProblem("git_snapshot_failed", "git.error.snapshot_failed", taken.error, "finitemonkey doctor"),
        ),
      );
    }
    const manifest = readManifest(ctx.runtime, repo, storeName(taken.value.ref));
    const overCap = (manifest?.skipped ?? []).filter((item) => item.reason === "cap").map((item) => item.path);
    const data = {
      schema: SNAPSHOT_SCHEMA,
      ref: taken.value.ref,
      commit: taken.value.commit,
      op,
      files: manifest?.files.length ?? 0,
      skipped: manifest?.skipped ?? [],
    };
    return Promise.resolve(
      success(data, [
        ctx.t("git.snapshot.done", { ref: data.ref, commit: data.commit.slice(0, 12) }),
        ...(overCap.length === 0
          ? []
          : [ctx.t("git.snapshot.skipped", { list: overCap.join(", "), cap: capBytes(ctx.runtime, repo) / MB })]),
      ]),
    );
  },
};

const listResult = (ctx: Parameters<CommandSpec["run"]>[0], views: ReturnType<typeof snapshotViews>): CommandResult =>
  success({ schema: UNDO_SCHEMA, action: "list", snapshots: views }, [
    ctx.t("git.undo.list_title", { count: views.length }),
    ...views.map((view, index) =>
      ctx.t("git.undo.list_item", { index: index + 1, at: view.at, op: view.op, ref: view.ref }),
    ),
  ]);

export const undoCommand: CommandSpec = {
  path: ["undo"],
  summaryKey: "git.command.undo",
  usage: "finitemonkey undo [<snapshot>] [--list] [--in-place --yes] [--json]",
  status: "ready",
  options: { list: { type: "boolean" }, "in-place": { type: "boolean" } },
  maxPositionals: 1,
  run: (ctx, args): Promise<CommandResult> => {
    const repo = repoOf(ctx);
    if (repo === undefined) return Promise.resolve(failureFrom(ctx.t, notRepository(ctx.cwd)));
    const views = snapshotViews(ctx.runtime, repo);
    if (args.values["list"] === true) return Promise.resolve(listResult(ctx, views));
    const wanted = args.positionals[0];
    const view = findSnapshot(views, wanted);
    if (view === undefined) {
      return Promise.resolve(
        failureFrom(ctx.t, {
          code: "git_nothing_to_undo",
          messageKey: "git.error.nothing_to_undo",
          params: { ref: wanted ?? "HEAD" },
          fix: "finitemonkey undo --list",
          exitCode: ExitCode.CheckFailed,
        }),
      );
    }
    const inPlace = args.values["in-place"] === true;
    if (inPlace && !(ctx.yes && isPerson(ctx))) {
      return Promise.resolve(
        failureFrom(ctx.t, needsPersonProblem("git.undo.confirm", `finitemonkey undo ${view.ref} --in-place --yes`)),
      );
    }
    const done = undoSnapshot(ctx.runtime, repo, view, inPlace ? "in-place" : "worktree");
    if (!done.ok) {
      return Promise.resolve(
        failureFrom(ctx.t, gitProblem("git_undo_failed", "git.error.undo_failed", done.error, "finitemonkey rescue")),
      );
    }
    const params = { ref: view.ref, backup: done.value.backup, path: done.value.path ?? "" };
    const lines = [
      ctx.t(inPlace ? "git.undo.in_place" : "git.undo.worktree", params),
      ...(done.value.restored.length === 0 ? [] : [ctx.t("git.undo.restored", { count: done.value.restored.length })]),
      ...(done.value.conflicts.length === 0
        ? []
        : [ctx.t("git.undo.conflicts", { list: done.value.conflicts.join(", "), suffix: CONFLICT_SUFFIX })]),
    ];
    return Promise.resolve(success({ schema: UNDO_SCHEMA, action: "restore", ...done.value }, lines));
  },
};
