import type * as Typescript from "typescript";

import type { AbsolutePath } from "../core/brand.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { isTsFamily, loadTypescript, parseSource, type TsApi } from "../quality/ts-api.js";
import { sha256Hex } from "../secrets/fingerprint.js";

export const PARSERS = ["ts", "python"] as const;

export type Parser = (typeof PARSERS)[number];

export type Spans = ReadonlyMap<string, string>;

export interface Syntax {
  readonly parserFor: (path: string) => Parser | undefined;
  readonly spans: (parser: Parser, path: string, text: string) => Spans | undefined;
}

export const NO_SYNTAX: Syntax = { parserFor: () => undefined, spans: () => undefined };

const PYTHON_TIMEOUT_MS = 5000;

export const PYTHON_SPANS = [
  "import ast, json, sys",
  "tree = ast.parse(sys.stdin.read())",
  "found = {}",
  "def walk(node, prefix):",
  "    for child in ast.iter_child_nodes(node):",
  "        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):",
  "            name = prefix + [child.name]",
  "            start = min([child.lineno] + [item.lineno for item in child.decorator_list])",
  '            found.setdefault(".".join(name), [start, child.end_lineno])',
  "            walk(child, name)",
  "        else:",
  "            walk(child, prefix)",
  "walk(tree, [])",
  "print(json.dumps(found))",
].join("\n");

export const findSymbol = (spans: Spans, symbol: string): string | undefined => {
  const exact = spans.get(symbol);
  if (exact !== undefined || symbol.includes(".")) return exact;
  const matches = [...spans].filter(([name]) => name.split(".").at(-1) === symbol);
  return matches.length === 1 ? matches[0]?.[1] : undefined;
};

const DECLARATIONS = new Set<string>([
  "FunctionDeclaration",
  "ClassDeclaration",
  "InterfaceDeclaration",
  "TypeAliasDeclaration",
  "EnumDeclaration",
  "ModuleDeclaration",
  "MethodDeclaration",
  "PropertyDeclaration",
  "GetAccessor",
  "SetAccessor",
  "PropertyAssignment",
  "VariableDeclaration",
]);

const declaredName = (ts: TsApi, node: Typescript.Node): string | undefined => {
  if (!DECLARATIONS.has(ts.SyntaxKind[node.kind])) return undefined;
  const name = ts.getNameOfDeclaration(node as Typescript.Declaration);
  if (name === undefined) return undefined;
  return ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
};

const statementOf = (ts: TsApi, node: Typescript.Node): Typescript.Node => {
  const list = node.parent;
  const statement = list.parent;
  return ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(list) &&
    list.declarations.length === 1 &&
    ts.isVariableStatement(statement)
    ? statement
    : node;
};

export const tsSpans = (ts: TsApi, path: string, text: string): Spans => {
  const source = parseSource(ts, path, text);
  const found = new Map<string, string>();
  const walk = (node: Typescript.Node, prefix: readonly string[]): void => {
    const name = declaredName(ts, node);
    const next = name === undefined ? prefix : [...prefix, name];
    if (name !== undefined && !found.has(next.join("."))) found.set(next.join("."), statementOf(ts, node).getText());
    node.forEachChild((child) => {
      walk(child, next);
    });
  };
  source.forEachChild((child) => {
    walk(child, []);
  });
  return found;
};

export const pythonSpans = (text: string, output: string): Spans | undefined => {
  const parsed = parseJsonObject(output.trim());
  if (!parsed.ok) return undefined;
  const lines = text.split("\n");
  return new Map(
    Object.entries(parsed.value).flatMap(([name, range]): [string, string][] => {
      if (!Array.isArray(range)) return [];
      const values: readonly unknown[] = range;
      const start = values[0];
      const end = values[1];
      if (typeof start !== "number" || typeof end !== "number" || start < 1 || end < start) return [];
      return [[name, lines.slice(start - 1, end).join("\n")]];
    }),
  );
};

const isPython = (path: string): boolean => /\.pyi?$/.test(path);

export const projectSyntax = (runtime: Pick<Runtime, "exec">, root: AbsolutePath): Syntax => {
  const cache = new Map<string, Spans | undefined>();
  const python = (text: string): Spans | undefined => {
    const result = runtime.exec({
      command: "python3",
      args: ["-c", PYTHON_SPANS],
      cwd: root,
      timeoutMs: PYTHON_TIMEOUT_MS,
      input: text,
    });
    return result.found && result.exitCode === 0 ? pythonSpans(text, result.stdout) : undefined;
  };
  const parse = (parser: Parser, path: string, text: string): Spans | undefined => {
    if (parser === "python") return python(text);
    const ts = loadTypescript(root);
    return ts === undefined ? undefined : tsSpans(ts, path, text);
  };
  return {
    parserFor: (path) => (isTsFamily(path) ? "ts" : isPython(path) ? "python" : undefined),
    spans: (parser, path, text) => {
      const key = `${parser}\u0000${path}\u0000${sha256Hex(text)}`;
      if (!cache.has(key)) cache.set(key, parse(parser, path, text));
      return cache.get(key);
    },
  };
};
