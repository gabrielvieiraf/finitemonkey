import type { AbsolutePath } from "../core/brand.js";
import { optionalString, parseJsonObject } from "../core/parsed.js";
import type { ExecResult, Runtime } from "../core/runtime.js";
import { HOOK_PROBE_ENV } from "../hooks/runner.js";
import { maskText } from "../mask/mask.js";
import type { HookEntry } from "./hook-sources.js";

export interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly shell: boolean;
  readonly timeoutMs: number;
  readonly display: string;
}

export type FireProblem = "missing" | "timeout" | "exit" | "output";

export type FireResult =
  | { readonly kind: "answered"; readonly durationMs: number }
  | { readonly kind: "failed"; readonly problem: FireProblem; readonly detail: string };

export const PROBE_TIMEOUT_MS = 10_000;
export const SLOW_HOOK_MS = 1500;
const DEFAULT_TIMEOUT_S = 60;

export type Vars = Readonly<Record<string, string>>;

const expand = (text: string, vars: Vars): string =>
  text.replace(/\$\{(\w+)\}|\$(\w+)/g, (match, braced: string | undefined, bare: string | undefined) => {
    const name = braced ?? bare ?? "";
    return vars[name] ?? match;
  });

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const invocationOf = (entry: HookEntry, vars: Vars): Invocation | undefined => {
  const raw = optionalString(entry.handler, "command");
  if (raw === undefined || raw.trim() === "") return undefined;
  const timeout = entry.handler["timeout"];
  const seconds = typeof timeout === "number" && timeout > 0 ? timeout : DEFAULT_TIMEOUT_S;
  const timeoutMs = Math.min(seconds * 1000, PROBE_TIMEOUT_MS);
  const command = expand(raw, vars);
  const args = strings(entry.handler["args"]).map((arg) => expand(arg, vars));
  const shell = args.length === 0;
  return { command, args, shell, timeoutMs, display: [command, ...args].join(" ") };
};

export const versionInvocation = (invocation: Invocation): Invocation | undefined => {
  if (invocation.shell) {
    const command = invocation.command.replace(/(^|\s)hook\s.*$/, "$1version --json");
    return command === invocation.command ? undefined : { ...invocation, command, display: command };
  }
  const at = invocation.args.indexOf("hook");
  if (at < 0) return undefined;
  const args = [...invocation.args.slice(0, at), "version", "--json"];
  return { ...invocation, args, display: [invocation.command, ...args].join(" ") };
};

export const syntheticPayload = (event: string, cwd: AbsolutePath): string => {
  const base = { session_id: "finitemonkey-doctor", transcript_path: "", cwd, hook_event_name: event };
  const extra: Readonly<Record<string, unknown>> = {
    PreToolUse: { tool_name: "Bash", tool_input: { command: "true" }, tool_use_id: "doctor" },
    PostToolUse: { tool_name: "Bash", tool_input: { command: "true" }, tool_response: {}, tool_use_id: "doctor" },
    UserPromptSubmit: { prompt: "finitemonkey doctor" },
    Stop: { stop_hook_active: false },
    SubagentStop: { stop_hook_active: false },
    SessionStart: { source: "startup" },
    PreCompact: { trigger: "manual", custom_instructions: "" },
  };
  const more = extra[event];
  return JSON.stringify(typeof more === "object" && more !== null ? { ...base, ...more } : base);
};

const run = (exec: Runtime["exec"], invocation: Invocation, cwd: AbsolutePath, env: Vars, input?: string): ExecResult =>
  exec({
    command: invocation.command,
    args: invocation.args,
    cwd,
    timeoutMs: invocation.timeoutMs,
    shell: invocation.shell,
    env: { ...env, [HOOK_PROBE_ENV]: "1" },
    ...(input === undefined ? {} : { input }),
  });

const firstLine = (text: string): string => maskText(text.trim().split("\n")[0] ?? "").slice(0, 160);

export const classify = (result: ExecResult): FireResult => {
  if (!result.found) return { kind: "failed", problem: "missing", detail: "" };
  if (result.timedOut) return { kind: "failed", problem: "timeout", detail: "" };
  if (result.exitCode !== 0) {
    return { kind: "failed", problem: "exit", detail: `${String(result.exitCode)}: ${firstLine(result.stderr)}` };
  }
  const answer = parseJsonObject(result.stdout.trim());
  if (!answer.ok) return { kind: "failed", problem: "output", detail: firstLine(result.stdout) };
  return { kind: "answered", durationMs: result.durationMs };
};

export const fireHook = (
  exec: Runtime["exec"],
  entry: HookEntry,
  invocation: Invocation,
  cwd: AbsolutePath,
  env: Vars,
): FireResult => classify(run(exec, invocation, cwd, env, syntheticPayload(entry.event, cwd)));

export const executableVersion = (
  exec: Runtime["exec"],
  invocation: Invocation,
  cwd: AbsolutePath,
  env: Vars,
): string | undefined => {
  const query = versionInvocation(invocation);
  if (query === undefined) return undefined;
  const result = run(exec, query, cwd, env);
  if (result.exitCode !== 0) return undefined;
  const body = parseJsonObject(result.stdout.trim());
  const data = body.ok ? body.value["data"] : undefined;
  return typeof data === "object" && data !== null && "version" in data && typeof data.version === "string"
    ? data.version
    : undefined;
};
