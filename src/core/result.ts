import { ExitCode, type FailureExitCode } from "../exit-codes.js";
import type { Translate } from "../i18n/translate.js";
import type { ErrorCode, Problem } from "./problem.js";

export const SCHEMA_VERSION = 1;

export interface ResultError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly fix: string;
}

export interface RawOutput {
  readonly stdout: string;
  readonly stderr: string;
}

interface ResultBase {
  readonly human?: readonly string[];
  readonly next?: string;
  readonly raw?: RawOutput;
}

export interface SuccessResult<TData = unknown> extends ResultBase {
  readonly ok: true;
  readonly exitCode: typeof ExitCode.Ok;
  readonly data: TData;
}

export interface FailureResult<TData = unknown> extends ResultBase {
  readonly ok: false;
  readonly exitCode: FailureExitCode;
  readonly error: ResultError;
  readonly data?: TData;
}

export type CommandResult<TData = unknown> = SuccessResult<TData> | FailureResult<TData>;

export interface Envelope {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly ok: boolean;
  readonly command: string;
  readonly data?: unknown;
  readonly error?: ResultError;
  readonly next?: string;
}

export const success = <TData>(data: TData, human: readonly string[] = []): SuccessResult<TData> => ({
  ok: true,
  exitCode: ExitCode.Ok,
  data,
  human,
});

export const failureFrom = <TData = never>(
  t: Translate,
  problem: Problem<TData>,
  human?: readonly string[],
): FailureResult<TData> => ({
  ok: false,
  exitCode: problem.exitCode,
  error: { code: problem.code, message: t(problem.messageKey, problem.params), fix: problem.fix },
  ...(problem.data === undefined ? {} : { data: problem.data }),
  ...(human === undefined ? {} : { human }),
});

export const toEnvelope = (command: string, result: CommandResult): Envelope => ({
  schemaVersion: SCHEMA_VERSION,
  ok: result.ok,
  command,
  ...(result.data === undefined ? {} : { data: result.data }),
  ...(result.ok ? {} : { error: result.error }),
  ...(result.next === undefined ? {} : { next: result.next }),
});
