import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { CORRECT_SCORE, DOMAIN_QUESTIONS, parseOption } from "../perfil/questions.js";
import { questionLines, runQuickStart } from "../perfil/quick-start.js";
import {
  agentCommitsPath,
  perfilPath,
  profileOrStart,
  readProfile,
  updateDomain,
  writeProfile,
} from "../perfil/store.js";
import { DOMAINS, levelOf, parseDomain, parseLevel, type Profile, scoreOf } from "../perfil/types.js";
import { isPerson } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import type { CommandSpec } from "./types.js";

export const PERFIL_SCHEMA = "finitemonkey/perfil@1";

const pathsOf = (ctx: Ctx): FmPaths => fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);

const profileJson = (profile: Profile): Readonly<Record<string, unknown>> => ({
  schema: PERFIL_SCHEMA,
  quickStart: profile.quickStart,
  domains: Object.fromEntries(
    DOMAINS.map((domain) => {
      const entry = profile.domains[domain];
      return [
        domain,
        {
          tool: { score: entry.tool, level: levelOf(entry.tool) },
          knowledge: { score: entry.knowledge, level: levelOf(entry.knowledge) },
          claimed: entry.claimed ?? null,
        },
      ];
    }),
  ),
});

const profileLines = (ctx: Ctx, profile: Profile): readonly string[] =>
  DOMAINS.map((domain) => {
    const entry = profile.domains[domain];
    return ctx.t("perfil.show.line", {
      domain: ctx.t(`perfil.domain.${domain}`),
      tool: ctx.t(`perfil.level.${levelOf(entry.tool)}`),
      knowledge: ctx.t(`perfil.level.${levelOf(entry.knowledge)}`),
    });
  });

const show = (ctx: Ctx): CommandResult => {
  const stored = readProfile(ctx.runtime, pathsOf(ctx));
  const profile = stored ?? profileOrStart(ctx.runtime, pathsOf(ctx));
  const header = stored === undefined ? [ctx.t("perfil.show.none")] : [];
  return success(profileJson(profile), [...header, ...profileLines(ctx, profile)]);
};

const start = async (ctx: Ctx): Promise<CommandResult> => {
  const paths = pathsOf(ctx);
  const before = profileOrStart(ctx.runtime, paths);
  const outcome = await runQuickStart(ctx, before);
  const profile = outcome.kind === "done" ? outcome.profile : { ...before, quickStart: "skipped" as const };
  writeProfile(ctx.runtime, paths, profile);
  const head = ctx.t(outcome.kind === "done" ? "perfil.start.done" : "perfil.start.skipped");
  return success(profileJson(profile), [head, ...profileLines(ctx, profile)]);
};

const SET_USAGE = `finitemonkey perfil set <${DOMAINS.join("|")}> <beginner|intermediate|advanced>`;
const ANSWER_USAGE = `finitemonkey perfil answer <${DOMAINS.join("|")}> <a|b|c>`;

const set = (ctx: Ctx, rawDomain: string | undefined, rawLevel: string | undefined): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("perfil.error.person_only", SET_USAGE));
  const domain = parseDomain(rawDomain);
  const level = parseLevel(rawLevel);
  if (domain === undefined || level === undefined) {
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", SET_USAGE, {
        detail: `${rawDomain ?? ""} ${rawLevel ?? ""}`,
      }),
    );
  }
  const paths = pathsOf(ctx);
  const profile = profileOrStart(ctx.runtime, paths);
  const observed = levelOf(profile.domains[domain].knowledge);
  if (observed === level)
    return success(profileJson(profile), [ctx.t("perfil.set.same", { level: ctx.t(`perfil.level.${level}`) })]);
  const updated = updateDomain(profile, domain, (entry) => ({ ...entry, claimed: level }));
  writeProfile(ctx.runtime, paths, updated);
  return success(profileJson(updated), [
    ctx.t("perfil.set.question", { domain: ctx.t(`perfil.domain.${domain}`) }),
    ...questionLines(ctx, DOMAIN_QUESTIONS[domain]),
    ctx.t("perfil.set.how", { command: `finitemonkey perfil answer ${domain} <a|b|c>` }),
  ]);
};

const answer = (ctx: Ctx, rawDomain: string | undefined, rawOption: string | undefined): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("perfil.error.person_only", ANSWER_USAGE));
  const domain = parseDomain(rawDomain);
  const option = parseOption(rawOption);
  if (domain === undefined || option === undefined) {
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", ANSWER_USAGE, {
        detail: `${rawDomain ?? ""} ${rawOption ?? ""}`,
      }),
    );
  }
  const paths = pathsOf(ctx);
  const profile = profileOrStart(ctx.runtime, paths);
  const entry = profile.domains[domain];
  const right = option === DOMAIN_QUESTIONS[domain].correct;
  const claimedScore = entry.claimed === undefined ? CORRECT_SCORE : scoreOf(entry.claimed);
  const knowledge = right ? claimedScore : entry.knowledge;
  const updated = updateDomain(profile, domain, () => ({ tool: entry.tool, knowledge }));
  writeProfile(ctx.runtime, paths, updated);
  const key = right ? "perfil.answer.right" : "perfil.answer.kept";
  return success(profileJson(updated), [ctx.t(key, { level: ctx.t(`perfil.level.${levelOf(knowledge)}`) })]);
};

const forget = (ctx: Ctx): CommandResult => {
  const paths = pathsOf(ctx);
  const removed = [perfilPath(paths), agentCommitsPath(paths)].filter(
    (path) => ctx.runtime.stat(path) !== undefined && ctx.runtime.remove(path).ok,
  );
  return success({ schema: PERFIL_SCHEMA, removed: removed.length }, [ctx.t("perfil.forget.done")]);
};

export const perfilCommand: CommandSpec = {
  path: ["perfil"],
  summaryKey: "command.perfil.summary",
  usage: "finitemonkey perfil",
  status: "ready",
  run: (ctx) => Promise.resolve(show(ctx)),
};

export const perfilStartCommand: CommandSpec = {
  path: ["perfil", "start"],
  summaryKey: "command.perfil_start.summary",
  usage: "finitemonkey perfil start",
  status: "ready",
  run: (ctx) => start(ctx),
};

export const perfilSetCommand: CommandSpec = {
  path: ["perfil", "set"],
  summaryKey: "command.perfil_set.summary",
  usage: SET_USAGE,
  status: "ready",
  maxPositionals: 2,
  run: (ctx, args) => Promise.resolve(set(ctx, args.positionals[0], args.positionals[1])),
};

export const perfilAnswerCommand: CommandSpec = {
  path: ["perfil", "answer"],
  summaryKey: "command.perfil_answer.summary",
  usage: ANSWER_USAGE,
  status: "ready",
  maxPositionals: 2,
  run: (ctx, args) => Promise.resolve(answer(ctx, args.positionals[0], args.positionals[1])),
};

export const perfilForgetCommand: CommandSpec = {
  path: ["perfil", "forget"],
  summaryKey: "command.perfil_forget.summary",
  usage: "finitemonkey perfil forget",
  status: "ready",
  run: (ctx) => Promise.resolve(forget(ctx)),
};
