export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "ConfigChange",
  "Notification",
  "SessionEnd",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface HookPolicy {
  readonly failClosed: boolean;
}

export const HOOK_POLICIES = {
  SessionStart: { failClosed: false },
  UserPromptSubmit: { failClosed: true },
  PreToolUse: { failClosed: true },
  PostToolUse: { failClosed: false },
  Stop: { failClosed: true },
  SubagentStart: { failClosed: false },
  SubagentStop: { failClosed: true },
  PreCompact: { failClosed: false },
  ConfigChange: { failClosed: true },
  Notification: { failClosed: false },
  SessionEnd: { failClosed: false },
} as const satisfies Readonly<Record<HookEvent, HookPolicy>>;

const squash = (value: string): string => value.replace(/[-_\s]/g, "").toLowerCase();

export const parseHookEvent = (raw: string): HookEvent | undefined =>
  HOOK_EVENTS.find((event) => squash(event) === squash(raw));

export const DEFAULT_HOOK_DEADLINE_MS = 3000;

export const parseDeadline = (raw: string | undefined): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HOOK_DEADLINE_MS;
};
