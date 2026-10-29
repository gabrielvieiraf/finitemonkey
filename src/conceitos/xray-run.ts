import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { parseJsonObject } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { addedLines, type Git } from "../gate/git.js";
import type { GateContext } from "../gate/types.js";
import { featureMode } from "../policy/feature.js";
import { type Criterion, recordHorizon } from "../signals/blind-band.js";
import type { FmPaths } from "../task/paths.js";
import { readJsonFile, writeJsonFile } from "../task/state.js";
import { CONCEPT_IDS, type ConceptId, domainOf } from "./concepts.js";
import { agentFiles, untrackedLines } from "./credit.js";
import { type ConceptState, readConceptEvents, stateOf } from "./evidence.js";
import { type CriterionRef, stemOf, type Xray, XRAY_FEATURE, XRAY_SCHEMA, type XrayItem, xrayOf } from "./xray.js";

export const XRAY_FILE = "xray.json";
const TEST_FILE = /(^|\/)(?:test|tests|__tests__|spec)\/|\.(?:test|spec)\.[a-z]+$/;
const MAX_TEST_BYTES = 200_000;

export const xrayPath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, XRAY_FILE));

export const conceptStates = (
  runtime: Pick<Runtime, "readText">,
  paths: FmPaths,
): ReadonlyMap<ConceptId, ConceptState> => {
  const events = readConceptEvents(runtime, paths);
  return new Map(CONCEPT_IDS.map((id) => [id, stateOf(events.filter((event) => event.concept === id))]));
};

const decorativeIds = (runtime: Pick<Runtime, "readText">, paths: FmPaths, task: string): ReadonlySet<string> => {
  const log = runtime.readText(paths.log);
  if (!log.ok) return new Set();
  const last = log.value
    .split("\n")
    .map((line) => (line.includes('"contract.strength"') ? parseJsonObject(line) : undefined))
    .findLast((parsed) => parsed?.ok === true && parsed.value["task"] === task);
  const ids = last?.ok === true ? last.value["decorative"] : undefined;
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
};

const testFiles = (
  runtime: Pick<Runtime, "readText">,
  git: Git,
  root: AbsolutePath,
  stems: ReadonlySet<string>,
): readonly string[] =>
  (git.out(["ls-files", "-z"]) ?? "")
    .split("\0")
    .filter((file) => TEST_FILE.test(file))
    .flatMap((file) => {
      const text = runtime.readText(toAbsolutePath(join(root, file)));
      if (!text.ok || text.value.length > MAX_TEST_BYTES) return [];
      return [...stems].some((stem) => text.value.includes(stem)) ? [text.value] : [];
    });

export const criterionRefs = (
  runtime: Pick<Runtime, "readText">,
  ctx: GateContext,
  files: readonly string[],
): readonly CriterionRef[] => {
  const decorative = decorativeIds(runtime, ctx.paths, ctx.contract.id);
  const examples = (ctx.examples ?? []).filter((example) => example.status === "approved");
  const refs: CriterionRef[] = examples.map((example) => ({
    id: example.id,
    kind: "example",
    mentions: [example.run],
    decorative: decorative.has(example.id),
  }));
  for (const check of ctx.contract.acceptance) {
    if (check.run === undefined) continue;
    if (check.kind === "tests") {
      const stems = new Set(files.map(stemOf).filter((stem) => stem.length >= 3));
      const mentions = [check.run, ...testFiles(runtime, ctx.git, ctx.paths.root, stems)];
      refs.push({ id: check.id, kind: "tests", mentions, decorative: decorative.has(check.id) });
    } else
      refs.push({
        id: check.id,
        kind: check.kind === "scenarios" ? "scenario" : "check",
        mentions: [check.run],
        decorative: decorative.has(check.id),
      });
  }
  return refs;
};

export const xrayFor = (runtime: Runtime, paths: FmPaths, ctx: GateContext): Xray => {
  const added = [...addedLines(ctx.git, ctx.base), ...untrackedLines(runtime, ctx.git, paths)];
  const files = [...new Set(added.map((line) => line.path))];
  return xrayOf({
    added,
    states: conceptStates(runtime, paths),
    refs: criterionRefs(runtime, ctx, files),
    agentFiles: agentFiles(runtime, paths),
  });
};

const helpCriterion = (item: XrayItem): Criterion => {
  if (item.coverage !== "covered" || item.criterion === null) return "none";
  if (item.criterion === "example") return "example";
  return item.criterion === "scenario" ? "scenario" : "check";
};

export const saveXray = (
  runtime: Runtime,
  paths: FmPaths,
  task: string,
  tree: string,
  xray: Xray,
): { readonly recorded: number } => {
  const before = readJsonFile(runtime, xrayPath(paths));
  writeJsonFile(runtime, xrayPath(paths), { schema: XRAY_SCHEMA, task, tree, ...xray });
  if (before?.["tree"] === tree || featureMode(runtime, paths, XRAY_FEATURE) === "off") return { recorded: 0 };
  const beyond = xray.items.filter((item) => item.band === "beyond");
  for (const item of beyond)
    recordHorizon(runtime, paths, {
      source: "xray",
      criterion: helpCriterion(item),
      domain: domainOf(item.concepts[0]?.concept ?? "api"),
      task,
    });
  return { recorded: beyond.length };
};
