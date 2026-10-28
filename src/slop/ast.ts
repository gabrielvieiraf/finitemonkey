import type * as Typescript from "typescript";

import { lineOf, parseSource, type TsApi } from "../quality/ts-api.js";

export interface Declared {
  readonly name: string;
  readonly line: number;
}

const declaredName = (ts: TsApi, node: Typescript.Node): Typescript.Node | undefined => {
  if (
    ts.isVariableDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isBindingElement(node)
  ) {
    return node.name;
  }
  return undefined;
};

export const tsDeclarations = (ts: TsApi, file: string, text: string): readonly Declared[] => {
  const source = parseSource(ts, file, text);
  const found: Declared[] = [];
  const visit = (node: Typescript.Node): void => {
    const name = declaredName(ts, node);
    if (name !== undefined && ts.isIdentifier(name)) {
      found.push({ name: name.text, line: lineOf(source, name.getStart(source)) });
    }
    node.forEachChild(visit);
  };
  visit(source);
  return found;
};
