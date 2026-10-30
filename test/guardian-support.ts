import { Readable } from "node:stream";

import type { TextSource } from "../src/core/context.js";
import type { JsonObject } from "../src/core/parsed.js";
import type { Runtime } from "../src/core/runtime.js";
import type { HookEvent } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { createTranslator } from "../src/i18n/translate.js";
import type { Repo } from "./repo.js";
import { repoRuntime } from "./repo.js";
import { field, parseBody, stdinFrom } from "./support.js";

export const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

export const fireHook = (
  repo: Repo,
  event: HookEvent,
  payload: JsonObject,
  runtime: Runtime = repoRuntime(),
): Promise<HookOutcome> =>
  runHook(event, {
    stdin: stdinFrom(JSON.stringify({ hook_event_name: event, session_id: "s1", cwd: repo.root, ...payload })),
    deadlineMs: 20_000,
    handlers: DEFAULT_HANDLERS,
    cwd: repo.root,
    t: createTranslator("en"),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });

export const denied = (outcome: HookOutcome): boolean =>
  outcome.stdout.trim() !== "" &&
  field(parseBody(outcome.stdout), "hookSpecificOutput", "permissionDecision") === "deny";

export const contextOf = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const body = parseBody(outcome.stdout);
  const text =
    field(body, "hookSpecificOutput", "additionalContext") ??
    field(body, "hookSpecificOutput", "permissionDecisionReason");
  return typeof text === "string" ? text : "";
};

export const silent = (outcome: HookOutcome): boolean => !denied(outcome) && contextOf(outcome) === "";

export const policyWith = (guards: Readonly<Record<string, string>>): string =>
  `guards:\n${Object.entries(guards)
    .map(([id, mode]) => `  ${id}: ${mode}`)
    .join("\n")}\n`;
