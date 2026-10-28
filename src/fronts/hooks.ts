import { accept, isRecord, optionalString } from "../core/parsed.js";
import { guardRoot } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import { modelReason } from "../hooks/reason.js";
import { frontContext } from "./context.js";
import { type Front, type FrontsState, readFronts, runningWriteFronts, updateFronts, withFront } from "./state.js";

const ALLOW: HookDecision = { kind: "allow" };
const AGENT_TOOLS = new Set(["Agent", "Task"]);
const WORKFLOW_TOOLS = new Set(["Workflow"]);

export const READ_ONLY_AGENTS: ReadonlySet<string> = new Set([
  "Explore",
  "Plan",
  "claude-code-guide",
  "statusline-setup",
  "researcher",
  "reviewer",
  "verifier",
]);

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const LIVE: ReadonlySet<Front["status"]> = new Set(["planned", "blocked", "running"]);

export const frontNamed = (state: FrontsState, text: string): Front | undefined =>
  state.fronts.find(
    (front) => LIVE.has(front.status) && new RegExp(`(?<![\\w.-])${escape(front.id)}(?![\\w.-])`).test(text),
  );

const stateOf = (input: HookInput): FrontsState | undefined => {
  const read = readFronts(input.runtime, guardRoot(input));
  return read.ok && read.value.fronts.length > 0 ? read.value : undefined;
};

const agentText = (input: HookInput): string => {
  const args = toolInput(input.payload.raw);
  return [textField(args, "prompt"), textField(args, "description"), textField(args, "name")]
    .filter((part): part is string => part !== undefined)
    .join("\n");
};

const ask = (input: HookInput): HookDecision => ({
  kind: "allow",
  output: {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: input.t("fronts.ask.workflow"),
    },
  },
});

export const frontsPreToolUse: HookHandler = (input) => {
  const tool = toolName(input.payload.raw);
  if (!AGENT_TOOLS.has(tool) && !WORKFLOW_TOOLS.has(tool)) return ALLOW;
  const state = stateOf(input);
  if (state === undefined) return ALLOW;
  const running = runningWriteFronts(state);
  if (WORKFLOW_TOOLS.has(tool)) return running.length > 0 ? ask(input) : ALLOW;
  const type = textField(toolInput(input.payload.raw), "subagent_type") ?? "general-purpose";
  if (READ_ONLY_AGENTS.has(type) || running.length < state.maxConcurrent) return ALLOW;
  return {
    kind: "block",
    reason: modelReason(input.t, "fronts.block.limit", {
      max: state.maxConcurrent,
      running: running.map((front) => front.id).join(", "),
    }),
    human: input.t("fronts.block.human"),
  };
};

const responseAgentId = (input: HookInput): string | undefined => {
  const response = input.payload.raw["tool_response"];
  if (!isRecord(response)) return undefined;
  return optionalString(response, "agentId") ?? optionalString(response, "agent_id");
};

export const frontsPostToolUse: HookHandler = (input) => {
  if (!AGENT_TOOLS.has(toolName(input.payload.raw))) return ALLOW;
  const state = stateOf(input);
  const front = state === undefined ? undefined : frontNamed(state, agentText(input));
  if (front === undefined) return ALLOW;
  const agentId = responseAgentId(input) ?? null;
  updateFronts(input.runtime, guardRoot(input), (current) =>
    accept({
      state: {
        ...withFront(current, front.id, (item) => ({
          ...item,
          status: "running",
          startedAt: item.startedAt ?? input.runtime.now(),
          agentId: agentId ?? item.agentId,
        })),
        pending: agentId === null ? [...current.pending, front.id] : current.pending,
      },
      result: undefined,
    }),
  );
  return ALLOW;
};

const NO_CONTEXT = /(^|:)(reviewer|verifier|researcher|explore|plan|claude-code-guide|statusline-setup)$/i;

const injected = (input: HookInput, front: Front): HookDecision => ({
  kind: "allow",
  output: {
    hookSpecificOutput: {
      hookEventName: "SubagentStart",
      additionalContext: frontContext(input.t, input.runtime, guardRoot(input), front),
    },
  },
});

export const frontsSubagentStart: HookHandler = (input) => {
  const agentId = optionalString(input.payload.raw, "agent_id");
  const state = stateOf(input);
  if (agentId === undefined || state === undefined) return ALLOW;
  if (NO_CONTEXT.test(optionalString(input.payload.raw, "agent_type") ?? "")) return ALLOW;
  const bound = state.fronts.find((front) => front.agentId === agentId);
  if (bound !== undefined) return injected(input, bound);
  const [next, ...rest] = state.pending;
  const front = state.fronts.find((item) => item.id === next);
  if (next === undefined || front === undefined) return ALLOW;
  updateFronts(input.runtime, guardRoot(input), (current) =>
    accept({
      state: { ...withFront(current, next, (item) => ({ ...item, agentId })), pending: rest },
      result: undefined,
    }),
  );
  return injected(input, { ...front, agentId });
};

export const frontOfAgent = (state: FrontsState, agentId: string | undefined): Front | undefined =>
  agentId === undefined ? undefined : state.fronts.find((front) => front.agentId === agentId);
