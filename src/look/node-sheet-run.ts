import { join } from "node:path";

import type { Browser, Page } from "playwright-core";

import { stopApp } from "../app/node-process.js";
import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { type FmPaths, fmPaths } from "../task/paths.js";
import { withMock } from "./config.js";
import { contractStates } from "./contract.js";
import { slugOf } from "./node-capture.js";
import { launchBrowser, loadPlaywright } from "./node-playwright.js";
import { blockExternal } from "./node-ux.js";
import { lookDir } from "./paths.js";
import { parseProbe, PROBE_SCRIPT } from "./probe.js";
import { runInPage } from "./probe-dom.js";
import { bootApp, type LookRun, prepare, type Ready } from "./run.js";
import { buildSheet, diffSheets, type DimensionChange, type MeasuredView, type Sheet, SHEET_WIDTHS } from "./sheet.js";
import { renderSheet } from "./sheet-render.js";
import { approvedSheetPath, readSheet, rootSelector } from "./sheet-store.js";
import { uxSetup } from "./ux-features.js";

const measure = async (page: Page, url: string, selector: string, timeoutMs: number) => {
  await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
  const probe = parseProbe(await page.evaluate(PROBE_SCRIPT));
  const root: unknown = await page.evaluate(runInPage(rootSelector.toString(), ["document", JSON.stringify(selector)]));
  return { probe, root: typeof root === "string" ? root : undefined };
};

const views = async (
  browser: Browser,
  ready: Ready,
  route: string,
  selector: string,
  states: readonly { readonly state: string; readonly mock: string | undefined }[],
) => {
  const base = `http://${ready.config.host}:${String(ready.config.port)}`;
  const timeout = ready.config.timeoutS * 1000;
  const out: MeasuredView[] = [];
  const open = async (width: number) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    await blockExternal(context, new Set());
    return { context, page: await context.newPage() };
  };
  for (const width of SHEET_WIDTHS) {
    const { context, page } = await open(width);
    out.push({
      width,
      state: "ideal",
      ...(await measure(page, `${base}${route}`, selector, timeout).catch(() => ({
        probe: undefined,
        root: undefined,
      }))),
    });
    await context.close();
  }
  const widest = Math.max(...SHEET_WIDTHS);
  for (const spec of states.filter((item) => item.mock !== undefined && item.state !== "ideal")) {
    const { context, page } = await open(widest);
    const url = `${base}${withMock(route, spec.mock ?? "")}`;
    out.push({
      width: widest,
      state: spec.state,
      ...(await measure(page, url, selector, timeout).catch(() => ({ probe: undefined, root: undefined }))),
    });
    await context.close();
  }
  return out;
};

export type SheetRun =
  | Exclude<LookRun, { readonly kind: "done" }>
  | {
      readonly kind: "done";
      readonly root: AbsolutePath;
      readonly sheet: Sheet;
      readonly html: string;
      readonly json: string;
      readonly diff: readonly DimensionChange[] | undefined;
    };

const write = (runtime: Runtime, paths: FmPaths, sheet: Sheet) => {
  const dir = lookDir(paths, sheet.tree);
  const html = toAbsolutePath(join(dir, `sheet-${slugOf(sheet.route)}.html`));
  const json = toAbsolutePath(join(dir, `sheet-${slugOf(sheet.route)}.json`));
  runtime.writeText(html, renderSheet(sheet));
  runtime.writeText(json, `${JSON.stringify(sheet, null, 2)}\n`);
  return { html, json };
};

export const runSheet = async (
  runtime: Runtime,
  cwd: AbsolutePath,
  route: string,
  selector: string,
): Promise<SheetRun> => {
  const ready = prepare(runtime, cwd);
  if ("kind" in ready) return ready.kind === "done" ? { kind: "not_configured" } : ready;
  const app = await bootApp(ready);
  if (app !== undefined && "detail" in app) return { kind: "app_failed", detail: app.detail };
  try {
    const playwright = await loadPlaywright(ready.root);
    if (playwright === undefined) return { kind: "playwright_missing" };
    const browser = await launchBrowser(playwright);
    if (browser === undefined) return { kind: "browser_missing" };
    try {
      const setup = uxSetup(runtime, ready.root, ready.config, { "ds-adherence": "shadow" });
      const states = contractStates(setup.screens, ready.config.states)[route] ?? [];
      const measured = await views(browser, ready, route, selector, states);
      const sheet = buildSheet({ route, selector, tree: ready.tree, views: measured, tokens: setup.tokens });
      const paths = fmPaths(ready.root);
      const files = write(runtime, paths, sheet);
      const approved = readSheet(runtime, approvedSheetPath(paths, route));
      return {
        kind: "done",
        root: ready.root,
        sheet,
        ...files,
        diff: approved === undefined ? undefined : diffSheets(approved, sheet),
      };
    } finally {
      await browser.close();
    }
  } finally {
    if (app !== undefined) await stopApp(app);
  }
};
