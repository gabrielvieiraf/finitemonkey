import type { MessageKey } from "../i18n/catalogs.js";
import type { Params } from "../i18n/translate.js";
import { INSTALLED_HOOKS } from "../install/hook-entries.js";
import { executableVersion, fireHook, type Invocation, invocationOf, SLOW_HOOK_MS, type Vars } from "./hook-fire.js";
import type { HookEntry } from "./hook-sources.js";
import { CLAUDE_MIN } from "./tools.js";
import { type CheckFinding, type CheckStatus, type DoctorEnv, type HookHealth } from "./types.js";

interface Problem {
  readonly health: Exclude<HookHealth, "ok">;
  readonly messageKey: MessageKey;
  readonly fixKey: MessageKey;
  readonly params: Params;
}

const GUARDS: ReadonlySet<string> = new Set(INSTALLED_HOOKS.filter((spec) => spec.guard).map((spec) => spec.event));
const SHELL_TOOLS = ["Bash", "PowerShell"] as const;

export const uncoveredTools = (matcher: string | undefined): readonly string[] => {
  if (matcher === undefined || matcher === "" || matcher === "*") return [];
  try {
    const pattern = new RegExp(`^(?:${matcher})$`);
    return SHELL_TOOLS.filter((tool) => !pattern.test(tool));
  } catch {
    return SHELL_TOOLS.filter((tool) => tool !== matcher);
  }
};

const configProblems = (entry: HookEntry): readonly Problem[] => {
  const base = { source: entry.source, event: entry.event };
  const problems: Problem[] = [];
  if (GUARDS.has(entry.event) && entry.handler["onFailure"] !== "block") {
    problems.push({
      health: "degraded",
      messageKey: "doctor.hooks.fail_open",
      fixKey: "doctor.hooks.fix_fail_open",
      params: { ...base, min: CLAUDE_MIN },
    });
  }
  const tools = entry.event === "PreToolUse" ? uncoveredTools(entry.matcher) : [];
  if (tools.length > 0) {
    problems.push({
      health: "degraded",
      messageKey: "doctor.hooks.matcher",
      fixKey: "doctor.hooks.fix_matcher",
      params: { ...base, matcher: entry.matcher ?? "", tools: tools.join(", ") },
    });
  }
  return problems;
};

const BROKEN_KEYS = {
  missing: "doctor.hooks.not_found",
  timeout: "doctor.hooks.timeout",
  exit: "doctor.hooks.exit",
  output: "doctor.hooks.output",
} as const satisfies Readonly<Record<string, MessageKey>>;

const brokenFix = (entry: HookEntry): MessageKey =>
  entry.source === "plugin" ? "doctor.hooks.fix_broken_plugin" : "doctor.hooks.fix_broken";

export interface HookContext {
  readonly env: DoctorEnv;
  readonly vars: Vars;
  readonly versionOf: (invocation: Invocation) => string | undefined;
}

export const hookContext = (env: DoctorEnv, vars: Vars): HookContext => {
  const cache = new Map<string, string | undefined>();
  return {
    env,
    vars,
    versionOf: (invocation) => {
      if (!cache.has(invocation.display)) {
        cache.set(invocation.display, executableVersion(env.runtime.exec, invocation, env.root, vars));
      }
      return cache.get(invocation.display);
    },
  };
};

const runProblems = (context: HookContext, entry: HookEntry, invocation: Invocation): Problem[] | number => {
  const base = { source: entry.source, event: entry.event, command: invocation.display };
  const found = context.versionOf(invocation);
  if (found !== undefined && found !== context.env.version) {
    return [
      {
        health: "degraded",
        messageKey: "doctor.hooks.not_fired",
        fixKey: "doctor.hooks.fix_not_fired",
        params: { ...base, found, version: context.env.version },
      },
    ];
  }
  const fired = fireHook(context.env.runtime.exec, entry, invocation, context.env.root, context.vars);
  if (fired.kind === "failed") {
    const ms = invocation.timeoutMs;
    const params = { ...base, detail: fired.detail, ms };
    return [{ health: "broken", messageKey: BROKEN_KEYS[fired.problem], fixKey: brokenFix(entry), params }];
  }
  if (fired.durationMs <= SLOW_HOOK_MS) return fired.durationMs;
  const params = { ...base, ms: Math.round(fired.durationMs) };
  return [{ health: "degraded", messageKey: "doctor.hooks.slow", fixKey: "doctor.hooks.fix_slow", params }];
};

const STATUS: Readonly<Record<HookHealth, CheckStatus>> = { ok: "ok", degraded: "warn", broken: "fail" };

const toFinding = (entry: HookEntry, problems: readonly Problem[], ms: number): CheckFinding => {
  const check = `hook.${entry.source}.${entry.event}`;
  const worst = problems.find((problem) => problem.health === "broken") ?? problems[0];
  if (worst === undefined) {
    const params = { source: entry.source, event: entry.event, ms: Math.round(ms) };
    return { check, status: "ok", hook: "ok", messageKey: "doctor.hooks.ok", params };
  }
  return {
    check,
    status: STATUS[worst.health],
    hook: worst.health,
    messageKey: worst.messageKey,
    params: worst.params,
    fixKey: worst.fixKey,
  };
};

export const hookFinding = (context: HookContext, entry: HookEntry): CheckFinding => {
  const invocation = invocationOf(entry, context.vars);
  if (invocation === undefined) {
    const params = { source: entry.source, event: entry.event };
    const problem: Problem = {
      health: "broken",
      messageKey: "doctor.hooks.no_command",
      fixKey: brokenFix(entry),
      params: { ...params, command: "" },
    };
    return toFinding(entry, [problem], 0);
  }
  const ran = runProblems(context, entry, invocation);
  const problems = typeof ran === "number" ? [] : ran;
  return toFinding(entry, [...problems, ...configProblems(entry)], typeof ran === "number" ? ran : 0);
};
