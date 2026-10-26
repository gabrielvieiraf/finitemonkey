import type { AbsolutePath } from "../core/brand.js";
import type { JsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { gitPreToolUse } from "../git/hooks/pre-tool.js";
import { gitPostToolUse, gitSessionStart } from "../git/hooks/session.js";
import { gitStop } from "../git/hooks/stop.js";
import type { Translate } from "../i18n/translate.js";
import { secretsPostToolUse, secretsUserPromptSubmit } from "../secrets/guards/exposure.js";
import { secretsPreToolUse } from "../secrets/guards/pre-tool.js";
import type { HookEvent } from "./events.js";
import type { HookPayload } from "./payload.js";

export interface HookInput {
  readonly event: HookEvent;
  readonly payload: HookPayload;
  readonly cwd: AbsolutePath;
  readonly runtime: Runtime;
  readonly t: Translate;
}

export type HookDecision =
  { readonly kind: "allow"; readonly output?: JsonObject } | { readonly kind: "block"; readonly reason: string };

export type HookHandler = (input: HookInput) => HookDecision | Promise<HookDecision>;

export type HookHandlers = Readonly<Partial<Record<HookEvent, readonly HookHandler[]>>>;

export const allow: HookHandler = () => ({ kind: "allow" });

export const DEFAULT_HANDLERS: HookHandlers = {
  SessionStart: [gitSessionStart],
  SubagentStart: [gitSessionStart],
  PreToolUse: [secretsPreToolUse, gitPreToolUse],
  UserPromptSubmit: [secretsUserPromptSubmit],
  PostToolUse: [secretsPostToolUse, gitPostToolUse],
  Stop: [gitStop],
  SubagentStop: [gitStop],
};
