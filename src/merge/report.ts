import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { accept, type Parsed } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { registryDir } from "../wt/store.js";
import type { MergeClass } from "./hunk.js";

export const MERGE_REPORT_SCHEMA = "finitemonkey/merge-report@1";

export interface LineRange {
  readonly start: number;
  readonly count: number;
}

export interface HunkTrace {
  readonly base: LineRange;
  readonly ours: LineRange;
  readonly theirs: LineRange;
  readonly oursCommits: readonly string[];
  readonly theirsCommits: readonly string[];
}

export interface HunkReport {
  readonly index: number;
  readonly class: MergeClass;
  readonly rule: string;
  readonly decision: string;
  readonly trace: HunkTrace;
}

export interface FileReport {
  readonly path: string;
  readonly class: MergeClass;
  readonly rule: string;
  readonly decision: string;
  readonly proposal: string | null;
  readonly hunks: readonly HunkReport[];
}

export interface MergeCheck {
  readonly name: string;
  readonly command: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface SemanticCandidate {
  readonly file: string;
  readonly symbol: string;
  readonly reason: string;
}

export interface MergeStop {
  readonly reason: string;
  readonly path: string | null;
}

export interface MergeSideRef {
  readonly ref: string;
  readonly sha: string;
}

export interface MergeReport {
  readonly schema: typeof MERGE_REPORT_SCHEMA;
  readonly at: string;
  readonly target: MergeSideRef;
  readonly source: MergeSideRef;
  readonly bases: readonly string[];
  readonly virtualBase: boolean;
  readonly integration: { readonly branch: string; readonly path: string; readonly id: string };
  readonly snapshots: readonly string[];
  readonly files: readonly FileReport[];
  readonly dropped: readonly {
    readonly file: string;
    readonly side: string;
    readonly reason: string;
    readonly text?: string;
  }[];
  readonly checks: readonly MergeCheck[];
  readonly semanticCandidates: readonly SemanticCandidate[];
  readonly stops: readonly MergeStop[];
  readonly outcome: "merged" | "stopped";
  readonly commit: string | null;
  readonly conclusion: "pull-request" | "fast-forward-allowed" | "none";
  readonly undo: string;
  readonly reportPath: string;
}

export const reportPathFor = (commonDir: AbsolutePath, stamp: string): AbsolutePath =>
  toAbsolutePath(join(registryDir(commonDir), "merges", `${stamp}.json`));

export const writeReport = (runtime: Runtime, report: MergeReport): Parsed<undefined> => {
  const path = toAbsolutePath(report.reportPath);
  const made = runtime.mkdir(toAbsolutePath(join(path, "..")));
  if (!made.ok) return made;
  const written = runtime.writeAtomic(path, `${JSON.stringify(report, null, 2)}\n`);
  return written.ok ? accept(undefined) : written;
};

const classCounts = (report: MergeReport): string => {
  const counts = new Map<string, number>();
  for (const file of report.files) {
    for (const hunk of file.hunks.length === 0 ? [{ class: file.class }] : file.hunks) {
      counts.set(hunk.class, (counts.get(hunk.class) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([cls, count]) => `${cls} ${String(count)}`)
    .join(", ");
};

export const reportMarkdown = (report: MergeReport): string =>
  [
    `### Merge report: ${report.source.ref} into ${report.target.ref}`,
    "",
    `Outcome: ${report.outcome}${report.commit === null ? "" : ` (${report.commit.slice(0, 12)})`}. Bases: ${String(report.bases.length)}${report.virtualBase ? " (virtual base used)" : ""}.`,
    `Hunks by class: ${classCounts(report) || "none"}.`,
    "",
    "| File | Class | Rule | Decision |",
    "|---|---|---|---|",
    ...report.files.flatMap((file) =>
      (file.hunks.length === 0 ? [file] : file.hunks).map(
        (hunk) => `| ${file.path} | ${hunk.class} | ${hunk.rule} | ${hunk.decision} |`,
      ),
    ),
    "",
    ...report.stops.map((stop) => `- Stop: ${stop.reason}${stop.path === null ? "" : ` (${stop.path})`}`),
    ...report.semanticCandidates.map((item) => `- Semantic candidate: ${item.symbol} in ${item.file} (${item.reason})`),
    ...report.checks.map((check) => `- Check ${check.name}: ${check.ok ? "passed" : "failed"} (\`${check.command}\`)`),
    `- Snapshots: ${report.snapshots.join(", ")}`,
    `- Undo: \`${report.undo}\``,
    "",
    "This report proves presence of every line, not behavior; the gate and the tests of both sides still decide.",
  ].join("\n");
