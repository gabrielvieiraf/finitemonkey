import { nowMs } from "../../core/clock.js";
import type { JsonObject } from "../../core/parsed.js";
import type { Runtime } from "../../core/runtime.js";
import { readLedger } from "../../evidence/ledger.js";
import { readGrants } from "../../guards/release/grants.js";
import type { Translate } from "../../i18n/translate.js";
import type { FmPaths } from "../../task/paths.js";
import { readState, writeState } from "../../task/state.js";
import { prepareGate } from "../prepare.js";
import { itemDetails } from "../render.js";
import { buildReport, type GateReport } from "../report.js";

export const currentReport = (
  runtime: Runtime,
  paths: FmPaths,
  sessionId: string | undefined,
  taskId?: string,
): GateReport | undefined => {
  const ready = prepareGate({
    runtime,
    cwd: paths.root,
    env: {},
    sessionId,
    budgetMs: 0,
    fast: true,
    noSkip: true,
    ...(taskId === undefined ? {} : { taskId }),
  });
  if (ready.kind !== "ready") return undefined;
  const { ctx, loaded } = ready.prepared;
  return buildReport({
    contract: ctx.contract,
    ledger: readLedger(runtime, paths.evidence(ctx.contract.id)),
    treeHash: ctx.treeHash,
    base: ctx.base,
    source: loaded.source,
    contractEdited: loaded.editedOnDisk,
    fastPath: true,
  });
};

const ids = (report: GateReport, status: string): string =>
  report.items
    .filter((item) => item.status === status)
    .map((item) => item.id)
    .join(", ") || "-";

export const snapshotOf = (
  t: Translate,
  report: GateReport | undefined,
  grants: readonly string[],
  at: string,
): JsonObject => ({
  at,
  task: report?.task ?? "",
  goal: report?.goal ?? "",
  implicit: report?.implicit ?? true,
  tree: report?.treeHash ?? "",
  passed: report === undefined ? "-" : ids(report, "passed"),
  failed:
    report === undefined
      ? "-"
      : report.items
          .filter((item) => item.status === "failed")
          .map((item) => `${item.id} (${itemDetails(t, item).join(", ")})`)
          .join("; ") || "-",
  unverified: report === undefined ? "-" : ids(report, "unverified"),
  grants: grants.join(", ") || "-",
});

export const saveSnapshot = (
  runtime: Runtime,
  paths: FmPaths,
  t: Translate,
  sessionId: string | undefined,
): boolean => {
  const now = nowMs(runtime);
  const grants = readGrants(runtime, paths)
    .filter((grant) => Date.parse(grant.expiresAt) > now)
    .map((grant) => `${grant.guard} → ${grant.expiresAt}`);
  const snapshot = snapshotOf(t, currentReport(runtime, paths, sessionId), grants, new Date(now).toISOString());
  return writeState(runtime, paths, { ...readState(runtime, paths), snapshot }).ok;
};

const text = (snapshot: JsonObject, key: string): string => {
  const value = snapshot[key];
  return typeof value === "string" ? value : "";
};

export const snapshotFacts = (t: Translate, snapshot: JsonObject | undefined): string | undefined => {
  if (snapshot === undefined || text(snapshot, "at") === "") return undefined;
  const task = text(snapshot, "task");
  return t(task === "" || task === "implicit" ? "gate.context.state_implicit" : "gate.context.state", {
    at: text(snapshot, "at"),
    task,
    goal: text(snapshot, "goal"),
    tree: text(snapshot, "tree"),
    passed: text(snapshot, "passed"),
    failed: text(snapshot, "failed"),
    unverified: text(snapshot, "unverified"),
    grants: text(snapshot, "grants"),
  });
};
