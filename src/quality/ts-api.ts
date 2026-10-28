import { createRequire } from "node:module";
import { join } from "node:path";

import type * as Typescript from "typescript";

import { isRecord } from "../core/parsed.js";

export type TsApi = typeof Typescript;

const loaded = new Map<string, TsApi | undefined>();

const isTsApi = (value: unknown): value is TsApi =>
  isRecord(value) && typeof value["createSourceFile"] === "function" && isRecord(value["SyntaxKind"]);

const tryRequire = (anchor: string): TsApi | undefined => {
  try {
    const value: unknown = createRequire(anchor)("typescript");
    return isTsApi(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

export const loadTypescript = (root: string): TsApi | undefined => {
  if (loaded.has(root)) return loaded.get(root);
  const api = tryRequire(join(root, "package.json")) ?? tryRequire(import.meta.url);
  loaded.set(root, api);
  return api;
};

const SCRIPT_KINDS: Readonly<Record<string, keyof typeof Typescript.ScriptKind>> = {
  ts: "TS",
  mts: "TS",
  cts: "TS",
  tsx: "TSX",
  js: "JS",
  mjs: "JS",
  cjs: "JS",
  jsx: "JSX",
};

export const isTsFamily = (file: string): boolean => SCRIPT_KINDS[file.split(".").pop() ?? ""] !== undefined;

export const parseSource = (ts: TsApi, file: string, text: string): Typescript.SourceFile => {
  const kind = SCRIPT_KINDS[file.split(".").pop() ?? ""] ?? "TS";
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind[kind]);
};

export const lineOf = (source: Typescript.SourceFile, position: number): number =>
  source.getLineAndCharacterOfPosition(position).line + 1;
