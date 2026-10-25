export const ExitCode = {
  Ok: 0,
  CheckFailed: 1,
  Usage: 2,
  Environment: 3,
  Internal: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export type FailureExitCode = Exclude<ExitCodeValue, typeof ExitCode.Ok>;

export const exitCodeDocs = {
  0: "ok: the command did what it was asked",
  1: "check failed: the command ran and found a problem (doctor, i18n check, gate)",
  2: "usage error: unknown command, unknown flag, bad value or command not available yet",
  3: "environment error: something outside finitemonkey is missing or broken (node, git, files, permissions)",
  4: "internal error: finitemonkey itself failed; report it",
} as const satisfies Record<ExitCodeValue, string>;
