import type { Runtime } from "../core/runtime.js";
import { sha256Hex } from "../secrets/fingerprint.js";
import { approveAmendments } from "../task/amend.js";
import { approvedExamples, type Example, readExamples } from "../task/examples.js";
import { IMPLICIT_ID } from "../task/implicit.js";
import { contractHash, parseContract } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";
import { readTrust, writeTrust } from "../task/state.js";
import type { TaskContract } from "../task/types.js";
import { prepareGate } from "./prepare.js";

export interface PendingContract {
  readonly task: string;
  readonly contract: TaskContract;
  readonly hash: string;
  readonly digest: string;
  readonly trusted: boolean;
  readonly text: string | undefined;
  readonly examples: readonly Example[];
}

export type TrustOutcome =
  | { readonly kind: "trusted"; readonly hash: string }
  | { readonly kind: "stale"; readonly hash: string }
  | { readonly kind: "failed" };

export const pendingContract = (runtime: Runtime, paths: FmPaths, task: string): PendingContract | undefined => {
  const taskId = task === IMPLICIT_ID ? undefined : task;
  const ready = prepareGate({
    runtime,
    cwd: paths.root,
    env: {},
    sessionId: undefined,
    budgetMs: 0,
    fast: true,
    noSkip: true,
    ...(taskId === undefined ? {} : { taskId }),
  });
  if (ready.kind !== "ready" || ready.prepared.ctx.contract.id !== task) return undefined;
  const { loaded } = ready.prepared;
  const read = runtime.readText(paths.task(task));
  const text = task === IMPLICIT_ID || !read.ok ? undefined : read.value;
  const parsed = text === undefined ? undefined : parseContract(task, text);
  const contract = parsed?.ok === true ? parsed.value : loaded.contract;
  const locked = approvedExamples(runtime, paths, task).examples;
  const hash = parsed?.ok === true ? contractHash(contract, locked) : loaded.hash;
  return {
    task,
    contract,
    hash,
    digest: sha256Hex(`${hash}\n${text ?? ""}`),
    trusted: loaded.trusted && !loaded.editedOnDisk,
    text,
    examples: task === IMPLICIT_ID ? [] : readExamples(runtime, paths, task),
  };
};

export const trustContract = (
  runtime: Runtime,
  paths: FmPaths,
  task: string,
  approvedBy: string,
  expected?: { readonly hash: string; readonly digest?: string },
): TrustOutcome => {
  const pending = pendingContract(runtime, paths, task);
  if (pending === undefined) return { kind: "failed" };
  const changed =
    expected !== undefined &&
    (expected.hash !== pending.hash || (expected.digest !== undefined && expected.digest !== pending.digest));
  if (changed) return { kind: "stale", hash: pending.hash };
  const lock = readTrust(runtime, paths);
  const written = writeTrust(runtime, paths, {
    ...lock,
    contracts: { ...lock.contracts, [task]: pending.hash },
    approved: pending.text === undefined ? lock.approved : { ...lock.approved, [task]: pending.text },
  });
  if (!written.ok) return { kind: "failed" };
  approveAmendments(runtime, paths, task, approvedBy);
  return { kind: "trusted", hash: pending.hash };
};
