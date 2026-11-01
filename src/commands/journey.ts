import { stringOption } from "../core/args.js";
import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { loadProjectConfig } from "../git/project-config.js";
import { loadLookConfig } from "../look/config.js";
import { approveJourney, type JourneyState, listJourneys, proposeJourney } from "../look/journey.js";
import { commandProposer, proposeFromSentence, proposerCommand } from "../look/journey-propose.js";
import { isPerson } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const JOURNEYS_SCHEMA = "finitemonkey/journeys@1";

const PROPOSE_USAGE = "finitemonkey journey propose <name> (--from <file> | --says <sentence>)";
const APPROVE_USAGE = "finitemonkey journey approve <name> --hash <hash>";

export interface JourneysData {
  readonly schema: typeof JOURNEYS_SCHEMA;
  readonly journeys: readonly Omit<JourneyState, "journey">[];
}

const pathsOf = (ctx: Ctx): FmPaths => fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);

const listed = (ctx: Ctx, paths: FmPaths): CommandResult<JourneysData> => {
  const journeys = listJourneys(ctx.runtime, paths).map(({ name, hash, approved, errors }) => ({
    name,
    hash,
    approved,
    errors,
  }));
  return success(
    { schema: JOURNEYS_SCHEMA, journeys },
    journeys.length === 0
      ? [ctx.t("journey.empty")]
      : journeys.map((item) =>
          ctx.t(item.approved ? "journey.line_approved" : "journey.line_waiting", { name: item.name, hash: item.hash }),
        ),
  );
};

const propose = (ctx: Ctx, name: string, from: string | undefined): CommandResult => {
  const source = from === undefined ? undefined : ctx.runtime.readText(toAbsolutePath(from, ctx.cwd));
  if (source?.ok !== true || name === "")
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", PROPOSE_USAGE, { detail: "<name> --from" }),
    );
  const paths = pathsOf(ctx);
  const made = proposeJourney(ctx.runtime, paths, name, source.value);
  if (!made.ok)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "journey.invalid", PROPOSE_USAGE, {
        errors: made.error.slice(0, 5).join("; "),
      }),
    );
  logEvent(ctx.runtime, paths, "journey.proposed", { name, hash: made.value });
  return {
    ...listed(ctx, paths),
    human: [ctx.t("journey.proposed", { name, hash: made.value })],
    next: `finitemonkey journey approve ${name} --hash ${made.value}`,
  };
};

const fromSentence = async (ctx: Ctx, name: string, says: string): Promise<CommandResult> => {
  const paths = pathsOf(ctx);
  const command = proposerCommand(loadProjectConfig(ctx.runtime, paths.root));
  if (command === undefined)
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "journey.no_proposer", PROPOSE_USAGE));
  const routes = loadLookConfig(ctx.runtime, paths.root)?.routes ?? [];
  const made = await proposeFromSentence(
    ctx.runtime,
    paths,
    name,
    { sentence: says, routes },
    commandProposer(ctx.runtime, paths.root, command),
  );
  if (!made.ok)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "journey.invalid", PROPOSE_USAGE, {
        errors: made.error.slice(0, 5).join("; "),
      }),
    );
  return {
    ...listed(ctx, paths),
    human: [ctx.t("journey.proposed_from_sentence", { name, hash: made.value })],
    next: `finitemonkey journey approve ${name} --hash ${made.value}`,
  };
};

const approve = (ctx: Ctx, name: string, hash: string | undefined): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("journey.person_only", APPROVE_USAGE));
  const paths = pathsOf(ctx);
  const done = approveJourney(ctx.runtime, paths, name, hash);
  if (!done.ok)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", `journey.approve.${done.error}`, APPROVE_USAGE, { name }),
    );
  logEvent(ctx.runtime, paths, "journey.approved", { name, hash: done.value });
  return { ...listed(ctx, paths), human: [ctx.t("journey.approved", { name, hash: done.value })] };
};

export const journeyCommand: CommandSpec = {
  path: ["journey"],
  summaryKey: "command.journey.summary",
  usage: "finitemonkey journey",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(listed(ctx, pathsOf(ctx))),
};

export const journeyProposeCommand: CommandSpec = {
  path: ["journey", "propose"],
  summaryKey: "command.journey_propose.summary",
  usage: PROPOSE_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { from: { type: "string" }, says: { type: "string" } },
  run: (ctx, args) => {
    const name = args.positionals[0] ?? "";
    const says = stringOption(args.values, "says");
    return says !== undefined && says.trim() !== "" && name !== ""
      ? fromSentence(ctx, name, says)
      : Promise.resolve(propose(ctx, name, stringOption(args.values, "from")));
  },
};

export const journeyApproveCommand: CommandSpec = {
  path: ["journey", "approve"],
  summaryKey: "command.journey_approve.summary",
  usage: APPROVE_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { hash: { type: "string" } },
  run: (ctx, args) => Promise.resolve(approve(ctx, args.positionals[0] ?? "", stringOption(args.values, "hash"))),
};
