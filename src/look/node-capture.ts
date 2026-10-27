import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { Browser, Page } from "playwright-core";

import { MEASURE_SCRIPT, type PageMeasure, parseMeasure } from "./measure.js";

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

const watch = (page: Page): { readonly errors: string[]; readonly failed: string[] } => {
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
}

const captureOne = async (
  browser: Browser,
  request: CaptureRequest,
  route: string,
  viewport: number,
): Promise<PageResult> => {
  const context = await browser.newContext({ viewport: { width: viewport, height: HEIGHT }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const events = watch(page);
  const path = join(request.dir, `${slugOf(route)}-${String(viewport)}.png`);
  const loadError = await loadAndShoot(page, `${request.baseUrl}${route}`, path, request.timeoutMs);
  const measure = loadError === undefined ? parseMeasure(await page.evaluate(MEASURE_SCRIPT)) : undefined;
  await context.close();
  return { route, viewport, path, consoleErrors: events.errors, failedRequests: events.failed, measure, loadError };
};

export const captureAll = async (browser: Browser, request: CaptureRequest): Promise<readonly PageResult[]> => {
  mkdirSync(request.dir, { recursive: true });
  const results: PageResult[] = [];
  for (const route of request.routes) {
    for (const viewport of request.viewports) results.push(await captureOne(browser, request, route, viewport));
  }
  return results;
};
