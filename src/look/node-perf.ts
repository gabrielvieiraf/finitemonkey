import type { Browser, Page } from "playwright-core";

import { isRecord } from "../core/parsed.js";
import { type FlowRequest } from "./node-flow.js";
import { blockExternal } from "./node-ux.js";
import type { RouteMeasure, Sample } from "./perf.js";

const SETTLE_MS = 300;
const ACTION_LIMIT_MS = 2000;
const POLL_MS = 20;

const OBSERVE = `(() => {
  window.__fmPerf = { lcp: 0, cls: 0, tbt: 0 };
  const watch = (type, fn) => { try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) fn(entry); }).observe({ type, buffered: true }); } catch {} };
  watch("largest-contentful-paint", (entry) => { window.__fmPerf.lcp = entry.startTime; });
  watch("layout-shift", (entry) => { if (!entry.hadRecentInput) window.__fmPerf.cls += entry.value; });
  watch("longtask", (entry) => { window.__fmPerf.tbt += Math.max(0, entry.duration - 50); });
})()`;

const READ = `(() => ({
  ...window.__fmPerf,
  js: performance.getEntriesByType("resource").filter((entry) => entry.initiatorType === "script" || /\\.m?js(\\?|$)/.test(entry.name)).reduce((sum, entry) => sum + (entry.encodedBodySize || entry.transferSize || 0), 0),
}))()`;

const ARM = `(() => {
  window.__fmFirst = 0;
  window.__fmIndicator = false;
  const observer = new MutationObserver(() => {
    if (window.__fmFirst) return;
    window.__fmFirst = performance.now();
    window.__fmIndicator = !!document.querySelector("[role=progressbar], [aria-busy=true], progress");
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  window.__fmT0 = performance.now();
})()`;

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

type Role = Parameters<Page["getByRole"]>[0];
const ROLES: readonly Role[] = ["button", "link", "tab", "menuitem", "checkbox"];

export interface PerfAction {
  readonly role: string;
  readonly name: string;
}

const timeAction = async (page: Page, action: PerfAction): Promise<RouteMeasure["action"]> => {
  const role = ROLES.find((item) => item === action.role);
  if (role === undefined) return undefined;
  const target = page.getByRole(role, { name: action.name, exact: true }).first();
  if ((await target.count()) === 0) return undefined;
  await page.evaluate(ARM);
  await target.click({ timeout: ACTION_LIMIT_MS });
  const started = Date.now();
  while (Date.now() - started < ACTION_LIMIT_MS && num(await page.evaluate("window.__fmFirst")) === 0)
    await page.waitForTimeout(POLL_MS);
  const raw: unknown = await page.evaluate(
    "({ first: window.__fmFirst, start: window.__fmT0, indicator: window.__fmIndicator })",
  );
  if (!isRecord(raw)) return undefined;
  const first = num(raw["first"]);
  return {
    name: `${action.role} "${action.name}"`,
    ms: first === 0 ? ACTION_LIMIT_MS : first - num(raw["start"]),
    indicator: raw["indicator"] === true,
  };
};

const once = async (
  browser: Browser,
  request: FlowRequest,
  route: string,
  queriesHeader: string | undefined,
  action: PerfAction | undefined,
): Promise<{ readonly sample: Sample; readonly action: RouteMeasure["action"] }> => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (request.isolate) await blockExternal(context, new Set());
  try {
    const page = await context.newPage();
    await page.addInitScript(OBSERVE);
    const response = await page.goto(`${request.baseUrl}${route}`, {
      waitUntil: "networkidle",
      timeout: request.timeoutMs,
    });
    await page.waitForTimeout(SETTLE_MS);
    const raw: unknown = await page.evaluate(READ);
    const values = isRecord(raw) ? raw : {};
    const header = queriesHeader === undefined ? undefined : response?.headers()[queriesHeader.toLowerCase()];
    const sample: Sample = {
      lcp: num(values["lcp"]),
      cls: num(values["cls"]),
      tbt: num(values["tbt"]),
      js: num(values["js"]),
      queries: header === undefined ? 0 : Number(header) || 0,
    };
    return { sample, action: action === undefined ? undefined : await timeAction(page, action) };
  } finally {
    await context.close();
  }
};

export const measureRoute = async (
  browser: Browser,
  request: FlowRequest,
  route: string,
  options: {
    readonly runs: number;
    readonly queriesHeader: string | undefined;
    readonly action: PerfAction | undefined;
  },
): Promise<RouteMeasure> => {
  const samples: Sample[] = [];
  let action: RouteMeasure["action"];
  for (let run = 0; run < options.runs; run += 1) {
    const result = await once(browser, request, route, options.queriesHeader, run === 0 ? options.action : undefined);
    samples.push(result.sample);
    action ??= result.action;
  }
  return { route, samples, action };
};
