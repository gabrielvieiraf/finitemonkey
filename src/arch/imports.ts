import { posix } from "node:path";

export interface ImportEdge {
  readonly from: string;
  readonly line: number;
  readonly to: string;
}

export interface SourceTree {
  readonly files: readonly string[];
  readonly read: (path: string) => string | undefined;
  readonly goModule: string | undefined;
}

type Resolver = (file: string, spec: string, index: FileIndex) => string | undefined;

interface FileIndex {
  readonly has: (path: string) => boolean;
  readonly inDir: (dir: string, extension: RegExp) => string | undefined;
  readonly bySuffix: (suffix: string, extensions: readonly string[]) => string | undefined;
  readonly inDirSuffix: (dir: string, extension: RegExp) => string | undefined;
}

const JS_FILE = /\.(?:[cm]?[jt]sx?)$/;
const JS_TRIES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];
const JS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
const PY_IMPORT = /^\s*(?:from\s+(\.*[\w.]*)\s+import\s+([\w, ]+)|import\s+([\w., ]+))/;
const GO_IMPORT = /^\s*(?:import\s+)?(?:[\w.]+\s+)?"([^"]+)"\s*$/;
const JVM_IMPORT = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;?\s*$/;

const fileIndex = (files: readonly string[]): FileIndex => {
  const set = new Set(files);
  const sorted = [...files].sort();
  return {
    has: (path) => set.has(path),
    inDir: (dir, extension) =>
      sorted.find((file) => posix.dirname(file) === dir && extension.test(file) && !file.endsWith("_test.go")),
    bySuffix: (suffix, extensions) =>
      sorted.find((file) => extensions.some((ext) => file === `${suffix}${ext}` || file.endsWith(`/${suffix}${ext}`))),
    inDirSuffix: (dir, extension) =>
      sorted.find((file) => {
        const parent = posix.dirname(file);
        return (parent === dir || parent.endsWith(`/${dir}`)) && extension.test(file);
      }),
  };
};

const resolveJs: Resolver = (file, spec, index) => {
  if (!spec.startsWith(".")) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(file), spec));
  const stem = base.replace(/\.(?:[cm]?js)$/, "");
  return [base, stem].flatMap((root) => JS_TRIES.map((tail) => `${root}${tail}`)).find(index.has);
};

const pyCandidates = (module: string): readonly string[] => {
  const path = module.split(".").join("/");
  return [`${path}.py`, `${path}/__init__.py`, `src/${path}.py`, `src/${path}/__init__.py`];
};

const resolvePy: Resolver = (file, spec, index) => {
  const dots = /^\.*/.exec(spec)?.[0].length ?? 0;
  let module = spec.slice(dots);
  if (dots > 0) {
    let dir = posix.dirname(file);
    for (let up = 1; up < dots; up += 1) dir = posix.dirname(dir);
    const prefix = dir === "." ? "" : `${dir.split("/").join(".")}.`;
    module = `${prefix}${module}`.replace(/\.$/, "");
  }
  return pyCandidates(module).find(index.has);
};

const resolveGo =
  (goModule: string | undefined): Resolver =>
  (_file, spec, index) =>
    goModule !== undefined && spec.startsWith(`${goModule}/`)
      ? index.inDir(spec.slice(goModule.length + 1), /\.go$/)
      : undefined;

const resolveJvm: Resolver = (_file, spec, index) =>
  spec.endsWith(".*")
    ? index.inDirSuffix(spec.slice(0, -2).split(".").join("/"), /\.(?:java|kt)$/)
    : index.bySuffix(spec.split(".").join("/"), [".java", ".kt"]);

const pySpecs = (line: string): readonly string[] => {
  const match = PY_IMPORT.exec(line);
  if (match === null) return [];
  if (match[1] !== undefined) {
    const from = match[1];
    const names = (match[2] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
    return [from, ...names.map((name) => (from.endsWith(".") ? `${from}${name}` : `${from}.${name}`))];
  }
  return (match[3] ?? "")
    .split(",")
    .map((name) => name.trim().split(" ")[0] ?? "")
    .filter((name) => name !== "");
};

const lineSpecs = (file: string, line: string): readonly string[] => {
  if (JS_FILE.test(file)) return [...line.matchAll(JS_IMPORT)].map((match) => match[1] ?? "");
  if (file.endsWith(".py")) return pySpecs(line);
  if (file.endsWith(".go")) return [GO_IMPORT.exec(line)?.[1] ?? ""].filter((spec) => spec !== "");
  if (/\.(?:java|kt)$/.test(file)) return [JVM_IMPORT.exec(line)?.[1] ?? ""].filter((spec) => spec !== "");
  return [];
};

const resolverFor = (file: string, goModule: string | undefined): Resolver | undefined => {
  if (JS_FILE.test(file)) return resolveJs;
  if (file.endsWith(".py")) return resolvePy;
  if (file.endsWith(".go")) return resolveGo(goModule);
  return /\.(?:java|kt)$/.test(file) ? resolveJvm : undefined;
};

export const importEdges = (tree: SourceTree): readonly ImportEdge[] => {
  const index = fileIndex(tree.files);
  return tree.files.flatMap((file) => {
    const resolve = resolverFor(file, tree.goModule);
    const text = resolve === undefined ? undefined : tree.read(file);
    if (resolve === undefined || text === undefined) return [];
    const seen = new Set<string>();
    return text.split(/\r?\n/).flatMap((line, at): ImportEdge[] =>
      lineSpecs(file, line).flatMap((spec): ImportEdge[] => {
        const to = resolve(file, spec, index);
        if (to === undefined || to === file || seen.has(to)) return [];
        seen.add(to);
        return [{ from: file, line: at + 1, to }];
      }),
    );
  });
};

export const goModuleOf = (text: string | undefined): string | undefined => /^module\s+(\S+)/m.exec(text ?? "")?.[1];
