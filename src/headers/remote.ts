import type { AbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, configList, loadProjectConfig } from "../git/project-config.js";
import { routeUrl } from "./probe.js";
import { parseHeaderBlock, type RouteHeaders } from "./rules.js";

export const HEADERS_TIMEOUT_S = 10;

export interface HeadersConfig {
  readonly url: string | undefined;
  readonly routes: readonly string[];
}

export const loadHeadersConfig = (runtime: Runtime, root: AbsolutePath): HeadersConfig => {
  const tree = loadProjectConfig(runtime, root);
  const url = configAt(tree, "headers", "url");
  const routes = configList(tree, "headers", "routes");
  return {
    url: typeof url === "string" && /^https?:\/\//.test(url.trim()) ? url.trim() : undefined,
    routes,
  };
};

export type RemoteHeaders =
  | { readonly ok: true; readonly routes: readonly RouteHeaders[] }
  | { readonly ok: false; readonly route: string; readonly detail: string };

export const curlHeaders = (
  runtime: Pick<Runtime, "exec">,
  cwd: AbsolutePath,
  base: string,
  routes: readonly string[],
  platform: NodeJS.Platform,
): RemoteHeaders => {
  const results: RouteHeaders[] = [];
  for (const route of routes) {
    const result = runtime.exec({
      command: "curl",
      args: [
        "--silent",
        "--show-error",
        "--proto",
        "=https,http",
        "--max-time",
        String(HEADERS_TIMEOUT_S),
        "--output",
        platform === "win32" ? "NUL" : "/dev/null",
        "--dump-header",
        "-",
        routeUrl(base, route),
      ],
      cwd,
      timeoutMs: (HEADERS_TIMEOUT_S + 1) * 1000,
    });
    if (!result.found || result.exitCode !== 0)
      return { ok: false, route, detail: (result.stderr.trim() || "curl failed").slice(0, 160) };
    results.push({ route, ...parseHeaderBlock(result.stdout) });
  }
  return { ok: true, routes: results };
};
