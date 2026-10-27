export interface RouteHandler {
  readonly route: string;
  readonly line: number;
  readonly prelude: string;
  readonly body: string;
  readonly fileGuarded: boolean;
}

interface Start {
  readonly route: string;
  readonly index: number;
}

const NEXT_APP = /(?:^|\/)app\/(.*?)\/?route\.[cm]?[jt]sx?$/;
const NEXT_PAGES_API = /(?:^|\/)pages\/(api\/.*)\.[cm]?[jt]sx?$/;
const NEXT_METHOD = /^export\s+(?:async\s+)?(?:function|const)\s+(?:GET|POST|PUT|PATCH|DELETE)\b/gm;
const EXPRESS =
  /^\s*(?:app|router|server|fastify|api|routes)\.(?:get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/gm;
const FASTAPI = /^@\w+\.(?:get|post|put|patch|delete|api_route)\(\s*['"]([^'"]+)['"]/gm;
const NEST = /@(?:Get|Post|Put|Patch|Delete|All)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;
const DJANGO = /^(?:def\s+\w+\(\s*request\b|class\s+\w+\([^)]*View[^)]*\))/gm;
const USE_GUARD = /\.use\(\s*(\w+)/g;

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const cleanRoute = (path: string): string =>
  `/${path
    .split("/")
    .filter((part) => part !== "" && !/^\(.*\)$/.test(part))
    .join("/")}`;

const startsOf = (file: string, text: string): readonly Start[] => {
  const app = NEXT_APP.exec(file);
  if (app !== null)
    return [...text.matchAll(NEXT_METHOD)].map((match) => ({ route: cleanRoute(app[1] ?? ""), index: match.index }));
  const pages = NEXT_PAGES_API.exec(file);
  if (pages !== null) return [{ route: cleanRoute(pages[1] ?? ""), index: 0 }];
  const express = [...text.matchAll(EXPRESS)].map((match) => ({ route: match[1] ?? "", index: match.index }));
  if (express.length > 0) return express;
  const fastapi = [...text.matchAll(FASTAPI)].map((match) => ({ route: match[1] ?? "", index: match.index }));
  if (fastapi.length > 0) return fastapi;
  if (text.includes("@Controller("))
    return [...text.matchAll(NEST)].map((match) => ({ route: match[1] ?? "", index: match.index }));
  if (/(?:^|\/)views\.py$/.test(file))
    return [...text.matchAll(DJANGO)].map((match) => ({ route: file, index: match.index }));
  return [];
};

const preludeOf = (text: string, index: number): string => {
  const before = text.slice(0, index).split("\n");
  before.pop();
  return before.slice(-6).join("\n");
};

const classGuarded = (text: string): boolean => /@UseGuards\([^)]*\)\s*(?:@\w+\([^)]*\)\s*)*export\s+class/.test(text);

export const routeHandlers = (file: string, text: string, guards: readonly string[]): readonly RouteHandler[] => {
  const starts = startsOf(file, text);
  const usedGuards = [...text.matchAll(USE_GUARD)].filter((match) => guards.includes(match[1] ?? ""));
  const firstUse = usedGuards[0]?.index ?? Number.POSITIVE_INFINITY;
  const wholeClass = classGuarded(text);
  return starts.map((start, position) => {
    const end = starts[position + 1]?.index ?? text.length;
    return {
      route: start.route,
      line: lineOf(text, start.index),
      prelude: preludeOf(text, start.index),
      body: text.slice(start.index, end),
      fileGuarded: wholeClass || firstUse < start.index,
    };
  });
};
