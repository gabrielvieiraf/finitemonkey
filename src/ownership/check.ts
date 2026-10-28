import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { planPath } from "../plan/folder.js";
import { MASTER_FILE } from "../plan/reports.js";
import { masterSectionOf, sectionsOf } from "../plan/sections.js";
import { tableRows } from "../plan/table.js";
import type { Component } from "./file.js";

export interface Responsibility {
  readonly name: string;
  readonly owner: string;
  readonly line: number;
}

export const OWNERSHIP_PROBLEMS = ["no_owner", "unknown_name", "two_owners"] as const;

export type OwnershipProblemKind = (typeof OWNERSHIP_PROBLEMS)[number];

export interface OwnershipProblem {
  readonly kind: OwnershipProblemKind;
  readonly component: string;
  readonly detail: string;
}

export const keyOf = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

export const responsibilitiesOf = (master: string): readonly Responsibility[] =>
  sectionsOf(master)
    .filter((section) => masterSectionOf(section.heading) === "responsibilities")
    .flatMap((section) => tableRows(section.lines))
    .map((row) => ({ name: row.cells[0] ?? "", owner: row.cells[1] ?? "", line: row.line }))
    .filter((row) => row.name !== "");

export const readVocabulary = (
  runtime: Pick<Runtime, "readText">,
  root: AbsolutePath,
): readonly Responsibility[] | undefined => {
  const master = runtime.readText(planPath(root, MASTER_FILE));
  return master.ok ? responsibilitiesOf(master.value) : undefined;
};

const twoOwners = (components: readonly Component[]): readonly OwnershipProblem[] => {
  const first = new Map<string, Component>();
  return components.flatMap((component) => {
    const key = keyOf(component.name);
    const seen = first.get(key);
    if (seen === undefined) first.set(key, component);
    if (seen === undefined || seen.owner === component.owner || component.owner === "") return [];
    return [{ kind: "two_owners", component: component.name, detail: `${seen.owner}, ${component.owner}` }];
  });
};

export const ownershipProblems = (
  components: readonly Component[],
  vocabulary: readonly Responsibility[] | undefined,
): readonly OwnershipProblem[] => {
  const known = new Set((vocabulary ?? []).map((item) => keyOf(item.name)));
  const named = components.map((component) => (component.name === "" ? { ...component, name: "?" } : component));
  return [
    ...named
      .filter((component) => component.owner === "")
      .map((component) => ({ kind: "no_owner" as const, component: component.name, detail: component.type })),
    ...(vocabulary === undefined || vocabulary.length === 0
      ? []
      : named
          .filter((component) => !known.has(keyOf(component.name)))
          .map((component) => ({ kind: "unknown_name" as const, component: component.name, detail: component.type }))),
    ...twoOwners(named),
  ];
};
