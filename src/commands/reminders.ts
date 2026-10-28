import { join } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Ctx } from "../core/context.js";
import { parseJsonObject } from "../core/parsed.js";
import { usageProblem } from "../core/problem.js";
import { type CommandResult, failureFrom, success } from "../core/result.js";
import { limitsOf } from "../reminders/hooks.js";
import { selectReminders, SESSION_SOURCES, type Trigger } from "../reminders/select.js";
import { effectiveRules } from "../rules/preset.js";
import { RULES_FILE } from "../rules/types.js";
import { readSummary } from "../rules/violations.js";
import { projectRoot } from "../secrets/project.js";
import { fmPaths } from "../task/paths.js";
import type { OptionValues } from "./types.js";
import type { CommandSpec } from "./types.js";

export const REMINDERS_SCHEMA = "finitemonkey/reminders@1";
const EVENTS = ["session", "subagent", "tool", "prompt"] as const;

const option = (values: OptionValues, key: string): string | undefined => {
  const value = values[key];
  return typeof value === "string" ? value : undefined;
};

const triggerFrom = (values: OptionValues): Trigger | undefined => {
  const event = EVENTS.find((item) => item === (option(values, "event") ?? "session"));
  switch (event) {
    case "session": {
      const source = SESSION_SOURCES.find((item) => item === (option(values, "source") ?? "startup"));
      return source === undefined ? undefined : { kind: "session", source };
    }
    case "subagent":
      return { kind: "subagent" };
    case "tool":
      return {
        kind: "tool",
        tool: option(values, "tool") ?? "Edit",
        path: option(values, "path"),
        command: option(values, "command") ?? "",
      };
    case "prompt":
      return { kind: "prompt", text: option(values, "prompt") ?? "" };
    case undefined:
      return undefined;
  }
};

const seenNow = (ctx: Ctx, cache: string): ReadonlySet<string> => {
  const raw = ctx.runtime.readText(toAbsolutePath(cache));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  const seen = parsed?.ok === true ? parsed.value["seen"] : undefined;
  return new Set(Array.isArray(seen) ? seen.filter((item): item is string => typeof item === "string") : []);
};

const run = (ctx: Ctx, values: OptionValues): CommandResult => {
  const root = projectRoot(ctx);
  const trigger = triggerFrom(values);
  if (trigger === undefined)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "reminders.error.event", "finitemonkey reminders --event session"),
    );
  const rules = effectiveRules(ctx.runtime, root);
  if (!rules.ok)
    return failureFrom(
      ctx.t,
      usageProblem("invalid_arguments", "rules.error.invalid", `edit ${RULES_FILE}`, {
        file: RULES_FILE,
        detail: rules.error,
      }),
    );
  const paths = fmPaths(root);
  const summary = readSummary(ctx.runtime, paths.dir);
  const limits = limitsOf(ctx.runtime, root);
  const selection = selectReminders(rules.value, trigger, {
    counts: summary.counts,
    pending: summary.pending,
    seen: seenNow(ctx, join(paths.dir, "cache", "reminders.json")),
    limits,
  });
  const picked = selection.picked.map((item) => ({
    id: item.rule.id,
    why: item.why,
    violations: summary.counts[item.rule.id] ?? 0,
  }));
  const data = { schema: REMINDERS_SCHEMA, trigger, limits, tokens: selection.tokens, picked, text: selection.text };
  const human =
    picked.length === 0
      ? [ctx.t("reminders.none", { event: trigger.kind })]
      : [
          ctx.t("reminders.title", { count: picked.length, tokens: selection.tokens, max: limits.maxTokens }),
          ...picked.map((item) => ctx.t("reminders.row", { ...item })),
          "",
          selection.text,
        ];
  return success(data, human);
};

export const remindersCommand: CommandSpec = {
  path: ["reminders"],
  summaryKey: "reminders.command.summary",
  usage:
    "finitemonkey reminders [--event session|subagent|tool|prompt] [--source startup|resume|compact] [--tool <name>] [--path <file>] [--command <text>] [--prompt <text>]",
  status: "ready",
  maxPositionals: 0,
  options: {
    event: { type: "string" },
    source: { type: "string" },
    tool: { type: "string" },
    path: { type: "string" },
    command: { type: "string" },
    prompt: { type: "string" },
  },
  run: (ctx, args) => Promise.resolve(run(ctx, args.values)),
};
