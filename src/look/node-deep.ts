import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import {
  DEEP_ROUTE_TIMEOUT_MS,
  DEEP_TOOL,
  deepArgs,
  deepEnv,
  type DeepReport,
  type DeepRoute,
  type DeepRunner,
  parseDeep,
} from "./deep.js";

const BINARIES = [DEEP_TOOL, `${DEEP_TOOL}.cmd`] as const;

export const deepBinary = (runtime: Pick<Runtime, "stat">, root: AbsolutePath): AbsolutePath | undefined =>
  BINARIES.map((name) => toAbsolutePath(join(root, "node_modules", ".bin", name))).find(
    (path) => runtime.stat(path)?.kind === "file",
  );

const routeUrl = (baseUrl: string, route: string): string => `${baseUrl}${route.startsWith("/") ? "" : "/"}${route}`;

const runRoute = (
  runtime: Runtime,
  root: AbsolutePath,
  binary: AbsolutePath,
  baseUrl: string,
  route: string,
): DeepRoute => {
  const result = runtime.exec({
    command: binary,
    args: deepArgs(routeUrl(baseUrl, route)),
    cwd: root,
    timeoutMs: DEEP_ROUTE_TIMEOUT_MS,
    env: deepEnv,
    shell: binary.endsWith(".cmd"),
  });
  if (result.timedOut) return { route, scores: [], error: "timeout" };
  const scores = result.exitCode === 0 ? parseDeep(result.stdout) : undefined;
  if (scores !== undefined) return { route, scores, error: null };
  const line = result.stderr.trim().split("\n").pop() ?? "";
  return {
    route,
    scores: [],
    error: `exit ${String(result.exitCode ?? -1)}${line === "" ? "" : `: ${line.slice(0, 160)}`}`,
  };
};

export const deepRunner =
  (runtime: Runtime, root: AbsolutePath): DeepRunner =>
  (baseUrl, routes): DeepReport => {
    const binary = deepBinary(runtime, root);
    if (binary === undefined) return { tool: null, routes: [] };
    return { tool: DEEP_TOOL, routes: routes.map((route) => runRoute(runtime, root, binary, baseUrl, route)) };
  };
