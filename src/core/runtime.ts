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

export interface GitResult {
  readonly found: boolean;
  readonly ok: boolean;
  readonly stdout: string;
}

export type Git = (args: readonly string[], cwd: AbsolutePath) => GitResult;

export type GitLines = (
  args: readonly string[],
  cwd: AbsolutePath,
  onLine: (line: string) => void,
) => Promise<GitResult>;

export interface Runtime {
  readonly nodeVersion: string;
  readonly readText: (path: AbsolutePath) => Parsed<string>;
  readonly probe: Probe;
  readonly startTimer: (ms: number, onFire: () => void) => CancelTimer;
  readonly writeText: (path: AbsolutePath, text: string) => Parsed<true>;
  readonly listDir: (path: AbsolutePath) => Parsed<readonly string[]>;
  readonly walkFiles: (root: AbsolutePath) => Parsed<readonly string[]>;
  readonly now: () => string;
  readonly git: Git;
  readonly gitLines: GitLines;
}
