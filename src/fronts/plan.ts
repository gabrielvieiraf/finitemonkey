import type { AbsolutePath } from "../core/brand.js";
import type { Env } from "../core/context.js";
import { accept, type Parsed, reject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { newWorktree } from "../wt/create.js";
import type { WorktreeEntry, WorktreeOwner } from "../wt/entry.js";
import { DEFAULT_PORT_BASE } from "../wt/ports.js";
import type { PlannedFront, WavePlan } from "./plan-input.js";
import { DEFAULT_MAX_CONCURRENT, type Front, type FrontsState, runningWriteFronts, updateFronts } from "./state.js";

export const trackedFiles = (runtime: Runtime, root: AbsolutePath): readonly string[] => {
  const listed = runtime.git(["ls-files", "-z"], root);
  return listed.ok ? listed.stdout.split("\u0000").filter((path) => path !== "") : [];
};

const line = (runtime: Runtime, cwd: AbsolutePath, args: readonly string[]): string | undefined => {
  const result = runtime.git(args, cwd);
  const value = result.stdout.trim();
  return result.ok && value !== "" ? value : undefined;
};

const frontFrom = (planned: PlannedFront, entry: WorktreeEntry): Front => ({
  id: planned.id,
  goal: planned.goal,
  contract: planned.contract,
  paths: planned.paths,
  append: planned.append,
  i18nNs: planned.i18nNs,
  worktree: entry.id,
  path: entry.path,
  branch: entry.branch,
  port: planned.port ?? entry.ports?.from ?? null,
  shotsPrefix: planned.shotsPrefix ?? `${planned.id.toLowerCase()}-`,
  issue: planned.issue,
  agentId: null,
  agentKind: "subagent",
  status: planned.blockedBy.length > 0 ? "blocked" : "planned",
  blockedBy: planned.blockedBy,
  inbox: [],
  lastReport: null,
  costUsd: 0,
  startedAt: null,
});

export interface PlanContext {
  readonly runtime: Runtime;
  readonly cwd: AbsolutePath;
  readonly env: Env;
  readonly owner: WorktreeOwner;
}

const createWorktrees = (context: PlanContext, plan: WavePlan, base: string): Parsed<readonly Front[]> => {
  const fronts: Front[] = [];
  for (const planned of plan.fronts) {
    const made = newWorktree(context.runtime, context.cwd, context.env, {
      id: planned.id,
      purpose: planned.goal === "" ? `front ${planned.id}` : planned.goal,
      base,
      branch: `front/${planned.id}`,
      path: undefined,
      task: planned.contract ?? undefined,
      parent: undefined,
      portBase: DEFAULT_PORT_BASE,
      owner: context.owner,
    });
    if (!made.ok) return reject(`${planned.id}: ${made.error.kind === "git" ? made.error.detail : made.error.kind}`);
    fronts.push(frontFrom(planned, made.value));
  }
  return accept(fronts);
};

export const applyWave = (context: PlanContext, plan: WavePlan): Parsed<FrontsState> => {
  const baseRef =
    plan.base ?? line(context.runtime, context.cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]) ?? "HEAD";
  const sha = line(context.runtime, context.cwd, ["rev-parse", "--short=7", `${baseRef}^{commit}`]);
  if (sha === undefined) return reject(`unknown base ${baseRef}`);
  return updateFronts(context.runtime, context.cwd, (current) => {
    const running = runningWriteFronts(current);
    if (running.length > 0)
      return reject(
        `wave ${String(current.wave)} still has running fronts: ${running.map((front) => front.id).join(", ")}`,
      );
    const fronts = createWorktrees(context, plan, baseRef);
    if (!fronts.ok) return fronts;
    const state: FrontsState = {
      ...current,
      wave: plan.wave,
      base: `${baseRef}@${sha}`,
      maxConcurrent: plan.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
      fronts: fronts.value,
      pending: [],
    };
    return accept({ state, result: state });
  });
};
