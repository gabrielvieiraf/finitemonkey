import type { Browser, Page } from "playwright-core";

import { type DestructiveResult, type DraftResult, type FlowNode, MAX_DEPTH, MAX_PAGES, UNDO_NAME } from "./flow.js";
import { blockExternal } from "./node-ux.js";

const SETTLE_MS = 400;
const DRAFT_MARK = "draft-kept-7341";

export interface FlowRequest {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly isolate: boolean;
}

export const withPage = async <T>(
  browser: Browser,
  request: FlowRequest,
  run: (page: Page) => Promise<T>,
): Promise<T> => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  if (request.isolate) await blockExternal(context, new Set());
  try {
    return await run(await context.newPage());
  } finally {
    await context.close();
  }
};

const LINKS = `[...document.querySelectorAll("a[href]")].map((a) => a.href)`;

const localRoute = (base: string, href: string): string | undefined => {
  try {
    const url = new URL(href, base);
    return url.origin === new URL(base).origin && url.protocol.startsWith("http")
      ? `${url.pathname}${url.search}`
      : undefined;
  } catch {
    return undefined;
  }
};

const nodeAt = async (page: Page, request: FlowRequest, route: string, back: string | undefined): Promise<FlowNode> => {
  await page.goto(`${request.baseUrl}${route}`, { waitUntil: "networkidle", timeout: request.timeoutMs });
  const raw: unknown = await page.evaluate(LINKS);
  const links = (Array.isArray(raw) ? raw : [])
    .flatMap((href: unknown) => (typeof href === "string" ? (localRoute(request.baseUrl, href) ?? []) : []))
    .filter((target) => target !== route);
  const hasBack = back !== undefined && !back.startsWith("/") && (await page.locator(back).count()) > 0;
  return { route, links: [...new Set(links)], back: hasBack };
};

export const crawlFlow = async (
  browser: Browser,
  request: FlowRequest,
  routes: readonly string[],
  backs: Readonly<Record<string, string>>,
): Promise<readonly FlowNode[]> =>
  withPage(browser, request, async (page) => {
    const nodes: FlowNode[] = [];
    const depth = new Map(routes.map((route) => [route, 0]));
    const queue = [...routes];
    for (let route = queue.shift(); route !== undefined && nodes.length < MAX_PAGES; route = queue.shift()) {
      const node = await nodeAt(page, request, route, backs[route]).catch(() => ({ route, links: [], back: true }));
      nodes.push(node);
      const next = (depth.get(route) ?? 0) + 1;
      for (const link of node.links.filter((item) => !depth.has(item) && next <= MAX_DEPTH)) {
        depth.set(link, next);
        queue.push(link);
      }
    }
    return nodes;
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
