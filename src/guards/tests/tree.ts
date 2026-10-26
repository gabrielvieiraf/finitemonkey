import { matchesAny } from "../../core/glob.js";
import type { Change } from "../../gate/git.js";
import { compareConfig, compareNewTestFile, compareTestFile, type TestViolation } from "./analyze.js";
import { isTestFile } from "./patterns.js";

export interface TreeInput {
  readonly changes: readonly Change[];
  readonly before: (path: string) => string | undefined;
  readonly after: (path: string) => string | undefined;
  readonly acceptedConfigs: Readonly<Record<string, string>>;
  readonly scopePaths: readonly string[];
  readonly testsProtected: boolean;
}

const outOfScope = (input: TreeInput, change: Change): readonly TestViolation[] =>
  input.testsProtected &&
  input.scopePaths.length > 0 &&
  change.status !== "A" &&
  isTestFile(change.path) &&
  !matchesAny(change.path, input.scopePaths)
    ? [{ kind: "out_of_scope", path: change.path }]
    : [];

const forChange = (input: TreeInput, change: Change): readonly TestViolation[] => {
  if (change.status === "A") return compareNewTestFile(change.path, input.after(change.path) ?? "");
  const oldPath = change.oldPath ?? change.path;
  const before = input.before(oldPath);
  const after = change.status === "D" ? undefined : input.after(change.path);
  return [
    ...compareTestFile(change.status === "R" ? oldPath : change.path, before, after),
    ...compareConfig(change.path, before, after, input.acceptedConfigs[change.path]),
    ...outOfScope(input, change),
  ];
};

export const analyzeTree = (input: TreeInput): readonly TestViolation[] =>
  input.changes.flatMap((change) => forChange(input, change));
