import type { ModApi, Surface } from "./api.js";

export interface SessionStartInput {
  readonly cwd: string;
  readonly surface: Surface | null;
  readonly isInteractive: boolean;
}

export interface SessionStartResult {
  readonly cwd: string;
}

export interface EventTypes {
  readonly "session.start": readonly [SessionStartInput, SessionStartResult];
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
