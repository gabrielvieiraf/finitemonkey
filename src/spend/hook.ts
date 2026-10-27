import { allowWith, contextOutput, human, projectPaths } from "../gate/hooks/common.js";
import type { HookHandler } from "../hooks/handlers.js";
import type { Translate } from "../i18n/translate.js";
import { money, type ScopeSpend } from "./budget.js";
import { blocksNewTask, budgetConfigured, budgetStatus } from "./status.js";

export const spendLine = (t: Translate, spends: readonly ScopeSpend[]): string =>
  spends
    .filter((item) => item.limit !== undefined)
    .map((item) => t(`budget.scope.${item.scope}`, { spent: money(item.spent), limit: money(item.limit ?? 0) }))
    .join(", ");

export const budgetPrompt: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined || !budgetConfigured(input.runtime, paths)) return { kind: "allow" };
  const status = budgetStatus({
    runtime: input.runtime,
    paths,
    env: input.env,
    sessionId: input.payload.sessionId,
    refresh: true,
  });
  if (!status.configured || status.level === "ok") return { kind: "allow" };
  const line = spendLine(input.t, status.spends);
  const key = blocksNewTask(status) ? "budget.over" : status.level === "over" ? "budget.released" : "budget.warn";
  const text = input.t(key, { spend: line });
  return allowWith(contextOutput("UserPromptSubmit", text, human(text)));
};
