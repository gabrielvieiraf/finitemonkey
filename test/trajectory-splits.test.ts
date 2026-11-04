import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { ConceptId } from "../src/conceitos/concepts.js";
import { type ConceptEvent, type ConceptEventKind, type Origin, WEIGHTS } from "../src/conceitos/evidence.js";
import { MIN_EVIDENCE, trajectoryOf } from "../src/conceitos/trajectory.js";
import { chartLines } from "../src/conceitos/trajectory-ansi.js";
import { drawnSplits, HYPOTHESES, SPLIT_LABEL, splitAt } from "../src/conceitos/trajectory-bands.js";
import { svgOf } from "../src/conceitos/trajectory-chart.js";
import { areaOf, classify, type OutcomeMark } from "../src/conceitos/trajectory-splits.js";
import { ENGLISH_SPLITS } from "../src/conceitos/trajectory-term.js";
import { wordingProblems } from "../src/conceitos/wording.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { closeHorizon, outcomeMarks } from "../src/judge/horizon-outcome.js";
import { parseRequest } from "../src/judge/request.js";
import { type JudgeDeps, runVerb } from "../src/judge/verbs.js";
import { DEFAULT_VERIFIERS } from "../src/judge/verify.js";
import { parseTrajectories } from "../src/mod/trajectory-parse.js";
import { fmPaths } from "../src/task/paths.js";
import { memoryFs } from "./memory-fs.js";
import { fakeRuntime } from "./support.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-29T12:00:00Z");
const ago = (days: number): string => new Date(NOW - days * DAY).toISOString();

const event = (
  days: number,
  concept: ConceptId,
  kind: ConceptEventKind,
  extra: Partial<ConceptEvent> = {},
  origin: Origin = "person",
): ConceptEvent => ({ at: ago(days), concept, kind, origin, weight: WEIGHTS[kind], ...extra });

const DEMONSTRATED: readonly ConceptEvent[] = [
  event(40, "api", "own_change", { file: "src/api/orders.ts" }),
  event(33, "api", "own_change", { file: "src/api/users.ts" }),
  event(26, "api", "own_change", { file: "src/api/carts.ts" }),
];

const sidesOf = (events: readonly ConceptEvent[]): readonly string[] => classify(events).map((item) => item.side);

describe("transfer vs known context", () => {
  it("takes the area from the first two folders of the path", () => {
    assert.deepEqual(
      ["src/api/orders.ts", "lib/payments/stripe/charge.ts", "README.md", "db\\migrations\\1.sql"].map(areaOf),
      ["src/api", "lib/payments", ".", "db/migrations"],
    );
  });

  it("research evidence takes its area from the cited field and concepts meet through the resolver", () => {
    const topic = "research/health/supplement-evidence";
    const cited = (days: number, url: string) => event(days, topic, "own_change", { match: url });
    const shown = [
      cited(40, "https://pubmed.ncbi.nlm.nih.gov/1/"),
      cited(33, "https://www.who.int/a"),
      cited(26, "https://www.nejm.org/b"),
    ];
    assert.equal(sidesOf([...shown, cited(5, "https://eur-lex.europa.eu/x")]).at(-1), "transfer");
    assert.equal(sidesOf([...shown, cited(5, "https://www.bmj.com/y")]).at(-1), "known");
    const aliased = [...DEMONSTRATED, event(5, "backend/api/endpoint", "own_change", { file: "src/api/x.ts" })];
    assert.equal(sidesOf(aliased).at(-1), "known");
  });

  it("a demonstrated concept succeeding in a new area is transfer, in a known area known context", () => {
    const transfer = [...DEMONSTRATED, event(5, "api", "own_change", { file: "lib/payments/charge.ts" })];
    const known = [...DEMONSTRATED, event(5, "api", "own_repair", { file: "src/api/orders.ts" })];
    assert.equal(sidesOf(transfer).at(-1), "transfer");
    assert.equal(sidesOf(known).at(-1), "known");
    const before = [event(40, "api", "own_change", { file: "src/api/orders.ts" })];
    assert.deepEqual(sidesOf([...before, event(5, "api", "own_change", { file: "lib/x/y.ts" })]), []);
    const agent = event(5, "api", "exposure", { file: "lib/payments/charge.ts" }, "agent");
    assert.deepEqual(sidesOf([...DEMONSTRATED, agent]), []);
  });

  it("a fixture log yields a transfer stratum for the new area and known context for the old one", () => {
    const log = [
      ...DEMONSTRATED,
      event(19, "api", "own_change", { file: "src/api/orders.ts" }),
      event(12, "api", "own_change", { file: "src/api/users.ts" }),
      event(12, "webhook", "own_change", { file: "src/hooks/a.ts" }),
      event(11, "webhook", "own_change", { file: "src/hooks/b.ts" }),
      event(10, "webhook", "own_change", { file: "src/hooks/c.ts" }),
      event(5, "webhook", "own_change", { file: "services/billing/webhook.ts" }),
      event(4, "api", "own_change", { file: "src/api/carts.ts" }),
      event(3, "webhook", "own_change", { file: "services/billing/retry.ts" }),
      event(2, "webhook", "own_change", { file: "services/billing/queue.ts" }),
    ];
    const backend = trajectoryOf("backend", log, [], NOW);
    const last = backend.weeks.at(-1);
    assert.ok(last !== undefined);
    assert.deepEqual(last.splits?.alone, { lower: 1, upper: 1, evidence: 6 });
    const level = splitAt(last, "alone", 10);
    assert.ok(level !== undefined && level > 0 && level < (last.independent ?? 0));
    const svg = svgOf(backend);
    assert.ok(svg.includes("split split-alone"));
    assert.ok(svg.includes("transfer above, known context below · calibration"));
  });
});

describe("explains vs detects only", () => {
  it("a keyed explanation and a bare right prediction land in different proximal splits", () => {
    const log = [
      event(9, "migration", "explanation_right"),
      event(8, "webhook", "prediction_right"),
      event(7, "idempotency", "check_right"),
      event(6, "idempotency", "explanation_right", {}, "agent"),
    ];
    assert.deepEqual(sidesOf(log), ["explains", "detects", "detects"]);
    const week = trajectoryOf("backend", [...log, ...DEMONSTRATED, event(1, "api", "own_change")], [], NOW).weeks.at(
      -1,
    );
    assert.deepEqual(week?.splits?.proximal, { lower: 1, upper: 2, evidence: 3 });
  });
});

const world = (): JudgeDeps => {
  const fs = memoryFs({}, [toAbsolutePath("/home/ana/project/.fm")]);
  return {
    runtime: fakeRuntime({ fs }),
    paths: fmPaths(toAbsolutePath("/home/ana/project")),
    fetcher: () => ({ status: "not-found" }),
    verifiers: DEFAULT_VERIFIERS,
  };
};

const call = (deps: JudgeDeps, record: Readonly<Record<string, unknown>>) => {
  const request = parseRequest(record);
  if (request === undefined) throw new Error(`bad request ${JSON.stringify(record)}`);
  return runVerb(deps, request);
};

const help = (deps: JudgeDeps, text: string, task = "t1"): string =>
  call(deps, { verb: "horizon", kind: "question", text, domain: "backend", task }).horizon?.[0]?.help ?? "";

const logged = (deps: JudgeDeps) => {
  const log = deps.runtime.readText(deps.paths.log);
  return outcomeMarks(log.ok ? log.value : "");
};

describe("horizon.outcome next to horizon.help", () => {
  it("help acted on is recognizable; help dismissed or ignored until task end is out of reach", () => {
    const deps = world();
    const taken = help(deps, "Should the retry carry an idempotency key?");
    const dropped = help(deps, "Does the queue keep order per customer?");
    const ignored = help(deps, "What does the broker do on a full disk?");
    const other = help(deps, "Is the cache shared across regions?", "t2");
    call(deps, { verb: "accept", help: taken });
    call(deps, { verb: "dismiss", help: dropped });
    assert.equal(closeHorizon(deps.runtime, deps.paths, "t1"), 1);
    assert.equal(closeHorizon(deps.runtime, deps.paths, "t1"), 0);
    assert.deepEqual(
      logged(deps).map((item) => [item.help, item.outcome, item.domain]),
      [
        [taken, "recognizable", "backend"],
        [dropped, "out_of_reach", "backend"],
        [ignored, "out_of_reach", "backend"],
      ],
    );
    assert.ok(!logged(deps).some((item) => item.help === other));
  });
});

const outcomes = (count: number, outcome: OutcomeMark["outcome"]): readonly OutcomeMark[] =>
  Array.from({ length: count }, (_, index) => ({ at: ago(3 + index), domain: "backend", outcome }));

const BASE: readonly ConceptEvent[] = [
  event(20, "api", "own_change"),
  event(13, "api", "prediction_right"),
  event(13, "migration", "prediction_right"),
  event(6, "webhook", "exposure", {}, "agent"),
  event(6, "migration", "own_change"),
  event(2, "idempotency", "exposure", {}, "agent"),
  event(1, "webhook", "prediction_right"),
  event(1, "api", "check_right"),
];

describe("evidence minimum", () => {
  it("a week below the minimum keeps the split as hypothesis, not drawn", () => {
    const thin = trajectoryOf("backend", BASE, [], NOW, outcomes(MIN_EVIDENCE - 1, "out_of_reach"));
    assert.equal(thin.status, "ok");
    assert.deepEqual([...drawnSplits(thin)], []);
    const svg = svgOf(thin);
    assert.ok(!svg.includes("split split-"));
    assert.equal(svg.split("hypothesis, not drawn").length - 1, 3);
    assert.match(chartLines([thin], { depth: "none", theme: "dark" }).join("\n"), /not drawn \(hypothesis\)/);
  });

  it("the same week with enough outcomes draws only that split, dashed and in calibration", () => {
    const enough = trajectoryOf("backend", BASE, [], NOW, [
      ...outcomes(2, "recognizable"),
      ...outcomes(MIN_EVIDENCE - 2, "out_of_reach"),
    ]);
    assert.deepEqual([...drawnSplits(enough)], ["horizon"]);
    const svg = svgOf(enough);
    assert.ok(svg.includes("split split-horizon") && svg.includes('stroke-dasharray="4 3"'));
    assert.equal(svg.split("hypothesis, not drawn").length - 1, 2);
    const legend = chartLines([enough], { depth: "none", theme: "dark" }).join("\n");
    assert.match(legend, /measured from the record \(calibration, dashed in the chart\): recognizable vs out of reach/);
    assert.match(legend, /not drawn \(hypothesis\): transfer vs known context, explains vs detects only/);
    const parsed = parseTrajectories(JSON.stringify({ schema: "finitemonkey/trajectory@1", domains: [enough] }));
    assert.deepEqual(parsed[0]?.weeks.at(-1)?.splits, enough.weeks.at(-1)?.splits);
  });
});

const catalogTrajectory = (): readonly string[] => {
  const catalog: unknown = JSON.parse(readFileSync(join(import.meta.dirname, "..", "src", "i18n", "en.json"), "utf8"));
  if (typeof catalog !== "object" || catalog === null) return [];
  return Object.entries(catalog).flatMap(([key, value]) =>
    key.startsWith("trajectory.") && typeof value === "string" ? [value] : [],
  );
};

describe("split labels", () => {
  it("no label of a split addresses the person's ability", () => {
    const texts = [
      ...Object.values(SPLIT_LABEL).flat(),
      ...Object.values(HYPOTHESES),
      ...Object.values(ENGLISH_SPLITS.name),
      ENGLISH_SPLITS.measured("x"),
      ENGLISH_SPLITS.notDrawn("x"),
      ...catalogTrajectory(),
    ];
    for (const text of texts) assert.deepEqual(wordingProblems(text), [], text);
  });
});
