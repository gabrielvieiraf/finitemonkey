import { logEvent } from "../evidence/log.js";
import { deny } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { modeOf, readShadow } from "../policy/guards.js";
import { loadPolicy } from "../policy/policy.js";
import { inlineData } from "../policy/untrusted.js";
import { pendingAttempt } from "./attempts.js";
import { baseOf, record, scopeOf, type SignalScope } from "./context.js";
import { stopDecision } from "./stop.js";
import { readProfile, sessionEntries } from "./store.js";
import { writesFiles } from "./writes.js";

export const FOURTH_ATTEMPT_GUARD = "fourth-attempt";

const allow = { kind: "allow" } as const;

const RESEARCHER = /(?:^|:)researcher$/i;
const AGENT_TOOLS = new Set(["Agent", "Task"]);

const alreadyNoted = (scope: SignalScope, sig: string): boolean => {
  const entries = sessionEntries(scope.entries, scope.session);
  const lastError = entries.findLastIndex((entry) => entry.kind === "error");
  return entries.slice(lastError + 1).some((entry) => entry.kind === "fourth" && entry.sig === sig);
};

const modeNow = (scope: SignalScope): string => {
  const { runtime } = scope.input;
  return modeOf(
    { id: FOURTH_ATTEMPT_GUARD, damage: false },
    loadPolicy(runtime, scope.paths.root),
    readShadow(runtime, scope.paths),
  );
};

const noteFourth = (scope: SignalScope, sig: string, failed: number, mode: string): void => {
  const { runtime } = scope.input;
  record(scope, { ...baseOf(scope), kind: "fourth", sig, mode });
  logEvent(runtime, scope.paths, "signals.fourth_attempt", {
    sig,
    failed,
    mode,
    tool: toolName(scope.input.payload.raw),
  });
};

export const fourthAttemptGuard: HookHandler = (input): HookDecision => {
  if (!writesFiles(input.payload.raw)) return allow;
  const scope = scopeOf(input);
  if (scope === undefined) return allow;
  const stop = stopDecision(scope, modeNow(scope));
  if (stop !== undefined) return stop;
  const threshold = readProfile(input.runtime, scope.files).threshold;
  const pending = pendingAttempt(sessionEntries(scope.entries, scope.session), threshold);
  if (pending === undefined) return allow;
  const mode = modeNow(scope);
  const noted = alreadyNoted(scope, pending.sig);
  if (noted && mode !== "active") return allow;
  if (!noted) noteFourth(scope, pending.sig, pending.failed, mode);
  const { t } = input;
  const params = { sig: pending.sig, count: pending.failed, sample: inlineData("tool output", pending.sample) };
  const blocked = deny(modelReason(t, "signals.fourth", params), t("signals.fourth.human", params));
  return blocked.kind === "block" ? { ...blocked, warning: t("signals.fourth.warning", params) } : blocked;
};

const researcherOf = (raw: Readonly<Record<string, unknown>>): string | undefined => {
  const tool = toolName(raw);
  const agent = AGENT_TOOLS.has(tool)
    ? textField(toolInput(raw), "subagent_type")
    : tool === ""
      ? textField(raw, "agent_type")
      : undefined;
  return agent !== undefined && RESEARCHER.test(agent) ? agent : undefined;
};

export const researchRecorder: HookHandler = (input) => {
  const agent = researcherOf(input.payload.raw);
  if (agent === undefined) return allow;
  const scope = scopeOf(input);
  if (scope !== undefined) record(scope, { ...baseOf(scope), kind: "research", agent });
  return allow;
};
