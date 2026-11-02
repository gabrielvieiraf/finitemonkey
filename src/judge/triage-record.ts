import type { Runtime } from "../core/runtime.js";
import { recordPath } from "../knowledge/decision-record.js";
import type { FmPaths } from "../task/paths.js";
import type { XrayRow } from "./response.js";
import { raiseTriage } from "./triage-raise.js";
import { decisionRows, researchRows } from "./triage-triggers.js";

type Rt = Pick<Runtime, "readText" | "homeDir" | "appendText" | "now" | "mkdir">;

export const triageRecord = (runtime: Rt, paths: FmPaths, task: string): readonly XrayRow[] => {
  const text = runtime.readText(recordPath(paths, task));
  return text.ok
    ? raiseTriage(runtime, paths, { task, trigger: "decision", pick: (entries) => decisionRows(entries, text.value) })
    : [];
};

export const triageResearch = (
  runtime: Rt,
  paths: FmPaths,
  task: string,
  research: { readonly slug: string; readonly claims: readonly string[] },
): readonly XrayRow[] =>
  raiseTriage(runtime, paths, {
    task,
    trigger: "research",
    pick: (entries) => researchRows(entries, research.slug, research.claims),
  });
