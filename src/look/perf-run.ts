import type { Browser } from "playwright-core";

import { fmPaths } from "../task/paths.js";
import { sameRunPages, withSameRunBase } from "./base-run.js";
import { buildBundleSize } from "./bundle.js";
import { nodeSameRunDeps } from "./node-base.js";
import type { FlowRequest } from "./node-flow.js";
import { measureRoute, type PerfAction } from "./node-perf.js";
import { perfOutcome, readPerf, type RouteMeasure, writePerf } from "./perf.js";
import { fileQueryLog, queryLogPath } from "./queries.js";
import type { UxPage } from "./ux.js";
import type { SessionInput } from "./ux-sessions.js";

const actionsFor = (input: SessionInput): Readonly<Record<string, PerfAction>> => {
  const out: Record<string, PerfAction> = {};
  for (const screen of input.screens) if (screen.primaryAction !== undefined) out[screen.screen] = screen.primaryAction;
  for (const entry of input.config.perf.actions) {
    const match = /^(\S+)\s+(\S+)\s+(.+)$/.exec(entry.trim());
    if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined)
      out[match[1]] = { role: match[2], name: match[3].trim() };
  }
  return out;
};

const measureAll = async (
  browser: Browser,
  input: SessionInput,
  request: FlowRequest,
): Promise<readonly RouteMeasure[]> => {
  const actions = actionsFor(input);
  const { perf } = input.config;
  const queryLog =
    perf.queriesLog === undefined ? undefined : fileQueryLog(input.runtime, queryLogPath(input.root, perf.queriesLog));
  const measures = [];
  for (const route of input.config.routes.filter((item) => !item.includes("?")))
    measures.push(
      await measureRoute(browser, request, route, {
        runs: perf.runs,
        queriesHeader: perf.queriesHeader,
        action: actions[route],
        queryLog,
      }),
    );
  return measures;
};

export const withBuildBundle = (
  measures: readonly RouteMeasure[],
  bytes: number | undefined,
): readonly RouteMeasure[] =>
  bytes === undefined
    ? measures
    : measures.map((measure) => ({ ...measure, samples: measure.samples.map((sample) => ({ ...sample, js: bytes })) }));

const sameRun = async (browser: Browser, input: SessionInput, current: readonly RouteMeasure[]) => {
  const base = await withSameRunBase(
    nodeSameRunDeps({
      runtime: input.runtime,
      root: input.root,
      host: input.config.host,
      timeoutMs: input.config.timeoutS * 1000,
      declaredStart: input.config.start,
      measure: (baseUrl) => measureAll(browser, input, { ...input.request, baseUrl }),
    }),
  );
  return sameRunPages(base, current);
};

export const perfRun = async (browser: Browser, input: SessionInput): Promise<readonly UxPage[]> => {
  const paths = fmPaths(input.root);
  const raw = await measureAll(browser, input, input.request);
  const { perf } = input.config;
  const bundle = perf.bundle === "build" ? buildBundleSize(input.runtime, input.root, perf.manifest) : undefined;
  const outcome = perfOutcome(
    withBuildBundle(raw, bundle?.bytes),
    readPerf(input.runtime, paths),
    input.tree,
    input.runtime.now(),
  );
  writePerf(input.runtime, paths, outcome.store);
  const shadow = perf.base === "same-run" ? await sameRun(browser, input, raw) : [];
  return [...outcome.pages, ...shadow];
};
