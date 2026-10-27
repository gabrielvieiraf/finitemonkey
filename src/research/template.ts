import type { Translate } from "../i18n/translate.js";
import { writeFront } from "../plan/front.js";
import { table } from "../plan/markdown.js";
import { RESEARCH_SCHEMA, RESEARCH_SECTIONS, researchKey, type ResearchSection } from "./sections.js";

const bodies = (t: Translate): Partial<Record<ResearchSection, readonly string[]>> => ({
  not_read: [t("research.hint.not_read")],
  not_verified: [t("research.hint.not_verified")],
  sources: [t("research.hint.sources"), "", ...table(["ID", "Source", "URL", "Accessed", "Kind", "Version"], [])],
  findings: [t("research.hint.findings"), "", ...table(["Finding", "Strength", "Sources"], [])],
  versions: [t("research.hint.versions"), "", ...table(["Library", "Version", "Checked in", "Date"], [])],
});

export const renderResearch = (t: Translate, topic: string, date: string): string => {
  const filled = bodies(t);
  const body = [
    `# ${t("research.title", { topic })}`,
    "",
    ...RESEARCH_SECTIONS.flatMap((id) => [`## ${t(researchKey(id))}`, "", ...(filled[id] ?? []), ""]),
  ].join("\n");
  return writeFront({ schema: RESEARCH_SCHEMA, topic, date }, body);
};
