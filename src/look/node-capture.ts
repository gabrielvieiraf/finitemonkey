import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Browser, Page } from "playwright-core";

import { MEASURE_SCRIPT, type PageMeasure, parseMeasure } from "./measure.js";
import { blockExternal, drawBoxes, type PagePass, probeOnce } from "./node-ux.js";
import type { ProbeBox } from "./probe.js";
import type { UxPage } from "./ux.js";

const HEIGHT = 900;
const MAX_EVENTS = 20;
const RESOURCE_ERROR = /^Failed to load resource\b/;

export interface PageResult {
  readonly route: string;
  readonly viewport: number;
  readonly path: string;
  readonly consoleErrors: readonly string[];
  readonly failedRequests: readonly string[];
  readonly measure: PageMeasure | undefined;
  readonly loadError: string | undefined;
}

export const slugOf = (route: string): string => {
  const slug = route
    .replace(/^\//, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "root" : slug.slice(0, 80);
};

const watch = (page: Page, blocked: ReadonlySet<string>): { readonly errors: string[]; readonly failed: string[] } => {
  const errors: string[] = [];
  const failed: string[] = [];
  const push = (list: string[], text: string): void => {
    if (list.length < MAX_EVENTS) list.push(text.slice(0, 200));
  };
  page.on("console", (message) => {
    if (message.type() === "error" && !RESOURCE_ERROR.test(message.text())) push(errors, message.text());
  });
  page.on("pageerror", (error) => {
    push(errors, error.message);
  });
  page.on("requestfailed", (request) => {
    if (blocked.has(request.url())) return;
    push(failed, `${request.method()} ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico"))
      push(failed, `${String(response.status())} ${response.url()}`);
  });
  return { errors, failed };
};

const loadAndShoot = async (page: Page, url: string, path: string, timeoutMs: number): Promise<string | undefined> => {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
  } catch (error) {
    return error instanceof Error ? error.message.split("\n")[0] : String(error);
  }
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  return undefined;
};

export interface CaptureRequest {
  readonly baseUrl: string;
  readonly routes: readonly string[];
  readonly viewports: readonly number[];
  readonly dir: string;
  readonly timeoutMs: number;
  readonly passes?: readonly PagePass[];
  readonly extraWidths?: readonly number[];
  readonly isolate?: boolean;
}

export interface CaptureOutput {
  readonly results: readonly PageResult[];
  readonly ux: readonly UxPage[];
  readonly blocked: readonly string[];
}

const runPasses = async (
  page: Page,
  request: CaptureRequest,
  at: { readonly route: string; readonly viewport: number; readonly url: string },
  only: (pass: PagePass) => boolean,
): Promise<readonly UxPage[]> => {
  const probe = probeOnce(page);
  const pages: UxPage[] = [];
  for (const pass of (request.passes ?? []).filter(only)) {
    const issues = await pass.run(page, { ...at, probe });
    const boxes = issues.flatMap((item): readonly ProbeBox[] => (item.box === undefined ? [] : [item.box]));
    await drawBoxes(page, boxes, join(request.dir, `${slugOf(at.route)}-${String(at.viewport)}.${pass.feature}.png`));
    pages.push({ feature: pass.feature, route: at.route, viewport: at.viewport, issues });
  }
  return pages;
};

interface Shot {
  readonly result: PageResult;
  readonly ux: readonly UxPage[];
}

const openPage = async (
  browser: Browser,
  request: CaptureRequest,
  viewport: number,
  blocked: Set<string>,
): Promise<{ readonly page: Page; readonly close: () => Promise<void> }> => {
  const context = await browser.newContext({ viewport: { width: viewport, height: HEIGHT }, reducedMotion: "reduce" });
  if (request.isolate === true) await blockExternal(context, blocked);
  return { page: await context.newPage(), close: () => context.close() };
};

const captureOne = async (
  browser: Browser,
  request: CaptureRequest,
  route: string,
  viewport: number,
  blocked: Set<string>,
): Promise<Shot> => {
  const { page, close } = await openPage(browser, request, viewport, blocked);
  const events = watch(page, blocked);
  const url = `${request.baseUrl}${route}`;
  const path = join(request.dir, `${slugOf(route)}-${String(viewport)}.png`);
  const loadError = await loadAndShoot(page, url, path, request.timeoutMs);
  const measure = loadError === undefined ? parseMeasure(await page.evaluate(MEASURE_SCRIPT)) : undefined;
  const ux = loadError === undefined ? await runPasses(page, request, { route, viewport, url }, () => true) : [];
  await close();
  return {
    result: { route, viewport, path, consoleErrors: events.errors, failedRequests: events.failed, measure, loadError },
    ux,
  };
};

const probeOnly = async (
  browser: Browser,
  request: CaptureRequest,
  route: string,
  viewport: number,
  blocked: Set<string>,
): Promise<readonly UxPage[]> => {
  const { page, close } = await openPage(browser, request, viewport, blocked);
  const url = `${request.baseUrl}${route}`;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: request.timeoutMs });
    return await runPasses(page, request, { route, viewport, url }, (pass) => pass.allWidths);
  } catch {
    return [];
  } finally {
    await close();
  }
};

export const captureAll = async (browser: Browser, request: CaptureRequest): Promise<CaptureOutput> => {
  mkdirSync(request.dir, { recursive: true });
  const results: PageResult[] = [];
  const ux: UxPage[] = [];
  const blocked = new Set<string>();
  const extra = (request.extraWidths ?? []).filter((width) => !request.viewports.includes(width));
  const wide = (request.passes ?? []).some((pass) => pass.allWidths);
  for (const route of request.routes) {
    for (const viewport of request.viewports) {
      const shot = await captureOne(browser, request, route, viewport, blocked);
      results.push(shot.result);
      ux.push(...shot.ux);
    }
    if (wide) for (const viewport of extra) ux.push(...(await probeOnly(browser, request, route, viewport, blocked)));
  }
  return { results, ux, blocked: [...blocked] };
};
