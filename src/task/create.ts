import { join } from "node:path";

import { detectStack, hasWebStack } from "../appsec/stack.js";
import { toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { stringifyYaml } from "../core/yaml/write.js";
import { LOOK_CONFIG } from "../look/config.js";
import { detectChecks } from "./implicit.js";
import { contractHash } from "./load.js";
import type { FmPaths } from "./paths.js";
import { contractYaml } from "./serialize.js";
import { readState, readTrust, writeState, writeTrust } from "./state.js";
import type { AcceptanceCheck, DiffBudget, GitRequirement, TaskContract, TaskSize } from "./types.js";
import { validateContract } from "./validate.js";

export interface TaskDraft {
  readonly id: string;
  readonly goal: string;
  readonly size: TaskSize;
  readonly base: string | undefined;
  readonly paths: readonly string[];
  readonly runs: readonly string[];
  readonly tests: string | undefined;
  readonly git: readonly GitRequirement[];
  readonly manual: readonly string[];
  readonly budget: DiffBudget | undefined;
}

export type CreateProblem =
  | { readonly kind: "exists"; readonly id: string }
  | { readonly kind: "invalid"; readonly issues: readonly string[] }
  | { readonly kind: "write"; readonly detail: string };

const explicitChecks = (draft: TaskDraft): readonly AcceptanceCheck[] => [
  ...draft.runs.map((run, index): AcceptanceCheck => ({ id: `C${String(index + 1)}`, kind: "command", run })),
  draft.tests === undefined ? { id: "tests", kind: "tests" } : { id: "tests", kind: "tests", run: draft.tests },
];

export const draftChecks = (
  runtime: Pick<Runtime, "readText" | "stat">,
  paths: FmPaths,
  draft: TaskDraft,
): readonly AcceptanceCheck[] => {
  const disk = {
    read: (relative: string): string | undefined => {
      const text = runtime.readText(toAbsolutePath(join(paths.root, relative)));
      return text.ok ? text.value : undefined;
    },
    exists: (relative: string): boolean => runtime.stat(toAbsolutePath(join(paths.root, relative))) !== undefined,
  };
  const detected = detectChecks(disk);
  const base = draft.runs.length > 0 || draft.tests !== undefined ? explicitChecks(draft) : detected;
  const hasTests = base.some((check) => check.kind === "tests");
  return [
    ...base,
    ...(hasTests ? [] : [{ id: "tests", kind: "tests" as const }]),
    { id: "placeholders", kind: "placeholders" },
    { id: "secrets", kind: "secrets" },
    ...(hasWebStack(detectStack(disk.read)) ? [{ id: "appsec", kind: "appsec" as const }] : []),
    { id: "prose", kind: "prose" },
    { id: "worktree", kind: "worktree" },
    { id: "merge", kind: "merge" },
    { id: "callers", kind: "callers" },
    { id: "quality", kind: "quality" },
    { id: "slop", kind: "slop" },
    ...(draft.paths.length > 0 || draft.budget !== undefined ? [{ id: "diff", kind: "diff" as const }] : []),
    ...(runtime.stat(toAbsolutePath(join(paths.root, LOOK_CONFIG))) === undefined
      ? []
      : [{ id: "look", kind: "look" as const }]),
    ...(draft.git.length > 0 ? [{ id: "git", kind: "git" as const, require: draft.git }] : []),
    { id: "pr", kind: "pr", requireOpen: draft.git.includes("pr_open") },
    ...draft.manual.map((description, index): AcceptanceCheck => ({
      id: `M${String(index + 1)}`,
      kind: "manual",
      description,
    })),
  ];
};

export const createTask = (
  runtime: Pick<Runtime, "readText" | "writeText" | "stat">,
  paths: FmPaths,
  draft: TaskDraft,
): Parsed<{ readonly contract: TaskContract; readonly text: string }, CreateProblem> => {
  if (runtime.stat(paths.task(draft.id)) !== undefined) return reject({ kind: "exists", id: draft.id });
  const shape = {
    id: draft.id,
    goal: draft.goal,
    size: draft.size,
    ...(draft.base === undefined ? {} : { base: draft.base }),
    scope: {
      paths: draft.paths,
      testsProtected: true,
      ...(draft.budget === undefined ? {} : { diffBudget: draft.budget }),
    },
    acceptance: draftChecks(runtime, paths, draft),
    decisionsNeeded: [],
    implicit: false,
  } satisfies TaskContract;
  const text = stringifyYaml(contractYaml(shape));
  const valid = validateContract(contractYaml(shape));
  if (!valid.ok) return reject({ kind: "invalid", issues: valid.error });
  const wrote = runtime.writeText(paths.task(draft.id), text);
  if (!wrote.ok) return reject({ kind: "write", detail: wrote.error });
  const lock = readTrust(runtime, paths);
  writeTrust(runtime, paths, {
    ...lock,
    contracts: { ...lock.contracts, [draft.id]: contractHash(valid.value) },
    approved: { ...lock.approved, [draft.id]: text },
  });
  writeState(runtime, paths, { ...readState(runtime, paths), active: draft.id });
  return accept({ contract: valid.value, text });
};
