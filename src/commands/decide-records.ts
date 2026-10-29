import { usageProblem } from "../core/problem.js";
import { failureFrom, success } from "../core/result.js";
import { appendReason, readReason, readRecords, recordOutcome } from "../knowledge/decision-record.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export const DECISION_RECORDS_SCHEMA = "finitemonkey/decision-records@1";

const WHY_USAGE = 'finitemonkey decide why <task> "<one sentence: why>"';

export const decideRecordsCommand: CommandSpec = {
  path: ["decide", "records"],
  summaryKey: "command.decide_records.summary",
  usage: "finitemonkey decide records [<task>]",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) =>
    inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      const wanted = args.positionals[0];
      const records = readRecords(ctx.runtime, paths).filter(
        (record) => wanted === undefined || record.task === wanted,
      );
      const rows = records.map((record) => ({
        ...record,
        reason: readReason(ctx.runtime, paths, record.task) ?? null,
        outcome: recordOutcome(ctx.runtime, paths, record),
      }));
      return success(
        { schema: DECISION_RECORDS_SCHEMA, records: rows },
        rows.length === 0
          ? [ctx.t("knowledge.records.none")]
          : rows.map((row) =>
              ctx.t("knowledge.records.row", {
                task: row.task,
                changes: row.changes.map((change) => `${change.class} ${change.detail}`).join(", "),
                reason: row.reason ?? ctx.t("knowledge.records.no_reason"),
                reverted: row.outcome.reverted.length,
              }),
            ),
      );
    }),
};

export const decideWhyCommand: CommandSpec = {
  path: ["decide", "why"],
  summaryKey: "command.decide_why.summary",
  usage: WHY_USAGE,
  status: "ready",
  maxPositionals: 2,
  run: (ctx, args) => {
    const task = args.positionals[0]?.trim() ?? "";
    const sentence = args.positionals[1]?.trim() ?? "";
    if (task === "" || sentence === "")
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "knowledge.records.usage", WHY_USAGE)),
      );
    if (!isPerson(ctx))
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "knowledge.records.person", WHY_USAGE)),
      );
    return inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      if (!readRecords(ctx.runtime, paths).some((record) => record.task === task))
        return failureFrom(ctx.t, usageProblem("invalid_arguments", "knowledge.records.unknown", WHY_USAGE, { task }));
      appendReason(ctx.runtime, paths, task, sentence);
      return success({ schema: DECISION_RECORDS_SCHEMA, task, reason: sentence }, [
        ctx.t("knowledge.records.saved", { task }),
      ]);
    });
  },
};
