import type { Runtime } from "../core/runtime.js";
import type { Translate } from "../i18n/translate.js";
import { readEntries, signalFiles } from "../signals/store.js";
import type { FmPaths } from "../task/paths.js";
import { type StatusData, statusOf } from "./status.js";

export const HANDOFF_SCHEMA = "finitemonkey/handoff@1";
export const MAX_ATTEMPTS = 5;

export interface FailedAttempt {
  readonly sample: string;
  readonly count: number;
}

export interface HandoffData {
  readonly schema: typeof HANDOFF_SCHEMA;
  readonly contract: StatusData["contract"];
  readonly gate: string;
  readonly tree: string | null;
  readonly green: readonly string[];
  readonly failed: readonly string[];
  readonly notVerified: readonly { readonly id: string; readonly reason: string; readonly verify: string }[];
  readonly attempts: readonly FailedAttempt[];
  readonly text: string;
}

const attemptsOf = (runtime: Runtime, paths: FmPaths): readonly FailedAttempt[] => {
  const groups = new Map<string, FailedAttempt>();
  for (const entry of readEntries(runtime, signalFiles(paths))) {
    if (entry.kind !== "error") continue;
    const before = groups.get(entry.sig);
    groups.set(entry.sig, { sample: entry.sample, count: (before?.count ?? 0) + 1 });
  }
  return [...groups.values()]
    .filter((item) => item.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_ATTEMPTS);
};

const textOf = (t: Translate, data: Omit<HandoffData, "text" | "schema">): string =>
  [
    t("handoff.title"),
    data.contract === null
      ? t("handoff.no_contract")
      : t("handoff.contract", { id: data.contract.id, hash: data.contract.hash }),
    t("handoff.gate", { light: data.gate, tree: data.tree ?? "-" }),
    t("handoff.green", { list: data.green.join(", ") || "-" }),
    ...(data.failed.length > 0 ? [t("handoff.failed", { list: data.failed.join(", ") })] : []),
    ...data.notVerified.map((item) => t("handoff.not_verified", { ...item })),
    ...data.attempts.map((item) => t("handoff.attempt", { sample: item.sample, count: item.count })),
  ].join("\n");

export const handoffOf = (runtime: Runtime, paths: FmPaths, t: Translate): HandoffData => {
  const status = statusOf(runtime, paths);
  const body = {
    contract: status.contract,
    gate: status.gate.light,
    tree: status.tree,
    green: status.checks.filter((check) => check.status === "passed").map((check) => check.id),
    failed: status.checks.filter((check) => check.status === "failed").map((check) => check.id),
    notVerified: status.notVerified,
    attempts: attemptsOf(runtime, paths),
  };
  return { schema: HANDOFF_SCHEMA, ...body, text: textOf(t, body) };
};
