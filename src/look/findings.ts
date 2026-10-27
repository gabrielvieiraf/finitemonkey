import type { LookAllow } from "./config.js";
import type { PageResult } from "./node-capture.js";
import { BLOCKING_RULES, type LookFinding, type LookRule } from "./types.js";

const MAX_PER_RULE = 5;

const finding = (result: PageResult, rule: LookRule, detail: string): LookFinding => ({
  rule,
  route: result.route,
  viewport: result.viewport,
  detail,
  blocking: BLOCKING_RULES.includes(rule),
});

const many = (result: PageResult, rule: LookRule, items: readonly string[]): readonly LookFinding[] =>
  items.slice(0, MAX_PER_RULE).map((item) => finding(result, rule, item));

export const pageFindings = (result: PageResult): readonly LookFinding[] => {
  if (result.loadError !== undefined) return [finding(result, "look/request-failed", result.loadError)];
  const measure = result.measure;
  return [
    ...(measure !== undefined && measure.overflow > 0
      ? [finding(result, "look/overflow", `${String(measure.overflow)}px wider than the viewport`)]
      : []),
    ...many(result, "look/console-error", result.consoleErrors),
    ...many(result, "look/request-failed", result.failedRequests),
    ...many(result, "look/i18n-key", measure?.keys ?? []),
    ...many(result, "look/broken-image", measure?.broken ?? []),
    ...many(result, "look/touch-target", measure?.small ?? []),
  ];
};

export interface AllowOutcome {
  readonly findings: readonly LookFinding[];
  readonly ignored: readonly string[];
}

export const applyAllows = (
  findings: readonly LookFinding[],
  allows: readonly LookAllow[],
  decided: (decision: string) => boolean,
): AllowOutcome => {
  const accepted = allows.filter((allow) => decided(allow.decision));
  const ignored = allows
    .filter((allow) => !decided(allow.decision))
    .map((allow) => `${allow.rule} ${allow.route} ${allow.decision}`);
  return {
    ignored,
    findings: findings.map((item) => {
      const allow = accepted.find((entry) => entry.rule === item.rule && entry.route === item.route);
      return allow === undefined ? item : { ...item, blocking: false, allowedBy: allow.decision };
    }),
  };
};
