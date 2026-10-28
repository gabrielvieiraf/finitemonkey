import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import type { PlanIssue } from "../plan/rules.js";
import { keyOf, ownershipProblems, type Responsibility } from "./check.js";
import { readOwnership } from "./file.js";

export const ownershipPlanIssues = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
  master: string,
  vocabulary: readonly Responsibility[],
): readonly PlanIssue[] => {
  const ownership = readOwnership(runtime, root);
  if (ownership?.ok !== true) return [];
  const { file, components } = ownership.value;
  const byName = new Map(components.map((component) => [keyOf(component.name), component]));
  const gaps = vocabulary
    .filter((item) => !byName.has(keyOf(item.name)))
    .map((item): PlanIssue => ({ kind: "ownership_gap", file: master, line: item.line, detail: item.name }));
  const differs = vocabulary.flatMap((item): PlanIssue[] => {
    const owner = byName.get(keyOf(item.name))?.owner ?? "";
    return owner === "" || item.owner === "" || keyOf(owner) === keyOf(item.owner)
      ? []
      : [{ kind: "ownership_overlap", file, line: 1, detail: `${item.name}: ${item.owner}, ${owner}` }];
  });
  const doubled = ownershipProblems(components, undefined)
    .filter((problem) => problem.kind === "two_owners")
    .map((problem): PlanIssue => ({
      kind: "ownership_overlap",
      file,
      line: 1,
      detail: `${problem.component}: ${problem.detail}`,
    }));
  return [...gaps, ...differs, ...doubled];
};
