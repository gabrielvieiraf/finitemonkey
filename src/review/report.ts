import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import type { Critique } from "./findings.js";
import { type Checked, REVIEW_LEDGER, settle, type Settled } from "./reproduce.js";

export interface LedgerRow {
  readonly finding: number;
  readonly side: string;
  readonly command: string;
  readonly exitCode: number | null;
}

export const readLedger = (runtime: Runtime, root: AbsolutePath): readonly LedgerRow[] => {
  const raw = runtime.readText(toAbsolutePath(join(root, REVIEW_LEDGER)));
  if (!raw.ok) return [];
  return raw.value.split("\n").flatMap((line) => {
    const parsed = line.trim() === "" ? undefined : parseJsonObject(line);
    if (parsed === undefined || !parsed.ok || !isRecord(parsed.value)) return [];
    const { finding, side, command, exitCode } = parsed.value;
    if (typeof finding !== "number" || typeof side !== "string" || typeof command !== "string") return [];
    return [{ finding, side, command, exitCode: typeof exitCode === "number" ? exitCode : null }];
  });
};

const GROUP_ORDER = ["must", "should", "nice", "already-there", "not-reproduced"] as const;

const resultText = (row: LedgerRow | undefined): string => {
  if (row === undefined) return "-";
  return row.exitCode === null ? "did not run" : `exit ${String(row.exitCode)}`;
};

const findingLines = (t: Translate, settled: readonly Settled[]): readonly string[] =>
  GROUP_ORDER.flatMap((group) => {
    const items = settled.filter((item) => item.group === group);
    if (items.length === 0) return [];
    return [
      "",
      `## ${t(`critique.group.${group}`)}`,
      ...items.map(({ finding }) =>
        t("critique.finding", {
          id: finding.id,
          what: finding.what,
          problem: finding.problem,
          fix: finding.fix,
          risk: finding.ifNotFixed,
        }),
      ),
    ];
  });

const tableLines = (t: Translate, checked: readonly Checked[], ledger: readonly LedgerRow[]): readonly string[] => {
  const rows = checked.filter((item) => item.finding.group === "must");
  if (rows.length === 0) return [];
  const last = (id: number, side: string): LedgerRow | undefined =>
    ledger.filter((row) => row.finding === id && row.side === side).at(-1);
  return [
    "",
    `| # | ${t("critique.table.command")} | base | head | ${t("critique.table.outcome")} |`,
    "|---|---|---|---|---|",
    ...rows.map(
      (item) =>
        `| ${String(item.finding.id)} | \`${item.finding.repro?.command ?? "-"}\` | ${resultText(last(item.finding.id, "base"))} | ${resultText(last(item.finding.id, "head"))} | ${t(`critique.outcome.${item.outcome}`)} |`,
    ),
  ];
};

export const critiqueLines = (
  t: Translate,
  critique: Critique,
  checked: readonly Checked[],
  ledger: readonly LedgerRow[],
): readonly string[] => {
  const settled = checked.map(settle);
  const demoted = critique.findings.filter((finding) => finding.demoted);
  const decisions = settled.filter((item) => item.decisionNeeded);
  return [
    `# ${t("critique.title")}`,
    ...findingLines(t, settled),
    ...tableLines(t, checked, ledger),
    ...demoted.map((finding) => t("critique.demoted", { id: finding.id })),
    ...decisions.map((item) => t("critique.decision", { id: item.finding.id, what: item.finding.what })),
    "",
    t("critique.verdict", { verdict: critique.verdict }),
  ];
};
