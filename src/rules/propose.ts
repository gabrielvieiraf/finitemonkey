import { SAME_RULE_SIMILARITY } from "../instructions/findings.js";
import { proseLines } from "../instructions/parse.js";
import { similarity, type Statement, statementOf } from "../instructions/statements.js";
import type { Inventory } from "../instructions/types.js";
import { classifyStatement, isRuleLike, type ProposedDetector } from "./classify.js";
import { AGENTS_MARKERS } from "./outputs.js";
import type { ProjectRule, RuleBucket, RuleScope, RuleSeverity } from "./types.js";
import type { Violation } from "./violations.js";

export const DEFAULT_PROMOTE_AFTER = 3;
export const DETERMINISTIC_CEILING = 20;
const MAX_ID = 48;
const ID_WORDS = 6;

export interface Proposal {
  readonly kind: "new" | "promote";
  readonly id: string;
  readonly text: string;
  readonly origin: string;
  readonly severity: RuleSeverity;
  readonly bucket: RuleBucket;
  readonly detector: ProposedDetector | undefined;
  readonly scope: RuleScope;
  readonly evidence: readonly Violation[];
}

const sentences = (text: string): readonly string[] => {
  const parts = text.split(/(?<=[.!?;])\s+(?=\S)/).map((part) => part.trim());
  return parts.every((part) => part.split(/\s+/).length >= 4) ? parts : [text];
};

const statementsIn = (file: string, text: string): readonly Statement[] => {
  let managed = false;
  return proseLines(text).flatMap(({ line, text: raw }) => {
    if (raw.includes(AGENTS_MARKERS.begin)) managed = true;
    if (raw.includes(AGENTS_MARKERS.end)) managed = false;
    if (managed) return [];
    return sentences(raw).flatMap((part) => {
      const statement = statementOf(file, line, part);
      return statement === undefined || !isRuleLike(statement.text) ? [] : [statement];
    });
  });
};

export const slug = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/`[^`]*`/g, (span) => span.replace(/[^a-z0-9]+/g, " "))
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "")
    .slice(0, ID_WORDS)
    .join("-")
    .slice(0, MAX_ID)
    .replace(/-+$/, "");

const uniqueId = (wanted: string, taken: Set<string>): string => {
  const base = wanted === "" ? "rule" : wanted;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${String(n)}`;
  taken.add(id);
  return id;
};

const known = (rules: readonly ProjectRule[], statement: Statement): boolean =>
  rules.some((rule) => {
    const other = statementOf("", 0, rule.text);
    return other !== undefined && similarity(statement, other) >= SAME_RULE_SIMILARITY;
  });

const newProposals = (inventory: Inventory, rules: readonly ProjectRule[], taken: Set<string>): Proposal[] => {
  const kept: Statement[] = [];
  const proposals: Proposal[] = [];
  for (const file of inventory.files.filter((item) => item.layer !== "managed")) {
    for (const statement of statementsIn(file.display, file.text)) {
      if (known(rules, statement) || kept.some((other) => similarity(statement, other) >= SAME_RULE_SIMILARITY))
        continue;
      kept.push(statement);
      proposals.push({
        kind: "new",
        id: uniqueId(slug(statement.text), taken),
        text: statement.text,
        origin: `${statement.file}:${String(statement.line)}`,
        ...classifyStatement(statement.text),
        evidence: [],
      });
    }
  }
  return proposals;
};

const promotions = (
  rules: readonly ProjectRule[],
  violations: readonly Violation[],
  promoteAfter: number,
): readonly Proposal[] =>
  rules.flatMap((rule): readonly Proposal[] => {
    const evidence = violations.filter((violation) => violation.rule === rule.id);
    if (rule.bucket !== "reminder" || evidence.length < promoteAfter) return [];
    const classified = classifyStatement(rule.text);
    return [
      {
        kind: "promote",
        id: rule.id,
        text: rule.text,
        origin: rule.origin,
        severity: rule.severity,
        bucket: classified.bucket === "reminder" ? "deterministic" : classified.bucket,
        detector: classified.detector,
        scope: rule.scope,
        evidence,
      },
    ];
  });

export const buildProposals = (
  inventory: Inventory,
  rules: readonly ProjectRule[],
  violations: readonly Violation[],
  promoteAfter: number = DEFAULT_PROMOTE_AFTER,
): readonly Proposal[] => {
  const taken = new Set(rules.map((rule) => rule.id));
  return [...promotions(rules, violations, promoteAfter), ...newProposals(inventory, rules, taken)];
};

export const confirmable = (proposal: Proposal): boolean => proposal.kind === "new" || proposal.detector !== undefined;
