import type { Runtime } from "../core/runtime.js";
import { readLedger } from "../evidence/ledger.js";
import type { EvidenceStatus } from "../evidence/types.js";
import { readGateStatus } from "../gate/hooks/status.js";
import { prepareGate } from "../gate/prepare.js";
import { buildReport, type GateReport, type ReportItem } from "../gate/report.js";
import { unreviewedBypasses } from "../guards/bypass/ledger.js";
import { readEntries, signalFiles } from "../signals/store.js";
import { type GateLight, gateLight } from "../statusline/gate-state.js";
import { contractHash } from "../task/load.js";
import type { FmPaths } from "../task/paths.js";

export const STATUS_SCHEMA = "finitemonkey/status@1";
export const GATE_COMMAND = "finitemonkey gate";

export interface StatusCheck {
  readonly id: string;
  readonly kind: string;
  readonly status: EvidenceStatus;
  readonly stale: boolean;
  readonly verify: string;
}

export interface NotVerified {
  readonly id: string;
  readonly reason: string;
  readonly verify: string;
}

export interface StatusGate {
  readonly light: GateLight;
  readonly status: string | null;
  readonly at: string | null;
}

export interface StatusData {
  readonly schema: typeof STATUS_SCHEMA;
  readonly task: string | null;
  readonly implicit: boolean;
  readonly goal: string;
  readonly contract: { readonly id: string; readonly hash: string } | null;
  readonly gate: StatusGate;
  readonly tree: string | null;
  readonly counts: { readonly passed: number; readonly failed: number; readonly unverified: number };
  readonly checks: readonly StatusCheck[];
  readonly notVerified: readonly NotVerified[];
  readonly editsSinceGate: number | null;
  readonly bypasses: number;
}

const verifyOf = (item: ReportItem): string => item.command ?? GATE_COMMAND;

const checkOf = (item: ReportItem): StatusCheck => ({
  id: item.id,
  kind: item.kind,
  status: item.status,
  stale: item.stale,
  verify: verifyOf(item),
});

const notVerifiedOf = (item: ReportItem): NotVerified => ({
  id: item.id,
  reason: item.stale ? "stale" : (item.reason ?? "no_evidence"),
  verify: verifyOf(item),
});

const editsSince = (runtime: Runtime, paths: FmPaths, at: string | null): number | null => {
  if (at === null) return null;
  const since = Date.parse(at);
  return readEntries(runtime, signalFiles(paths)).filter(
    (entry) => entry.kind === "edit" && Date.parse(entry.at) > since,
  ).length;
};

const reportOf = (
  runtime: Runtime,
  paths: FmPaths,
): { readonly report: GateReport; readonly hash: string } | undefined => {
  const ready = prepareGate({
    runtime,
    cwd: paths.root,
    env: {},
    sessionId: undefined,
    budgetMs: 0,
    fast: true,
    noSkip: true,
  });
  if (ready.kind !== "ready") return undefined;
  const { ctx, loaded } = ready.prepared;
  const report = buildReport({
    contract: ctx.contract,
    ledger: readLedger(runtime, paths.evidence(ctx.contract.id)),
    treeHash: ctx.treeHash,
    base: ctx.base,
    source: loaded.source,
    contractEdited: loaded.editedOnDisk,
    fastPath: true,
  });
  return { report, hash: contractHash(ctx.contract) };
};

export const statusOf = (runtime: Runtime, paths: FmPaths): StatusData => {
  const gate = readGateStatus(runtime, paths);
  const gateAt = gate?.at ?? null;
  const found = reportOf(runtime, paths);
  const report = found?.report;
  const items = report?.items ?? [];
  return {
    schema: STATUS_SCHEMA,
    task: report?.task ?? null,
    implicit: report?.implicit ?? true,
    goal: report?.goal ?? "",
    contract: report === undefined || found === undefined ? null : { id: report.task, hash: found.hash },
    gate: { light: gateLight(runtime, paths), status: gate?.status ?? null, at: gateAt },
    tree: report?.treeHash ?? null,
    counts: report?.counts ?? { passed: 0, failed: 0, unverified: 0 },
    checks: items.map(checkOf),
    notVerified: items.filter((item) => item.status === "unverified").map(notVerifiedOf),
    editsSinceGate: editsSince(runtime, paths, gateAt),
    bypasses: unreviewedBypasses(runtime, paths).length,
  };
};
