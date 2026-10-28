import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { appendEvidence } from "../evidence/ledger.js";
import { type Evidence, EVIDENCE_SCHEMA, GATE_CHECK } from "../evidence/types.js";
import { gitAt, treeHash } from "../gate/git.js";
import { parseContract } from "./load.js";
import type { FmPaths } from "./paths.js";
import { readState, writeState } from "./state.js";
import type { TaskContract } from "./types.js";

export type ReopenProblem =
  | { readonly kind: "not_found"; readonly task: string }
  | { readonly kind: "unknown_criteria"; readonly criteria: readonly string[] }
  | { readonly kind: "no_tree" }
  | { readonly kind: "write" };

export const readContract = (runtime: Runtime, paths: FmPaths, id: string): TaskContract | undefined => {
  const text = runtime.readText(paths.task(id));
  const parsed = text.ok ? parseContract(id, text.value) : undefined;
  return parsed?.ok === true ? parsed.value : undefined;
};

const marker = (task: string, check: string, kind: string, tree: string, at: string, command?: string): Evidence => ({
  schema: EVIDENCE_SCHEMA,
  task,
  check,
  kind,
  status: "unverified",
  reason: "pending",
  treeHash: tree,
  at,
  notes: [{ key: "gate.reopened", params: { check } }],
  ...(command === undefined ? {} : { command }),
});

export const invalidate = (
  runtime: Runtime,
  paths: FmPaths,
  contract: TaskContract,
  criteria: readonly string[],
): Parsed<readonly string[], ReopenProblem> => {
  const unknown = criteria.filter((id) => !contract.acceptance.some((check) => check.id === id));
  if (unknown.length > 0) return reject({ kind: "unknown_criteria", criteria: unknown });
  const tree = treeHash(gitAt(runtime, paths.root));
  if (tree === undefined) return reject({ kind: "no_tree" });
  const at = runtime.now();
  const entries = [
    ...contract.acceptance
      .filter((check) => criteria.includes(check.id))
      .map((check) => marker(contract.id, check.id, check.kind, tree, at, check.run)),
    marker(contract.id, GATE_CHECK, "gate", tree, at),
  ];
  return appendEvidence(runtime, paths.evidence(contract.id), entries) ? accept(criteria) : reject({ kind: "write" });
};

export const reopenTask = (
  runtime: Runtime,
  paths: FmPaths,
  id: string,
  criteria: readonly string[],
): Parsed<readonly string[], ReopenProblem> => {
  const contract = readContract(runtime, paths, id);
  if (contract === undefined) return reject({ kind: "not_found", task: id });
  const done = invalidate(runtime, paths, contract, criteria);
  if (!done.ok) return done;
  const state = readState(runtime, paths);
  writeState(runtime, paths, { ...state, active: id, done: state.done.filter((item) => item !== id) });
  return done;
};
