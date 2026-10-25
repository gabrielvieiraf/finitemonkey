import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import type { CommandSpec } from "../src/commands/types.js";
import { type AbsolutePath, toAbsolutePath } from "../src/core/brand.js";
import type { Ctx, Env, TextSource } from "../src/core/context.js";
import { isRecord, type JsonObject, parseJsonObject } from "../src/core/parsed.js";
import { run } from "../src/core/run.js";
import type { GitResult, ProbeResult, Runtime } from "../src/core/runtime.js";
import { detectLang } from "../src/i18n/languages.js";
import { createTranslator } from "../src/i18n/translate.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";

export const ROOT = toAbsolutePath(join(dirname(fileURLToPath(import.meta.url)), ".."));
export const BUNDLE = toAbsolutePath(join(ROOT, "dist", "finitemonkey.mjs"));
export const TEST_VERSION = "9.9.9-test";
export const BUNDLE_TEXT = readFileSync(BUNDLE, "utf8");

export const found = (stdout: string): ProbeResult => ({ found: true, ok: true, stdout, timedOut: false });
export const missing: ProbeResult = { found: false, ok: false, stdout: "", timedOut: false };
export const slow: ProbeResult = { found: true, ok: false, stdout: "", timedOut: true };

export type TimerMode = "real" | "fires-now" | "never";

export interface FakeRuntimeOptions {
  readonly nodeVersion?: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly tools?: Readonly<Record<string, ProbeResult>>;
  readonly timer?: TimerMode;
  readonly now?: string;
  readonly git?: (args: readonly string[]) => GitResult;
  readonly gitLines?: (args: readonly string[]) => readonly string[] | undefined;
  readonly fs?: MemoryFs;
  readonly selfPath?: AbsolutePath;
  readonly gitWith?: Runtime["gitWith"];
  readonly exec?: Runtime["exec"];
}

export const gitMissing: GitResult = { found: false, ok: false, stdout: "" };

const DEFAULT_TOOLS: Readonly<Record<string, ProbeResult>> = {
  git: found("git version 2.47.1"),
  claude: found("2.1.283 (Claude Code)"),
};

const timers: Readonly<Record<TimerMode, Runtime["startTimer"]>> = {
  real: (ms, onFire) => {
    const timer = setTimeout(onFire, ms);
    return () => {
      clearTimeout(timer);
    };
  },
  "fires-now": (_ms, onFire) => {
    queueMicrotask(onFire);
    return () => undefined;
  },
  never: () => () => undefined,
};

export const fakeRuntime = (options: FakeRuntimeOptions = {}): Runtime => ({
  ...(options.fs ?? memoryFs({ [BUNDLE]: BUNDLE_TEXT, ...options.files }, [], options.now)),
  nodeVersion: options.nodeVersion ?? "22.11.0",
  probe: (command) => options.tools?.[command] ?? DEFAULT_TOOLS[command] ?? missing,
  startTimer: timers[options.timer ?? "real"],
  git: (args) => options.git?.(args) ?? gitMissing,
  gitLines: (args, _cwd, onLine) => {
    const lines = options.gitLines?.(args);
    if (lines === undefined) return Promise.resolve(gitMissing);
    for (const line of lines) onLine(line);
    return Promise.resolve({ found: true, ok: true, stdout: "" });
  },
  selfPath: options.selfPath ?? BUNDLE,
  gitWith: options.gitWith ?? ((args) => ({ ...(options.git?.(args) ?? gitMissing), stderr: "", timedOut: false })),
  exec: options.exec ?? (() => ({ found: false, ok: false, status: null, stdout: "", stderr: "", timedOut: false })),
  realpath: (path) => path,
});

const sink = (): { readonly write: (chunk: string) => void; readonly text: () => string } => {
  const chunks: string[] = [];
  return {
    write: (chunk) => {
      chunks.push(chunk);
    },
    text: () => chunks.join(""),
  };
};

export const stdinFrom = (text: string): TextSource => Readable.from([text]);

export const silentStdin = (): TextSource => new Readable({ read: () => undefined });

export interface CliOptions {
  readonly env?: Env;
  readonly stdin?: TextSource;
  readonly registry?: readonly CommandSpec[];
  readonly cwd?: AbsolutePath;
  readonly runtime?: Runtime;
  readonly version?: string;
}

export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export const cli = async (argv: readonly string[], options: CliOptions = {}): Promise<CliRun> => {
  const stdout = sink();
  const stderr = sink();
  const code = await run({
    argv,
    env: options.env ?? {},
    cwd: options.cwd ?? toAbsolutePath("/home/ana/project"),
    platform: "linux",
    io: { stdout, stderr, stdin: options.stdin ?? Readable.from([]) },
    version: options.version ?? TEST_VERSION,
    runtime: options.runtime ?? fakeRuntime(),
    ...(options.registry === undefined ? {} : { registry: options.registry }),
  });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
};

export const parseBody = (stdout: string): JsonObject => {
  const parsed = parseJsonObject(stdout);
  if (!parsed.ok) throw new Error(`stdout is not one JSON object: ${parsed.error}\n${stdout}`);
  return parsed.value;
};

export const field = (record: unknown, ...path: readonly string[]): unknown =>
  path.reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), record);

export const cliJson = async (
  argv: readonly string[],
  options: CliOptions = {},
): Promise<CliRun & { readonly body: JsonObject }> => {
  const result = await cli([...argv, "--json"], options);
  return { ...result, body: parseBody(result.stdout) };
};

export interface BundleRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export const bundle = (args: readonly string[], input?: string, env: Env = {}, file: string = BUNDLE): BundleRun => {
  const result = spawnSync(process.execPath, [file, ...args], {
    input,
    encoding: "utf8",
    env: { PATH: process.env["PATH"], SystemRoot: process.env["SystemRoot"], ...env },
    timeout: 20000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

export const fakeCtx = (overrides: Partial<Ctx> = {}): Ctx => {
  const detected = detectLang(undefined, {});
  return {
    lang: detected.lang,
    langSource: detected.source,
    t: createTranslator(detected.lang),
    json: false,
    yes: false,
    dryRun: false,
    cwd: toAbsolutePath("/home/ana/project"),
    env: {},
    platform: "linux",
    version: TEST_VERSION,
    io: { stdout: sink(), stderr: sink(), stdin: Readable.from([]) },
    runtime: fakeRuntime(),
    ...overrides,
  };
};
