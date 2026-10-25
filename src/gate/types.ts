import type { Env } from "../core/context.js";
import type { Runtime } from "../core/runtime.js";
import type { EvidenceStatus, Note, UnverifiedReason } from "../evidence/types.js";
import type { FmPaths } from "../task/paths.js";
import type { GateTrust } from "../task/state.js";
import type { AcceptanceCheck, CheckKind, TaskContract } from "../task/types.js";
import type { Change, Git } from "./git.js";
import type { PrStatus } from "./pr.js";

export interface BaselineEntry {
  readonly exitCode: number | null;
  readonly failures: readonly string[];
}

export type Baseline = Readonly<Record<string, BaselineEntry>>;

export interface GateContext {
  readonly runtime: Runtime;
  readonly git: Git;
  readonly paths: FmPaths;
  readonly contract: TaskContract;
  readonly trusted: boolean;
  readonly treeHash: string;
  readonly base: string;
  readonly changes: readonly Change[];
  readonly deadline: number;
  readonly sessionId: string | undefined;
  readonly env: Env;
  readonly trust: GateTrust;
  readonly pr: () => PrStatus;
  readonly mask: (text: string) => string;
  readonly baseline: Baseline | undefined;
}

export interface CheckOutcome {
  readonly status: EvidenceStatus;
  readonly notes: readonly Note[];
  readonly reason?: UnverifiedReason;
  readonly command?: string;
  readonly exitCode?: number | null;
  readonly stdoutSha256?: string;
  readonly durationMs?: number;
  readonly releasedBy?: string;
  readonly failures?: readonly string[];
  readonly testCount?: number;
}

export type CheckRunner = (check: AcceptanceCheck, ctx: GateContext) => CheckOutcome;

export type CheckRegistry = Readonly<Partial<Record<CheckKind, CheckRunner>>>;

export const note = (key: string, params: Note["params"] = {}): Note => ({ key, params });

export const unverified = (reason: UnverifiedReason, notes: readonly Note[] = []): CheckOutcome => ({
  status: "unverified",
  reason,
  notes,
});

export const passed = (notes: readonly Note[] = []): CheckOutcome => ({ status: "passed", notes });

export const failed = (notes: readonly Note[]): CheckOutcome => ({ status: "failed", notes });

export const REUSABLE_KINDS: readonly CheckKind[] = ["command", "tests"];
