import type { ModApi, ModElement, RenderInput, Surface } from "./api.js";
import type { CheckResult } from "./tighten.js";

export interface SessionStartInput {
  readonly cwd: string;
  readonly surface: Surface | null;
  readonly isInteractive: boolean;
}

export interface SessionStartResult {
  readonly cwd: string;
}

export interface ToolCheckInput {
  readonly tool: string;
  readonly input: unknown;
  readonly tool_use_id?: string;
  readonly agentId?: string;
  readonly isReadOnly?: true;
}

export type ToolCheckResult = CheckResult;

export interface Usage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly model?: string;
}

export interface TurnCompleteInput {
  readonly turnId: string;
  readonly answer?: string;
  readonly durationMs?: number;
  readonly isAborted?: boolean;
  readonly usage?: Usage | null;
  readonly agentId?: string;
}

export interface TurnCompleteResult {
  readonly text?: string;
}

export interface ToolCallInput {
  readonly tool: string;
  readonly [field: string]: unknown;
}

export type ToolCallResult = Readonly<Record<string, unknown>>;

export interface CommandRunInput {
  readonly command: string;
  readonly args: string;
}

export interface CommandRunResult {
  readonly text?: string;
  readonly context?: readonly string[];
}

export interface AttributionTextInput {
  readonly kind: string;
  readonly text: string;
}

export interface AttributionTextResult {
  readonly text: string;
}

export interface PromptSection {
  readonly id: string;
  readonly text: string;
  readonly scope: "shared" | "session";
}

export interface PromptComposeInput {
  readonly model: string;
}

export interface PromptComposeResult {
  readonly sections: readonly PromptSection[];
}

export interface SessionCompactInput {
  readonly trigger: string;
  readonly agentId?: string;
  readonly instructions?: string;
  readonly messages: readonly unknown[];
}

export type SessionCompactResult = Readonly<Record<string, unknown>>;

export interface EventTypes {
  readonly "prompt.compose": readonly [PromptComposeInput, PromptComposeResult];
  readonly "session.compact": readonly [SessionCompactInput, SessionCompactResult];
  readonly "attribution.text": readonly [AttributionTextInput, AttributionTextResult];
  readonly "tool.call": readonly [ToolCallInput, ToolCallResult];
  readonly "ui.render": readonly [RenderInput, ModElement | null];
  readonly "command.run": readonly [CommandRunInput, CommandRunResult];
  readonly "session.start": readonly [SessionStartInput, SessionStartResult];
  readonly "tool.check": readonly [ToolCheckInput, ToolCheckResult];
  readonly "turn.complete": readonly [TurnCompleteInput, TurnCompleteResult];
}

export type EventName = keyof EventTypes;
export type InputOf<N extends EventName> = EventTypes[N][0];
export type ResultOf<N extends EventName> = EventTypes[N][1];

export type Next<N extends EventName> = (e: InputOf<N>) => Promise<ResultOf<N>>;

export interface FailedNext<N extends EventName> {
  (e: InputOf<N>): Promise<ResultOf<N>>;
  readonly called: boolean;
  readonly error?: { readonly kind: string; readonly message?: string };
}

export type Hook<N extends EventName> = ($: ModApi, e: InputOf<N>, next: Next<N>) => Promise<ResultOf<N>>;
export type CatchHook<N extends EventName> = ($: ModApi, e: InputOf<N>, next: FailedNext<N>) => Promise<ResultOf<N>>;

export interface Registration<N extends EventName> {
  readonly catch: (handler: CatchHook<N>) => unknown;
}

export type Matcher = Readonly<Record<string, string | boolean | readonly string[]>>;

export interface On {
  <N extends EventName>(event: N, hook: Hook<N>): Registration<N>;
  <N extends EventName>(event: N, matcher: Matcher, hook: Hook<N>): Registration<N>;
}
