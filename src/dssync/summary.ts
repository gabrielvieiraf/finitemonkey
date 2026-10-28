import { posix } from "node:path";

export type Snapshot = ReadonlyMap<string, string>;

export interface Change {
  readonly name: string;
  readonly before: string | undefined;
  readonly after: string | undefined;
}

export interface Section {
  readonly added: readonly Change[];
  readonly changed: readonly Change[];
  readonly removed: readonly Change[];
}

export interface DsSummary {
  readonly tokens: Section;
  readonly classes: Section;
  readonly components: Section;
  readonly assets: Section;
}

const STYLE = /\.(?:css|scss|sass|less)$/;
const TOKEN_JSON = /(?:^|\/)(?:tokens\/[^/]+|[^/]+\.tokens)\.json$/;
const ASSET = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf)$/i;
const COMPONENT = /(?:^|\/)components\/(?:.+\/)?([A-Za-z][\w-]*)\.(?:[jt]sx?|vue|svelte|html)$/;
const CUSTOM_PROPERTY = /(--[\w-]+)\s*:\s*([^;}]+)/g;
const CLASS = /\.(-?[_a-zA-Z][\w-]*)(?=[^{};]*\{)/g;

const sortedMap = (entries: Iterable<readonly [string, string]>): ReadonlyMap<string, string> =>
  new Map([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

const flatten = (value: unknown, prefix: string): readonly (readonly [string, string])[] => {
  if (typeof value !== "object" || value === null) return [[prefix, JSON.stringify(value)]];
  const record = new Map<string, unknown>(Object.entries(value));
  if (record.has("value") || record.has("$value"))
    return [[prefix, JSON.stringify(record.get("$value") ?? record.get("value"))]];
  return [...record].flatMap(([key, item]) => flatten(item, prefix === "" ? key : `${prefix}.${key}`));
};

const parseTokens = (text: string): readonly (readonly [string, string])[] => {
  try {
    const parsed: unknown = JSON.parse(text);
    return flatten(parsed, "");
  } catch {
    return [];
  }
};

const tokensOf = (snapshot: Snapshot): ReadonlyMap<string, string> =>
  sortedMap(
    [...snapshot].flatMap(([path, text]): (readonly [string, string])[] => {
      if (STYLE.test(path))
        return [...text.matchAll(CUSTOM_PROPERTY)].map((match) => [match[1] ?? "", (match[2] ?? "").trim()]);
      return TOKEN_JSON.test(path) ? [...parseTokens(text)] : [];
    }),
  );

const classesOf = (snapshot: Snapshot): ReadonlyMap<string, string> =>
  sortedMap(
    [...snapshot].flatMap(([path, text]): (readonly [string, string])[] =>
      STYLE.test(path) ? [...text.matchAll(CLASS)].map((match) => [`.${match[1] ?? ""}`, path]) : [],
    ),
  );

const hash = (text: string): string => {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) value = (value * 31 + text.charCodeAt(index)) % 2_147_483_647;
  return value.toString(16);
};

const componentsOf = (snapshot: Snapshot): ReadonlyMap<string, string> =>
  sortedMap(
    [...snapshot].flatMap(([path, text]): (readonly [string, string])[] => {
      const name = COMPONENT.exec(path)?.[1];
      return name === undefined ? [] : [[name, hash(text)]];
    }),
  );

const assetsOf = (snapshot: Snapshot): ReadonlyMap<string, string> =>
  sortedMap(
    [...snapshot].flatMap(([path, text]): (readonly [string, string])[] =>
      ASSET.test(path) ? [[posix.normalize(path), hash(text)]] : [],
    ),
  );

const compare = (before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): Section => {
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changeOf = (name: string): Change => ({ name, before: before.get(name), after: after.get(name) });
  return {
    added: names.filter((name) => !before.has(name)).map(changeOf),
    changed: names
      .filter((name) => before.has(name) && after.has(name) && before.get(name) !== after.get(name))
      .map(changeOf),
    removed: names.filter((name) => !after.has(name)).map(changeOf),
  };
};

export const dsSummary = (before: Snapshot, after: Snapshot): DsSummary => ({
  tokens: compare(tokensOf(before), tokensOf(after)),
  classes: compare(classesOf(before), classesOf(after)),
  components: compare(componentsOf(before), componentsOf(after)),
  assets: compare(assetsOf(before), assetsOf(after)),
});

export const isEmptySummary = (summary: DsSummary): boolean =>
  [summary.tokens, summary.classes, summary.components, summary.assets].every(
    (section) => section.added.length + section.changed.length + section.removed.length === 0,
  );
