import type * as Typescript from "typescript";

import { parseSource, type TsApi } from "../../quality/ts-api.js";
import type { TestLanguage } from "./patterns.js";
import { countTests, type TestCounts } from "./scan.js";

export type TestCounter = (language: TestLanguage, source: string, file: string) => TestCounts;

const TEST_NAMES = new Set(["it", "test"]);
const BLOCK_NAMES = new Set(["it", "test", "describe", "suite", "context"]);
const SKIP_MEMBERS = new Set(["skip", "only", "todo", "skipIf", "runIf", "fails"]);
const SKIP_CALLS = new Set(["xit", "xtest", "xdescribe", "xcontext", "fit", "fdescribe"]);
const AVA = new Set(["is", "not", "deepEqual", "true", "false", "truthy", "falsy", "throws", "equal", "ok", "assert"]);

const rootName = (ts: TsApi, node: Typescript.Expression): string | undefined => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) || ts.isCallExpression(node)) return rootName(ts, node.expression);
  return undefined;
};

const hasFunctionArgument = (ts: TsApi, call: Typescript.CallExpression): boolean =>
  call.arguments.some((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));

const isAssertion = (ts: TsApi, call: Typescript.CallExpression): boolean => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === "expect" || callee.text === "assert";
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const root = rootName(ts, callee);
  if (root === "assert" && !ts.isCallExpression(callee.expression)) return true;
  return ts.isIdentifier(callee.expression) && callee.expression.text === "t" && AVA.has(callee.name.text);
};

const isSkip = (ts: TsApi, node: Typescript.Node): boolean => {
  if (ts.isPropertyAccessExpression(node) && SKIP_MEMBERS.has(node.name.text)) {
    return ts.isIdentifier(node.expression) && BLOCK_NAMES.has(node.expression.text);
  }
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && SKIP_CALLS.has(node.expression.text);
};

export const countTestsAst = (ts: TsApi, file: string, source: string): TestCounts => {
  const tree = parseSource(ts, file, source);
  const counts = { tests: 0, skips: 0, assertions: 0 };
  const visit = (node: Typescript.Node): void => {
    if (isSkip(ts, node)) counts.skips += 1;
    if (ts.isPropertyAccessExpression(node) && node.name.text === "should") counts.assertions += 1;
    if (ts.isCallExpression(node)) {
      const root = rootName(ts, node.expression);
      if (root !== undefined && TEST_NAMES.has(root) && hasFunctionArgument(ts, node)) counts.tests += 1;
      if (isAssertion(ts, node)) counts.assertions += 1;
    }
    node.forEachChild(visit);
  };
  visit(tree);
  return counts;
};

export const textCounter: TestCounter = (language, source) => countTests(language, source);

export const astCounter =
  (ts: TsApi | undefined): TestCounter =>
  (language, source, file) =>
    ts !== undefined && language === "js" ? countTestsAst(ts, file, source) : countTests(language, source);
