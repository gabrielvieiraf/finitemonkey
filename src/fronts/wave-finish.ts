import { toAbsolutePath } from "../core/brand.js";
import { accept } from "../core/parsed.js";
import { archiveWorktree } from "../wt/archive.js";
import { dirtyFiles } from "../wt/classify.js";
import { commonDirOf, patchEntry, updateRegistry } from "../wt/store.js";
import { type ReportCheck, reportSummary } from "./report-gate.js";
import { type FrontsState, updateFronts } from "./state.js";
import type { WaveMerged, WaveOptions } from "./wave-merge.js";

export interface Cleaned {
  readonly removed: readonly string[];
  readonly kept: readonly string[];
}

const removeIfClean = (options: WaveOptions, path: string, branch: string | null, target: string): boolean => {
  const { runtime, root } = options;
  const dir = toAbsolutePath(path);
  if (runtime.stat(dir) === undefined || dirtyFiles(runtime, dir, []).length > 0) return false;
  const tip = branch === null ? undefined : runtime.git(["rev-parse", `refs/heads/${branch}`], root).stdout.trim();
  if (tip !== undefined && !runtime.git(["merge-base", "--is-ancestor", tip, `refs/heads/${target}`], root).ok)
    return false;
  return archiveWorktree(runtime, {
    path,
    id: branch ?? path,
    branch,
    mainRoot: root,
    remove: true,
    deleteBranch: false,
    generated: [],
  }).ok;
};

const retarget = (options: WaveOptions, path: string, target: string): void => {
  const common = commonDirOf(options.runtime, options.root);
  if (common === undefined) return;
  updateRegistry(options.runtime, common, "fronts-merge", (registry) =>
    accept({
      registry: {
        worktrees: registry.worktrees.map((entry) =>
          entry.path === path ? { ...entry, target, status: "merged" as const } : entry,
        ),
      },
      result: undefined,
    }),
  );
};

export const finishWave = (options: WaveOptions, state: FrontsState, wave: WaveMerged): Cleaned => {
  const merged = new Set(wave.merges.map((item) => item.front));
  updateFronts(options.runtime, options.root, (current) =>
    accept({
      state: {
        ...current,
        fronts: current.fronts.map((front) => (merged.has(front.id) ? { ...front, status: "merged" as const } : front)),
      },
      result: undefined,
    }),
  );
  const fronts = state.fronts.filter((front) => merged.has(front.id) && front.path !== null);
  const removed: string[] = [];
  const kept: string[] = [];
  for (const front of fronts) {
    const path = front.path ?? "";
    retarget(options, path, wave.branch);
    (removeIfClean(options, path, front.branch, wave.branch) ? removed : kept).push(front.id);
  }
  for (const item of wave.merges) {
    const { path, branch, id } = item.report.integration;
    const common = commonDirOf(options.runtime, options.root);
    if (removeIfClean(options, path, branch, wave.branch)) {
      options.runtime.git(["branch", "-D", branch], options.root);
      if (common !== undefined) patchEntry(options.runtime, common, path, { status: "removed" });
    } else kept.push(id);
  }
  return { removed, kept };
};

export const personLines = (checks: readonly ReportCheck[]): readonly string[] => {
  const decisions = checks.flatMap((check) =>
    (check.report?.provisional_decisions ?? []).map(
      (item) =>
        `${check.front}: ${item.decision}${item.recommendation === "" ? "" : ` (recommended: ${item.recommendation})`}`,
    ),
  );
  return [...decisions.map((text) => `? ${text}`), ...checks.map((check) => reportSummary(check))];
};
