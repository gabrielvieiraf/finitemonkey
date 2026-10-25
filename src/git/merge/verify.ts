import { memo, memoBy } from "../facts.js";
import { configMap, loadProjectConfig } from "../project-config.js";
import type { Repo } from "../repo.js";
import type { Runtime } from "../../core/runtime.js";
import { isDropped, loadDropped } from "./dropped.js";
import { generatedPaths, verifyGenerated } from "./generated.js";
import { blobText, resolveMergeInputs, sideDiff } from "./inputs.js";
import type { FileDiff, Finding, MergeInputs } from "./types.js";
import { type FilePair, resultPathOf, type VerifyContext, verifyFile } from "./verify-file.js";

export const MERGE_VERIFY_SCHEMA = "finitemonkey/merge-verify@1";

export type VerifyExit = 0 | 1 | 2;

export interface VerifyReport {
  readonly schema: typeof MERGE_VERIFY_SCHEMA;
  readonly exit: VerifyExit;
  readonly base: string | undefined;
  readonly ours: string | undefined;
  readonly theirs: string | undefined;
  readonly result: string | undefined;
  readonly bases: number;
  readonly files: number;
  readonly findings: readonly Finding[];
  readonly justified: number;
  readonly generated: readonly string[];
  readonly error: string | undefined;
}

export interface VerifyOptions {
  readonly rev?: string;
  readonly droppedFile?: string;
}

const failed = (error: string, inputs?: MergeInputs): VerifyReport => ({
  schema: MERGE_VERIFY_SCHEMA,
  exit: 2,
  base: inputs?.base,
  ours: inputs?.ours,
  theirs: inputs?.theirs,
  result: inputs?.result,
  bases: inputs?.bases ?? 0,
  files: 0,
  findings: [],
  justified: 0,
  generated: [],
  error,
});

const keyOf = (diff: FileDiff): string =>
  (diff.status === "added" || diff.status === "copied" ? diff.newPath : (diff.oldPath ?? diff.newPath)) ?? "";

const pairsOf = (ours: readonly FileDiff[], theirs: readonly FileDiff[]): readonly FilePair[] => {
  const keys = [...new Set([...ours, ...theirs].map(keyOf))].filter((key) => key !== "").sort();
  return keys.map((key) => ({
    key,
    ours: ours.find((diff) => keyOf(diff) === key),
    theirs: theirs.find((diff) => keyOf(diff) === key),
  }));
};

const contextOf = (runtime: Runtime, repo: Repo, inputs: MergeInputs, pairs: readonly FilePair[]): VerifyContext => {
  const resultText = memoBy((path) => blobText(runtime, repo, inputs.result, path));
  const context: VerifyContext = {
    runtime,
    repo,
    inputs,
    resultText,
    resultFiles: memo(() =>
      pairs.flatMap((pair) => {
        const path = resultPathOf(context, pair);
        return path === undefined ? [] : [path];
      }),
    ),
  };
  return context;
};

export const verifyMerge = (runtime: Runtime, repo: Repo, options: VerifyOptions = {}): VerifyReport => {
  const inputs = resolveMergeInputs(runtime, repo, options.rev);
  if (!inputs.ok) return failed(inputs.error);
  const dropped = loadDropped(runtime, repo.root, options.droppedFile);
  if (!dropped.ok) return failed(`dropped: ${dropped.error}`, inputs.value);
  const ours = sideDiff(runtime, repo, inputs.value.base, inputs.value.ours);
  const theirs = sideDiff(runtime, repo, inputs.value.base, inputs.value.theirs);
  if (!ours.ok) return failed(ours.error, inputs.value);
  if (!theirs.ok) return failed(theirs.error, inputs.value);
  const pairs = pairsOf(ours.value, theirs.value);
  const generators = configMap(loadProjectConfig(runtime, repo.root), "merge", "generators");
  const generated = generatedPaths(runtime, repo, pairs.map((pair) => pair.key), generators);
  const context = contextOf(runtime, repo, inputs.value, pairs.filter((pair) => !generated.has(pair.key)));
  const regenerated = verifyGenerated(runtime, repo, inputs.value, [...generated], generators);
  if (!regenerated.ok) return failed(regenerated.error, inputs.value);
  const all = [
    ...pairs.filter((pair) => !generated.has(pair.key)).flatMap((pair) => verifyFile(context, pair)),
    ...regenerated.value,
  ];
  const open = [...dropped.value.invalid, ...all.filter((item) => !isDropped(item, dropped.value.items))];
  return {
    schema: MERGE_VERIFY_SCHEMA,
    exit: open.length === 0 ? 0 : 1,
    base: inputs.value.base,
    ours: inputs.value.ours,
    theirs: inputs.value.theirs,
    result: inputs.value.result,
    bases: inputs.value.bases,
    files: pairs.length,
    findings: open,
    justified: all.length - (open.length - dropped.value.invalid.length),
    generated: [...generated].sort(),
    error: undefined,
  };
};
