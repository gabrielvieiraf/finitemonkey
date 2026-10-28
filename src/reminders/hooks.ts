import { dirname, relative } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import { type JsonObject, parseJsonObject } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import { projectPaths } from "../gate/hooks/common.js";
import { comesFromPerson } from "../guards/release/markers.js";
import type { HookEvent } from "../hooks/events.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../hooks/handlers.js";
import { injectContext } from "../policy/inject.js";
import { policyNumber } from "../policy/numbers.js";
import { effectiveRules } from "../rules/preset.js";
import { readSummary, writeSummary } from "../rules/violations.js";
import type { FmPaths } from "../task/paths.js";
import {
  DEFAULT_MAX_RULES,
  DEFAULT_MAX_TOKENS,
  type Limits,
  selectReminders,
  SESSION_SOURCES,
  type Trigger,
} from "./select.js";

const STATE_FILE = "reminders.json";
const ALLOW: HookDecision = { kind: "allow" };

interface SeenState {
  readonly session: string;
  readonly seen: readonly string[];
}

const readSeen = (input: HookInput, paths: FmPaths): SeenState => {
  const raw = input.runtime.readText(paths.cache(STATE_FILE));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  const session = input.payload.sessionId ?? "";
  if (parsed?.ok !== true || parsed.value["session"] !== session) return { session, seen: [] };
  const seen = parsed.value["seen"];
  return { session, seen: Array.isArray(seen) ? seen.filter((item): item is string => typeof item === "string") : [] };
};

export const limitsOf = (runtime: HookInput["runtime"], root: FmPaths["root"]): Limits => ({
  maxRules: policyNumber(runtime, root, ["reminders", "maxRules"], DEFAULT_MAX_RULES),
  maxTokens: policyNumber(runtime, root, ["reminders", "maxTokens"], DEFAULT_MAX_TOKENS),
});

type Builder = (raw: JsonObject, root: FmPaths["root"]) => Trigger | undefined;

const BUILDERS: Readonly<Partial<Record<HookEvent, Builder>>> = {
  SessionStart: (raw) => {
    const source = SESSION_SOURCES.find((item) => item === textField(raw, "source"));
    return source === undefined ? undefined : { kind: "session", source };
  },
  SubagentStart: () => ({ kind: "subagent" }),
  PreToolUse: (raw, root) => {
    const args = toolInput(raw);
    const file = textField(args, "file_path", "notebook_path", "path");
    const path = file === undefined ? undefined : toPosixPath(relative(root, toAbsolutePath(file, root)));
    return { kind: "tool", tool: toolName(raw), path, command: textField(args, "command") ?? "" };
  },
  UserPromptSubmit: (raw) => {
    const text = textField(raw, "prompt") ?? "";
    return text.trim() === "" || !comesFromPerson(text) ? undefined : { kind: "prompt", text };
  },
};

const triggerOf = (input: HookInput, root: FmPaths["root"]): Trigger | undefined =>
  BUILDERS[input.event]?.(input.payload.raw, root);

const remember = (input: HookInput, paths: FmPaths, state: SeenState, ids: readonly string[], reset: boolean) => {
  if (input.event === "SubagentStart") return;
  const seen = reset ? ids : [...new Set([...state.seen, ...ids])];
  input.runtime.mkdir(toAbsolutePath(dirname(paths.cache(STATE_FILE))));
  input.runtime.writeText(paths.cache(STATE_FILE), `${JSON.stringify({ session: state.session, seen })}\n`);
};

export const remindersHook: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined) return ALLOW;
  const trigger = triggerOf(input, paths.root);
  if (trigger === undefined) return ALLOW;
  const rules = effectiveRules(input.runtime, paths.root);
  if (!rules.ok || !rules.value.some((rule) => rule.bucket === "reminder")) return ALLOW;
  const summary = readSummary(input.runtime, paths.dir);
  const state = readSeen(input, paths);
  const selection = selectReminders(rules.value, trigger, {
    counts: summary.counts,
    pending: summary.pending,
    seen: new Set(state.seen),
    limits: limitsOf(input.runtime, paths.root),
  });
  if (trigger.kind === "prompt" && summary.pending.length > 0)
    writeSummary(input.runtime, paths.dir, { ...summary, pending: [] });
  if (selection.picked.length === 0) return ALLOW;
  const ids = selection.picked.map((item) => item.rule.id);
  remember(input, paths, state, ids, trigger.kind === "session");
  return injectContext(input, paths, { id: "reminders", event: "reminder" }, selection.text, {
    rules: ids.join(","),
    why: selection.picked.map((item) => item.why).join(","),
    tokens: selection.tokens,
  });
};

export const REMINDERS_HANDLERS: HookHandlers = {
  SessionStart: [remindersHook],
  SubagentStart: [remindersHook],
  PreToolUse: [remindersHook],
  UserPromptSubmit: [remindersHook],
};
