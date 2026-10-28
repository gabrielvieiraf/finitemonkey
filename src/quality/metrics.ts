import type * as Typescript from "typescript";

import { bodyMetrics, isFunctionLike } from "./cognitive.js";
import { lineOf, parseSource, type TsApi } from "./ts-api.js";

export interface FunctionMetric {
  readonly key: string;
  readonly name: string;
  readonly line: number;
  readonly lines: number;
  readonly params: number;
  readonly cognitive: number;
  readonly nesting: number;
  readonly chain: number;
  readonly identifiers: number;
}

export interface NestedTernary {
  readonly line: number;
  readonly text: string;
}

export interface FileMetrics {
  readonly lines: number;
  readonly functions: readonly FunctionMetric[];
  readonly nestedTernaries: readonly NestedTernary[];
  readonly exports: readonly string[];
}

export const lineCount = (text: string): number => {
  if (text === "") return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
};

const nameText = (ts: TsApi, name: Typescript.Node | undefined): string | undefined =>
  name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name))
    ? name.text
    : undefined;

const functionName = (ts: TsApi, node: Typescript.FunctionLikeDeclaration): string => {
  if (ts.isConstructorDeclaration(node)) return "constructor";
  const own = nameText(ts, node.name);
  if (own !== undefined) return own;
  const { parent } = node;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) {
    return nameText(ts, parent.name) ?? "<anonymous>";
  }
  if (ts.isBinaryExpression(parent)) return parent.left.getText().replace(/\s+/g, "");
  return "<anonymous>";
};

const unwrap = (ts: TsApi, node: Typescript.Node): Typescript.Node =>
  ts.isParenthesizedExpression(node) ? unwrap(ts, node.expression) : node;

const isNestedTernary = (ts: TsApi, node: Typescript.Node): boolean =>
  ts.isConditionalExpression(node) &&
  [node.condition, node.whenTrue, node.whenFalse].some((part) => ts.isConditionalExpression(unwrap(ts, part)));

const hasExport = (ts: TsApi, node: Typescript.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const exportedNames = (ts: TsApi, node: Typescript.Statement): readonly string[] => {
  if (ts.isExportDeclaration(node)) {
    if (node.moduleSpecifier !== undefined || node.exportClause === undefined) return [];
    return ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map((item) => item.name.text) : [];
  }
  if (!hasExport(ts, node)) return [];
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.flatMap((item) => nameText(ts, item.name) ?? []);
  }
  const declared =
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
      ? nameText(ts, node.name)
      : undefined;
  return declared === undefined ? [] : [declared];
};

interface Walk {
  readonly functions: FunctionMetric[];
  readonly ternaries: NestedTernary[];
  readonly seen: Map<string, number>;
}

const record = (
  ts: TsApi,
  source: Typescript.SourceFile,
  node: Typescript.FunctionLikeDeclaration,
  walk: Walk,
  scope: string,
): string => {
  const name = functionName(ts, node);
  const scoped = scope === "" ? name : `${scope}>${name}`;
  const count = (walk.seen.get(scoped) ?? 0) + 1;
  walk.seen.set(scoped, count);
  const line = lineOf(source, node.getStart(source));
  const key = count === 1 ? scoped : `${scoped}#${String(count)}`;
  walk.functions.push({
    key,
    name,
    line,
    lines: lineOf(source, node.getEnd()) - line + 1,
    params: node.parameters.length,
    ...bodyMetrics(ts, node),
  });
  return key;
};

const walkNode = (ts: TsApi, source: Typescript.SourceFile, node: Typescript.Node, walk: Walk, scope: string): void => {
  const inner = isFunctionLike(ts, node) ? record(ts, source, node, walk, scope) : scope;
  if (isNestedTernary(ts, node)) {
    walk.ternaries.push({
      line: lineOf(source, node.getStart(source)),
      text: node.getText(source).replace(/\s+/g, " "),
    });
  }
  node.forEachChild((child) => {
    walkNode(ts, source, child, walk, inner);
  });
};

export const fileMetrics = (ts: TsApi | undefined, file: string, text: string): FileMetrics => {
  const lines = lineCount(text);
  if (ts === undefined) return { lines, functions: [], nestedTernaries: [], exports: [] };
  const source = parseSource(ts, file, text);
  const walk: Walk = { functions: [], ternaries: [], seen: new Map() };
  walkNode(ts, source, source, walk, "");
  const exports = source.statements.flatMap((statement) => exportedNames(ts, statement));
  return { lines, functions: walk.functions, nestedTernaries: walk.ternaries, exports };
};
