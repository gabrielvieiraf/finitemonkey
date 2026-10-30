import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { FmPaths } from "../task/paths.js";
import { LOOK_DIR } from "./paths.js";
import { issue, type UxIssue, type UxPage } from "./ux.js";

export const PERF_FEATURE = "perf-budget";
export const PERF_FILE = "perf-base.json";
export const DEFAULT_RUNS = 3;
export const ACTION_FAIL_MS = 400;
export const ACTION_WARN_MS = 200;
export const METRICS = ["lcp", "cls", "tbt", "js", "queries"] as const;

export type Metric = (typeof METRICS)[number];
export type Sample = Readonly<Record<Metric, number>>;

const FLOOR: Readonly<Record<Metric, number>> = { lcp: 150, cls: 0.05, tbt: 60, js: 10_240, queries: 0.5 };
const RELATIVE: Readonly<Record<Metric, number>> = { lcp: 0.2, cls: 0, tbt: 0.25, js: 0.1, queries: 0.2 };
const SPREAD = 3;

export interface RouteBase {
  readonly sample: Sample;
  readonly last: Sample;
  readonly tree: string;
  readonly at: string;
}

export interface Acceptance {
  readonly route: string;
  readonly tree: string;
  readonly reason: string;
  readonly by: string;
  readonly at: string;
}

export interface PerfStore {
  readonly routes: Readonly<Record<string, RouteBase>>;
  readonly accepted: readonly Acceptance[];
}

export const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length === 0
    ? 0
    : sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const deviation = (values: readonly number[]): number => {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
};

export const sampleBy = (fn: (metric: Metric) => number): Sample => ({
  lcp: fn("lcp"),
  cls: fn("cls"),
  tbt: fn("tbt"),
  js: fn("js"),
  queries: fn("queries"),
});

export const summarize = (samples: readonly Sample[]): { readonly sample: Sample; readonly spread: Sample } => {
  const pick = (metric: Metric): readonly number[] => samples.map((sample) => sample[metric]);
  return { sample: sampleBy((metric) => median(pick(metric))), spread: sampleBy((metric) => deviation(pick(metric))) };
};

export const tolerance = (metric: Metric, base: number, spread: number): number =>
  Math.max(FLOOR[metric], base * RELATIVE[metric], SPREAD * spread);

export const regressions = (
  base: Sample,
  current: Sample,
  spread: Sample,
): readonly { readonly metric: Metric; readonly base: number; readonly now: number }[] =>
  METRICS.flatMap((metric) =>
    current[metric] > base[metric] + tolerance(metric, base[metric], spread[metric])
      ? [{ metric, base: base[metric], now: current[metric] }]
      : [],
  );

export const ratcheted = (base: Sample, current: Sample): Sample =>
  sampleBy((metric) => Math.min(base[metric], current[metric]));

const sampleOf = (value: unknown): Sample | undefined => {
  if (!isRecord(value) || !METRICS.every((metric) => typeof value[metric] === "number")) return undefined;
  return sampleBy((metric) => {
    const item = value[metric];
    return typeof item === "number" ? item : 0;
  });
};

export const perfPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, LOOK_DIR, PERF_FILE));

export const readPerf = (runtime: Pick<Runtime, "readText">, paths: FmPaths): PerfStore => {
  const raw = runtime.readText(perfPath(paths));
  const parsed = raw.ok ? parseJsonObject(raw.value) : undefined;
  if (parsed?.ok !== true) return { routes: {}, accepted: [] };
  const routes = isRecord(parsed.value["routes"]) ? parsed.value["routes"] : {};
  const accepted = Array.isArray(parsed.value["accepted"]) ? parsed.value["accepted"] : [];
  return {
    routes: Object.fromEntries(
      Object.entries(routes).flatMap(([route, value]): [string, RouteBase][] => {
        const sample = isRecord(value) ? sampleOf(value["sample"]) : undefined;
        const last = isRecord(value) ? (sampleOf(value["last"]) ?? sample) : undefined;
        return sample === undefined ||
          last === undefined ||
          !isRecord(value) ||
          typeof value["tree"] !== "string" ||
          typeof value["at"] !== "string"
          ? []
          : [[route, { sample, last, tree: value["tree"], at: value["at"] }]];
      }),
    ),
    accepted: accepted.flatMap((item: unknown): Acceptance[] =>
      isRecord(item) && typeof item["route"] === "string" && typeof item["tree"] === "string"
        ? [
            {
              route: item["route"],
              tree: item["tree"],
              reason: typeof item["reason"] === "string" ? item["reason"] : "",
              by: typeof item["by"] === "string" ? item["by"] : "",
              at: typeof item["at"] === "string" ? item["at"] : "",
            },
          ]
        : [],
    ),
  };
};

export const writePerf = (runtime: Pick<Runtime, "writeText">, paths: FmPaths, store: PerfStore): boolean =>
  runtime.writeText(perfPath(paths), `${JSON.stringify(store, null, 2)}\n`).ok;

export interface RouteMeasure {
  readonly route: string;
  readonly samples: readonly Sample[];
  readonly action: { readonly ms: number; readonly indicator: boolean; readonly name: string } | undefined;
}

const UNITS: Readonly<Record<Metric, string>> = { lcp: "ms", cls: "", tbt: "ms", js: " bytes", queries: " queries" };

const show = (metric: Metric, value: number): string =>
  `${metric === "cls" ? value.toFixed(3) : String(Math.round(value))}${UNITS[metric]}`;

export const actionIssues = (measure: RouteMeasure): readonly UxIssue[] => {
  const action = measure.action;
  if (action === undefined || action.indicator) return [];
  if (action.ms > ACTION_FAIL_MS)
    return [
      issue(
        "perf/slow-action",
        action.name,
        `${String(Math.round(action.ms))} ms to the first visible change, with no indicator`,
      ),
    ];
  return action.ms > ACTION_WARN_MS
    ? [
        issue("perf/slow-action", action.name, `${String(Math.round(action.ms))} ms to the first visible change`, {
          advisory: true,
        }),
      ]
    : [];
};

export const perfOutcome = (
  measures: readonly RouteMeasure[],
  store: PerfStore,
  tree: string,
  now: string,
): { readonly pages: readonly UxPage[]; readonly store: PerfStore } => {
  const routes: Record<string, RouteBase> = { ...store.routes };
  const pages = measures.map((measure): UxPage => {
    const { sample, spread } = summarize(measure.samples);
    const base = store.routes[measure.route];
    const accepted = store.accepted.some((item) => item.route === measure.route && item.tree === tree);
    const worse = base === undefined ? [] : regressions(base.sample, sample, spread);
    routes[measure.route] = {
      sample: base === undefined ? sample : ratcheted(base.sample, sample),
      last: sample,
      tree,
      at: now,
    };
    const found = accepted
      ? []
      : worse.map((item) =>
          issue(
            "perf/regression",
            item.metric,
            `${item.metric} ${show(item.metric, item.base)} → ${show(item.metric, item.now)}`,
          ),
        );
    return {
      feature: PERF_FEATURE,
      route: measure.route,
      viewport: 1440,
      issues: [...found, ...actionIssues(measure)],
      metrics: { ...sample },
    };
  });
  return { pages, store: { routes, accepted: store.accepted } };
};

export const acceptRegression = (store: PerfStore, acceptance: Acceptance): PerfStore => {
  const base = store.routes[acceptance.route];
  return {
    routes: base === undefined ? store.routes : { ...store.routes, [acceptance.route]: { ...base, sample: base.last } },
    accepted: [...store.accepted, acceptance],
  };
};
