import type { Finding } from "../findings/baseline.js";

export const APPSEC_CHECK = "appsec";

export const OWASP = {
  A01: "A01:2021 Broken Access Control",
  A03: "A03:2021 Injection",
  A05: "A05:2021 Security Misconfiguration",
  A07: "A07:2021 Identification and Authentication Failures",
  A08: "A08:2021 Software and Data Integrity Failures",
  A10: "A10:2021 Server-Side Request Forgery",
} as const;

export type OwaspId = keyof typeof OWASP;

export const APPSEC_RULES = [
  "route-auth",
  "owner-filter",
  "webhook-signature",
  "webhook-replay",
  "ssrf",
  "cors-credentials",
  "rate-limit",
  "sql-concat",
] as const;

export type AppsecRule = (typeof APPSEC_RULES)[number];

export const RULE_OWASP: Readonly<Record<AppsecRule, OwaspId>> = {
  "route-auth": "A01",
  "owner-filter": "A01",
  "webhook-signature": "A08",
  "webhook-replay": "A08",
  ssrf: "A10",
  "cors-credentials": "A05",
  "rate-limit": "A07",
  "sql-concat": "A03",
};

export interface AppsecFinding extends Finding {
  readonly rule: AppsecRule;
  readonly owasp: OwaspId;
  readonly detail: string;
}

export interface RuleHit {
  readonly rule: AppsecRule;
  readonly line: number;
  readonly detail: string;
}

export interface ScanContext {
  readonly guards: readonly string[];
  readonly publicRoutes: ReadonlySet<string>;
}
