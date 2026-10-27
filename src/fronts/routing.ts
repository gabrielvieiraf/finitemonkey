import type { AbsolutePath } from "../core/brand.js";
import { accept } from "../core/parsed.js";
import { guardRoot } from "../guards/context.js";
import { textField, toolInput, toolName } from "../hooks/fields.js";
import type { HookDecision, HookHandler, HookInput } from "../hooks/handlers.js";
import { NOTIFICATION } from "./report-hooks.js";
import { type Front, type FrontsState, readFronts, updateFronts, withFront } from "./state.js";

const ALLOW: HookDecision = { kind: "allow" };
const SEND_TOOLS = new Set(["SendMessage"]);
const NOT_PERSON = [NOTIFICATION, /^\s*\[julius2claude\]/, /<other-session-message>|<session-message>/];

export const isPersonPrompt = (prompt: string): boolean => !NOT_PERSON.some((pattern) => pattern.test(prompt));

const ACTIVE: ReadonlySet<Front["status"]> = new Set(["running", "blocked", "reported"]);

export const routingBlock = (state: FrontsState): string | undefined => {
  const active = state.fronts.filter((front) => ACTIVE.has(front.status));
  if (active.length === 0) return undefined;
  const lines = active.map((front) => `${front.id} [${front.status}] ${front.paths.join(", ") || front.goal}`);
  return [
    `finitemonkey: wave ${String(state.wave)} has ${String(active.length)} fronts (orchestrate skill routes messages):`,
    ...lines,
  ].join("\n");
};

export const frontsPrompt: HookHandler = (input) => {
  const prompt = textField(input.payload.raw, "prompt") ?? "";
  if (prompt.trim() === "" || !isPersonPrompt(prompt)) return ALLOW;
  const state = readFronts(input.runtime, guardRoot(input));
  const block = state.ok ? routingBlock(state.value) : undefined;
  if (block === undefined) return ALLOW;
  return {
    kind: "allow",
    output: { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: block } },
  };
};

export const appendInbox = (
  runtime: HookInput["runtime"],
  root: AbsolutePath,
  front: string,
  text: string,
  kind: string,
): void => {
  updateFronts(runtime, root, (state) =>
    accept({
      state: withFront(state, front, (item) => ({
        ...item,
        inbox: [...item.inbox, { at: runtime.now(), text, kind }],
      })),
      result: undefined,
    }),
  );
};

const recipientOf = (state: FrontsState, to: string): Front | undefined =>
  state.fronts.find((front) => front.agentId === to || front.id === to);

export const frontsSendMessage: HookHandler = (input) => {
  if (!SEND_TOOLS.has(toolName(input.payload.raw))) return ALLOW;
  const args = toolInput(input.payload.raw);
  const to = textField(args, "to", "recipient", "agent_id", "name");
  const message = textField(args, "message", "content", "text");
  if (to === undefined || message === undefined) return ALLOW;
  const state = readFronts(input.runtime, guardRoot(input));
  const front = state.ok ? recipientOf(state.value, to) : undefined;
  if (front !== undefined) appendInbox(input.runtime, guardRoot(input), front.id, message, "message");
  return ALLOW;
};
