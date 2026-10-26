import type { Env } from "../../core/context.js";
import type { Runtime } from "../../core/runtime.js";
import { sha256Hex as sha256 } from "../../secrets/fingerprint.js";
import type { FmPaths } from "../../task/paths.js";
import { type BlockCounter, readState, withBlocks, writeState } from "../../task/state.js";
import type { GateReport } from "../report.js";

export const OFFICIAL_STOP_CAP = 8;
export const NO_PROGRESS_MAX = 3;
export const CAP_MARGIN = 2;

export const maxBlocks = (env: Env): number => {
  const parsed = Number.parseInt(env["CLAUDE_CODE_STOP_HOOK_BLOCK_CAP"] ?? "", 10);
  const cap = Number.isFinite(parsed) && parsed > 0 ? parsed : OFFICIAL_STOP_CAP;
  return Math.max(1, cap - CAP_MARGIN);
};

export const failureSignature = (report: GateReport): string =>
  sha256(
    JSON.stringify([
      report.treeHash,
      report.items.filter((item) => item.status === "failed").map((item) => [item.id, item.notes]),
    ]),
  );

export type CounterVerdict =
  { readonly kind: "block"; readonly counter: BlockCounter } | { readonly kind: "exhausted"; readonly blocks: number };

export const nextBlock = (previous: BlockCounter | undefined, report: GateReport, env: Env): CounterVerdict => {
  const signature = failureSignature(report);
  const sameTask = previous?.task === report.task;
  const consecutive = (sameTask ? previous.consecutive : 0) + 1;
  const same = sameTask && previous.signature === signature ? previous.same + 1 : 1;
  if (consecutive > maxBlocks(env) || same > NO_PROGRESS_MAX) return { kind: "exhausted", blocks: consecutive - 1 };
  return { kind: "block", counter: { task: report.task, signature, consecutive, same } };
};

type Store = Pick<Runtime, "readText" | "writeText">;

export const saveCounter = (store: Store, paths: FmPaths, counter: BlockCounter | undefined): boolean => {
  return writeState(store, paths, withBlocks(readState(store, paths), counter)).ok;
};

export const readCounter = (store: Pick<Runtime, "readText">, paths: FmPaths): BlockCounter | undefined =>
  readState(store, paths).blocks;
