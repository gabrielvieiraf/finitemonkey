import type { ApiRegistry } from "./registry.js";

export interface MockRoute {
  readonly method: string;
  readonly path: string;
  readonly file: string;
  readonly line: number;
}

export type CoverageProblem =
  | { readonly kind: "no_mock"; readonly id: string; readonly route: string }
  | { readonly kind: "outside"; readonly route: string; readonly file: string; readonly line: number }
  | { readonly kind: "duplicate_handler"; readonly route: string; readonly file: string; readonly line: number }
  | { readonly kind: "repeated_route"; readonly route: string; readonly ids: string };

const HANDLER = /\bhttp\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;

const routeOf = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;

export const mockRoutes = (files: readonly { readonly path: string; readonly text: string }[]): readonly MockRoute[] =>
  files.flatMap((file) =>
    file.text.split(/\r?\n/).flatMap((line, index) =>
      [...line.matchAll(HANDLER)].map((match) => ({
        method: (match[1] ?? "").toUpperCase(),
        path: match[2] ?? "",
        file: file.path,
        line: index + 1,
      })),
    ),
  );

export const coverageProblems = (registry: ApiRegistry, routes: readonly MockRoute[]): readonly CoverageProblem[] => {
  const declared = new Map<string, string[]>();
  for (const endpoint of registry.endpoints) {
    const route = routeOf(endpoint.method, endpoint.path);
    declared.set(route, [...(declared.get(route) ?? []), endpoint.id]);
  }
  const mocked = new Set(routes.map((route) => routeOf(route.method, route.path)));
  const seen = new Set<string>();
  const fromMocks = routes.flatMap((route): CoverageProblem[] => {
    const key = routeOf(route.method, route.path);
    const where = { route: key, file: route.file, line: route.line };
    if (seen.has(key)) return [{ kind: "duplicate_handler", ...where }];
    seen.add(key);
    return declared.has(key) ? [] : [{ kind: "outside", ...where }];
  });
  const fromRegistry = [...declared].flatMap(([route, ids]): CoverageProblem[] => [
    ...(ids.length > 1 ? [{ kind: "repeated_route" as const, route, ids: ids.join(", ") }] : []),
    ...(mocked.has(route) ? [] : [{ kind: "no_mock" as const, id: ids[0] ?? "", route }]),
  ]);
  return [...fromRegistry, ...fromMocks];
};
