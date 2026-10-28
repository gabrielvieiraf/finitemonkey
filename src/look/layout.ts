export const LANDMARKS: ReadonlySet<string> = new Set([
  "header",
  "nav",
  "main",
  "section",
  "article",
  "aside",
  "footer",
  "form",
  "table",
]);
export const MIN_SECTIONS = 3;
export const MIN_TOKENS = 6;

export interface PageLayout {
  readonly route: string;
  readonly viewport: number;
  readonly structure: readonly string[];
}

const commonLength = (left: readonly string[], right: readonly string[]): number => {
  let previous = new Array<number>(right.length + 1).fill(0);
  for (const token of left) {
    const current = [0];
    right.forEach((other, index) => {
      current.push(
        token === other ? (previous[index] ?? 0) + 1 : Math.max(previous[index + 1] ?? 0, current[index] ?? 0),
      );
    });
    previous = current;
  }
  return previous[right.length] ?? 0;
};

export const similarity = (left: readonly string[], right: readonly string[]): number => {
  const longest = Math.max(left.length, right.length);
  return longest === 0 ? 1 : commonLength(left, right) / longest;
};

export const sections = (structure: readonly string[]): readonly string[] =>
  structure.filter((token) => LANDMARKS.has(token));

const baseRoute = (route: string): string => route.split("?")[0] ?? route;

export const repeatedLayouts = (pages: readonly PageLayout[]): readonly (readonly [string, string])[] => {
  const widest = Math.max(0, ...pages.map((page) => page.viewport));
  const seen = new Map<string, string>();
  const pairs: (readonly [string, string])[] = [];
  for (const page of pages.filter((item) => item.viewport === widest && item.route === baseRoute(item.route))) {
    if (sections(page.structure).length < MIN_SECTIONS || page.structure.length < MIN_TOKENS) continue;
    const key = page.structure.join(">");
    const first = seen.get(key);
    if (first === undefined) seen.set(key, page.route);
    else pairs.push([first, page.route]);
  }
  return pairs;
};
