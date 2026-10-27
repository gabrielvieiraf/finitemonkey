import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { PLAN_DIR, planPath } from "../plan/folder.js";
import { PARITY_FILE, parseParity } from "./table.js";

export const PARITY_ISSUES = [
  "no_matrix",
  "no_destination",
  "no_test",
  "not_green",
  "removed_without_decision",
] as const;

export type ParityIssueKind = (typeof PARITY_ISSUES)[number];

export interface ParityIssue {
  readonly kind: ParityIssueKind;
  readonly line: number;
  readonly detail: string;
}

export interface ParityChecked {
  readonly file: string;
  readonly rows: number;
  readonly issues: readonly ParityIssue[];
}

const DECISION = /(^|\/)\d{2,}-decision-[^/]+\.md$/;

export const checkParity = (runtime: Runtime, root: AbsolutePath): ParityChecked => {
  const file = `${PLAN_DIR}/${PARITY_FILE}`;
  const text = runtime.readText(planPath(root, PARITY_FILE));
  if (!text.ok) return { file, rows: 0, issues: [{ kind: "no_matrix", line: 1, detail: file }] };
  const rows = parseParity(text.value);
  const issues = rows.flatMap((row, index): readonly ParityIssue[] => {
    const line = index + 2;
    const label = `${row.id} ${row.capability}`;
    if (row.destination === "") return [{ kind: "no_destination", line, detail: label }];
    if (row.destination.toLowerCase() === "removed") {
      const decision = row.decision.replace(/^docs\/plan\//, "");
      const linked = DECISION.test(row.decision) && runtime.readText(planPath(root, decision)).ok;
      return linked ? [] : [{ kind: "removed_without_decision", line, detail: label }];
    }
    if (row.parityTest === "") return [{ kind: "no_test", line, detail: label }];
    return row.state.toLowerCase() === "green"
      ? []
      : [{ kind: "not_green", line, detail: `${label} (${row.state || "-"})` }];
  });
  return { file, rows: rows.length, issues };
};
