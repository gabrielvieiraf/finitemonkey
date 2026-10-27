import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { runMerge } from "../merge/protocol.js";
import type { MergeReport } from "../merge/report.js";
import { openCallers } from "../merge/semantic.js";
import type { WorktreeOwner } from "../wt/entry.js";
import { checkReport, type ReportCheck } from "./report-gate.js";
import type { Front, FrontsState } from "./state.js";

export type WaveFailure =
  | { readonly kind: "no-fronts" }
  | { readonly kind: "reports"; readonly checks: readonly ReportCheck[] }
  | { readonly kind: "cycle"; readonly fronts: readonly string[] }
  | { readonly kind: "base"; readonly detail: string }
  | {
      readonly kind: "merge";
      readonly front: string;
      readonly report: MergeReport | undefined;
      readonly detail: string;
    }
  | { readonly kind: "wave-checks"; readonly detail: string };

export interface WaveMerged {
  readonly branch: string;
  readonly head: string;
  readonly merges: readonly { readonly front: string; readonly report: MergeReport }[];
  readonly checks: readonly ReportCheck[];
}

export interface WaveOptions {
  readonly runtime: Runtime;
  readonly root: AbsolutePath;
  readonly env: Env;
  readonly owner: WorktreeOwner;
  readonly checks: readonly string[];
}

const READY: ReadonlySet<Front["status"]> = new Set(["reported", "verified"]);

export const mergeOrder = (fronts: readonly Front[], merged: ReadonlySet<string>): readonly Front[] | undefined => {
  const pending = [...fronts];
  const done = new Set(merged);
  const order: Front[] = [];
  while (pending.length > 0) {
    const index = pending.findIndex((front) =>
      front.blockedBy.every((id) => done.has(id) || !fronts.some((item) => item.id === id)),
    );
    const next = pending[index];
    if (index < 0 || next === undefined) return undefined;
    order.push(next);
    done.add(next.id);
    pending.splice(index, 1);
  }
  return order;
};

const line = (runtime: Runtime, cwd: AbsolutePath, args: readonly string[]): string | undefined => {
  const result = runtime.git(args, cwd);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : undefined;
};

const ensureWaveBranch = (options: WaveOptions, state: FrontsState): Parsed<string, WaveFailure> => {
  const branch = `wave/${String(state.wave)}`;
  if (line(options.runtime, options.root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]) !== undefined)
    return accept(branch);
  const base = state.base.split("@").pop() ?? state.base;
  const sha = line(options.runtime, options.root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  if (sha === undefined) return reject({ kind: "base", detail: `unknown wave base ${state.base}` });
  return options.runtime.git(["branch", branch, sha], options.root).ok
    ? accept(branch)
    : reject({ kind: "base", detail: `could not create ${branch}` });
};

const mergeFront = (options: WaveOptions, branch: string, front: Front): Parsed<MergeReport, WaveFailure> => {
  const before = line(options.runtime, options.root, ["rev-parse", `refs/heads/${branch}`]) ?? "";
  const merged = runMerge(options.runtime, options.root, options.env, {
    source: front.branch ?? front.id,
    target: branch,
    checks: options.checks,
    targetContract: undefined,
    sourceContract: front.contract ?? undefined,
    declaredRemovals: [],
    owner: options.owner,
    sourceScope: { paths: front.paths, append: front.append, generated: [], inferred: front.paths.length === 0 },
  });
  if (!merged.ok) return reject({ kind: "merge", front: front.id, report: undefined, detail: merged.error });
  const report = merged.value;
  if (report.outcome !== "merged" || report.commit === null) {
    return reject({
      kind: "merge",
      front: front.id,
      report,
      detail: report.stops.map((stop) => stop.reason).join("; "),
    });
  }
  const moved = options.runtime.git(["update-ref", `refs/heads/${branch}`, report.commit, before], options.root);
  return moved.ok
    ? accept(report)
    : reject({ kind: "merge", front: front.id, report, detail: `could not move ${branch}` });
};

const waveChecks = (options: WaveOptions, last: MergeReport, base: string): string | undefined => {
  const dir = toAbsolutePath(last.integration.path);
  const callers = openCallers(options.runtime, dir, base);
  return callers.length === 0 ? undefined : callers.map((item) => `${item.symbol} at ${item.file}`).join("; ");
};

export const mergeWave = (options: WaveOptions, state: FrontsState): Parsed<WaveMerged, WaveFailure> => {
  const ready = state.fronts.filter((front) => READY.has(front.status));
  if (ready.length === 0) return reject({ kind: "no-fronts" });
  const checks = ready.map((front) => checkReport(options.runtime, options.root, front));
  if (checks.some((check) => check.problems.length > 0))
    return reject({ kind: "reports", checks: checks.filter((check) => check.problems.length > 0) });
  const merged = new Set(state.fronts.filter((front) => front.status === "merged").map((front) => front.id));
  const order = mergeOrder(ready, merged);
  if (order === undefined) return reject({ kind: "cycle", fronts: ready.map((front) => front.id) });
  const branch = ensureWaveBranch(options, state);
  if (!branch.ok) return branch;
  const base = line(options.runtime, options.root, ["rev-parse", `refs/heads/${branch.value}`]) ?? "";
  const merges: { front: string; report: MergeReport }[] = [];
  for (const front of order) {
    const report = mergeFront(options, branch.value, front);
    if (!report.ok) return report;
    merges.push({ front: front.id, report: report.value });
  }
  const last = merges[merges.length - 1]?.report;
  const failed = last === undefined ? undefined : waveChecks(options, last, base);
  if (failed !== undefined) return reject({ kind: "wave-checks", detail: failed });
  const head = line(options.runtime, options.root, ["rev-parse", `refs/heads/${branch.value}`]) ?? "";
  return accept({ branch: branch.value, head, merges, checks });
};
