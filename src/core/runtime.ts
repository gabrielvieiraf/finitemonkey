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

export interface GitRunOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly input?: string;
  readonly timeoutMs?: number;
}

export interface GitRun extends GitResult {
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type GitWith = (args: readonly string[], cwd: AbsolutePath, options: GitRunOptions) => GitRun;

export interface ExecResult {
  readonly found: boolean;
  readonly ok: boolean;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type Exec = (command: string, args: readonly string[], cwd: AbsolutePath, timeoutMs: number) => ExecResult;

export type FileKind = "file" | "dir";

export interface FileStat {
  readonly kind: FileKind;
  readonly mtimeMs: number;
}

export interface LockOptions {
  readonly staleMs: number;
  readonly owner: string;
}

export type ReleaseLock = () => void;

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
  readonly stat: (path: AbsolutePath) => FileStat | undefined;
  readonly writeAtomic: (path: AbsolutePath, content: string) => Parsed<undefined>;
  readonly rename: (from: AbsolutePath, to: AbsolutePath) => Parsed<undefined>;
  readonly mkdir: (path: AbsolutePath) => Parsed<undefined>;
  readonly remove: (path: AbsolutePath) => Parsed<undefined>;
  readonly lock: (path: AbsolutePath, options: LockOptions) => Parsed<ReleaseLock>;
  readonly selfPath: AbsolutePath;
  readonly gitWith: GitWith;
  readonly exec: Exec;
  readonly realpath: (path: string) => string;
}
