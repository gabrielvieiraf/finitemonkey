import type { AbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, type Problem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import {
  canMove,
  type Incident,
  type IncidentState,
  isRotated,
  listIncidents,
  moveIncident,
  readIncident,
  saveIncident,
} from "../secrets/incidents.js";
import { isPerson, personName, projectRoot } from "../secrets/project.js";
import { writeFailed } from "./secrets-problems.js";
import type { CommandSpec } from "./types.js";

export const INCIDENT_ACTIONS = ["list", "rotated", "close", "purge"] as const;

type IncidentAction = (typeof INCIDENT_ACTIONS)[number];

const USAGE = "finitemonkey secrets incident [list | rotated <id> | close <id> | purge <id>]";

const TARGET: Readonly<Record<"rotated" | "close", IncidentState>> = { rotated: "rotacionado", close: "fechado" };

const PURGE_STEPS = [
  "secrets.purge.step1",
  "secrets.purge.step2",
  "secrets.purge.step3",
  "secrets.purge.step4",
  "secrets.purge.step5",
] as const;

const fail = (ctx: Ctx, problem: Problem): CommandResult => failureFrom(ctx.t, problem);

const notFound = (ctx: Ctx, id: string): CommandResult =>
  fail(
    ctx,
    usageProblem("secrets_incident_not_found", "secrets.error.incident_not_found", `finitemonkey secrets incident`, {
      id,
    }),
  );

const itemLine = (ctx: Ctx, incident: Incident): string =>
  ctx.t("secrets.incident.item", {
    id: incident.id,
    state: incident.state,
    rule: incident.rule,
    where: incident.where,
    created: incident.createdAt.slice(0, 10),
  });

const list = (ctx: Ctx, root: AbsolutePath): CommandResult => {
  const incidents = listIncidents(ctx.runtime, root);
  const human =
    incidents.length === 0
      ? [ctx.t("secrets.incident.none")]
      : [ctx.t("secrets.incident.title", { count: incidents.length }), ...incidents.map((item) => itemLine(ctx, item))];
  return success({ schema: "finitemonkey/secrets-incidents@1", incidents }, human);
};

const notRotated = (ctx: Ctx, incident: Incident): CommandResult =>
  fail(ctx, {
    code: "secrets_not_rotated",
    messageKey: "secrets.error.not_rotated",
    params: { id: incident.id, state: incident.state },
    fix: `finitemonkey secrets incident rotated ${incident.id}`,
    exitCode: ExitCode.NeedsPerson,
  });

const move = (ctx: Ctx, root: AbsolutePath, incident: Incident, action: "rotated" | "close"): CommandResult => {
  const to = TARGET[action];
  if (!isPerson(ctx)) {
    return fail(
      ctx,
      needsPersonProblem("secrets.error.person_only", `finitemonkey secrets incident ${action} ${incident.id}`, {
        action: ctx.t(`secrets.action.${action}`),
      }),
    );
  }
  if (!canMove(incident.state, to))
    return action === "close"
      ? notRotated(ctx, incident)
      : fail(
          ctx,
          usageProblem("invalid_arguments", "secrets.error.bad_transition", USAGE, {
            id: incident.id,
            from: incident.state,
            to,
          }),
        );
  const moved = moveIncident(incident, to, ctx.runtime.now(), personName(ctx));
  const saved = saveIncident(ctx.runtime, root, moved);
  if (!saved.ok) {
    return fail(ctx, writeFailed(incident.id, saved.error));
  }
  return success(moved, [ctx.t("secrets.incident.marked", { id: moved.id, state: moved.state })]);
};

const purge = (ctx: Ctx, incident: Incident): CommandResult => {
  if (!isRotated(incident)) return notRotated(ctx, incident);
  const params = { id: incident.id, where: incident.where, commit: incident.firstCommit ?? "?" };
  const steps = PURGE_STEPS.map((key) => ctx.t(key, params));
  return success({ id: incident.id, state: incident.state, steps }, [ctx.t("secrets.purge.title", params), ...steps]);
};

const actionOf = (raw: string | undefined): IncidentAction | undefined =>
  INCIDENT_ACTIONS.find((action) => action === (raw ?? "list"));

export const secretsIncidentCommand: CommandSpec = {
  path: ["secrets", "incident"],
  summaryKey: "secrets.command.incident",
  usage: USAGE,
  status: "ready",
  maxPositionals: 2,
  run: (ctx, args) => {
    const action = actionOf(args.positionals[0]);
    const root = projectRoot(ctx);
    if (action === undefined)
      return Promise.resolve(
        fail(
          ctx,
          usageProblem("invalid_arguments", "error.invalid_arguments", USAGE, { detail: args.positionals[0] ?? "" }),
        ),
      );
    if (action === "list") return Promise.resolve(list(ctx, root));
    const id = args.positionals[1] ?? "";
    const incident = readIncident(ctx.runtime, root, id);
    if (!incident.ok) return Promise.resolve(notFound(ctx, id));
    return Promise.resolve(action === "purge" ? purge(ctx, incident.value) : move(ctx, root, incident.value, action));
  },
};
