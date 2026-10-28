export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PermissionDenied",
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
  PostToolUseFailure: { failClosed: false },
  PermissionRequest: { failClosed: false },
  PermissionDenied: { failClosed: false },
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

export const LONG_HOOK_DEADLINE_MS = 570_000;

export const SESSION_HOOK_DEADLINE_MS = 20_000;

const EVENT_DEADLINES: Readonly<Partial<Record<HookEvent, number>>> = {
  Stop: LONG_HOOK_DEADLINE_MS,
  SubagentStop: LONG_HOOK_DEADLINE_MS,
  SessionStart: SESSION_HOOK_DEADLINE_MS,
  PreCompact: SESSION_HOOK_DEADLINE_MS,
};

export const deadlineFor = (event: HookEvent, raw: string | undefined): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return EVENT_DEADLINES[event] ?? DEFAULT_HOOK_DEADLINE_MS;
};
