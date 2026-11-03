import { recordResearchConcepts } from "../conceitos/research.js";
import { listOption, stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { PLAN_DIR, planPath, slugOf } from "../plan/folder.js";
import { providerStance, whenEnabled } from "../provider/adapters.js";
import { providerDeps } from "../provider/wire.js";
import {
  appendResearch,
  CHANGES,
  readResearchLog,
  RESEARCH_LOG_SCHEMA,
  type ResearchLog,
  researchState,
  RISKS,
  STANCES,
} from "../research/log.js";
import { suggestStance } from "../research/sides.js";
import { isPerson } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { guardianWriteProblem, inGuardianRepo } from "./guardian.js";
import { researchLinks, sidesLines } from "./research-sides.js";
import type { CommandSpec } from "./types.js";

type Root = Parameters<Parameters<typeof inGuardianRepo>[1]>[0];

const baseName = (file: string): string => file.replace(/^.*[\\/]/, "");

const stateLines = (ctx: Ctx, log: ResearchLog): readonly string[] => {
  const state = researchState(log);
  return [
    ctx.t("research.log.status", {
      sources: log.sources.length,
      quiet: state.quietRun,
      open: state.openUnknowns.join(", ") || "-",
    }),
    ...(state.suggestStop
      ? [ctx.t("research.log.stop_note", { quiet: state.quietRun, stop: log.question.stop || "-" })]
      : []),
  ];
};

type Values = Parameters<typeof stringOption>[0];

const suggested = (ctx: Ctx, root: FmPaths, url: string, values: Values): Readonly<Record<string, string>> => {
  const proposer = whenEnabled(providerDeps(ctx, root), "stance", providerStance);
  const stance = suggestStance(proposer, url, stringOption(values, "resolves") ?? "");
  return stance === undefined ? {} : { stance, stanceBy: "model" };
};

const stanceFields = (ctx: Ctx, paths: FmPaths, url: string, values: Values): Readonly<Record<string, string>> => {
  const stance = STANCES.find((item) => item === stringOption(values, "stance"));
  const claim = stringOption(values, "claim");
  return {
    ...(stance === undefined
      ? suggested(ctx, paths, url, values)
      : { stance, stanceBy: isPerson(ctx) ? "person" : "model" }),
    ...(claim === undefined ? {} : { claim }),
  };
};

const suggestionLines = (
  ctx: Ctx,
  slug: string,
  url: string,
  fields: Readonly<Record<string, string>>,
): readonly string[] =>
  fields["stanceBy"] === "model" && fields["stance"] !== undefined
    ? [ctx.t("research.sides.suggested", { url, stance: fields["stance"], slug })]
    : [];

const SOURCE_USAGE =
  "finitemonkey research source <slug> <url> --changed nothing|option|unknown [--target <option or unknown>] [--resolves <unknown>] [--stance favors|contests|unrelated] [--claim <judge claim>]";

export const researchSourceCommand: CommandSpec = {
  path: ["research", "source"],
  summaryKey: "command.research_source.summary",
  usage: SOURCE_USAGE,
  status: "ready",
  maxPositionals: 2,
  options: {
    changed: { type: "string" },
    target: { type: "string" },
    resolves: { type: "string" },
    stance: { type: "string" },
    claim: { type: "string" },
  },
  run: (ctx, args) => {
    const [slug = "", url = ""] = args.positionals;
    const changed = CHANGES.find((item) => item === stringOption(args.values, "changed"));
    if (slug === "" || url === "" || changed === undefined)
      return Promise.resolve(
        failureFrom(ctx.t, usageProblem("invalid_arguments", "research.log.error.source", SOURCE_USAGE)),
      );
    return inGuardianRepo(ctx, (root) => {
      const paths = fmPaths(root);
      if (readResearchLog(ctx.runtime, paths, slug) === undefined)
        return failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "research.log.error.missing", SOURCE_USAGE, { slug }),
        );
      const fields = stanceFields(ctx, paths, url, args.values);
      const written = appendResearch(ctx.runtime, paths, slug, {
        type: "source",
        url,
        changed,
        target: stringOption(args.values, "target") ?? "",
        resolves: stringOption(args.values, "resolves") ?? "",
        ...fields,
        at: ctx.runtime.now(),
      });
      const log = readResearchLog(ctx.runtime, paths, slug);
      if (!written || log === undefined)
        return failureFrom(ctx.t, guardianWriteProblem(`.finitemonkey/research/${slug}.jsonl`));
      const concepts = recordResearchConcepts(ctx.runtime, paths, slug, url, isPerson(ctx) ? "person" : "agent");
      return success({ schema: RESEARCH_LOG_SCHEMA, slug, state: researchState(log), concepts }, [
        ...stateLines(ctx, log),
        ...suggestionLines(ctx, slug, url, fields),
      ]);
    });
  },
};

export const researchStatusCommand: CommandSpec = {
  path: ["research", "status"],
  summaryKey: "command.research_status.summary",
  usage: "finitemonkey research status <slug>",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => {
    const slug = args.positionals[0] ?? "";
    return inGuardianRepo(ctx, (root) => {
      const log = readResearchLog(ctx.runtime, fmPaths(root), slug);
      if (log === undefined)
        return failureFrom(
          ctx.t,
          usageProblem("invalid_arguments", "research.log.error.missing", "finitemonkey research status <slug>", {
            slug,
          }),
        );
      return success(
        {
          schema: RESEARCH_LOG_SCHEMA,
          slug,
          question: log.question,
          sources: log.sources,
          state: researchState(log),
          ...researchLinks(ctx, fmPaths(root), log),
        },
        [...stateLines(ctx, log), ...sidesLines(ctx, log)],
      );
    });
  },
};

export const RESEARCH_LOG_OPTIONS = {
  decision: { type: "string" },
  option: { type: "string", multiple: true },
  criterion: { type: "string", multiple: true },
  unknown: { type: "string", multiple: true },
  stop: { type: "string" },
  risk: { type: "string" },
} as const;

export type OpenedLog =
  | { readonly kind: "none" }
  | { readonly kind: "opened"; readonly slug: string; readonly decision: string }
  | { readonly kind: "failed"; readonly result: CommandResult };

export const openResearchLog = (
  ctx: Ctx,
  root: Root,
  question: string,
  values: Parameters<typeof stringOption>[0],
): OpenedLog => {
  const decision = stringOption(values, "decision");
  if (decision === undefined) return { kind: "none" };
  const name = baseName(decision);
  const file = `${PLAN_DIR}/${name}`;
  if (!ctx.runtime.readText(planPath(root, name)).ok)
    return {
      kind: "failed",
      result: failureFrom(
        ctx.t,
        usageProblem("invalid_arguments", "guardian.error.no_record", "finitemonkey decide new <topic>", { file }),
      ),
    };
  const slug = slugOf(question);
  const paths = fmPaths(root);
  if (readResearchLog(ctx.runtime, paths, slug) !== undefined) return { kind: "opened", slug, decision: file };
  const written = appendResearch(ctx.runtime, paths, slug, {
    type: "question",
    schema: RESEARCH_LOG_SCHEMA,
    question,
    decision: file,
    options: [...listOption(values, "option")],
    criteria: [...listOption(values, "criterion")],
    unknowns: [...listOption(values, "unknown")],
    stop: stringOption(values, "stop") ?? "",
    risk: RISKS.find((item) => item === stringOption(values, "risk")) ?? "normal",
    at: ctx.runtime.now(),
  });
  return written
    ? { kind: "opened", slug, decision: file }
    : { kind: "failed", result: failureFrom(ctx.t, guardianWriteProblem(`.finitemonkey/research/${slug}.jsonl`)) };
};
