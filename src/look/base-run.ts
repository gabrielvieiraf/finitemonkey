import { type AbsolutePath } from "../core/brand.js";
import { nowMs } from "../core/clock.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt, resolveBase } from "../gate/git.js";
import { installFrozen, removeScratch, scratchDir } from "../gate/isolated.js";
import { projectFilesAt } from "../instructions/drift.js";
import { ONBOARD_FILE, parseOnboard } from "../onboard/state.js";
import { devStart } from "./dev-server.js";
import { PERF_FEATURE, regressions, type RouteMeasure, sampleBy, summarize } from "./perf.js";
import { issue, type UxPage } from "./ux.js";

export const SAME_RUN_PREFIX = "look-base";

export interface BaseApp {
  readonly stop: () => Promise<void>;
}

export type BaseBoot = { readonly app: BaseApp } | { readonly detail: string };

export interface SameRunDeps {
  readonly runtime: Runtime;
  readonly root: AbsolutePath;
  readonly host: string;
  readonly timeoutMs: number;
  readonly declaredStart: string | undefined;
  readonly freePort: (host: string) => Promise<number | undefined>;
  readonly boot: (command: string, dir: AbsolutePath, port: number) => Promise<BaseBoot>;
  readonly measure: (baseUrl: string) => Promise<readonly RouteMeasure[]>;
}

export type SameRunStep = "worktree" | "install" | "port" | "start" | "measure";

export type SameRunBase =
  | { readonly kind: "measured"; readonly commit: string; readonly measures: readonly RouteMeasure[] }
  | { readonly kind: "failed"; readonly step: SameRunStep; readonly detail: string };

const failedAt = (step: SameRunStep, detail: string): SameRunBase => ({ kind: "failed", step, detail });

const firstLine = (error: unknown): string =>
  error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);

const onboardOf = (deps: SameRunDeps) => projectFilesAt(deps.runtime, deps.root).read(ONBOARD_FILE);

const serveAndMeasure = async (deps: SameRunDeps, dir: AbsolutePath, commit: string): Promise<SameRunBase> => {
  const installed = installFrozen(deps.runtime, dir, nowMs(deps.runtime) + deps.timeoutMs);
  if (!installed.ok) return failedAt("install", installed.error.detail);
  const port = await deps.freePort(deps.host);
  if (port === undefined) return failedAt("port", deps.host);
  const start = devStart(projectFilesAt(deps.runtime, dir), {
    declared: deps.declaredStart,
    onboard: parseOnboard(onboardOf(deps)),
    host: deps.host,
    port,
  });
  if (start === undefined) return failedAt("start", "no start command");
  const booted = await deps.boot(start.command, dir, port);
  if ("detail" in booted) return failedAt("start", booted.detail);
  try {
    const measures = await deps.measure(`http://${deps.host}:${String(port)}`);
    return { kind: "measured", commit, measures };
  } catch (error: unknown) {
    return failedAt("measure", firstLine(error));
  } finally {
    await booted.app.stop();
  }
};

export const withSameRunBase = async (deps: SameRunDeps): Promise<SameRunBase> => {
  const commit = resolveBase(gitAt(deps.runtime, deps.root), undefined);
  const dir = scratchDir(deps.runtime, deps.root, SAME_RUN_PREFIX);
  const added = deps.runtime.gitWith(["worktree", "add", "--detach", "--force", dir, commit], deps.root, {});
  if (!added.ok) {
    removeScratch(deps.runtime, deps.root, dir);
    return failedAt("worktree", added.stderr.trim().split("\n").pop() ?? "");
  }
  try {
    return await serveAndMeasure(deps, dir, commit);
  } finally {
    removeScratch(deps.runtime, deps.root, dir);
  }
};

export const sameRunPages = (base: SameRunBase, current: readonly RouteMeasure[]): readonly UxPage[] => {
  if (base.kind === "failed")
    return [
      {
        feature: PERF_FEATURE,
        route: "*",
        viewport: 1440,
        issues: [
          issue("perf/regression", "same-run-base", `base not measured (${base.step}): ${base.detail}`, {
            advisory: true,
            unverified: true,
          }),
        ],
      },
    ];
  return current.flatMap((measure): UxPage[] => {
    const before = base.measures.find((item) => item.route === measure.route);
    if (before === undefined) return [];
    const then = summarize(before.samples);
    const now = summarize(measure.samples);
    const spread = sampleBy((metric) => Math.max(then.spread[metric], now.spread[metric]));
    const worse = regressions(then.sample, now.sample, spread);
    return [
      {
        feature: PERF_FEATURE,
        route: measure.route,
        viewport: 1440,
        issues: worse.map((item) =>
          issue(
            "perf/regression",
            item.metric,
            `same-run base ${base.commit.slice(0, 12)}: ${item.metric} ${String(Math.round(item.base))} → ${String(Math.round(item.now))}`,
            { advisory: true },
          ),
        ),
      },
    ];
  });
};
