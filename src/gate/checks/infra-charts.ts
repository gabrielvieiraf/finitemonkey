import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../../core/brand.js";
import { nowMs } from "../../core/clock.js";
import { configList, type ConfigTree } from "../../git/project-config.js";
import { composeFindings } from "../../infra/compose.js";
import { chartFile, chartRoots, renderChart, type Rendered } from "../../infra/helm.js";
import { manifestChanges } from "../../infra/manifests.js";
import { COMPOSE_FILE, type PlanFinding } from "../../infra/plan-gate.js";
import { fileAt } from "../git.js";
import { removeScratch, scratchDir } from "../isolated.js";
import type { GateContext } from "../types.js";

const RENDER_TIMEOUT_MS = 120_000;

export type ExtraFindings =
  | { readonly kind: "findings"; readonly findings: readonly PlanFinding[] }
  | { readonly kind: "not_verified"; readonly detail: string };

const changedPaths = (ctx: GateContext): readonly string[] =>
  ctx.changes.flatMap((change) => [change.path, change.oldPath ?? ""]).filter((path) => path !== "");

const headText = (ctx: GateContext, path: string): string => {
  const read = ctx.runtime.readText(toAbsolutePath(join(ctx.paths.root, path)));
  return read.ok ? read.value : "";
};

export const composeChangeFindings = (ctx: GateContext): readonly PlanFinding[] =>
  ctx.changes
    .filter((change) => COMPOSE_FILE.test(change.oldPath ?? change.path))
    .flatMap((change) =>
      composeFindings(
        fileAt(ctx.git, ctx.base, change.oldPath ?? change.path) ?? "",
        change.status === "D" ? "" : headText(ctx, change.path),
      ),
    );

const renderAll = (
  ctx: GateContext,
  cwd: AbsolutePath,
  charts: readonly string[],
  values: readonly string[],
): readonly Rendered[] =>
  charts.map((chart) =>
    renderChart(ctx.runtime, {
      cwd,
      chart,
      values,
      timeoutMs: Math.max(1_000, Math.min(RENDER_TIMEOUT_MS, ctx.deadline - nowMs(ctx.runtime))),
    }),
  );

const renderBase = (
  ctx: GateContext,
  charts: readonly string[],
  values: readonly string[],
): readonly Rendered[] | string => {
  const dir = scratchDir(ctx.runtime, ctx.paths.root, "helm");
  const added = ctx.runtime.gitWith(["worktree", "add", "--detach", "--force", dir, ctx.base], ctx.paths.root, {});
  if (!added.ok) return `worktree: ${added.stderr.trim()}`;
  try {
    return renderAll(ctx, dir, charts, values);
  } finally {
    removeScratch(ctx.runtime, ctx.paths.root, dir);
  }
};

const textOf = (rendered: Rendered | undefined): string => (rendered?.ok === true ? rendered.text : "");

const failureOf = (rendered: readonly Rendered[]): string | undefined =>
  rendered.flatMap((item) => (item.ok ? [] : [item.detail]))[0];

export const chartFindings = (ctx: GateContext, config: ConfigTree): ExtraFindings => {
  const atHead = (dir: string): boolean =>
    ctx.runtime.stat(toAbsolutePath(join(ctx.paths.root, chartFile(dir)))) !== undefined;
  const atBase = (dir: string): boolean => fileAt(ctx.git, ctx.base, chartFile(dir)) !== undefined;
  const charts = chartRoots(changedPaths(ctx), (dir) => atHead(dir) || atBase(dir));
  if (charts.length === 0) return { kind: "findings", findings: [] };
  const values = configList(config, "infra_plan", "helm_values");
  const headCharts = charts.filter(atHead);
  const baseCharts = charts.filter(atBase);
  const after = renderAll(ctx, ctx.paths.root, headCharts, values);
  const headFailure = failureOf(after);
  if (headFailure !== undefined) return { kind: "not_verified", detail: headFailure };
  const before = baseCharts.length === 0 ? [] : renderBase(ctx, baseCharts, values);
  if (typeof before === "string") return { kind: "not_verified", detail: before };
  const baseFailure = failureOf(before);
  if (baseFailure !== undefined) return { kind: "not_verified", detail: baseFailure };
  const findings = charts.flatMap((chart) =>
    manifestChanges(textOf(before[baseCharts.indexOf(chart)]), textOf(after[headCharts.indexOf(chart)])),
  );
  return { kind: "findings", findings };
};
