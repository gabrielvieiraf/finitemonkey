import type { RouteHeaders } from "./rules.js";
import { watchedOnly } from "./rules.js";

export type HeaderFetch = (
  url: string,
  timeoutMs: number,
) => Promise<{ readonly status: number; readonly headers: Readonly<Record<string, string>> } | undefined>;

export const routeUrl = (base: string, route: string): string =>
  `${base.replace(/\/+$/, "")}${route.startsWith("/") ? "" : "/"}${route}`;

export const probeHeaders = async (
  fetcher: HeaderFetch,
  base: string,
  routes: readonly string[],
  timeoutMs: number,
): Promise<readonly RouteHeaders[]> => {
  const results: RouteHeaders[] = [];
  for (const route of routes) {
    const answer = await fetcher(routeUrl(base, route), timeoutMs);
    if (answer !== undefined) results.push({ route, status: answer.status, headers: watchedOnly(answer.headers) });
  }
  return results;
};
