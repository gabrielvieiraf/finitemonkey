import { posix } from "node:path";

export interface GraphSource {
  readonly read: (file: string) => string | undefined;
  readonly exists: (file: string) => boolean;
}

export interface TouchedSource {
  readonly file: string;
  readonly before: string | undefined;
  readonly after: string;
}

export interface Cycle {
  readonly file: string;
  readonly path: readonly string[];
}

const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const IMPORTS = [
  /(?:^|[\s;])import\s+(?!type\s)(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']/g,
  /(?:^|[\s;])export\s+(?!type\s)[\w*{}\s,$]*?\s+from\s+["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
];
const MAX_VISITED = 3000;

const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

export const importSpecifiers = (text: string): readonly string[] => {
  const code = stripComments(text);
  return IMPORTS.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[1] ?? "")).filter((spec) =>
    spec.startsWith("."),
  );
};

const candidates = (base: string): readonly string[] => {
  const swapped = /\.[cm]?jsx?$/.test(base)
    ? [".ts", ".tsx", ".mts", ".cts"].map((ext) => base.replace(/\.[cm]?jsx?$/, ext))
    : [];
  return [
    ...(SCRIPT.test(base) ? [base] : []),
    ...swapped,
    ...EXTENSIONS.map((ext) => `${base}${ext}`),
    ...EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ];
};

export const resolveImport = (from: string, spec: string, exists: (file: string) => boolean): string | undefined =>
  candidates(posix.normalize(posix.join(posix.dirname(from), spec))).find(exists);

const edgesOf = (file: string, text: string, exists: (file: string) => boolean): ReadonlySet<string> =>
  new Set(importSpecifiers(text).flatMap((spec) => resolveImport(file, spec, exists) ?? []));

const pathBack = (start: string, goal: string, next: (file: string) => ReadonlySet<string>): readonly string[] => {
  const parent = new Map<string, string>([[start, ""]]);
  const queue = [start];
  while (queue.length > 0 && parent.size < MAX_VISITED) {
    const current = queue.shift() ?? "";
    if (current === goal) {
      const path: string[] = [];
      for (let step = current; step !== ""; step = parent.get(step) ?? "") path.unshift(step);
      return path;
    }
    for (const target of next(current)) {
      if (parent.has(target)) continue;
      parent.set(target, current);
      queue.push(target);
    }
  }
  return [];
};

export const newCycles = (touched: readonly TouchedSource[], source: GraphSource): readonly Cycle[] => {
  const overrides = new Map(touched.map((item) => [item.file, item.after]));
  const cache = new Map<string, ReadonlySet<string>>();
  const next = (file: string): ReadonlySet<string> => {
    const known = cache.get(file);
    if (known !== undefined) return known;
    const text = overrides.get(file) ?? source.read(file);
    const edges = text === undefined || !SCRIPT.test(file) ? new Set<string>() : edgesOf(file, text, source.exists);
    cache.set(file, edges);
    return edges;
  };
  const seen = new Set<string>();
  const cycles: Cycle[] = [];
  for (const item of touched.filter((entry) => SCRIPT.test(entry.file))) {
    const old = item.before === undefined ? new Set<string>() : edgesOf(item.file, item.before, source.exists);
    for (const target of [...next(item.file)].filter((edge) => !old.has(edge))) {
      const back = pathBack(target, item.file, next);
      const key = [...back].sort().join("\n");
      if (back.length === 0 || seen.has(key)) continue;
      seen.add(key);
      cycles.push({ file: item.file, path: [item.file, ...back] });
    }
  }
  return cycles;
};
