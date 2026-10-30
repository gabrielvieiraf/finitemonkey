import type { Page } from "playwright-core";

import { sleep } from "../app/node-process.js";
import { withMock } from "./config.js";
import { type PagePass } from "./node-ux.js";
import { parseProbe, PROBE_SCRIPT } from "./probe.js";
import { runInPage } from "./probe-dom.js";
import {
  LOADING_BUDGET_MS,
  loadingIssues,
  type LoadingObservation,
  notCovered,
  stateIssues,
  STATES_FEATURE,
  type StatesOptions,
  type StateSpec,
  STATUS_WATCH_MS,
  statusIssues,
} from "./states.js";
import { hasIndicator, LIVE_SELECTOR, watchText } from "./states-dom.js";
import { issue, type UxIssue } from "./ux.js";

const POLL_MS = 40;

const watchScript = (ms: number): string =>
  runInPage(watchText.toString(), ["document", "window", String(ms), JSON.stringify(LIVE_SELECTOR)]);

export const changedWithoutLive = async (page: Page, ms = STATUS_WATCH_MS): Promise<readonly string[]> => {
  const raw: unknown = await page.evaluate(watchScript(ms));
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
};

const observeLoading = async (page: Page, url: string, skeleton: string): Promise<LoadingObservation> => {
  const seen = { pending: 0, loaded: false };
  const more = (): void => {
    seen.pending += 1;
  };
  const less = (): void => {
    seen.pending -= 1;
  };
  const done = (): void => {
    seen.loaded = true;
  };
  page.on("request", more);
  page.on("requestfinished", less);
  page.on("requestfailed", less);
  page.on("load", done);
  const started = Date.now();
  await page.goto(url, { waitUntil: "commit" });
  const script = runInPage(hasIndicator.toString(), ["document", JSON.stringify(skeleton)]);
  let indicator = false;
  let settledMs: number | undefined;
  while (Date.now() - started <= LOADING_BUDGET_MS && !indicator && settledMs === undefined) {
    indicator = (await page.evaluate(script).catch(() => false)) === true;
    if (seen.loaded && seen.pending <= 0) settledMs = Date.now() - started;
    await sleep(POLL_MS);
  }
  page.off("request", more);
  page.off("requestfinished", less);
  page.off("requestfailed", less);
  page.off("load", done);
  return { indicator, settledMs };
};

const tagged = (spec: StateSpec, route: string, found: readonly UxIssue[]): readonly UxIssue[] =>
  found.map((item) => ({ ...item, route, detail: `[${spec.state}] ${item.detail}` }));

const checkState = async (
  page: Page,
  at: { readonly route: string; readonly url: string },
  spec: StateSpec,
  options: StatesOptions,
): Promise<readonly UxIssue[]> => {
  if (spec.mock === undefined) return [notCovered(spec)];
  const route = withMock(at.route, spec.mock);
  const url = withMock(at.url, spec.mock);
  try {
    if (spec.state === "loading")
      return tagged(spec, route, loadingIssues(await observeLoading(page, url, options.skeleton ?? "")));
    await page.goto(url, { waitUntil: "networkidle" });
    const probe = parseProbe(await page.evaluate(PROBE_SCRIPT));
    if (probe === undefined) return [];
    return tagged(spec, route, [...stateIssues(spec, probe, options), ...statusIssues(await changedWithoutLive(page))]);
  } catch (error) {
    const detail = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
    return [
      issue("ui-states/not-covered", "body", `[${spec.state}] could not render: ${detail}`, {
        route,
        unverified: true,
      }),
    ];
  }
};

export const statesPass = (
  states: Readonly<Record<string, readonly StateSpec[]>>,
  options: StatesOptions,
): PagePass => ({
  feature: STATES_FEATURE,
  allWidths: false,
  run: async (page, at) => {
    if (at.route.includes("?")) return [];
    const found: UxIssue[] = [...statusIssues(await changedWithoutLive(page))];
    for (const spec of (states[at.route] ?? []).filter((item) => item.state !== "ideal"))
      found.push(...(await checkState(page, at, spec, options)));
    if ((states[at.route] ?? []).length > 0)
      await page.goto(at.url, { waitUntil: "networkidle" }).catch(() => undefined);
    return found;
  },
});
