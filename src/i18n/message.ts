export type MessageNode =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "arg"; readonly name: string }
  | { readonly kind: "count" }
  | {
      readonly kind: "plural" | "select";
      readonly name: string;
      readonly branches: Readonly<Record<string, readonly MessageNode[]>>;
    };

export type Params = Readonly<Record<string, string | number>>;

const ARG = /^\s*([a-zA-Z][a-zA-Z0-9_]*)\s*(?:,\s*(plural|select)\s*,)?/;

interface Cursor {
  readonly source: string;
  index: number;
}

const closingBrace = (cursor: Cursor): number => {
  let depth = 0;
  for (let index = cursor.index; index < cursor.source.length; index += 1) {
    const char = cursor.source.charAt(index);
    if (char === "{") depth += 1;
    else if (char === "}") {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
};

const parseBranches = (body: string, inPlural: boolean): Record<string, readonly MessageNode[]> | undefined => {
  const branches: Record<string, readonly MessageNode[]> = {};
  const cursor: Cursor = { source: body, index: 0 };
  for (;;) {
    const rest = body.slice(cursor.index);
    const head = /^\s*(=?[a-zA-Z0-9_]+)\s*\{/.exec(rest);
    if (head === null) return rest.trim() === "" && "other" in branches ? branches : undefined;
    cursor.index += head[0].length;
    const end = closingBrace(cursor);
    if (end < 0) return undefined;
    branches[head[1] ?? ""] = parseNodes(body.slice(cursor.index, end), inPlural);
    cursor.index = end + 1;
  }
};

const parseNodes = (source: string, inPlural: boolean): readonly MessageNode[] => {
  const nodes: MessageNode[] = [];
  let text = "";
  const flush = (): void => {
    if (text !== "") nodes.push({ kind: "text", text });
    text = "";
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (char === "#" && inPlural) {
      flush();
      nodes.push({ kind: "count" });
      continue;
    }
    if (char !== "{") {
      text += char;
      continue;
    }
    const cursor: Cursor = { source, index: index + 1 };
    const end = closingBrace(cursor);
    const inner = end < 0 ? undefined : source.slice(index + 1, end);
    const match = inner === undefined ? null : ARG.exec(inner);
    if (inner === undefined || match === null) {
      text += char;
      continue;
    }
    const name = match[1] ?? "";
    const type = match[2] === "plural" || match[2] === "select" ? match[2] : undefined;
    if (type === undefined && match[0].trim().length !== inner.trim().length) {
      text += char;
      continue;
    }
    const branches = type === undefined ? undefined : parseBranches(inner.slice(match[0].length), type === "plural");
    if (type !== undefined && branches === undefined) {
      text += char;
      continue;
    }
    flush();
    nodes.push(type === undefined || branches === undefined ? { kind: "arg", name } : { kind: type, name, branches });
    index = end;
  }
  flush();
  return nodes;
};

export const parseMessage = (source: string): readonly MessageNode[] => parseNodes(source, false);

const pluralRules = new Map<string, Intl.PluralRules>();

const rulesFor = (locale: string): Intl.PluralRules => {
  const known = pluralRules.get(locale);
  if (known !== undefined) return known;
  const rules = new Intl.PluralRules(locale);
  pluralRules.set(locale, rules);
  return rules;
};

const branchFor = (
  node: Extract<MessageNode, { kind: "plural" | "select" }>,
  value: string | number | undefined,
  locale: string,
): readonly MessageNode[] | undefined => {
  const { branches } = node;
  if (node.kind === "select") return branches[String(value)] ?? branches["other"];
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(count)) return branches["other"];
  return branches[`=${String(count)}`] ?? branches[rulesFor(locale).select(count)] ?? branches["other"];
};

const render = (
  nodes: readonly MessageNode[],
  params: Params,
  locale: string,
  count: string | number | undefined,
): string =>
  nodes
    .map((node) => {
      if (node.kind === "text") return node.text;
      if (node.kind === "count") return count === undefined ? "#" : String(count);
      const value = params[node.name];
      if (node.kind === "arg") return value === undefined ? `{${node.name}}` : String(value);
      const branch = branchFor(node, value, locale) ?? [];
      return render(branch, params, locale, node.kind === "plural" ? value : count);
    })
    .join("");

export const formatMessage = (source: string, params: Params, locale: string): string =>
  render(parseMessage(source), params, locale, undefined);

const walk = (nodes: readonly MessageNode[], visit: (node: MessageNode) => void): void => {
  for (const node of nodes) {
    visit(node);
    if (node.kind === "plural" || node.kind === "select") {
      for (const branch of Object.values(node.branches)) walk(branch, visit);
    }
  }
};

export const argumentsOf = (source: string): readonly string[] => {
  const names = new Set<string>();
  walk(parseMessage(source), (node) => {
    if (node.kind === "arg" || node.kind === "plural" || node.kind === "select") names.add(node.name);
  });
  return [...names].sort();
};

export interface Choice {
  readonly name: string;
  readonly kind: "plural" | "select";
  readonly branches: readonly string[];
}

export const choicesOf = (source: string): readonly Choice[] => {
  const choices: Choice[] = [];
  walk(parseMessage(source), (node) => {
    if (node.kind === "plural" || node.kind === "select") {
      choices.push({ name: node.name, kind: node.kind, branches: Object.keys(node.branches).sort() });
    }
  });
  return choices;
};

export const requiredPluralBranches = (locale: string): readonly string[] => {
  const rules = rulesFor(locale);
  const seen = new Set<string>(["other"]);
  for (let count = 0; count <= 1000; count += 1) seen.add(rules.select(count));
  return [...seen].sort();
};
