import { posix } from "node:path";

import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { HELM_FILE } from "./plan-gate.js";

export const CHART_FILE = "Chart.yaml";
export const HELM_RELEASE = "finitemonkey";

const DETAIL_LIMIT = 300;

const ancestors = (path: string): readonly string[] => {
  const dirs: string[] = [];
  let dir = posix.dirname(path);
  while (dir !== "." && dir !== "/" && dir !== "") {
    dirs.push(dir);
    dir = posix.dirname(dir);
  }
  return [...dirs, ""];
};

export const chartRoots = (paths: readonly string[], isChart: (dir: string) => boolean): readonly string[] => [
  ...new Set(
    paths
      .filter((path) => path !== "" && HELM_FILE.test(path))
      .flatMap((path) => {
        const root = ancestors(path).find(isChart);
        return root === undefined ? [] : [root];
      }),
  ),
];

export const chartFile = (dir: string): string => (dir === "" ? CHART_FILE : `${dir}/${CHART_FILE}`);

export interface HelmRender {
  readonly cwd: AbsolutePath;
  readonly chart: string;
  readonly values: readonly string[];
  readonly timeoutMs: number;
}

export type Rendered = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly detail: string };

export const renderChart = (runtime: Pick<Runtime, "exec">, render: HelmRender): Rendered => {
  const chart = render.chart === "" ? "." : render.chart;
  const result = runtime.exec({
    command: "helm",
    args: ["template", HELM_RELEASE, chart, ...render.values.flatMap((file) => ["--values", file])],
    cwd: render.cwd,
    timeoutMs: render.timeoutMs,
    env: { HELM_NAMESPACE: "default" },
  });
  if (!result.found) return { ok: false, detail: "helm not installed" };
  if (result.exitCode !== 0 || result.timedOut) {
    return { ok: false, detail: `${chart}: ${(result.stderr || result.stdout).trim().slice(-DETAIL_LIMIT)}` };
  }
  return { ok: true, text: result.stdout };
};
