import type { ErrorCode } from "../core/problem.js";
import { type CommandResult, success } from "../core/result.js";
import { ExitCode } from "../exit-codes.js";
import type { Translate } from "../i18n/translate.js";
import { failing, type HookCheck } from "./checks.js";

const MAX_LISTED = 5;

const detailOf = (check: HookCheck): string => {
  const listed = check.failures.slice(0, MAX_LISTED).join("; ");
  const rest = check.failures.length - MAX_LISTED;
  return rest > 0 ? `${listed}; +${String(rest)}` : listed;
};

export const checkLine = (t: Translate, check: HookCheck): string =>
  check.failures.length === 0
    ? t("githooks.pass", { check: check.id })
    : t("githooks.fail", { check: check.id, detail: detailOf(check), fix: check.fix });

export interface ChecksData {
  readonly schema: string;
  readonly checks: readonly HookCheck[];
}

export const checksResult = (
  t: Translate,
  schema: string,
  code: ErrorCode,
  checks: readonly HookCheck[],
): CommandResult<ChecksData> => {
  const data = { schema, checks };
  const bad = failing(checks);
  const human = bad.length === 0 ? checks.map((check) => checkLine(t, check)) : bad.map((check) => checkLine(t, check));
  if (bad.length === 0) return success(data, human);
  const [first] = bad;
  return {
    ok: false,
    exitCode: ExitCode.CheckFailed,
    data,
    human,
    error: {
      code,
      message: t("githooks.error.failed", { count: bad.length }),
      fix: first?.fix ?? "",
    },
  };
};
