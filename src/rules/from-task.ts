import { readLedger } from "../evidence/ledger.js";
import type { Evidence } from "../evidence/types.js";
import { GATE_CHECK } from "../evidence/types.js";
import { noteText } from "../gate/render.js";
import type { Translate } from "../i18n/translate.js";
import type { FmPaths } from "../task/paths.js";
import { classifyStatement } from "./classify.js";
import { type Proposal, slug, uniqueId } from "./propose.js";
import type { ProjectRule } from "./types.js";
import type { Violation } from "./violations.js";

export const MIN_FINDING_REPEATS = 2;
const MAX_FINDINGS = 10;

interface Finding {
  readonly check: string;
  readonly text: string;
}

const findingsOf = (t: Translate, entry: Evidence): readonly Finding[] => {
  const failures = entry.failures ?? [];
  const texts = failures.length > 0 ? failures : entry.notes.map((note) => noteText(t, note));
  return [...new Set(texts.map((text) => text.trim()).filter((text) => text !== ""))].map((text) => ({
    check: entry.check,
    text,
  }));
};

export const repeatedFindings = (
  t: Translate,
  entries: readonly Evidence[],
): readonly { readonly finding: Finding; readonly seen: readonly Evidence[] }[] => {
  const groups = new Map<string, { finding: Finding; seen: Evidence[] }>();
  for (const entry of entries.filter((item) => item.status === "failed" && item.check !== GATE_CHECK)) {
    for (const finding of findingsOf(t, entry)) {
      const key = `${finding.check}\u0000${finding.text}`;
      const group = groups.get(key) ?? { finding, seen: [] };
      group.seen.push(entry);
      groups.set(key, group);
    }
  }
  return [...groups.values()].filter((group) => group.seen.length >= MIN_FINDING_REPEATS).slice(0, MAX_FINDINGS);
};

export const taskProposals = (
  runtime: Parameters<typeof readLedger>[0],
  paths: FmPaths,
  t: Translate,
  task: string,
  rules: readonly ProjectRule[],
): readonly Proposal[] => {
  const taken = new Set(rules.map((rule) => rule.id));
  return repeatedFindings(t, readLedger(runtime, paths.evidence(task))).map(({ finding, seen }) => {
    const text = t("rules.propose.from_task_text", { check: finding.check, finding: finding.text });
    const evidence: readonly Violation[] = seen.map((entry) => ({
      at: entry.at,
      session: "",
      rule: finding.check,
      source: "stop",
      detail: finding.text.slice(0, 200),
    }));
    return {
      kind: "new",
      id: uniqueId(slug(`${finding.check} ${finding.text}`), taken),
      text,
      origin: `task ${task}`,
      ...classifyStatement(text),
      evidence,
    };
  });
};
