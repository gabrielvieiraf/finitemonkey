import { isRecord, type JsonObject } from "../core/parsed.js";
import type { HookEvent } from "../hooks/events.js";
import { LOCAL_BIN, VENDOR_BIN } from "./layout.js";

export type Runner =
  { readonly kind: "local" } | { readonly kind: "vendored" } | { readonly kind: "path"; readonly path: string };

export interface HookSpec {
  readonly event: HookEvent;
  readonly timeout: number;
  readonly guard: boolean;
}

export const INSTALLED_HOOKS: readonly HookSpec[] = [
  { event: "SessionStart", timeout: 30, guard: false },
  { event: "UserPromptSubmit", timeout: 10, guard: true },
  { event: "PreToolUse", timeout: 10, guard: true },
  { event: "PostToolUse", timeout: 30, guard: false },
  { event: "PostToolUseFailure", timeout: 30, guard: false },
  { event: "PermissionRequest", timeout: 10, guard: false },
  { event: "Stop", timeout: 600, guard: false },
  { event: "SubagentStart", timeout: 30, guard: false },
  { event: "SubagentStop", timeout: 600, guard: false },
  { event: "PreCompact", timeout: 30, guard: false },
  { event: "ConfigChange", timeout: 10, guard: true },
];

export const PROJECT_BIN = `\${CLAUDE_PROJECT_DIR}/${LOCAL_BIN}`;
export const VENDORED_BIN = `\${CLAUDE_PROJECT_DIR}/${VENDOR_BIN}`;

export type HookHandlerJson = JsonObject;

export const isScript = (path: string): boolean => /\.(c|m)?js$/i.test(path);

const execForm = (runner: Runner, event: HookEvent): { command: string; args: readonly string[] } => {
  if (runner.kind === "local") return { command: "node", args: [PROJECT_BIN, "hook", event] };
  if (runner.kind === "vendored") return { command: "node", args: [VENDORED_BIN, "hook", event] };
  if (isScript(runner.path)) return { command: "node", args: [runner.path, "hook", event] };
  return { command: runner.path, args: ["hook", event] };
};

export const hookHandler = (runner: Runner, spec: HookSpec, failClosedSupported: boolean): HookHandlerJson => {
  const failure = spec.guard && failClosedSupported ? { onFailure: "block" } : {};
  const { command, args } = execForm(runner, spec.event);
  return { type: "command", command, args, timeout: spec.timeout, ...failure };
};

const OWN_SHELL = /(^|[\s/"'])finitemonkey(@[^\s"]+|\.mjs|\.cmd|\.exe)?"?\s+hook\s/;
const OWN_SCRIPT = /finitemonkey(\.mjs|\.cmd|\.exe)?$/;

const stringsOf = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const isOwnHandler = (handler: unknown): boolean => {
  if (!isRecord(handler)) return false;
  const command = handler["command"];
  if (typeof command !== "string") return false;
  const args = stringsOf(handler["args"]);
  if (args.length === 0) return OWN_SHELL.test(`${command} `);
  const hookAt = args.indexOf("hook");
  if (hookAt < 0) return false;
  const target = hookAt === 0 ? command : (args[hookAt - 1] ?? "");
  return OWN_SCRIPT.test(target);
};
