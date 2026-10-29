declare module "claude-code/testing" {
  export type StubEvent = Readonly<Record<string, unknown>>;

  export type StubNext = (e: StubEvent) => Promise<unknown>;
  export type Stub = (api: unknown, e: StubEvent, next: StubNext) => unknown;
  export type StreamStub = (api: unknown, e: StubEvent, next: StubNext) => AsyncGenerator<unknown, unknown, unknown>;

  export interface StubOn {
    (event: string, stub: Stub | StreamStub): void;
    (event: string, matcher: Readonly<Record<string, unknown>>, stub: Stub | StreamStub): void;
  }

  export interface Drawn {
    readonly type: string;
    readonly props: Readonly<Record<string, unknown>>;
    readonly children: readonly unknown[];
  }

  export interface Mounted {
    readonly press: (target: { readonly key: string }) => Promise<void>;
    readonly input: (target: { readonly key: string; readonly text: string }) => Promise<void>;
    readonly find: (query: {
      readonly key?: string;
      readonly type?: string;
      readonly text?: string | RegExp;
    }) => Promise<Drawn | undefined>;
    readonly unmount: () => Promise<void>;
  }

  export interface ToolDecision {
    readonly decision: "allow" | "ask" | "deny";
    readonly reason?: string;
  }

  export interface Engine {
    readonly session: {
      readonly start: (input: {
        readonly surface: string | null;
        readonly isInteractive: boolean;
        readonly cwd: string;
      }) => Promise<unknown>;
      readonly compact: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>;
    };
    readonly command: {
      readonly run: (input: { readonly command: string; readonly args: string }) => Promise<{ readonly text?: string }>;
    };
    readonly tool: {
      readonly call: (input: Readonly<Record<string, unknown>>) => Promise<unknown>;
      readonly check: (input: {
        readonly tool: string;
        readonly input: unknown;
        readonly tool_use_id?: string;
      }) => Promise<ToolDecision>;
    };
    readonly turn: {
      readonly complete: (input: Readonly<Record<string, unknown>>) => Promise<{ readonly text?: string }>;
      readonly step: (input: Readonly<Record<string, unknown>>) => AsyncGenerator<unknown, unknown, unknown>;
    };
    readonly prompt: {
      readonly compose: (input: Readonly<Record<string, unknown>>) => Promise<unknown>;
    };
    readonly attribution: {
      readonly text: (input: { readonly kind: string; readonly text: string }) => Promise<{ readonly text: string }>;
    };
    readonly ui: {
      readonly mount: (input: Readonly<Record<string, unknown>>) => Promise<Mounted>;
    };
  }

  export interface Matchers {
    readonly toBe: (expected: unknown) => void;
    readonly toEqual: (expected: unknown) => void;
    readonly toMatch: (expected: string | RegExp) => void;
    readonly toMatchObject: (expected: Readonly<Record<string, unknown>>) => void;
    readonly toContain: (expected: unknown) => void;
    readonly toBeDefined: () => void;
    readonly toBeUndefined: () => void;
    readonly not: Matchers;
  }

  export interface FixturePlugin {
    readonly name: string;
    readonly tier?: "prepend" | "user" | "append" | "builtin";
    readonly register: (on: StubOn) => void;
  }

  export interface MockClock {
    readonly advance: (ms: number) => Promise<void>;
    readonly settle: () => Promise<void>;
    readonly now: () => number;
  }

  export type TestBody = (engine: Engine, on: StubOn) => Promise<void>;

  export function test(name: string, body: TestBody): void;
  export function test(name: string, options: { readonly plugins: readonly FixturePlugin[] }, body: TestBody): void;
  export function describe(name: string, body: () => void): void;
  export function expect(value: unknown): Matchers;
  export function tier(name: "prepend" | "user" | "append" | "builtin"): void;
  export const mock: {
    readonly clock: (on: StubOn, options?: { readonly now?: number }) => MockClock;
    readonly store: (on: StubOn, entries: Readonly<Record<string, unknown>>) => void;
    readonly env: (on: StubOn, variables: Readonly<Record<string, string>>) => void;
  };
}
