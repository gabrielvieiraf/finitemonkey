import type { Browser } from "playwright-core";

import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { fmPaths } from "../task/paths.js";
import type { LookConfig } from "./config.js";
import { routeLists } from "./config.js";
import type { UiScreen } from "./contract.js";
import { destructiveIssues, draftIssues, FLOW_FEATURE, flowPages, type FlowSpec } from "./flow.js";
import { journeyPages, JOURNEYS_FEATURE, listJourneys } from "./journey.js";
import { crawlFlow, type FlowRequest, tryDestructive, tryDraft } from "./node-flow.js";
import { measureJourney } from "./node-journey.js";
import type { UxPage } from "./ux.js";
import type { ModeMap } from "./ux-features.js";

const on = (modes: ModeMap, feature: string): boolean => (modes[feature] ?? "off") !== "off";

const firstLine = (error: unknown): string =>
  error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);

export const flowSpec = (config: LookConfig, screens: readonly UiScreen[]): FlowSpec => ({
  entry: config.flow.entry,
  declared: config.routes.filter((route) => !route.includes("?")),
  terminal: [...config.flow.terminal, ...screens.filter((screen) => screen.terminal).map((screen) => screen.screen)],
  steps: Object.fromEntries(
    screens.flatMap((screen) => (screen.stepsMax === undefined ? [] : [[screen.screen, screen.stepsMax]])),
  ),
  back: Object.fromEntries(
    screens.flatMap((screen) => (screen.back === undefined ? [] : [[screen.screen, screen.back]])),
  ),
});

const merged = (base: Readonly<Record<string, readonly string[]>>, screens: readonly UiScreen[]) => {
  const out: Record<string, readonly string[]> = { ...base };
  for (const screen of screens.filter((item) => item.destructive.length > 0))
    out[screen.screen] = [...(base[screen.screen] ?? []), ...screen.destructive];
  return out;
};

const flowRun = async (browser: Browser, request: FlowRequest, config: LookConfig, screens: readonly UiScreen[]) => {
  const spec = flowSpec(config, screens);
  const nodes = await crawlFlow(browser, request, spec.declared, spec.back);
  const destructive = [];
  for (const [route, selectors] of Object.entries(merged(routeLists(config.flow.destructive), screens)))
    for (const selector of selectors)
      destructive.push(
        await tryDestructive(browser, request, route, selector).catch((error: unknown) => ({
          route,
          selector,
          confirmed: false,
          undo: false,
          error: firstLine(error),
        })),
      );
  const drafts = [];
  for (const [route, selectors] of Object.entries(routeLists(config.flow.drafts)))
    for (const selector of selectors)
      drafts.push(
        await tryDraft(browser, request, route, selector).catch((error: unknown) => ({
          route,
          selector,
          kept: false,
          error: firstLine(error),
        })),
      );
  return [...flowPages(nodes, spec), ...destructiveIssues(destructive), ...draftIssues(drafts)];
};

export const sessionPages = async (
  browser: Browser,
  input: {
    readonly runtime: Runtime;
    readonly root: AbsolutePath;
    readonly config: LookConfig;
    readonly modes: ModeMap;
    readonly screens: readonly UiScreen[];
    readonly request: FlowRequest;
  },
): Promise<readonly UxPage[]> => {
  const pages: UxPage[] = [];
  if (on(input.modes, FLOW_FEATURE))
    pages.push(...(await flowRun(browser, input.request, input.config, input.screens)));
  if (on(input.modes, JOURNEYS_FEATURE)) {
    const states = listJourneys(input.runtime, fmPaths(input.root));
    const outcomes = [];
    for (const state of states.filter((item) => item.approved && item.journey !== undefined))
      if (state.journey !== undefined) outcomes.push(await measureJourney(browser, input.request, state.journey));
    pages.push(...journeyPages(states, outcomes));
  }
  return pages;
};
