import type * as Typescript from "typescript";

import type { Runtime } from "../../core/runtime.js";
import { lineOf, parseSource, type TsApi } from "../../quality/ts-api.js";
import type { Git } from "../git.js";
import { specifierReaches } from "./imports.js";
import { type CallSite, current, grepHits, type RemovedSymbol } from "./scan.js";

interface Bindings {
  readonly locals: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
  readonly lines: readonly number[];
}

const reaches = (ts: TsApi, file: string, node: Typescript.Expression | undefined, origins: readonly string[]) =>
  node !== undefined && ts.isStringLiteral(node) && origins.some((origin) => specifierReaches(file, node.text, origin));

const bindingsOf = (ts: TsApi, source: Typescript.SourceFile, symbol: RemovedSymbol): Bindings => {
  const file = source.fileName;
  const locals = new Set(symbol.origins.includes(file) ? [symbol.name] : []);
  const namespaces = new Set<string>();
  const lines: number[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && reaches(ts, file, statement.moduleSpecifier, symbol.origins)) {
      const named = statement.importClause?.namedBindings;
      if (named !== undefined && ts.isNamespaceImport(named)) namespaces.add(named.name.text);
      if (named !== undefined && ts.isNamedImports(named)) {
        for (const item of named.elements) {
          if ((item.propertyName ?? item.name).getText(source) !== symbol.name) continue;
          locals.add(item.name.text);
          lines.push(lineOf(source, statement.getStart(source)));
        }
      }
    }
    if (ts.isExportDeclaration(statement) && reaches(ts, file, statement.moduleSpecifier, symbol.origins)) {
      const clause = statement.exportClause;
      const names = clause !== undefined && ts.isNamedExports(clause) ? clause.elements : [];
      if (names.some((item) => (item.propertyName ?? item.name).getText(source) === symbol.name)) {
        lines.push(lineOf(source, statement.getStart(source)));
      }
    }
  }
  return { locals, namespaces, lines };
};

const isDeclarationName = (ts: TsApi, node: Typescript.Identifier): boolean => {
  const { parent } = node;
  if (ts.isExportSpecifier(parent) || ts.isShorthandPropertyAssignment(parent)) return false;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return true;
  return "name" in parent && parent.name === node && !ts.isPropertyAccessExpression(parent);
};

const usesIn = (ts: TsApi, source: Typescript.SourceFile, name: string, bindings: Bindings): ReadonlySet<number> => {
  const found = new Set(bindings.lines);
  const visit = (node: Typescript.Node): void => {
    if (ts.isIdentifier(node) && bindings.locals.has(node.text) && !isDeclarationName(ts, node)) {
      found.add(lineOf(source, node.getStart(source)));
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      bindings.namespaces.has(node.expression.text) &&
      node.name.text === name
    ) {
      found.add(lineOf(source, node.getStart(source)));
    }
    node.forEachChild(visit);
  };
  visit(source);
  return found;
};

export const syntaxSitesIn = (ts: TsApi, file: string, text: string, symbol: RemovedSymbol): readonly CallSite[] => {
  const source = parseSource(ts, file, text);
  const bindings = bindingsOf(ts, source, symbol);
  if (bindings.locals.size === 0 && bindings.namespaces.size === 0 && bindings.lines.length === 0) return [];
  return [...usesIn(ts, source, symbol.name, bindings)]
    .sort((a, b) => a - b)
    .map((line) => ({ name: symbol.name, file, line }));
};

export const syntaxCallSites = (
  runtime: Pick<Runtime, "readText">,
  git: Git,
  ts: TsApi,
  symbols: readonly RemovedSymbol[],
): readonly CallSite[] => {
  const scripts = symbols.filter((symbol) => symbol.language.id === "js");
  const files = [...new Set(grepHits(git, [...new Set(scripts.map((symbol) => symbol.name))]).map((hit) => hit.file))];
  const texts = new Map(files.map((file) => [file, current(runtime, git.cwd, file)]));
  return scripts.flatMap((symbol) =>
    files
      .filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file))
      .flatMap((file) => syntaxSitesIn(ts, file, texts.get(file) ?? "", symbol)),
  );
};
