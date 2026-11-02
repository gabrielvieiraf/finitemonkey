import { type FlowNode, MAX_DEPTH, MAX_PAGES } from "./flow.js";

export const MAX_CLICKS = 6;

export interface CrawlPage {
  readonly visit: (route: string) => Promise<void>;
  readonly links: () => Promise<readonly string[]>;
  readonly clickables: () => Promise<number>;
  readonly click: (index: number) => Promise<void>;
  readonly url: () => string;
  readonly hasBack: (selector: string) => Promise<boolean>;
}

export const localRoute = (base: string, href: string): string | undefined => {
  try {
    const url = new URL(href, base);
    return url.origin === new URL(base).origin && url.protocol.startsWith("http")
      ? `${url.pathname}${url.search}`
      : undefined;
  } catch {
    return undefined;
  }
};

const clickedRoutes = async (
  page: CrawlPage,
  base: string,
  route: string,
  count: number,
): Promise<readonly string[]> => {
  const found: string[] = [];
  for (let index = 0; index < Math.min(count, MAX_CLICKS); index += 1) {
    try {
      await page.visit(route);
      if ((await page.clickables()) <= index) break;
      await page.click(index);
      const target = localRoute(base, page.url());
      if (target !== undefined && target !== route) found.push(target);
    } catch {
      continue;
    }
  }
  return found;
};

export const nodeAt = async (
  page: CrawlPage,
  base: string,
  route: string,
  back: string | undefined,
): Promise<FlowNode> => {
  await page.visit(route);
  const hrefs = (await page.links()).flatMap((href) => localRoute(base, href) ?? []);
  const hasBack = back !== undefined && !back.startsWith("/") && (await page.hasBack(back));
  const clicked = await clickedRoutes(page, base, route, await page.clickables());
  const links = [...hrefs, ...clicked].filter((target) => target !== route);
  return { route, links: [...new Set(links)], back: hasBack };
};

export const crawl = async (
  page: CrawlPage,
  base: string,
  routes: readonly string[],
  backs: Readonly<Record<string, string>>,
): Promise<readonly FlowNode[]> => {
  const nodes: FlowNode[] = [];
  const depth = new Map(routes.map((route) => [route, 0]));
  const queue = [...routes];
  for (let route = queue.shift(); route !== undefined && nodes.length < MAX_PAGES; route = queue.shift()) {
    const node = await nodeAt(page, base, route, backs[route]).catch(() => ({ route, links: [], back: true }));
    nodes.push(node);
    const next = (depth.get(route) ?? 0) + 1;
    for (const link of node.links.filter((item) => !depth.has(item) && next <= MAX_DEPTH)) {
      depth.set(link, next);
      queue.push(link);
    }
  }
  return nodes;
};
