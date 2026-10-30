import { listOption, stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { readRecords } from "../knowledge/decision-record.js";
import { featureMode, recordFeatureShadow } from "../policy/feature.js";
import { appendResearch, readResearchLog, RESEARCH_LOG_SCHEMA, type ResearchLog, STANCES } from "../research/log.js";
import { openSides, RESEARCH_SIDES_FEATURE, sidesOf, type UnknownSides } from "../research/sides.js";
import { isPerson } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { guardianWriteProblem, inGuardianRepo } from "./guardian.js";
import type { CommandSpec } from "./types.js";

export interface ResearchLinks {
  readonly sides: readonly UnknownSides[];
  readonly decision: string;
  readonly decisionRecords: readonly string[];
  readonly claims: readonly string[];
}

export const researchLinks = (ctx: Pick<Ctx, "runtime">, paths: FmPaths, log: ResearchLog): ResearchLinks => ({
  sides: sidesOf(log),
  decision: log.question.decision,
  decisionRecords: readRecords(ctx.runtime, paths)
    .filter((record) => record.research.includes(log.slug))
    .map((record) => record.task),
  claims: log.sources.flatMap((source) => (source.claim === undefined ? [] : [source.claim])),
});

export const sidesLines = (ctx: Ctx, log: ResearchLog): readonly string[] =>
  sidesOf(log)
    .filter((sides) => sides.open)
    .map((sides) =>
      ctx.t("research.sides.open", {
        unknown: sides.unknown,
        favors: sides.favors.length,
        contests: sides.contests.length,
        suggested: sides.suggested.length,
      }),
    );

const bad = (ctx: Ctx, usage: string): Promise<CommandResult> =>
  Promise.resolve(failureFrom(ctx.t, usageProblem("invalid_arguments", "research.sides.error.usage", usage)));

const withLog = (
  ctx: Ctx,
  slug: string,
  usage: string,
  run: (paths: FmPaths, log: ResearchLog) => CommandResult,
): Promise<CommandResult> =>
  inGuardianRepo(ctx, (root) => {
    const paths = fmPaths(root);
    const log = readResearchLog(ctx.runtime, paths, slug);
    return log === undefined
      ? failureFrom(ctx.t, usageProblem("invalid_arguments", "research.log.error.missing", usage, { slug }))
      : run(paths, log);
  });

const appended = (ctx: Ctx, paths: FmPaths, slug: string, record: Readonly<Record<string, unknown>>): CommandResult => {
  if (!appendResearch(ctx.runtime, paths, slug, { ...record, at: ctx.runtime.now() }))
    return failureFrom(ctx.t, guardianWriteProblem(`.finitemonkey/research/${slug}.jsonl`));
  const log = readResearchLog(ctx.runtime, paths, slug);
  return success(
    { schema: RESEARCH_LOG_SCHEMA, slug, ...(log === undefined ? {} : researchLinks(ctx, paths, log)) },
    log === undefined ? [] : sidesLines(ctx, log),
  );
};

const EMPTY_USAGE = 'finitemonkey research empty <slug> --unknown "<unknown>" --query "<query>" [--place <where>]';

export const researchEmptyCommand: CommandSpec = {
  path: ["research", "empty"],
  summaryKey: "command.research_empty.summary",
  usage: EMPTY_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: {
    unknown: { type: "string" },
    query: { type: "string", multiple: true },
    place: { type: "string", multiple: true },
  },
  run: (ctx, args) => {
    const slug = args.positionals[0] ?? "";
    const unknown = stringOption(args.values, "unknown");
    const queries = listOption(args.values, "query");
    if (slug === "" || unknown === undefined || queries.length === 0) return bad(ctx, EMPTY_USAGE);
    return withLog(ctx, slug, EMPTY_USAGE, (paths) =>
      appended(ctx, paths, slug, { type: "empty-search", unknown, queries, places: listOption(args.values, "place") }),
    );
  },
};

const STANCE_USAGE = "finitemonkey research stance <slug> <url> --stance favors|contests|unrelated";

export const researchStanceCommand: CommandSpec = {
  path: ["research", "stance"],
  summaryKey: "command.research_stance.summary",
  usage: STANCE_USAGE,
  status: "ready",
  maxPositionals: 2,
  options: { stance: { type: "string" } },
  run: (ctx, args) => {
    const [slug = "", url = ""] = args.positionals;
    const stance = STANCES.find((item) => item === stringOption(args.values, "stance"));
    if (slug === "" || url === "" || stance === undefined) return bad(ctx, STANCE_USAGE);
    if (!isPerson(ctx))
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("needs_confirmation", "research.sides.error.person", STANCE_USAGE)),
      );
    return withLog(ctx, slug, STANCE_USAGE, (paths) => appended(ctx, paths, slug, { type: "stance", url, stance }));
  },
};

export const researchCloseCommand: CommandSpec = {
  path: ["research", "close"],
  summaryKey: "command.research_close.summary",
  usage: "finitemonkey research close <slug>",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const slug = args.positionals[0] ?? "";
    return withLog(ctx, slug, "finitemonkey research close <slug>", (paths, log) => {
      const open = openSides(log);
      const mode = featureMode(ctx.runtime, paths, RESEARCH_SIDES_FEATURE);
      if (open.length > 0 && mode === "active")
        return failureFrom(
          ctx.t,
          usageProblem("research_invalid", "research.sides.error.one_side", "finitemonkey research empty <slug>", {
            unknowns: open.join(", "),
          }),
          sidesLines(ctx, log),
        );
      if (open.length > 0 && mode === "shadow")
        recordFeatureShadow(ctx.runtime, paths, RESEARCH_SIDES_FEATURE, { slug, open: open.join(",") });
      return appended(ctx, paths, slug, { type: "close" });
    });
  },
};

export const RESEARCH_SIDES_COMMANDS = [researchEmptyCommand, researchStanceCommand, researchCloseCommand] as const;
