import type { Translate } from "../../i18n/translate.js";
import type { SecretFinding } from "../engine.js";

const MAX_LISTED = 5;

export interface Located {
  readonly ruleId: string;
  readonly where: string;
}

export const describeFindings = (t: Translate, items: readonly Located[]): string => {
  const listed = items
    .slice(0, MAX_LISTED)
    .map(({ ruleId, where }) => t("secrets.found_item", { rule: ruleId, where }));
  const rest = items.length - listed.length;
  return rest > 0 ? `${listed.join("; ")}; ${t("secrets.found_more", { count: rest })}` : listed.join("; ");
};

export const lineWhere = (t: Translate, finding: Pick<SecretFinding, "line" | "column">): string =>
  t("secrets.where.line", { line: finding.line, column: finding.column });
