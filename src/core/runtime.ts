import type { AbsolutePath } from "./brand.js";
import type { Parsed } from "./parsed.js";

export interface ProbeResult {
  readonly found: boolean;
  readonly ok: boolean;
  readonly stdout: string;
  readonly timedOut: boolean;
}

export type Probe = (command: string, args: readonly string[], timeoutMs: number) => ProbeResult;

export type CancelTimer = () => void;

export interface Runtime {
  readonly nodeVersion: string;
  readonly readText: (path: AbsolutePath) => Parsed<string>;
  readonly probe: Probe;
  readonly startTimer: (ms: number, onFire: () => void) => CancelTimer;
}
