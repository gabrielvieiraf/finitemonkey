import type { Translate } from "../i18n/translate.js";
import type { Change, DsSummary, Section } from "./summary.js";

const SECTIONS = ["tokens", "classes", "components", "assets"] as const;
const SHOWN = 60;

const value = (text: string | undefined): string => {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
  return trimmed.length > SHOWN ? `${trimmed.slice(0, SHOWN)}…` : trimmed;
};

const rows = (t: Translate, section: Section, withValues: boolean): readonly string[] => [
  ...section.added.map((item: Change) =>
    withValues
      ? `- ${t("ds.summary.added_value", { name: item.name, after: value(item.after) })}`
      : `- ${t("ds.summary.added", { name: item.name })}`,
  ),
  ...section.changed.map((item) =>
    withValues
      ? `- ${t("ds.summary.changed_value", { name: item.name, before: value(item.before), after: value(item.after) })}`
      : `- ${t("ds.summary.changed", { name: item.name })}`,
  ),
  ...section.removed.map((item) => `- ${t("ds.summary.removed", { name: item.name })}`),
];

export const renderSummary = (t: Translate, summary: DsSummary): string => {
  const parts = SECTIONS.flatMap((name) => {
    const lines = rows(t, summary[name], name === "tokens");
    return [`### ${t(`ds.summary.${name}`)}`, "", ...(lines.length === 0 ? [t("ds.summary.none")] : lines), ""];
  });
  const fresh = summary.components.added.map((item) => `- [ ] ${t("ds.summary.check_item", { name: item.name })}`);
  return [
    `## ${t("ds.summary.title")}`,
    "",
    ...parts,
    ...(fresh.length === 0 ? [] : [`### ${t("ds.summary.checklist")}`, "", ...fresh, ""]),
  ].join("\n");
};
