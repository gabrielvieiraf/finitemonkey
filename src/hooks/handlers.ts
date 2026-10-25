import type { AbsolutePath } from "../core/brand.js";
import type { JsonObject } from "../core/parsed.js";
import type { HookEvent } from "./events.js";
import type { HookPayload } from "./payload.js";

export interface HookInput {
  readonly event: HookEvent;
  readonly payload: HookPayload;
  readonly cwd: AbsolutePath;
}

export type HookDecision =
  { readonly kind: "allow"; readonly output?: JsonObject } | { readonly kind: "block"; readonly reason: string };

export type HookHandler = (input: HookInput) => HookDecision | Promise<HookDecision>;

export type HookHandlers = Readonly<Partial<Record<HookEvent, readonly HookHandler[]>>>;

export const allow: HookHandler = () => ({ kind: "allow" });

export const DEFAULT_HANDLERS: HookHandlers = {};
