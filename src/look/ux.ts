import type { ProbeBox } from "./probe.js";
import type { LookRule } from "./types.js";

export interface UxIssue {
  readonly rule: LookRule;
  readonly selector: string;
  readonly detail: string;
  readonly unverified?: true;
  readonly advisory?: true;
  readonly box?: ProbeBox;
  readonly route?: string;
}

export interface UxPage {
  readonly feature: string;
  readonly route: string;
  readonly viewport: number;
  readonly issues: readonly UxIssue[];
  readonly metrics?: Readonly<Record<string, number>>;
}

export const MAX_ISSUES_PER_RULE = 20;

export const capPerRule = (issues: readonly UxIssue[]): readonly UxIssue[] => {
  const counts = new Map<string, number>();
  return issues.filter((issue) => {
    const seen = counts.get(issue.rule) ?? 0;
    counts.set(issue.rule, seen + 1);
    return seen < MAX_ISSUES_PER_RULE;
  });
};

export const issue = (
  rule: LookRule,
  selector: string,
  detail: string,
  extra: Pick<UxIssue, "unverified" | "advisory" | "box" | "route"> = {},
): UxIssue => ({ rule, selector, detail, ...extra });
