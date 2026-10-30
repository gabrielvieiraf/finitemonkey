import { join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";
import { gitAt } from "../gate/git.js";
import { readDecisions } from "../guardian/decisions.js";
import { tokenEstimate } from "../instructions/types.js";
import { buildMap } from "../map/build.js";
import { experimentArm } from "../policy/experiment.js";
import { loadPolicy } from "../policy/policy.js";
import type { FmPaths } from "../task/paths.js";
import { viewsOf } from "./service.js";

export const RETRIEVE_FILE = "retrieve.jsonl";
export const RETRIEVE_FEATURE = "retrieve";
export const RETRIEVE_DEEP_FEATURE = "retrieve-deep";
export const DEFAULT_STEP_BUDGET = 600;
export const STEPS = ["grep", "map", "bm25", "deep"] as const;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const MAX_TERMS = 8;

export type Step = (typeof STEPS)[number];

export interface Span {
  readonly anchor: string;
  readonly text: string;
}

export interface StepRecord {
  readonly step: Step;
  readonly answered: boolean;
  readonly tokens: number;
  readonly reason?: string;
}

export interface Retrieval {
  readonly query: string;
  readonly step: Step | null;
  readonly spans: readonly Span[];
  readonly steps: readonly StepRecord[];
}

export type DeepSearch = (query: string, budget: number) => readonly Span[];

export const NO_DEEP_SEARCH: DeepSearch | undefined = undefined;

export const retrievePath = (paths: FmPaths): AbsolutePath => toAbsolutePath(join(paths.dir, RETRIEVE_FILE));

const STOP = new Set(["the", "and", "for", "with", "where", "what", "how", "does", "that", "this", "from", "into"]);

export const termsOf = (query: string): readonly string[] =>
  [
    ...new Set(
      (query.match(/[A-Za-z_$][\w$]*/g) ?? []).filter((word) => word.length >= 3 && !STOP.has(word.toLowerCase())),
    ),
  ].slice(0, MAX_TERMS);

const isSymbol = (term: string): boolean => /[a-z][A-Z]|^[A-Z][a-z]+[A-Z]|_/.test(term);

const fit = (spans: readonly Span[], budget: number): readonly Span[] => {
  const kept: Span[] = [];
  let used = 0;
  for (const span of spans) {
    const cost = tokenEstimate(`${span.anchor} ${span.text}`);
    if (used + cost > budget) break;
    kept.push(span);
    used += cost;
  }
  return kept;
};

const cost = (spans: readonly Span[]): number =>
  spans.reduce((sum, span) => sum + tokenEstimate(`${span.anchor} ${span.text}`), 0);

const GREP_LINE = /^(.+?):(\d+):(.*)$/;

const grepStep = (runtime: Pick<Runtime, "exec">, root: AbsolutePath, terms: readonly string[]): readonly Span[] => {
  if (terms.length === 0) return [];
  const symbols = terms.filter(isSymbol);
  const wanted = symbols.length > 0 ? symbols : terms;
  const flags = symbols.length > 0 ? ["-w"] : ["-i"];
  const out =
    gitAt(runtime, root).out([
      "grep",
      "-n",
      "-I",
      "-F",
      ...flags,
      ...wanted.flatMap((term) => ["-e", term]),
      "--",
      ".",
      ":(exclude).finitemonkey",
    ]) ?? "";
  const scored = out.split("\n").flatMap((line) => {
    const match = GREP_LINE.exec(line);
    if (match === null) return [];
    const text = (match[3] ?? "").trim();
    const hits = wanted.filter((term) => text.toLowerCase().includes(term.toLowerCase())).length;
    return [{ anchor: `${match[1] ?? ""}:${match[2] ?? ""}`, text: text.slice(0, 200), hits }];
  });
  return scored.sort((left, right) => right.hits - left.hits).map(({ anchor, text }) => ({ anchor, text }));
};

const mapStep = (runtime: Runtime, root: AbsolutePath, terms: readonly string[]): readonly Span[] => {
  const map = buildMap(runtime, root, 4000);
  const lowered = terms.map((term) => term.toLowerCase());
  return (map?.text ?? "")
    .split("\n")
    .filter((line) => lowered.some((term) => line.toLowerCase().includes(term)))
    .map((line) => ({ anchor: line.split(":")[0] ?? "", text: line }));
};

interface Doc {
  readonly anchor: string;
  readonly text: string;
}

const words = (text: string): readonly string[] =>
  (text.toLowerCase().match(/[a-z0-9_$]+/g) ?? []).filter((w) => w.length >= 2);

export const bm25 = (docs: readonly Doc[], terms: readonly string[]): readonly Span[] => {
  const tokenized = docs.map((doc) => words(doc.text));
  const average = tokenized.reduce((sum, list) => sum + list.length, 0) / Math.max(1, tokenized.length);
  const query = terms.map((term) => term.toLowerCase());
  const scores = docs.map((doc, index) => {
    const list = tokenized[index] ?? [];
    const score = query.reduce((sum, term) => {
      const frequency = list.filter((word) => word === term).length;
      if (frequency === 0) return sum;
      const containing = tokenized.filter((other) => other.includes(term)).length;
      const idf = Math.log(1 + (docs.length - containing + 0.5) / (containing + 0.5));
      return (
        sum +
        (idf * frequency * (BM25_K1 + 1)) / (frequency + BM25_K1 * (1 - BM25_B + (BM25_B * list.length) / average))
      );
    }, 0);
    return { doc, score };
  });
  return scores
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => ({ anchor: item.doc.anchor, text: item.doc.text }));
};

const knowledgeDocs = (
  runtime: Pick<Runtime, "readText" | "exec" | "homeDir" | "listDir">,
  paths: FmPaths,
): readonly Doc[] => [
  ...viewsOf(runtime, paths)
    .filter((view) => view.status === "valid")
    .map((view) => ({
      anchor:
        view.anchors
          .map((item) =>
            item.anchor.symbol === undefined ? item.anchor.path : `${item.anchor.path}#${item.anchor.symbol}`,
          )
          .join(", ") || `claim:${view.claim.id}`,
      text: `${view.claim.id} ${view.claim.text}`,
    })),
  ...readDecisions(runtime, paths).map((decision) => ({
    anchor: `decision:${decision.id}`,
    text: `${decision.subject} ${decision.recommendation} ${decision.choice ?? ""}`,
  })),
];

export interface RetrieveOptions {
  readonly budget: number;
  readonly deep?: DeepSearch;
}

export const retrieve = (runtime: Runtime, paths: FmPaths, query: string, options: RetrieveOptions): Retrieval => {
  const terms = termsOf(query);
  const steps: StepRecord[] = [];
  const attempt = (step: Step, find: () => readonly Span[]): readonly Span[] => {
    const spans = fit(find(), options.budget);
    steps.push({ step, answered: spans.length > 0, tokens: cost(spans) });
    return spans;
  };
  const ladder: readonly (readonly [Step, () => readonly Span[]])[] = [
    ["grep", () => grepStep(runtime, paths.root, terms)],
    ["map", () => mapStep(runtime, paths.root, terms)],
    ["bm25", () => bm25(knowledgeDocs(runtime, paths), terms)],
  ];
  for (const [step, find] of ladder) {
    const spans = attempt(step, find);
    if (spans.length > 0) return record(runtime, paths, { query, step, spans, steps });
  }
  const arm = experimentArm(runtime, paths, loadPolicy(runtime, paths.root), RETRIEVE_DEEP_FEATURE);
  if (arm !== "active" || options.deep === undefined) {
    steps.push({ step: "deep", answered: false, tokens: 0, reason: arm === "active" ? "no_provider" : "no_arm" });
    return record(runtime, paths, { query, step: null, spans: [], steps });
  }
  const deep = options.deep;
  const spans = attempt("deep", () => deep(query, options.budget));
  return record(runtime, paths, { query, step: spans.length > 0 ? "deep" : null, spans, steps });
};

const record = (
  runtime: Pick<Runtime, "appendText" | "now" | "mkdir">,
  paths: FmPaths,
  result: Retrieval,
): Retrieval => {
  runtime.mkdir(paths.dir);
  runtime.appendText(
    retrievePath(paths),
    `${JSON.stringify({ at: runtime.now(), query: result.query, step: result.step, steps: result.steps, anchors: result.spans.map((span) => span.anchor) })}\n`,
  );
  return result;
};
