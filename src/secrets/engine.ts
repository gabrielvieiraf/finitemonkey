import { isPlaceholder, isTestOrLockPath } from "./allowlist.js";
import { shannonEntropy } from "./entropy.js";
import { fingerprintOf, tailOf } from "./fingerprint.js";
import { lineLocator, type Locate } from "./lines.js";
import { RULES } from "./rules/catalog.js";
import type { SecretRule, Severity } from "./rules/types.js";

export interface SecretFinding {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly line: number;
  readonly column: number;
  readonly start: number;
  readonly end: number;
  readonly fingerprint: string;
  readonly tail: string;
}

export interface ScanOptions {
  readonly rules?: readonly SecretRule[];
  readonly path?: string;
}

interface Span {
  readonly rule: SecretRule;
  readonly start: number;
  readonly end: number;
  readonly secret: string;
}

const DIGIT = /[0-9]/;
const LETTER = /[A-Za-z]/;
const RUN_ENTROPY = 3;

const hasRandomRun = (secret: string, length: number): boolean =>
  (secret.match(new RegExp(`[A-Za-z0-9]{${String(length)},}`, "g")) ?? []).some(
    (run) => DIGIT.test(run) && LETTER.test(run) && shannonEntropy(run) >= RUN_ENTROPY,
  );

const accepted = (rule: SecretRule, secret: string): boolean =>
  secret.length >= rule.minLength &&
  (!rule.requireDigit || DIGIT.test(secret)) &&
  (rule.minRandomRun === 0 || hasRandomRun(secret, rule.minRandomRun)) &&
  (!rule.placeholders || !isPlaceholder(secret)) &&
  (rule.minEntropy === 0 || shannonEntropy(secret) >= rule.minEntropy);

const NAME_CHAR = /[A-Za-z0-9_.-]/;

const nameAround = (text: string, at: number): string => {
  let start = at;
  while (start > 0 && NAME_CHAR.test(text.charAt(start - 1))) start -= 1;
  let end = at;
  while (end < text.length && NAME_CHAR.test(text.charAt(end))) end += 1;
  return text.slice(start, end).toLowerCase();
};

const ignoredName = (rule: SecretRule, match: RegExpExecArray): boolean =>
  rule.ignoredNames.length > 0 && rule.ignoredNames.includes(nameAround(match.input, match.index));

const spanOf = (rule: SecretRule, match: RegExpExecArray): Span | undefined => {
  const range = match.indices?.groups?.["secret"] ?? match.indices?.[0];
  if (range === undefined || ignoredName(rule, match)) return undefined;
  const [start, end] = range;
  const secret = match.input.slice(start, end);
  return accepted(rule, secret) ? { rule, start, end, secret } : undefined;
};

const ruleSpans = (rule: SecretRule, text: string): Span[] => {
  const spans: Span[] = [];
  for (const match of text.matchAll(rule.pattern)) {
    const span = spanOf(rule, match);
    if (span !== undefined) spans.push(span);
  }
  return spans;
};

const overlaps = (taken: readonly Span[], span: Span): boolean =>
  taken.some((other) => span.start < other.end && other.start < span.end);

const applicable = (rules: readonly SecretRule[], lower: string, path: string | undefined): SecretRule[] => {
  const testPath = isTestOrLockPath(path);
  return rules.filter(
    (rule) => !(testPath && rule.skipTestPaths) && rule.keywords.some((keyword) => lower.includes(keyword)),
  );
};

const toFinding = (span: Span, locate: Locate): SecretFinding => {
  const position = locate(span.start);
  return {
    ruleId: span.rule.id,
    severity: span.rule.severity,
    line: position.line,
    column: position.column,
    start: span.start,
    end: span.end,
    fingerprint: fingerprintOf(span.secret),
    tail: tailOf(span.secret),
  };
};

export const scanText = (text: string, options: ScanOptions = {}): readonly SecretFinding[] => {
  if (text.length === 0) return [];
  const rules = applicable(options.rules ?? RULES, text.toLowerCase(), options.path);
  if (rules.length === 0) return [];
  const taken: Span[] = [];
  for (const rule of rules) {
    for (const span of ruleSpans(rule, text)) if (!overlaps(taken, span)) taken.push(span);
  }
  if (taken.length === 0) return [];
  const locate = lineLocator(text);
  return taken.sort((a, b) => a.start - b.start).map((span) => toFinding(span, locate));
};
