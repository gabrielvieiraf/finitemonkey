import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, configList, loadProjectConfig } from "../git/project-config.js";

export const CLI_UX_FEATURE = "cli-ux";
export const DEFAULT_FIRST_OUTPUT_MS = 100;
export const DEFAULT_RUNS = 5;
export const DEFAULT_TIMEOUT_MS = 10_000;

export interface CliConfig {
  readonly bin: readonly string[];
  readonly errors: readonly (readonly string[])[];
  readonly json: readonly (readonly string[])[];
  readonly destructive: readonly (readonly string[])[];
  readonly firstOutputMs: number;
  readonly runs: number;
  readonly timeoutMs: number;
}

export interface CliRun {
  readonly args: readonly string[];
  readonly found: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

export interface CliRuns {
  readonly help: CliRun;
  readonly errors: readonly CliRun[];
  readonly json: readonly CliRun[];
  readonly destructive: readonly CliRun[];
  readonly timings: readonly number[];
}

export type CliFinding =
  | { readonly kind: "help_no_example"; readonly command: string }
  | { readonly kind: "error_exit_zero"; readonly command: string }
  | { readonly kind: "error_on_stdout"; readonly command: string }
  | { readonly kind: "json_invalid"; readonly command: string }
  | { readonly kind: "ansi_with_no_color"; readonly command: string }
  | { readonly kind: "prompt_without_tty"; readonly command: string }
  | { readonly kind: "timed_out"; readonly command: string; readonly limit: number }
  | { readonly kind: "destructive_unguarded"; readonly command: string }
  | { readonly kind: "slow_first_output"; readonly median: number; readonly limit: number };

const words = (text: string): readonly string[] => text.split(/\s+/).filter((word) => word !== "");

const positive = (raw: unknown, fallback: number): number => {
  const parsed = typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const loadCliConfig = (runtime: Runtime, root: AbsolutePath): CliConfig | undefined => {
  const tree = loadProjectConfig(runtime, root);
  const bin = configAt(tree, "cli", "bin");
  if (typeof bin !== "string" || words(bin).length === 0) return undefined;
  const lines = (key: string): readonly (readonly string[])[] =>
    configList(tree, "cli", key)
      .map(words)
      .filter((args) => args.length > 0);
  return {
    bin: words(bin),
    errors: lines("errors"),
    json: lines("json"),
    destructive: lines("destructive"),
    firstOutputMs: positive(configAt(tree, "cli", "first_output_ms"), DEFAULT_FIRST_OUTPUT_MS),
    runs: Math.round(positive(configAt(tree, "cli", "runs"), DEFAULT_RUNS)),
    timeoutMs: positive(configAt(tree, "cli", "timeout_ms"), DEFAULT_TIMEOUT_MS),
  };
};

const EXAMPLE = /^\s*(?:examples?|exemplos?|ejemplos?)\s*:|^\s*\$\s+\S/im;
const ANSI = "\u001b[";
const PROMPT = /(?:\[(?:y\/n|y\/N|Y\/n)\]|\(y\/n\)|\?)\s*$/;
const GUARD = /--force\b|--yes\b|(?:^|\s)-y\b|\bconfirm/i;

const shown = (run: CliRun): string => run.args.join(" ");

const lastLine = (run: CliRun): string =>
  `${run.stdout}\n${run.stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1) ?? "";

const parses = (text: string): boolean => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const everyRun = (runs: CliRuns): readonly CliRun[] => [runs.help, ...runs.errors, ...runs.json, ...runs.destructive];

export const cliFindings = (runs: CliRuns, limitMs: number, timeoutMs = DEFAULT_TIMEOUT_MS): readonly CliFinding[] => {
  const all = everyRun(runs);
  const help: readonly CliFinding[] = EXAMPLE.test(`${runs.help.stdout}\n${runs.help.stderr}`)
    ? []
    : [{ kind: "help_no_example", command: shown(runs.help) }];
  const errors = runs.errors.flatMap((run): CliFinding[] => [
    ...(run.exitCode === 0 ? [{ kind: "error_exit_zero" as const, command: shown(run) }] : []),
    ...(run.stderr.trim() === "" && run.stdout.trim() !== ""
      ? [{ kind: "error_on_stdout" as const, command: shown(run) }]
      : []),
  ]);
  const json = runs.json
    .filter((run) => !parses(run.stdout))
    .map((run): CliFinding => ({ kind: "json_invalid", command: shown(run) }));
  const ansi = all
    .filter((run) => run.stdout.includes(ANSI) || run.stderr.includes(ANSI))
    .map((run): CliFinding => ({ kind: "ansi_with_no_color", command: shown(run) }));
  const prompts = all
    .filter((run) => !run.timedOut && PROMPT.test(lastLine(run)))
    .map((run): CliFinding => ({ kind: "prompt_without_tty", command: shown(run) }));
  const timedOut = all
    .filter((run) => run.timedOut)
    .map((run): CliFinding => ({ kind: "timed_out", command: shown(run), limit: timeoutMs }));
  const destructive = runs.destructive
    .filter((run) => !GUARD.test(`${run.stdout}\n${run.stderr}`))
    .map((run): CliFinding => ({ kind: "destructive_unguarded", command: shown(run) }));
  const middle = median(runs.timings);
  const slow: readonly CliFinding[] =
    runs.timings.length > 0 && middle > limitMs
      ? [{ kind: "slow_first_output", median: Math.round(middle), limit: limitMs }]
      : [];
  return [...help, ...errors, ...json, ...ansi, ...prompts, ...timedOut, ...destructive, ...slow];
};
