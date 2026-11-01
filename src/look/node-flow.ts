import type { Browser, Page } from "playwright-core";

import { DESTRUCTIVE_NAME, type DestructiveResult, type DraftResult, type FlowNode, UNDO_NAME } from "./flow.js";
import { crawl, type CrawlPage } from "./flow-crawl.js";
import { blockExternal } from "./node-ux.js";

const SETTLE_MS = 400;
const DRAFT_MARK = "draft-kept-7341";

export interface FlowRequest {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly isolate: boolean;
  readonly headers?: Readonly<Record<string, string>>;
}

export const withPage = async <T>(
  browser: Browser,
  request: FlowRequest,
  run: (page: Page) => Promise<T>,
): Promise<T> => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  if (request.isolate) await blockExternal(context, new Set());
  if (request.headers !== undefined && Object.keys(request.headers).length > 0)
    await context.setExtraHTTPHeaders({ ...request.headers });
  try {
    return await run(await context.newPage());
  } finally {
    await context.close();
  }
};

const LINKS = `[...document.querySelectorAll("a[href]")].map((a) => a.href)`;
const NAV_MARK = "data-fm-nav";
const CLICKABLES = `(() => {
  const destructive = new RegExp(${JSON.stringify(DESTRUCTIVE_NAME.source)}, "i");
  const all = [...document.querySelectorAll('[role=link]:not([href]), [role=button], button')]
    .filter((el) => !el.closest("form") && !el.closest("a[href]") && !el.disabled)
    .filter((el) => el.getBoundingClientRect().height > 0)
    .filter((el) => !destructive.test((el.getAttribute("aria-label") || el.textContent || "").trim()));
  all.forEach((el, index) => el.setAttribute("${NAV_MARK}", String(index)));
  return all.length;
})()`;

export const crawlPage = (page: Page, request: FlowRequest): CrawlPage => ({
  visit: async (route) => {
    await page.goto(`${request.baseUrl}${route}`, { waitUntil: "networkidle", timeout: request.timeoutMs });
  },
  links: async () => {
    const raw: unknown = await page.evaluate(LINKS);
    return (Array.isArray(raw) ? raw : []).flatMap((href: unknown) => (typeof href === "string" ? [href] : []));
  },
  clickables: async () => {
    const count: unknown = await page.evaluate(CLICKABLES);
    return typeof count === "number" ? count : 0;
  },
  click: async (index) => {
    const before = page.url();
    await page
      .locator(`[${NAV_MARK}="${String(index)}"]`)
      .first()
      .click({ timeout: 2000 });
    await page.waitForURL((url) => url.href !== before, { timeout: SETTLE_MS * 2 }).catch(() => undefined);
  },
  url: () => page.url(),
  hasBack: async (selector) => (await page.locator(selector).count()) > 0,
});

export const crawlFlow = async (
  browser: Browser,
  request: FlowRequest,
  routes: readonly string[],
  backs: Readonly<Record<string, string>>,
): Promise<readonly FlowNode[]> =>
  withPage(browser, request, async (page) => {
    page.on("dialog", (dialog) => {
      void dialog.dismiss().catch(() => undefined);
    });
    return crawl(crawlPage(page, request), request.baseUrl, routes, backs);
  });

const MODAL = `[...document.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog]")].some((el) => el.getBoundingClientRect().height > 0)`;

export const tryDestructive = async (
  browser: Browser,
  request: FlowRequest,
  route: string,
  selector: string,
): Promise<DestructiveResult> =>
  withPage(browser, request, async (page) => {
    const seen = { dialog: false };
    page.on("dialog", (dialog) => {
      seen.dialog = true;
      void dialog.dismiss().catch(() => undefined);
    });
    await page.goto(`${request.baseUrl}${route}`, { waitUntil: "networkidle", timeout: request.timeoutMs });
    await page.locator(selector).first().click({ timeout: 2000 });
    await page.waitForTimeout(SETTLE_MS);
    const modal = (await page.evaluate(MODAL)) === true;
    const undo =
      (await page.getByRole("button", { name: UNDO_NAME }).count()) +
        (await page.getByRole("link", { name: UNDO_NAME }).count()) >
      0;
    return { route, selector, confirmed: seen.dialog || modal, undo };
  });

export const tryDraft = async (
  browser: Browser,
  request: FlowRequest,
  route: string,
  selector: string,
): Promise<DraftResult> =>
  withPage(browser, request, async (page) => {
    await page.goto(`${request.baseUrl}${route}`, { waitUntil: "networkidle", timeout: request.timeoutMs });
    await page.locator(selector).first().fill(DRAFT_MARK);
    await page.waitForTimeout(SETTLE_MS);
    await page.reload({ waitUntil: "networkidle" });
    const value = await page
      .locator(selector)
      .first()
      .inputValue()
      .catch(() => "");
    return { route, selector, kept: value === DRAFT_MARK };
  });
