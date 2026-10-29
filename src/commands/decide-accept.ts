import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { toYaml, withStatus } from "../decide/revoke.js";
import { DECISION_SCHEMA } from "../decide/sections.js";
import { appendDecision } from "../guardian/decisions.js";
import { readRecord } from "../guardian/record.js";
import { PLAN_DIR, planPath } from "../plan/folder.js";
import { readFront, writeFront } from "../plan/front.js";
import { isPerson } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import { guardianWriteProblem, inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

const USAGE = "finitemonkey decide accept <record> [--choice <what was chosen>] [--reason <one line>]";

type Root = Parameters<Parameters<typeof inGuardianRepo>[1]>[0];

const accept = (ctx: Ctx, root: Root, name: string, choice?: string, reason?: string): CommandResult => {
  const file = `${PLAN_DIR}/${name}`;
  const text = ctx.runtime.readText(planPath(root, name));
  if (!text.ok)
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "guardian.error.no_record", USAGE, { file }));
  const record = readRecord(text.value);
  if (record.status !== "proposed" && record.status !== "needs-person")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "guardian.error.not_proposed", USAGE, { file, status: record.status }),
    );
  const { data, body } = readFront(text.value);
  const written = ctx.runtime.writeText(
    planPath(root, name),
    writeFront(toYaml({ ...(data ?? {}), status: "accepted" }), withStatus(body, "accepted")),
  );
  if (!written.ok) return failureFrom(ctx.t, guardianWriteProblem(file));
  const overridden = choice !== undefined && choice.trim().toLowerCase() !== record.recommendation.toLowerCase();
  const entry = appendDecision(ctx.runtime, fmPaths(root), {
    source: "decide",
    at: ctx.runtime.now(),
    subject: file,
    recommendation: record.recommendation,
    evidence: record.facts,
    decision: overridden ? "overridden" : "followed",
    paths: record.paths,
    ...(choice === undefined ? {} : { choice }),
    ...(overridden && reason !== undefined && reason.trim() !== "" ? { overrideReason: reason.trim() } : {}),
  });
  if (entry === undefined) return failureFrom(ctx.t, guardianWriteProblem(".finitemonkey/decisions.jsonl"));
  return success({ schema: DECISION_SCHEMA, file, status: "accepted", entry }, [
    ctx.t(overridden ? "guardian.accept.overridden" : "guardian.accept.followed", { file, id: entry.id }),
  ]);
};

export const decideAcceptCommand: CommandSpec = {
  path: ["decide", "accept"],
  summaryKey: "command.decide_accept.summary",
  usage: USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { choice: { type: "string" }, reason: { type: "string" } },
  run: (ctx, args) => {
    const target = args.positionals[0]?.replace(/^.*[\\/]/, "") ?? "";
    if (target === "")
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "guardian.error.no_record", USAGE, { file: "-" })),
      );
    if (!isPerson(ctx))
      return Promise.resolve(failureFrom(ctx.t, needsPersonProblem("guardian.error.accept_person", USAGE)));
    return inGuardianRepo(ctx, (root) =>
      accept(ctx, root, target, stringOption(args.values, "choice"), stringOption(args.values, "reason")),
    );
  },
};
