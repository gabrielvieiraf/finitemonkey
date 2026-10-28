import type { AddedLine } from "../gate/git.js";
import { isTestFile } from "../guards/tests/patterns.js";

export interface Mutant {
  readonly file: string;
  readonly line: number;
  readonly operator: string;
  readonly original: string;
  readonly mutated: string;
}

interface Swap {
  readonly from: RegExp;
  readonly to: string;
  readonly label: string;
}

const JS_SOURCE = /\.(?:[cm]?[jt]sx?)$/;

const SHARED: readonly Swap[] = [
  { from: / === /, to: " !== ", label: "=== → !==" },
  { from: / !== /, to: " === ", label: "!== → ===" },
  { from: / == /, to: " != ", label: "== → !=" },
  { from: / != /, to: " == ", label: "!= → ==" },
  { from: / <= /, to: " > ", label: "<= → >" },
  { from: / >= /, to: " < ", label: ">= → <" },
  { from: / < /, to: " >= ", label: "< → >=" },
  { from: / > /, to: " <= ", label: "> → <=" },
  { from: / \+ /, to: " - ", label: "+ → -" },
  { from: / - /, to: " + ", label: "- → +" },
  { from: / \* /, to: " / ", label: "* → /" },
];

const JS_ONLY: readonly Swap[] = [
  { from: / && /, to: " || ", label: "&& → ||" },
  { from: / \|\| /, to: " && ", label: "|| → &&" },
  { from: /\btrue\b/, to: "false", label: "true → false" },
  { from: /\bfalse\b/, to: "true", label: "false → true" },
];

const PY_ONLY: readonly Swap[] = [
  { from: / and /, to: " or ", label: "and → or" },
  { from: / or /, to: " and ", label: "or → and" },
  { from: /\bTrue\b/, to: "False", label: "True → False" },
  { from: /\bFalse\b/, to: "True", label: "False → True" },
];

const COMMENT = /^\s*(?:\/\/|\/\*|\*|#)/;
const IMPORT = /^\s*(?:import|export\s+\*|from\s+\S+\s+import)\b/;

const swapsFor = (file: string): readonly Swap[] | undefined => {
  if (isTestFile(file)) return undefined;
  if (JS_SOURCE.test(file)) return [...SHARED, ...JS_ONLY];
  return file.endsWith(".py") ? [...SHARED, ...PY_ONLY] : undefined;
};

const mutantsOf = (added: AddedLine): readonly Mutant[] => {
  const swaps = swapsFor(added.path);
  if (swaps === undefined || COMMENT.test(added.text) || IMPORT.test(added.text)) return [];
  return swaps.flatMap((swap): Mutant[] => {
    if (!swap.from.test(added.text)) return [];
    const mutated = added.text.replace(swap.from, swap.to);
    return [{ file: added.path, line: added.line, operator: swap.label, original: added.text, mutated }];
  });
};

const spread = (mutants: readonly Mutant[], limit: number): readonly Mutant[] => {
  const byLine = new Map<string, Mutant[]>();
  for (const mutant of mutants) {
    const key = `${mutant.file}:${String(mutant.line)}`;
    byLine.set(key, [...(byLine.get(key) ?? []), mutant]);
  }
  const picked: Mutant[] = [];
  for (let round = 0; picked.length < limit && picked.length < mutants.length; round += 1) {
    for (const group of byLine.values()) {
      const next = group[round];
      if (next !== undefined && picked.length < limit) picked.push(next);
    }
  }
  return picked;
};

export const planMutants = (added: readonly AddedLine[], limit: number): readonly Mutant[] =>
  spread(added.flatMap(mutantsOf), limit);

export const applyMutant = (text: string, mutant: Mutant): string | undefined => {
  const lines = text.split("\n");
  const index = mutant.line - 1;
  if (lines[index]?.replace(/\r$/, "") !== mutant.original.replace(/\r$/, "")) return undefined;
  lines[index] = mutant.mutated;
  return lines.join("\n");
};
