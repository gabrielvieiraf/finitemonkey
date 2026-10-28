import type * as Typescript from "typescript";

import type { TsApi } from "./ts-api.js";

export interface BodyMetrics {
  readonly cognitive: number;
  readonly nesting: number;
  readonly chain: number;
  readonly identifiers: number;
}

interface Tally {
  cognitive: number;
  nesting: number;
  chain: number;
  identifiers: number;
}

const LOGICAL = new Set(["&&", "||", "??"]);

export const isFunctionLike = (ts: TsApi, node: Typescript.Node): node is Typescript.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node);

const isLoop = (ts: TsApi, node: Typescript.Node): boolean =>
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isWhileStatement(node) ||
  ts.isDoStatement(node);

const logicalOperator = (ts: TsApi, node: Typescript.Node): string | undefined => {
  const inner = ts.isParenthesizedExpression(node) ? node.expression : node;
  if (!ts.isBinaryExpression(inner)) return undefined;
  const text = ts.tokenToString(inner.operatorToken.kind) ?? "";
  return LOGICAL.has(text) ? text : undefined;
};

const operatorsOf = (ts: TsApi, node: Typescript.Node): readonly string[] => {
  const inner = ts.isParenthesizedExpression(node) ? node.expression : node;
  const operator = logicalOperator(ts, inner);
  if (operator === undefined || !ts.isBinaryExpression(inner)) return [];
  return [...operatorsOf(ts, inner.left), operator, ...operatorsOf(ts, inner.right)];
};

const sequences = (operators: readonly string[]): number =>
  operators.filter((operator, index) => index === 0 || operators[index - 1] !== operator).length;

const isElseIf = (ts: TsApi, node: Typescript.Node): boolean =>
  ts.isIfStatement(node) && ts.isIfStatement(node.parent) && node.parent.elseStatement === node;

const callDepth = (ts: TsApi, node: Typescript.Node): number => {
  if (ts.isCallExpression(node)) return 1 + callDepth(ts, node.expression);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isNonNullExpression(node)) {
    return callDepth(ts, node.expression);
  }
  return 0;
};

const isChainRoot = (ts: TsApi, node: Typescript.Node): boolean => {
  const { parent } = node;
  const continues =
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node;
  return !continues && !(ts.isCallExpression(parent) && parent.expression === node);
};

const isSimpleStatement = (ts: TsApi, node: Typescript.Node): boolean =>
  ts.isExpressionStatement(node) ||
  ts.isVariableStatement(node) ||
  ts.isReturnStatement(node) ||
  ts.isThrowStatement(node);

const countIdentifiers = (ts: TsApi, node: Typescript.Node): number => {
  if (isFunctionLike(ts, node)) return 0;
  let total = ts.isIdentifier(node) ? 1 : 0;
  node.forEachChild((child) => {
    total += countIdentifiers(ts, child);
  });
  return total;
};

const structural = (ts: TsApi, node: Typescript.Node): boolean =>
  (ts.isIfStatement(node) && !isElseIf(ts, node)) ||
  isLoop(ts, node) ||
  ts.isSwitchStatement(node) ||
  ts.isTryStatement(node);

const increment = (ts: TsApi, node: Typescript.Node, level: number): number => {
  if (isElseIf(ts, node)) return 1 + (hasElse(ts, node) ? 1 : 0);
  if (ts.isIfStatement(node)) return 1 + level + (hasElse(ts, node) ? 1 : 0);
  if (ts.isConditionalExpression(node) || ts.isSwitchStatement(node) || ts.isCatchClause(node)) return 1 + level;
  if (isLoop(ts, node)) return 1 + level;
  if ((ts.isBreakStatement(node) || ts.isContinueStatement(node)) && node.label !== undefined) return 1;
  const operator = logicalOperator(ts, node);
  if (operator !== undefined && logicalOperator(ts, node.parent) === undefined) {
    return sequences(operatorsOf(ts, node));
  }
  return 0;
};

const hasElse = (ts: TsApi, node: Typescript.Node): boolean =>
  ts.isIfStatement(node) && node.elseStatement !== undefined && !ts.isIfStatement(node.elseStatement);

const nests = (ts: TsApi, node: Typescript.Node): boolean =>
  ts.isIfStatement(node) ||
  ts.isConditionalExpression(node) ||
  ts.isSwitchStatement(node) ||
  ts.isCatchClause(node) ||
  isLoop(ts, node);

const visit = (ts: TsApi, node: Typescript.Node, level: number, depth: number, tally: Tally): void => {
  if (isFunctionLike(ts, node)) return;
  tally.cognitive += increment(ts, node, level);
  const nextDepth = structural(ts, node) ? depth + 1 : depth;
  tally.nesting = Math.max(tally.nesting, nextDepth);
  if (ts.isCallExpression(node) && isChainRoot(ts, node)) tally.chain = Math.max(tally.chain, callDepth(ts, node));
  if (isSimpleStatement(ts, node)) {
    tally.identifiers = Math.max(tally.identifiers, countIdentifiers(ts, node));
  }
  const nextLevel = nests(ts, node) && !isElseIf(ts, node) ? level + 1 : level;
  node.forEachChild((child) => {
    visit(ts, child, nextLevel, nextDepth, tally);
  });
};

export const bodyMetrics = (ts: TsApi, fn: Typescript.FunctionLikeDeclaration): BodyMetrics => {
  const tally: Tally = { cognitive: 0, nesting: 0, chain: 0, identifiers: 0 };
  const { body } = fn;
  if (body === undefined) return tally;
  if (ts.isBlock(body)) {
    body.forEachChild((child) => {
      visit(ts, child, 0, 0, tally);
    });
  } else {
    visit(ts, body, 0, 0, tally);
    tally.identifiers = Math.max(tally.identifiers, countIdentifiers(ts, body));
  }
  return { ...tally };
};
