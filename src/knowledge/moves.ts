import { dirname } from "node:path";

import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { type Anchor, anchorState, diskReader, relocate } from "./anchor.js";
import { appendClaimEvent, type Claim, lastOf } from "./claims.js";
import type { EvaluateOptions } from "./status.js";
import { memoCandidates } from "./status.js";
import { projectSyntax } from "./syntax.js";

export const CLAIM_FILES = "claim-files.json";
const MAX_FILES = 500;
const MAX_TOUCHED = 200;

type IndexRuntime = Pick<Runtime, "readText" | "writeText" | "mkdir">;

const listOf = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];

const readIndex = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
): { readonly files: readonly string[]; readonly touched: readonly string[] } => {
  const raw = readJsonFile(runtime, paths.cache(CLAIM_FILES));
  return { files: listOf(raw?.["files"]), touched: listOf(raw?.["touched"]) };
};

const writeIndex = (
  runtime: IndexRuntime,
  paths: FmPaths,
  files: readonly string[],
  touched: readonly string[],
): void => {
  runtime.mkdir(toAbsolutePath(dirname(paths.cache(CLAIM_FILES))));
  writeJsonFile(runtime, paths.cache(CLAIM_FILES), {
    files: [...new Set(files)].slice(0, MAX_FILES),
    touched: [...new Set(touched)].slice(-MAX_TOUCHED),
  });
};

export const claimFiles = (runtime: Pick<Runtime, "readText">, paths: FmPaths): readonly string[] => {
  const index = readIndex(runtime, paths);
  return [...new Set([...index.touched, ...index.files])];
};

const symbolName = (anchor: Anchor): string | undefined => anchor.symbol?.split(".").at(-1);

const baseName = (path: string): string => path.split("/").at(-1) ?? path;

export const indexClaimFiles = (
  runtime: IndexRuntime & Pick<Runtime, "exec">,
  paths: FmPaths,
  claims: readonly Claim[],
  tracked: () => readonly string[],
): void => {
  const anchors = claims.filter((claim) => lastOf(claim, ["close"]) === undefined).flatMap((claim) => claim.anchors);
  const names = [...new Set(anchors.flatMap((anchor) => symbolName(anchor) ?? []))].filter((name) =>
    /^[\w$]+$/.test(name),
  );
  const holding =
    names.length === 0
      ? ""
      : (gitAt(runtime, paths.root).out(["grep", "-l", "-I", "-w", "-F", ...names.flatMap((name) => ["-e", name])]) ??
        "");
  const bases = new Set(anchors.filter((anchor) => anchor.symbol === undefined).map((anchor) => baseName(anchor.path)));
  const sameName = bases.size === 0 ? [] : tracked().filter((file) => bases.has(baseName(file)));
  const files = [...holding.split("\n").filter((file) => file !== ""), ...sameName];
  writeIndex(runtime, paths, files, readIndex(runtime, paths).touched);
};

export const touchClaimFile = (runtime: IndexRuntime, paths: FmPaths, file: string): void => {
  const index = readIndex(runtime, paths);
  if (index.touched.includes(file)) return;
  writeIndex(runtime, paths, index.files, [...index.touched, file]);
};

export const hookOptions = (runtime: Pick<Runtime, "readText" | "exec">, paths: FmPaths): EvaluateOptions => ({
  read: diskReader(runtime, paths.root),
  candidates: memoCandidates(() => claimFiles(runtime, paths)),
  syntax: projectSyntax(runtime, paths.root),
});

const movedInto = (anchor: Anchor, file: string, options: EvaluateOptions): Anchor | undefined => {
  if (anchor.path === file || anchorState(anchor, options.read(anchor.path), options.syntax) !== "missing")
    return undefined;
  return relocate(anchor, [file], options.read, options.syntax);
};

export const settleMoves = (
  runtime: Pick<Runtime, "appendText" | "mkdir" | "now">,
  paths: FmPaths,
  claims: readonly Claim[],
  file: string,
  options: EvaluateOptions,
): readonly string[] =>
  claims.flatMap((claim) => {
    if (lastOf(claim, ["close"]) !== undefined) return [];
    const moved = claim.anchors.map((anchor) => movedInto(anchor, file, options));
    if (moved.every((anchor) => anchor === undefined)) return [];
    appendClaimEvent(runtime, paths, {
      event: "renew",
      id: claim.id,
      recordedAt: runtime.now(),
      reason: "moved",
      anchors: claim.anchors.map((anchor, index) => moved[index] ?? anchor),
    });
    return [claim.id];
  });
