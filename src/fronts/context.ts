import { basename, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { contractFacts } from "../gate/hooks/subagent.js";
import type { Translate } from "../i18n/translate.js";
import { parseContract } from "../task/load.js";
import { BRIEFING_FILE } from "./brief.js";
import type { Front } from "./state.js";

const contractLines = (t: Translate, runtime: Runtime, root: AbsolutePath, file: string | null): readonly string[] => {
  if (file === null) return [];
  const text = runtime.readText(toAbsolutePath(join(root, file)));
  if (!text.ok) return [t("fronts.context.contract_missing", { file })];
  const parsed = parseContract(basename(file).replace(/\.ya?ml$/, ""), text.value);
  return parsed.ok ? [contractFacts(t, parsed.value, false)] : [t("fronts.context.contract", { file })];
};

export const frontContext = (t: Translate, runtime: Runtime, root: AbsolutePath, front: Front): string =>
  [
    t("fronts.context.front", {
      id: front.id,
      goal: front.goal,
      path: front.path ?? "-",
      branch: front.branch ?? "-",
      port: front.port === null ? "-" : String(front.port),
      prefix: front.shotsPrefix ?? "-",
    }),
    t("fronts.context.scope", {
      paths: front.paths.join(", ") || "-",
      append: front.append.join(", ") || "-",
      ns: front.i18nNs ?? "-",
    }),
    ...contractLines(t, runtime, root, front.contract),
    ...front.inbox.map((item) => t("fronts.context.inbox", { at: item.at, text: item.text })),
    t("fronts.context.report", { id: front.id, briefing: BRIEFING_FILE }),
  ].join("\n");
