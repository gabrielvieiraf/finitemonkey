export const SEVERITIES = ["high", "medium", "warning"] as const;

export type Severity = (typeof SEVERITIES)[number];

export const RULE_KINDS = ["credential", "practice"] as const;

export type RuleKind = (typeof RULE_KINDS)[number];

export interface SecretRule {
  readonly id: string;
  readonly summary: string;
  readonly kind: RuleKind;
  readonly severity: Severity;
  readonly keywords: readonly string[];
  readonly pattern: RegExp;
  readonly minLength: number;
  readonly minEntropy: number;
  readonly requireDigit: boolean;
  readonly minRandomRun: number;
  readonly ignoredNames: readonly string[];
  readonly skipTestPaths: boolean;
  readonly placeholders: boolean;
}

export type RuleSpec = Pick<SecretRule, "id" | "summary" | "keywords"> &
  Partial<Omit<SecretRule, "id" | "summary" | "keywords" | "pattern">> & {
    readonly source: string;
    readonly flags?: string;
  };

export const defineRule = (spec: RuleSpec): SecretRule => ({
  id: spec.id,
  summary: spec.summary,
  kind: spec.kind ?? "credential",
  severity: spec.severity ?? "high",
  keywords: spec.keywords.map((keyword) => keyword.toLowerCase()),
  pattern: new RegExp(spec.source, `gd${spec.flags ?? ""}`),
  minLength: spec.minLength ?? 8,
  minEntropy: spec.minEntropy ?? 0,
  requireDigit: spec.requireDigit ?? false,
  minRandomRun: spec.minRandomRun ?? 0,
  ignoredNames: (spec.ignoredNames ?? []).map((name) => name.toLowerCase()),
  skipTestPaths: spec.skipTestPaths ?? false,
  placeholders: spec.placeholders ?? true,
});

export const isWarning = (finding: { readonly severity: Severity }): boolean => finding.severity === "warning";

export const blocking = <T extends { readonly severity: Severity }>(findings: readonly T[]): readonly T[] =>
  findings.filter((finding) => !isWarning(finding));
