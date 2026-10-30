import type { CatalogEntry, CopyFinding } from "./copy-rules.js";

export interface SourceText {
  readonly file: string;
  readonly text: string;
}

const KEY_CALL = /(?:^|[^\w$])(?:t|\$t|i18n\.t|translate|formatMessage)\(\s*["'`]([\w.-]+)["'`]/g;
const HANDLER =
  /\bon[A-Z]\w*=\{\s*(?:\(\)\s*=>\s*)?([A-Za-z_$][\w$]*)|@click(?:\.\w+)*="\s*([A-Za-z_$][\w$]*)|\bon:click=\{\s*([A-Za-z_$][\w$]*)/g;
const WINDOW = 2;

const keysIn = (line: string): readonly string[] => [...line.matchAll(KEY_CALL)].flatMap((match) => match[1] ?? []);

const bindingsIn = (line: string, operations: readonly string[]): readonly string[] => [
  ...[...line.matchAll(HANDLER)]
    .flatMap((match) => match[1] ?? match[2] ?? match[3] ?? [])
    .map((name) => `handler ${name}`),
  ...operations.filter((id) => new RegExp(`\\b${id}\\b`).test(line)).map((id) => `operation ${id}`),
];

export const bindingKeys = (
  sources: readonly SourceText[],
  operations: readonly string[],
): ReadonlyMap<string, ReadonlySet<string>> => {
  const found = new Map<string, Set<string>>();
  for (const source of sources) {
    const lines = source.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const keys = keysIn(line);
      if (keys.length === 0) return;
      const near = lines.slice(Math.max(0, index - WINDOW), index + WINDOW + 1);
      for (const binding of near.flatMap((text) => bindingsIn(text, operations))) {
        const set = found.get(binding) ?? new Set<string>();
        for (const key of keys) set.add(key);
        found.set(binding, set);
      }
    });
  }
  return found;
};

const normal = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, " ");

export const oneNameFindings = (
  bindings: ReadonlyMap<string, ReadonlySet<string>>,
  entries: readonly CatalogEntry[],
  allow: readonly string[],
): readonly CopyFinding[] => {
  const source = entries.filter((entry) => entry.lang === "en");
  const pool = source.length > 0 ? source : entries;
  return [...bindings].flatMap(([binding, keys]): CopyFinding[] => {
    const labelled = [...keys].flatMap((key) => {
      const entry = pool.find((item) => item.key === key);
      return entry === undefined || allow.includes(key) ? [] : [entry];
    });
    const names = [...new Set(labelled.map((entry) => normal(entry.text)))];
    const first = labelled[0];
    if (names.length < 2 || first === undefined) return [];
    return [
      {
        rule: "one-name",
        file: first.file,
        key: labelled.map((entry) => entry.key).join(", "),
        text: labelled.map((entry) => `"${entry.text}"`).join(" / "),
        detail: binding,
      },
    ];
  });
};
