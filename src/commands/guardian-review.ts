import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { failureFrom, success } from "../core/result.js";
import { forgetDecision, readDecisions } from "../guardian/decisions.js";
import { GUARDIAN_REVIEW_SCHEMA, guardianReview, type ReviewRow } from "../guardian/review.js";
import type { Translate } from "../i18n/translate.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { guardianWriteProblem, inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

const yes = (t: Translate, value: boolean): string => t(value ? "guardian.review.yes" : "guardian.review.no");

const rowLine = (t: Translate, row: ReviewRow): string =>
  t("guardian.review.row", {
    id: row.id,
    subject: row.subject,
    decision: row.decision,
    criteria: yes(t, row.process.criteriaFirst),
    evidence: row.process.evidence,
    reverted: row.outcome.reverted.length === 0 ? "-" : row.outcome.reverted.join(", "),
    gate: row.outcome.gateFailures,
    reopened: row.outcome.reopenedBy ?? "-",
  });

export const guardianReviewCommand: CommandSpec = {
  path: ["guardian", "review"],
  summaryKey: "command.guardian_review.summary",
  usage: "finitemonkey guardian review",
  status: "ready",
  run: (ctx) =>
    inGuardianRepo(ctx, (root) => {
      const review = guardianReview(ctx.runtime, fmPaths(root));
      if (review.rows.length === 0) return success(review, [ctx.t("guardian.review.empty")]);
      return success(review, [
        ctx.t("guardian.review.head"),
        ...review.rows.map((row) => rowLine(ctx.t, row)),
        ctx.t("guardian.review.tally", {
          followed: review.followed.decisions,
          followedReverted: review.followed.reverted,
          overridden: review.overridden.decisions,
          overriddenReverted: review.overridden.reverted,
        }),
      ]);
    }),
};

const FORGET_USAGE = "finitemonkey guardian forget <id>";

export const guardianForgetCommand: CommandSpec = {
  path: ["guardian", "forget"],
  summaryKey: "command.guardian_forget.summary",
  usage: FORGET_USAGE,
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const id = args.positionals[0]?.trim() ?? "";
    if (id === "")
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "guardian.error.confirm", FORGET_USAGE)),
      );
    if (!isPerson(ctx))
      return Promise.resolve(failureFrom(ctx.t, needsPersonProblem("guardian.error.forget_person", FORGET_USAGE)));
    return inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      if (!readDecisions(ctx.runtime, paths).some((entry) => entry.id === id))
        return failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "guardian.error.unknown_entry", FORGET_USAGE, { id }),
        );
      if (!forgetDecision(ctx.runtime, paths, id))
        return failureFrom(ctx.t, guardianWriteProblem(".finitemonkey/decisions.jsonl"));
      return success({ schema: GUARDIAN_REVIEW_SCHEMA, forgotten: id }, [ctx.t("guardian.forgotten", { id })]);
    });
  },
};
