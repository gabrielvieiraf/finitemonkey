import { issue, type UxIssue, type UxPage } from "./ux.js";

export const FLOW_FEATURE = "ui-flow";
export const MAX_DEPTH = 2;
export const MAX_PAGES = 30;
export const DESTRUCTIVE_NAME = /^(?:delete|remove|excluir|apagar|remover|eliminar|borrar)\b/i;
export const UNDO_NAME = /\b(?:undo|desfazer|deshacer)\b/i;

export interface FlowNode {
  readonly route: string;
  readonly links: readonly string[];
  readonly back: boolean;
}

export interface FlowSpec {
  readonly entry: string | undefined;
  readonly declared: readonly string[];
  readonly terminal: readonly string[];
  readonly steps: Readonly<Record<string, number>>;
  readonly back: Readonly<Record<string, string>>;
}

export const pathOf = (route: string): string => route.split("#")[0] ?? route;

export const shortestPaths = (nodes: readonly FlowNode[], entry: string): ReadonlyMap<string, number> => {
  const edges = new Map(nodes.map((node) => [node.route, node.links]));
  const seen = new Map<string, number>([[entry, 0]]);
  const queue = [entry];
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    const depth = seen.get(current) ?? 0;
    for (const next of edges.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.set(next, depth + 1);
      queue.push(next);
    }
  }
  return seen;
};

const page = (route: string, issues: readonly UxIssue[]): UxPage => ({
  feature: FLOW_FEATURE,
  route,
  viewport: 0,
  issues,
});

export const flowPages = (nodes: readonly FlowNode[], spec: FlowSpec): readonly UxPage[] => {
  const entry = spec.entry ?? spec.declared[0];
  const reach = entry === undefined ? new Map<string, number>() : shortestPaths(nodes, entry);
  const known = new Set(nodes.map((node) => node.route));
  const dead = nodes
    .filter((node) => node.links.length === 0 && !node.back && !spec.terminal.includes(node.route))
    .map((node) => page(node.route, [issue("flow/dead-end", "body", "no link or way back out of this screen")]));
  const unreachable = spec.declared
    .filter((route) => route !== entry && !reach.has(route))
    .map((route) =>
      page(route, [issue("flow/unreachable", "body", `no path from ${entry ?? "the entry"} reaches this screen`)]),
    );
  const long = Object.entries(spec.steps).flatMap(([route, budget]) => {
    const steps = reach.get(route);
    return steps !== undefined && steps > budget && known.has(route)
      ? [
          page(route, [
            issue("flow/steps", "body", `shortest path takes ${String(steps)} steps, budget ${String(budget)}`),
          ]),
        ]
      : [];
  });
  return [...dead, ...unreachable, ...long];
};

export interface DestructiveResult {
  readonly route: string;
  readonly selector: string;
  readonly confirmed: boolean;
  readonly undo: boolean;
  readonly error?: string;
}

export const destructiveIssues = (results: readonly DestructiveResult[]): readonly UxPage[] =>
  results.flatMap((result) => {
    if (result.error !== undefined)
      return [
        page(result.route, [
          issue("flow/destructive", result.selector, `not exercised: ${result.error}`, { unverified: true }),
        ]),
      ];
    return result.confirmed || result.undo
      ? []
      : [
          page(result.route, [
            issue("flow/destructive", result.selector, "destructive action with no confirmation and no undo"),
          ]),
        ];
  });

export interface DraftResult {
  readonly route: string;
  readonly selector: string;
  readonly kept: boolean;
  readonly error?: string;
}

export const draftIssues = (results: readonly DraftResult[]): readonly UxPage[] =>
  results.flatMap((result) => {
    if (result.error !== undefined)
      return [
        page(result.route, [
          issue("flow/draft-lost", result.selector, `not exercised: ${result.error}`, { unverified: true }),
        ]),
      ];
    return result.kept
      ? []
      : [page(result.route, [issue("flow/draft-lost", result.selector, "typed draft is gone after a reload")])];
  });
