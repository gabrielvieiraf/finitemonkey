import type { MessageKey } from "./i18n/catalogs.js";

export const ExitCode = {
  Ok: 0,
  CheckFailed: 1,
  Usage: 2,
  NotConfigured: 3,
  NeedsPerson: 4,
  Internal: 5,
} as const;

export type ExitCodeName = keyof typeof ExitCode;

export const EXIT_CODE_NAMES = [
  "Ok",
  "CheckFailed",
  "Usage",
  "NotConfigured",
  "NeedsPerson",
  "Internal",
] as const satisfies readonly ExitCodeName[];

export type ExitCodeValue = (typeof ExitCode)[ExitCodeName];

export type FailureExitCode = Exclude<ExitCodeValue, typeof ExitCode.Ok>;

export const exitCodeDocs = {
  0: "exit.ok",
  1: "exit.check_failed",
  2: "exit.usage",
  3: "exit.not_configured",
  4: "exit.needs_person",
  5: "exit.internal",
} as const satisfies Readonly<Record<ExitCodeValue, MessageKey>>;
