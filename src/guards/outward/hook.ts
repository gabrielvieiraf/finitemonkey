import { optionalString } from "../../core/parsed.js";
import { logEvent } from "../../evidence/log.js";
import { projectPaths } from "../../gate/hooks/common.js";
import { shellText } from "../../git/hooks/context.js";
import type { HookDecision, HookHandler, HookHandlers, HookInput } from "../../hooks/handlers.js";
import { UNTRUSTED_WINDOW_MS } from "../../knowledge/quarantine.js";
import { featureMode } from "../../policy/feature.js";
import { type UntrustedRead, untrustedReadIn } from "../../policy/untrusted.js";
import { toolName } from "../../secrets/guards/tool-input.js";
import { dialectOf, normalizeCommand } from "../../shell/normalize.js";
import type { FmPaths } from "../../task/paths.js";
import { firstOutward } from "./classify.js";

export const OUTWARD_FEATURE = "untrusted-outward";
export const OUTWARD_EVENT = "untrusted_outward";

const ALLOW: HookDecision = { kind: "allow" };

interface Found {
  readonly paths: FmPaths;
  readonly action: string;
  readonly read: UntrustedRead;
}

const found = (input: HookInput): Found | undefined => {
  const text = shellText(input.payload);
  const paths = projectPaths(input);
  if (text === undefined || paths === undefined) return undefined;
  const read = untrustedReadIn(input.runtime, paths, input.payload.sessionId ?? "", UNTRUSTED_WINDOW_MS);
  if (read === undefined) return undefined;
  const commands = normalizeCommand(text, dialectOf(toolName(input.payload))).commands;
  const action = firstOutward(commands, { cwd: input.cwd, repoRoot: paths.root });
  return action === undefined ? undefined : { paths, action, read };
};

const record = (input: HookInput, hit: Found, decision: "asked" | "shadow" | "ran" | "approved"): void => {
  logEvent(input.runtime, hit.paths, OUTWARD_EVENT, {
    action: hit.action,
    source: hit.read.tool,
    readAt: hit.read.at,
    decision,
    toolUseId: optionalString(input.payload.raw, "tool_use_id") ?? null,
    sessionId: input.payload.sessionId ?? null,
  });
};

export const outwardPreToolUse: HookHandler = (input) => {
  const hit = found(input);
  if (hit === undefined) return ALLOW;
  const mode = featureMode(input.runtime, hit.paths, OUTWARD_FEATURE);
  if (mode === "off") return ALLOW;
  record(input, hit, mode === "active" ? "asked" : "shadow");
  if (mode !== "active") return ALLOW;
  const params = { action: hit.action, source: hit.read.tool };
  return {
    kind: "allow",
    output: {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: input.t("outward.ask.reason", params),
      },
      systemMessage: `finitemonkey: ${input.t("outward.ask.human", params)}`,
    },
  };
};

export const outwardPostToolUse: HookHandler = (input) => {
  const hit = found(input);
  if (hit === undefined) return ALLOW;
  const mode = featureMode(input.runtime, hit.paths, OUTWARD_FEATURE);
  if (mode !== "off") record(input, hit, mode === "active" ? "approved" : "ran");
  return ALLOW;
};

export const OUTWARD_HANDLERS: HookHandlers = {
  PreToolUse: [outwardPreToolUse],
  PostToolUse: [outwardPostToolUse],
};
