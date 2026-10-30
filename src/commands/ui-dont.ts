import { stringOption } from "../core/args.js";
import type { Ctx } from "../core/context.js";
import { needsPersonProblem, usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { logEvent } from "../evidence/log.js";
import { findRepoRoot } from "../gate/hooks/common.js";
import { DONT_OPS, type DontPredicate, type DontRule, nextDontId, readDont, writeDont } from "../look/dont.js";
import { DEFAULT_PATTERNS } from "../look/ds.js";
import { isPerson, personName } from "../secrets/project.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import type { CommandSpec, OptionValues } from "./types.js";

export const UI_DONT_SCHEMA = "finitemonkey/ui-dont@1";

const ADD_USAGE =
  "finitemonkey ui dont add --reason <why> [--selector <css> --property <name> (--equals|--above|--below|--matches) <value> | --pattern <pill|gradient|default-font|emoji-icon|same-shadow>]";
const RETIRE_USAGE = "finitemonkey ui dont retire <id> --reason <why>";
const LIST_USAGE = "finitemonkey ui dont";

export interface UiDontData {
  readonly schema: typeof UI_DONT_SCHEMA;
  readonly rules: readonly DontRule[];
}

const pathsOf = (ctx: Ctx): FmPaths => fmPaths(findRepoRoot(ctx.runtime, ctx.cwd) ?? ctx.cwd);

const line = (ctx: Ctx, rule: DontRule): string =>
  ctx.t(
    rule.retired !== undefined
      ? "ui.dont.line_retired"
      : rule.predicate === undefined && rule.pattern === undefined
        ? "ui.dont.line_text"
        : "ui.dont.line",
    {
      id: rule.id,
      reason: rule.reason,
      check:
        rule.predicate === undefined
          ? (rule.pattern ?? "")
          : `${rule.predicate.selector} ${rule.predicate.property} ${rule.predicate.op} ${rule.predicate.value}`,
    },
  );

const listed = (ctx: Ctx, rules: readonly DontRule[]): CommandResult<UiDontData> =>
  success(
    { schema: UI_DONT_SCHEMA, rules },
    rules.length === 0 ? [ctx.t("ui.dont.empty")] : rules.map((rule) => line(ctx, rule)),
  );

export const predicateFrom = (values: OptionValues): DontPredicate | undefined | "partial" => {
  const selector = stringOption(values, "selector");
  const property = stringOption(values, "property");
  const ops = DONT_OPS.flatMap((op) => {
    const value = stringOption(values, op);
    return value === undefined ? [] : [{ op, value }];
  });
  if (selector === undefined && property === undefined && ops.length === 0) return undefined;
  const [chosen] = ops;
  if (selector === undefined || property === undefined || chosen === undefined || ops.length > 1) return "partial";
  return { selector, property, op: chosen.op, value: chosen.value };
};

const add = (ctx: Ctx, values: OptionValues): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("ui.person_only", ADD_USAGE));
  const reason = stringOption(values, "reason")?.trim() ?? "";
  const predicate = predicateFrom(values);
  const pattern = stringOption(values, "pattern");
  const known = pattern === undefined || DEFAULT_PATTERNS.some((name) => name === pattern);
  if (reason === "" || predicate === "partial" || !known || (pattern !== undefined && predicate !== undefined))
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "ui.dont.bad_input", ADD_USAGE));
  const paths = pathsOf(ctx);
  const rules = readDont(ctx.runtime, paths);
  const rule: DontRule = {
    id: nextDontId(rules),
    reason,
    by: personName(ctx),
    at: ctx.runtime.now(),
    source: stringOption(values, "source") ?? "message",
    ...(predicate === undefined ? {} : { predicate }),
    ...(pattern === undefined ? {} : { pattern }),
  };
  if (!writeDont(ctx.runtime, paths, [...rules, rule]))
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "ui.dont.write_failed", LIST_USAGE));
  logEvent(ctx.runtime, paths, "ui.dont_added", { id: rule.id, reason, compiled: predicate !== undefined });
  return {
    ...listed(ctx, [...rules, rule]),
    human: [ctx.t("ui.dont.added", { id: rule.id, reason }), line(ctx, rule)],
  };
};

const retire = (ctx: Ctx, id: string, values: OptionValues): CommandResult => {
  if (!isPerson(ctx)) return failureFrom(ctx.t, needsPersonProblem("ui.person_only", RETIRE_USAGE));
  const reason = stringOption(values, "reason")?.trim() ?? "";
  const paths = pathsOf(ctx);
  const rules = readDont(ctx.runtime, paths);
  const found = rules.find((rule) => rule.id === id && rule.retired === undefined);
  if (found === undefined || reason === "")
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "ui.dont.unknown", RETIRE_USAGE, { id }));
  const retired = { at: ctx.runtime.now(), by: personName(ctx), reason };
  const next = rules.map((rule) => (rule.id === id ? { ...rule, retired } : rule));
  if (!writeDont(ctx.runtime, paths, next))
    return failureFrom(ctx.t, usageProblem("invalid_arguments", "ui.dont.write_failed", LIST_USAGE));
  logEvent(ctx.runtime, paths, "ui.dont_retired", { id, reason, by: retired.by });
  return { ...listed(ctx, next), human: [ctx.t("ui.dont.retired", { id, reason })] };
};

export const uiDontCommand: CommandSpec = {
  path: ["ui", "dont"],
  summaryKey: "command.ui_dont.summary",
  usage: LIST_USAGE,
  status: "ready",
  maxPositionals: 0,
  run: (ctx) => Promise.resolve(listed(ctx, readDont(ctx.runtime, pathsOf(ctx)))),
};

export const uiDontAddCommand: CommandSpec = {
  path: ["ui", "dont", "add"],
  summaryKey: "command.ui_dont_add.summary",
  usage: ADD_USAGE,
  status: "ready",
  maxPositionals: 0,
  options: {
    reason: { type: "string" },
    selector: { type: "string" },
    property: { type: "string" },
    equals: { type: "string" },
    above: { type: "string" },
    below: { type: "string" },
    matches: { type: "string" },
    source: { type: "string" },
    pattern: { type: "string" },
  },
  run: (ctx, args) => Promise.resolve(add(ctx, args.values)),
};

export const uiDontRetireCommand: CommandSpec = {
  path: ["ui", "dont", "retire"],
  summaryKey: "command.ui_dont_retire.summary",
  usage: RETIRE_USAGE,
  status: "ready",
  maxPositionals: 1,
  options: { reason: { type: "string" } },
  run: (ctx, args) => Promise.resolve(retire(ctx, args.positionals[0] ?? "", args.values)),
};
