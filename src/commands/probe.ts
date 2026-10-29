import { parseConcept } from "../conceitos/concepts.js";
import { readConceptEvents } from "../conceitos/evidence.js";
import {
  gapOf,
  type Probe,
  PROBE_KINDS,
  type ProbeOption,
  PROBES_FEATURE,
  PROBES_SCHEMA,
} from "../conceitos/probes.js";
import { answerProbe, nextProbe, probesPath, proposeProbe, readProbeState } from "../conceitos/probes-run.js";
import { stringOption } from "../core/args.js";
import { nowMs } from "../core/clock.js";
import type { Ctx } from "../core/context.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { DOMAINS } from "../perfil/types.js";
import { featureMode } from "../policy/feature.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import type { CommandSpec, OptionValues } from "./types.js";

const PROPOSE_USAGE =
  "finitemonkey probe propose --kind <kind> --concept <concept> --question <text> --why <text> --option a=<text> [--option-run a=<cmd>] [--run <cmd>] [--input <stdin>]";

const pathsOf = (ctx: Ctx): FmPaths => fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);

const list = (values: OptionValues, name: string): readonly string[] => {
  const value = values[name];
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return raw.filter((item): item is string => typeof item === "string");
};

const pairs = (values: OptionValues, name: string): ReadonlyMap<string, string> =>
  new Map(
    list(values, name).flatMap((item): [string, string][] => {
      const at = item.indexOf("=");
      return at <= 0 ? [] : [[item.slice(0, at).trim(), item.slice(at + 1)]];
    }),
  );

const shown = (probe: Probe): Readonly<Record<string, unknown>> => ({
  id: probe.id,
  kind: probe.kind,
  concept: probe.concept,
  question: probe.question,
  why: probe.why,
  options: probe.options.map((option) => ({ id: option.id, text: option.text })),
  status: probe.status,
});

const cardLines = (ctx: Ctx, probe: Probe): readonly string[] => [
  ctx.t("probe.card", { id: probe.id, question: probe.question }),
  ...probe.options.map((option) => ctx.t("probe.option", { id: option.id, text: option.text })),
  ctx.t("probe.why", { why: probe.why }),
  ctx.t("probe.answer_how", { id: probe.id }),
];

const propose = (ctx: Ctx, values: OptionValues): CommandResult => {
  const paths = pathsOf(ctx);
  if (featureMode(ctx.runtime, paths, PROBES_FEATURE) === "off")
    return success({ schema: PROBES_SCHEMA, outcome: "off" }, [ctx.t("probe.off")]);
  const kind = PROBE_KINDS.find((item) => item === stringOption(values, "kind"));
  const concept = parseConcept(stringOption(values, "concept"));
  const question = stringOption(values, "question")?.trim() ?? "";
  const why = stringOption(values, "why")?.trim() ?? "";
  const texts = pairs(values, "option");
  const runs = pairs(values, "option-run");
  if (kind === undefined || concept === undefined || question === "" || why === "" || texts.size < 2)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", PROPOSE_USAGE, { detail: "probe" }),
    );
  const options: readonly ProbeOption[] = [...texts].map(([id, text]) => {
    const run = runs.get(id);
    return { id, text, ...(run === undefined ? {} : { run }) };
  });
  const run = stringOption(values, "run");
  const input = stringOption(values, "input");
  const probe = proposeProbe(ctx.runtime, paths, {
    kind,
    concept,
    question,
    why,
    options,
    ...(run === undefined ? {} : { run }),
    ...(input === undefined ? {} : { input }),
  });
  return success({ schema: PROBES_SCHEMA, probe: shown(probe) }, [
    ctx.t(probe.status === "invalid" ? "probe.invalid" : "probe.proposed", { id: probe.id }),
  ]);
};

const next = (ctx: Ctx, values: OptionValues): CommandResult => {
  const paths = pathsOf(ctx);
  if (featureMode(ctx.runtime, paths, PROBES_FEATURE) === "off")
    return success({ schema: PROBES_SCHEMA, probe: null }, [ctx.t("probe.off")]);
  const session = stringOption(values, "session") ?? ctx.env["CLAUDE_SESSION_ID"];
  const found = nextProbe(ctx.runtime, paths, session, nowMs(ctx.runtime));
  if (found.probe === undefined)
    return success({ schema: PROBES_SCHEMA, probe: null, reason: found.budget?.reason ?? "none" }, [
      ctx.t("probe.none"),
    ]);
  return success({ schema: PROBES_SCHEMA, probe: shown(found.probe) }, cardLines(ctx, found.probe));
};

const answer = (ctx: Ctx, id: string | undefined, option: string | undefined, skip: boolean): CommandResult => {
  if (id === undefined || (!skip && (option === undefined || option.trim() === "")))
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "error.invalid_arguments", "finitemonkey probe answer <id> <option>", {
        detail: "id",
      }),
    );
  const probe = answerProbe(ctx.runtime, pathsOf(ctx), id, skip ? undefined : option?.trim());
  if (probe === undefined)
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "probe.not_open", "finitemonkey probe", { id }));
  logEvent(ctx.runtime, pathsOf(ctx), "probe.result", {
    id,
    kind: probe.kind,
    concept: probe.concept,
    status: probe.status,
  });
  const key = probe.options.find((item) => item.id === probe.key)?.text ?? "-";
  return success({ schema: PROBES_SCHEMA, probe: { ...shown(probe), key: probe.key } }, [
    ctx.t(
      `probe.result.${probe.status === "wrong" || probe.status === "right" ? "ran" : probe.status === "skipped" ? "skipped" : "recorded"}`,
      {
        id,
        key,
      },
    ),
  ]);
};

const listed = (ctx: Ctx): CommandResult => {
  const state = readProbeState(ctx.runtime, pathsOf(ctx));
  return success(
    { schema: PROBES_SCHEMA, probes: state.probes.map(shown) },
    state.probes.length === 0
      ? [ctx.t("probe.empty")]
      : state.probes.map((probe) =>
          ctx.t("probe.line", { id: probe.id, concept: probe.concept, status: probe.status }),
        ),
  );
};

const gap = (ctx: Ctx): CommandResult => {
  const paths = pathsOf(ctx);
  const state = readProbeState(ctx.runtime, paths);
  const events = readConceptEvents(ctx.runtime, paths);
  const now = nowMs(ctx.runtime);
  const domains = DOMAINS.map((domain) => gapOf(domain, state, events, now));
  return success({ schema: PROBES_SCHEMA, mode: featureMode(ctx.runtime, paths, PROBES_FEATURE), domains }, [
    ctx.t("probe.internal"),
  ]);
};

const forget = (ctx: Ctx): CommandResult => {
  const removed = ctx.runtime.remove(probesPath(pathsOf(ctx))).ok;
  return success({ schema: PROBES_SCHEMA, removed: removed ? 1 : 0 }, [ctx.t("probe.forgotten")]);
};

const PROPOSE_OPTIONS = {
  kind: { type: "string" },
  concept: { type: "string" },
  question: { type: "string" },
  why: { type: "string" },
  option: { type: "string", multiple: true },
  "option-run": { type: "string", multiple: true },
  run: { type: "string" },
  input: { type: "string" },
} as const;

export const probeCommand: CommandSpec = {
  path: ["probe"],
  summaryKey: "command.probe.summary",
  usage: "finitemonkey probe",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(listed(ctx)),
};

export const probeProposeCommand: CommandSpec = {
  path: ["probe", "propose"],
  summaryKey: "command.probe_propose.summary",
  usage: PROPOSE_USAGE,
  status: "ready",
  maxPositionals: 0,
  options: PROPOSE_OPTIONS,
  run: (ctx, args) => Promise.resolve(propose(ctx, args.values)),
};

export const probeNextCommand: CommandSpec = {
  path: ["probe", "next"],
  summaryKey: "command.probe_next.summary",
  usage: "finitemonkey probe next [--session <id>]",
  status: "ready",
  maxPositionals: 0,
  options: { session: { type: "string" } },
  run: (ctx, args) => Promise.resolve(next(ctx, args.values)),
};

export const probeAnswerCommand: CommandSpec = {
  path: ["probe", "answer"],
  summaryKey: "command.probe_answer.summary",
  usage: "finitemonkey probe answer <id> <option>",
  status: "ready",
  maxPositionals: 2,
  run: (ctx, args) => Promise.resolve(answer(ctx, args.positionals[0], args.positionals[1], false)),
};

export const probeSkipCommand: CommandSpec = {
  path: ["probe", "skip"],
  summaryKey: "command.probe_skip.summary",
  usage: "finitemonkey probe skip <id>",
  status: "ready",
  maxPositionals: 1,
  run: (ctx, args) => Promise.resolve(answer(ctx, args.positionals[0], undefined, true)),
};

export const probeGapCommand: CommandSpec = {
  path: ["probe", "gap"],
  summaryKey: "command.probe_gap.summary",
  usage: "finitemonkey probe gap --json",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(gap(ctx)),
};

export const probeForgetCommand: CommandSpec = {
  path: ["probe", "forget"],
  summaryKey: "command.probe_forget.summary",
  usage: "finitemonkey probe forget",
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(forget(ctx)),
};
