import type { Runtime } from "../../core/runtime.js";
import type { Repo } from "../repo.js";
import { checkFile } from "./check-file.js";
import { blobId, blobText } from "./inputs.js";
import { containsSequence, contentLines } from "./lines.js";
import type { FileDiff, Finding, MergeInputs, Side } from "./types.js";
import { containsSymbol, missingSymbols } from "./units.js";

export interface FilePair {
  readonly key: string;
  readonly ours: FileDiff | undefined;
  readonly theirs: FileDiff | undefined;
}

export interface VerifyContext {
  readonly runtime: Runtime;
  readonly repo: Repo;
  readonly inputs: MergeInputs;
  readonly resultText: (path: string) => string | undefined;
  readonly resultFiles: () => readonly string[];
}

const created = (diff: FileDiff | undefined): boolean => diff?.status === "added" || diff?.status === "copied";

export const resultPathOf = (context: VerifyContext, pair: FilePair): string | undefined =>
  [pair.ours?.newPath, pair.theirs?.newPath, pair.key].find(
    (path) => path !== undefined && context.resultText(path) !== undefined,
  );

const finding = (kind: Finding["kind"], file: string, side: Side | undefined, text: string): Finding => ({
  kind,
  file,
  side,
  line: undefined,
  text,
  weak: false,
});

const binaryFindings = (context: VerifyContext, pair: FilePair, path: string | undefined): readonly Finding[] => {
  const { runtime, repo, inputs } = context;
  const result = path === undefined ? undefined : blobId(runtime, repo, inputs.result, path);
  const ours = pair.ours?.newPath === undefined ? undefined : blobId(runtime, repo, inputs.ours, pair.ours.newPath);
  const theirs = pair.theirs?.newPath === undefined ? undefined : blobId(runtime, repo, inputs.theirs, pair.theirs.newPath);
  const file = path ?? pair.key;
  if (pair.ours !== undefined && pair.theirs !== undefined && ours !== theirs) {
    if (result === ours) return [finding("binary", file, "theirs", file)];
    if (result === theirs) return [finding("binary", file, "ours", file)];
    return [finding("binary", file, undefined, file)];
  }
  const side: Side = pair.ours === undefined ? "theirs" : "ours";
  const expected = side === "ours" ? ours : theirs;
  return result === expected ? [] : [finding("binary", file, side, file)];
};

const elsewhereOf =
  (context: VerifyContext) =>
  (lines: readonly string[]): boolean =>
    context.resultFiles().some((path) => containsSequence(contentLines(context.resultText(path)), lines));

const symbolFindings = (context: VerifyContext, pair: FilePair, path: string, text: string | undefined): readonly Finding[] => {
  const present = (symbol: Parameters<typeof containsSymbol>[1]): boolean =>
    (text !== undefined && containsSymbol(text, symbol)) ||
    context.resultFiles().some((other) => containsSymbol(context.resultText(other) ?? "", symbol));
  return [
    ...missingSymbols(path, "ours", pair.ours?.hunks ?? [], present),
    ...missingSymbols(path, "theirs", pair.theirs?.hunks ?? [], present),
  ];
};

export const verifyFile = (context: VerifyContext, pair: FilePair): readonly Finding[] => {
  const path = resultPathOf(context, pair);
  if (pair.ours?.binary === true || pair.theirs?.binary === true) return binaryFindings(context, pair, path);
  const missing = (["ours", "theirs"] as const).flatMap((side) =>
    created(pair[side]) && path === undefined ? [finding("missing-file", pair.key, side, pair.key)] : [],
  );
  if (missing.length > 0) return missing;
  const copied = [pair.ours, pair.theirs].find((diff) => diff?.status === "copied");
  const baseSource = copied?.oldPath ?? (created(pair.ours) || created(pair.theirs) ? undefined : pair.key);
  const baseText = baseSource === undefined ? undefined : blobText(context.runtime, context.repo, context.inputs.base, baseSource);
  const text = path === undefined ? undefined : context.resultText(path);
  const file = path ?? pair.key;
  const lines = checkFile(
    { path: file, base: contentLines(baseText), result: contentLines(text), ours: pair.ours?.hunks ?? [], theirs: pair.theirs?.hunks ?? [] },
    elsewhereOf(context),
  );
  return [...lines, ...symbolFindings(context, pair, file, text)];
};
